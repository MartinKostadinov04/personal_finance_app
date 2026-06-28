import { Router, Request, Response } from 'express';
import { query, one, withTx } from '../db/pg';
import { parseId, BadRequest, HttpError } from '../lib/http';
import { resolveMonthId } from '../db/months';
import { userOwnsDebt, userOwnsCategory } from '../db/ownership';
import { outstanding, summarize, contactNet } from '../lib/debts';
import { Debt, DebtContact, DebtPayment, DebtDirection } from '../types';

const router = Router();

const EPS = 0.005;
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const toYMD = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const isYMD = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const ALLOWED_BANKS = ['revolut', 'santander', 'fibank', 'manual'];

// ── helpers ────────────────────────────────────────────────────────────────

// Find-or-create a contact by (user_id, name). Upsert with RETURNING so one
// statement yields the row whether it already existed or was just created.
async function resolveContact(userId: string, name: string): Promise<DebtContact> {
  const row = await one<DebtContact>(
    `INSERT INTO debt_contacts (user_id, name) VALUES ($1, $2)
     ON CONFLICT (user_id, name) DO UPDATE SET name = EXCLUDED.name
     RETURNING *`,
    [userId, name],
  );
  return row!;
}

// Load one debt with its contact name, Σ payments, computed outstanding, and
// (optionally) its payment rows. Scoped by user_id (defence in depth atop RLS).
async function loadDebt(userId: string, id: number, withPayments = false): Promise<Debt | undefined> {
  const debt = await one<Debt>(
    `SELECT d.*, dc.name AS contact_name,
            COALESCE((SELECT SUM(p.amount) FROM debt_payments p WHERE p.debt_id = d.id AND p.user_id = d.user_id), 0) AS paid
     FROM debts d
     JOIN debt_contacts dc ON dc.id = d.contact_id AND dc.user_id = d.user_id
     WHERE d.id = $1 AND d.user_id = $2`,
    [id, userId],
  );
  if (!debt) return undefined;
  debt.outstanding = outstanding(debt.amount, debt.paid ?? 0);
  if (withPayments) {
    debt.payments = await query<DebtPayment>(
      'SELECT * FROM debt_payments WHERE debt_id = $1 AND user_id = $2 ORDER BY paid_on DESC, id DESC',
      [id, userId],
    );
  }
  return debt;
}

// Recompute and persist a debt's derived status/settled_at from its payments.
// The single source of truth is the payments; status is kept in sync here within
// the caller's transaction, so it can never drift.
async function recomputeStatus(userId: string, debtId: number): Promise<void> {
  const row = await one<{ amount: number; paid: number }>(
    `SELECT d.amount,
            COALESCE((SELECT SUM(p.amount) FROM debt_payments p WHERE p.debt_id = d.id AND p.user_id = d.user_id), 0) AS paid
     FROM debts d WHERE d.id = $1 AND d.user_id = $2`,
    [debtId, userId],
  );
  if (!row) return;
  if (outstanding(row.amount, row.paid) <= EPS) {
    await query("UPDATE debts SET status = 'settled', settled_at = COALESCE(settled_at, now()) WHERE id = $1 AND user_id = $2", [debtId, userId]);
  } else {
    await query("UPDATE debts SET status = 'open', settled_at = NULL WHERE id = $1 AND user_id = $2", [debtId, userId]);
  }
}

// Create a real finance transaction for a repayment and return its id. A
// repayment of an 'owed_to_me' debt is money coming IN (income); repaying an
// 'i_owe' debt is money going OUT (expense). Amounts are stored positive — the
// `type` column carries the sign (see computeBalances in routes/months.ts).
async function createRepaymentTransaction(
  userId: string,
  debt: { direction: DebtDirection; contact_name?: string },
  amount: number,
  payDate: string,
  opts: { bank?: string; category_id?: number | null },
): Promise<number> {
  const [y, m] = payDate.split('-').map(Number);
  const monthId = await resolveMonthId(userId, y, m);
  const categoryId = opts.category_id ?? null;
  if (categoryId != null && !(await userOwnsCategory(userId, categoryId))) {
    throw new HttpError(404, 'Category not found');
  }
  const bank = ALLOWED_BANKS.includes(opts.bank as string) ? opts.bank! : 'manual';
  const txType = debt.direction === 'owed_to_me' ? 'income' : 'expense';
  const desc = `${debt.direction === 'owed_to_me' ? 'Repayment from' : 'Repayment to'} ${debt.contact_name ?? 'contact'}`;
  const tx = await one<{ id: number }>(
    `INSERT INTO transactions (user_id, month_id, date, amount, description, raw_description, type, category_id, bank, manually_reviewed)
     VALUES ($1, $2, $3, $4, $5, $5, $6, $7, $8, 1) RETURNING id`,
    [userId, monthId, payDate, round2(amount), desc, txType, categoryId, bank],
  );
  return tx!.id;
}

// ── routes ───────────────────────────────────────────────────────────────────

// GET /api/debts — list debts (+ contact name, paid, outstanding). Filters:
// direction, status, contactId. Open debts first, soonest due first.
router.get('/', async (req: Request, res: Response) => {
  const userId = req.userId!;
  const { direction, status, contactId } = req.query as Record<string, string>;
  const params: unknown[] = [userId];
  const p = (v: unknown) => { params.push(v); return `$${params.length}`; };

  let q = `
    SELECT d.*, dc.name AS contact_name, COALESCE(pay.paid, 0) AS paid
    FROM debts d
    JOIN debt_contacts dc ON dc.id = d.contact_id AND dc.user_id = d.user_id
    LEFT JOIN (
      SELECT debt_id, SUM(amount) AS paid FROM debt_payments WHERE user_id = $1 GROUP BY debt_id
    ) pay ON pay.debt_id = d.id
    WHERE d.user_id = $1
  `;
  if (direction) q += ` AND d.direction = ${p(direction)}`;
  if (status) q += ` AND d.status = ${p(status)}`;
  if (contactId) q += ` AND d.contact_id = ${p(parseInt(contactId))}`;
  q += " ORDER BY (d.status = 'open') DESC, d.due_date ASC NULLS LAST, d.created_at DESC";

  const debts = await query<Debt>(q, params);
  for (const d of debts) d.outstanding = outstanding(d.amount, d.paid ?? 0);
  res.json(debts);
});

// GET /api/debts/summary — totals + per-person net for OPEN debts.
router.get('/summary', async (req: Request, res: Response) => {
  const userId = req.userId!;
  const rows = await query<{ contact_id: number; contact_name: string; direction: DebtDirection; amount: number; paid: number }>(
    `SELECT d.contact_id, dc.name AS contact_name, d.direction, d.amount,
            COALESCE((SELECT SUM(p.amount) FROM debt_payments p WHERE p.debt_id = d.id AND p.user_id = d.user_id), 0) AS paid
     FROM debts d
     JOIN debt_contacts dc ON dc.id = d.contact_id AND dc.user_id = d.user_id
     WHERE d.user_id = $1 AND d.status = 'open'`,
    [userId],
  );
  const totals = summarize(rows.map((r) => ({ direction: r.direction, amount: r.amount, paid: r.paid })));
  const byContact = contactNet(rows.map((r) => ({
    contact_id: r.contact_id, contact_name: r.contact_name, direction: r.direction, amount: r.amount, paid: r.paid,
  })));
  res.json({ ...totals, byContact });
});

// GET /api/debts/contacts — the user's contacts (for autocomplete).
router.get('/contacts', async (req: Request, res: Response) => {
  const userId = req.userId!;
  const contacts = await query<DebtContact>('SELECT * FROM debt_contacts WHERE user_id = $1 ORDER BY name', [userId]);
  res.json(contacts);
});

// POST /api/debts — create a debt (find-or-create its contact).
router.post('/', async (req: Request, res: Response) => {
  const userId = req.userId!;
  const { counterpartyName, direction, amount, currency, description, incurredOn, dueDate } = req.body as {
    counterpartyName?: string; direction?: string; amount?: number; currency?: string;
    description?: string; incurredOn?: string; dueDate?: string;
  };

  const name = (counterpartyName ?? '').trim();
  if (!name) throw new BadRequest('counterpartyName is required');
  if (direction !== 'owed_to_me' && direction !== 'i_owe') throw new BadRequest('direction must be owed_to_me or i_owe');
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) throw new BadRequest('amount must be a positive number');

  const debt = await withTx(async () => {
    const contact = await resolveContact(userId, name);
    const ins = await one<{ id: number }>(
      `INSERT INTO debts (user_id, contact_id, direction, amount, currency, description, incurred_on, due_date)
       VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::date, current_date), $8::date)
       RETURNING id`,
      [userId, contact.id, direction, round2(amt), (currency ?? 'EUR').trim() || 'EUR',
       description?.trim() || null, isYMD(incurredOn) ? incurredOn : null, isYMD(dueDate) ? dueDate : null],
    );
    return loadDebt(userId, ins!.id, true);
  });

  res.status(201).json(debt);
});

// GET /api/debts/:id — one debt with its payments.
router.get('/:id', async (req: Request, res: Response) => {
  const userId = req.userId!;
  const debt = await loadDebt(userId, parseId(req.params.id, 'debt id'), true);
  if (!debt) { res.status(404).json({ error: 'Debt not found' }); return; }
  res.json(debt);
});

// PATCH /api/debts/:id — edit fields (recomputes status if the amount changed).
router.patch('/:id', async (req: Request, res: Response) => {
  const userId = req.userId!;
  const id = parseId(req.params.id, 'debt id');
  const { counterpartyName, direction, amount, currency, description, incurredOn, dueDate } = req.body as {
    counterpartyName?: string; direction?: string; amount?: number; currency?: string;
    description?: string; incurredOn?: string; dueDate?: string | null;
  };

  if (direction !== undefined && direction !== 'owed_to_me' && direction !== 'i_owe') {
    throw new BadRequest('direction must be owed_to_me or i_owe');
  }
  let amt: number | null = null;
  if (amount !== undefined) {
    amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) throw new BadRequest('amount must be a positive number');
  }
  const hasDescription = 'description' in req.body;
  const hasDueDate = 'dueDate' in req.body;

  const debt = await withTx(async () => {
    let contactId: number | null = null;
    if (counterpartyName !== undefined) {
      const name = String(counterpartyName).trim();
      if (!name) throw new BadRequest('counterpartyName cannot be empty');
      contactId = (await resolveContact(userId, name)).id;
    }
    const updated = await one<{ id: number }>(
      `UPDATE debts SET
         contact_id  = COALESCE($1, contact_id),
         direction   = COALESCE($2, direction),
         amount      = COALESCE($3, amount),
         currency    = COALESCE($4, currency),
         description = CASE WHEN $5 THEN $6 ELSE description END,
         incurred_on = COALESCE($7::date, incurred_on),
         due_date    = CASE WHEN $8 THEN $9::date ELSE due_date END
       WHERE id = $10 AND user_id = $11
       RETURNING id`,
      [contactId, direction ?? null, amt != null ? round2(amt) : null, currency?.trim() || null,
       hasDescription, hasDescription ? (description?.trim() || null) : null,
       isYMD(incurredOn) ? incurredOn : null,
       hasDueDate, hasDueDate && isYMD(dueDate) ? dueDate : null, id, userId],
    );
    if (!updated) return undefined;
    await recomputeStatus(userId, id);
    return loadDebt(userId, id, true);
  });

  if (!debt) { res.status(404).json({ error: 'Debt not found' }); return; }
  res.json(debt);
});

// DELETE /api/debts/:id — delete a debt (cascades its payments).
router.delete('/:id', async (req: Request, res: Response) => {
  const userId = req.userId!;
  await query('DELETE FROM debts WHERE id = $1 AND user_id = $2', [parseId(req.params.id, 'debt id'), userId]);
  res.json({ success: true });
});

// POST /api/debts/:id/payments — record a repayment, optionally also posting it
// as a real income/expense transaction.
router.post('/:id/payments', async (req: Request, res: Response) => {
  const userId = req.userId!;
  const id = parseId(req.params.id, 'debt id');
  const { amount, paidOn, note, recordTransaction } = req.body as {
    amount?: number; paidOn?: string; note?: string;
    recordTransaction?: { bank?: string; category_id?: number | null } | null;
  };

  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) throw new BadRequest('amount must be a positive number');

  const result = await withTx(async () => {
    const debt = await one<Debt & { paid: number }>(
      `SELECT d.*, dc.name AS contact_name,
              COALESCE((SELECT SUM(p.amount) FROM debt_payments p WHERE p.debt_id = d.id AND p.user_id = d.user_id), 0) AS paid
       FROM debts d
       JOIN debt_contacts dc ON dc.id = d.contact_id AND dc.user_id = d.user_id
       WHERE d.id = $1 AND d.user_id = $2 FOR UPDATE OF d`,
      [id, userId],
    );
    if (!debt) return null;

    const remaining = outstanding(debt.amount, debt.paid);
    if (amt > remaining + EPS) {
      throw new BadRequest(`Payment exceeds the outstanding balance (${remaining.toFixed(2)})`);
    }

    const payDate = isYMD(paidOn) ? paidOn : toYMD(new Date());
    const transactionId = recordTransaction
      ? await createRepaymentTransaction(userId, debt, amt, payDate, recordTransaction)
      : null;

    const payment = await one<DebtPayment>(
      `INSERT INTO debt_payments (user_id, debt_id, amount, paid_on, note, transaction_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [userId, id, round2(amt), payDate, note?.trim() || null, transactionId],
    );
    await recomputeStatus(userId, id);
    return { debt: await loadDebt(userId, id, true), payment };
  });

  if (!result) { res.status(404).json({ error: 'Debt not found' }); return; }
  res.status(201).json(result);
});

// DELETE /api/debts/:id/payments/:pid — remove a repayment (recomputes status).
// Does NOT delete any linked transaction — that is managed from Transactions.
router.delete('/:id/payments/:pid', async (req: Request, res: Response) => {
  const userId = req.userId!;
  const id = parseId(req.params.id, 'debt id');
  const pid = parseId(req.params.pid, 'payment id');

  const debt = await withTx(async () => {
    if (!(await userOwnsDebt(userId, id))) return undefined;
    await query('DELETE FROM debt_payments WHERE id = $1 AND debt_id = $2 AND user_id = $3', [pid, id, userId]);
    await recomputeStatus(userId, id);
    return loadDebt(userId, id, true);
  });

  if (!debt) { res.status(404).json({ error: 'Debt not found' }); return; }
  res.json(debt);
});

// POST /api/debts/:id/settle — clear the remaining balance. Records the
// outstanding amount as a final payment (optionally posting a transaction); pass
// no recordTransaction and note 'Forgiven' to forgive. Idempotent if already settled.
router.post('/:id/settle', async (req: Request, res: Response) => {
  const userId = req.userId!;
  const id = parseId(req.params.id, 'debt id');
  const { note, recordTransaction } = req.body as {
    note?: string; recordTransaction?: { bank?: string; category_id?: number | null } | null;
  };

  const result = await withTx(async () => {
    const debt = await one<Debt & { paid: number }>(
      `SELECT d.*, dc.name AS contact_name,
              COALESCE((SELECT SUM(p.amount) FROM debt_payments p WHERE p.debt_id = d.id AND p.user_id = d.user_id), 0) AS paid
       FROM debts d
       JOIN debt_contacts dc ON dc.id = d.contact_id AND dc.user_id = d.user_id
       WHERE d.id = $1 AND d.user_id = $2 FOR UPDATE OF d`,
      [id, userId],
    );
    if (!debt) return undefined;

    const remaining = outstanding(debt.amount, debt.paid);
    if (remaining > EPS) {
      const payDate = toYMD(new Date());
      const transactionId = recordTransaction
        ? await createRepaymentTransaction(userId, debt, remaining, payDate, recordTransaction)
        : null;
      await query(
        `INSERT INTO debt_payments (user_id, debt_id, amount, paid_on, note, transaction_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [userId, id, remaining, payDate, note?.trim() || 'Settled', transactionId],
      );
    }
    await recomputeStatus(userId, id);
    return loadDebt(userId, id, true);
  });

  if (!result) { res.status(404).json({ error: 'Debt not found' }); return; }
  res.json(result);
});

export default router;

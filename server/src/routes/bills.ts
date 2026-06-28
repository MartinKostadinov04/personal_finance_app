import { Router, Request, Response } from 'express';
import multer from 'multer';
import { query, one, withTx, adminQuery } from '../db/pg';
import { parseId } from '../lib/http';
import { resolveMonthId } from '../db/months';
import { uploadReceipt, signedReceiptUrl } from '../lib/storage';
import { getSupabaseAdmin } from '../lib/supabaseAdmin';
import {
  computeSettlement,
  SettlementParticipant,
  SettlementExpense,
} from '../lib/settlement';
import {
  Bill,
  BillParticipant,
  BillExpense,
  BillExpensePayer,
  BillExpenseSplit,
} from '../types';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const PALETTE = ['#a78bfa', '#f472b6', '#38bdf8', '#34d399', '#fbbf24', '#f87171', '#22d3ee', '#c084fc', '#4ade80', '#fb923c'];
const randomColor = () => PALETTE[Math.floor(Math.random() * PALETTE.length)];
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const toYMD = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Returns the caller's participant row for a bill, or null if they're not a member.
async function membership(billId: number, userId: string): Promise<BillParticipant | null> {
  return (await one<BillParticipant>(
    'SELECT * FROM bill_participants WHERE bill_id = $1 AND user_id = $2', [billId, userId],
  )) ?? null;
}

// A closed bill is frozen: its expenses can't be changed (settling up still can).
async function billIsOpen(billId: number): Promise<boolean> {
  const b = await one<{ status: string }>('SELECT status FROM bills WHERE id = $1', [billId]);
  return b?.status === 'open';
}
const CLOSED_MSG = 'This bill is closed — reopen it to change expenses.';

interface ResolvedInvitee {
  user_id: string | null;
  status: 'active' | 'invited';
}

// Turn a guest email into a participant seat. If an account already exists we
// link to it directly (active when confirmed, invited otherwise); if not, we
// send a Supabase invite email and link the freshly-created pending user.
// Never throws — if the lookup/invite fails (e.g. SMTP not configured), the
// caller still gets an 'invited' seat with a null user_id, and the per-request
// linker in provision.ts will claim it when that person eventually signs in.
async function resolveInvitee(email: string): Promise<ResolvedInvitee> {
  const clean = email.trim().toLowerCase();
  try {
    // Must use adminQuery: `authenticated` role has no SELECT on auth.users.
    const rows = await adminQuery<{ id: string; confirmed: boolean }>(
      'SELECT id, (email_confirmed_at IS NOT NULL) AS confirmed FROM auth.users WHERE lower(email) = $1',
      [clean],
    );
    const existing = rows[0];
    if (existing) {
      return { user_id: existing.id, status: existing.confirmed ? 'active' : 'invited' };
    }
    const redirectTo = process.env.APP_URL || undefined;
    const { data, error } = await getSupabaseAdmin().auth.admin.inviteUserByEmail(clean, { redirectTo });
    if (error) {
      console.error(`inviteUserByEmail failed for ${clean}:`, error.message);
      return { user_id: null, status: 'invited' };
    }
    return { user_id: data.user?.id ?? null, status: 'invited' };
  } catch (e) {
    console.error(`resolveInvitee failed for ${clean}:`, e);
    return { user_id: null, status: 'invited' };
  }
}

// Load a bill's participants + expenses (with payers and splits) in one place.
async function loadBillDetail(billId: number): Promise<{ bill: Bill; participants: BillParticipant[]; expenses: BillExpense[] } | null> {
  const bill = await one<Bill>('SELECT * FROM bills WHERE id = $1', [billId]);
  if (!bill) return null;

  const participants = await query<BillParticipant>(
    'SELECT * FROM bill_participants WHERE bill_id = $1 ORDER BY id ASC', [billId],
  );
  const expenses = await query<BillExpense>(
    'SELECT * FROM bill_expenses WHERE bill_id = $1 ORDER BY spent_at DESC, id DESC', [billId],
  );
  const ids = expenses.map(e => e.id);
  const payers = ids.length
    ? await query<BillExpensePayer>('SELECT * FROM bill_expense_payers WHERE expense_id = ANY($1::bigint[])', [ids])
    : [];
  const splits = ids.length
    ? await query<BillExpenseSplit>('SELECT * FROM bill_expense_splits WHERE expense_id = ANY($1::bigint[])', [ids])
    : [];
  for (const e of expenses) {
    e.payers = payers.filter(p => p.expense_id === e.id);
    e.splits = splits.filter(s => s.expense_id === e.id);
  }
  return { bill, participants, expenses };
}

function runSettlement(participants: BillParticipant[], expenses: BillExpense[]) {
  const sParticipants: SettlementParticipant[] = participants.map(p => ({ id: p.id, coveredBy: p.covered_by_participant_id }));
  const sExpenses: SettlementExpense[] = expenses.map(e => ({
    id: e.id,
    amount: e.amount,
    payers: (e.payers ?? []).map(p => ({ participantId: p.participant_id, amountPaid: p.amount_paid })),
    splits: (e.splits ?? []).map(s => ({ participantId: s.participant_id, shareAmount: s.share_amount, coveredBy: s.covered_by_participant_id })),
  }));
  return computeSettlement(sParticipants, sExpenses);
}

const sum = (ns: number[]) => ns.reduce((a, b) => a + b, 0);

/* ─── Bills ─── */

// GET /api/bills — bills the caller participates in.
router.get('/', async (req: Request, res: Response) => {
  const userId = req.userId!;
  const bills = await query(`
    SELECT b.*,
      (SELECT COUNT(*) FROM bill_participants p WHERE p.bill_id = b.id) AS participant_count,
      (SELECT COALESCE(SUM(amount), 0) FROM bill_expenses e WHERE e.bill_id = b.id) AS total_amount
    FROM bills b
    WHERE EXISTS (SELECT 1 FROM bill_participants p WHERE p.bill_id = b.id AND p.user_id = $1)
    ORDER BY b.created_at DESC
  `, [userId]);
  res.json(bills);
});

// POST /api/bills — create a bill. The caller becomes the owner participant.
// Body: { name, myDisplayName, others: [{ display_name, email? }] }  (>= 1 other → >= 2 people)
router.post('/', async (req: Request, res: Response) => {
  const userId = req.userId!;
  const email = req.userEmail ?? null;
  const { name, myDisplayName, others } = req.body as {
    name?: string;
    myDisplayName?: string;
    others?: Array<{ display_name?: string; email?: string }>;
  };

  if (!name?.trim() || !myDisplayName?.trim()) {
    res.status(400).json({ error: 'name and myDisplayName are required' });
    return;
  }
  const cleanOthers = (others ?? []).filter(o => o.display_name?.trim());
  if (cleanOthers.length < 1) {
    res.status(400).json({ error: 'A bill needs at least 2 people (you + at least one other)' });
    return;
  }

  // Resolve invitee identities (link existing user / send invite) outside the
  // transaction — inviteUserByEmail is a network call and must not hold a tx open.
  const resolved = await Promise.all(cleanOthers.map(async (o) => {
    const e = o.email?.trim();
    const r: ResolvedInvitee = e ? await resolveInvitee(e) : { user_id: null, status: 'active' };
    return { display_name: o.display_name!.trim(), email: e ?? null, user_id: r.user_id, status: r.status };
  }));

  const created = await withTx(async (client) => {
    const bill = (await client.query<Bill>(
      'INSERT INTO bills (name, created_by) VALUES ($1, $2) RETURNING *', [name.trim(), userId],
    )).rows[0];

    await client.query(
      `INSERT INTO bill_participants (bill_id, user_id, email, display_name, role, status)
       VALUES ($1, $2, $3, $4, 'owner', 'active')`,
      [bill.id, userId, email, myDisplayName.trim()],
    );
    for (const o of resolved) {
      await client.query(
        `INSERT INTO bill_participants (bill_id, user_id, email, display_name, role, status)
         VALUES ($1, $2, $3, $4, 'member', $5)`,
        [bill.id, o.user_id, o.email, o.display_name, o.status],
      );
    }

    const participants = (await client.query<BillParticipant>(
      'SELECT * FROM bill_participants WHERE bill_id = $1 ORDER BY id ASC', [bill.id],
    )).rows;
    return { ...bill, participants };
  });

  res.status(201).json(created);
});

// GET /api/bills/:id — full detail.
router.get('/:id', async (req: Request, res: Response) => {
  const userId = req.userId!;
  const billId = parseId(req.params.id, 'bill id');
  if (!(await membership(billId, userId))) {
    res.status(404).json({ error: 'Bill not found' });
    return;
  }
  const detail = await loadBillDetail(billId);
  res.json(detail);
});

// PATCH /api/bills/:id — rename (owner only).
router.patch('/:id', async (req: Request, res: Response) => {
  const userId = req.userId!;
  const billId = parseId(req.params.id, 'bill id');
  const me = await membership(billId, userId);
  if (!me) { res.status(404).json({ error: 'Bill not found' }); return; }
  if (me.role !== 'owner') { res.status(403).json({ error: 'Only the bill owner can do this' }); return; }
  const { name } = req.body as { name?: string };
  const updated = await one<Bill>('UPDATE bills SET name = COALESCE($1, name) WHERE id = $2 RETURNING *', [name?.trim() ?? null, billId]);
  res.json(updated);
});

// DELETE /api/bills/:id — creator only. Also removes the caller's own
// pushed-to-finance transaction(s) for this bill, so deleting the bill cleans up
// the expense it created in their finance workspace. Other participants' pushed
// transactions live in their own workspaces and are left untouched (and are
// unreachable here under RLS anyway).
router.delete('/:id', async (req: Request, res: Response) => {
  const userId = req.userId!;
  const billId = parseId(req.params.id, 'bill id');
  const bill = await one<Bill>('SELECT * FROM bills WHERE id = $1', [billId]);
  if (!bill) { res.status(404).json({ error: 'Bill not found' }); return; }
  if (bill.created_by !== userId) { res.status(403).json({ error: 'Only the creator can delete this bill' }); return; }

  await withTx(async (client) => {
    // Capture the caller's pushed transaction id(s) before the bill cascade
    // removes the bill_participants rows that link back to them.
    const pushedIds = (await client.query<{ pushed_transaction_id: number }>(
      `SELECT pushed_transaction_id FROM bill_participants
       WHERE bill_id = $1 AND user_id = $2 AND pushed_transaction_id IS NOT NULL`,
      [billId, userId],
    )).rows.map(r => r.pushed_transaction_id);

    await client.query('DELETE FROM bills WHERE id = $1', [billId]);

    if (pushedIds.length > 0) {
      // The user_id guard is redundant with RLS but keeps the scope explicit.
      await client.query(
        'DELETE FROM transactions WHERE id = ANY($1) AND user_id = $2',
        [pushedIds, userId],
      );
    }
  });

  res.json({ success: true });
});

// POST /api/bills/:id/close  and  /reopen  (owner only)
router.post('/:id/close', async (req: Request, res: Response) => {
  const userId = req.userId!;
  const billId = parseId(req.params.id, 'bill id');
  const me = await membership(billId, userId);
  if (!me) { res.status(404).json({ error: 'Bill not found' }); return; }
  if (me.role !== 'owner') { res.status(403).json({ error: 'Only the bill owner can do this' }); return; }
  const updated = await one<Bill>("UPDATE bills SET status = 'closed', closed_at = now() WHERE id = $1 RETURNING *", [billId]);
  res.json(updated);
});

router.post('/:id/reopen', async (req: Request, res: Response) => {
  const userId = req.userId!;
  const billId = parseId(req.params.id, 'bill id');
  const me = await membership(billId, userId);
  if (!me) { res.status(404).json({ error: 'Bill not found' }); return; }
  if (me.role !== 'owner') { res.status(403).json({ error: 'Only the bill owner can do this' }); return; }
  const updated = await one<Bill>("UPDATE bills SET status = 'open', closed_at = NULL WHERE id = $1 RETURNING *", [billId]);
  res.json(updated);
});

/* ─── Participants ─── */

// POST /api/bills/:id/participants — add a person.
router.post('/:id/participants', async (req: Request, res: Response) => {
  const userId = req.userId!;
  const billId = parseId(req.params.id, 'bill id');
  if (!(await membership(billId, userId))) { res.status(404).json({ error: 'Bill not found' }); return; }
  const { display_name, email } = req.body as { display_name?: string; email?: string };
  if (!display_name?.trim()) { res.status(400).json({ error: 'display_name is required' }); return; }

  const e = email?.trim();
  const r: ResolvedInvitee = e ? await resolveInvitee(e) : { user_id: null, status: 'active' };
  const created = await one<BillParticipant>(
    `INSERT INTO bill_participants (bill_id, user_id, email, display_name, role, status)
     VALUES ($1, $2, $3, $4, 'member', $5) RETURNING *`,
    [billId, r.user_id, e ?? null, display_name.trim(), r.status],
  );
  res.status(201).json(created);
});

// PATCH /api/bills/:id/participants/:pid — rename, set bill-wide merge, mark paid (owner only).
router.patch('/:id/participants/:pid', async (req: Request, res: Response) => {
  const userId = req.userId!;
  const billId = parseId(req.params.id, 'bill id');
  const pid = parseId(req.params.pid, 'participant id');
  const me = await membership(billId, userId);
  if (!me) { res.status(404).json({ error: 'Bill not found' }); return; }
  if (me.role !== 'owner') { res.status(403).json({ error: 'Only the bill owner can do this' }); return; }

  const body = req.body as { display_name?: string; covered_by_participant_id?: number | null; settled?: boolean };
  const hasCovered = 'covered_by_participant_id' in body;
  const hasSettled = 'settled' in body;

  const updated = await one<BillParticipant>(`
    UPDATE bill_participants SET
      display_name = COALESCE($1, display_name),
      covered_by_participant_id = CASE WHEN $2 = 1 THEN $3::bigint ELSE covered_by_participant_id END,
      settled = CASE WHEN $4 = 1 THEN $5::boolean ELSE settled END,
      settled_at = CASE WHEN $4 = 1 AND $5::boolean THEN now() WHEN $4 = 1 THEN NULL ELSE settled_at END
    WHERE id = $6 AND bill_id = $7
    RETURNING *
  `, [
    body.display_name?.trim() ?? null,
    hasCovered ? 1 : 0, body.covered_by_participant_id ?? null,
    hasSettled ? 1 : 0, body.settled ?? null,
    pid, billId,
  ]);
  res.json(updated);
});

// DELETE /api/bills/:id/participants/:pid — only if not used in any expense.
router.delete('/:id/participants/:pid', async (req: Request, res: Response) => {
  const userId = req.userId!;
  const billId = parseId(req.params.id, 'bill id');
  const pid = parseId(req.params.pid, 'participant id');
  if (!(await membership(billId, userId))) { res.status(404).json({ error: 'Bill not found' }); return; }

  const used = await one<{ c: number }>(`
    SELECT (
      (SELECT COUNT(*) FROM bill_expense_payers WHERE participant_id = $1) +
      (SELECT COUNT(*) FROM bill_expense_splits WHERE participant_id = $1)
    )::int AS c
  `, [pid]);
  if ((used?.c ?? 0) > 0) {
    res.status(409).json({ error: 'This person appears in expenses — remove them from those first' });
    return;
  }
  await query('DELETE FROM bill_participants WHERE id = $1 AND bill_id = $2', [pid, billId]);
  res.json({ success: true });
});

/* ─── Expenses ─── */

interface ExpenseBody {
  name?: string;
  amount?: number;
  spent_at?: string;
  receipt_path?: string | null;
  payers?: Array<{ participant_id: number; amount_paid: number }>;
  splits?: Array<{ participant_id: number; share_amount: number; covered_by_participant_id?: number | null }>;
}

function validateExpense(body: ExpenseBody, participantIds: Set<number>): string | null {
  if (!body.name?.trim()) return 'name is required';
  if (typeof body.amount !== 'number' || body.amount <= 0) return 'amount must be a positive number';
  const payers = body.payers ?? [];
  const splits = body.splits ?? [];
  if (payers.length === 0) return 'at least one payer is required';
  if (splits.length === 0) return 'at least one split is required';
  for (const p of [...payers.map(p => p.participant_id), ...splits.map(s => s.participant_id)]) {
    if (!participantIds.has(p)) return 'all payers/splits must reference participants of this bill';
  }
  if (Math.abs(sum(payers.map(p => p.amount_paid)) - body.amount) > 0.01) return 'payer amounts must sum to the expense amount';
  if (Math.abs(sum(splits.map(s => s.share_amount)) - body.amount) > 0.01) return 'split shares must sum to the expense amount';
  return null;
}

async function insertExpenseRows(client: import('pg').PoolClient, expenseId: number, body: ExpenseBody) {
  for (const p of body.payers!) {
    await client.query('INSERT INTO bill_expense_payers (expense_id, participant_id, amount_paid) VALUES ($1, $2, $3)', [expenseId, p.participant_id, p.amount_paid]);
  }
  for (const s of body.splits!) {
    await client.query(
      'INSERT INTO bill_expense_splits (expense_id, participant_id, share_amount, covered_by_participant_id) VALUES ($1, $2, $3, $4)',
      [expenseId, s.participant_id, s.share_amount, s.covered_by_participant_id ?? null],
    );
  }
}

// POST /api/bills/:id/expenses
router.post('/:id/expenses', async (req: Request, res: Response) => {
  const userId = req.userId!;
  const billId = parseId(req.params.id, 'bill id');
  if (!(await membership(billId, userId))) { res.status(404).json({ error: 'Bill not found' }); return; }
  if (!(await billIsOpen(billId))) { res.status(409).json({ error: CLOSED_MSG }); return; }

  const body = req.body as ExpenseBody;
  const participants = await query<{ id: number }>('SELECT id FROM bill_participants WHERE bill_id = $1', [billId]);
  const err = validateExpense(body, new Set(participants.map(p => p.id)));
  if (err) { res.status(400).json({ error: err }); return; }

  const expense = await withTx(async (client) => {
    const e = (await client.query<BillExpense>(
      `INSERT INTO bill_expenses (bill_id, name, amount, spent_at, receipt_path, created_by)
       VALUES ($1, $2, $3, COALESCE($4, now()), $5, $6) RETURNING *`,
      [billId, body.name!.trim(), body.amount, body.spent_at ?? null, body.receipt_path ?? null, userId],
    )).rows[0];
    await insertExpenseRows(client, e.id, body);
    return e;
  });

  const detail = await loadBillDetail(billId);
  res.status(201).json({ expense, bill: detail });
});

// PATCH /api/bills/:id/expenses/:eid — replace the expense's payers/splits.
router.patch('/:id/expenses/:eid', async (req: Request, res: Response) => {
  const userId = req.userId!;
  const billId = parseId(req.params.id, 'bill id');
  const eid = parseId(req.params.eid, 'expense id');
  if (!(await membership(billId, userId))) { res.status(404).json({ error: 'Bill not found' }); return; }
  if (!(await billIsOpen(billId))) { res.status(409).json({ error: CLOSED_MSG }); return; }

  const exists = await one('SELECT id FROM bill_expenses WHERE id = $1 AND bill_id = $2', [eid, billId]);
  if (!exists) { res.status(404).json({ error: 'Expense not found' }); return; }

  const body = req.body as ExpenseBody;
  const participants = await query<{ id: number }>('SELECT id FROM bill_participants WHERE bill_id = $1', [billId]);
  const err = validateExpense(body, new Set(participants.map(p => p.id)));
  if (err) { res.status(400).json({ error: err }); return; }

  await withTx(async (client) => {
    const hasReceipt = 'receipt_path' in body;
    await client.query(
      `UPDATE bill_expenses SET name = $1, amount = $2, spent_at = COALESCE($3, spent_at),
       receipt_path = CASE WHEN $5 THEN $4::text ELSE receipt_path END, updated_at = now() WHERE id = $6`,
      [body.name!.trim(), body.amount, body.spent_at ?? null, body.receipt_path ?? null, hasReceipt, eid],
    );
    await client.query('DELETE FROM bill_expense_payers WHERE expense_id = $1', [eid]);
    await client.query('DELETE FROM bill_expense_splits WHERE expense_id = $1', [eid]);
    await insertExpenseRows(client, eid, body);
  });

  const detail = await loadBillDetail(billId);
  res.json({ bill: detail });
});

// DELETE /api/bills/:id/expenses/:eid
router.delete('/:id/expenses/:eid', async (req: Request, res: Response) => {
  const userId = req.userId!;
  const billId = parseId(req.params.id, 'bill id');
  const eid = parseId(req.params.eid, 'expense id');
  if (!(await membership(billId, userId))) { res.status(404).json({ error: 'Bill not found' }); return; }
  if (!(await billIsOpen(billId))) { res.status(409).json({ error: CLOSED_MSG }); return; }
  await query('DELETE FROM bill_expenses WHERE id = $1 AND bill_id = $2', [eid, billId]);
  res.json({ success: true });
});

/* ─── Settlement ─── */

// GET /api/bills/:id/settlement — the who-owes-whom dashboard.
router.get('/:id/settlement', async (req: Request, res: Response) => {
  const userId = req.userId!;
  const billId = parseId(req.params.id, 'bill id');
  if (!(await membership(billId, userId))) { res.status(404).json({ error: 'Bill not found' }); return; }

  const detail = await loadBillDetail(billId);
  if (!detail) { res.status(404).json({ error: 'Bill not found' }); return; }
  const result = runSettlement(detail.participants, detail.expenses);
  res.json({ ...result, participants: detail.participants });
});

/* ─── Push my total into my finance app ─── */

// POST /api/bills/:id/push-to-finance — creates a group (bill name + random color)
// and a transaction (my total share) in the caller's finance workspace.
router.post('/:id/push-to-finance', async (req: Request, res: Response) => {
  const userId = req.userId!;
  const billId = parseId(req.params.id, 'bill id');
  const me = await membership(billId, userId);
  if (!me) { res.status(404).json({ error: 'Bill not found' }); return; }

  const detail = await loadBillDetail(billId);
  if (!detail) { res.status(404).json({ error: 'Bill not found' }); return; }
  const result = runSettlement(detail.participants, detail.expenses);
  const myCost = round2(result.perPersonTotalCost[me.id] ?? 0);
  if (myCost <= 0) {
    res.status(400).json({ error: 'Your total for this bill is 0 — nothing to add.' });
    return;
  }

  const { category_id } = req.body as { category_id?: number };
  const now = new Date();
  const monthId = await resolveMonthId(userId, now.getFullYear(), now.getMonth() + 1);

  const out = await withTx(async (client) => {
    // Lock the caller's seat so concurrent pushes can't each create a transaction.
    const seat = (await client.query<{ pushed_transaction_id: number | null }>(
      'SELECT pushed_transaction_id FROM bill_participants WHERE id = $1 FOR UPDATE', [me.id],
    )).rows[0];

    // Reuse an existing group with the bill's name, else create one with a random color.
    let group = (await client.query('SELECT * FROM groups WHERE user_id = $1 AND name = $2', [userId, detail.bill.name])).rows[0];
    if (!group) {
      group = (await client.query(
        'INSERT INTO groups (user_id, name, color) VALUES ($1, $2, $3) RETURNING *',
        [userId, detail.bill.name, randomColor()],
      )).rows[0];
    }

    // If we've pushed before and that transaction still exists, update it in place
    // (the total may have changed as expenses were added); otherwise create it.
    let tx;
    let updated = false;
    if (seat?.pushed_transaction_id) {
      tx = (await client.query(
        `UPDATE transactions
           SET month_id = $1, date = $2, amount = $3, description = $4, raw_description = $4, group_id = $5
         WHERE id = $6 AND user_id = $7 RETURNING *`,
        [monthId, toYMD(now), myCost, detail.bill.name, group.id, seat.pushed_transaction_id, userId],
      )).rows[0];
      updated = !!tx;
    }
    if (!tx) {
      tx = (await client.query(
        `INSERT INTO transactions (user_id, month_id, date, amount, description, raw_description, type, category_id, bank, manually_reviewed, group_id)
         VALUES ($1, $2, $3, $4, $5, $5, 'expense', $6, 'manual', 1, $7) RETURNING *`,
        [userId, monthId, toYMD(now), myCost, detail.bill.name, category_id ?? null, group.id],
      )).rows[0];
      await client.query('UPDATE bill_participants SET pushed_transaction_id = $1 WHERE id = $2', [tx.id, me.id]);
    }
    return { group, transaction: tx, updated };
  });

  res.status(out.updated ? 200 : 201).json(out);
});

/* ─── Receipts ─── */

// POST /api/bills/:id/expenses/:eid/receipt — upload a receipt image.
router.post('/:id/expenses/:eid/receipt', upload.single('file'), async (req: Request, res: Response) => {
  const userId = req.userId!;
  const billId = parseId(req.params.id, 'bill id');
  const eid = parseId(req.params.eid, 'expense id');
  if (!(await membership(billId, userId))) { res.status(404).json({ error: 'Bill not found' }); return; }
  if (!(await billIsOpen(billId))) { res.status(409).json({ error: CLOSED_MSG }); return; }
  if (!req.file) { res.status(400).json({ error: 'No file uploaded' }); return; }

  const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']);
  if (!ALLOWED_MIME.has(req.file.mimetype)) {
    res.status(415).json({ error: 'Unsupported file type' });
    return;
  }

  const exists = await one('SELECT id FROM bill_expenses WHERE id = $1 AND bill_id = $2', [eid, billId]);
  if (!exists) { res.status(404).json({ error: 'Expense not found' }); return; }

  const ext = (req.file.originalname.match(/\.[a-z0-9]+$/i)?.[0] ?? '').toLowerCase();
  const path = `bills/${billId}/${eid}-${Date.now()}${ext}`;
  try {
    await uploadReceipt(path, req.file.buffer, req.file.mimetype);
    await query('UPDATE bill_expenses SET receipt_path = $1, updated_at = now() WHERE id = $2', [path, eid]);
    res.json({ receipt_path: path });
  } catch (e) {
    console.error('Receipt upload failed:', e);
    res.status(500).json({ error: 'Receipt upload failed' });
  }
});

// GET /api/bills/:id/expenses/:eid/receipt — a signed view URL.
router.get('/:id/expenses/:eid/receipt', async (req: Request, res: Response) => {
  const userId = req.userId!;
  const billId = parseId(req.params.id, 'bill id');
  const eid = parseId(req.params.eid, 'expense id');
  if (!(await membership(billId, userId))) { res.status(404).json({ error: 'Bill not found' }); return; }

  const exp = await one<{ receipt_path: string | null }>('SELECT receipt_path FROM bill_expenses WHERE id = $1 AND bill_id = $2', [eid, billId]);
  if (!exp?.receipt_path) { res.status(404).json({ error: 'No receipt' }); return; }
  try {
    const url = await signedReceiptUrl(exp.receipt_path);
    res.json({ url });
  } catch (e) {
    console.error('Signing receipt URL failed:', e);
    res.status(500).json({ error: 'Could not get receipt URL' });
  }
});

export default router;

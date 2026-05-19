import { Router, Request, Response } from 'express';
import { getDb } from '../db/index';
import { resolveMonthId } from '../db/months';
import { Month } from '../types';

const router = Router();

const LIVING_CATEGORIES = ['groceries', 'home_products', 'rent', 'water_heating', 'electricity', 'phone_internet', 'subscriptions'];
const EXTRA_CATEGORIES = ['transportation', 'restaurants', 'misc_purchases', 'other'];

/**
 * Derive effective start/end balances for a month by walking forward from the
 * earliest known month. Rules:
 *   end_balance(N)   = start_balance(N) + income(N) − expenses(N)
 *   start_balance(N) = end_balance(N-1)  unless the stored start_balance is a
 *                      non-zero "anchor override", in which case that value wins.
 * The stored end_balance column is ignored (derived only).
 *
 * Returns null if the requested month does not exist.
 */
export function computeBalances(
  db: ReturnType<typeof getDb>,
  year: number,
  month: number,
): { start_balance: number; end_balance: number } | null {
  const target = db.prepare('SELECT id FROM months WHERE year = ? AND month = ?').get(year, month) as { id: number } | undefined;
  if (!target) return null;

  // All months up to and including the target, ordered chronologically.
  const chain = db.prepare(`
    SELECT m.id, m.year, m.month, m.start_balance,
      COALESCE((SELECT SUM(amount) FROM transactions WHERE month_id = m.id AND type = 'income'),   0) AS income,
      COALESCE((SELECT SUM(amount) FROM transactions WHERE month_id = m.id AND type = 'expense'),  0) AS expenses
    FROM months m
    WHERE (m.year < ?) OR (m.year = ? AND m.month <= ?)
    ORDER BY m.year ASC, m.month ASC
  `).all(year, year, month) as Array<{ id: number; year: number; month: number; start_balance: number; income: number; expenses: number }>;

  let prevEnd = 0;
  let start = 0;
  let end = 0;
  for (const row of chain) {
    // Non-zero stored start_balance acts as an anchor override.
    start = row.start_balance !== 0 ? row.start_balance : prevEnd;
    end = start + row.income - row.expenses;
    prevEnd = end;
  }
  return { start_balance: start, end_balance: end };
}

router.get('/', (_req: Request, res: Response) => {
  const db = getDb();
  const months = db.prepare('SELECT * FROM months ORDER BY year DESC, month DESC').all();
  res.json(months);
});

router.get('/:year/:month', (req: Request, res: Response) => {
  const db = getDb();
  const year = parseInt(req.params.year);
  const month = parseInt(req.params.month);

  const id = resolveMonthId(db, year, month);
  const record = db.prepare('SELECT * FROM months WHERE id = ?').get(id);
  res.json(record);
});

router.put('/:year/:month', (req: Request, res: Response) => {
  const db = getDb();
  const year = parseInt(req.params.year);
  const month = parseInt(req.params.month);
  // Only `start_balance` (used as opening-balance anchor) and `status` are
  // user-editable. `end_balance` is derived and ignored if sent.
  const { start_balance, status } = req.body as Partial<Month>;

  db.prepare(
    'UPDATE months SET start_balance = COALESCE(?, start_balance), status = COALESCE(?, status) WHERE year = ? AND month = ?'
  ).run(start_balance ?? null, status ?? null, year, month);

  const updated = db.prepare('SELECT * FROM months WHERE year = ? AND month = ?').get(year, month);
  res.json(updated);
});

router.get('/:year/:month/summary', (req: Request, res: Response) => {
  const db = getDb();
  const year = parseInt(req.params.year);
  const month = parseInt(req.params.month);

  const monthRecord = db.prepare('SELECT * FROM months WHERE year = ? AND month = ?').get(year, month) as Month | undefined;
  if (!monthRecord) {
    res.json({ income: 0, expenses: 0, saved: 0, start_balance: 0, end_balance: 0, byCategory: [] });
    return;
  }

  const income = (db.prepare(
    "SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE month_id = ? AND type = 'income'"
  ).get(monthRecord.id) as { total: number }).total;

  const expenses = (db.prepare(
    "SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE month_id = ? AND type = 'expense'"
  ).get(monthRecord.id) as { total: number }).total;

  const byCategory = db.prepare(`
    SELECT c.id as category_id, c.name as category_name, c.display_name, c.type, c.color, COALESCE(SUM(t.amount), 0) as total
    FROM categories c
    LEFT JOIN transactions t ON t.category_id = c.id AND t.month_id = ?
    WHERE c.is_active = 1
    GROUP BY c.id
    ORDER BY c.type, c.sort_order
  `).all(monthRecord.id);

  // Effective budgets for the month: active monthly rows take precedence over
  // active stable rows. Inactive rows of either kind are excluded entirely.
  const budgets = db.prepare(`
    SELECT b.month_id, b.category_id, b.planned, b.is_active,
           c.type as category_type, c.display_name, c.color
    FROM budgets b
    JOIN categories c ON b.category_id = c.id
    WHERE b.month_id = ? AND b.is_active = 1
    UNION ALL
    SELECT NULL as month_id, sb.category_id, sb.planned, sb.is_active,
           c.type as category_type, c.display_name, c.color
    FROM stable_budgets sb
    JOIN categories c ON sb.category_id = c.id
    WHERE sb.is_active = 1
      AND sb.category_id NOT IN (
        SELECT category_id FROM budgets WHERE month_id = ? AND is_active = 1
      )
  `).all(monthRecord.id, monthRecord.id);

  const balances = computeBalances(db, year, month) ?? { start_balance: 0, end_balance: 0 };

  res.json({
    income,
    expenses,
    saved: income - expenses,
    start_balance: balances.start_balance,
    end_balance: balances.end_balance,
    byCategory,
    budgets,
  });
});

router.get('/:year/:month/allocation', (req: Request, res: Response) => {
  const db = getDb();
  const year = parseInt(req.params.year);
  const month = parseInt(req.params.month);

  const monthRecord = db.prepare('SELECT * FROM months WHERE year = ? AND month = ?').get(year, month) as Month | undefined;

  const emptyAllocation = { living_costs: 0, extra_costs: 0, necessary_allowance: 0, allowance_f: 0, difference: 0 };

  if (!monthRecord) {
    res.json({ current: emptyAllocation, previous: emptyAllocation });
    return;
  }

  const prevYear = month === 1 ? year - 1 : year;
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevRecord = db.prepare('SELECT * FROM months WHERE year = ? AND month = ?').get(prevYear, prevMonth) as Month | undefined;

  res.json({
    current: computeAllocation(db, monthRecord.id),
    previous: prevRecord ? computeAllocation(db, prevRecord.id) : emptyAllocation,
  });
});

function computeAllocation(db: ReturnType<typeof getDb>, monthId: number) {
  const placeholders = (arr: string[]) => arr.map(() => '?').join(', ');

  const livingQuery = db.prepare(`
    SELECT COALESCE(SUM(t.amount), 0) as total
    FROM transactions t
    JOIN categories c ON t.category_id = c.id
    WHERE t.month_id = ? AND t.type = 'expense' AND c.name IN (${placeholders(LIVING_CATEGORIES)})
  `);
  const living_costs = (livingQuery.get(monthId, ...LIVING_CATEGORIES) as { total: number }).total;

  const extraQuery = db.prepare(`
    SELECT COALESCE(SUM(t.amount), 0) as total
    FROM transactions t
    JOIN categories c ON t.category_id = c.id
    WHERE t.month_id = ? AND t.type = 'expense' AND c.name IN (${placeholders(EXTRA_CATEGORIES)})
  `);
  const extra_costs = (extraQuery.get(monthId, ...EXTRA_CATEGORIES) as { total: number }).total;

  const allowance_f = (db.prepare(`
    SELECT COALESCE(SUM(t.amount), 0) as total
    FROM transactions t
    JOIN categories c ON t.category_id = c.id
    WHERE t.month_id = ? AND t.type = 'income' AND c.name = 'allowance_f'
  `).get(monthId) as { total: number }).total;

  return {
    living_costs,
    extra_costs,
    necessary_allowance: living_costs,
    allowance_f,
    difference: allowance_f - living_costs,
  };
}

export { computeAllocation };
export default router;

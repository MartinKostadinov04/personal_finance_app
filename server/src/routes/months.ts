import { Router, Request, Response } from 'express';
import { query, one } from '../db/pg';
import { resolveMonthId } from '../db/months';
import { Month } from '../types';

const router = Router();

const LIVING_CATEGORIES = ['groceries', 'home_products', 'rent', 'water_heating', 'electricity', 'phone_internet', 'subscriptions'];
const EXTRA_CATEGORIES = ['transportation', 'restaurants', 'misc_purchases', 'other'];

/**
 * Derive effective start/end balances for a user's month by walking forward from
 * the earliest known month. Returns null if the requested month does not exist.
 */
export async function computeBalances(
  userId: string,
  year: number,
  month: number,
): Promise<{ start_balance: number; end_balance: number } | null> {
  const target = await one<{ id: number }>('SELECT id FROM months WHERE year = $1 AND month = $2 AND user_id = $3', [year, month, userId]);
  if (!target) return null;

  const chain = await query<{ id: number; year: number; month: number; start_balance: number; income: number; expenses: number }>(`
    SELECT m.id, m.year, m.month, m.start_balance,
      COALESCE((SELECT SUM(amount) FROM transactions WHERE month_id = m.id AND type = 'income'),   0) AS income,
      COALESCE((SELECT SUM(amount) FROM transactions WHERE month_id = m.id AND type = 'expense'),  0) AS expenses
    FROM months m
    WHERE m.user_id = $1 AND ((m.year < $2) OR (m.year = $2 AND m.month <= $3))
    ORDER BY m.year ASC, m.month ASC
  `, [userId, year, month]);

  let prevEnd = 0;
  let start = 0;
  let end = 0;
  for (const row of chain) {
    start = row.start_balance !== 0 ? row.start_balance : prevEnd;
    end = start + row.income - row.expenses;
    prevEnd = end;
  }
  return { start_balance: start, end_balance: end };
}

router.get('/', async (req: Request, res: Response) => {
  const userId = req.userId!;
  const months = await query('SELECT * FROM months WHERE user_id = $1 ORDER BY year DESC, month DESC', [userId]);
  res.json(months);
});

router.get('/:year/:month', async (req: Request, res: Response) => {
  const userId = req.userId!;
  const year = parseInt(req.params.year);
  const month = parseInt(req.params.month);

  const id = await resolveMonthId(userId, year, month);
  const record = await one('SELECT * FROM months WHERE id = $1', [id]);
  res.json(record);
});

router.put('/:year/:month', async (req: Request, res: Response) => {
  const userId = req.userId!;
  const year = parseInt(req.params.year);
  const month = parseInt(req.params.month);
  const { start_balance, status } = req.body as Partial<Month>;

  await query(
    'UPDATE months SET start_balance = COALESCE($1, start_balance), status = COALESCE($2, status) WHERE year = $3 AND month = $4 AND user_id = $5',
    [start_balance ?? null, status ?? null, year, month, userId],
  );

  const updated = await one('SELECT * FROM months WHERE year = $1 AND month = $2 AND user_id = $3', [year, month, userId]);
  res.json(updated);
});

router.get('/:year/:month/summary', async (req: Request, res: Response) => {
  const userId = req.userId!;
  const year = parseInt(req.params.year);
  const month = parseInt(req.params.month);

  const monthRecord = await one<Month>('SELECT * FROM months WHERE year = $1 AND month = $2 AND user_id = $3', [year, month, userId]);
  if (!monthRecord) {
    res.json({ income: 0, expenses: 0, saved: 0, start_balance: 0, end_balance: 0, byCategory: [] });
    return;
  }

  const income = (await one<{ total: number }>(
    "SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE month_id = $1 AND type = 'income'", [monthRecord.id],
  ))!.total;

  const expenses = (await one<{ total: number }>(
    "SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE month_id = $1 AND type = 'expense'", [monthRecord.id],
  ))!.total;

  // $1 = month id (already user-scoped), $2 = user id (scopes the full category list).
  const byCategory = await query(`
    SELECT c.id as category_id, c.name as category_name, c.display_name, c.type, c.color,
           COALESCE(SUM(t.amount), 0) as total
    FROM categories c
    LEFT JOIN transactions t ON t.category_id = c.id AND t.month_id = $1 AND t.group_id IS NULL
    WHERE c.user_id = $2
      AND (c.is_active = 1 OR EXISTS (SELECT 1 FROM transactions t2 WHERE t2.category_id = c.id AND t2.month_id = $1 AND t2.group_id IS NULL))
    GROUP BY c.id
    UNION ALL
    SELECT CASE WHEN t.type = 'income' THEN -(g.id + 1000000) ELSE -g.id END as category_id,
           'group:' || g.name as category_name,
           'group:' || g.name as display_name,
           t.type as type, g.color as color, COALESCE(SUM(t.amount), 0) as total
    FROM groups g
    JOIN transactions t ON t.group_id = g.id AND t.month_id = $1
    GROUP BY g.id, t.type
    UNION ALL
    SELECT CASE WHEN t.type = 'income' THEN -1000000 ELSE 0 END as category_id,
           'uncategorized' as category_name, 'Uncategorized' as display_name,
           t.type as type, '#71717a' as color, COALESCE(SUM(t.amount), 0) as total
    FROM transactions t
    WHERE t.month_id = $1 AND t.group_id IS NULL AND t.category_id IS NULL AND t.type IN ('expense', 'income')
    GROUP BY t.type
    ORDER BY type, category_name
  `, [monthRecord.id, userId]);

  const budgets = await query(`
    SELECT b.month_id, b.category_id, b.planned, b.is_active,
           c.type as category_type, c.display_name, c.color
    FROM budgets b
    JOIN categories c ON b.category_id = c.id
    WHERE b.month_id = $1 AND b.is_active = 1
    UNION ALL
    SELECT NULL as month_id, sb.category_id, sb.planned, sb.is_active,
           c.type as category_type, c.display_name, c.color
    FROM stable_budgets sb
    JOIN categories c ON sb.category_id = c.id
    WHERE sb.user_id = $2 AND sb.is_active = 1
      AND sb.category_id NOT IN (
        SELECT category_id FROM budgets WHERE month_id = $1 AND is_active = 1
      )
  `, [monthRecord.id, userId]);

  const balances = (await computeBalances(userId, year, month)) ?? { start_balance: 0, end_balance: 0 };

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

router.get('/:year/:month/allocation', async (req: Request, res: Response) => {
  const userId = req.userId!;
  const year = parseInt(req.params.year);
  const month = parseInt(req.params.month);

  const monthRecord = await one<Month>('SELECT * FROM months WHERE year = $1 AND month = $2 AND user_id = $3', [year, month, userId]);

  const emptyAllocation = { living_costs: 0, extra_costs: 0, necessary_allowance: 0, allowance_f: 0, difference: 0 };

  if (!monthRecord) {
    res.json({ current: emptyAllocation, previous: emptyAllocation });
    return;
  }

  const prevYear = month === 1 ? year - 1 : year;
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevRecord = await one<Month>('SELECT * FROM months WHERE year = $1 AND month = $2 AND user_id = $3', [prevYear, prevMonth, userId]);

  res.json({
    current: await computeAllocation(monthRecord.id),
    previous: prevRecord ? await computeAllocation(prevRecord.id) : emptyAllocation,
  });
});

// monthId is already user-scoped (a month belongs to one user), so the
// transactions/categories joined here are implicitly the user's.
async function computeAllocation(monthId: number) {
  const inList = (arr: string[]) => arr.map((_, i) => `$${i + 2}`).join(', ');

  const living_costs = (await one<{ total: number }>(`
    SELECT COALESCE(SUM(t.amount), 0) as total
    FROM transactions t
    JOIN categories c ON t.category_id = c.id
    WHERE t.month_id = $1 AND t.type = 'expense' AND c.name IN (${inList(LIVING_CATEGORIES)})
  `, [monthId, ...LIVING_CATEGORIES]))!.total;

  const extra_costs = (await one<{ total: number }>(`
    SELECT COALESCE(SUM(t.amount), 0) as total
    FROM transactions t
    JOIN categories c ON t.category_id = c.id
    WHERE t.month_id = $1 AND t.type = 'expense' AND c.name IN (${inList(EXTRA_CATEGORIES)})
  `, [monthId, ...EXTRA_CATEGORIES]))!.total;

  const allowance_f = (await one<{ total: number }>(`
    SELECT COALESCE(SUM(t.amount), 0) as total
    FROM transactions t
    JOIN categories c ON t.category_id = c.id
    WHERE t.month_id = $1 AND t.type = 'income' AND c.name = 'allowance_f'
  `, [monthId]))!.total;

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

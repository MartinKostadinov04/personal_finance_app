import { Router, Request, Response } from 'express';
import { query, one } from '../db/pg';
import { parseIntStrict } from '../lib/http';

const router = Router();

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// GET /api/analytics/trend?fromYear=&fromMonth=&toYear=&toMonth=
router.get('/trend', async (req: Request, res: Response) => {
  const userId = req.userId!;
  const fy = req.query.fromYear  ? parseIntStrict(req.query.fromYear  as string, 'fromYear',  { min: 1970, max: 9999 }) : null;
  const fm = req.query.fromMonth ? parseIntStrict(req.query.fromMonth as string, 'fromMonth', { min: 1, max: 12 })    : null;
  const ty = req.query.toYear    ? parseIntStrict(req.query.toYear    as string, 'toYear',    { min: 1970, max: 9999 }) : null;
  const tm = req.query.toMonth   ? parseIntStrict(req.query.toMonth   as string, 'toMonth',   { min: 1, max: 12 })    : null;

  const allMonths = await query<{ id: number; year: number; month: number }>(
    'SELECT * FROM months WHERE user_id = $1 ORDER BY year ASC, month ASC', [userId],
  );

  const months = allMonths.filter(m => {
    const after  = fy === null || (m.year > fy) || (m.year === fy && m.month >= (fm ?? 1));
    const before = ty === null || (m.year < ty) || (m.year === ty && m.month <= (tm ?? 12));
    return after && before;
  });

  const sumFor = async (monthId: number, type: 'income' | 'expense') =>
    (await one<{ total: number }>(
      "SELECT COALESCE(SUM(amount),0) as total FROM transactions WHERE month_id = $1 AND type = $2",
      [monthId, type],
    ))!.total;

  const result = (await Promise.all(months.map(async m => {
    const income   = await sumFor(m.id, 'income');
    const expenses = await sumFor(m.id, 'expense');
    return {
      label: `${MONTH_NAMES[m.month - 1]} '${String(m.year).slice(2)}`,
      year: m.year,
      month: m.month,
      income,
      expenses,
      saved: income - expenses,
    };
  }))).filter(m => m.income > 0 || m.expenses > 0);

  res.json(result);
});

// GET /api/analytics/daily?year=&month=
router.get('/daily', async (req: Request, res: Response) => {
  const userId = req.userId!;
  const year  = parseIntStrict(req.query.year  as string, 'year',  { min: 1970, max: 9999 });
  const month = parseIntStrict(req.query.month as string, 'month', { min: 1, max: 12 });

  const prevYear  = month === 1 ? year - 1 : year;
  const prevMonth = month === 1 ? 12 : month - 1;

  const getRecord = (y: number, m: number) =>
    one<{ id: number }>('SELECT id FROM months WHERE year = $1 AND month = $2 AND user_id = $3', [y, m, userId]);

  const getDailyExpenses = (monthId: number) =>
    query<{ date: string; amount: number }>(`
      SELECT date, SUM(amount) as amount
      FROM transactions
      WHERE month_id = $1 AND type = 'expense'
      GROUP BY date
      ORDER BY date ASC
    `, [monthId]);

  const cur  = await getRecord(year, month);
  const prev = await getRecord(prevYear, prevMonth);

  res.json({
    current:  cur  ? await getDailyExpenses(cur.id)  : [],
    previous: prev ? await getDailyExpenses(prev.id) : [],
  });
});

export default router;

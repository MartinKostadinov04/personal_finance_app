import { Router, Request, Response } from 'express';
import { getDb } from '../db/index';

const router = Router();

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// GET /api/analytics/trend?fromYear=&fromMonth=&toYear=&toMonth=
// Returns per-month income/expenses/saved, optionally filtered to a date range.
// All four params are optional; omitting them returns all months with data.
router.get('/trend', (req: Request, res: Response) => {
  const db = getDb();

  const fy = req.query.fromYear  ? parseInt(req.query.fromYear  as string) : null;
  const fm = req.query.fromMonth ? parseInt(req.query.fromMonth as string) : null;
  const ty = req.query.toYear    ? parseInt(req.query.toYear    as string) : null;
  const tm = req.query.toMonth   ? parseInt(req.query.toMonth   as string) : null;

  const allMonths = db.prepare(
    'SELECT * FROM months ORDER BY year ASC, month ASC'
  ).all() as { id: number; year: number; month: number }[];

  const months = allMonths.filter(m => {
    const after  = fy === null || (m.year > fy) || (m.year === fy && m.month >= (fm ?? 1));
    const before = ty === null || (m.year < ty) || (m.year === ty && m.month <= (tm ?? 12));
    return after && before;
  });

  const incomeStmt  = db.prepare("SELECT COALESCE(SUM(amount),0) as total FROM transactions WHERE month_id=? AND type='income'");
  const expenseStmt = db.prepare("SELECT COALESCE(SUM(amount),0) as total FROM transactions WHERE month_id=? AND type='expense'");

  const result = months
    .map(m => {
      const income   = (incomeStmt.get(m.id)  as { total: number }).total;
      const expenses = (expenseStmt.get(m.id) as { total: number }).total;
      return {
        label: `${MONTH_NAMES[m.month - 1]} '${String(m.year).slice(2)}`,
        year: m.year,
        month: m.month,
        income,
        expenses,
        saved: income - expenses,
      };
    })
    .filter(m => m.income > 0 || m.expenses > 0);

  res.json(result);
});

// GET /api/analytics/daily?year=&month=
// Returns daily expense totals for the selected month and its predecessor
router.get('/daily', (req: Request, res: Response) => {
  const db = getDb();
  const year  = parseInt(req.query.year  as string);
  const month = parseInt(req.query.month as string);

  const prevYear  = month === 1 ? year - 1 : year;
  const prevMonth = month === 1 ? 12 : month - 1;

  const getRecord = (y: number, m: number) =>
    db.prepare('SELECT id FROM months WHERE year=? AND month=?').get(y, m) as { id: number } | undefined;

  const getDailyExpenses = (monthId: number) =>
    db.prepare(`
      SELECT date, SUM(amount) as amount
      FROM transactions
      WHERE month_id=? AND type='expense'
      GROUP BY date
      ORDER BY date ASC
    `).all(monthId) as { date: string; amount: number }[];

  const cur  = getRecord(year, month);
  const prev = getRecord(prevYear, prevMonth);

  res.json({
    current:  cur  ? getDailyExpenses(cur.id)  : [],
    previous: prev ? getDailyExpenses(prev.id) : [],
  });
});

export default router;

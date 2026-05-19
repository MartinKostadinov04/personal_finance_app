import { Router, Request, Response } from 'express';
import { getDb } from '../db/index';
import { Month } from '../types';

const router = Router();

router.get('/', (req: Request, res: Response) => {
  const db = getDb();
  const { monthId } = req.query as { monthId?: string };

  if (!monthId) {
    res.status(400).json({ error: 'monthId is required' });
    return;
  }

  const budgets = db.prepare(`
    SELECT b.id, b.month_id, b.category_id, b.planned, b.is_active,
           c.display_name, c.name as category_name, c.type as category_type, c.color
    FROM budgets b
    JOIN categories c ON b.category_id = c.id
    WHERE b.month_id = ?
  `).all(parseInt(monthId));

  res.json(budgets);
});

router.put('/', (req: Request, res: Response) => {
  const db = getDb();
  const { month_id, category_id, planned, is_active } = req.body as {
    month_id: number; category_id: number; planned: number; is_active?: 0 | 1 | boolean;
  };

  if (!month_id || !category_id || planned === undefined) {
    res.status(400).json({ error: 'month_id, category_id, and planned are required' });
    return;
  }

  const active = is_active === undefined ? 1 : (is_active ? 1 : 0);

  db.prepare(`
    INSERT INTO budgets (month_id, category_id, planned, is_active)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(month_id, category_id) DO UPDATE SET
      planned   = excluded.planned,
      is_active = excluded.is_active
  `).run(month_id, category_id, planned, active);

  const budget = db.prepare('SELECT * FROM budgets WHERE month_id = ? AND category_id = ?').get(month_id, category_id);
  res.json(budget);
});

router.post('/copy-from-previous', (req: Request, res: Response) => {
  const db = getDb();
  const { month_id } = req.body as { month_id: number };

  if (!month_id) {
    res.status(400).json({ error: 'month_id is required' });
    return;
  }

  const currentMonth = db.prepare('SELECT * FROM months WHERE id = ?').get(month_id) as Month | undefined;
  if (!currentMonth) {
    res.status(404).json({ error: 'Month not found' });
    return;
  }

  const prevYear = currentMonth.month === 1 ? currentMonth.year - 1 : currentMonth.year;
  const prevMonth = currentMonth.month === 1 ? 12 : currentMonth.month - 1;
  const prevRecord = db.prepare('SELECT * FROM months WHERE year = ? AND month = ?').get(prevYear, prevMonth) as Month | undefined;

  if (!prevRecord) {
    res.status(404).json({ error: 'No previous month found' });
    return;
  }

  const prevBudgets = db.prepare('SELECT * FROM budgets WHERE month_id = ?').all(prevRecord.id) as Array<{ category_id: number; planned: number; is_active: number }>;

  const upsert = db.prepare(`
    INSERT INTO budgets (month_id, category_id, planned, is_active)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(month_id, category_id) DO UPDATE SET
      planned   = excluded.planned,
      is_active = excluded.is_active
  `);

  const copyAll = db.transaction(() => {
    for (const b of prevBudgets) {
      upsert.run(month_id, b.category_id, b.planned, b.is_active ?? 1);
    }
  });

  copyAll();
  res.json({ copied: prevBudgets.length });
});

export default router;

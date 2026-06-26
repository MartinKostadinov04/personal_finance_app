import { Router, Request, Response } from 'express';
import { query, one, withTx } from '../db/pg';
import { userOwnsMonth, userOwnsCategory } from '../db/ownership';
import { Month } from '../types';

const router = Router();

router.get('/', async (req: Request, res: Response) => {
  const userId = req.userId!;
  const { monthId } = req.query as { monthId?: string };

  if (!monthId) {
    res.status(400).json({ error: 'monthId is required' });
    return;
  }

  const budgets = await query(`
    SELECT b.id, b.month_id, b.category_id, b.planned, b.is_active,
           c.display_name, c.name as category_name, c.type as category_type, c.color
    FROM budgets b
    JOIN categories c ON b.category_id = c.id
    WHERE b.month_id = $1 AND b.user_id = $2
  `, [parseInt(monthId), userId]);

  res.json(budgets);
});

router.put('/', async (req: Request, res: Response) => {
  const userId = req.userId!;
  const { month_id, category_id, planned, is_active } = req.body as {
    month_id: number; category_id: number; planned: number; is_active?: 0 | 1 | boolean;
  };

  if (!month_id || !category_id || planned === undefined) {
    res.status(400).json({ error: 'month_id, category_id, and planned are required' });
    return;
  }

  // Validate ownership of both FKs: the budgets unique key is (month_id, category_id),
  // so an unvalidated foreign month_id could overwrite another user's budget via upsert.
  if (!(await userOwnsMonth(userId, month_id))) {
    res.status(404).json({ error: 'Month not found' });
    return;
  }
  if (!(await userOwnsCategory(userId, category_id))) {
    res.status(404).json({ error: 'Category not found' });
    return;
  }

  const active = is_active === undefined ? 1 : (is_active ? 1 : 0);

  await query(`
    INSERT INTO budgets (user_id, month_id, category_id, planned, is_active)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (month_id, category_id) DO UPDATE SET
      planned   = EXCLUDED.planned,
      is_active = EXCLUDED.is_active
  `, [userId, month_id, category_id, planned, active]);

  const budget = await one('SELECT * FROM budgets WHERE month_id = $1 AND category_id = $2 AND user_id = $3', [month_id, category_id, userId]);
  res.json(budget);
});

router.post('/copy-from-previous', async (req: Request, res: Response) => {
  const userId = req.userId!;
  const { month_id } = req.body as { month_id: number };

  if (!month_id) {
    res.status(400).json({ error: 'month_id is required' });
    return;
  }

  const currentMonth = await one<Month>('SELECT * FROM months WHERE id = $1 AND user_id = $2', [month_id, userId]);
  if (!currentMonth) {
    res.status(404).json({ error: 'Month not found' });
    return;
  }

  const prevYear = currentMonth.month === 1 ? currentMonth.year - 1 : currentMonth.year;
  const prevMonth = currentMonth.month === 1 ? 12 : currentMonth.month - 1;
  const prevRecord = await one<Month>('SELECT * FROM months WHERE year = $1 AND month = $2 AND user_id = $3', [prevYear, prevMonth, userId]);

  if (!prevRecord) {
    res.status(404).json({ error: 'No previous month found' });
    return;
  }

  const prevBudgets = await query<{ category_id: number; planned: number; is_active: number }>(
    'SELECT * FROM budgets WHERE month_id = $1 AND user_id = $2', [prevRecord.id, userId],
  );

  await withTx(async (client) => {
    for (const b of prevBudgets) {
      await client.query(`
        INSERT INTO budgets (user_id, month_id, category_id, planned, is_active)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (month_id, category_id) DO UPDATE SET
          planned   = EXCLUDED.planned,
          is_active = EXCLUDED.is_active
      `, [userId, month_id, b.category_id, b.planned, b.is_active ?? 1]);
    }
  });

  res.json({ copied: prevBudgets.length });
});

export default router;

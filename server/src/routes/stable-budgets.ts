import { Router, Request, Response } from 'express';
import { query, one } from '../db/pg';
import { parseId } from '../lib/http';

const router = Router();

// GET /api/stable-budgets — all stable (cross-month) budget rows for the user.
router.get('/', async (req: Request, res: Response) => {
  const userId = req.userId!;
  const rows = await query(`
    SELECT sb.id, sb.category_id, sb.planned, sb.is_active,
           c.display_name, c.name as category_name, c.type as category_type, c.color
    FROM stable_budgets sb
    JOIN categories c ON sb.category_id = c.id
    WHERE sb.user_id = $1
  `, [userId]);
  res.json(rows);
});

// PUT /api/stable-budgets — upsert by category_id.
router.put('/', async (req: Request, res: Response) => {
  const userId = req.userId!;
  const { category_id, planned, is_active } = req.body as {
    category_id: number; planned: number; is_active?: 0 | 1 | boolean;
  };

  if (!category_id || planned === undefined) {
    res.status(400).json({ error: 'category_id and planned are required' });
    return;
  }

  const active = is_active === undefined ? 1 : (is_active ? 1 : 0);

  await query(`
    INSERT INTO stable_budgets (user_id, category_id, planned, is_active)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (user_id, category_id) DO UPDATE SET
      planned   = EXCLUDED.planned,
      is_active = EXCLUDED.is_active
  `, [userId, category_id, planned, active]);

  const row = await one('SELECT * FROM stable_budgets WHERE category_id = $1 AND user_id = $2', [category_id, userId]);
  res.json(row);
});

// DELETE /api/stable-budgets/:categoryId
router.delete('/:categoryId', async (req: Request, res: Response) => {
  const userId = req.userId!;
  const categoryId = parseId(req.params.categoryId, 'category id');
  await query('DELETE FROM stable_budgets WHERE category_id = $1 AND user_id = $2', [categoryId, userId]);
  res.json({ success: true });
});

export default router;

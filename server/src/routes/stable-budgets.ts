import { Router, Request, Response } from 'express';
import { getDb } from '../db/index';

const router = Router();

// GET /api/stable-budgets — all stable (cross-month) budget rows, joined with category info.
router.get('/', (_req: Request, res: Response) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT sb.id, sb.category_id, sb.planned, sb.is_active,
           c.display_name, c.name as category_name, c.type as category_type, c.color
    FROM stable_budgets sb
    JOIN categories c ON sb.category_id = c.id
  `).all();
  res.json(rows);
});

// PUT /api/stable-budgets — upsert by category_id.
router.put('/', (req: Request, res: Response) => {
  const db = getDb();
  const { category_id, planned, is_active } = req.body as {
    category_id: number; planned: number; is_active?: 0 | 1 | boolean;
  };

  if (!category_id || planned === undefined) {
    res.status(400).json({ error: 'category_id and planned are required' });
    return;
  }

  const active = is_active === undefined ? 1 : (is_active ? 1 : 0);

  db.prepare(`
    INSERT INTO stable_budgets (category_id, planned, is_active)
    VALUES (?, ?, ?)
    ON CONFLICT(category_id) DO UPDATE SET
      planned   = excluded.planned,
      is_active = excluded.is_active
  `).run(category_id, planned, active);

  const row = db.prepare('SELECT * FROM stable_budgets WHERE category_id = ?').get(category_id);
  res.json(row);
});

// DELETE /api/stable-budgets/:categoryId
router.delete('/:categoryId', (req: Request, res: Response) => {
  const db = getDb();
  const categoryId = parseInt(req.params.categoryId);
  db.prepare('DELETE FROM stable_budgets WHERE category_id = ?').run(categoryId);
  res.json({ success: true });
});

export default router;

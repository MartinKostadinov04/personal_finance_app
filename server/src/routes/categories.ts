import { Router, Request, Response } from 'express';
import { query, one, withTx } from '../db/pg';
import { Category } from '../types';

const router = Router();

router.get('/', async (req: Request, res: Response) => {
  const userId = req.userId!;
  const categories = await query(`
    SELECT c.*, (SELECT COUNT(*) FROM transactions t WHERE t.category_id = c.id AND t.user_id = $1) AS tx_count
    FROM categories c
    WHERE c.user_id = $1
    ORDER BY c.type, c.sort_order
  `, [userId]);
  res.json(categories);
});

router.post('/', async (req: Request, res: Response) => {
  const userId = req.userId!;
  const { name, display_name, type, color, sort_order } = req.body as Partial<Category>;

  if (!name || !display_name || !type) {
    res.status(400).json({ error: 'name, display_name, and type are required' });
    return;
  }

  try {
    const created = await one(
      'INSERT INTO categories (user_id, name, display_name, type, color, sort_order) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [userId, name, display_name, type, color ?? '#71717a', sort_order ?? 0],
    );
    res.status(201).json(created);
  } catch (err: unknown) {
    const e = err as { code?: string; message?: string };
    if (e.code === '23505') {
      res.status(409).json({ error: 'Category name already exists' });
    } else {
      res.status(500).json({ error: e.message ?? String(err) });
    }
  }
});

router.put('/:id', async (req: Request, res: Response) => {
  const userId = req.userId!;
  const id = parseInt(req.params.id);
  const { display_name, color, is_active, sort_order } = req.body as Partial<Category>;

  await query(
    `UPDATE categories SET
       display_name = COALESCE($1, display_name),
       color        = COALESCE($2, color),
       is_active    = COALESCE($3, is_active),
       sort_order   = COALESCE($4, sort_order)
     WHERE id = $5 AND user_id = $6`,
    [display_name ?? null, color ?? null, is_active ?? null, sort_order ?? null, id, userId],
  );

  const updated = await one('SELECT * FROM categories WHERE id = $1 AND user_id = $2', [id, userId]);
  res.json(updated);
});

router.delete('/:id', async (req: Request, res: Response) => {
  const userId = req.userId!;
  const id = parseInt(req.params.id);

  // Reassign the category's transactions to Uncategorized, then remove every
  // reference (budgets, stable budgets, rules) so the FK-constrained delete can
  // succeed — all atomically, all scoped to this user.
  const removed = (await one<{ c: number }>(
    'SELECT COUNT(*)::int AS c FROM transactions WHERE category_id = $1 AND user_id = $2', [id, userId],
  ))!.c;
  await withTx(async (client) => {
    await client.query('UPDATE transactions SET category_id = NULL WHERE category_id = $1 AND user_id = $2', [id, userId]);
    await client.query('DELETE FROM budgets WHERE category_id = $1 AND user_id = $2', [id, userId]);
    await client.query('DELETE FROM stable_budgets WHERE category_id = $1 AND user_id = $2', [id, userId]);
    await client.query('UPDATE merchant_rules SET category_id = NULL WHERE category_id = $1 AND user_id = $2', [id, userId]);
    await client.query('DELETE FROM categories WHERE id = $1 AND user_id = $2', [id, userId]);
  });

  res.json({ success: true, reassigned: removed });
});

export default router;

import { Router, Request, Response } from 'express';
import { query, one } from '../db/pg';
import { parseId } from '../lib/http';

const router = Router();

// GET /api/merchant-rules — the user's rules joined with category info
router.get('/', async (req: Request, res: Response) => {
  const userId = req.userId!;
  const rules = await query(`
    SELECT mr.*, c.display_name as category_display_name, c.color as category_color, c.type as category_type
    FROM merchant_rules mr
    LEFT JOIN categories c ON mr.category_id = c.id
    WHERE mr.user_id = $1
    ORDER BY mr.created_at DESC
  `, [userId]);
  res.json(rules);
});

// POST /api/merchant-rules — create a new rule
router.post('/', async (req: Request, res: Response) => {
  const userId = req.userId!;
  const { pattern, category_id, description_clean, match_amount, match_type = 'contains' } = req.body as {
    pattern: string;
    category_id: number;
    description_clean?: string;
    match_amount?: number | null;
    match_type?: 'contains' | 'regex';
  };

  if (!pattern || !category_id) {
    res.status(400).json({ error: 'pattern and category_id are required' });
    return;
  }

  try {
    const created = await one(`
      WITH ins AS (
        INSERT INTO merchant_rules (user_id, pattern, category_id, description_clean, match_amount, match_type)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      )
      SELECT ins.*, c.display_name as category_display_name, c.color as category_color, c.type as category_type
      FROM ins LEFT JOIN categories c ON ins.category_id = c.id
    `, [userId, pattern.trim(), category_id, description_clean?.trim() ?? null, match_amount ?? null, match_type]);

    res.status(201).json(created);
  } catch (err: unknown) {
    const e = err as { code?: string; message?: string };
    if (e.code === '23505') {
      res.status(409).json({ error: 'A rule with this pattern already exists' });
    } else {
      res.status(500).json({ error: e.message ?? String(err) });
    }
  }
});

// PUT /api/merchant-rules/:id — update an existing rule
router.put('/:id', async (req: Request, res: Response) => {
  const userId = req.userId!;
  const id = parseId(req.params.id);
  const { pattern, category_id, description_clean, match_amount, match_type } = req.body as {
    pattern?: string;
    category_id?: number;
    description_clean?: string;
    match_amount?: number | null;
    match_type?: 'contains' | 'regex';
  };

  try {
    const updated = await one(`
      WITH upd AS (
        UPDATE merchant_rules SET
          pattern           = $1,
          category_id       = $2,
          description_clean = COALESCE($3, description_clean),
          match_amount      = $4,
          match_type        = $5
        WHERE id = $6 AND user_id = $7
        RETURNING *
      )
      SELECT upd.*, c.display_name as category_display_name, c.color as category_color, c.type as category_type
      FROM upd LEFT JOIN categories c ON upd.category_id = c.id
    `, [
      pattern?.trim() ?? null,
      category_id ?? null,
      description_clean?.trim() ?? null,
      match_amount ?? null,
      match_type ?? 'contains',
      id,
      userId,
    ]);

    res.json(updated);
  } catch (err: unknown) {
    const e = err as { code?: string; message?: string };
    if (e.code === '23505') {
      res.status(409).json({ error: 'A rule with this pattern already exists' });
    } else {
      throw err;
    }
  }
});

// DELETE /api/merchant-rules/:id
router.delete('/:id', async (req: Request, res: Response) => {
  const userId = req.userId!;
  await query('DELETE FROM merchant_rules WHERE id = $1 AND user_id = $2', [parseId(req.params.id), userId]);
  res.json({ success: true });
});

export default router;

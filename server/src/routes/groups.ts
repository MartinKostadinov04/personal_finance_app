import { Router, Request, Response } from 'express';
import { query, one, withTx } from '../db/pg';

const router = Router();

// Only expense/income transactions may belong to a group.
const GROUPABLE_TYPES = "('expense', 'income')";

interface RangeBody {
  fromDate: string; // YYYY-MM-DD
  toDate: string;   // YYYY-MM-DD
}

// GET /api/groups — the user's groups with member counts and last-used date.
router.get('/', async (req: Request, res: Response) => {
  const userId = req.userId!;
  const since = typeof req.query.since === 'string' ? req.query.since : null;
  const params: unknown[] = [userId];
  if (since) params.push(since);
  const groups = await query(`
    SELECT g.*, COUNT(t.id) as member_count, MAX(t.date) as last_used
    FROM groups g
    LEFT JOIN transactions t ON t.group_id = g.id AND t.user_id = g.user_id
    WHERE g.user_id = $1
    GROUP BY g.id
    ${since ? 'HAVING MAX(t.date) >= $2' : ''}
    ORDER BY g.created_at DESC
  `, params);
  res.json(groups);
});

// POST /api/groups — create a group, optionally seeding members by ids or date range
router.post('/', async (req: Request, res: Response) => {
  const userId = req.userId!;
  const { name, color, memberIds, range } = req.body as {
    name?: string;
    color?: string;
    memberIds?: number[];
    range?: RangeBody;
  };

  if (!name || !name.trim()) {
    res.status(400).json({ error: 'name is required' });
    return;
  }

  try {
    const created = await withTx(async (client) => {
      const ins = await client.query('INSERT INTO groups (user_id, name, color) VALUES ($1, $2, $3) RETURNING id', [userId, name.trim(), color ?? '#71717a']);
      const groupId = ins.rows[0].id as number;

      if (Array.isArray(memberIds) && memberIds.length > 0) {
        const placeholders = memberIds.map((_, i) => `$${i + 3}`).join(', ');
        await client.query(
          `UPDATE transactions SET group_id = $1 WHERE user_id = $2 AND id IN (${placeholders}) AND type IN ${GROUPABLE_TYPES}`,
          [groupId, userId, ...memberIds],
        );
      }

      if (range) {
        const [lo, hi] = range.fromDate <= range.toDate
          ? [range.fromDate, range.toDate]
          : [range.toDate, range.fromDate];
        await client.query(
          `UPDATE transactions SET group_id = $1 WHERE user_id = $2 AND date >= $3 AND date <= $4 AND type IN ${GROUPABLE_TYPES}`,
          [groupId, userId, lo, hi],
        );
      }

      const r = await client.query(`
        SELECT g.*, COUNT(t.id) as member_count
        FROM groups g
        LEFT JOIN transactions t ON t.group_id = g.id AND t.user_id = g.user_id
        WHERE g.id = $1
        GROUP BY g.id
      `, [groupId]);
      return r.rows[0];
    });

    res.status(201).json(created);
  } catch (err: unknown) {
    const e = err as { code?: string; message?: string };
    if (e.code === '23505') {
      res.status(409).json({ error: 'A group with that name already exists' });
    } else {
      res.status(500).json({ error: e.message ?? String(err) });
    }
  }
});

// PATCH /api/groups/:id — rename / recolor
router.patch('/:id', async (req: Request, res: Response) => {
  const userId = req.userId!;
  const id = parseInt(req.params.id);
  const { name, color } = req.body as { name?: string; color?: string };

  try {
    const updated = await one(
      'UPDATE groups SET name = COALESCE($1, name), color = COALESCE($2, color) WHERE id = $3 AND user_id = $4 RETURNING *',
      [name?.trim() ?? null, color ?? null, id, userId],
    );
    res.json(updated);
  } catch (err: unknown) {
    const e = err as { code?: string; message?: string };
    if (e.code === '23505') {
      res.status(409).json({ error: 'A group with that name already exists' });
    } else {
      res.status(500).json({ error: e.message ?? String(err) });
    }
  }
});

// DELETE /api/groups/:id — FK ON DELETE SET NULL ungroups members automatically
router.delete('/:id', async (req: Request, res: Response) => {
  const userId = req.userId!;
  await query('DELETE FROM groups WHERE id = $1 AND user_id = $2', [parseInt(req.params.id), userId]);
  res.json({ success: true });
});

// POST /api/groups/:id/members — add and/or remove members
router.post('/:id/members', async (req: Request, res: Response) => {
  const userId = req.userId!;
  const id = parseInt(req.params.id);
  const { add, remove } = req.body as { add?: number[]; remove?: number[] };

  await withTx(async (client) => {
    if (Array.isArray(add) && add.length > 0) {
      const placeholders = add.map((_, i) => `$${i + 3}`).join(', ');
      await client.query(
        `UPDATE transactions SET group_id = $1 WHERE user_id = $2 AND id IN (${placeholders}) AND type IN ${GROUPABLE_TYPES}`,
        [id, userId, ...add],
      );
    }
    if (Array.isArray(remove) && remove.length > 0) {
      const placeholders = remove.map((_, i) => `$${i + 2}`).join(', ');
      await client.query(
        `UPDATE transactions SET group_id = NULL WHERE user_id = $1 AND id IN (${placeholders}) AND group_id = $${remove.length + 2}`,
        [userId, ...remove, id],
      );
    }
  });

  res.json({ success: true });
});

export default router;

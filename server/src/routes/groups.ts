import { Router, Request, Response } from 'express';
import { getDb } from '../db/index';

const router = Router();

// Only expense/income transactions may belong to a group (transfers aren't imported,
// but guard anyway so the income/expense net math and analytics stay clean).
const GROUPABLE_TYPES = "('expense', 'income')";

interface RangeBody {
  fromYear: number; fromMonth: number;
  toYear: number;   toMonth: number;
}

function monthIdsInRange(db: ReturnType<typeof getDb>, r: RangeBody): number[] {
  const from = r.fromYear * 100 + r.fromMonth;
  const to   = r.toYear   * 100 + r.toMonth;
  const [lo, hi] = from <= to ? [from, to] : [to, from];
  const rows = db.prepare('SELECT id, year, month FROM months').all() as Array<{ id: number; year: number; month: number }>;
  return rows.filter(m => {
    const k = m.year * 100 + m.month;
    return k >= lo && k <= hi;
  }).map(m => m.id);
}

// GET /api/groups — all groups with member counts
router.get('/', (_req: Request, res: Response) => {
  const db = getDb();
  const groups = db.prepare(`
    SELECT g.*, COUNT(t.id) as member_count
    FROM groups g
    LEFT JOIN transactions t ON t.group_id = g.id
    GROUP BY g.id
    ORDER BY g.created_at DESC
  `).all();
  res.json(groups);
});

// POST /api/groups — create a group, optionally seeding members by ids or date range
router.post('/', (req: Request, res: Response) => {
  const db = getDb();
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
    const created = db.transaction(() => {
      const result = db.prepare('INSERT INTO groups (name, color) VALUES (?, ?)')
        .run(name.trim(), color ?? '#71717a');
      const groupId = Number(result.lastInsertRowid);

      if (Array.isArray(memberIds) && memberIds.length > 0) {
        const placeholders = memberIds.map(() => '?').join(', ');
        db.prepare(
          `UPDATE transactions SET group_id = ? WHERE id IN (${placeholders}) AND type IN ${GROUPABLE_TYPES}`
        ).run(groupId, ...memberIds);
      }

      if (range) {
        const monthIds = monthIdsInRange(db, range);
        if (monthIds.length > 0) {
          const placeholders = monthIds.map(() => '?').join(', ');
          db.prepare(
            `UPDATE transactions SET group_id = ? WHERE month_id IN (${placeholders}) AND type IN ${GROUPABLE_TYPES}`
          ).run(groupId, ...monthIds);
        }
      }

      return db.prepare(`
        SELECT g.*, COUNT(t.id) as member_count
        FROM groups g
        LEFT JOIN transactions t ON t.group_id = g.id
        WHERE g.id = ?
        GROUP BY g.id
      `).get(groupId);
    })();

    res.status(201).json(created);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('UNIQUE')) {
      res.status(409).json({ error: 'A group with that name already exists' });
    } else {
      res.status(500).json({ error: msg });
    }
  }
});

// PATCH /api/groups/:id — rename / recolor
router.patch('/:id', (req: Request, res: Response) => {
  const db = getDb();
  const id = parseInt(req.params.id);
  const { name, color } = req.body as { name?: string; color?: string };

  try {
    db.prepare('UPDATE groups SET name = COALESCE(?, name), color = COALESCE(?, color) WHERE id = ?')
      .run(name?.trim() ?? null, color ?? null, id);
    const updated = db.prepare('SELECT * FROM groups WHERE id = ?').get(id);
    res.json(updated);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('UNIQUE')) {
      res.status(409).json({ error: 'A group with that name already exists' });
    } else {
      res.status(500).json({ error: msg });
    }
  }
});

// DELETE /api/groups/:id — FK ON DELETE SET NULL ungroups members automatically
router.delete('/:id', (req: Request, res: Response) => {
  const db = getDb();
  db.prepare('DELETE FROM groups WHERE id = ?').run(parseInt(req.params.id));
  res.json({ success: true });
});

// POST /api/groups/:id/members — add and/or remove members
router.post('/:id/members', (req: Request, res: Response) => {
  const db = getDb();
  const id = parseInt(req.params.id);
  const { add, remove } = req.body as { add?: number[]; remove?: number[] };

  db.transaction(() => {
    if (Array.isArray(add) && add.length > 0) {
      const placeholders = add.map(() => '?').join(', ');
      db.prepare(
        `UPDATE transactions SET group_id = ? WHERE id IN (${placeholders}) AND type IN ${GROUPABLE_TYPES}`
      ).run(id, ...add);
    }
    if (Array.isArray(remove) && remove.length > 0) {
      const placeholders = remove.map(() => '?').join(', ');
      db.prepare(
        `UPDATE transactions SET group_id = NULL WHERE id IN (${placeholders}) AND group_id = ?`
      ).run(...remove, id);
    }
  })();

  res.json({ success: true });
});

export default router;

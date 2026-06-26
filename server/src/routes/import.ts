import { Router, Request, Response } from 'express';
import multer from 'multer';
import type { Pool, PoolClient } from 'pg';
import { getPool, withTx } from '../db/pg';
import { resolveMonthId } from '../db/months';
import { parseRevolut } from '../parsers/revolut';
import { parseSantander } from '../parsers/santander';
import { parseFibank } from '../parsers/fibank';
import { categorize } from '../categorizer';
import { CategorizedTransaction } from '../types';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

router.post('/parse', upload.single('file'), async (req: Request, res: Response) => {
  const userId = req.userId!;
  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded' });
    return;
  }

  const bank = req.body.bank as string;
  if (!bank || !['revolut', 'santander', 'fibank'].includes(bank)) {
    res.status(400).json({ error: 'bank must be revolut, santander, or fibank' });
    return;
  }

  try {
    let rawTransactions;

    if (bank === 'revolut') {
      rawTransactions = parseRevolut(req.file.buffer.toString('utf-8'));
    } else if (bank === 'santander') {
      rawTransactions = parseSantander(req.file.buffer);
    } else {
      rawTransactions = parseFibank(req.file.buffer);
    }

    const categorized = await categorize(rawTransactions, userId);
    res.json({ transactions: categorized, count: categorized.length });
  } catch (err) {
    console.error('Parse error:', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Parse failed' });
  }
});

// Duplicate check: month_id + date + amount (±0.005) + raw_description, scoped to user.
async function isDuplicate(
  db: Pool | PoolClient,
  userId: string,
  monthId: number,
  date: string,
  amount: number,
  rawDescription: string,
): Promise<boolean> {
  const r = await db.query(`
    SELECT 1 FROM transactions
    WHERE user_id = $1
      AND month_id = $2
      AND date = $3
      AND ABS(amount - $4) < 0.005
      AND raw_description = $5
    LIMIT 1
  `, [userId, monthId, date, amount, rawDescription]);
  return r.rows.length > 0;
}

// POST /api/import/check-duplicates
router.post('/check-duplicates', async (req: Request, res: Response) => {
  const userId = req.userId!;
  const { transactions, year, month } = req.body as {
    transactions: Array<{ date: string; amount: number; raw_description: string }>;
    year: number;
    month: number;
  };

  if (!transactions || !Array.isArray(transactions)) {
    res.status(400).json({ error: 'transactions array is required' });
    return;
  }

  const monthId = await resolveMonthId(userId, year, month);
  const pool = getPool();

  const duplicates: boolean[] = [];
  for (const tx of transactions) {
    duplicates.push(await isDuplicate(pool, userId, monthId, tx.date, tx.amount, tx.raw_description));
  }

  res.json({ duplicates });
});

interface ConfirmGroup {
  existingGroupId?: number;
  newGroup?: { name: string; color?: string };
  rowIndices: number[];
}

const GROUPABLE_TYPES = "('expense', 'income')";

router.post('/confirm', async (req: Request, res: Response) => {
  const userId = req.userId!;
  const { transactions, year, month, groups } = req.body as {
    transactions: CategorizedTransaction[];
    year: number;
    month: number;
    groups?: ConfirmGroup[];
  };

  if (!transactions || !Array.isArray(transactions)) {
    res.status(400).json({ error: 'transactions array is required' });
    return;
  }

  const monthId = await resolveMonthId(userId, year, month);

  let imported = 0;
  let skipped = 0;
  let groupsCreated = 0;

  try {
    await withTx(async (client) => {
      const insertedIds: (number | null)[] = [];
      for (const tx of transactions) {
        if (await isDuplicate(client, userId, monthId, tx.date, tx.amount, tx.raw_description ?? '')) {
          skipped++;
          insertedIds.push(null);
          continue;
        }
        const r = await client.query(`
          INSERT INTO transactions (user_id, month_id, date, amount, description, raw_description, type, category_id, bank, manually_reviewed)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 0)
          RETURNING id
        `, [userId, monthId, tx.date, tx.amount, tx.description, tx.raw_description, tx.type, tx.category_id ?? null, tx.bank]);
        insertedIds.push(r.rows[0].id as number);
        imported++;
      }

      for (const g of groups ?? []) {
        const memberIds = (g.rowIndices ?? [])
          .map(i => insertedIds[i])
          .filter((id): id is number => id != null);
        if (memberIds.length === 0) continue;

        let groupId = g.existingGroupId;
        if (groupId == null && g.newGroup?.name?.trim()) {
          const gr = await client.query('INSERT INTO groups (user_id, name, color) VALUES ($1, $2, $3) RETURNING id', [userId, g.newGroup.name.trim(), g.newGroup.color ?? '#71717a']);
          groupId = gr.rows[0].id as number;
          groupsCreated++;
        }
        if (groupId == null) continue;

        const placeholders = memberIds.map((_, i) => `$${i + 3}`).join(', ');
        await client.query(
          `UPDATE transactions SET group_id = $1 WHERE user_id = $2 AND id IN (${placeholders}) AND type IN ${GROUPABLE_TYPES}`,
          [groupId, userId, ...memberIds],
        );
      }
    });

    res.json({ imported, skipped, groupsCreated });
  } catch (err: unknown) {
    const e = err as { code?: string; message?: string };
    if (e.code === '23505') {
      res.status(409).json({ error: 'A group with that name already exists' });
    } else {
      res.status(500).json({ error: e.message ?? String(err) });
    }
  }
});

export default router;

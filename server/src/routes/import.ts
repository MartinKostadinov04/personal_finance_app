import { Router, Request, Response } from 'express';
import multer from 'multer';
import { getDb } from '../db/index';
import { resolveMonthId } from '../db/months';
import { parseRevolut } from '../parsers/revolut';
import { parseSantander } from '../parsers/santander';
import { parseFibank } from '../parsers/fibank';
import { categorize } from '../categorizer';
import { CategorizedTransaction } from '../types';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

router.post('/parse', upload.single('file'), async (req: Request, res: Response) => {
  const db = getDb();

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

    const categorized = await categorize(rawTransactions, db);
    res.json({ transactions: categorized, count: categorized.length });
  } catch (err) {
    console.error('Parse error:', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Parse failed' });
  }
});

// Shared duplicate-check query: matches on month_id + date + amount (±0.005) + raw_description
function isDuplicate(db: ReturnType<typeof getDb>, monthId: number, date: string, amount: number, rawDescription: string): boolean {
  const row = db.prepare(`
    SELECT 1 FROM transactions
    WHERE month_id = ?
      AND date = ?
      AND ABS(amount - ?) < 0.005
      AND raw_description = ?
    LIMIT 1
  `).get(monthId, date, amount, rawDescription);
  return row !== undefined;
}

// POST /api/import/check-duplicates
// Returns a boolean array — true means a matching transaction already exists in the target month.
router.post('/check-duplicates', (req: Request, res: Response) => {
  const db = getDb();
  const { transactions, year, month } = req.body as {
    transactions: Array<{ date: string; amount: number; raw_description: string }>;
    year: number;
    month: number;
  };

  if (!transactions || !Array.isArray(transactions)) {
    res.status(400).json({ error: 'transactions array is required' });
    return;
  }

  const monthId = resolveMonthId(db, year, month);

  const duplicates = transactions.map(tx =>
    isDuplicate(db, monthId, tx.date, tx.amount, tx.raw_description)
  );

  res.json({ duplicates });
});

router.post('/confirm', (req: Request, res: Response) => {
  const db = getDb();
  const { transactions, year, month } = req.body as {
    transactions: CategorizedTransaction[];
    year: number;
    month: number;
  };

  if (!transactions || !Array.isArray(transactions)) {
    res.status(400).json({ error: 'transactions array is required' });
    return;
  }

  // Get or create month (atomic)
  const monthId = resolveMonthId(db, year, month);

  const insert = db.prepare(`
    INSERT INTO transactions (month_id, date, amount, description, raw_description, type, category_id, bank, manually_reviewed)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
  `);

  let imported = 0;
  let skipped = 0;

  const insertAll = db.transaction(() => {
    for (const tx of transactions) {
      if (isDuplicate(db, monthId, tx.date, tx.amount, tx.raw_description ?? '')) {
        skipped++;
        continue;
      }
      insert.run(
        monthId,
        tx.date,
        tx.amount,
        tx.description,
        tx.raw_description,
        tx.type,
        tx.category_id ?? null,
        tx.bank
      );
      imported++;
    }
  });

  insertAll();
  res.json({ imported, skipped });
});

export default router;

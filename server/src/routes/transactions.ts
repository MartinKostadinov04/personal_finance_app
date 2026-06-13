import { Router, Request, Response } from 'express';
import { getDb } from '../db/index';
import { resolveMonthId } from '../db/months';
import { Transaction } from '../types';

const router = Router();

router.get('/', (req: Request, res: Response) => {
  const db = getDb();
  const { monthId, type, categoryId, bank, search, grouped } = req.query as Record<string, string>;

  let query = `
    SELECT t.*, c.display_name as category_display_name, c.color as category_color, c.name as category_name,
           g.name as group_name, g.color as group_color
    FROM transactions t
    LEFT JOIN categories c ON t.category_id = c.id
    LEFT JOIN groups g ON t.group_id = g.id
    WHERE 1=1
  `;
  const params: unknown[] = [];

  if (monthId) { query += ' AND t.month_id = ?'; params.push(parseInt(monthId)); }
  if (type) { query += ' AND t.type = ?'; params.push(type); }
  if (categoryId) { query += ' AND t.category_id = ?'; params.push(parseInt(categoryId)); }
  if (bank) { query += ' AND t.bank = ?'; params.push(bank); }
  if (grouped === '1') { query += ' AND t.group_id IS NOT NULL'; }
  if (search) {
    // Unified search: match any displayed field. Dates match both ISO (2026-04-30)
    // and the UI's DD/MM/YY format; amounts match their 2-decimal rendering.
    query += ` AND (
      t.description LIKE ?
      OR t.raw_description LIKE ?
      OR t.date LIKE ?
      OR strftime('%d/%m/%y', t.date) LIKE ?
      OR strftime('%d/%m/%Y', t.date) LIKE ?
      OR printf('%.2f', t.amount) LIKE ?
      OR t.bank LIKE ?
      OR c.display_name LIKE ?
      OR g.name LIKE ?
    )`;
    const term = `%${search}%`;
    const amountTerm = `%${search.replace(/[€\s]/g, '')}%`;
    params.push(term, term, term, term, term, amountTerm, term, term, term);
  }

  query += ' ORDER BY t.date DESC, t.id DESC';

  const transactions = db.prepare(query).all(...params);
  res.json(transactions);
});

router.post('/', (req: Request, res: Response) => {
  const db = getDb();
  const { month_id, date, amount, description, type, category_id, bank } = req.body as Partial<Transaction>;

  if (!month_id || !date || amount === undefined || !description || !type || !bank) {
    res.status(400).json({ error: 'Missing required fields' });
    return;
  }

  const result = db.prepare(
    'INSERT INTO transactions (month_id, date, amount, description, type, category_id, bank, manually_reviewed) VALUES (?, ?, ?, ?, ?, ?, ?, 1)'
  ).run(month_id, date, amount, description, type, category_id ?? null, bank);

  const created = db.prepare('SELECT * FROM transactions WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(created);
});

router.put('/:id', (req: Request, res: Response) => {
  const db = getDb();
  const id = parseInt(req.params.id);
  const { date, amount, description, type, category_id, bank, year: targetYear, month: targetMonth } = req.body as Partial<Transaction> & { year?: number; month?: number };

  // Use an explicit presence flag for category_id so we can distinguish
  // "not provided" (keep existing) from "explicitly set to null" (clear it).
  const hasCategoryId = 'category_id' in req.body;

  // Resolve target month_id if year+month provided (atomic INSERT+SELECT)
  const targetMonthId: number | null = (targetYear != null && targetMonth != null)
    ? resolveMonthId(db, targetYear, targetMonth)
    : null;

  db.prepare(`
    UPDATE transactions SET
      date = COALESCE(?, date),
      amount = COALESCE(?, amount),
      description = COALESCE(?, description),
      type = COALESCE(?, type),
      category_id = CASE WHEN ? = 1 THEN ? ELSE category_id END,
      bank = COALESCE(?, bank),
      month_id = COALESCE(?, month_id),
      manually_reviewed = 1
    WHERE id = ?
  `).run(date ?? null, amount ?? null, description ?? null, type ?? null, hasCategoryId ? 1 : 0, category_id ?? null, bank ?? null, targetMonthId, id);

  const updated = db.prepare('SELECT * FROM transactions WHERE id = ?').get(id);
  res.json(updated);
});

router.delete('/:id', (req: Request, res: Response) => {
  const db = getDb();
  const id = parseInt(req.params.id);
  db.prepare('DELETE FROM transactions WHERE id = ?').run(id);
  res.json({ success: true });
});

// POST /api/transactions/bulk-categorize
// Applies a category to all transactions whose raw_description matches a pattern,
// scoped to a month range determined by `scope`.
router.post('/bulk-categorize', (req: Request, res: Response) => {
  const db = getDb();
  const { pattern, category_id, scope, year, month, match_amount, match_type = 'contains' } = req.body as {
    pattern: string;
    category_id: number;
    scope: 'month' | 'before' | 'future' | 'all';
    year: number;
    month: number;
    match_amount?: number | null;
    match_type?: 'contains' | 'regex';
  };

  if (!pattern || !category_id || !scope) {
    res.status(400).json({ error: 'pattern, category_id and scope are required' });
    return;
  }

  // Build the description-match clause depending on match_type
  const descClause = match_type === 'regex'
    ? 'raw_description REGEXP ?'
    : 'raw_description LIKE ?';
  const descParam = match_type === 'regex' ? pattern : `%${pattern}%`;

  // Optional amount filter: ABS(amount) must match within ±0.005 (rounding safety)
  const amountClause = match_amount != null ? ' AND ABS(ABS(amount) - ?) < 0.005' : '';
  const amountParam = match_amount != null ? [Math.abs(match_amount)] : [];
  let result: { changes: number };

  if (scope === 'all') {
    result = db.prepare(`
      UPDATE transactions
      SET category_id = ?, manually_reviewed = 1
      WHERE ${descClause}${amountClause}
    `).run(category_id, descParam, ...amountParam) as { changes: number };

  } else if (scope === 'month') {
    const monthRecord = db.prepare('SELECT id FROM months WHERE year = ? AND month = ?').get(year, month) as { id: number } | undefined;
    if (!monthRecord) { res.json({ updated: 0 }); return; }
    result = db.prepare(`
      UPDATE transactions
      SET category_id = ?, manually_reviewed = 1
      WHERE month_id = ? AND ${descClause}${amountClause}
    `).run(category_id, monthRecord.id, descParam, ...amountParam) as { changes: number };

  } else if (scope === 'before') {
    result = db.prepare(`
      UPDATE transactions
      SET category_id = ?, manually_reviewed = 1
      WHERE ${descClause}${amountClause}
        AND month_id IN (
          SELECT id FROM months
          WHERE year < ? OR (year = ? AND month <= ?)
        )
    `).run(category_id, descParam, ...amountParam, year, year, month) as { changes: number };

  } else { // future
    result = db.prepare(`
      UPDATE transactions
      SET category_id = ?, manually_reviewed = 1
      WHERE ${descClause}${amountClause}
        AND month_id IN (
          SELECT id FROM months
          WHERE year > ? OR (year = ? AND month >= ?)
        )
    `).run(category_id, descParam, ...amountParam, year, year, month) as { changes: number };
  }

  res.json({ updated: result.changes });
});

export default router;

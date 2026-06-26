import { Router, Request, Response } from 'express';
import { query, one } from '../db/pg';
import { resolveMonthId } from '../db/months';
import { Transaction } from '../types';

const router = Router();

router.get('/', async (req: Request, res: Response) => {
  const userId = req.userId!;
  const { monthId, type, categoryId, bank, search, grouped } = req.query as Record<string, string>;

  const params: unknown[] = [];
  const p = (v: unknown) => { params.push(v); return `$${params.length}`; };

  let q = `
    SELECT t.*, c.display_name as category_display_name, c.color as category_color, c.name as category_name,
           g.name as group_name, g.color as group_color
    FROM transactions t
    LEFT JOIN categories c ON t.category_id = c.id
    LEFT JOIN groups g ON t.group_id = g.id
    WHERE t.user_id = ${p(userId)}
  `;

  if (monthId) { q += ` AND t.month_id = ${p(parseInt(monthId))}`; }
  if (type) { q += ` AND t.type = ${p(type)}`; }
  if (categoryId) { q += ` AND t.category_id = ${p(parseInt(categoryId))}`; }
  if (bank) { q += ` AND t.bank = ${p(bank)}`; }
  if (grouped === '1') { q += ' AND t.group_id IS NOT NULL'; }
  if (search) {
    // Unified search: match any displayed field. ILIKE keeps the case-insensitive
    // behavior SQLite's LIKE had; to_char renders dates/amounts the way the UI does.
    const term = `%${search}%`;
    const amountTerm = `%${search.replace(/[€\s]/g, '')}%`;
    q += ` AND (
      t.description ILIKE ${p(term)}
      OR t.raw_description ILIKE ${p(term)}
      OR t.date ILIKE ${p(term)}
      OR to_char(t.date::date, 'DD/MM/YY') ILIKE ${p(term)}
      OR to_char(t.date::date, 'DD/MM/YYYY') ILIKE ${p(term)}
      OR to_char(t.amount, 'FM9999999990.00') ILIKE ${p(amountTerm)}
      OR t.bank ILIKE ${p(term)}
      OR c.display_name ILIKE ${p(term)}
      OR g.name ILIKE ${p(term)}
    )`;
  }

  q += ' ORDER BY t.date DESC, t.id DESC';

  const transactions = await query(q, params);
  res.json(transactions);
});

router.post('/', async (req: Request, res: Response) => {
  const userId = req.userId!;
  const { month_id, date, amount, description, type, category_id, bank } = req.body as Partial<Transaction>;

  if (!month_id || !date || amount === undefined || !description || !type || !bank) {
    res.status(400).json({ error: 'Missing required fields' });
    return;
  }

  // raw_description = description for manual entries so merchant rules and
  // duplicate detection (which key on raw_description) work on them too.
  const created = await one(
    `INSERT INTO transactions (user_id, month_id, date, amount, description, raw_description, type, category_id, bank, manually_reviewed)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1) RETURNING *`,
    [userId, month_id, date, amount, description, description, type, category_id ?? null, bank],
  );

  res.status(201).json(created);
});

router.put('/:id', async (req: Request, res: Response) => {
  const userId = req.userId!;
  const id = parseInt(req.params.id);
  const { date, amount, description, type, category_id, bank, year: targetYear, month: targetMonth } = req.body as Partial<Transaction> & { year?: number; month?: number };

  // Explicit presence flag for category_id: distinguish "not provided" (keep) from
  // "explicitly null" (clear).
  const hasCategoryId = 'category_id' in req.body;

  const targetMonthId: number | null = (targetYear != null && targetMonth != null)
    ? await resolveMonthId(userId, targetYear, targetMonth)
    : null;

  const updated = await one(`
    UPDATE transactions SET
      date = COALESCE($1, date),
      amount = COALESCE($2, amount),
      description = COALESCE($3, description),
      type = COALESCE($4, type),
      category_id = CASE WHEN $5 = 1 THEN $6::bigint ELSE category_id END,
      bank = COALESCE($7, bank),
      month_id = COALESCE($8, month_id),
      manually_reviewed = 1
    WHERE id = $9 AND user_id = $10
    RETURNING *
  `, [date ?? null, amount ?? null, description ?? null, type ?? null, hasCategoryId ? 1 : 0, category_id ?? null, bank ?? null, targetMonthId, id, userId]);

  res.json(updated);
});

router.delete('/:id', async (req: Request, res: Response) => {
  const userId = req.userId!;
  await query('DELETE FROM transactions WHERE id = $1 AND user_id = $2', [parseInt(req.params.id), userId]);
  res.json({ success: true });
});

// POST /api/transactions/bulk-categorize
router.post('/bulk-categorize', async (req: Request, res: Response) => {
  const userId = req.userId!;
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

  const params: unknown[] = [];
  const p = (v: unknown) => { params.push(v); return `$${params.length}`; };

  const catTok = p(category_id);
  const userTok = p(userId);

  const regex = match_type === 'regex';
  const descTok = p(regex ? pattern : `%${pattern}%`);
  const descClause = regex
    ? `(raw_description ~* ${descTok} OR description ~* ${descTok})`
    : `(raw_description ILIKE ${descTok} OR description ILIKE ${descTok})`;

  const amountClause = match_amount != null ? ` AND ABS(ABS(amount) - ${p(Math.abs(match_amount))}) < 0.005` : '';

  let sql: string;

  if (scope === 'all') {
    sql = `UPDATE transactions SET category_id = ${catTok}, manually_reviewed = 1
           WHERE user_id = ${userTok} AND ${descClause}${amountClause}`;
  } else if (scope === 'month') {
    const monthRecord = await one<{ id: number }>('SELECT id FROM months WHERE year = $1 AND month = $2 AND user_id = $3', [year, month, userId]);
    if (!monthRecord) { res.json({ updated: 0 }); return; }
    sql = `UPDATE transactions SET category_id = ${catTok}, manually_reviewed = 1
           WHERE user_id = ${userTok} AND month_id = ${p(monthRecord.id)} AND ${descClause}${amountClause}`;
  } else if (scope === 'before') {
    sql = `UPDATE transactions SET category_id = ${catTok}, manually_reviewed = 1
           WHERE user_id = ${userTok} AND ${descClause}${amountClause}
             AND month_id IN (SELECT id FROM months WHERE user_id = ${userTok} AND (year < ${p(year)} OR (year = ${p(year)} AND month <= ${p(month)})))`;
  } else { // future
    sql = `UPDATE transactions SET category_id = ${catTok}, manually_reviewed = 1
           WHERE user_id = ${userTok} AND ${descClause}${amountClause}
             AND month_id IN (SELECT id FROM months WHERE user_id = ${userTok} AND (year > ${p(year)} OR (year = ${p(year)} AND month >= ${p(month)})))`;
  }

  const updatedRows = await query(sql + ' RETURNING id', params);
  res.json({ updated: updatedRows.length });
});

export default router;

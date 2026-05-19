import { Router, Request, Response } from 'express';
import ExcelJS from 'exceljs';
import { getDb } from '../db/index';
import { computeBalances } from './months';
import { Month } from '../types';

const router = Router();

router.get('/:year/:month', async (req: Request, res: Response) => {
  const db = getDb();
  const year = parseInt(req.params.year);
  const month = parseInt(req.params.month);

  const monthRecord = db.prepare('SELECT * FROM months WHERE year = ? AND month = ?').get(year, month) as Month | undefined;
  if (!monthRecord) {
    res.status(404).json({ error: 'Month not found' });
    return;
  }

  const transactions = db.prepare(`
    SELECT t.*, c.display_name as category_display_name
    FROM transactions t
    LEFT JOIN categories c ON t.category_id = c.id
    WHERE t.month_id = ?
    ORDER BY t.date ASC
  `).all(monthRecord.id) as Array<Record<string, unknown>>;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Personal Finance';
  workbook.created = new Date();

  // Sheet 1: Transactions
  const txSheet = workbook.addWorksheet('Transactions');
  txSheet.columns = [
    { header: 'Date', key: 'date', width: 12 },
    { header: 'Description', key: 'description', width: 40 },
    { header: 'Amount', key: 'amount', width: 12 },
    { header: 'Type', key: 'type', width: 10 },
    { header: 'Category', key: 'category', width: 20 },
    { header: 'Bank', key: 'bank', width: 12 },
    { header: 'Reviewed', key: 'reviewed', width: 10 },
  ];

  for (const tx of transactions) {
    txSheet.addRow({
      date: tx['date'],
      description: tx['description'],
      amount: tx['type'] === 'expense' ? -(tx['amount'] as number) : tx['amount'],
      type: tx['type'],
      category: tx['category_display_name'] ?? '',
      bank: tx['bank'],
      reviewed: tx['manually_reviewed'] ? 'Yes' : 'No',
    });
  }

  // Header row styling
  txSheet.getRow(1).font = { bold: true };

  // Sheet 2: Summary
  const sumSheet = workbook.addWorksheet('Summary');
  const income = transactions.filter(t => t['type'] === 'income').reduce((s, t) => s + (t['amount'] as number), 0);
  const expenses = transactions.filter(t => t['type'] === 'expense').reduce((s, t) => s + (t['amount'] as number), 0);

  const balances = computeBalances(db, year, month) ?? { start_balance: 0, end_balance: 0 };
  sumSheet.addRow(['Period', `${year}-${String(month).padStart(2, '0')}`]);
  sumSheet.addRow(['Start Balance', balances.start_balance]);
  sumSheet.addRow(['End Balance', balances.end_balance]);
  sumSheet.addRow(['Total Income', income]);
  sumSheet.addRow(['Total Expenses', expenses]);
  sumSheet.addRow(['Saved', income - expenses]);

  const monthName = new Date(year, month - 1).toLocaleString('default', { month: 'long' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="finance-${year}-${String(month).padStart(2, '0')}-${monthName}.xlsx"`);

  await workbook.xlsx.write(res);
  res.end();
});

export default router;

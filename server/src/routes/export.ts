import { Router, Request, Response } from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { query, one } from '../db/pg';
import { computeBalances } from './months';

const router = Router();

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

type Section = 'transactions' | 'dashboard' | 'analytics';
type TypeFilter = 'all' | 'expense' | 'income';
type Format = 'xlsx' | 'pdf';

interface ExportOptions {
  format: Format;
  fromYear: number; fromMonth: number;
  toYear: number;   toMonth: number;
  sections: Section[];
  typeFilter: TypeFilter;
}

interface MonthRow { id: number; year: number; month: number; }
interface TxRow {
  id: number; date: string; description: string; amount: number;
  type: 'expense' | 'income' | 'transfer'; bank: string;
  category_display_name: string | null;
  month_id: number;
}
interface CategoryTotalRow {
  category_id: number; category_name: string; display_name: string;
  type: 'expense' | 'income'; color: string; total: number;
}
interface BudgetRow {
  category_id: number; display_name: string; category_type: 'expense' | 'income';
  planned: number; is_active: number;
}
interface MonthSummary {
  year: number; month: number; label: string;
  income: number; expenses: number; saved: number;
  start_balance: number; end_balance: number;
  byCategory: CategoryTotalRow[];
  budgets: BudgetRow[];
}

function monthKey(y: number, m: number) { return y * 100 + m; }
function fmtMonth(y: number, m: number) { return `${MONTH_NAMES[m - 1]} ${y}`; }
function fmtRange(o: ExportOptions) {
  const same = o.fromYear === o.toYear && o.fromMonth === o.toMonth;
  return same ? fmtMonth(o.fromYear, o.fromMonth) : `${fmtMonth(o.fromYear, o.fromMonth)} – ${fmtMonth(o.toYear, o.toMonth)}`;
}

async function getMonthsInRange(userId: string, opts: ExportOptions): Promise<MonthRow[]> {
  const from = monthKey(opts.fromYear, opts.fromMonth);
  const to   = monthKey(opts.toYear,   opts.toMonth);
  const [lo, hi] = from <= to ? [from, to] : [to, from];
  const rows = await query<MonthRow>('SELECT id, year, month FROM months WHERE user_id = $1 ORDER BY year ASC, month ASC', [userId]);
  return rows.filter(m => {
    const k = monthKey(m.year, m.month);
    return k >= lo && k <= hi;
  });
}

async function getTransactions(userId: string, monthIds: number[], typeFilter: TypeFilter): Promise<TxRow[]> {
  if (monthIds.length === 0) return [];
  const params: unknown[] = [userId, ...monthIds];
  const placeholders = monthIds.map((_, i) => `$${i + 2}`).join(', ');
  // 'all' means all *real* flows — exclude transfers (internal moves).
  let typeClause: string;
  if (typeFilter === 'all') {
    typeClause = "AND t.type IN ('expense', 'income')";
  } else {
    params.push(typeFilter);
    typeClause = `AND t.type = $${params.length}`;
  }
  return await query<TxRow>(`
    SELECT t.id, t.month_id, t.date, t.description, t.amount, t.type, t.bank,
           c.display_name AS category_display_name
    FROM transactions t
    LEFT JOIN categories c ON t.category_id = c.id
    WHERE t.user_id = $1 AND t.month_id IN (${placeholders})
      ${typeClause}
    ORDER BY t.date ASC, t.id ASC
  `, params);
}

async function getMonthSummary(userId: string, m: MonthRow): Promise<MonthSummary> {
  const income = (await one<{ total: number }>(
    "SELECT COALESCE(SUM(amount),0) as total FROM transactions WHERE month_id = $1 AND type='income'", [m.id],
  ))!.total;
  const expenses = (await one<{ total: number }>(
    "SELECT COALESCE(SUM(amount),0) as total FROM transactions WHERE month_id = $1 AND type='expense'", [m.id],
  ))!.total;

  // $1 = month id (user-scoped), $2 = user id (scopes the category/stable-budget lists).
  const byCategory = await query<CategoryTotalRow>(`
    SELECT c.id as category_id, c.name as category_name, c.display_name, c.type, c.color,
           COALESCE(SUM(t.amount), 0) as total
    FROM categories c
    LEFT JOIN transactions t ON t.category_id = c.id AND t.month_id = $1 AND t.group_id IS NULL
    WHERE c.user_id = $2
      AND (c.is_active = 1 OR EXISTS (SELECT 1 FROM transactions t2 WHERE t2.category_id = c.id AND t2.month_id = $1 AND t2.group_id IS NULL))
    GROUP BY c.id
    UNION ALL
    SELECT CASE WHEN t.type = 'income' THEN -(g.id + 1000000) ELSE -g.id END as category_id,
           'group:' || g.name as category_name,
           'group:' || g.name as display_name,
           t.type as type, g.color as color, COALESCE(SUM(t.amount), 0) as total
    FROM groups g
    JOIN transactions t ON t.group_id = g.id AND t.month_id = $1
    GROUP BY g.id, t.type
    UNION ALL
    SELECT CASE WHEN t.type = 'income' THEN -1000000 ELSE 0 END as category_id,
           'uncategorized' as category_name, 'Uncategorized' as display_name,
           t.type as type, '#71717a' as color, COALESCE(SUM(t.amount), 0) as total
    FROM transactions t
    WHERE t.month_id = $1 AND t.group_id IS NULL AND t.category_id IS NULL AND t.type IN ('expense', 'income')
    GROUP BY t.type
    ORDER BY type, category_name
  `, [m.id, userId]);

  const budgets = await query<BudgetRow>(`
    SELECT b.category_id, b.planned, b.is_active,
           c.type as category_type, c.display_name
    FROM budgets b
    JOIN categories c ON b.category_id = c.id
    WHERE b.month_id = $1 AND b.is_active = 1
    UNION ALL
    SELECT sb.category_id, sb.planned, sb.is_active,
           c.type as category_type, c.display_name
    FROM stable_budgets sb
    JOIN categories c ON sb.category_id = c.id
    WHERE sb.user_id = $2 AND sb.is_active = 1
      AND sb.category_id NOT IN (
        SELECT category_id FROM budgets WHERE month_id = $1 AND is_active = 1
      )
  `, [m.id, userId]);

  const balances = (await computeBalances(userId, m.year, m.month)) ?? { start_balance: 0, end_balance: 0 };

  return {
    year: m.year, month: m.month,
    label: fmtMonth(m.year, m.month),
    income, expenses, saved: income - expenses,
    start_balance: balances.start_balance,
    end_balance: balances.end_balance,
    byCategory, budgets,
  };
}

function filterCategories(rows: CategoryTotalRow[], t: TypeFilter): CategoryTotalRow[] {
  if (t === 'all') return rows;
  return rows.filter(r => r.type === t);
}

interface AnalyticsData {
  summaries: MonthSummary[];
  totals: { income: number; expenses: number; saved: number };
  averages: { income: number; expenses: number; saved: number };
  extremes: {
    highestExpense: { label: string; value: number } | null;
    lowestExpense: { label: string; value: number } | null;
    highestIncome: { label: string; value: number } | null;
    bestSaved: { label: string; value: number } | null;
    worstSaved: { label: string; value: number } | null;
  };
  topCategories: Array<{ display_name: string; type: 'expense' | 'income'; total: number }>;
}

async function computeAnalyticsData(userId: string, months: MonthRow[], typeFilter: TypeFilter): Promise<AnalyticsData> {
  const summaries = await Promise.all(months.map(m => getMonthSummary(userId, m)));
  const totals = summaries.reduce(
    (acc, s) => ({ income: acc.income + s.income, expenses: acc.expenses + s.expenses, saved: acc.saved + s.saved }),
    { income: 0, expenses: 0, saved: 0 },
  );
  const n = Math.max(summaries.length, 1);
  const averages = { income: totals.income / n, expenses: totals.expenses / n, saved: totals.saved / n };

  const pick = (key: 'income' | 'expenses' | 'saved', mode: 'max' | 'min') => {
    if (summaries.length === 0) return null;
    const best = summaries.reduce((a, b) => (mode === 'max' ? (b[key] > a[key] ? b : a) : (b[key] < a[key] ? b : a)));
    return { label: best.label, value: best[key] };
  };

  const extremes = {
    highestExpense: pick('expenses', 'max'),
    lowestExpense:  pick('expenses', 'min'),
    highestIncome:  pick('income',   'max'),
    bestSaved:      pick('saved',    'max'),
    worstSaved:     pick('saved',    'min'),
  };

  const catMap = new Map<number, { display_name: string; type: 'expense' | 'income'; total: number }>();
  for (const s of summaries) {
    for (const c of s.byCategory) {
      if (typeFilter !== 'all' && c.type !== typeFilter) continue;
      const existing = catMap.get(c.category_id);
      if (existing) existing.total += c.total;
      else catMap.set(c.category_id, { display_name: c.display_name, type: c.type, total: c.total });
    }
  }
  const topCategories = [...catMap.values()].filter(c => c.total > 0).sort((a, b) => b.total - a.total);

  return { summaries, totals, averages, extremes, topCategories };
}

function fmtAmount(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/* ─── Unicode-capable fonts (needed for Cyrillic etc.) ─── */
interface PdfFonts { regular: string; bold: string; }
let cachedFonts: PdfFonts | null | undefined;

function findPdfFonts(): PdfFonts | null {
  if (cachedFonts !== undefined) return cachedFonts;
  const bundled = path.resolve(__dirname, '../../assets/fonts');
  const candidates: PdfFonts[] = [
    { regular: path.join(bundled, 'NotoSans-Regular.ttf'),  bold: path.join(bundled, 'NotoSans-Bold.ttf') },
    { regular: path.join(bundled, 'DejaVuSans.ttf'),        bold: path.join(bundled, 'DejaVuSans-Bold.ttf') },
  ];
  const plat = os.platform();
  if (plat === 'win32') {
    candidates.push({ regular: 'C:\\Windows\\Fonts\\arial.ttf', bold: 'C:\\Windows\\Fonts\\arialbd.ttf' });
  } else if (plat === 'darwin') {
    candidates.push({ regular: '/Library/Fonts/Arial Unicode.ttf', bold: '/Library/Fonts/Arial Unicode.ttf' });
    candidates.push({ regular: '/System/Library/Fonts/Supplemental/Arial.ttf', bold: '/System/Library/Fonts/Supplemental/Arial Bold.ttf' });
  } else {
    candidates.push({ regular: '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', bold: '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf' });
    candidates.push({ regular: '/usr/share/fonts/TTF/DejaVuSans.ttf', bold: '/usr/share/fonts/TTF/DejaVuSans-Bold.ttf' });
  }
  for (const c of candidates) {
    if (fs.existsSync(c.regular) && fs.existsSync(c.bold)) {
      cachedFonts = c;
      return c;
    }
  }
  cachedFonts = null;
  return null;
}

/* ─── Excel builder ─── */

async function buildExcel(userId: string, opts: ExportOptions, months: MonthRow[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Personal Finance';
  wb.created = new Date();

  const headerStyle: Partial<ExcelJS.Row['font']> = { bold: true };

  if (opts.sections.includes('transactions')) {
    const sheet = wb.addWorksheet('Transactions');
    sheet.columns = [
      { header: 'Date', key: 'date', width: 12 },
      { header: 'Description', key: 'description', width: 40 },
      { header: 'Category', key: 'category', width: 20 },
      { header: 'Bank', key: 'bank', width: 12 },
      { header: 'Type', key: 'type', width: 10 },
      { header: 'Amount', key: 'amount', width: 12 },
    ];
    const txs = await getTransactions(userId, months.map(m => m.id), opts.typeFilter);
    for (const tx of txs) {
      sheet.addRow({
        date: tx.date,
        description: tx.description,
        category: tx.category_display_name ?? '',
        bank: tx.bank,
        type: tx.type,
        amount: tx.type === 'expense' ? -tx.amount : tx.amount,
      });
    }
    sheet.getRow(1).font = headerStyle as ExcelJS.Row['font'];
    const total = txs.reduce((s, t) => s + (t.type === 'expense' ? -t.amount : t.amount), 0);
    const totalRow = sheet.addRow({ date: '', description: `Total (${txs.length} transactions)`, amount: total });
    totalRow.font = { bold: true };
  }

  if (opts.sections.includes('dashboard')) {
    const sheet = wb.addWorksheet('Dashboard');
    let row = 1;
    for (const m of months) {
      const s = await getMonthSummary(userId, m);
      sheet.getCell(row, 1).value = s.label;
      sheet.getCell(row, 1).font = { bold: true, size: 14 };
      row += 1;

      const summaryRows: Array<[string, number]> = [];
      if (opts.typeFilter !== 'expense') summaryRows.push(['Income', s.income]);
      if (opts.typeFilter !== 'income')  summaryRows.push(['Expenses', s.expenses]);
      summaryRows.push(['Saved', s.saved], ['Start Balance', s.start_balance], ['End Balance', s.end_balance]);
      for (const [label, val] of summaryRows) {
        sheet.getCell(row, 1).value = label;
        sheet.getCell(row, 2).value = val;
        sheet.getCell(row, 2).numFmt = '#,##0.00';
        row += 1;
      }
      row += 1;

      const cats = filterCategories(s.byCategory, opts.typeFilter);
      const budgetMap = new Map(s.budgets.map(b => [b.category_id, b.planned]));
      const headers = ['Category', 'Type', 'Planned', 'Actual', 'Diff'];
      headers.forEach((h, i) => {
        sheet.getCell(row, i + 1).value = h;
        sheet.getCell(row, i + 1).font = { bold: true };
      });
      row += 1;
      for (const c of cats) {
        const planned = budgetMap.get(c.category_id) ?? 0;
        sheet.getCell(row, 1).value = c.display_name;
        sheet.getCell(row, 2).value = c.type;
        sheet.getCell(row, 3).value = planned;
        sheet.getCell(row, 3).numFmt = '#,##0.00';
        sheet.getCell(row, 4).value = c.total;
        sheet.getCell(row, 4).numFmt = '#,##0.00';
        sheet.getCell(row, 5).value = c.total - planned;
        sheet.getCell(row, 5).numFmt = '#,##0.00';
        row += 1;
      }
      row += 2;
    }
    sheet.columns = [
      { width: 24 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 },
    ] as Partial<ExcelJS.Column>[];
  }

  if (opts.sections.includes('analytics')) {
    const sheet = wb.addWorksheet('Analytics');
    const a = await computeAnalyticsData(userId, months, opts.typeFilter);
    sheet.columns = [
      { width: 28 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 16 },
    ] as Partial<ExcelJS.Column>[];

    const showIncome = opts.typeFilter !== 'expense';
    const showExpenses = opts.typeFilter !== 'income';
    let row = 1;

    sheet.getCell(row, 1).value = 'Overview';
    sheet.getCell(row, 1).font = { bold: true, size: 14 };
    row += 2;

    const overviewRows: Array<[string, number | string]> = [['Months covered', a.summaries.length]];
    if (showIncome)   overviewRows.push(['Total income', a.totals.income]);
    if (showExpenses) overviewRows.push(['Total expenses', a.totals.expenses]);
    overviewRows.push(['Net saved', a.totals.saved]);
    if (showIncome)   overviewRows.push(['Avg income / month', a.averages.income]);
    if (showExpenses) overviewRows.push(['Avg expenses / month', a.averages.expenses]);
    overviewRows.push(['Avg saved / month', a.averages.saved]);
    if (a.extremes.highestIncome && showIncome) overviewRows.push([`Highest income month (${a.extremes.highestIncome.label})`, a.extremes.highestIncome.value]);
    if (a.extremes.highestExpense && showExpenses) overviewRows.push([`Highest expenses month (${a.extremes.highestExpense.label})`, a.extremes.highestExpense.value]);
    if (a.extremes.lowestExpense && showExpenses)  overviewRows.push([`Lowest expenses month (${a.extremes.lowestExpense.label})`,  a.extremes.lowestExpense.value]);
    if (a.extremes.bestSaved)  overviewRows.push([`Best savings month (${a.extremes.bestSaved.label})`,   a.extremes.bestSaved.value]);
    if (a.extremes.worstSaved) overviewRows.push([`Worst savings month (${a.extremes.worstSaved.label})`, a.extremes.worstSaved.value]);
    for (const [label, val] of overviewRows) {
      sheet.getCell(row, 1).value = label;
      sheet.getCell(row, 2).value = val;
      if (typeof val === 'number' && label !== 'Months covered') sheet.getCell(row, 2).numFmt = '#,##0.00';
      row += 1;
    }
    row += 2;

    sheet.getCell(row, 1).value = 'Monthly trend';
    sheet.getCell(row, 1).font = { bold: true, size: 12 };
    row += 1;
    const trendHeaders = ['Month'];
    if (showIncome)   trendHeaders.push('Income');
    if (showExpenses) trendHeaders.push('Expenses');
    trendHeaders.push('Saved');
    trendHeaders.forEach((h, i) => {
      sheet.getCell(row, i + 1).value = h;
      sheet.getCell(row, i + 1).font = { bold: true };
    });
    row += 1;
    for (const s of a.summaries) {
      let col = 1;
      sheet.getCell(row, col++).value = s.label;
      if (showIncome)   { sheet.getCell(row, col).value = s.income;   sheet.getCell(row, col).numFmt = '#,##0.00'; col++; }
      if (showExpenses) { sheet.getCell(row, col).value = s.expenses; sheet.getCell(row, col).numFmt = '#,##0.00'; col++; }
      sheet.getCell(row, col).value = s.saved; sheet.getCell(row, col).numFmt = '#,##0.00';
      row += 1;
    }
    row += 2;

    if (a.topCategories.length > 0) {
      sheet.getCell(row, 1).value = 'Top categories (across period)';
      sheet.getCell(row, 1).font = { bold: true, size: 12 };
      row += 1;
      const catHeaders = ['Category', 'Type', 'Total', 'Avg / month'];
      catHeaders.forEach((h, i) => {
        sheet.getCell(row, i + 1).value = h;
        sheet.getCell(row, i + 1).font = { bold: true };
      });
      row += 1;
      for (const c of a.topCategories) {
        sheet.getCell(row, 1).value = c.display_name;
        sheet.getCell(row, 2).value = c.type;
        sheet.getCell(row, 3).value = c.total;       sheet.getCell(row, 3).numFmt = '#,##0.00';
        sheet.getCell(row, 4).value = c.total / Math.max(a.summaries.length, 1);
        sheet.getCell(row, 4).numFmt = '#,##0.00';
        row += 1;
      }
    }
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}

/* ─── PDF builder ─── */

async function buildPdf(userId: string, opts: ExportOptions, months: MonthRow[]): Promise<Buffer> {
  // Pre-fetch all DB-backed data up front so the PDF drawing stays synchronous.
  const pdfTxs = opts.sections.includes('transactions') ? await getTransactions(userId, months.map(m => m.id), opts.typeFilter) : [];
  const pdfSummaries = opts.sections.includes('dashboard') ? await Promise.all(months.map(m => getMonthSummary(userId, m))) : [];
  const pdfAnalytics = opts.sections.includes('analytics') ? await computeAnalyticsData(userId, months, opts.typeFilter) : null;

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const chunks: Buffer[] = [];
    doc.on('data', c => chunks.push(c as Buffer));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

    const fonts = findPdfFonts();
    const FONT_REGULAR = 'Body';
    const FONT_BOLD = 'Body-Bold';
    if (fonts) {
      doc.registerFont(FONT_REGULAR, fonts.regular);
      doc.registerFont(FONT_BOLD, fonts.bold);
    }
    const fontRegular = fonts ? FONT_REGULAR : 'Helvetica';
    const fontBold = fonts ? FONT_BOLD : 'Helvetica-Bold';

    const drawTitle = (txt: string, size = 18) => {
      doc.font(fontBold).fontSize(size).fillColor('#111').text(txt);
      doc.moveDown(0.4);
    };
    const drawSubtitle = (txt: string) => {
      doc.font(fontBold).fontSize(13).fillColor('#222').text(txt);
      doc.moveDown(0.3);
    };
    const drawMeta = (txt: string) => {
      doc.font(fontRegular).fontSize(9).fillColor('#666').text(txt);
      doc.moveDown(0.6);
    };

    const drawTable = (headers: string[], rows: string[][], widths: number[], align: ('left' | 'right')[]) => {
      const startX = doc.page.margins.left;
      const rowH = 16;
      const headerH = 18;

      const ensureSpace = (need: number) => {
        if (doc.y + need > doc.page.height - doc.page.margins.bottom) doc.addPage();
      };

      const drawRow = (cells: string[], h: number, bold: boolean, fill?: string) => {
        ensureSpace(h);
        const y = doc.y;
        if (fill) {
          doc.rect(startX, y, pageWidth, h).fill(fill);
        }
        doc.fillColor('#111').font(bold ? fontBold : fontRegular).fontSize(9);
        let x = startX;
        for (let i = 0; i < cells.length; i++) {
          const w = widths[i];
          doc.text(cells[i], x + 4, y + 4, { width: w - 8, align: align[i], lineBreak: false, ellipsis: true });
          x += w;
        }
        doc.y = y + h;
      };

      drawRow(headers, headerH, true, '#eeeeee');
      for (let i = 0; i < rows.length; i++) {
        drawRow(rows[i], rowH, false, i % 2 === 1 ? '#fafafa' : undefined);
      }
      doc.moveDown(0.8);
    };

    // ─── Cover ───
    drawTitle('Personal Finance Report');
    drawMeta(`Period: ${fmtRange(opts)}    Type: ${opts.typeFilter === 'all' ? 'All' : opts.typeFilter === 'expense' ? 'Expenses only' : 'Income only'}    Generated: ${new Date().toISOString().slice(0, 10)}`);

    if (months.length === 0) {
      drawMeta('No data available for the selected period.');
    }

    // ─── Transactions ───
    if (opts.sections.includes('transactions')) {
      drawSubtitle('Transactions');
      const txs = pdfTxs;
      if (txs.length === 0) {
        drawMeta('No transactions match the selection.');
      } else {
        const widths = [70, 200, 100, 70, 75];
        const rows = txs.map(t => [
          t.date,
          t.description ?? '',
          t.category_display_name ?? '',
          t.bank,
          (t.type === 'expense' ? '-' : '') + fmtAmount(t.amount),
        ]);
        drawTable(['Date', 'Description', 'Category', 'Bank', 'Amount'], rows, widths, ['left', 'left', 'left', 'left', 'right']);
        const total = txs.reduce((s, t) => s + (t.type === 'expense' ? -t.amount : t.amount), 0);
        doc.font(fontBold).fontSize(10).fillColor('#111')
           .text(`${txs.length} transactions    Total: ${fmtAmount(total)}`, { align: 'right' });
        doc.moveDown(0.8);
      }
    }

    // ─── Dashboard ───
    if (opts.sections.includes('dashboard')) {
      if (doc.y > doc.page.height - doc.page.margins.bottom - 100) doc.addPage();
      drawSubtitle('Dashboard');
      for (const s of pdfSummaries) {
        doc.font(fontBold).fontSize(11).fillColor('#111').text(s.label);
        doc.moveDown(0.3);

        const summaryRows: string[][] = [];
        if (opts.typeFilter !== 'expense') summaryRows.push(['Income', fmtAmount(s.income)]);
        if (opts.typeFilter !== 'income')  summaryRows.push(['Expenses', fmtAmount(s.expenses)]);
        summaryRows.push(['Saved', fmtAmount(s.saved)]);
        summaryRows.push(['Start Balance', fmtAmount(s.start_balance)]);
        summaryRows.push(['End Balance', fmtAmount(s.end_balance)]);
        drawTable(['Metric', 'Value'], summaryRows, [200, 120], ['left', 'right']);

        const cats = filterCategories(s.byCategory, opts.typeFilter);
        if (cats.length > 0) {
          const budgetMap = new Map(s.budgets.map(b => [b.category_id, b.planned]));
          const widths = [150, 70, 80, 80, 80];
          const rows = cats.map(c => {
            const planned = budgetMap.get(c.category_id) ?? 0;
            return [c.display_name, c.type, fmtAmount(planned), fmtAmount(c.total), fmtAmount(c.total - planned)];
          });
          drawTable(['Category', 'Type', 'Planned', 'Actual', 'Diff'], rows, widths, ['left', 'left', 'right', 'right', 'right']);
        }
        doc.moveDown(0.4);
      }
    }

    // ─── Analytics ───
    if (opts.sections.includes('analytics')) {
      if (doc.y > doc.page.height - doc.page.margins.bottom - 100) doc.addPage();
      drawSubtitle('Analytics');
      const a = pdfAnalytics!;
      const showIncome   = opts.typeFilter !== 'expense';
      const showExpenses = opts.typeFilter !== 'income';

      doc.font(fontBold).fontSize(11).fillColor('#111').text('Overview');
      doc.moveDown(0.3);
      const overviewRows: string[][] = [['Months covered', String(a.summaries.length)]];
      if (showIncome)   overviewRows.push(['Total income', fmtAmount(a.totals.income)]);
      if (showExpenses) overviewRows.push(['Total expenses', fmtAmount(a.totals.expenses)]);
      overviewRows.push(['Net saved', fmtAmount(a.totals.saved)]);
      if (showIncome)   overviewRows.push(['Avg income / month', fmtAmount(a.averages.income)]);
      if (showExpenses) overviewRows.push(['Avg expenses / month', fmtAmount(a.averages.expenses)]);
      overviewRows.push(['Avg saved / month', fmtAmount(a.averages.saved)]);
      if (a.extremes.highestIncome && showIncome)
        overviewRows.push([`Highest income (${a.extremes.highestIncome.label})`, fmtAmount(a.extremes.highestIncome.value)]);
      if (a.extremes.highestExpense && showExpenses)
        overviewRows.push([`Highest expenses (${a.extremes.highestExpense.label})`, fmtAmount(a.extremes.highestExpense.value)]);
      if (a.extremes.lowestExpense && showExpenses)
        overviewRows.push([`Lowest expenses (${a.extremes.lowestExpense.label})`, fmtAmount(a.extremes.lowestExpense.value)]);
      if (a.extremes.bestSaved)
        overviewRows.push([`Best savings month (${a.extremes.bestSaved.label})`, fmtAmount(a.extremes.bestSaved.value)]);
      if (a.extremes.worstSaved)
        overviewRows.push([`Worst savings month (${a.extremes.worstSaved.label})`, fmtAmount(a.extremes.worstSaved.value)]);
      drawTable(['Metric', 'Value'], overviewRows, [300, pageWidth - 300], ['left', 'right']);

      if (doc.y > doc.page.height - doc.page.margins.bottom - 100) doc.addPage();
      doc.font(fontBold).fontSize(11).fillColor('#111').text('Monthly trend');
      doc.moveDown(0.3);
      const trendHeaders = ['Month'];
      if (showIncome)   trendHeaders.push('Income');
      if (showExpenses) trendHeaders.push('Expenses');
      trendHeaders.push('Saved');
      const trendBase = pageWidth / trendHeaders.length;
      const trendWidths = new Array(trendHeaders.length).fill(trendBase);
      const trendAlign: ('left' | 'right')[] = trendHeaders.map((_, i) => i === 0 ? 'left' : 'right');
      const trendRows = a.summaries.map(s => {
        const r: string[] = [s.label];
        if (showIncome)   r.push(fmtAmount(s.income));
        if (showExpenses) r.push(fmtAmount(s.expenses));
        r.push(fmtAmount(s.saved));
        return r;
      });
      drawTable(trendHeaders, trendRows, trendWidths, trendAlign);

      if (a.topCategories.length > 0) {
        if (doc.y > doc.page.height - doc.page.margins.bottom - 100) doc.addPage();
        doc.font(fontBold).fontSize(11).fillColor('#111').text('Top categories (across period)');
        doc.moveDown(0.3);
        const monthCount = Math.max(a.summaries.length, 1);
        const catWidths = [pageWidth - 80 - 110 - 110, 80, 110, 110];
        const catRows = a.topCategories.map(c => [
          c.display_name,
          c.type,
          fmtAmount(c.total),
          fmtAmount(c.total / monthCount),
        ]);
        drawTable(['Category', 'Type', 'Total', 'Avg / month'], catRows, catWidths, ['left', 'left', 'right', 'right']);
      }
    }

    doc.end();
  });
}

/* ─── Route ─── */

router.post('/', async (req: Request, res: Response) => {
  const userId = req.userId!;
  const opts = req.body as Partial<ExportOptions>;
  if (!opts || (opts.format !== 'xlsx' && opts.format !== 'pdf')) {
    res.status(400).json({ error: 'format must be xlsx or pdf' });
    return;
  }
  if (!Array.isArray(opts.sections) || opts.sections.length === 0) {
    res.status(400).json({ error: 'sections must be a non-empty array' });
    return;
  }
  if (!opts.fromYear || !opts.fromMonth || !opts.toYear || !opts.toMonth) {
    res.status(400).json({ error: 'fromYear/fromMonth/toYear/toMonth required' });
    return;
  }
  const typeFilter: TypeFilter = (opts.typeFilter === 'expense' || opts.typeFilter === 'income') ? opts.typeFilter : 'all';

  const normalized: ExportOptions = {
    format: opts.format,
    fromYear: opts.fromYear, fromMonth: opts.fromMonth,
    toYear: opts.toYear, toMonth: opts.toMonth,
    sections: opts.sections.filter((s): s is Section => s === 'transactions' || s === 'dashboard' || s === 'analytics'),
    typeFilter,
  };

  const months = await getMonthsInRange(userId, normalized);

  const fromStr = `${normalized.fromYear}-${String(normalized.fromMonth).padStart(2, '0')}`;
  const toStr   = `${normalized.toYear}-${String(normalized.toMonth).padStart(2, '0')}`;
  const periodStr = fromStr === toStr ? fromStr : `${fromStr}_${toStr}`;

  try {
    if (normalized.format === 'xlsx') {
      const buf = await buildExcel(userId, normalized, months);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="finance-${periodStr}.xlsx"`);
      res.send(buf);
    } else {
      const buf = await buildPdf(userId, normalized, months);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="finance-${periodStr}.pdf"`);
      res.send(buf);
    }
  } catch (err) {
    console.error('Export failed:', err);
    res.status(500).json({ error: 'Export failed' });
  }
});

export default router;

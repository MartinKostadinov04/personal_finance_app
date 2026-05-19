import 'dotenv/config';
import path from 'path';
import fs from 'fs';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { initDb } from './db/index';
import { computeBalances } from './routes/months';
import { parseRevolut } from './parsers/revolut';
import { parseSantander } from './parsers/santander';
import { parseFibank } from './parsers/fibank';
import { categorize } from './categorizer';
import { CategorizedTransaction, Month } from './types';

const dbPath = path.resolve(process.env.DATABASE_PATH ?? './data/finance.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = initDb(dbPath);

const server = new Server(
  { name: 'personal-finance', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    { name: 'get_monthly_summary', description: 'Get summary for a month', inputSchema: { type: 'object', properties: { year: { type: 'number' }, month: { type: 'number' } }, required: ['year', 'month'] } },
    { name: 'get_transactions', description: 'Get transactions for a month', inputSchema: { type: 'object', properties: { year: { type: 'number' }, month: { type: 'number' }, type: { type: 'string' }, category: { type: 'string' }, bank: { type: 'string' } }, required: ['year', 'month'] } },
    { name: 'add_transaction', description: 'Add a transaction', inputSchema: { type: 'object', properties: { year: { type: 'number' }, month: { type: 'number' }, date: { type: 'string' }, amount: { type: 'number' }, description: { type: 'string' }, type: { type: 'string' }, category: { type: 'string' }, bank: { type: 'string' } }, required: ['year', 'month', 'date', 'amount', 'description', 'type', 'bank'] } },
    { name: 'update_transaction', description: 'Update a transaction', inputSchema: { type: 'object', properties: { id: { type: 'number' }, category: { type: 'string' }, description: { type: 'string' }, amount: { type: 'number' }, date: { type: 'string' } }, required: ['id'] } },
    { name: 'delete_transaction', description: 'Delete a transaction', inputSchema: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] } },
    { name: 'import_transactions', description: 'Parse bank file (preview only, does not commit)', inputSchema: { type: 'object', properties: { year: { type: 'number' }, month: { type: 'number' }, bank: { type: 'string' }, file_content: { type: 'string' } }, required: ['year', 'month', 'bank', 'file_content'] } },
    { name: 'confirm_import', description: 'Commit parsed transactions to DB', inputSchema: { type: 'object', properties: { transactions: { type: 'array' }, year: { type: 'number' }, month: { type: 'number' } }, required: ['transactions', 'year', 'month'] } },
    { name: 'get_budget', description: 'Get budgets for a month', inputSchema: { type: 'object', properties: { year: { type: 'number' }, month: { type: 'number' } }, required: ['year', 'month'] } },
    { name: 'set_budget', description: 'Set budget for a category', inputSchema: { type: 'object', properties: { year: { type: 'number' }, month: { type: 'number' }, category: { type: 'string' }, planned: { type: 'number' } }, required: ['year', 'month', 'category', 'planned'] } },
    { name: 'close_month', description: 'Close a month', inputSchema: { type: 'object', properties: { year: { type: 'number' }, month: { type: 'number' } }, required: ['year', 'month'] } },
    { name: 'get_categories', description: 'Get all active categories', inputSchema: { type: 'object', properties: {} } },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const a = args as Record<string, unknown>;

  try {
    switch (name) {
      case 'get_monthly_summary': {
        const { year, month } = a as { year: number; month: number };
        db.prepare('INSERT OR IGNORE INTO months (year, month) VALUES (?, ?)').run(year, month);
        const m = db.prepare('SELECT * FROM months WHERE year = ? AND month = ?').get(year, month) as Month;
        const income = (db.prepare("SELECT COALESCE(SUM(amount),0) as t FROM transactions WHERE month_id=? AND type='income'").get(m.id) as { t: number }).t;
        const expenses = (db.prepare("SELECT COALESCE(SUM(amount),0) as t FROM transactions WHERE month_id=? AND type='expense'").get(m.id) as { t: number }).t;
        const byCategory = db.prepare("SELECT c.display_name, c.type, COALESCE(SUM(t.amount),0) as total FROM categories c LEFT JOIN transactions t ON t.category_id=c.id AND t.month_id=? WHERE c.is_active=1 GROUP BY c.id ORDER BY c.type, c.sort_order").all(m.id);
        const bal = computeBalances(db, year, month) ?? { start_balance: 0, end_balance: 0 };
        return { content: [{ type: 'text', text: JSON.stringify({ income, expenses, saved: income - expenses, start_balance: bal.start_balance, end_balance: bal.end_balance, byCategory }) }] };
      }

      case 'get_transactions': {
        const { year, month, type, category, bank } = a as { year: number; month: number; type?: string; category?: string; bank?: string };
        db.prepare('INSERT OR IGNORE INTO months (year, month) VALUES (?, ?)').run(year, month);
        const m = db.prepare('SELECT id FROM months WHERE year=? AND month=?').get(year, month) as { id: number };
        let q = 'SELECT t.*, c.display_name as category_display_name FROM transactions t LEFT JOIN categories c ON t.category_id=c.id WHERE t.month_id=?';
        const params: unknown[] = [m.id];
        if (type) { q += ' AND t.type=?'; params.push(type); }
        if (category) { q += ' AND c.name=?'; params.push(category); }
        if (bank) { q += ' AND t.bank=?'; params.push(bank); }
        q += ' ORDER BY t.date DESC';
        const txs = db.prepare(q).all(...params);
        return { content: [{ type: 'text', text: JSON.stringify(txs) }] };
      }

      case 'add_transaction': {
        const { year, month, date, amount, description, type, category, bank } = a as { year: number; month: number; date: string; amount: number; description: string; type: string; category?: string; bank: string };
        db.prepare('INSERT OR IGNORE INTO months (year, month) VALUES (?, ?)').run(year, month);
        const m = db.prepare('SELECT id FROM months WHERE year=? AND month=?').get(year, month) as { id: number };
        const cat = category ? db.prepare('SELECT id FROM categories WHERE name=?').get(category) as { id: number } | undefined : undefined;
        const r = db.prepare('INSERT INTO transactions (month_id, date, amount, description, type, category_id, bank, manually_reviewed) VALUES (?,?,?,?,?,?,?,1)').run(m.id, date, amount, description, type, cat?.id ?? null, bank);
        const tx = db.prepare('SELECT * FROM transactions WHERE id=?').get(r.lastInsertRowid);
        return { content: [{ type: 'text', text: JSON.stringify(tx) }] };
      }

      case 'update_transaction': {
        const { id, category, description, amount, date } = a as { id: number; category?: string; description?: string; amount?: number; date?: string };
        const cat = category ? db.prepare('SELECT id FROM categories WHERE name=?').get(category) as { id: number } | undefined : undefined;
        db.prepare('UPDATE transactions SET date=COALESCE(?,date), amount=COALESCE(?,amount), description=COALESCE(?,description), category_id=CASE WHEN ? IS NOT NULL THEN ? ELSE category_id END, manually_reviewed=1 WHERE id=?').run(date ?? null, amount ?? null, description ?? null, cat?.id ?? null, cat?.id ?? null, id);
        const tx = db.prepare('SELECT * FROM transactions WHERE id=?').get(id);
        return { content: [{ type: 'text', text: JSON.stringify(tx) }] };
      }

      case 'delete_transaction': {
        const { id } = a as { id: number };
        db.prepare('DELETE FROM transactions WHERE id=?').run(id);
        return { content: [{ type: 'text', text: JSON.stringify({ success: true }) }] };
      }

      case 'import_transactions': {
        const { year, month, bank, file_content } = a as { year: number; month: number; bank: string; file_content: string };
        let raw;
        if (bank === 'revolut') raw = parseRevolut(file_content);
        else if (bank === 'santander') raw = parseSantander(Buffer.from(file_content, 'base64'));
        else raw = parseFibank(Buffer.from(file_content, 'base64'));
        const categorized = await categorize(raw, db);
        return { content: [{ type: 'text', text: JSON.stringify({ transactions: categorized, year, month }) }] };
      }

      case 'confirm_import': {
        const { transactions, year, month } = a as { transactions: CategorizedTransaction[]; year: number; month: number };
        db.prepare('INSERT OR IGNORE INTO months (year, month) VALUES (?, ?)').run(year, month);
        const m = db.prepare('SELECT id FROM months WHERE year=? AND month=?').get(year, month) as { id: number };
        const ins = db.prepare('INSERT INTO transactions (month_id,date,amount,description,raw_description,type,category_id,bank) VALUES (?,?,?,?,?,?,?,?)');
        db.transaction(() => { for (const t of transactions) ins.run(m.id, t.date, t.amount, t.description, t.raw_description, t.type, t.category_id ?? null, t.bank); })();
        return { content: [{ type: 'text', text: JSON.stringify({ imported: transactions.length }) }] };
      }

      case 'get_budget': {
        const { year, month } = a as { year: number; month: number };
        db.prepare('INSERT OR IGNORE INTO months (year, month) VALUES (?, ?)').run(year, month);
        const m = db.prepare('SELECT id FROM months WHERE year=? AND month=?').get(year, month) as { id: number };
        const budgets = db.prepare('SELECT b.*, c.display_name, c.name as category_name FROM budgets b JOIN categories c ON b.category_id=c.id WHERE b.month_id=?').all(m.id);
        return { content: [{ type: 'text', text: JSON.stringify(budgets) }] };
      }

      case 'set_budget': {
        const { year, month, category, planned } = a as { year: number; month: number; category: string; planned: number };
        db.prepare('INSERT OR IGNORE INTO months (year, month) VALUES (?, ?)').run(year, month);
        const m = db.prepare('SELECT id FROM months WHERE year=? AND month=?').get(year, month) as { id: number };
        const cat = db.prepare('SELECT id FROM categories WHERE name=?').get(category) as { id: number } | undefined;
        if (!cat) throw new Error(`Category '${category}' not found`);
        db.prepare('INSERT INTO budgets (month_id,category_id,planned) VALUES (?,?,?) ON CONFLICT(month_id,category_id) DO UPDATE SET planned=excluded.planned').run(m.id, cat.id, planned);
        return { content: [{ type: 'text', text: JSON.stringify({ success: true }) }] };
      }

      case 'close_month': {
        const { year, month } = a as { year: number; month: number };
        db.prepare("UPDATE months SET status='closed' WHERE year=? AND month=?").run(year, month);
        return { content: [{ type: 'text', text: JSON.stringify({ success: true }) }] };
      }

      case 'get_categories': {
        const cats = db.prepare('SELECT * FROM categories WHERE is_active=1 ORDER BY type, sort_order').all();
        return { content: [{ type: 'text', text: JSON.stringify(cats) }] };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (err) {
    return { content: [{ type: 'text', text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);

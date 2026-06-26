import './env';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { query, one, withTx } from './db/pg';
import { resolveMonthId } from './db/months';
import { computeBalances } from './routes/months';
import { parseRevolut } from './parsers/revolut';
import { parseSantander } from './parsers/santander';
import { parseFibank } from './parsers/fibank';
import { categorize } from './categorizer';
import { CategorizedTransaction, Month } from './types';

// The MCP tool operates as a single configured user (the data is multi-tenant).
function uid(): string {
  const id = process.env.MCP_USER_ID;
  if (!id) throw new Error('MCP_USER_ID env var is not set (your Supabase user id).');
  return id;
}

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
        const monthId = await resolveMonthId(uid(), year, month);
        const m = (await one<Month>('SELECT * FROM months WHERE id = $1', [monthId]))!;
        const income = (await one<{ t: number }>("SELECT COALESCE(SUM(amount),0) as t FROM transactions WHERE month_id=$1 AND type='income'", [m.id]))!.t;
        const expenses = (await one<{ t: number }>("SELECT COALESCE(SUM(amount),0) as t FROM transactions WHERE month_id=$1 AND type='expense'", [m.id]))!.t;
        const byCategory = await query("SELECT c.display_name, c.type, COALESCE(SUM(t.amount),0) as total FROM categories c LEFT JOIN transactions t ON t.category_id=c.id AND t.month_id=$1 WHERE c.user_id=$2 AND c.is_active=1 GROUP BY c.id ORDER BY c.type, c.sort_order", [m.id, uid()]);
        const bal = (await computeBalances(uid(), year, month)) ?? { start_balance: 0, end_balance: 0 };
        return { content: [{ type: 'text', text: JSON.stringify({ income, expenses, saved: income - expenses, start_balance: bal.start_balance, end_balance: bal.end_balance, byCategory }) }] };
      }

      case 'get_transactions': {
        const { year, month, type, category, bank } = a as { year: number; month: number; type?: string; category?: string; bank?: string };
        const monthId = await resolveMonthId(uid(), year, month);
        const params: unknown[] = [monthId, uid()];
        const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
        let q = 'SELECT t.*, c.display_name as category_display_name FROM transactions t LEFT JOIN categories c ON t.category_id=c.id WHERE t.month_id=$1 AND t.user_id=$2';
        if (type) { q += ` AND t.type=${p(type)}`; }
        if (category) { q += ` AND c.name=${p(category)}`; }
        if (bank) { q += ` AND t.bank=${p(bank)}`; }
        q += ' ORDER BY t.date DESC';
        const txs = await query(q, params);
        return { content: [{ type: 'text', text: JSON.stringify(txs) }] };
      }

      case 'add_transaction': {
        const { year, month, date, amount, description, type, category, bank } = a as { year: number; month: number; date: string; amount: number; description: string; type: string; category?: string; bank: string };
        const monthId = await resolveMonthId(uid(), year, month);
        const cat = category ? await one<{ id: number }>('SELECT id FROM categories WHERE name=$1 AND user_id=$2', [category, uid()]) : undefined;
        const tx = await one('INSERT INTO transactions (user_id, month_id, date, amount, description, type, category_id, bank, manually_reviewed) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,1) RETURNING *', [uid(), monthId, date, amount, description, type, cat?.id ?? null, bank]);
        return { content: [{ type: 'text', text: JSON.stringify(tx) }] };
      }

      case 'update_transaction': {
        const { id, category, description, amount, date } = a as { id: number; category?: string; description?: string; amount?: number; date?: string };
        const cat = category ? await one<{ id: number }>('SELECT id FROM categories WHERE name=$1 AND user_id=$2', [category, uid()]) : undefined;
        const tx = await one('UPDATE transactions SET date=COALESCE($1,date), amount=COALESCE($2,amount), description=COALESCE($3,description), category_id=CASE WHEN $4::bigint IS NOT NULL THEN $4::bigint ELSE category_id END, manually_reviewed=1 WHERE id=$5 AND user_id=$6 RETURNING *', [date ?? null, amount ?? null, description ?? null, cat?.id ?? null, id, uid()]);
        return { content: [{ type: 'text', text: JSON.stringify(tx) }] };
      }

      case 'delete_transaction': {
        const { id } = a as { id: number };
        await query('DELETE FROM transactions WHERE id=$1 AND user_id=$2', [id, uid()]);
        return { content: [{ type: 'text', text: JSON.stringify({ success: true }) }] };
      }

      case 'import_transactions': {
        const { year, month, bank, file_content } = a as { year: number; month: number; bank: string; file_content: string };
        let raw;
        if (bank === 'revolut') raw = parseRevolut(file_content);
        else if (bank === 'santander') raw = parseSantander(Buffer.from(file_content, 'base64'));
        else raw = parseFibank(Buffer.from(file_content, 'base64'));
        const categorized = await categorize(raw, uid());
        return { content: [{ type: 'text', text: JSON.stringify({ transactions: categorized, year, month }) }] };
      }

      case 'confirm_import': {
        const { transactions, year, month } = a as { transactions: CategorizedTransaction[]; year: number; month: number };
        const monthId = await resolveMonthId(uid(), year, month);
        await withTx(async (client) => {
          for (const t of transactions) {
            await client.query('INSERT INTO transactions (user_id, month_id, date, amount, description, raw_description, type, category_id, bank) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [uid(), monthId, t.date, t.amount, t.description, t.raw_description, t.type, t.category_id ?? null, t.bank]);
          }
        });
        return { content: [{ type: 'text', text: JSON.stringify({ imported: transactions.length }) }] };
      }

      case 'get_budget': {
        const { year, month } = a as { year: number; month: number };
        const monthId = await resolveMonthId(uid(), year, month);
        const budgets = await query('SELECT b.*, c.display_name, c.name as category_name FROM budgets b JOIN categories c ON b.category_id=c.id WHERE b.month_id=$1 AND b.user_id=$2', [monthId, uid()]);
        return { content: [{ type: 'text', text: JSON.stringify(budgets) }] };
      }

      case 'set_budget': {
        const { year, month, category, planned } = a as { year: number; month: number; category: string; planned: number };
        const monthId = await resolveMonthId(uid(), year, month);
        const cat = await one<{ id: number }>('SELECT id FROM categories WHERE name=$1 AND user_id=$2', [category, uid()]);
        if (!cat) throw new Error(`Category '${category}' not found`);
        await query('INSERT INTO budgets (user_id, month_id, category_id, planned) VALUES ($1,$2,$3,$4) ON CONFLICT (month_id,category_id) DO UPDATE SET planned=EXCLUDED.planned', [uid(), monthId, cat.id, planned]);
        return { content: [{ type: 'text', text: JSON.stringify({ success: true }) }] };
      }

      case 'close_month': {
        const { year, month } = a as { year: number; month: number };
        await query("UPDATE months SET status='closed' WHERE year=$1 AND month=$2 AND user_id=$3", [year, month, uid()]);
        return { content: [{ type: 'text', text: JSON.stringify({ success: true }) }] };
      }

      case 'get_categories': {
        const cats = await query('SELECT * FROM categories WHERE user_id=$1 AND is_active=1 ORDER BY type, sort_order', [uid()]);
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

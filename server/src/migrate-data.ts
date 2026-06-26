// One-time migration of the original local SQLite data into Supabase Postgres,
// stamped with a user's auth id. Remaps all foreign keys (old sqlite ids -> new
// postgres ids). The vestigial `external_id` column is ignored.
//
//   npx ts-node src/migrate-data.ts <account-email> [sqlitePath]
import './env';
import path from 'path';
import Database from 'better-sqlite3';
import { getPool } from './db/pg';

/* eslint-disable @typescript-eslint/no-explicit-any */

async function main() {
  const email = process.argv[2];
  const sqlitePath = process.argv[3] ?? path.resolve(__dirname, '../data/finance.db');
  if (!email) {
    console.error('Usage: ts-node src/migrate-data.ts <account-email> [sqlitePath]');
    process.exit(1);
  }

  const pool = getPool();
  const u = await pool.query<{ id: string }>('SELECT id FROM auth.users WHERE email = $1', [email]);
  if (u.rowCount === 0) {
    console.error(`No Supabase user with email ${email}. Sign up / log in once first.`);
    process.exit(1);
  }
  const userId = u.rows[0].id;
  console.log(`Migrating into user ${userId} (${email})\n  from ${sqlitePath}`);

  const existing = await pool.query<{ c: number }>('SELECT COUNT(*)::int c FROM categories WHERE user_id = $1', [userId]);
  if (existing.rows[0].c > 0) {
    console.error(`User already has ${existing.rows[0].c} categories in Supabase — aborting to avoid duplicates.`);
    process.exit(1);
  }

  const sdb = new Database(sqlitePath, { readonly: true });
  const hasTable = (name: string) =>
    !!sdb.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const catMap = new Map<number, number>();
    for (const c of sdb.prepare('SELECT * FROM categories').all() as any[]) {
      const r = await client.query<{ id: number }>(
        'INSERT INTO categories (user_id, name, display_name, type, color, is_active, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
        [userId, c.name, c.display_name, c.type, c.color ?? '#71717a', c.is_active ?? 1, c.sort_order ?? 0],
      );
      catMap.set(c.id, r.rows[0].id);
    }

    const monthMap = new Map<number, number>();
    for (const m of sdb.prepare('SELECT * FROM months').all() as any[]) {
      const r = await client.query<{ id: number }>(
        'INSERT INTO months (user_id, year, month, status, start_balance, end_balance) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
        [userId, m.year, m.month, m.status ?? 'active', m.start_balance ?? 0, m.end_balance ?? 0],
      );
      monthMap.set(m.id, r.rows[0].id);
    }

    const groupMap = new Map<number, number>();
    if (hasTable('groups')) {
      for (const g of sdb.prepare('SELECT * FROM groups').all() as any[]) {
        const r = await client.query<{ id: number }>(
          'INSERT INTO groups (user_id, name, color) VALUES ($1,$2,$3) RETURNING id',
          [userId, g.name, g.color ?? '#71717a'],
        );
        groupMap.set(g.id, r.rows[0].id);
      }
    }

    let txCount = 0;
    for (const t of sdb.prepare('SELECT * FROM transactions').all() as any[]) {
      await client.query(
        `INSERT INTO transactions (user_id, month_id, date, amount, description, raw_description, type, category_id, bank, manually_reviewed, group_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          userId,
          monthMap.get(t.month_id),
          t.date, t.amount, t.description, t.raw_description ?? null, t.type,
          t.category_id != null ? catMap.get(t.category_id) ?? null : null,
          t.bank, t.manually_reviewed ?? 0,
          t.group_id != null ? groupMap.get(t.group_id) ?? null : null,
        ],
      );
      txCount++;
    }

    for (const b of sdb.prepare('SELECT * FROM budgets').all() as any[]) {
      await client.query(
        'INSERT INTO budgets (user_id, month_id, category_id, planned, is_active) VALUES ($1,$2,$3,$4,$5)',
        [userId, monthMap.get(b.month_id), catMap.get(b.category_id), b.planned ?? 0, b.is_active ?? 1],
      );
    }
    if (hasTable('stable_budgets')) {
      for (const sb of sdb.prepare('SELECT * FROM stable_budgets').all() as any[]) {
        await client.query(
          'INSERT INTO stable_budgets (user_id, category_id, planned, is_active) VALUES ($1,$2,$3,$4)',
          [userId, catMap.get(sb.category_id), sb.planned ?? 0, sb.is_active ?? 1],
        );
      }
    }
    if (hasTable('merchant_rules')) {
      for (const mr of sdb.prepare('SELECT * FROM merchant_rules').all() as any[]) {
        await client.query(
          'INSERT INTO merchant_rules (user_id, pattern, category_id, description_clean, match_amount, match_type, bank) VALUES ($1,$2,$3,$4,$5,$6,$7)',
          [userId, mr.pattern, mr.category_id != null ? catMap.get(mr.category_id) ?? null : null, mr.description_clean ?? null, mr.match_amount ?? null, mr.match_type ?? 'contains', mr.bank ?? null],
        );
      }
    }

    await client.query('COMMIT');
    console.log(`Migrated: ${catMap.size} categories, ${monthMap.size} months, ${groupMap.size} groups, ${txCount} transactions.`);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  sdb.close();
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });

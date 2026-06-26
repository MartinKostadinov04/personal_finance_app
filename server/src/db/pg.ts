// Postgres (Supabase) connection pool + small query helpers. Replaces the
// synchronous better-sqlite3 layer as routes are ported to async.
import { Pool, PoolClient, QueryResultRow, types } from 'pg';

// Parse bigint/int8 (ids, COUNT, SUM-of-int) as JS numbers — every id in this app
// fits in a safe integer and the rest of the code expects numbers, not strings.
types.setTypeParser(20, (v: string) => parseInt(v, 10));
// Keep timestamps as their raw Postgres string (the app's types model created_at as
// a string) rather than letting node-postgres convert them to Date objects.
types.setTypeParser(1114, (v: string) => v); // timestamp
types.setTypeParser(1184, (v: string) => v); // timestamptz

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL is not set (add it to the repo-root .env).');
    }
    pool = new Pool({
      connectionString,
      // Supabase requires TLS; its pooler presents a cert chain Node doesn't
      // bundle, so we don't hard-fail on verification.
      ssl: { rejectUnauthorized: false },
    });
  }
  return pool;
}

/** Run a query and return all rows. */
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const res = await getPool().query<T>(text, params);
  return res.rows;
}

/** Run a query and return the first row (or undefined). */
export async function one<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T | undefined> {
  const rows = await query<T>(text, params);
  return rows[0];
}

/** Run `fn` inside a transaction, committing on success and rolling back on error. */
export async function withTx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

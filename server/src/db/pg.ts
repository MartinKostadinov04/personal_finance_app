// Postgres (Supabase) connection pool + small query helpers. Replaces the
// synchronous better-sqlite3 layer as routes are ported to async.
//
// Row Level Security: inside an authenticated API request, middleware/rlsContext
// binds a request-scoped client (running as the `authenticated` role with the
// caller's JWT claims) via AsyncLocalStorage. The helpers below transparently
// use that client, so RLS is enforced for the server too. Outside a request
// (migrations, MCP server, startup health check) they use the shared admin pool.
import { Pool, PoolClient, QueryResultRow, types } from 'pg';
import { dbContext } from './context';

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

/**
 * The active database handle: the request-scoped client (RLS enforced) when
 * inside an authenticated request, otherwise the shared admin pool (BYPASSRLS).
 * Prefer the `query`/`one` helpers; use this only to hand a handle to a function
 * that accepts `Pool | PoolClient`.
 */
export function getDb(): Pool | PoolClient {
  return dbContext.getStore()?.client ?? getPool();
}

/** Run a query and return all rows. */
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const ctx = dbContext.getStore();
  const res = ctx
    ? await ctx.client.query<T>(text, params)
    : await getPool().query<T>(text, params);
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

/**
 * Run `fn` in a transaction, committing on success and rolling back on error.
 * Inside an authenticated request this reuses the request's client and brackets
 * `fn` with a uniquely-named SAVEPOINT (staying in the same RLS-scoped
 * transaction); outside one it opens its own transaction on a fresh admin client.
 */
export async function withTx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const ctx = dbContext.getStore();
  if (ctx) {
    const sp = `sp_${++ctx.savepointSeq}`;
    await ctx.client.query(`SAVEPOINT ${sp}`);
    try {
      const result = await fn(ctx.client);
      await ctx.client.query(`RELEASE SAVEPOINT ${sp}`);
      return result;
    } catch (e) {
      await ctx.client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
      throw e;
    }
  }
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

/**
 * Run `fn` with the database acting as the given user: a dedicated client, inside
 * a transaction, switched to the `authenticated` role with the user's JWT claims
 * set so `auth.uid()` resolves and Row Level Security is enforced. The client is
 * exposed to nested query/one/withTx calls via AsyncLocalStorage. Commits if `fn`
 * resolves; rolls back if it throws.
 */
export async function runWithUserContext<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    // Transaction-local (third arg = true): discarded on COMMIT/ROLLBACK, so a
    // pooled connection never leaks one user's identity into the next request.
    await client.query("SELECT set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: userId, role: 'authenticated' }),
    ]);
    await client.query('SET LOCAL ROLE authenticated');
    const result = await dbContext.run({ client, savepointSeq: 0 }, fn);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Ignore rollback failure (e.g. broken connection); rethrow the original error.
    }
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Run a single query against the admin pool (BYPASSRLS), ignoring any request
 * context. Use only for legitimately cross-user/bootstrap work — e.g. linking an
 * invited bill seat to a user who is not yet a participant (see provision.ts).
 */
export async function adminQuery<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const res = await getPool().query<T>(text, params);
  return res.rows;
}

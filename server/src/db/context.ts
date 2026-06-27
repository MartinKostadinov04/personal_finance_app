// Per-request database context. When an authenticated API request is in flight,
// middleware/rlsContext.ts binds a dedicated PoolClient here (running as the
// `authenticated` role with the user's JWT claims set), so the query helpers in
// pg.ts transparently run under Row Level Security without every route having to
// thread a client through. Outside a request (migrations, the MCP server, the
// startup health check) there is no store and the helpers fall back to the
// shared admin pool.
import { AsyncLocalStorage } from 'async_hooks';
import type { PoolClient } from 'pg';

export interface DbContext {
  /** Dedicated client for this request, inside a transaction with RLS enforced. */
  client: PoolClient;
  /** Monotonic counter used to name nested withTx() savepoints uniquely. */
  savepointSeq: number;
}

export const dbContext = new AsyncLocalStorage<DbContext>();

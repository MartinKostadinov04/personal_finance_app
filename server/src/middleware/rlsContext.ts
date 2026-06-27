import { Request, Response, NextFunction } from 'express';
import { runWithUserContext } from '../db/pg';

/**
 * Run the rest of an authenticated request inside a per-user database
 * transaction (see runWithUserContext): every query executes as the
 * `authenticated` role with the caller's JWT claims set, so Row Level Security is
 * enforced for the server too — a missing `WHERE user_id` can no longer leak
 * another account's data.
 *
 * The transaction commits when the response finishes normally and rolls back if
 * the handler fails (5xx) or the client disconnects before it completes.
 *
 * Mounted AFTER requireAuth + ensureProvisioned, so bootstrap and cross-user work
 * in provisioning keeps using the admin (BYPASSRLS) path.
 */
export function rlsContext(req: Request, res: Response, next: NextFunction): void {
  const userId = req.userId;
  if (!userId) {
    // requireAuth runs first and guarantees a user id; guard defensively.
    next();
    return;
  }

  runWithUserContext(
    userId,
    () =>
      new Promise<void>((resolve, reject) => {
        res.on('finish', () => {
          // Roll back on any non-success: the whole request is one transaction,
          // so a 4xx (bad input, auth fail, etc.) must not persist partial writes.
          if (res.statusCode >= 400) reject(new Error(`handler responded ${res.statusCode}`));
          else resolve();
        });
        res.on('close', () => {
          // Socket closed before the response finished — client aborted.
          if (!res.writableEnded) reject(new Error('client closed connection'));
        });
        next();
      }),
  ).catch((err: unknown) => {
    console.error('rlsContext:', err instanceof Error ? err.message : err);
    // If the DB context failed before next() was called, no response has been sent yet.
    if (!res.headersSent) res.status(503).json({ error: 'Service temporarily unavailable' });
  });
}

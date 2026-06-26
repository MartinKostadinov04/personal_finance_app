import { one } from './pg';

/**
 * Atomically resolve (and create if missing) a month row for a user, returning
 * its id. Uses an upsert with RETURNING so a single statement yields the id
 * whether the row already existed or was just created.
 */
export async function resolveMonthId(userId: string, year: number, month: number): Promise<number> {
  const row = await one<{ id: number }>(
    `INSERT INTO months (user_id, year, month) VALUES ($1, $2, $3)
     ON CONFLICT (user_id, year, month) DO UPDATE SET year = EXCLUDED.year
     RETURNING id`,
    [userId, year, month],
  );
  return row!.id;
}

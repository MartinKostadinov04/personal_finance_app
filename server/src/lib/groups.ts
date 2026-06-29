import type { PoolClient } from 'pg';

// Delete any of the given groups that no longer have member transactions.
// Call inside the same withTx as the deletion that may have emptied them so it
// commits atomically. NOT EXISTS makes it safe to call with a mix of ids —
// only the genuinely empty ones are removed.
export async function pruneEmptyGroups(
  client: PoolClient,
  userId: string,
  groupIds: Array<number | null | undefined>,
): Promise<void> {
  const ids = [...new Set(groupIds.filter((id): id is number => id != null))];
  if (ids.length === 0) return;
  await client.query(
    `DELETE FROM groups g
       WHERE g.user_id = $1 AND g.id = ANY($2)
         AND NOT EXISTS (
           SELECT 1 FROM transactions t WHERE t.group_id = g.id AND t.user_id = $1
         )`,
    [userId, ids],
  );
}

import Database from 'better-sqlite3';

/**
 * Atomically resolve (and create if missing) a month row, returning its id.
 * Wraps INSERT OR IGNORE + SELECT in a single transaction so two concurrent
 * callers cannot interleave and read a stale id.
 */
export function resolveMonthId(db: Database.Database, year: number, month: number): number {
  const tx = db.transaction((y: number, m: number) => {
    db.prepare('INSERT OR IGNORE INTO months (year, month) VALUES (?, ?)').run(y, m);
    const row = db.prepare('SELECT id FROM months WHERE year = ? AND month = ?').get(y, m) as { id: number };
    return row.id;
  });
  return tx(year, month);
}

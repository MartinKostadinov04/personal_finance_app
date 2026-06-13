import Database from 'better-sqlite3';
import {
  CATEGORIES_SCHEMA,
  MONTHS_SCHEMA,
  TRANSACTIONS_SCHEMA,
  BUDGETS_SCHEMA,
  STABLE_BUDGETS_SCHEMA,
  MERCHANT_RULES_SCHEMA,
  GROUPS_SCHEMA,
} from './schema';

export function runMigrations(db: Database.Database): void {
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(CATEGORIES_SCHEMA);
  db.exec(MONTHS_SCHEMA);
  db.exec(TRANSACTIONS_SCHEMA);
  db.exec(BUDGETS_SCHEMA);
  db.exec(STABLE_BUDGETS_SCHEMA);
  db.exec(MERCHANT_RULES_SCHEMA);
  db.exec(GROUPS_SCHEMA);

  // Add group_id overlay column to transactions (idempotent). ON DELETE SET NULL
  // auto-ungroups members when a group is deleted (foreign_keys pragma is ON).
  try { db.exec('ALTER TABLE transactions ADD COLUMN group_id INTEGER REFERENCES groups(id) ON DELETE SET NULL'); } catch { /* already exists */ }
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_transactions_group_id ON transactions(group_id)'); } catch { /* already exists */ }

  // Add match_amount column to existing merchant_rules tables (idempotent)
  try { db.exec('ALTER TABLE merchant_rules ADD COLUMN match_amount REAL'); } catch { /* already exists */ }
  // Add match_type column (idempotent)
  try { db.exec("ALTER TABLE merchant_rules ADD COLUMN match_type TEXT NOT NULL DEFAULT 'contains'"); } catch { /* already exists */ }
  // Add is_active to budgets (idempotent — pre-existing DBs)
  try { db.exec('ALTER TABLE budgets ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1'); } catch { /* already exists */ }
}

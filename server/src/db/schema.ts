export const CATEGORIES_SCHEMA = `
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  type TEXT NOT NULL,
  color TEXT DEFAULT '#71717a',
  is_active INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
)`;

export const MONTHS_SCHEMA = `
CREATE TABLE IF NOT EXISTS months (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL,
  status TEXT DEFAULT 'active',
  start_balance REAL DEFAULT 0,
  end_balance REAL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(year, month)
)`;

export const TRANSACTIONS_SCHEMA = `
CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  month_id INTEGER NOT NULL REFERENCES months(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  amount REAL NOT NULL,
  description TEXT NOT NULL,
  raw_description TEXT,
  type TEXT NOT NULL,
  category_id INTEGER REFERENCES categories(id),
  bank TEXT NOT NULL,
  manually_reviewed INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_transactions_month_id    ON transactions(month_id);
CREATE INDEX IF NOT EXISTS idx_transactions_category_id ON transactions(category_id);
CREATE INDEX IF NOT EXISTS idx_transactions_date        ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_transactions_raw_desc    ON transactions(raw_description);
`;

export const BUDGETS_SCHEMA = `
CREATE TABLE IF NOT EXISTS budgets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  month_id INTEGER NOT NULL REFERENCES months(id) ON DELETE CASCADE,
  category_id INTEGER NOT NULL REFERENCES categories(id),
  planned REAL NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  UNIQUE(month_id, category_id)
)`;

// Cross-month budget defaults — one row per category, applies to every month
// unless overridden by a monthly `budgets` row for the same category.
export const STABLE_BUDGETS_SCHEMA = `
CREATE TABLE IF NOT EXISTS stable_budgets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL UNIQUE REFERENCES categories(id),
  planned REAL NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1
)`;

export const MERCHANT_RULES_SCHEMA = `
CREATE TABLE IF NOT EXISTS merchant_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pattern TEXT NOT NULL UNIQUE,
  category_id INTEGER REFERENCES categories(id),
  description_clean TEXT,
  match_amount REAL,
  match_type TEXT NOT NULL DEFAULT 'contains',
  bank TEXT,
  created_at TEXT DEFAULT (datetime('now'))
)`;

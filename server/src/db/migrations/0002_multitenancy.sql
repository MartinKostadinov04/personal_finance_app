-- Multi-tenancy: every finance row is owned by a user (Supabase auth uid).
-- The Postgres tables so far hold only disposable seed data (no real user data
-- yet — that still lives in the old SQLite DB and is migrated in separately), so
-- we clear them before adding the NOT NULL user_id. New users are provisioned
-- with default categories + the current month on first login.
TRUNCATE transactions, budgets, stable_budgets, merchant_rules, groups, months, categories RESTART IDENTITY CASCADE;

ALTER TABLE categories     ADD COLUMN user_id uuid NOT NULL;
ALTER TABLE months         ADD COLUMN user_id uuid NOT NULL;
ALTER TABLE transactions   ADD COLUMN user_id uuid NOT NULL;
ALTER TABLE budgets        ADD COLUMN user_id uuid NOT NULL;
ALTER TABLE stable_budgets ADD COLUMN user_id uuid NOT NULL;
ALTER TABLE merchant_rules ADD COLUMN user_id uuid NOT NULL;
ALTER TABLE groups         ADD COLUMN user_id uuid NOT NULL;

-- Replace global unique constraints with per-user ones.
ALTER TABLE categories     DROP CONSTRAINT IF EXISTS categories_name_key;
ALTER TABLE categories     ADD CONSTRAINT categories_user_name_key UNIQUE (user_id, name);
ALTER TABLE months         DROP CONSTRAINT IF EXISTS months_year_month_key;
ALTER TABLE months         ADD CONSTRAINT months_user_year_month_key UNIQUE (user_id, year, month);
ALTER TABLE groups         DROP CONSTRAINT IF EXISTS groups_name_key;
ALTER TABLE groups         ADD CONSTRAINT groups_user_name_key UNIQUE (user_id, name);
ALTER TABLE merchant_rules DROP CONSTRAINT IF EXISTS merchant_rules_pattern_key;
ALTER TABLE merchant_rules ADD CONSTRAINT merchant_rules_user_pattern_key UNIQUE (user_id, pattern);
ALTER TABLE stable_budgets DROP CONSTRAINT IF EXISTS stable_budgets_category_id_key;
ALTER TABLE stable_budgets ADD CONSTRAINT stable_budgets_user_category_key UNIQUE (user_id, category_id);
-- budgets stays UNIQUE(month_id, category_id): month_id is already user-scoped.

CREATE INDEX IF NOT EXISTS idx_categories_user     ON categories(user_id);
CREATE INDEX IF NOT EXISTS idx_months_user         ON months(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_user   ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_budgets_user        ON budgets(user_id);
CREATE INDEX IF NOT EXISTS idx_merchant_rules_user ON merchant_rules(user_id);
CREATE INDEX IF NOT EXISTS idx_groups_user         ON groups(user_id);

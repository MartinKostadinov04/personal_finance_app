-- 0001_init.sql — initial Postgres schema, parity with the original SQLite schema.
-- Single-user for now; per-user ownership (user_id) is added in a later migration
-- (Phase 3). Booleans are kept as integer 0/1 to match the existing route code.

CREATE TABLE IF NOT EXISTS categories (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name         text NOT NULL UNIQUE,
  display_name text NOT NULL,
  type         text NOT NULL,
  color        text DEFAULT '#71717a',
  is_active    integer DEFAULT 1,
  sort_order   integer DEFAULT 0,
  created_at   timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS months (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  year          integer NOT NULL,
  month         integer NOT NULL,
  status        text DEFAULT 'active',
  start_balance double precision DEFAULT 0,
  end_balance   double precision DEFAULT 0,
  created_at    timestamptz DEFAULT now(),
  UNIQUE (year, month)
);

-- Created before transactions because transactions.group_id references it.
CREATE TABLE IF NOT EXISTS groups (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name       text NOT NULL UNIQUE,
  color      text DEFAULT '#71717a',
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS transactions (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  month_id          bigint NOT NULL REFERENCES months(id) ON DELETE CASCADE,
  date              text NOT NULL,
  amount            double precision NOT NULL,
  description       text NOT NULL,
  raw_description   text,
  type              text NOT NULL,
  category_id       bigint REFERENCES categories(id),
  bank              text NOT NULL,
  manually_reviewed integer DEFAULT 0,
  group_id          bigint REFERENCES groups(id) ON DELETE SET NULL,
  created_at        timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS budgets (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  month_id    bigint NOT NULL REFERENCES months(id) ON DELETE CASCADE,
  category_id bigint NOT NULL REFERENCES categories(id),
  planned     double precision NOT NULL DEFAULT 0,
  is_active   integer NOT NULL DEFAULT 1,
  UNIQUE (month_id, category_id)
);

CREATE TABLE IF NOT EXISTS stable_budgets (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  category_id bigint NOT NULL UNIQUE REFERENCES categories(id),
  planned     double precision NOT NULL DEFAULT 0,
  is_active   integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS merchant_rules (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  pattern           text NOT NULL UNIQUE,
  category_id       bigint REFERENCES categories(id),
  description_clean text,
  match_amount      double precision,
  match_type        text NOT NULL DEFAULT 'contains',
  bank              text,
  created_at        timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_transactions_month_id    ON transactions(month_id);
CREATE INDEX IF NOT EXISTS idx_transactions_category_id ON transactions(category_id);
CREATE INDEX IF NOT EXISTS idx_transactions_date        ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_transactions_raw_desc    ON transactions(raw_description);
CREATE INDEX IF NOT EXISTS idx_transactions_group_id    ON transactions(group_id);

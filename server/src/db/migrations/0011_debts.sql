-- Personal debt ledger: who owes the user money and whom the user owes.
-- Unlike Bill Splitting (shared, multi-participant), a debt is PRIVATE to one
-- user — the counterparty is just a named contact, not an account. So these are
-- owner-only personal tables, exactly like categories/groups, and use the simple
-- `user_id = auth.uid()` RLS policy (no membership helpers needed). The policy
-- reads the row's own user_id column, which is visible during INSERT ... RETURNING,
-- so the bills RETURNING gotcha (migrations 0008/0009) does not apply here.

-- A reusable named counterparty, find-or-create per user (case-sensitive name).
CREATE TABLE IF NOT EXISTS debt_contacts (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    uuid NOT NULL,
  name       text NOT NULL,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT debt_contacts_user_name_key UNIQUE (user_id, name)
);
CREATE INDEX IF NOT EXISTS idx_debt_contacts_user ON debt_contacts(user_id);

-- One obligation in a direction. amount = original principal (always positive);
-- the outstanding balance is computed (amount - Σ payments), never stored.
CREATE TABLE IF NOT EXISTS debts (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     uuid NOT NULL,
  contact_id  bigint NOT NULL REFERENCES debt_contacts(id) ON DELETE CASCADE,
  direction   text NOT NULL,                 -- 'owed_to_me' | 'i_owe'
  amount      double precision NOT NULL,
  currency    text NOT NULL DEFAULT 'EUR',
  description text,
  status      text NOT NULL DEFAULT 'open',  -- 'open' | 'settled' (derived, kept in sync)
  incurred_on date NOT NULL DEFAULT current_date,
  due_date    date,
  settled_at  timestamptz,
  created_at  timestamptz DEFAULT now(),
  CONSTRAINT debts_direction_chk CHECK (direction IN ('owed_to_me', 'i_owe')),
  CONSTRAINT debts_amount_chk CHECK (amount > 0),
  CONSTRAINT debts_status_chk CHECK (status IN ('open', 'settled'))
);
CREATE INDEX IF NOT EXISTS idx_debts_user    ON debts(user_id);
CREATE INDEX IF NOT EXISTS idx_debts_contact ON debts(contact_id);

-- A repayment against a debt. transaction_id optionally links to a real finance
-- transaction (the opt-in "also record as income/expense"); ON DELETE SET NULL so
-- deleting that transaction never erases the repayment record.
CREATE TABLE IF NOT EXISTS debt_payments (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id        uuid NOT NULL,
  debt_id        bigint NOT NULL REFERENCES debts(id) ON DELETE CASCADE,
  amount         double precision NOT NULL,
  paid_on        date NOT NULL DEFAULT current_date,
  note           text,
  transaction_id bigint REFERENCES transactions(id) ON DELETE SET NULL,
  created_at     timestamptz DEFAULT now(),
  CONSTRAINT debt_payments_amount_chk CHECK (amount > 0)
);
CREATE INDEX IF NOT EXISTS idx_debt_payments_user ON debt_payments(user_id);
CREATE INDEX IF NOT EXISTS idx_debt_payments_debt ON debt_payments(debt_id);

-- ---------------------------------------------------------------------------
-- RLS: owner-only on all three tables (mirrors categories/groups in 0006_rls.sql).
-- ---------------------------------------------------------------------------
ALTER TABLE public.debt_contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY debt_contacts_owner ON public.debt_contacts
  FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

ALTER TABLE public.debts ENABLE ROW LEVEL SECURITY;
CREATE POLICY debts_owner ON public.debts
  FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

ALTER TABLE public.debt_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY debt_payments_owner ON public.debt_payments
  FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

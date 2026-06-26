-- Bill Splitting. Bills are SHARED objects (not part of any one user's private
-- finance workspace): access is by participant membership, tracked separately
-- from the per-user finance tables.

CREATE TABLE IF NOT EXISTS bills (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name       text NOT NULL,
  status     text NOT NULL DEFAULT 'open',   -- 'open' | 'closed'
  currency   text NOT NULL DEFAULT 'EUR',
  created_by uuid NOT NULL,
  created_at timestamptz DEFAULT now(),
  closed_at  timestamptz
);

-- A "seat" in a bill. Either a registered user (user_id) or an email-only guest.
CREATE TABLE IF NOT EXISTS bill_participants (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  bill_id       bigint NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  user_id       uuid,                          -- set when linked to a registered user
  email         text,                          -- for guests / pending invites
  display_name  text NOT NULL,
  role          text NOT NULL DEFAULT 'member', -- 'owner' | 'member'
  status        text NOT NULL DEFAULT 'active', -- 'active' | 'invited' | 'pending'
  -- Bill-wide merge: this participant's shares are covered by another participant.
  covered_by_participant_id bigint REFERENCES bill_participants(id) ON DELETE SET NULL,
  settled       boolean NOT NULL DEFAULT false,
  settled_at    timestamptz,
  created_at    timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bill_participants_bill ON bill_participants(bill_id);
CREATE INDEX IF NOT EXISTS idx_bill_participants_user ON bill_participants(user_id);

CREATE TABLE IF NOT EXISTS bill_expenses (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  bill_id      bigint NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  name         text NOT NULL,
  amount       double precision NOT NULL,
  spent_at     timestamptz NOT NULL DEFAULT now(),
  receipt_path text,                            -- Supabase Storage object path
  created_by   uuid NOT NULL,
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bill_expenses_bill ON bill_expenses(bill_id);

-- Who paid an expense (one or more payers; Σ amount_paid = expense amount).
CREATE TABLE IF NOT EXISTS bill_expense_payers (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  expense_id     bigint NOT NULL REFERENCES bill_expenses(id) ON DELETE CASCADE,
  participant_id bigint NOT NULL REFERENCES bill_participants(id) ON DELETE CASCADE,
  amount_paid    double precision NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bill_expense_payers_expense ON bill_expense_payers(expense_id);

-- Who owes a share of an expense (Σ share_amount = expense amount). The optional
-- per-expense covered_by overrides the participant's bill-wide merge.
CREATE TABLE IF NOT EXISTS bill_expense_splits (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  expense_id     bigint NOT NULL REFERENCES bill_expenses(id) ON DELETE CASCADE,
  participant_id bigint NOT NULL REFERENCES bill_participants(id) ON DELETE CASCADE,
  share_amount   double precision NOT NULL,
  covered_by_participant_id bigint REFERENCES bill_participants(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_bill_expense_splits_expense ON bill_expense_splits(expense_id);

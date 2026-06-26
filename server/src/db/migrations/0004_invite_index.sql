-- Speeds up claiming invited bill seats by email when a user logs in.
CREATE INDEX IF NOT EXISTS idx_bill_participants_email ON bill_participants (lower(email));

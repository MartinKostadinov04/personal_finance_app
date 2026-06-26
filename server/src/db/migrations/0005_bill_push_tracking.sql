-- Track the transaction a participant pushed into their finance workspace, so
-- re-pushing updates that transaction instead of creating a duplicate.
ALTER TABLE bill_participants
  ADD COLUMN IF NOT EXISTS pushed_transaction_id bigint REFERENCES transactions(id) ON DELETE SET NULL;

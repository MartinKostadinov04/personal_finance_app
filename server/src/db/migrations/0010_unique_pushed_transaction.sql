-- Enforce the invariant that a finance transaction can be the "pushed" transaction
-- of at most one bill-participant seat.
--
-- The push-to-finance flow already upholds this (one seat per user per bill, one
-- transaction created per push), but nothing at the database level guaranteed it.
-- This partial unique index:
--   * guarantees the reverse link is 1:1, so the LEFT JOIN bill_participants in
--     GET /api/transactions (ON pushed_transaction_id = t.id) can never duplicate a
--     transaction row, and
--   * turns that join into an indexed single-row probe instead of a sequential scan.
--
-- Partial (WHERE ... IS NOT NULL) so the many seats that have never pushed — all
-- NULL — are exempt and do not collide with each other.
CREATE UNIQUE INDEX IF NOT EXISTS bill_participants_pushed_tx_uniq
  ON public.bill_participants (pushed_transaction_id)
  WHERE pushed_transaction_id IS NOT NULL;

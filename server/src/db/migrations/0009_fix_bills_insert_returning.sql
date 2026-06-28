-- Fix bill creation failing with "new row violates row-level security policy
-- for table bills" on every POST /api/bills.
--
-- Root cause (NOT the INSERT WITH CHECK, despite the error wording):
-- The server creates a bill with `INSERT INTO bills (...) RETURNING *`
-- (server/src/routes/bills.ts). INSERT ... RETURNING additionally evaluates the
-- table's SELECT policy against the new row. bills_select used
-- private.can_access_bill(id), which re-queries bills/bill_participants looking for
-- a matching row. During INSERT ... RETURNING the new bill is not yet visible to
-- that nested SELECT and no participant row exists yet, so can_access_bill returned
-- false and the statement aborted. (A plain INSERT without RETURNING succeeds.)
--
-- This was a latent bug from when RLS was first enabled: bill creation through the
-- app never worked once bills_select depended on a self-referential function.
--
-- Fix: authorize the creator in bills_select via the row's OWN created_by column,
-- which IS visible during RETURNING. Members still resolve via can_access_bill.
ALTER POLICY bills_select ON public.bills
  USING (created_by = auth.uid() OR private.can_access_bill(id));

-- Revert the unnecessary helper added in 0008: bare auth.uid() works correctly in
-- policy expressions, so the insert/delete checks go back to the original direct
-- column comparison and the redundant private.is_creator() wrapper is removed.
DROP POLICY bills_insert ON public.bills;
CREATE POLICY bills_insert ON public.bills
  FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());

DROP POLICY bills_delete ON public.bills;
CREATE POLICY bills_delete ON public.bills
  FOR DELETE TO authenticated
  USING (created_by = auth.uid());

DROP FUNCTION IF EXISTS private.is_creator(uuid);

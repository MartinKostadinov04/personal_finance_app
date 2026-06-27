-- Move the RLS membership helpers into a `private` schema that is NOT exposed to
-- the PostgREST Data API, so they can no longer be invoked as /rest/v1/rpc
-- endpoints while remaining usable inside policies. Addresses the advisors
-- "Public/Signed-in users can execute SECURITY DEFINER function" (0028/0029).

CREATE SCHEMA IF NOT EXISTS private;
GRANT USAGE ON SCHEMA private TO authenticated;

CREATE OR REPLACE FUNCTION private.can_access_bill(p_bill_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM bill_participants bp
    WHERE bp.bill_id = p_bill_id AND bp.user_id = auth.uid()
  ) OR EXISTS (
    SELECT 1 FROM bills b
    WHERE b.id = p_bill_id AND b.created_by = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION private.is_expense_member(p_expense_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM bill_expenses e
    WHERE e.id = p_expense_id AND private.can_access_bill(e.bill_id)
  );
$$;

REVOKE ALL ON FUNCTION private.can_access_bill(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.is_expense_member(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.can_access_bill(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION private.is_expense_member(bigint) TO authenticated;

-- Repoint every policy that referenced the public helpers to the private ones.
DROP POLICY bills_select ON public.bills;
CREATE POLICY bills_select ON public.bills
  FOR SELECT TO authenticated
  USING (private.can_access_bill(id));

DROP POLICY bills_update ON public.bills;
CREATE POLICY bills_update ON public.bills
  FOR UPDATE TO authenticated
  USING (private.can_access_bill(id)) WITH CHECK (private.can_access_bill(id));

DROP POLICY bill_participants_member ON public.bill_participants;
CREATE POLICY bill_participants_member ON public.bill_participants
  FOR ALL TO authenticated
  USING (private.can_access_bill(bill_id)) WITH CHECK (private.can_access_bill(bill_id));

DROP POLICY bill_expenses_member ON public.bill_expenses;
CREATE POLICY bill_expenses_member ON public.bill_expenses
  FOR ALL TO authenticated
  USING (private.can_access_bill(bill_id)) WITH CHECK (private.can_access_bill(bill_id));

DROP POLICY bill_expense_payers_member ON public.bill_expense_payers;
CREATE POLICY bill_expense_payers_member ON public.bill_expense_payers
  FOR ALL TO authenticated
  USING (private.is_expense_member(expense_id)) WITH CHECK (private.is_expense_member(expense_id));

DROP POLICY bill_expense_splits_member ON public.bill_expense_splits;
CREATE POLICY bill_expense_splits_member ON public.bill_expense_splits
  FOR ALL TO authenticated
  USING (private.is_expense_member(expense_id)) WITH CHECK (private.is_expense_member(expense_id));

-- Drop the API-exposed copies (is_expense_member depends on can_access_bill).
DROP FUNCTION public.is_expense_member(bigint);
DROP FUNCTION public.can_access_bill(bigint);

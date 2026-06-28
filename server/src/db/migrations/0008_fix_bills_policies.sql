-- Fix bills_insert and bills_delete RLS policies.
--
-- Both previously called auth.uid() directly inside the policy expression.
-- This works for SECURITY DEFINER functions (like private.can_access_bill) where
-- auth.uid() runs as the function owner, but NOT when called bare by the
-- `authenticated` role during an INSERT WITH CHECK evaluation.
--
-- Solution: add a private.is_creator(uuid) SECURITY DEFINER helper — same pattern
-- as private.can_access_bill — and repoint both policies to use it.

CREATE OR REPLACE FUNCTION private.is_creator(p_created_by uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_created_by = auth.uid()
$$;

REVOKE ALL ON FUNCTION private.is_creator(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.is_creator(uuid) TO authenticated;

DROP POLICY bills_insert ON public.bills;
CREATE POLICY bills_insert ON public.bills
  FOR INSERT TO authenticated
  WITH CHECK (private.is_creator(created_by));

DROP POLICY bills_delete ON public.bills;
CREATE POLICY bills_delete ON public.bills
  FOR DELETE TO authenticated
  USING (private.is_creator(created_by));

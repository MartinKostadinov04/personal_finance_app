-- Enable Row Level Security and per-tenant policies on every public table.
--
-- Until now isolation was enforced only in app code (WHERE user_id = ...). That
-- leaves the database itself open: the public anon key shipped to the browser,
-- together with the PostgREST Data API, could read/modify every table directly.
-- These policies make the database the source of truth for tenant isolation.
--
-- Two patterns:
--   * Personal tables  -> owner-only:  user_id = auth.uid()
--   * Bill tables      -> membership:  caller participates in (or created) the bill
--
-- The backend connects as a BYPASSRLS role for migrations/bootstrap, but normal
-- API requests run as the `authenticated` role with request.jwt.claims set, so
-- these policies are enforced for the server too (see middleware/rlsContext.ts).

-- ---------------------------------------------------------------------------
-- Membership helpers.
-- SECURITY DEFINER so their internal reads run as the function owner and are NOT
-- themselves subject to RLS — this both avoids infinite recursion (a policy on
-- bill_participants that reads bill_participants) and lets a participant resolve
-- a bill they can see without needing direct row access to the lookup tables.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_access_bill(p_bill_id bigint)
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

CREATE OR REPLACE FUNCTION public.is_expense_member(p_expense_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM bill_expenses e
    WHERE e.id = p_expense_id AND public.can_access_bill(e.bill_id)
  );
$$;

REVOKE ALL ON FUNCTION public.can_access_bill(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_expense_member(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_access_bill(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_expense_member(bigint) TO authenticated;

-- ---------------------------------------------------------------------------
-- Personal tables: a row is visible only to the user who owns it.
-- ---------------------------------------------------------------------------
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY categories_owner ON public.categories
  FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

ALTER TABLE public.months ENABLE ROW LEVEL SECURITY;
CREATE POLICY months_owner ON public.months
  FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY transactions_owner ON public.transactions
  FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

ALTER TABLE public.budgets ENABLE ROW LEVEL SECURITY;
CREATE POLICY budgets_owner ON public.budgets
  FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

ALTER TABLE public.stable_budgets ENABLE ROW LEVEL SECURITY;
CREATE POLICY stable_budgets_owner ON public.stable_budgets
  FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

ALTER TABLE public.merchant_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY merchant_rules_owner ON public.merchant_rules
  FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY groups_owner ON public.groups
  FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Bill-splitting tables: shared between the participants of a bill.
-- ---------------------------------------------------------------------------
ALTER TABLE public.bills ENABLE ROW LEVEL SECURITY;
CREATE POLICY bills_select ON public.bills
  FOR SELECT TO authenticated
  USING (public.can_access_bill(id));
CREATE POLICY bills_insert ON public.bills
  FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());
CREATE POLICY bills_update ON public.bills
  FOR UPDATE TO authenticated
  USING (public.can_access_bill(id)) WITH CHECK (public.can_access_bill(id));
CREATE POLICY bills_delete ON public.bills
  FOR DELETE TO authenticated
  USING (created_by = auth.uid());

ALTER TABLE public.bill_participants ENABLE ROW LEVEL SECURITY;
CREATE POLICY bill_participants_member ON public.bill_participants
  FOR ALL TO authenticated
  USING (public.can_access_bill(bill_id)) WITH CHECK (public.can_access_bill(bill_id));

ALTER TABLE public.bill_expenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY bill_expenses_member ON public.bill_expenses
  FOR ALL TO authenticated
  USING (public.can_access_bill(bill_id)) WITH CHECK (public.can_access_bill(bill_id));

ALTER TABLE public.bill_expense_payers ENABLE ROW LEVEL SECURITY;
CREATE POLICY bill_expense_payers_member ON public.bill_expense_payers
  FOR ALL TO authenticated
  USING (public.is_expense_member(expense_id)) WITH CHECK (public.is_expense_member(expense_id));

ALTER TABLE public.bill_expense_splits ENABLE ROW LEVEL SECURITY;
CREATE POLICY bill_expense_splits_member ON public.bill_expense_splits
  FOR ALL TO authenticated
  USING (public.is_expense_member(expense_id)) WITH CHECK (public.is_expense_member(expense_id));

-- ---------------------------------------------------------------------------
-- Internal bookkeeping table: no policy => no access for anon/authenticated.
-- The migration runner connects as a BYPASSRLS role, so it is unaffected.
-- ---------------------------------------------------------------------------
ALTER TABLE public._migrations ENABLE ROW LEVEL SECURITY;

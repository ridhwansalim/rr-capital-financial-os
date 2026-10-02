-- Optional personal modules are controlled by owner-scoped flags. A missing
-- row is disabled; turning a flag off never deletes its saved module data.
CREATE TABLE public.user_feature_flags (
  owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  feature_key text NOT NULL CHECK (feature_key IN (
    'budgets', 'savings_goals', 'shopping_lists', 'calculators', 'financial_health_score', 'account_health'
  )),
  enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, feature_key)
);
CREATE FUNCTION private.touch_updated_at() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER user_feature_flags_touch_updated_at
  BEFORE UPDATE ON public.user_feature_flags
  FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();
REVOKE ALL ON FUNCTION private.touch_updated_at() FROM PUBLIC, anon, authenticated;
ALTER TABLE public.user_feature_flags ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_feature_flags_select_own ON public.user_feature_flags
  FOR SELECT TO authenticated USING (owner_id = (SELECT auth.uid()));
CREATE POLICY user_feature_flags_insert_own ON public.user_feature_flags
  FOR INSERT TO authenticated WITH CHECK (owner_id = (SELECT auth.uid()));
CREATE POLICY user_feature_flags_update_own ON public.user_feature_flags
  FOR UPDATE TO authenticated USING (owner_id = (SELECT auth.uid()))
  WITH CHECK (owner_id = (SELECT auth.uid()));
REVOKE ALL ON public.user_feature_flags FROM authenticated, anon;
GRANT SELECT ON public.user_feature_flags TO authenticated;
GRANT INSERT (feature_key, enabled), UPDATE (enabled) ON public.user_feature_flags TO authenticated;
REVOKE ALL ON public.user_feature_flags FROM anon;

-- One personal monthly envelope per category. Budgets never post ledger rows.
CREATE TABLE public.budget_envelopes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  category_id uuid NOT NULL,
  monthly_limit numeric(14,2) NOT NULL CHECK (monthly_limit > 0),
  rollover_enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT budget_envelopes_owner_category_key UNIQUE (owner_id, category_id),
  CONSTRAINT budget_envelopes_category_owner_fkey FOREIGN KEY (category_id, owner_id)
    REFERENCES public.transaction_categories(id, owner_id) ON DELETE CASCADE
);
CREATE INDEX budget_envelopes_owner_idx ON public.budget_envelopes(owner_id, created_at);
ALTER TABLE public.budget_envelopes ENABLE ROW LEVEL SECURITY;
CREATE POLICY budget_envelopes_select_enabled_own ON public.budget_envelopes
  FOR SELECT TO authenticated USING (
    owner_id = (SELECT auth.uid()) AND EXISTS (
      SELECT 1 FROM public.user_feature_flags f
       WHERE f.owner_id = (SELECT auth.uid()) AND f.feature_key = 'budgets' AND f.enabled
    )
  );
CREATE POLICY budget_envelopes_insert_enabled_own ON public.budget_envelopes
  FOR INSERT TO authenticated WITH CHECK (
    owner_id = (SELECT auth.uid()) AND EXISTS (
      SELECT 1 FROM public.user_feature_flags f
       WHERE f.owner_id = (SELECT auth.uid()) AND f.feature_key = 'budgets' AND f.enabled
    )
  );
CREATE POLICY budget_envelopes_update_enabled_own ON public.budget_envelopes
  FOR UPDATE TO authenticated USING (
    owner_id = (SELECT auth.uid()) AND EXISTS (
      SELECT 1 FROM public.user_feature_flags f
       WHERE f.owner_id = (SELECT auth.uid()) AND f.feature_key = 'budgets' AND f.enabled
    )
  ) WITH CHECK (
    owner_id = (SELECT auth.uid()) AND EXISTS (
      SELECT 1 FROM public.user_feature_flags f
       WHERE f.owner_id = (SELECT auth.uid()) AND f.feature_key = 'budgets' AND f.enabled
    )
  );
CREATE POLICY budget_envelopes_delete_enabled_own ON public.budget_envelopes
  FOR DELETE TO authenticated USING (
    owner_id = (SELECT auth.uid()) AND EXISTS (
      SELECT 1 FROM public.user_feature_flags f
       WHERE f.owner_id = (SELECT auth.uid()) AND f.feature_key = 'budgets' AND f.enabled
    )
  );
REVOKE ALL ON public.budget_envelopes FROM authenticated, anon;
GRANT SELECT, DELETE ON public.budget_envelopes TO authenticated;
GRANT INSERT (category_id, monthly_limit, rollover_enabled),
      UPDATE (monthly_limit, rollover_enabled) ON public.budget_envelopes TO authenticated;
REVOKE ALL ON public.budget_envelopes FROM anon;

NOTIFY pgrst, 'reload schema';

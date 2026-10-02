-- User-entered account context. This table never stores or changes ledger
-- balances; it only holds optional thresholds and monthly statement/due days.
CREATE TABLE public.account_health_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  minimum_balance numeric(14,2) CHECK (minimum_balance IS NULL OR minimum_balance >= 0),
  statement_day smallint CHECK (statement_day IS NULL OR statement_day BETWEEN 1 AND 31),
  due_day smallint CHECK (due_day IS NULL OR due_day BETWEEN 1 AND 31),
  show_notices boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT account_health_settings_owner_account_key UNIQUE(owner_id, account_id)
);
CREATE INDEX account_health_settings_owner_idx ON public.account_health_settings(owner_id);
ALTER TABLE public.account_health_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY account_health_settings_select_enabled_own ON public.account_health_settings
  FOR SELECT TO authenticated USING (
    owner_id = (SELECT auth.uid()) AND EXISTS (
      SELECT 1 FROM public.user_feature_flags f
       WHERE f.owner_id = (SELECT auth.uid()) AND f.feature_key = 'account_health' AND f.enabled
    )
  );
CREATE POLICY account_health_settings_insert_enabled_own ON public.account_health_settings
  FOR INSERT TO authenticated WITH CHECK (
    owner_id = (SELECT auth.uid()) AND EXISTS (
      SELECT 1 FROM public.user_feature_flags f
       WHERE f.owner_id = (SELECT auth.uid()) AND f.feature_key = 'account_health' AND f.enabled
    )
  );
CREATE POLICY account_health_settings_update_enabled_own ON public.account_health_settings
  FOR UPDATE TO authenticated USING (
    owner_id = (SELECT auth.uid()) AND EXISTS (
      SELECT 1 FROM public.user_feature_flags f
       WHERE f.owner_id = (SELECT auth.uid()) AND f.feature_key = 'account_health' AND f.enabled
    )
  ) WITH CHECK (
    owner_id = (SELECT auth.uid()) AND EXISTS (
      SELECT 1 FROM public.user_feature_flags f
       WHERE f.owner_id = (SELECT auth.uid()) AND f.feature_key = 'account_health' AND f.enabled
    )
  );
CREATE POLICY account_health_settings_delete_enabled_own ON public.account_health_settings
  FOR DELETE TO authenticated USING (
    owner_id = (SELECT auth.uid()) AND EXISTS (
      SELECT 1 FROM public.user_feature_flags f
       WHERE f.owner_id = (SELECT auth.uid()) AND f.feature_key = 'account_health' AND f.enabled
    )
  );

CREATE FUNCTION private.validate_account_health_owner() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, auth AS $$
DECLARE
  v_account_type text;
BEGIN
  IF auth.uid() IS NULL OR NEW.owner_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Account health settings must belong to the signed-in owner'
      USING ERRCODE = '42501';
  END IF;
  SELECT a.type INTO v_account_type FROM public.accounts a
   WHERE a.id = NEW.account_id AND a.owner_id = auth.uid();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Account health settings require an account owned by the signed-in user'
      USING ERRCODE = '42501';
  END IF;
  IF v_account_type IN ('bank', 'cash', 'wallet')
     AND (NEW.statement_day IS NOT NULL OR NEW.due_day IS NOT NULL) THEN
    RAISE EXCEPTION 'Statement and due days apply only to credit lines' USING ERRCODE = '22023';
  ELSIF v_account_type IN ('credit', 'credit_card', 'pay_later')
     AND NEW.minimum_balance IS NOT NULL THEN
    RAISE EXCEPTION 'Minimum balance thresholds apply only to liquid accounts' USING ERRCODE = '22023';
  ELSIF v_account_type NOT IN ('bank', 'cash', 'wallet', 'credit', 'credit_card', 'pay_later')
     AND (NEW.minimum_balance IS NOT NULL OR NEW.statement_day IS NOT NULL OR NEW.due_day IS NOT NULL) THEN
    RAISE EXCEPTION 'This account type does not support health context' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.validate_account_health_owner() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER validate_account_health_owner
  BEFORE INSERT OR UPDATE ON public.account_health_settings
  FOR EACH ROW EXECUTE FUNCTION private.validate_account_health_owner();

CREATE FUNCTION private.touch_account_health_updated_at() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.touch_account_health_updated_at() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER touch_account_health_updated_at
  BEFORE UPDATE ON public.account_health_settings
  FOR EACH ROW EXECUTE FUNCTION private.touch_account_health_updated_at();

REVOKE ALL ON public.account_health_settings FROM PUBLIC, anon, authenticated;
GRANT SELECT, DELETE ON public.account_health_settings TO authenticated;
GRANT INSERT (account_id, minimum_balance, statement_day, due_day, show_notices),
      UPDATE (minimum_balance, statement_day, due_day, show_notices)
  ON public.account_health_settings TO authenticated;
REVOKE ALL ON public.account_health_settings FROM anon;
REVOKE ALL ON FUNCTION private.validate_account_health_owner() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.touch_account_health_updated_at() FROM PUBLIC, anon, authenticated, service_role;
NOTIFY pgrst, 'reload schema';

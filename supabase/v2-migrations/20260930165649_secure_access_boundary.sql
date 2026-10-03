-- Financial OS v2 only. Reconstructed as the equivalent of RR Capital's
-- first-stage containment migration using its preserved implementation and
-- the current v2 catalog state. Do not apply this to RR Capital.
-- Does not remove data or schema. Private profile settings become owner-only.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
DO $$
DECLARE f record; t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC', t.tablename);
  END LOOP;
  FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p
    WHERE p.pronamespace='public'::regnamespace
      AND p.proname IN ('accept_p2p_emi','accept_p2p_request','accept_settlement',
      'handle_new_user','log_proxy_debt','process_p2p_transaction','propose_p2p_emi',
      'search_users','notify_telegram_on_transaction','trigger_telegram_alert')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.signature);
    EXECUTE format('ALTER FUNCTION %s SET search_path = public, pg_temp', f.signature);
  END LOOP;
  FOR t IN SELECT policyname FROM pg_policies
    WHERE schemaname='public' AND tablename='profiles' AND cmd='SELECT'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.profiles', t.policyname);
  END LOOP;
END $$;
CREATE POLICY profiles_read_own ON public.profiles
  FOR SELECT TO authenticated USING (id = (SELECT auth.uid()));
-- Old linking rows and the unused parties table are not a client mutation API.
REVOKE ALL ON public.obligation_payments FROM authenticated;
DO $$ BEGIN
  IF to_regclass('public.parties') IS NOT NULL THEN
    REVOKE ALL ON public.parties FROM authenticated;
  END IF;
END $$;
-- Old transaction notification functions contained unsafe linking/credentials.
-- Fail closed until authenticated one-time Telegram linking is implemented.
DO $$
BEGIN
  IF to_regprocedure('public.notify_telegram_on_transaction()') IS NOT NULL THEN
    EXECUTE 'CREATE OR REPLACE FUNCTION public.notify_telegram_on_transaction()
      RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp
      AS $body$ BEGIN RETURN NEW; END $body$';
  END IF;
  IF to_regprocedure('public.trigger_telegram_alert()') IS NOT NULL THEN
    EXECUTE 'CREATE OR REPLACE FUNCTION public.trigger_telegram_alert()
      RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp
      AS $body$ BEGIN RETURN NEW; END $body$';
  END IF;
END $$;
NOTIFY pgrst, 'reload schema';

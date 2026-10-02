-- pg_net is non-relocatable. Recreate it in a non-exposed extension schema,
-- but only after proving its asynchronous queue and short-lived responses are
-- empty. The API remains under `net`; current alert callers stay compatible.
CREATE SCHEMA IF NOT EXISTS extensions;

DO $$
DECLARE
  v_current_schema name;
  v_queued bigint;
  v_responses bigint;
BEGIN
  SELECT n.nspname INTO v_current_schema
    FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
   WHERE e.extname = 'pg_net';

  IF v_current_schema IS NULL THEN
    EXECUTE 'CREATE EXTENSION pg_net WITH SCHEMA extensions';
  ELSIF v_current_schema <> 'extensions' THEN
    EXECUTE 'SELECT count(*) FROM net.http_request_queue' INTO v_queued;
    EXECUTE 'SELECT count(*) FROM net._http_response' INTO v_responses;
    IF COALESCE(v_queued, 0) <> 0 OR COALESCE(v_responses, 0) <> 0 THEN
      RAISE EXCEPTION 'Refusing to recreate pg_net while % requests and % responses remain',
        v_queued, v_responses USING ERRCODE = '55000';
    END IF;
    EXECUTE 'DROP EXTENSION pg_net';
    EXECUTE 'CREATE EXTENSION pg_net WITH SCHEMA extensions';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
     WHERE e.extname = 'pg_net' AND n.nspname = 'extensions'
  ) OR to_regnamespace('net') IS NULL
     OR to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') IS NULL THEN
    RAISE EXCEPTION 'pg_net was not restored with its compatible net.http_post API';
  END IF;

  -- Managed Supabase may own extension objects as supabase_admin. Revoke
  -- where the migration role owns them; the `net` schema remains excluded
  -- from the Data API regardless, and this warning is non-fatal if managed.
  BEGIN
    EXECUTE 'REVOKE ALL ON SCHEMA net FROM PUBLIC, anon, authenticated, service_role';
    EXECUTE 'REVOKE ALL ON ALL FUNCTIONS IN SCHEMA net FROM PUBLIC, anon, authenticated, service_role';
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA net FROM PUBLIC, anon, authenticated, service_role';
    EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA net FROM PUBLIC, anon, authenticated, service_role';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE WARNING 'Supabase manages pg_net grants; keep net excluded from the Data API schema list';
  END;
END;
$$;

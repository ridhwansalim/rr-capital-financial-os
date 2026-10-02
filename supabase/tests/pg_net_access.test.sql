-- Data API exposure is verified from supabase/config.toml by the replay runner.
-- Managed pg_net may grant API roles privileges on its unexposed `net` schema;
-- those roles cannot log in to PostgreSQL directly.
BEGIN;
SELECT plan(6);

SELECT ok(EXISTS (
  SELECT 1 FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
  WHERE e.extname = 'pg_net' AND n.nspname = 'extensions'
), 'pg_net extension is installed in extensions, outside exposed public schema');

SELECT ok(NOT (SELECT rolcanlogin FROM pg_roles WHERE rolname = 'anon'), 'anon has no direct PostgreSQL login');
SELECT ok(NOT (SELECT rolcanlogin FROM pg_roles WHERE rolname = 'authenticated'), 'authenticated has no direct PostgreSQL login');
SELECT ok(NOT (SELECT rolcanlogin FROM pg_roles WHERE rolname = 'service_role'), 'service_role has no direct PostgreSQL login');
SELECT ok(has_schema_privilege('postgres', 'net', 'USAGE'), 'database owner retains pg_net access');
SELECT ok(to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') IS NOT NULL,
  'pg_net HTTP API remains available to trusted database triggers');

SELECT * FROM finish();
ROLLBACK;

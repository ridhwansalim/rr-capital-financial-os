-- Local install regression only. Production pg_net objects are owned by
-- supabase_admin; check `[api].schemas` separately for the managed project.
BEGIN;
SELECT plan(7);

SELECT ok(NOT has_schema_privilege('anon', 'net', 'USAGE'), 'anon cannot access pg_net schema');
SELECT ok(NOT has_schema_privilege('authenticated', 'net', 'USAGE'), 'authenticated cannot access pg_net schema');
SELECT ok(NOT has_schema_privilege('service_role', 'net', 'USAGE'), 'service_role cannot access pg_net schema directly');
SELECT ok(has_schema_privilege('postgres', 'net', 'USAGE'), 'database owner retains pg_net access');
SELECT ok(NOT EXISTS (
  SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'net' AND has_function_privilege('anon', p.oid, 'EXECUTE')
), 'anon cannot execute pg_net functions');
SELECT ok(NOT EXISTS (
  SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'net' AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
), 'authenticated cannot execute pg_net functions');
SELECT ok(NOT EXISTS (
  SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'net' AND has_function_privilege('service_role', p.oid, 'EXECUTE')
), 'service_role cannot execute pg_net functions directly');

SELECT * FROM finish();
ROLLBACK;

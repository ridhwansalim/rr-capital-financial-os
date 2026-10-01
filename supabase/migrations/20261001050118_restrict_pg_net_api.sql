-- pg_net's HTTP functions are SECURITY DEFINER and its default PUBLIC grants
-- can be dangerous if `net` is exposed through the Data API. Supabase owns the
-- production extension objects with `supabase_admin`, so the project database
-- role cannot revoke those grants there. Keep `net` out of `[api].schemas`;
-- Financial alerts call net.http_post only inside a postgres-owned trigger.
-- The REVOKE statements below also harden isolated installs where permitted.
CREATE SCHEMA IF NOT EXISTS net;
REVOKE ALL ON SCHEMA net FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA net FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON ALL TABLES IN SCHEMA net FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA net FROM PUBLIC, anon, authenticated, service_role;

-- A direct PostgreSQL login inherits managed pg_net PUBLIC grants that the
-- project migration role cannot revoke. Keep the unused legacy role inert;
-- Perry now calls one fixed authenticated RPC with Ridhu's short-lived user JWT.
DO $$
BEGIN
  -- Perry's setup migrations were intentionally never installed in this
  -- project. Make retirement safe both before and after such a role exists.
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'perry_reader') THEN
    EXECUTE 'ALTER ROLE perry_reader NOLOGIN NOINHERIT NOBYPASSRLS PASSWORD NULL';
    EXECUTE 'REVOKE perry_reader FROM authenticator';
    EXECUTE 'REVOKE USAGE, CREATE ON SCHEMA public, private FROM perry_reader';
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public, private FROM perry_reader';
    EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public, private FROM perry_reader';
    EXECUTE 'REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public, private FROM perry_reader';
    EXECUTE 'REVOKE CONNECT ON DATABASE postgres FROM perry_reader';
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';

-- A direct PostgreSQL login inherits managed pg_net PUBLIC grants that the
-- project migration role cannot revoke. Keep the unused legacy role inert;
-- Perry now calls one fixed authenticated RPC with Ridhu's short-lived user JWT.
ALTER ROLE perry_reader NOLOGIN NOINHERIT NOBYPASSRLS PASSWORD NULL;
REVOKE perry_reader FROM authenticator;
REVOKE USAGE, CREATE ON SCHEMA public, private FROM perry_reader;
REVOKE ALL ON ALL TABLES IN SCHEMA public, private FROM perry_reader;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public, private FROM perry_reader;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public, private FROM perry_reader;
REVOKE CONNECT ON DATABASE postgres FROM perry_reader;

NOTIFY pgrst, 'reload schema';

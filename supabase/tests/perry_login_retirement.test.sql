BEGIN;
SELECT plan(2);

DO $$
DECLARE
  v_role_exists boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'perry_reader')
    INTO v_role_exists;

  IF v_role_exists AND EXISTS (
    SELECT 1
      FROM pg_catalog.pg_roles
     WHERE rolname = 'perry_reader'
       AND (rolcanlogin OR rolinherit OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'perry_reader must not be able to log in, inherit, or bypass RLS';
  END IF;

  IF v_role_exists AND (
       pg_catalog.pg_has_role('authenticator', 'perry_reader', 'MEMBER')
       OR pg_catalog.pg_has_role('perry_reader', 'authenticator', 'MEMBER')
       OR has_table_privilege('perry_reader', 'public.accounts', 'SELECT')
       OR has_table_privilege('perry_reader', 'public.accounts', 'INSERT')
     ) THEN
    RAISE EXCEPTION 'perry_reader must not inherit API identity or have table access';
  END IF;
END;
$$;
SELECT pass('retirement migration succeeds whether perry_reader was absent or present');

SELECT ok(
  NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'perry_reader')
  OR NOT (SELECT rolcanlogin OR rolinherit OR rolbypassrls
            FROM pg_catalog.pg_roles WHERE rolname = 'perry_reader'),
  'existing legacy Perry role cannot log in or inherit; an uncreated role stays absent'
);

SELECT * FROM finish();
ROLLBACK;

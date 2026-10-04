-- Read-only audit of API-exposed relations, column grants, and RPC execute ACLs.
-- This reports catalog metadata only; it does not read application data.
BEGIN;
SET TRANSACTION READ ONLY;

WITH api_tables AS (
  SELECT c.oid, n.nspname, c.relname, c.relkind, c.relrowsecurity
  FROM pg_class AS c
  JOIN pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r', 'p')
    AND (
      has_table_privilege('anon', c.oid, 'SELECT') OR
      has_table_privilege('authenticated', c.oid, 'SELECT') OR
      has_table_privilege('anon', c.oid, 'INSERT') OR
      has_table_privilege('authenticated', c.oid, 'INSERT') OR
      has_table_privilege('anon', c.oid, 'UPDATE') OR
      has_table_privilege('authenticated', c.oid, 'UPDATE') OR
      has_table_privilege('anon', c.oid, 'DELETE') OR
      has_table_privilege('authenticated', c.oid, 'DELETE')
    )
),
api_views AS (
  SELECT c.oid, n.nspname, c.relname, c.relkind, c.reloptions
  FROM pg_class AS c
  JOIN pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind IN ('v', 'm')
    AND (
      has_table_privilege('anon', c.oid, 'SELECT') OR
      has_table_privilege('authenticated', c.oid, 'SELECT')
    )
),
api_definers AS (
  SELECT p.oid, n.nspname, p.proname,
         pg_get_function_identity_arguments(p.oid) AS identity_arguments,
         p.proconfig
  FROM pg_proc AS p
  JOIN pg_namespace AS n ON n.oid = p.pronamespace
  -- Supabase's normal PostgREST surface is public. Private is an implementation
  -- schema and intentionally excluded from the exposed-function check.
  WHERE n.nspname = 'public'
    AND p.prosecdef
    AND (
      has_function_privilege('anon', p.oid, 'EXECUTE') OR
      has_function_privilege('authenticated', p.oid, 'EXECUTE') OR
      has_function_privilege('public', p.oid, 'EXECUTE')
    )
),
api_rpcs AS (
  SELECT p.oid, n.nspname, p.proname,
         pg_get_function_identity_arguments(p.oid) AS identity_arguments,
         p.prosecdef AS is_security_definer,
         p.proconfig,
         has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_execute,
         has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute,
         has_function_privilege('public', p.oid, 'EXECUTE') AS public_can_execute
  FROM pg_proc AS p
  JOIN pg_namespace AS n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prokind IN ('f', 'p')
    AND (
      has_function_privilege('anon', p.oid, 'EXECUTE') OR
      has_function_privilege('authenticated', p.oid, 'EXECUTE') OR
      has_function_privilege('public', p.oid, 'EXECUTE')
    )
),
api_write_columns AS (
  SELECT n.nspname, c.relname, r.rolname, a.attname,
         has_column_privilege(r.rolname, c.oid, a.attnum, 'INSERT') AS can_insert,
         has_column_privilege(r.rolname, c.oid, a.attnum, 'UPDATE') AS can_update,
         has_column_privilege(r.rolname, c.oid, a.attnum, 'REFERENCES') AS can_reference
  FROM pg_class AS c
  JOIN pg_namespace AS n ON n.oid = c.relnamespace
  JOIN pg_attribute AS a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
  CROSS JOIN (VALUES ('anon'::name), ('authenticated'::name)) AS r(rolname)
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
    AND (
      has_column_privilege(r.rolname, c.oid, a.attnum, 'INSERT') OR
      has_column_privilege(r.rolname, c.oid, a.attnum, 'UPDATE') OR
      has_column_privilege(r.rolname, c.oid, a.attnum, 'REFERENCES')
    )
)
SELECT jsonb_build_object(
  'postgrest_db_schemas_setting', current_setting('pgrst.db_schemas', true),
  'private_schema_usage_by_api_roles', jsonb_build_object(
    'anon', CASE WHEN to_regnamespace('private') IS NULL THEN false
      ELSE has_schema_privilege('anon', 'private', 'USAGE') END,
    'authenticated', CASE WHEN to_regnamespace('private') IS NULL THEN false
      ELSE has_schema_privilege('authenticated', 'private', 'USAGE') END
  ),
  'api_tables_without_rls', COALESCE((
    SELECT jsonb_agg(format('%I.%I', nspname, relname) ORDER BY nspname, relname)
    FROM api_tables WHERE NOT relrowsecurity
  ), '[]'::jsonb),
  'api_tables_with_rls_without_policies', COALESCE((
    SELECT jsonb_agg(format('%I.%I', t.nspname, t.relname) ORDER BY t.nspname, t.relname)
    FROM api_tables AS t
    WHERE t.relrowsecurity
      AND NOT EXISTS (SELECT 1 FROM pg_policy AS p WHERE p.polrelid = t.oid)
  ), '[]'::jsonb),
  'api_views_not_security_invoker', COALESCE((
    SELECT jsonb_agg(format('%I.%I', nspname, relname) ORDER BY nspname, relname)
    FROM api_views
    WHERE relkind = 'v'
      AND NOT COALESCE(reloptions @> ARRAY['security_invoker=true'], false)
  ), '[]'::jsonb),
  'api_write_columns', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'table', format('%I.%I', nspname, relname),
      'role', rolname,
      'column', attname,
      'insert', can_insert,
      'update', can_update,
      'references', can_reference
    ) ORDER BY nspname, relname, rolname, attname)
    FROM api_write_columns
  ), '[]'::jsonb),
  'api_executable_functions', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'function', format('%I.%I(%s)', nspname, proname, identity_arguments),
      'security_definer', is_security_definer,
      'anon_execute', anon_can_execute,
      'authenticated_execute', authenticated_can_execute,
      'public_execute', public_can_execute,
      'search_path', (
        SELECT setting FROM unnest(COALESCE(proconfig, ARRAY[]::text[])) AS setting
        WHERE setting LIKE 'search_path=%' LIMIT 1
      )
    ) ORDER BY nspname, proname, identity_arguments)
    FROM api_rpcs
  ), '[]'::jsonb),
  'api_security_definers_missing_search_path', COALESCE((
    SELECT jsonb_agg(
      format('%I.%I(%s)', nspname, proname, identity_arguments)
      ORDER BY nspname, proname, identity_arguments
    )
    FROM api_definers
    WHERE NOT EXISTS (
      SELECT 1 FROM unnest(COALESCE(proconfig, ARRAY[]::text[])) AS setting
      WHERE setting LIKE 'search_path=%'
    )
  ), '[]'::jsonb),
  'api_security_definers_with_nonstandard_search_path', COALESCE((
    SELECT jsonb_agg(
      format('%I.%I(%s)', nspname, proname, identity_arguments)
      ORDER BY nspname, proname, identity_arguments
    )
    FROM api_definers AS f
    WHERE EXISTS (
      SELECT 1
      FROM unnest(COALESCE(f.proconfig, ARRAY[]::text[])) AS setting
      WHERE setting LIKE 'search_path=%'
        AND regexp_replace(setting, '\s+', '', 'g') NOT IN (
          'search_path=pg_catalog,public,private,pg_temp',
          'search_path=pg_catalog,public,pg_temp',
          'search_path=pg_catalog,private,pg_temp',
          'search_path=pg_catalog,pg_temp'
        )
    )
  ), '[]'::jsonb)
) AS live_security_catalog_audit;

COMMIT;

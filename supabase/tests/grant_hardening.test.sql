BEGIN;
SELECT plan(5);

SELECT ok(
  has_table_privilege('authenticated', 'public.account_balances', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.account_balances', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.account_balances', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'public.account_balances', 'DELETE')
  AND NOT has_table_privilege('authenticated', 'public.account_balances', 'TRUNCATE'),
  'authenticated can read balances but cannot write through the view'
);

SELECT ok(
  NOT has_table_privilege('anon', 'public.account_balances', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.transaction_categories', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.transaction_categories', 'INSERT'),
  'anonymous users have no access to balances or categories'
);

SELECT ok(
  has_table_privilege('authenticated', 'public.transaction_categories', 'SELECT')
  AND has_table_privilege('authenticated', 'public.transaction_categories', 'INSERT')
  AND has_table_privilege('authenticated', 'public.transaction_categories', 'UPDATE')
  AND has_table_privilege('authenticated', 'public.transaction_categories', 'DELETE')
  AND NOT has_table_privilege('authenticated', 'public.transaction_categories', 'TRUNCATE')
  AND NOT has_table_privilege('authenticated', 'public.transaction_categories', 'REFERENCES')
  AND NOT has_table_privilege('authenticated', 'public.transaction_categories', 'TRIGGER'),
  'authenticated category CRUD remains available without table-wide or schema privileges'
);

SELECT is(
  (SELECT count(*)::integer FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'transaction_categories'
      AND ((cmd = 'SELECT' AND qual LIKE '%owner_id%auth.uid%')
        OR (cmd = 'INSERT' AND with_check LIKE '%owner_id%auth.uid%')
        OR (cmd = 'UPDATE' AND qual LIKE '%owner_id%auth.uid%'
                           AND with_check LIKE '%owner_id%auth.uid%')
        OR (cmd = 'DELETE' AND qual LIKE '%owner_id%auth.uid%'))),
  4,
  'category CRUD policies scope every operation to the authenticated owner'
);

SELECT ok(
  NOT has_function_privilege('anon', 'private.protect_chitti_state()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'private.protect_chitti_state()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'private.protect_emi_bank_progress()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'private.protect_emi_bank_progress()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'private.protect_settlement_state()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'private.protect_settlement_state()', 'EXECUTE'),
  'private state-protection trigger functions are not exposed as RPCs'
);

SELECT * FROM finish();
ROLLBACK;
BEGIN;
SELECT plan(11);

SELECT ok(
  has_table_privilege('authenticated', 'public.account_balances', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.account_balances', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.account_balances', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'public.account_balances', 'DELETE')
  AND NOT has_table_privilege('authenticated', 'public.account_balances', 'TRUNCATE'),
  'authenticated can read balances but cannot write through the view'
);

SELECT ok(
  (SELECT c.reloptions @> ARRAY['security_invoker=true']
     FROM pg_class c WHERE c.oid='public.account_balances'::regclass)
  AND has_table_privilege('authenticated','public.accounts','SELECT')
  AND has_table_privilege('authenticated','public.transactions','SELECT'),
  'balance view evaluates with caller privileges and owner-filtered underlying reads'
);

SELECT ok(
  NOT has_table_privilege('anon', 'public.account_balances', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.transaction_categories', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.transaction_categories', 'INSERT'),
  'anonymous users have no access to balances or categories'
);

SELECT ok(
  has_table_privilege('authenticated', 'public.transaction_categories', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.transaction_categories', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.transaction_categories', 'UPDATE')
  AND has_column_privilege('authenticated', 'public.transaction_categories', 'name', 'INSERT')
  AND has_column_privilege('authenticated', 'public.transaction_categories', 'color', 'INSERT')
  AND has_column_privilege('authenticated', 'public.transaction_categories', 'name', 'UPDATE')
  AND has_column_privilege('authenticated', 'public.transaction_categories', 'color', 'UPDATE')
  AND NOT has_column_privilege('authenticated', 'public.transaction_categories', 'id', 'INSERT')
  AND NOT has_column_privilege('authenticated', 'public.transaction_categories', 'owner_id', 'INSERT')
  AND NOT has_column_privilege('authenticated', 'public.transaction_categories', 'created_at', 'INSERT')
  AND NOT has_column_privilege('authenticated', 'public.transaction_categories', 'owner_id', 'UPDATE')
  AND has_table_privilege('authenticated', 'public.transaction_categories', 'DELETE')
  AND NOT has_table_privilege('authenticated', 'public.transaction_categories', 'TRUNCATE')
  AND NOT has_table_privilege('authenticated', 'public.transaction_categories', 'REFERENCES')
  AND NOT has_table_privilege('authenticated', 'public.transaction_categories', 'TRIGGER'),
  'authenticated category CRUD is column-scoped and retains owner-safe delete without table-wide or schema privileges'
);

SELECT ok(
  NOT has_table_privilege('authenticated', 'public.accounts', 'TRUNCATE')
  AND NOT has_table_privilege('authenticated', 'public.accounts', 'REFERENCES')
  AND NOT has_table_privilege('authenticated', 'public.accounts', 'TRIGGER')
  AND NOT has_table_privilege('authenticated', 'public.chittis', 'TRUNCATE')
  AND NOT has_table_privilege('authenticated', 'public.chittis', 'REFERENCES')
  AND NOT has_table_privilege('authenticated', 'public.chittis', 'TRIGGER'),
  'account and Chitti owner CRUD cannot use table-wide privileges that bypass RLS'
);

SELECT ok(
  NOT has_table_privilege('authenticated', 'public.contacts', 'TRUNCATE')
  AND NOT has_table_privilege('authenticated', 'public.contacts', 'REFERENCES')
  AND NOT has_table_privilege('authenticated', 'public.contacts', 'TRIGGER')
  AND NOT has_table_privilege('authenticated', 'public.profiles', 'TRUNCATE')
  AND NOT has_table_privilege('authenticated', 'public.profiles', 'REFERENCES')
  AND NOT has_table_privilege('authenticated', 'public.profiles', 'TRIGGER'),
  'contact and profile owner CRUD cannot use table-wide privileges that bypass RLS'
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

SELECT ok(
  (SELECT NOT p.prosecdef AND p.proconfig @> ARRAY['search_path=public, pg_temp']
     FROM pg_proc p WHERE p.oid = 'public.request_settlement(uuid,uuid,uuid,numeric,integer,date)'::regprocedure)
  AND (SELECT p.prosecdef AND p.proconfig @> ARRAY['search_path=public, pg_temp']
     FROM pg_proc p WHERE p.oid = 'private.request_settlement(uuid,uuid,uuid,numeric,integer,date)'::regprocedure)
  AND (SELECT NOT p.prosecdef AND p.proconfig @> ARRAY['search_path=public, pg_temp']
     FROM pg_proc p WHERE p.oid = 'public.accept_settlement(uuid,uuid,uuid)'::regprocedure)
  AND (SELECT p.prosecdef AND p.proconfig @> ARRAY['search_path=public, pg_temp']
     FROM pg_proc p WHERE p.oid = 'private.accept_settlement(uuid,uuid,uuid)'::regprocedure)
  AND NOT has_function_privilege('anon', 'public.request_settlement(uuid,uuid,uuid,numeric,integer,date)', 'EXECUTE')
  AND NOT has_function_privilege('public', 'public.request_settlement(uuid,uuid,uuid,numeric,integer,date)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.request_settlement(uuid,uuid,uuid,numeric,integer,date)', 'EXECUTE')
  AND NOT has_function_privilege('public', 'private.request_settlement(uuid,uuid,uuid,numeric,integer,date)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'private.request_settlement(uuid,uuid,uuid,numeric,integer,date)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.accept_settlement(uuid,uuid,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('public', 'public.accept_settlement(uuid,uuid,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'private.accept_settlement(uuid,uuid,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('public', 'private.accept_settlement(uuid,uuid,uuid)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'private.accept_settlement(uuid,uuid,uuid)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.accept_settlement(uuid,uuid,uuid)', 'EXECUTE'),
  'settlement RPC wrappers are invoker-only with fixed search paths and authenticated-only access'
);

SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN
    TRUNCATE public.accounts;
    RAISE EXCEPTION 'authenticated unexpectedly truncated accounts';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    TRUNCATE public.chittis;
    RAISE EXCEPTION 'authenticated unexpectedly truncated chittis';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    TRUNCATE public.contacts;
    RAISE EXCEPTION 'authenticated unexpectedly truncated contacts';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    TRUNCATE public.profiles;
    RAISE EXCEPTION 'authenticated unexpectedly truncated profiles';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;
SELECT pass('authenticated TRUNCATE attempts are denied on every owner-scoped table');

SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN
    UPDATE public.account_balances SET id=id WHERE false;
    RAISE EXCEPTION 'authenticated unexpectedly updated through account_balances';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.account_balances(id,balance) VALUES (gen_random_uuid(),0);
    RAISE EXCEPTION 'authenticated unexpectedly inserted through account_balances';
  EXCEPTION WHEN insufficient_privilege OR feature_not_supported THEN NULL;
  END;
  BEGIN
    DELETE FROM public.account_balances WHERE false;
    RAISE EXCEPTION 'authenticated unexpectedly deleted through account_balances';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;
SELECT pass('authenticated INSERT, UPDATE, and DELETE attempts through account_balances are denied');

SELECT * FROM finish();
ROLLBACK;

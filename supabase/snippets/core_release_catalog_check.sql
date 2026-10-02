-- Read-only production post-migration verification for the RR Capital core release.
-- Run only after confirming the SQL connection targets RR Capital.
-- This inspects catalog metadata and grants only; it never reads finance rows.
BEGIN;
SET TRANSACTION READ ONLY;

DO $check$
DECLARE
  v_missing text[];
BEGIN
  SELECT array_agg(expected.version ORDER BY expected.version)
    INTO v_missing
    FROM (VALUES
      ('20261002040000'),
      ('20261002040300'),
      ('20261002040400'),
      ('20261002040500'),
      ('20261002040700'),
      ('20261002040800'),
      ('20261002040900'),
      ('20261002040950')
    ) AS expected(version)
   WHERE NOT EXISTS (
     SELECT 1 FROM supabase_migrations.schema_migrations m
      WHERE m.version = expected.version
   );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'Core migration versions are missing: %', v_missing;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM unnest(ARRAY['public.accounts','public.chittis','public.contacts','public.profiles']) AS t(name)
     WHERE has_table_privilege('authenticated', t.name, 'TRUNCATE')
        OR has_table_privilege('authenticated', t.name, 'REFERENCES')
        OR has_table_privilege('authenticated', t.name, 'TRIGGER')
  ) THEN
    RAISE EXCEPTION 'Authenticated retains a table-wide privilege not scoped by RLS';
  END IF;

  IF NOT has_table_privilege('authenticated','public.account_balances','SELECT')
     OR has_table_privilege('anon','public.account_balances','SELECT')
     OR has_table_privilege('authenticated','public.account_balances','INSERT')
     OR has_table_privilege('authenticated','public.account_balances','UPDATE')
     OR has_table_privilege('authenticated','public.account_balances','DELETE')
     OR has_table_privilege('authenticated','public.account_balances','TRUNCATE') THEN
    RAISE EXCEPTION 'account_balances grants do not match the read-only contract';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND c.relname='account_balances' AND c.relkind='v'
       AND 'security_invoker=true' = ANY(COALESCE(c.reloptions, ARRAY[]::text[]))
  ) THEN
    RAISE EXCEPTION 'account_balances is not a security-invoker view';
  END IF;

  IF NOT has_table_privilege('authenticated','public.transaction_categories','SELECT')
     OR has_table_privilege('authenticated','public.transaction_categories','INSERT')
     OR has_table_privilege('authenticated','public.transaction_categories','UPDATE')
     OR NOT has_column_privilege('authenticated','public.transaction_categories','name','INSERT')
     OR NOT has_column_privilege('authenticated','public.transaction_categories','color','INSERT')
     OR NOT has_column_privilege('authenticated','public.transaction_categories','name','UPDATE')
     OR NOT has_column_privilege('authenticated','public.transaction_categories','color','UPDATE')
     OR has_column_privilege('authenticated','public.transaction_categories','id','INSERT')
     OR has_column_privilege('authenticated','public.transaction_categories','owner_id','INSERT')
     OR has_column_privilege('authenticated','public.transaction_categories','created_at','INSERT')
     OR has_column_privilege('authenticated','public.transaction_categories','owner_id','UPDATE')
     OR NOT has_table_privilege('authenticated','public.transaction_categories','DELETE')
     OR has_table_privilege('authenticated','public.transaction_categories','TRUNCATE')
     OR has_table_privilege('authenticated','public.transaction_categories','REFERENCES')
     OR has_table_privilege('authenticated','public.transaction_categories','TRIGGER')
     OR has_table_privilege('anon','public.transaction_categories','SELECT')
     OR has_table_privilege('anon','public.transaction_categories','INSERT') THEN
    RAISE EXCEPTION 'transaction_categories grants do not match the owner-scoped CRUD contract';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='transaction_categories'
       AND column_name='owner_id' AND column_default='auth.uid()'
  ) THEN
    RAISE EXCEPTION 'transaction_categories owner_id is not derived from auth.uid()';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='accounts'
       AND column_name='opening_date' AND is_nullable='NO'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='accounts'
       AND column_name='opening_balance' AND is_nullable='NO'
  ) THEN
    RAISE EXCEPTION 'Dated opening position columns are missing or nullable';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid='public.transactions'::regclass
       AND tgname='a_transaction_opening_date_boundary' AND NOT tgisinternal
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid='public.transactions'::regclass
       AND tgname='validate_dated_transaction_balance_at_commit'
       AND NOT tgisinternal AND tgdeferrable AND tginitdeferred
  ) THEN
    RAISE EXCEPTION 'Opening-date or deferred chronological-balance triggers are missing';
  END IF;

  IF (SELECT count(*) FROM pg_constraint
       WHERE conrelid='public.transactions'::regclass
         AND contype='f'
         AND conname IN ('transactions_from_account_id_fkey','transactions_to_account_id_fkey')
         AND confdeltype='r') <> 2 THEN
    RAISE EXCEPTION 'Deleting an account could detach a dated transaction from its ledger endpoint';
  END IF;

  IF to_regclass('private.installment_occurrences') IS NULL
     OR to_regprocedure('public.list_installment_occurrences(text,uuid)') IS NULL
     OR to_regprocedure('public.set_historical_installment_status(text,uuid,integer,text)') IS NULL THEN
    RAISE EXCEPTION 'Personal installment-history objects are missing';
  END IF;

  IF to_regclass('private.p2p_request_metadata') IS NULL
     OR has_table_privilege('authenticated','private.p2p_request_metadata','SELECT')
     OR has_table_privilege('authenticated','private.p2p_request_metadata','INSERT')
     OR has_table_privilege('anon','private.p2p_request_metadata','SELECT') THEN
    RAISE EXCEPTION 'P2P idempotency metadata is missing or directly exposed';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc
     WHERE oid IN (
       to_regprocedure('public.list_installment_occurrences(text,uuid)'),
       to_regprocedure('public.set_historical_installment_status(text,uuid,integer,text)')
     ) AND prosecdef
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_proc
     WHERE oid=to_regprocedure('public.list_installment_occurrences(text,uuid)')
       AND NOT prosecdef
       AND proconfig @> ARRAY['search_path=pg_catalog, public, private, pg_temp']
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_proc
     WHERE oid=to_regprocedure('public.set_historical_installment_status(text,uuid,integer,text)')
       AND NOT prosecdef
       AND proconfig @> ARRAY['search_path=pg_catalog, public, private, pg_temp']
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_proc
     WHERE oid=to_regprocedure('private.list_installment_occurrences(text,uuid)')
       AND prosecdef
       AND proconfig @> ARRAY['search_path=pg_catalog, public, private, pg_temp']
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_proc
     WHERE oid=to_regprocedure('private.set_historical_installment_status(text,uuid,integer,text)')
       AND prosecdef
       AND proconfig @> ARRAY['search_path=pg_catalog, public, private, pg_temp']
  ) THEN
    RAISE EXCEPTION 'Installment RPC definer code is not isolated from the exposed schema';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
     WHERE p.oid=to_regprocedure('public.process_p2p_transaction(uuid,uuid,uuid,uuid,uuid,numeric,text,boolean,text,timestamptz,text)')
       AND NOT p.prosecdef
       AND p.proconfig @> ARRAY['search_path=pg_catalog, public, private, pg_temp']
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_proc p
     WHERE p.oid=to_regprocedure('private.process_p2p_transaction_checked(uuid,uuid,uuid,uuid,uuid,numeric,text,boolean,text,timestamptz,text)')
       AND p.prosecdef
       AND p.proconfig @> ARRAY['search_path=pg_catalog, public, private, pg_temp']
  ) THEN
    RAISE EXCEPTION 'Idempotent P2P RPC security mode or fixed search_path is incorrect';
  END IF;
  IF has_function_privilege('anon','public.process_p2p_transaction(uuid,uuid,uuid,uuid,uuid,numeric,text,boolean,text,timestamptz,text)','EXECUTE')
     OR has_function_privilege('public','public.process_p2p_transaction(uuid,uuid,uuid,uuid,uuid,numeric,text,boolean,text,timestamptz,text)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.process_p2p_transaction(uuid,uuid,uuid,uuid,uuid,numeric,text,boolean,text,timestamptz,text)','EXECUTE') THEN
    RAISE EXCEPTION 'Idempotent P2P RPC grants do not match the authenticated-only contract';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
     WHERE p.oid=to_regprocedure('private.accept_p2p_request(uuid,uuid,uuid)')
       AND p.prosecdef
       AND p.proconfig @> ARRAY['search_path=pg_catalog, public, private, pg_temp']
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_proc p
     WHERE p.oid=to_regprocedure('public.accept_p2p_request(uuid,uuid,uuid)')
       AND NOT p.prosecdef
       AND p.proconfig @> ARRAY['search_path=pg_catalog, public, private, pg_temp']
  ) THEN
    RAISE EXCEPTION 'P2P acceptance security mode or fixed search_path is incorrect';
  END IF;
  IF has_function_privilege('anon','private.accept_p2p_request(uuid,uuid,uuid)','EXECUTE')
     OR has_function_privilege('public','private.accept_p2p_request(uuid,uuid,uuid)','EXECUTE')
     OR NOT has_function_privilege('authenticated','private.accept_p2p_request(uuid,uuid,uuid)','EXECUTE')
     OR has_function_privilege('anon','public.accept_p2p_request(uuid,uuid,uuid)','EXECUTE')
     OR has_function_privilege('public','public.accept_p2p_request(uuid,uuid,uuid)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.accept_p2p_request(uuid,uuid,uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'P2P acceptance execute grants do not match the authenticated-only contract';
  END IF;

  -- Settlement RPCs move money across two owners' ledgers. Assert their
  -- invoker/definer boundary and ACLs explicitly; row grants alone are not
  -- enough to prove that public wrappers cannot bypass caller identity.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.oid = to_regprocedure('public.request_settlement(uuid,uuid,uuid,numeric,integer,date)')
      AND NOT p.prosecdef
      AND p.proconfig @> ARRAY['search_path=public, pg_temp']
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.oid = to_regprocedure('private.request_settlement(uuid,uuid,uuid,numeric,integer,date)')
      AND p.prosecdef
      AND p.proconfig @> ARRAY['search_path=public, pg_temp']
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.oid = to_regprocedure('private.accept_settlement(uuid,uuid,uuid)')
      AND p.prosecdef
      AND p.proconfig @> ARRAY['search_path=public, pg_temp']
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.oid = to_regprocedure('public.accept_settlement(uuid,uuid,uuid)')
      AND NOT p.prosecdef
      AND p.proconfig @> ARRAY['search_path=public, pg_temp']
  ) THEN
    RAISE EXCEPTION 'Settlement RPC security mode or fixed search_path is incorrect';
  END IF;

  IF has_function_privilege('anon', 'public.request_settlement(uuid,uuid,uuid,numeric,integer,date)', 'EXECUTE')
     OR has_function_privilege('public', 'public.request_settlement(uuid,uuid,uuid,numeric,integer,date)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.request_settlement(uuid,uuid,uuid,numeric,integer,date)', 'EXECUTE')
     OR has_function_privilege('anon', 'private.request_settlement(uuid,uuid,uuid,numeric,integer,date)', 'EXECUTE')
     OR has_function_privilege('public', 'private.request_settlement(uuid,uuid,uuid,numeric,integer,date)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'private.request_settlement(uuid,uuid,uuid,numeric,integer,date)', 'EXECUTE')
     OR has_function_privilege('anon', 'private.accept_settlement(uuid,uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('public', 'private.accept_settlement(uuid,uuid,uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'private.accept_settlement(uuid,uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.accept_settlement(uuid,uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('public', 'public.accept_settlement(uuid,uuid,uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.accept_settlement(uuid,uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Settlement function execute grants do not match the caller boundary';
  END IF;
END
$check$;

SELECT version FROM supabase_migrations.schema_migrations
 WHERE version IN ('20261002040000','20261002040300','20261002040400','20261002040500','20261002040700','20261002040800','20261002040900','20261002040950')
 ORDER BY version;

COMMIT;

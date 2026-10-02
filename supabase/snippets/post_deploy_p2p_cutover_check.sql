-- Read-only verification for the post-deployment P2P compatibility cutover.
-- Run only after the household clients have refreshed to the request-ID RPC.
BEGIN;
SET TRANSACTION READ ONLY;
DO $check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20261002041000'
  ) THEN
    RAISE EXCEPTION 'Legacy P2P retirement migration is missing';
  END IF;
  IF has_function_privilege('anon',
       'public.process_p2p_transaction(uuid,uuid,uuid,uuid,numeric,text,boolean,text,timestamptz)','EXECUTE')
     OR has_function_privilege('public',
       'public.process_p2p_transaction(uuid,uuid,uuid,uuid,numeric,text,boolean,text,timestamptz)','EXECUTE')
     OR has_function_privilege('authenticated',
       'public.process_p2p_transaction(uuid,uuid,uuid,uuid,numeric,text,boolean,text,timestamptz)','EXECUTE')
     OR has_function_privilege('service_role',
       'public.process_p2p_transaction(uuid,uuid,uuid,uuid,numeric,text,boolean,text,timestamptz)','EXECUTE') THEN
    RAISE EXCEPTION 'Legacy non-idempotent P2P RPC still has an API-role grant';
  END IF;
  IF NOT has_function_privilege('authenticated',
       'public.process_p2p_transaction(uuid,uuid,uuid,uuid,uuid,numeric,text,boolean,text,timestamptz,text)','EXECUTE')
     OR has_function_privilege('anon',
       'public.process_p2p_transaction(uuid,uuid,uuid,uuid,uuid,numeric,text,boolean,text,timestamptz,text)','EXECUTE') THEN
    RAISE EXCEPTION 'The authenticated request-ID P2P RPC grant is incorrect';
  END IF;
END
$check$;
COMMIT;

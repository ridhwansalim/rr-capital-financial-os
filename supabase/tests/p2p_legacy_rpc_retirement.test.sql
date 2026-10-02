BEGIN;
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  IF has_function_privilege('authenticated',
    'public.process_p2p_transaction(uuid,uuid,uuid,uuid,numeric,text,boolean,text,timestamptz)',
    'EXECUTE') THEN
    RAISE EXCEPTION 'Legacy non-idempotent P2P RPC remains executable';
  END IF;
  IF NOT has_function_privilege('authenticated',
    'public.process_p2p_transaction(uuid,uuid,uuid,uuid,uuid,numeric,text,boolean,text,timestamptz,text)',
    'EXECUTE') THEN
    RAISE EXCEPTION 'Idempotent P2P RPC is not executable by authenticated users';
  END IF;
END $$;
RESET ROLE;
ROLLBACK;
SELECT plan(2);
SELECT pass('legacy non-idempotent P2P RPC is no longer executable by authenticated clients');
SELECT pass('request-ID P2P RPC remains executable after legacy retirement');
SELECT * FROM finish();

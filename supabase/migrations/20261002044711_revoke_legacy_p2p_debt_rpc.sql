-- Apply only after the new client using the request-ID signature is live and
-- the household devices have refreshed. Keep the old function definitions
-- for rollback inspection, but stop API roles from invoking the non-idempotent
-- signature which predates request IDs.
REVOKE ALL ON FUNCTION public.process_p2p_transaction(
  uuid,uuid,uuid,uuid,numeric,text,boolean,text,timestamptz
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.process_p2p_transaction(
  uuid,uuid,uuid,uuid,numeric,text,boolean,text,timestamptz
) FROM PUBLIC, anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

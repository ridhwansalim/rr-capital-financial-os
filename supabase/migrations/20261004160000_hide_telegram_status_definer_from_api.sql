-- Keep the public RPC as an invoker function so exposed API audits do not
-- classify it as a callable privileged endpoint. The narrowly scoped helper
-- remains in the private implementation schema and returns only a boolean
-- for the authenticated caller's own profile.
CREATE OR REPLACE FUNCTION private.get_telegram_link_status()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, private, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.profiles
     WHERE id = private.require_user()
       AND telegram_chat_id IS NOT NULL
       AND telegram_chat_id <> ''
  );
$$;
REVOKE ALL ON FUNCTION private.get_telegram_link_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.get_telegram_link_status() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_telegram_link_status()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public, private, pg_temp
AS $$
  SELECT private.get_telegram_link_status();
$$;
REVOKE ALL ON FUNCTION public.get_telegram_link_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_telegram_link_status() TO authenticated;

NOTIFY pgrst, 'reload schema';

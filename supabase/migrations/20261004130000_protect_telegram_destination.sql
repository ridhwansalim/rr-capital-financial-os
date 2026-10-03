-- Telegram chat IDs are delivery routing data. The browser needs only the
-- authenticated owner's linked/unlinked state, never the destination itself.
-- Remove the bootstrap table-wide grant first, then expose only the profile
-- fields the client actually uses. Column revokes alone cannot override a
-- table-level SELECT grant inherited from the initial schema.
REVOKE SELECT ON TABLE public.profiles FROM PUBLIC, anon, authenticated;
REVOKE SELECT (telegram_chat_id) ON TABLE public.profiles FROM PUBLIC, anon, authenticated;
GRANT SELECT (
  id,
  full_name,
  username,
  theme_mode,
  theme_accent,
  ai_model,
  ai_persona,
  is_biometric_enabled,
  registered_devices,
  navbar_layout
) ON TABLE public.profiles TO authenticated;

CREATE OR REPLACE FUNCTION public.get_telegram_link_status()
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
REVOKE ALL ON FUNCTION public.get_telegram_link_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_telegram_link_status() TO authenticated;

NOTIFY pgrst, 'reload schema';

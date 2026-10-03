-- Financial OS v2 only. Keep owner-scoped profile preferences editable while
-- keeping plaintext provider credentials and Telegram routing server-managed.
-- Do not add this legacy-project migration to RR Capital's migration chain.

REVOKE ALL ON TABLE public.profiles FROM anon, authenticated;

GRANT SELECT (
  id,
  full_name,
  username,
  phone,
  theme_preference,
  dp_url,
  created_at,
  theme_mode,
  theme_accent,
  ai_model,
  ai_persona,
  is_biometric_enabled,
  registered_devices
) ON TABLE public.profiles TO authenticated;

GRANT UPDATE (
  full_name,
  username,
  phone,
  theme_preference,
  dp_url,
  theme_mode,
  theme_accent,
  ai_model,
  ai_persona,
  is_biometric_enabled,
  registered_devices
) ON TABLE public.profiles TO authenticated;

NOTIFY pgrst, 'reload schema';

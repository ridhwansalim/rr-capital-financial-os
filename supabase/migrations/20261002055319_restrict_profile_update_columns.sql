-- Authenticated users may update their own editable preferences, but must not
-- be able to change server-managed identity, recovery, or Telegram routing data.
-- RLS remains the row-level boundary; these grants narrow which own-row fields
-- the Data API can mutate.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.profiles FROM anon, authenticated;
GRANT UPDATE (
  full_name,
  username,
  theme_mode,
  theme_accent,
  ai_model,
  ai_persona,
  is_biometric_enabled,
  registered_devices
) ON TABLE public.profiles TO authenticated;

NOTIFY pgrst, 'reload schema';

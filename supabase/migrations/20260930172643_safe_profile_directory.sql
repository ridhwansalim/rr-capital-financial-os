-- Public identity fields are copied into a separate table so RLS on profiles
-- can protect AI keys, Telegram IDs and device data without hiding names.
CREATE TABLE public.profile_directory (
  id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  username text,
  full_name text
);
ALTER TABLE public.profile_directory ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.profile_directory FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.profile_directory TO authenticated;
CREATE POLICY directory_read_authenticated ON public.profile_directory
  FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION private.refresh_profile_directory()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO public.profile_directory(id, username, full_name)
  VALUES (NEW.id, NEW.username, NEW.full_name)
  ON CONFLICT (id) DO UPDATE
    SET username = EXCLUDED.username, full_name = EXCLUDED.full_name;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.refresh_profile_directory() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER refresh_profile_directory
  AFTER INSERT OR UPDATE OF username, full_name ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION private.refresh_profile_directory();

INSERT INTO public.profile_directory(id, username, full_name)
SELECT id, username, full_name FROM public.profiles
ON CONFLICT (id) DO UPDATE
  SET username = EXCLUDED.username, full_name = EXCLUDED.full_name;

NOTIFY pgrst, 'reload schema';

-- A public-only schema dump does not include triggers attached to auth.users.
-- Create the profile trigger on a fresh project without duplicating an
-- existing production trigger that already calls the same function.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'auth.users'::regclass
       AND tgfoid = 'public.handle_new_user()'::regprocedure
       AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER on_auth_user_created
      AFTER INSERT ON auth.users
      FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
  END IF;
END $$;

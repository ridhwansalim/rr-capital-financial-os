-- Table-wide privileges bypass row ownership policies. Keep ordinary
-- owner-scoped CRUD, but remove operations that RLS cannot safely scope.
REVOKE TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.accounts, public.chittis, public.contacts, public.profiles
  FROM authenticated;

NOTIFY pgrst, 'reload schema';

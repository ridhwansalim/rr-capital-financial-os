-- Category management needs only name/color edits. Derive ownership from the
-- authenticated JWT so clients cannot choose or later rewrite category owners.
ALTER TABLE public.transaction_categories
  ALTER COLUMN owner_id SET DEFAULT auth.uid();

REVOKE INSERT, UPDATE ON TABLE public.transaction_categories FROM anon, authenticated;
REVOKE INSERT (id, owner_id, name, color, created_at),
       UPDATE (id, owner_id, name, color, created_at)
  ON TABLE public.transaction_categories FROM anon, authenticated;
GRANT INSERT (name, color) ON TABLE public.transaction_categories TO authenticated;
GRANT UPDATE (name, color) ON TABLE public.transaction_categories TO authenticated;

NOTIFY pgrst, 'reload schema';

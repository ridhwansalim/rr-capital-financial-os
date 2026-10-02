-- Shopping records are private planning data. Purchased state never posts to
-- the ledger or asserts that an item was paid from a particular account.
CREATE TABLE public.shopping_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shopping_lists_id_owner_key UNIQUE(id, owner_id)
);
CREATE INDEX shopping_lists_owner_idx ON public.shopping_lists(owner_id, archived_at, created_at DESC);
ALTER TABLE public.shopping_lists ENABLE ROW LEVEL SECURITY;
CREATE POLICY shopping_lists_select_enabled_own ON public.shopping_lists
  FOR SELECT TO authenticated USING (
    owner_id = (SELECT auth.uid()) AND EXISTS (
      SELECT 1 FROM public.user_feature_flags f
       WHERE f.owner_id = (SELECT auth.uid()) AND f.feature_key = 'shopping_lists' AND f.enabled
    )
  );
CREATE POLICY shopping_lists_insert_enabled_own ON public.shopping_lists
  FOR INSERT TO authenticated WITH CHECK (
    owner_id = (SELECT auth.uid()) AND EXISTS (
      SELECT 1 FROM public.user_feature_flags f
       WHERE f.owner_id = (SELECT auth.uid()) AND f.feature_key = 'shopping_lists' AND f.enabled
    )
  );
CREATE POLICY shopping_lists_update_enabled_own ON public.shopping_lists
  FOR UPDATE TO authenticated USING (
    owner_id = (SELECT auth.uid()) AND EXISTS (
      SELECT 1 FROM public.user_feature_flags f
       WHERE f.owner_id = (SELECT auth.uid()) AND f.feature_key = 'shopping_lists' AND f.enabled
    )
  ) WITH CHECK (
    owner_id = (SELECT auth.uid()) AND EXISTS (
      SELECT 1 FROM public.user_feature_flags f
       WHERE f.owner_id = (SELECT auth.uid()) AND f.feature_key = 'shopping_lists' AND f.enabled
    )
  );
CREATE POLICY shopping_lists_delete_enabled_own ON public.shopping_lists
  FOR DELETE TO authenticated USING (
    owner_id = (SELECT auth.uid()) AND EXISTS (
      SELECT 1 FROM public.user_feature_flags f
       WHERE f.owner_id = (SELECT auth.uid()) AND f.feature_key = 'shopping_lists' AND f.enabled
    )
  );
REVOKE ALL ON public.shopping_lists FROM authenticated, anon;
GRANT SELECT, DELETE ON public.shopping_lists TO authenticated;
GRANT INSERT (name), UPDATE (name, archived_at) ON public.shopping_lists TO authenticated;

CREATE TABLE public.shopping_list_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  list_id uuid NOT NULL,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  quantity numeric(10,2) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  expected_cost numeric(14,2) CHECK (expected_cost IS NULL OR expected_cost > 0),
  purchased boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shopping_list_items_list_owner_fkey FOREIGN KEY (list_id, owner_id)
    REFERENCES public.shopping_lists(id, owner_id) ON DELETE CASCADE
);
CREATE INDEX shopping_list_items_owner_list_idx ON public.shopping_list_items(owner_id, list_id, created_at);
ALTER TABLE public.shopping_list_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY shopping_list_items_select_enabled_own ON public.shopping_list_items
  FOR SELECT TO authenticated USING (
    owner_id = (SELECT auth.uid()) AND EXISTS (
      SELECT 1 FROM public.user_feature_flags f
       WHERE f.owner_id = (SELECT auth.uid()) AND f.feature_key = 'shopping_lists' AND f.enabled
    ) AND EXISTS (SELECT 1 FROM public.shopping_lists l WHERE l.id = list_id AND l.owner_id = (SELECT auth.uid()))
  );
CREATE POLICY shopping_list_items_insert_enabled_own ON public.shopping_list_items
  FOR INSERT TO authenticated WITH CHECK (
    owner_id = (SELECT auth.uid()) AND EXISTS (
      SELECT 1 FROM public.user_feature_flags f
       WHERE f.owner_id = (SELECT auth.uid()) AND f.feature_key = 'shopping_lists' AND f.enabled
    ) AND EXISTS (SELECT 1 FROM public.shopping_lists l WHERE l.id = list_id AND l.owner_id = (SELECT auth.uid()))
  );
CREATE POLICY shopping_list_items_update_enabled_own ON public.shopping_list_items
  FOR UPDATE TO authenticated USING (
    owner_id = (SELECT auth.uid()) AND EXISTS (
      SELECT 1 FROM public.user_feature_flags f
       WHERE f.owner_id = (SELECT auth.uid()) AND f.feature_key = 'shopping_lists' AND f.enabled
    ) AND EXISTS (SELECT 1 FROM public.shopping_lists l WHERE l.id = list_id AND l.owner_id = (SELECT auth.uid()))
  ) WITH CHECK (
    owner_id = (SELECT auth.uid()) AND EXISTS (
      SELECT 1 FROM public.user_feature_flags f
       WHERE f.owner_id = (SELECT auth.uid()) AND f.feature_key = 'shopping_lists' AND f.enabled
    ) AND EXISTS (SELECT 1 FROM public.shopping_lists l WHERE l.id = list_id AND l.owner_id = (SELECT auth.uid()))
  );
CREATE POLICY shopping_list_items_delete_enabled_own ON public.shopping_list_items
  FOR DELETE TO authenticated USING (
    owner_id = (SELECT auth.uid()) AND EXISTS (
      SELECT 1 FROM public.user_feature_flags f
       WHERE f.owner_id = (SELECT auth.uid()) AND f.feature_key = 'shopping_lists' AND f.enabled
    ) AND EXISTS (SELECT 1 FROM public.shopping_lists l WHERE l.id = list_id AND l.owner_id = (SELECT auth.uid()))
  );
REVOKE ALL ON public.shopping_list_items FROM authenticated, anon;
GRANT SELECT, DELETE ON public.shopping_list_items TO authenticated;
GRANT INSERT (list_id, name, quantity, expected_cost),
      UPDATE (name, quantity, expected_cost, purchased) ON public.shopping_list_items TO authenticated;

NOTIFY pgrst, 'reload schema';

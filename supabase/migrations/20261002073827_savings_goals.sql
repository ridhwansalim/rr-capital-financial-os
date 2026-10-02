-- Goal progress is planning data entered explicitly by the owner. No goal or
-- contribution row is linked to, or posted into, the transaction ledger.
CREATE TABLE public.savings_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  target_amount numeric(14,2) NOT NULL CHECK (target_amount > 0),
  target_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT savings_goals_id_owner_key UNIQUE(id, owner_id)
);
CREATE INDEX savings_goals_owner_idx ON public.savings_goals(owner_id, created_at DESC);
ALTER TABLE public.savings_goals ENABLE ROW LEVEL SECURITY;
CREATE POLICY savings_goals_select_enabled_own ON public.savings_goals
  FOR SELECT TO authenticated USING (
    owner_id = (SELECT auth.uid()) AND EXISTS (
      SELECT 1 FROM public.user_feature_flags f
       WHERE f.owner_id = (SELECT auth.uid()) AND f.feature_key = 'savings_goals' AND f.enabled
    )
  );
CREATE POLICY savings_goals_insert_enabled_own ON public.savings_goals
  FOR INSERT TO authenticated WITH CHECK (
    owner_id = (SELECT auth.uid()) AND EXISTS (
      SELECT 1 FROM public.user_feature_flags f
       WHERE f.owner_id = (SELECT auth.uid()) AND f.feature_key = 'savings_goals' AND f.enabled
    )
  );
CREATE POLICY savings_goals_update_enabled_own ON public.savings_goals
  FOR UPDATE TO authenticated USING (
    owner_id = (SELECT auth.uid()) AND EXISTS (
      SELECT 1 FROM public.user_feature_flags f
       WHERE f.owner_id = (SELECT auth.uid()) AND f.feature_key = 'savings_goals' AND f.enabled
    )
  ) WITH CHECK (
    owner_id = (SELECT auth.uid()) AND EXISTS (
      SELECT 1 FROM public.user_feature_flags f
       WHERE f.owner_id = (SELECT auth.uid()) AND f.feature_key = 'savings_goals' AND f.enabled
    )
  );
CREATE POLICY savings_goals_delete_enabled_own ON public.savings_goals
  FOR DELETE TO authenticated USING (
    owner_id = (SELECT auth.uid()) AND EXISTS (
      SELECT 1 FROM public.user_feature_flags f
       WHERE f.owner_id = (SELECT auth.uid()) AND f.feature_key = 'savings_goals' AND f.enabled
    )
  );
REVOKE ALL ON public.savings_goals FROM authenticated, anon;
GRANT SELECT, DELETE ON public.savings_goals TO authenticated;
GRANT INSERT (name, target_amount, target_date), UPDATE (name, target_amount, target_date)
  ON public.savings_goals TO authenticated;

CREATE TABLE public.savings_goal_contributions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  goal_id uuid NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  contributed_on date NOT NULL DEFAULT (statement_timestamp() AT TIME ZONE 'Asia/Kolkata')::date,
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT savings_goal_contributions_goal_owner_fkey FOREIGN KEY (goal_id, owner_id)
    REFERENCES public.savings_goals(id, owner_id) ON DELETE CASCADE
);
CREATE INDEX savings_goal_contributions_owner_date_idx
  ON public.savings_goal_contributions(owner_id, contributed_on DESC);
CREATE INDEX savings_goal_contributions_goal_owner_idx
  ON public.savings_goal_contributions(goal_id, owner_id);
ALTER TABLE public.savings_goal_contributions ENABLE ROW LEVEL SECURITY;
CREATE POLICY savings_goal_contributions_select_enabled_own ON public.savings_goal_contributions
  FOR SELECT TO authenticated USING (
    owner_id = (SELECT auth.uid()) AND EXISTS (
      SELECT 1 FROM public.user_feature_flags f
       WHERE f.owner_id = (SELECT auth.uid()) AND f.feature_key = 'savings_goals' AND f.enabled
    )
  );
CREATE POLICY savings_goal_contributions_insert_enabled_own ON public.savings_goal_contributions
  FOR INSERT TO authenticated WITH CHECK (
    owner_id = (SELECT auth.uid()) AND EXISTS (
      SELECT 1 FROM public.user_feature_flags f
       WHERE f.owner_id = (SELECT auth.uid()) AND f.feature_key = 'savings_goals' AND f.enabled
    )
  );
CREATE POLICY savings_goal_contributions_update_enabled_own ON public.savings_goal_contributions
  FOR UPDATE TO authenticated USING (
    owner_id = (SELECT auth.uid()) AND EXISTS (
      SELECT 1 FROM public.user_feature_flags f
       WHERE f.owner_id = (SELECT auth.uid()) AND f.feature_key = 'savings_goals' AND f.enabled
    )
  ) WITH CHECK (
    owner_id = (SELECT auth.uid()) AND EXISTS (
      SELECT 1 FROM public.user_feature_flags f
       WHERE f.owner_id = (SELECT auth.uid()) AND f.feature_key = 'savings_goals' AND f.enabled
    )
  );
CREATE POLICY savings_goal_contributions_delete_enabled_own ON public.savings_goal_contributions
  FOR DELETE TO authenticated USING (
    owner_id = (SELECT auth.uid()) AND EXISTS (
      SELECT 1 FROM public.user_feature_flags f
       WHERE f.owner_id = (SELECT auth.uid()) AND f.feature_key = 'savings_goals' AND f.enabled
    )
  );
REVOKE ALL ON public.savings_goal_contributions FROM authenticated, anon;
GRANT SELECT, DELETE ON public.savings_goal_contributions TO authenticated;
GRANT INSERT (goal_id, amount, contributed_on, note),
      UPDATE (amount, contributed_on, note) ON public.savings_goal_contributions TO authenticated;

NOTIFY pgrst, 'reload schema';

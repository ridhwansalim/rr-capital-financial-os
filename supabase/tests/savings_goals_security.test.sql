BEGIN;
SELECT plan(15);
INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
('00000000-0000-4000-a000-000000000071','goal-a@example.invalid','{}'),
('00000000-0000-4000-a000-000000000072','goal-b@example.invalid','{}');

SELECT ok(
  has_table_privilege('authenticated','public.savings_goals','SELECT')
  AND NOT has_column_privilege('authenticated','public.savings_goals','owner_id','INSERT')
  AND NOT has_column_privilege('authenticated','public.savings_goals','owner_id','UPDATE')
  AND has_column_privilege('authenticated','public.savings_goals','name','INSERT')
  AND has_table_privilege('authenticated','public.savings_goal_contributions','SELECT')
  AND NOT has_column_privilege('authenticated','public.savings_goal_contributions','owner_id','INSERT')
  AND has_column_privilege('authenticated','public.savings_goal_contributions','goal_id','INSERT')
  AND has_column_privilege('authenticated','public.savings_goal_contributions','note','UPDATE'),
  'savings tables expose owner-scoped reads and only editable planning fields'
);
SELECT ok(NOT has_table_privilege('anon','public.savings_goals','SELECT')
          AND NOT has_table_privilege('anon','public.savings_goal_contributions','SELECT'),
          'anonymous users cannot access goals or contributions');
SELECT ok(NOT EXISTS (
  SELECT 1 FROM information_schema.columns
   WHERE table_schema='public' AND table_name='savings_goal_contributions'
     AND column_name IN ('transaction_id','account_id','client_request_id')
), 'contributions have no ledger or account linkage that can double-count balances');

SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-a000-000000000071',true);
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-4000-a000-000000000071","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
INSERT INTO public.user_feature_flags(feature_key,enabled) VALUES ('savings_goals',true);
INSERT INTO public.savings_goals(name,target_amount,target_date)
VALUES ('Synthetic family trip',50000,'2027-12-01');
SELECT is((SELECT owner_id FROM public.savings_goals WHERE name='Synthetic family trip'),
          '00000000-0000-4000-a000-000000000071'::uuid,'goal owner defaults to auth.uid()');
INSERT INTO public.savings_goal_contributions(goal_id,amount,contributed_on,note)
SELECT id,1250,'2026-10-01','Synthetic contribution' FROM public.savings_goals WHERE name='Synthetic family trip';
SELECT is((SELECT owner_id FROM public.savings_goal_contributions LIMIT 1),
          '00000000-0000-4000-a000-000000000071'::uuid,'contribution owner defaults to auth.uid()');
SELECT is((SELECT sum(amount)::numeric FROM public.savings_goal_contributions),1250::numeric,
          'owner can record an explicit planning contribution');

DO $$ BEGIN
  BEGIN
    INSERT INTO public.savings_goal_contributions(owner_id,goal_id,amount)
    SELECT '00000000-0000-4000-a000-000000000072',id,100 FROM public.savings_goals LIMIT 1;
    RAISE EXCEPTION 'forged contribution owner unexpectedly accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
SELECT ok(true,'contribution ownership cannot be forged');

UPDATE public.user_feature_flags SET enabled=false WHERE feature_key='savings_goals';
SELECT is((SELECT count(*)::integer FROM public.savings_goals),0,'disabled module hides goal rows');
SELECT is((SELECT count(*)::integer FROM public.savings_goal_contributions),0,'disabled module hides contribution rows');
DO $$ BEGIN
  BEGIN
    INSERT INTO public.savings_goals(name,target_amount) VALUES ('Disabled synthetic goal',100);
    RAISE EXCEPTION 'disabled module write unexpectedly accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
SELECT ok(true,'database blocks goal writes while the module is disabled');

RESET ROLE;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-a000-000000000072',true);
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-4000-a000-000000000072","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::integer FROM public.savings_goals),0,'other owner cannot read goals');
SELECT is((SELECT count(*)::integer FROM public.savings_goal_contributions),0,'other owner cannot read contributions');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-a000-000000000071',true);
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-4000-a000-000000000071","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
UPDATE public.user_feature_flags SET enabled=true WHERE feature_key='savings_goals';
SELECT is((SELECT count(*)::integer FROM public.savings_goals),1,'reenabling restores the saved goal');
SELECT is((SELECT count(*)::integer FROM public.savings_goal_contributions),1,'reenabling restores its contributions');
DELETE FROM public.savings_goals WHERE name='Synthetic family trip';
SELECT is((SELECT count(*)::integer FROM public.savings_goal_contributions),0,'deleting a goal removes only its own contribution records');
RESET ROLE;
SELECT * FROM finish();
ROLLBACK;

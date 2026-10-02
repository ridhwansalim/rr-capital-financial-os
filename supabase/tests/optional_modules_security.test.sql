BEGIN;
SELECT plan(14);

INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
('00000000-0000-4000-a000-000000000051','feature-a@example.invalid','{}'),
('00000000-0000-4000-a000-000000000052','feature-b@example.invalid','{}');

SELECT ok(
  has_table_privilege('authenticated','public.user_feature_flags','SELECT')
  AND NOT has_table_privilege('authenticated','public.user_feature_flags','INSERT')
  AND has_column_privilege('authenticated','public.user_feature_flags','feature_key','INSERT')
  AND has_column_privilege('authenticated','public.user_feature_flags','enabled','INSERT')
  AND NOT has_column_privilege('authenticated','public.user_feature_flags','owner_id','INSERT')
  AND has_column_privilege('authenticated','public.user_feature_flags','enabled','UPDATE')
  AND NOT has_column_privilege('authenticated','public.user_feature_flags','owner_id','UPDATE'),
  'feature flags expose only owner-scoped read and key/enabled writes'
);
SELECT ok(NOT has_table_privilege('anon','public.user_feature_flags','SELECT')
          AND NOT has_table_privilege('anon','public.budget_envelopes','SELECT'),
          'anonymous role cannot access optional module data');

SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-a000-000000000051',true);
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-4000-a000-000000000051","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::integer FROM public.user_feature_flags),0,'missing feature preference is disabled by default');
INSERT INTO public.user_feature_flags(feature_key,enabled) VALUES ('budgets',true);
SELECT is((SELECT owner_id FROM public.user_feature_flags WHERE feature_key='budgets'),
          '00000000-0000-4000-a000-000000000051'::uuid,
          'feature flag owner defaults to auth.uid()');
INSERT INTO public.transaction_categories(name,color) VALUES ('Synthetic budget category','#334455');
INSERT INTO public.budget_envelopes(category_id,monthly_limit,rollover_enabled)
SELECT id,1000,true FROM public.transaction_categories WHERE name='Synthetic budget category';
SELECT is((SELECT count(*)::integer FROM public.budget_envelopes),1,'enabled owner can create and read a personal envelope');
SELECT is((SELECT owner_id FROM public.budget_envelopes LIMIT 1),
          '00000000-0000-4000-a000-000000000051'::uuid,
          'budget envelope owner defaults to auth.uid()');

DO $$ BEGIN
  BEGIN
    INSERT INTO public.user_feature_flags(feature_key,enabled) VALUES ('unapproved_module',true);
    RAISE EXCEPTION 'unapproved feature key unexpectedly accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;
SELECT ok(true,'only allowlisted optional module keys can be stored');

DO $$ BEGIN
  BEGIN
    INSERT INTO public.user_feature_flags(owner_id,feature_key,enabled)
    VALUES ('00000000-0000-4000-a000-000000000052','shopping_lists',true);
    RAISE EXCEPTION 'forged feature owner unexpectedly accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
SELECT ok(true,'client cannot forge a feature owner');

UPDATE public.user_feature_flags SET enabled=false WHERE feature_key='budgets';
SELECT is((SELECT count(*)::integer FROM public.budget_envelopes),0,'disabled feature hides saved envelope rows');
DO $$ BEGIN
  BEGIN
    INSERT INTO public.budget_envelopes(category_id,monthly_limit)
    SELECT id,1200 FROM public.transaction_categories WHERE name='Synthetic budget category';
    RAISE EXCEPTION 'write while feature disabled unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
SELECT ok(true,'database denies budget writes while module is disabled');

RESET ROLE;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-a000-000000000052',true);
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-4000-a000-000000000052","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::integer FROM public.user_feature_flags),0,'other signed-in user cannot see owner feature flags');
SELECT is((SELECT count(*)::integer FROM public.budget_envelopes),0,'other signed-in user cannot see owner budgets');
UPDATE public.user_feature_flags SET enabled=true WHERE feature_key='budgets';
SELECT is((SELECT count(*)::integer FROM public.user_feature_flags),0,'other owner cannot enable another user module');

RESET ROLE;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-a000-000000000051',true);
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-4000-a000-000000000051","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
UPDATE public.user_feature_flags SET enabled=true WHERE feature_key='budgets';
SELECT is((SELECT count(*)::integer FROM public.budget_envelopes),1,'reenabling restores saved module data');
RESET ROLE;
SELECT * FROM finish();
ROLLBACK;

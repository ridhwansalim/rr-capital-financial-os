BEGIN;
SELECT plan(16);
INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
('00000000-0000-4000-a000-000000000081','list-a@example.invalid','{}'),
('00000000-0000-4000-a000-000000000082','list-b@example.invalid','{}');

SELECT ok(
  has_table_privilege('authenticated','public.shopping_lists','SELECT')
  AND NOT has_column_privilege('authenticated','public.shopping_lists','owner_id','INSERT')
  AND has_column_privilege('authenticated','public.shopping_lists','archived_at','UPDATE')
  AND has_table_privilege('authenticated','public.shopping_list_items','SELECT')
  AND NOT has_column_privilege('authenticated','public.shopping_list_items','owner_id','INSERT')
  AND has_column_privilege('authenticated','public.shopping_list_items','purchased','UPDATE'),
  'shopping records expose owner-scoped reads and only allowed planning fields'
);
SELECT ok(NOT has_table_privilege('anon','public.shopping_lists','SELECT')
          AND NOT has_table_privilege('anon','public.shopping_list_items','SELECT'),
          'anonymous users cannot read shopping data');
SELECT ok(NOT EXISTS (
  SELECT 1 FROM information_schema.columns
   WHERE table_schema='public' AND table_name='shopping_list_items'
     AND column_name IN ('transaction_id','account_id','client_request_id')
), 'shopping items have no transaction or account linkage');

SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-a000-000000000081',true);
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-4000-a000-000000000081","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
INSERT INTO public.user_feature_flags(feature_key,enabled) VALUES ('shopping_lists',true);
INSERT INTO public.shopping_lists(name) VALUES ('Synthetic household list');
SELECT is((SELECT owner_id FROM public.shopping_lists WHERE name='Synthetic household list'),
          '00000000-0000-4000-a000-000000000081'::uuid,'list owner defaults to auth.uid()');
INSERT INTO public.shopping_list_items(list_id,name,quantity,expected_cost)
SELECT id,'Synthetic groceries',2,150 FROM public.shopping_lists WHERE name='Synthetic household list';
SELECT is((SELECT owner_id FROM public.shopping_list_items LIMIT 1),
          '00000000-0000-4000-a000-000000000081'::uuid,'item owner defaults to auth.uid()');
UPDATE public.shopping_list_items SET purchased=true;
SELECT ok((SELECT purchased FROM public.shopping_list_items LIMIT 1),'owner can mark a list item purchased');
DO $$ BEGIN
  BEGIN
    INSERT INTO public.shopping_list_items(owner_id,list_id,name)
    SELECT '00000000-0000-4000-a000-000000000082',id,'Forged item'
      FROM public.shopping_lists WHERE name='Synthetic household list';
    RAISE EXCEPTION 'forged item owner unexpectedly accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
SELECT ok(true,'item ownership cannot be forged');

UPDATE public.user_feature_flags SET enabled=false WHERE feature_key='shopping_lists';
SELECT is((SELECT count(*)::integer FROM public.shopping_lists),0,'disabled module hides lists');
SELECT is((SELECT count(*)::integer FROM public.shopping_list_items),0,'disabled module hides items');
DO $$ BEGIN
  BEGIN
    INSERT INTO public.shopping_lists(name) VALUES ('Disabled synthetic list');
    RAISE EXCEPTION 'disabled module write unexpectedly accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
SELECT ok(true,'database blocks list writes while the module is disabled');

RESET ROLE;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-a000-000000000082',true);
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-4000-a000-000000000082","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::integer FROM public.shopping_lists),0,'other owner cannot read lists');
SELECT is((SELECT count(*)::integer FROM public.shopping_list_items),0,'other owner cannot read items');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-a000-000000000081',true);
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-4000-a000-000000000081","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
UPDATE public.user_feature_flags SET enabled=true WHERE feature_key='shopping_lists';
SELECT is((SELECT count(*)::integer FROM public.shopping_lists),1,'reenabling restores the saved list');
SELECT is((SELECT count(*)::integer FROM public.shopping_list_items),1,'reenabling restores its items');
UPDATE public.shopping_lists SET archived_at=now() WHERE name='Synthetic household list';
SELECT ok((SELECT archived_at IS NOT NULL FROM public.shopping_lists WHERE name='Synthetic household list'),'owner can archive a list without deleting items');
DELETE FROM public.shopping_lists WHERE name='Synthetic household list';
SELECT is((SELECT count(*)::integer FROM public.shopping_list_items),0,'deleting a list deletes only its own items');
RESET ROLE;
SELECT * FROM finish();
ROLLBACK;

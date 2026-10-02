BEGIN;
SELECT plan(8);

INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
('00000000-0000-4000-a000-000000000041','category-write-a@example.invalid','{}'),
('00000000-0000-4000-a000-000000000042','category-write-b@example.invalid','{}');

SELECT ok(
  NOT has_table_privilege('authenticated','public.transaction_categories','INSERT')
  AND NOT has_table_privilege('authenticated','public.transaction_categories','UPDATE')
  AND has_column_privilege('authenticated','public.transaction_categories','name','INSERT')
  AND has_column_privilege('authenticated','public.transaction_categories','color','INSERT')
  AND has_column_privilege('authenticated','public.transaction_categories','name','UPDATE')
  AND has_column_privilege('authenticated','public.transaction_categories','color','UPDATE')
  AND NOT has_column_privilege('authenticated','public.transaction_categories','id','INSERT')
  AND NOT has_column_privilege('authenticated','public.transaction_categories','owner_id','INSERT')
  AND NOT has_column_privilege('authenticated','public.transaction_categories','created_at','INSERT')
  AND NOT has_column_privilege('authenticated','public.transaction_categories','owner_id','UPDATE')
  AND has_column_privilege('authenticated','public.transaction_categories','id','SELECT')
  AND has_table_privilege('authenticated','public.transaction_categories','DELETE'),
  'authenticated category writes are limited to name/color with owner-scoped read/delete'
);

SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-a000-000000000041',true);
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-4000-a000-000000000041","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;

INSERT INTO public.transaction_categories(name,color)
VALUES ('Synthetic category','#123456');
SELECT is(
  (SELECT owner_id FROM public.transaction_categories WHERE name='Synthetic category'),
  '00000000-0000-4000-a000-000000000041'::uuid,
  'category ownership defaults to the authenticated user'
);

UPDATE public.transaction_categories SET name='Renamed synthetic category',color='#654321'
 WHERE name='Synthetic category';
SELECT is(
  (SELECT color FROM public.transaction_categories WHERE name='Renamed synthetic category'),
  '#654321',
  'owner can edit allowed category fields'
);

DO $$ BEGIN
  BEGIN
    INSERT INTO public.transaction_categories(owner_id,name,color)
    VALUES ('00000000-0000-4000-a000-000000000042','Forged category','#000000');
    RAISE EXCEPTION 'category owner override unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
SELECT ok(true, 'client cannot supply another owner during category insert');

DO $$ BEGIN
  BEGIN
    UPDATE public.transaction_categories SET owner_id='00000000-0000-4000-a000-000000000042'
     WHERE name='Renamed synthetic category';
    RAISE EXCEPTION 'category owner rewrite unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
SELECT ok(true, 'client cannot rewrite category ownership');

RESET ROLE;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-a000-000000000042',true);
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-4000-a000-000000000042","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DELETE FROM public.transaction_categories WHERE name='Renamed synthetic category';
SELECT is(
  (SELECT count(*)::integer FROM public.transaction_categories WHERE name='Renamed synthetic category'),
  0,
  'another owner cannot see the category'
);
RESET ROLE;
SELECT is(
  (SELECT count(*)::integer FROM public.transaction_categories WHERE name='Renamed synthetic category'),
  1,
  'another owner cannot delete the category'
);

SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-a000-000000000041',true);
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-4000-a000-000000000041","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DELETE FROM public.transaction_categories WHERE name='Renamed synthetic category';
SELECT is(
  (SELECT count(*)::integer FROM public.transaction_categories WHERE name='Renamed synthetic category'),
  0,
  'owner can delete their category'
);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;

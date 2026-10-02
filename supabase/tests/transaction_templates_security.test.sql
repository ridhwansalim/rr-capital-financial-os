BEGIN;
SELECT plan(9);
INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
('00000000-0000-4000-a000-000000000061','template-a@example.invalid','{}'),
('00000000-0000-4000-a000-000000000062','template-b@example.invalid','{}');

SELECT ok(
  has_table_privilege('authenticated','public.transaction_templates','SELECT')
  AND has_table_privilege('authenticated','public.transaction_templates','DELETE')
  AND NOT has_column_privilege('authenticated','public.transaction_templates','owner_id','INSERT')
  AND NOT has_column_privilege('authenticated','public.transaction_templates','owner_id','UPDATE')
  AND NOT has_column_privilege('authenticated','public.transaction_templates','id','INSERT')
  AND has_column_privilege('authenticated','public.transaction_templates','name','INSERT')
  AND has_column_privilege('authenticated','public.transaction_templates','from_account_id','UPDATE'),
  'template grants expose draft fields only and derive ownership'
);
SELECT ok(NOT has_table_privilege('anon','public.transaction_templates','SELECT'),
          'anonymous users cannot read templates');
SELECT ok(NOT EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema='public' AND table_name='transaction_templates'
    AND column_name IN ('contact_id','tagged_profile_id','status','request_id','transaction_id')
), 'templates have no counterparty or completed workflow linkage columns');

SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-a000-000000000061',true);
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-4000-a000-000000000061","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
INSERT INTO public.transaction_templates(name,transaction_type,amount,description)
VALUES ('Synthetic rent','expense',25000,'House rent');
SELECT is((SELECT owner_id FROM public.transaction_templates WHERE name='Synthetic rent'),
          '00000000-0000-4000-a000-000000000061'::uuid,'template owner defaults to auth.uid()');
DO $$ BEGIN
  BEGIN
    INSERT INTO public.transaction_templates(owner_id,name,transaction_type)
    VALUES ('00000000-0000-4000-a000-000000000062','Forged','income');
    RAISE EXCEPTION 'forged owner unexpectedly accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
SELECT ok(true,'template owner cannot be forged');
DO $$ BEGIN
  BEGIN
    INSERT INTO public.transaction_templates(name,transaction_type)
    VALUES ('Invalid kind','settlement');
    RAISE EXCEPTION 'invalid template type unexpectedly accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;
SELECT ok(true,'template type is limited to ordinary transaction drafts');
RESET ROLE;

SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-a000-000000000062',true);
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-4000-a000-000000000062","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::integer FROM public.transaction_templates),0,'other owner cannot read a personal template');
DELETE FROM public.transaction_templates;
RESET ROLE;
SELECT is((SELECT count(*)::integer FROM public.transaction_templates),1,'other owner cannot delete the template');
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-a000-000000000061',true);
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-4000-a000-000000000061","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DELETE FROM public.transaction_templates WHERE name='Synthetic rent';
SELECT is((SELECT count(*)::integer FROM public.transaction_templates),0,'owner can delete own template');
RESET ROLE;
SELECT * FROM finish();
ROLLBACK;

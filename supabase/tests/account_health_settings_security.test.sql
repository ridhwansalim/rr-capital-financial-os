BEGIN;
SELECT plan(17);

INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
('00000000-0000-4000-a000-000000000091','health-a@example.invalid','{}'),
('00000000-0000-4000-a000-000000000092','health-b@example.invalid','{}');
INSERT INTO public.accounts(id,owner_id,name,type) VALUES
('00000000-0000-4000-a000-000000000091','00000000-0000-4000-a000-000000000091','Synthetic bank','bank'),
('00000000-0000-4000-a000-000000000093','00000000-0000-4000-a000-000000000092','Other synthetic bank','bank');
INSERT INTO public.accounts(id,owner_id,name,type,credit_limit)
VALUES ('00000000-0000-4000-a000-000000000092','00000000-0000-4000-a000-000000000091','Synthetic credit','credit_card',25000);

SELECT ok(
  has_table_privilege('authenticated','public.account_health_settings','SELECT')
  AND NOT has_column_privilege('authenticated','public.account_health_settings','owner_id','INSERT')
  AND NOT has_column_privilege('authenticated','public.account_health_settings','owner_id','UPDATE')
  AND NOT has_column_privilege('authenticated','public.account_health_settings','account_id','UPDATE')
  AND has_column_privilege('authenticated','public.account_health_settings','minimum_balance','UPDATE')
  AND has_column_privilege('authenticated','public.account_health_settings','show_notices','UPDATE'),
  'only the owner can read settings and only planning fields are mutable'
);
SELECT ok(NOT has_table_privilege('anon','public.account_health_settings','SELECT'),
          'anonymous role cannot read account health settings');
SELECT ok(NOT EXISTS (
  SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='account_health_settings'
    AND column_name IN ('balance','transaction_id','payment_amount','source_transaction_id')
), 'settings contain no balance or transaction/payment linkage');

SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-a000-000000000091',true);
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-4000-a000-000000000091","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
INSERT INTO public.user_feature_flags(feature_key,enabled) VALUES ('account_health',true);
INSERT INTO public.account_health_settings(account_id,minimum_balance,show_notices)
VALUES ('00000000-0000-4000-a000-000000000091',5000,true);
SELECT is((SELECT owner_id FROM public.account_health_settings LIMIT 1),
  '00000000-0000-4000-a000-000000000091'::uuid,'owner is derived from auth.uid()');
SELECT is((SELECT minimum_balance FROM public.account_health_settings LIMIT 1),5000::numeric,
  'owner can save a liquid-account threshold');
INSERT INTO public.account_health_settings(account_id,statement_day,due_day)
VALUES ('00000000-0000-4000-a000-000000000092',5,20);
SELECT is((SELECT count(*)::integer FROM public.account_health_settings),2,
  'owner can save monthly statement and due days for a credit line');

DO $$ BEGIN
  BEGIN
    INSERT INTO public.account_health_settings(owner_id,account_id,minimum_balance)
    VALUES ('00000000-0000-4000-a000-000000000092','00000000-0000-4000-a000-000000000091',100);
    RAISE EXCEPTION 'forged settings owner unexpectedly accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
SELECT ok(true,'settings owner cannot be forged');
DO $$ BEGIN
  BEGIN
    INSERT INTO public.account_health_settings(account_id,due_day)
    VALUES ('00000000-0000-4000-a000-000000000093',15);
    RAISE EXCEPTION 'foreign account settings unexpectedly accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
SELECT ok(true,'settings cannot be attached to another user account');
DO $$ BEGIN
  BEGIN
    INSERT INTO public.account_health_settings(account_id,due_day)
    VALUES ('00000000-0000-4000-a000-000000000092',32);
    RAISE EXCEPTION 'invalid day unexpectedly accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;
SELECT ok(true,'statement and due days are restricted to calendar day values');
DO $$ BEGIN
  BEGIN
    INSERT INTO public.account_health_settings(account_id,minimum_balance)
    VALUES ('00000000-0000-4000-a000-000000000092',500);
    RAISE EXCEPTION 'credit account minimum threshold unexpectedly accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
END $$;
SELECT ok(true,'minimum balance thresholds cannot be set on credit lines');

UPDATE public.user_feature_flags SET enabled=false WHERE feature_key='account_health';
SELECT is((SELECT count(*)::integer FROM public.account_health_settings),0,
  'disabled module hides all saved settings');
DO $$ BEGIN
  BEGIN
    INSERT INTO public.account_health_settings(account_id,minimum_balance)
    VALUES ('00000000-0000-4000-a000-000000000091',100);
    RAISE EXCEPTION 'disabled module insert unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
SELECT ok(true,'database denies settings writes while module is disabled');
RESET ROLE;

SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-a000-000000000092',true);
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-4000-a000-000000000092","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::integer FROM public.account_health_settings),0,
  'another signed-in user cannot read account health settings');
SELECT is((SELECT count(*)::integer FROM public.user_feature_flags),0,
  'another user cannot see or modify the owner feature toggle');
RESET ROLE;

SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-a000-000000000091',true);
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-4000-a000-000000000091","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
UPDATE public.user_feature_flags SET enabled=true WHERE feature_key='account_health';
SELECT is((SELECT count(*)::integer FROM public.account_health_settings),2,
  'reenabling restores saved private settings');
SELECT is((SELECT minimum_balance FROM public.account_health_settings WHERE account_id='00000000-0000-4000-a000-000000000091'),5000::numeric,
  'disabled writes did not alter the retained threshold');
DELETE FROM public.account_health_settings WHERE account_id='00000000-0000-4000-a000-000000000091';
SELECT is((SELECT count(*)::integer FROM public.account_health_settings),1,
  'owner can clear one account context without affecting another account');
RESET ROLE;
SELECT * FROM finish();
ROLLBACK;

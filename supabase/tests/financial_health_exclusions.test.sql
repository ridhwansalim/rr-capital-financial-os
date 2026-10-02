BEGIN;
SELECT plan(8);

INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
 ('00000000-0000-4000-a000-000000000081','score-a@example.invalid','{}'),
 ('00000000-0000-4000-a000-000000000082','score-b@example.invalid','{}');
INSERT INTO public.accounts(id,owner_id,name,type) VALUES
 ('00000000-0000-4000-a000-000000000081','00000000-0000-4000-a000-000000000081','Synthetic A','bank'),
 ('00000000-0000-4000-a000-000000000082','00000000-0000-4000-a000-000000000082','Synthetic B','bank');
INSERT INTO public.transactions(id,owner_id,amount,to_account_id,status) VALUES
 ('00000000-0000-4000-a000-000000000083','00000000-0000-4000-a000-000000000081',10,'00000000-0000-4000-a000-000000000081','COMPLETED'),
 ('00000000-0000-4000-a000-000000000084','00000000-0000-4000-a000-000000000082',20,'00000000-0000-4000-a000-000000000082','COMPLETED'),
 ('00000000-0000-4000-a000-000000000090','00000000-0000-4000-a000-000000000081',15,'00000000-0000-4000-a000-000000000081','COMPLETED');
INSERT INTO public.obligations(id,owner_id,type,amount,related_transaction_id)
VALUES ('00000000-0000-4000-a000-000000000085','00000000-0000-4000-a000-000000000081','lent',10,'00000000-0000-4000-a000-000000000083');
INSERT INTO public.obligations(id,owner_id,creditor_profile_id,type,amount,related_transaction_id)
VALUES ('00000000-0000-4000-a000-000000000094','00000000-0000-4000-a000-000000000082','00000000-0000-4000-a000-000000000081','borrowed',20,'00000000-0000-4000-a000-000000000084');
INSERT INTO public.obligation_payments(obligation_id,transaction_id,amount)
VALUES ('00000000-0000-4000-a000-000000000085','00000000-0000-4000-a000-000000000083',10),
       ('00000000-0000-4000-a000-000000000094','00000000-0000-4000-a000-000000000084',20);
INSERT INTO private.chitti_action_requests(owner_id,request_id,action_kind,chitti_id,account_id,month_number,fee_amount,transaction_id)
VALUES ('00000000-0000-4000-a000-000000000081','00000000-0000-4000-a000-000000000086','CLAIM','00000000-0000-4000-a000-000000000087','00000000-0000-4000-a000-000000000081',1,0,'00000000-0000-4000-a000-000000000083'),
       ('00000000-0000-4000-a000-000000000082','00000000-0000-4000-a000-000000000088','CLAIM','00000000-0000-4000-a000-000000000089','00000000-0000-4000-a000-000000000082',1,0,'00000000-0000-4000-a000-000000000084');
INSERT INTO private.emi_bank_action_requests(owner_id,request_id,emi_id,account_id,month_number,transaction_date,transaction_id)
VALUES ('00000000-0000-4000-a000-000000000081','00000000-0000-4000-a000-000000000091','00000000-0000-4000-a000-000000000092','00000000-0000-4000-a000-000000000081',1,now(),'00000000-0000-4000-a000-000000000090');

SELECT ok(has_function_privilege('authenticated','public.financial_health_excluded_transaction_ids()','EXECUTE'),
  'signed-in users can call the fixed exclusion function');
SELECT ok(NOT has_function_privilege('anon','public.financial_health_excluded_transaction_ids()','EXECUTE'),
  'anonymous callers cannot call the exclusion function');
SELECT ok(has_function_privilege('authenticated','private.financial_health_excluded_transaction_ids()','EXECUTE'),
  'authenticated callers can execute only the no-argument, auth.uid-scoped private helper');
SELECT ok((SELECT NOT prosecdef AND proconfig @> ARRAY['search_path=pg_catalog, public, private, pg_temp']
  FROM pg_proc WHERE oid='public.financial_health_excluded_transaction_ids()'::regprocedure),
  'public wrapper is invoker-rights with a fixed search path');
SELECT ok((SELECT prosecdef AND proconfig @> ARRAY['search_path=pg_catalog, public, private, pg_temp']
  FROM pg_proc WHERE oid='private.financial_health_excluded_transaction_ids()'::regprocedure),
  'private helper is narrowly scoped, identity-derived, and has a fixed search path');
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-a000-000000000081',true);
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-4000-a000-000000000081","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT ok((SELECT array_agg(transaction_id ORDER BY transaction_id) = ARRAY['00000000-0000-4000-a000-000000000083'::uuid,'00000000-0000-4000-a000-000000000090'::uuid]
  FROM public.financial_health_excluded_transaction_ids()),
  'caller receives only IDs linked to own obligation, Chitti, and EMI records');
SELECT ok((SELECT count(*) = 0 FROM public.financial_health_excluded_transaction_ids()
  WHERE transaction_id='00000000-0000-4000-a000-000000000084'),
  'another users linked transaction ID is never returned');
SELECT set_config('request.jwt.claim.sub','',true);
SELECT set_config('request.jwt.claims','{"role":"anon"}',true);
RESET ROLE;
SET LOCAL ROLE anon;
SELECT throws_ok('SELECT * FROM public.financial_health_excluded_transaction_ids()', '42501', NULL,
  'anonymous execution is denied');
RESET ROLE;
SELECT * FROM finish();
ROLLBACK;

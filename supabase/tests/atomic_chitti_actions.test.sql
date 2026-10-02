-- Run against an isolated database with the production schema and migrations.
BEGIN;
INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
  ('00000000-0000-4000-a000-000000000051','chitti-a@example.invalid','{}'),
  ('00000000-0000-4000-a000-000000000052','chitti-b@example.invalid','{}');
INSERT INTO public.accounts(id,owner_id,name,type) VALUES
  ('10000000-0000-4000-a000-000000000051','00000000-0000-4000-a000-000000000051','Bank','bank'),
  ('10000000-0000-4000-a000-000000000053','00000000-0000-4000-a000-000000000051','Empty bank','bank'),
  ('10000000-0000-4000-a000-000000000052','00000000-0000-4000-a000-000000000052','Other','bank');
INSERT INTO public.chittis(id,owner_id,name,total_pot,duration_months,monthly_installment,start_date)
VALUES
  ('20000000-0000-4000-a000-000000000051','00000000-0000-4000-a000-000000000051','My plan',120,12,10,(statement_timestamp() AT TIME ZONE 'Asia/Kolkata')::date),
  ('20000000-0000-4000-a000-000000000052','00000000-0000-4000-a000-000000000052','Other plan',120,12,10,(statement_timestamp() AT TIME ZONE 'Asia/Kolkata')::date);
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-a000-000000000051',true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  plan_id uuid := '20000000-0000-4000-a000-000000000051';
  account_id uuid := '10000000-0000-4000-a000-000000000051';
  other_plan uuid := '20000000-0000-4000-a000-000000000052';
  claim_request uuid := '30000000-0000-4000-a000-000000000051';
  pay_request uuid := '30000000-0000-4000-a000-000000000052';
  reused_request uuid := '30000000-0000-4000-a000-000000000053';
  posted_at timestamptz := now();
  first_id uuid;
BEGIN
  PERFORM public.post_ledger_transaction(
    reused_request,NULL,account_id,1,0,'Other transaction',posted_at
  );
  BEGIN
    PERFORM public.claim_chitti_pot(reused_request,plan_id,account_id,3,10);
    RAISE EXCEPTION 'Existing ledger request ID was reused for a claim';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  first_id := public.claim_chitti_pot(claim_request,plan_id,account_id,3,10);
  IF public.claim_chitti_pot(claim_request,plan_id,account_id,3,10) <> first_id THEN
    RAISE EXCEPTION 'Claim retry changed transaction';
  END IF;
  IF (SELECT count(*) FROM public.transactions WHERE client_request_id=claim_request) <> 1
     OR (SELECT payout_received FROM public.chittis WHERE id=plan_id) <> 110 THEN
    RAISE EXCEPTION 'Claim did not atomically update ledger and plan';
  END IF;
  BEGIN
    UPDATE public.chittis SET received_month_number=4 WHERE id=plan_id;
    RAISE EXCEPTION 'Client directly changed claim progress';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE public.chittis SET total_pot=130 WHERE id=plan_id;
    RAISE EXCEPTION 'Client changed financial terms after a posting';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    DELETE FROM public.chittis WHERE id=plan_id;
    RAISE EXCEPTION 'Posted Chitti was deleted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.claim_chitti_pot(gen_random_uuid(),plan_id,account_id,3,10);
    RAISE EXCEPTION 'Second claim succeeded';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.claim_chitti_pot(gen_random_uuid(),other_plan,account_id,3,10);
    RAISE EXCEPTION 'Foreign claim succeeded';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.pay_chitti_installment(gen_random_uuid(),plan_id,account_id,13,posted_at);
    RAISE EXCEPTION 'Out-of-range installment succeeded';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  first_id := public.pay_chitti_installment(pay_request,plan_id,account_id,1,posted_at);
  IF public.pay_chitti_installment(pay_request,plan_id,account_id,1,posted_at) <> first_id THEN
    RAISE EXCEPTION 'Installment retry changed transaction';
  END IF;
  IF (SELECT count(*) FROM public.transactions WHERE client_request_id=pay_request) <> 1
     OR (SELECT months_paid FROM public.chittis WHERE id=plan_id) <> 1 THEN
    RAISE EXCEPTION 'Installment did not atomically update ledger and plan';
  END IF;
  BEGIN
    PERFORM public.pay_chitti_installment(
      gen_random_uuid(),plan_id,'10000000-0000-4000-a000-000000000053',2,posted_at
    );
    RAISE EXCEPTION 'Installment overdrew an empty bank';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  IF (SELECT months_paid FROM public.chittis WHERE id=plan_id) <> 1 THEN
    RAISE EXCEPTION 'Failed installment advanced plan progress';
  END IF;
  BEGIN
    PERFORM public.pay_chitti_installment(pay_request,plan_id,account_id,1,posted_at+interval '1 hour');
    RAISE EXCEPTION 'Changed installment retry succeeded';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
END $$;
ROLLBACK;
SELECT plan(1);
SELECT pass('atomic Chitti SQL assertions completed without exception');
SELECT * FROM finish();

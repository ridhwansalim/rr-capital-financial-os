-- Run against an isolated database with the production schema and migrations.
BEGIN;
INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
  ('00000000-0000-4000-a000-000000000071','debtor@example.invalid','{}'),
  ('00000000-0000-4000-a000-000000000072','creditor@example.invalid','{}');
INSERT INTO public.accounts(id,owner_id,name,type,opening_balance,opening_date) VALUES
  ('10000000-0000-4000-a000-000000000071','00000000-0000-4000-a000-000000000071','Debtor bank','bank',100,
    (statement_timestamp() AT TIME ZONE 'Asia/Kolkata')::date - 2),
  ('10000000-0000-4000-a000-000000000072','00000000-0000-4000-a000-000000000072','Creditor bank','bank',0,
    (statement_timestamp() AT TIME ZONE 'Asia/Kolkata')::date),
  ('10000000-0000-4000-a000-000000000073','00000000-0000-4000-a000-000000000071','Empty bank','bank',0,
    (statement_timestamp() AT TIME ZONE 'Asia/Kolkata')::date);
INSERT INTO public.transactions(owner_id,initiator_profile_id,to_account_id,amount,status)
VALUES ('00000000-0000-4000-a000-000000000071','00000000-0000-4000-a000-000000000071',
        '10000000-0000-4000-a000-000000000071',100,'COMPLETED');
INSERT INTO public.obligations
  (id,owner_id,type,amount,total_amount,status,creditor_profile_id,debtor_profile_id,description)
VALUES
  ('20000000-0000-4000-a000-000000000071','00000000-0000-4000-a000-000000000071',
   'borrowed',50,50,'ACCEPTED','00000000-0000-4000-a000-000000000072',
   '00000000-0000-4000-a000-000000000071','Shared EMI');
INSERT INTO public.recurring_emis
  (id,owner_id,name,amount,start_date,end_date,type,status,
   counterparty_profile_id,related_obligation_id,initiator_account_id)
VALUES
  ('30000000-0000-4000-a000-000000000071','00000000-0000-4000-a000-000000000071',
   'Shared EMI',10,current_date,(current_date+interval '4 months')::date,'borrowed','ACTIVE',
   '00000000-0000-4000-a000-000000000072','20000000-0000-4000-a000-000000000071',
   '10000000-0000-4000-a000-000000000071');
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-a000-000000000071',true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  debt_id uuid := '20000000-0000-4000-a000-000000000071';
  account_id uuid := '10000000-0000-4000-a000-000000000071';
  request_id uuid := '40000000-0000-4000-a000-000000000071';
  settlement_id uuid;
  today_india date := (statement_timestamp() AT TIME ZONE 'Asia/Kolkata')::date;
BEGIN
  settlement_id := public.request_settlement(request_id,debt_id,account_id,10,1,today_india);
  IF public.request_settlement(request_id,debt_id,account_id,10,1,today_india) <> settlement_id THEN
    RAISE EXCEPTION 'Settlement request retry duplicated the request';
  END IF;
  BEGIN
    PERFORM public.request_settlement(request_id,debt_id,account_id,10,1,today_india - 1);
    RAISE EXCEPTION 'Same request ID accepted a different occurrence date';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    PERFORM public.request_settlement(gen_random_uuid(),debt_id,
      '10000000-0000-4000-a000-000000000073',10,NULL,today_india - 1);
    RAISE EXCEPTION 'Settlement before source-account opening was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.request_settlement(gen_random_uuid(),debt_id,
      '10000000-0000-4000-a000-000000000071',10,NULL,today_india + 1);
    RAISE EXCEPTION 'Future settlement date was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.request_settlement(gen_random_uuid(),debt_id,account_id,10,1);
    RAISE EXCEPTION 'Duplicate EMI month was requested';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.settlements SET status='COMPLETED' WHERE id=settlement_id;
    RAISE EXCEPTION 'Direct settlement status change succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.settlements
      (obligation_id,initiator_id,counterparty_profile_id,amount,source_account_id)
    VALUES (debt_id,'00000000-0000-4000-a000-000000000071',
            '00000000-0000-4000-a000-000000000072',10,account_id);
    RAISE EXCEPTION 'Direct settlement insert succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.accept_settlement(settlement_id,account_id,
      '00000000-0000-4000-a000-000000000071');
    RAISE EXCEPTION 'Debtor approved their own request';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-a000-000000000072',true);
DO $$
DECLARE
  settlement_id uuid := (
    SELECT id FROM public.settlements
     WHERE client_request_id='40000000-0000-4000-a000-000000000071'
  );
  destination uuid := '10000000-0000-4000-a000-000000000072';
BEGIN
  PERFORM public.accept_settlement(settlement_id,destination,
    '00000000-0000-4000-a000-000000000072');
  PERFORM public.accept_settlement(settlement_id,destination,
    '00000000-0000-4000-a000-000000000072');
  IF (SELECT amount FROM public.obligations
       WHERE id='20000000-0000-4000-a000-000000000071') <> 40
     OR (SELECT owner_months_paid FROM public.recurring_emis
       WHERE id='30000000-0000-4000-a000-000000000071') <> 1
     OR (SELECT counterparty_months_paid FROM public.recurring_emis
       WHERE id='30000000-0000-4000-a000-000000000071') <> 0
     OR (SELECT count(*) FROM public.transactions
       WHERE description LIKE 'Repayment %: Shared EMI') <> 1
     OR (SELECT (created_at AT TIME ZONE 'Asia/Kolkata')::date FROM public.transactions
          WHERE owner_id='00000000-0000-4000-a000-000000000072'
            AND description='Repayment Received: Shared EMI') <>
        (statement_timestamp() AT TIME ZONE 'Asia/Kolkata')::date THEN
    RAISE EXCEPTION 'Settlement approval was not atomic or was duplicated';
  END IF;
  BEGIN
    UPDATE public.settlements SET amount=99 WHERE id=settlement_id;
    RAISE EXCEPTION 'Creditor changed a completed settlement';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.decline_settlement(settlement_id,'Too late');
    RAISE EXCEPTION 'Completed settlement was declined';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
END $$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-a000-000000000071',true);
DO $$
BEGIN
  PERFORM public.request_settlement(
    '40000000-0000-4000-a000-000000000072',
    '20000000-0000-4000-a000-000000000071',
    '10000000-0000-4000-a000-000000000071',10,2,
    (statement_timestamp() AT TIME ZONE 'Asia/Kolkata')::date - 1
  );
END $$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-a000-000000000072',true);
DO $$
DECLARE
  settlement_id uuid := (
    SELECT id FROM public.settlements WHERE client_request_id='40000000-0000-4000-a000-000000000072'
  );
BEGIN
  BEGIN
    PERFORM public.accept_settlement(settlement_id,
      '10000000-0000-4000-a000-000000000072',
      '00000000-0000-4000-a000-000000000072');
    RAISE EXCEPTION 'Settlement before destination-account opening was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  IF (SELECT status FROM public.settlements WHERE id=settlement_id) <> 'PENDING_APPROVAL'
     OR (SELECT amount FROM public.obligations
       WHERE id='20000000-0000-4000-a000-000000000071') <> 40 THEN
    RAISE EXCEPTION 'Rejected date-boundary approval changed settlement or debt';
  END IF;
  PERFORM public.decline_settlement(settlement_id,'Date predates receiving account setup');
END $$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-a000-000000000071',true);
DO $$
BEGIN
  PERFORM public.request_settlement(
    '40000000-0000-4000-a000-000000000073',
    '20000000-0000-4000-a000-000000000071',
    '10000000-0000-4000-a000-000000000073',10,2,
    (statement_timestamp() AT TIME ZONE 'Asia/Kolkata')::date
  );
END $$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-a000-000000000072',true);
DO $$
DECLARE
  settlement_id uuid := (
    SELECT id FROM public.settlements
     WHERE client_request_id='40000000-0000-4000-a000-000000000073'
  );
BEGIN
  BEGIN
    PERFORM public.accept_settlement(settlement_id,
      '10000000-0000-4000-a000-000000000072',
      '00000000-0000-4000-a000-000000000072');
    RAISE EXCEPTION 'Empty source bank was overdrawn';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  IF (SELECT status FROM public.settlements WHERE id=settlement_id) <> 'PENDING_APPROVAL'
     OR (SELECT amount FROM public.obligations
       WHERE id='20000000-0000-4000-a000-000000000071') <> 40 THEN
    RAISE EXCEPTION 'Failed settlement changed state';
  END IF;
  PERFORM public.decline_settlement(settlement_id,'Not received');
  IF (SELECT status FROM public.settlements WHERE id=settlement_id) <> 'DECLINED' THEN
    RAISE EXCEPTION 'Decline action did not persist';
  END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-a000-000000000071',true);
DO $$
DECLARE
  declined_id uuid := (
    SELECT id FROM public.settlements
     WHERE client_request_id='40000000-0000-4000-a000-000000000073'
  );
  replacement_id uuid;
BEGIN
  PERFORM public.dismiss_declined_settlement(declined_id);
  PERFORM public.dismiss_declined_settlement(declined_id);
  IF (SELECT status FROM public.settlements WHERE id=declined_id) <> 'DECLINED'
     OR (SELECT initiator_dismissed_at FROM public.settlements WHERE id=declined_id) IS NULL THEN
    RAISE EXCEPTION 'Dismissing changed financial settlement state';
  END IF;
  replacement_id := public.request_settlement(
    gen_random_uuid(),
    '20000000-0000-4000-a000-000000000071',
    '10000000-0000-4000-a000-000000000071',10,NULL
  );
  IF (SELECT emi_month_number FROM public.settlements WHERE id=replacement_id) <> 2 THEN
    RAISE EXCEPTION 'Replacement request did not infer the next EMI month';
  END IF;
END $$;
ROLLBACK;
SELECT plan(1);
SELECT pass('settlement-integrity SQL assertions completed without exception');
SELECT * FROM finish();

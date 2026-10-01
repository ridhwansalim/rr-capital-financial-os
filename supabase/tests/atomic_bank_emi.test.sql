-- Run against an isolated database with the production schema and migrations.
BEGIN;
INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
  ('00000000-0000-4000-a000-000000000061','emi-a@example.invalid','{}'),
  ('00000000-0000-4000-a000-000000000062','emi-b@example.invalid','{}');
INSERT INTO public.accounts(id,owner_id,name,type) VALUES
  ('10000000-0000-4000-a000-000000000061','00000000-0000-4000-a000-000000000061','A bank','bank'),
  ('10000000-0000-4000-a000-000000000062','00000000-0000-4000-a000-000000000062','B bank','bank'),
  ('10000000-0000-4000-a000-000000000063','00000000-0000-4000-a000-000000000061','Empty bank','bank');
INSERT INTO public.recurring_emis
  (id,owner_id,name,amount,start_date,end_date,type,status,counterparty_profile_id,initiator_account_id)
VALUES
  ('20000000-0000-4000-a000-000000000061','00000000-0000-4000-a000-000000000061','Personal',10,current_date,(current_date+interval '2 months')::date,'personal','ACTIVE',NULL,'10000000-0000-4000-a000-000000000061'),
  ('20000000-0000-4000-a000-000000000062','00000000-0000-4000-a000-000000000061','Lent',10,current_date,(current_date+interval '2 months')::date,'lent','ACTIVE','00000000-0000-4000-a000-000000000062','10000000-0000-4000-a000-000000000061'),
  ('20000000-0000-4000-a000-000000000063','00000000-0000-4000-a000-000000000061','Borrowed',10,current_date,(current_date+interval '2 months')::date,'borrowed','ACTIVE','00000000-0000-4000-a000-000000000062','10000000-0000-4000-a000-000000000061');
INSERT INTO public.transactions(owner_id,initiator_profile_id,to_account_id,amount,status)
VALUES
  ('00000000-0000-4000-a000-000000000061','00000000-0000-4000-a000-000000000061','10000000-0000-4000-a000-000000000061',100,'COMPLETED'),
  ('00000000-0000-4000-a000-000000000062','00000000-0000-4000-a000-000000000062','10000000-0000-4000-a000-000000000062',100,'COMPLETED');
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-a000-000000000061',true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  owner_account uuid := '10000000-0000-4000-a000-000000000061';
  personal uuid := '20000000-0000-4000-a000-000000000061';
  lent uuid := '20000000-0000-4000-a000-000000000062';
  borrowed uuid := '20000000-0000-4000-a000-000000000063';
  request_id uuid := '30000000-0000-4000-a000-000000000061';
  posted_at timestamptz := now();
  transaction_id uuid;
BEGIN
  transaction_id := public.pay_bank_emi(request_id,personal,owner_account,1,posted_at);
  IF public.pay_bank_emi(request_id,personal,owner_account,1,posted_at) <> transaction_id THEN
    RAISE EXCEPTION 'Bank EMI retry changed transaction';
  END IF;
  IF (SELECT count(*) FROM public.transactions WHERE client_request_id=request_id) <> 1
     OR (SELECT to_account_id FROM public.transactions WHERE id=transaction_id) IS NOT NULL
     OR (SELECT owner_months_paid FROM public.recurring_emis WHERE id=personal) <> 1 THEN
    RAISE EXCEPTION 'Bank EMI did not atomically post an external outflow';
  END IF;
  BEGIN
    UPDATE public.recurring_emis SET owner_months_paid=2 WHERE id=personal;
    RAISE EXCEPTION 'Direct bank EMI progress update succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.pay_bank_emi(gen_random_uuid(),borrowed,owner_account,1,posted_at);
    RAISE EXCEPTION 'Peer-bank-side payment was allowed for borrower';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.pay_bank_emi(gen_random_uuid(),personal,
      '10000000-0000-4000-a000-000000000063',2,posted_at);
    RAISE EXCEPTION 'Empty bank was overdrawn';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  IF (SELECT owner_months_paid FROM public.recurring_emis WHERE id=personal) <> 1 THEN
    RAISE EXCEPTION 'Failed bank payment advanced progress';
  END IF;
  PERFORM public.pay_bank_emi(gen_random_uuid(),lent,owner_account,1,posted_at);
  IF (SELECT owner_months_paid FROM public.recurring_emis WHERE id=lent) <> 1 THEN
    RAISE EXCEPTION 'Lent EMI bank payer progress was not recorded';
  END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-a000-000000000062',true);
DO $$
DECLARE
  posted_at timestamptz := now();
BEGIN
  BEGIN
    PERFORM public.pay_bank_emi(gen_random_uuid(),
      '20000000-0000-4000-a000-000000000062',
      '10000000-0000-4000-a000-000000000062',1,posted_at);
    RAISE EXCEPTION 'Lent EMI peer paid bank side';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM public.pay_bank_emi(gen_random_uuid(),
    '20000000-0000-4000-a000-000000000063',
    '10000000-0000-4000-a000-000000000062',1,posted_at);
  IF (SELECT counterparty_months_paid FROM public.recurring_emis
       WHERE id='20000000-0000-4000-a000-000000000063') <> 1 THEN
    RAISE EXCEPTION 'Borrowed EMI bank payer progress was not recorded';
  END IF;
END $$;
ROLLBACK;

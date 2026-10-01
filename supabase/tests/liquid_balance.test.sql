-- Run against an isolated database with the production schema and migrations.
BEGIN;
INSERT INTO auth.users(id,email,raw_user_meta_data)
  VALUES ('00000000-0000-4000-a000-000000000041','balance@example.invalid','{}');
INSERT INTO public.accounts(id,owner_id,name,type) VALUES
  ('10000000-0000-4000-a000-000000000041','00000000-0000-4000-a000-000000000041','Bank A','bank'),
  ('10000000-0000-4000-a000-000000000042','00000000-0000-4000-a000-000000000041','Bank B','bank'),
  ('10000000-0000-4000-a000-000000000043','00000000-0000-4000-a000-000000000041','Credit','credit_card');
-- Privileged fixtures model an opening balance and a legacy pending entry.
INSERT INTO public.transactions(id,owner_id,initiator_profile_id,to_account_id,amount,status)
  VALUES ('20000000-0000-4000-a000-000000000041',
    '00000000-0000-4000-a000-000000000041',
    '00000000-0000-4000-a000-000000000041',
    '10000000-0000-4000-a000-000000000041',100,'COMPLETED');
INSERT INTO public.transactions(id,owner_id,initiator_profile_id,from_account_id,amount,status)
  VALUES ('20000000-0000-4000-a000-000000000042',
    '00000000-0000-4000-a000-000000000041',
    '00000000-0000-4000-a000-000000000041',
    '10000000-0000-4000-a000-000000000042',40,'PENDING');
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-a000-000000000041',true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  u uuid := '00000000-0000-4000-a000-000000000041';
  bank_a uuid := '10000000-0000-4000-a000-000000000041';
  bank_b uuid := '10000000-0000-4000-a000-000000000042';
  credit uuid := '10000000-0000-4000-a000-000000000043';
BEGIN
  PERFORM public.post_ledger_transaction(gen_random_uuid(),bank_a,NULL,60,0,
    'Cash expense',now());
  BEGIN
    PERFORM public.post_ledger_transaction(gen_random_uuid(),bank_a,bank_b,39,2,
      'Overdraft transfer',now());
    RAISE EXCEPTION 'Fee allowed an overdraft';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  PERFORM public.post_ledger_transaction(gen_random_uuid(),bank_a,bank_b,39,1,
    'Transfer',now());
  BEGIN
    PERFORM public.post_ledger_transaction(gen_random_uuid(),bank_a,NULL,1,0,
      'Empty bank',now());
    RAISE EXCEPTION 'Empty bank account was overdrawn';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  PERFORM public.post_ledger_transaction(gen_random_uuid(),credit,NULL,100,0,
    'Credit card spend',now());
  BEGIN
    UPDATE public.transactions SET status='COMPLETED'
     WHERE id='20000000-0000-4000-a000-000000000042';
    RAISE EXCEPTION 'Direct pending debit update succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  IF (SELECT balance FROM public.account_balances WHERE id=bank_a) <> 0 OR
     (SELECT balance FROM public.account_balances WHERE id=bank_b) <> 39 OR
     (SELECT balance FROM public.account_balances WHERE id=credit) <> -100 THEN
    RAISE EXCEPTION 'Unexpected balances after accepted and rejected writes';
  END IF;
END $$;
RESET ROLE;
ROLLBACK;
SELECT 'PASS: posting RPC blocks overdrafts, allows credit, and the client cannot complete legacy pending rows directly' AS result;
SELECT plan(1);
SELECT pass('liquid-balance SQL assertions completed without exception');
SELECT * FROM finish();

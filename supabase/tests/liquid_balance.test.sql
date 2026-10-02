-- Run against an isolated database with the production schema and migrations.
SELECT plan(4);
BEGIN;
INSERT INTO auth.users(id,email,raw_user_meta_data)
  VALUES ('00000000-0000-4000-a000-000000000041','balance@example.invalid','{}');
INSERT INTO public.accounts(id,owner_id,name,type) VALUES
  ('10000000-0000-4000-a000-000000000041','00000000-0000-4000-a000-000000000041','Bank A','bank'),
  ('10000000-0000-4000-a000-000000000042','00000000-0000-4000-a000-000000000041','Bank B','bank'),
  ('10000000-0000-4000-a000-000000000043','00000000-0000-4000-a000-000000000041','Credit','credit_card');
INSERT INTO public.accounts(id,owner_id,name,type,opening_balance,opening_date) VALUES
  ('10000000-0000-4000-a000-000000000044','00000000-0000-4000-a000-000000000041','Historical bank','bank',100,'2024-01-01'),
  ('10000000-0000-4000-a000-000000000045','00000000-0000-4000-a000-000000000041','Backdated valid bank','bank',100,'2024-01-01'),
  ('10000000-0000-4000-a000-000000000046','00000000-0000-4000-a000-000000000041','Void history bank','bank',0,'2024-01-01');
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
  void_income_id uuid;
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
  -- A backdated debit must not pass merely because later income leaves a
  -- positive final balance if the account went negative at that point in time.
  PERFORM public.post_ledger_transaction(gen_random_uuid(),
    '10000000-0000-4000-a000-000000000044',NULL,90,0,'Historical expense',
    '2024-01-02 11:00:00+05:30');
  PERFORM public.post_ledger_transaction(gen_random_uuid(),NULL,
    '10000000-0000-4000-a000-000000000044',100,0,'Later income',
    '2024-01-03 12:00:00+05:30');
  BEGIN
    PERFORM public.post_ledger_transaction(gen_random_uuid(),
      '10000000-0000-4000-a000-000000000044',NULL,20,0,'Invalid backdated expense',
      '2024-01-02 12:00:00+05:30');
    RAISE EXCEPTION 'Backdated debit was accepted despite a negative historical balance';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  IF (SELECT balance FROM public.account_balances
       WHERE id='10000000-0000-4000-a000-000000000044') <> 110 THEN
    RAISE EXCEPTION 'Rejected historical debit changed the account balance';
  END IF;

  -- A historical debit that remains funded through every later dated event is
  -- valid, even when it is entered after the later expense already exists.
  PERFORM public.post_ledger_transaction(gen_random_uuid(),NULL,
    '10000000-0000-4000-a000-000000000045',50,0,'Earlier income',
    '2024-01-02 11:00:00+05:30');
  PERFORM public.post_ledger_transaction(gen_random_uuid(),
    '10000000-0000-4000-a000-000000000045',NULL,100,0,'Later expense',
    '2024-01-03 12:00:00+05:30');
  PERFORM public.post_ledger_transaction(gen_random_uuid(),
    '10000000-0000-4000-a000-000000000045',NULL,40,0,'Backdated funded expense',
    '2024-01-02 12:00:00+05:30');
  IF (SELECT balance FROM public.account_balances
       WHERE id='10000000-0000-4000-a000-000000000045') <> 10 THEN
    RAISE EXCEPTION 'Valid backdated expense did not preserve the ledger balance';
  END IF;
  void_income_id := public.post_ledger_transaction(gen_random_uuid(),NULL,
    '10000000-0000-4000-a000-000000000046',100,0,'Income to void',
    '2024-01-02 12:00:00+05:30');
  PERFORM public.post_ledger_transaction(gen_random_uuid(),
    '10000000-0000-4000-a000-000000000046',NULL,90,0,'Later expense',
    '2024-01-03 12:00:00+05:30');
  BEGIN
    PERFORM public.void_ledger_transaction(void_income_id,'synthetic regression');
    SET CONSTRAINTS validate_dated_transaction_balance_at_commit IMMEDIATE;
    RAISE EXCEPTION 'Voiding historical income created an overdraft but was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  IF (SELECT status FROM public.transactions WHERE id=void_income_id) <> 'COMPLETED' THEN
    RAISE EXCEPTION 'Rejected historical void was not rolled back';
  END IF;
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
  BEGIN
    DELETE FROM public.accounts WHERE id=bank_a;
    RAISE EXCEPTION 'Account with ledger history was deleted';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  BEGIN
    DELETE FROM public.accounts WHERE id=bank_b;
    RAISE EXCEPTION 'Account receiving ledger history was deleted';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  IF NOT EXISTS (SELECT 1 FROM public.accounts WHERE id=bank_a)
     OR NOT EXISTS (SELECT 1 FROM public.accounts WHERE id=bank_b)
     OR NOT EXISTS (SELECT 1 FROM public.transactions
                     WHERE from_account_id=bank_a AND to_account_id=bank_b
                       AND description='Transfer') THEN
    RAISE EXCEPTION 'Rejected account deletion changed financial history';
  END IF;
END $$;
SET CONSTRAINTS validate_dated_transaction_balance_at_commit IMMEDIATE;
SELECT pass('dated liquid balances reject historical overdrafts while permitting chronologically funded backdating');
SELECT pass('voids that would overdraw later history are rejected atomically');
SELECT pass('accounts with ledger entries cannot be deleted or lose historical endpoints');
RESET ROLE;
ROLLBACK;
SELECT 'PASS: posting RPC blocks overdrafts, allows credit, and the client cannot complete legacy pending rows directly' AS result;
SELECT pass('liquid-balance SQL assertions completed without exception');
SELECT * FROM finish();

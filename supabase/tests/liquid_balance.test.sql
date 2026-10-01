-- Run against an isolated database with the production schema and migrations.
BEGIN;
INSERT INTO auth.users(id,email,raw_user_meta_data)
  VALUES ('00000000-0000-4000-a000-000000000041','balance@example.invalid','{}');
INSERT INTO public.accounts(id,owner_id,name,type) VALUES
  ('10000000-0000-4000-a000-000000000041','00000000-0000-4000-a000-000000000041','Bank A','bank'),
  ('10000000-0000-4000-a000-000000000042','00000000-0000-4000-a000-000000000041','Bank B','bank'),
  ('10000000-0000-4000-a000-000000000043','00000000-0000-4000-a000-000000000041','Credit','credit_card');
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-a000-000000000041',true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  u uuid := '00000000-0000-4000-a000-000000000041';
  bank_a uuid := '10000000-0000-4000-a000-000000000041';
  bank_b uuid := '10000000-0000-4000-a000-000000000042';
  credit uuid := '10000000-0000-4000-a000-000000000043';
  pending_id uuid;
BEGIN
  INSERT INTO public.transactions(owner_id,initiator_profile_id,to_account_id,amount,status)
    VALUES (u,u,bank_a,100,'COMPLETED');
  INSERT INTO public.transactions(owner_id,initiator_profile_id,from_account_id,amount,status)
    VALUES (u,u,bank_a,60,'COMPLETED');
  BEGIN
    INSERT INTO public.transactions(owner_id,initiator_profile_id,
      from_account_id,to_account_id,amount,fee_amount,status)
      VALUES (u,u,bank_a,bank_b,39,2,'COMPLETED');
    RAISE EXCEPTION 'Fee allowed an overdraft';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  INSERT INTO public.transactions(owner_id,initiator_profile_id,
    from_account_id,to_account_id,amount,fee_amount,status)
    VALUES (u,u,bank_a,bank_b,39,1,'COMPLETED');
  BEGIN
    INSERT INTO public.transactions(owner_id,initiator_profile_id,from_account_id,amount,status)
      VALUES (u,u,bank_a,1,'COMPLETED');
    RAISE EXCEPTION 'Empty bank account was overdrawn';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  INSERT INTO public.transactions(owner_id,initiator_profile_id,from_account_id,amount,status)
    VALUES (u,u,credit,100,'COMPLETED');
  INSERT INTO public.transactions(owner_id,initiator_profile_id,from_account_id,amount,status)
    VALUES (u,u,bank_b,40,'PENDING') RETURNING id INTO pending_id;
  BEGIN
    UPDATE public.transactions SET status='COMPLETED' WHERE id=pending_id;
    RAISE EXCEPTION 'Pending debit completed without sufficient funds';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  IF (SELECT balance FROM public.account_balances WHERE id=bank_a) <> 0 OR
     (SELECT balance FROM public.account_balances WHERE id=bank_b) <> 39 OR
     (SELECT balance FROM public.account_balances WHERE id=credit) <> -100 THEN
    RAISE EXCEPTION 'Unexpected balances after accepted and rejected writes';
  END IF;
END $$;
RESET ROLE;
ROLLBACK;
SELECT 'PASS: bank overdraft and fee blocked; credit allowed; pending completion checked' AS result;

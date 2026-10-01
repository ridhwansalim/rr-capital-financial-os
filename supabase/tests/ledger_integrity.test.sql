BEGIN;
INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
('00000000-0000-4000-a000-000000000011','ledger-a@example.invalid','{"full_name":"Ledger A"}'),
('00000000-0000-4000-a000-000000000012','ledger-b@example.invalid','{"full_name":"Ledger B"}');
INSERT INTO public.accounts(id,owner_id,name,type) VALUES
('10000000-0000-4000-a000-000000000011','00000000-0000-4000-a000-000000000011','A','bank'),
('10000000-0000-4000-a000-000000000012','00000000-0000-4000-a000-000000000012','B','bank');
INSERT INTO public.transactions(owner_id,initiator_profile_id,to_account_id,amount,status)
VALUES ('00000000-0000-4000-a000-000000000011',
        '00000000-0000-4000-a000-000000000011',
        '10000000-0000-4000-a000-000000000011',100,'COMPLETED');
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-a000-000000000011',true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN
  INSERT INTO public.transactions(owner_id,initiator_profile_id,from_account_id,amount,status)
  VALUES ('00000000-0000-4000-a000-000000000011',
    '00000000-0000-4000-a000-000000000011',
    '10000000-0000-4000-a000-000000000012',10,'COMPLETED');
  RAISE EXCEPTION 'Foreign account accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 BEGIN
  INSERT INTO public.transactions(owner_id,initiator_profile_id,from_account_id,amount,status)
  VALUES ('00000000-0000-4000-a000-000000000011',
    '00000000-0000-4000-a000-000000000012',
    '10000000-0000-4000-a000-000000000011',10,'COMPLETED');
  RAISE EXCEPTION 'Forged initiator accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 BEGIN
  INSERT INTO public.transactions(owner_id,initiator_profile_id,from_account_id,amount,status)
  VALUES ('00000000-0000-4000-a000-000000000011',
    '00000000-0000-4000-a000-000000000011',
    '10000000-0000-4000-a000-000000000011',-1,'COMPLETED');
  RAISE EXCEPTION 'Negative amount accepted';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
 INSERT INTO public.transactions(owner_id,initiator_profile_id,from_account_id,amount,status)
 VALUES ('00000000-0000-4000-a000-000000000011',
   '00000000-0000-4000-a000-000000000011',
   '10000000-0000-4000-a000-000000000011',10,'COMPLETED');
 BEGIN
  DELETE FROM public.accounts WHERE id='10000000-0000-4000-a000-000000000011';
  RAISE EXCEPTION 'Account with ledger history was deleted';
 EXCEPTION WHEN foreign_key_violation THEN NULL;
 END;
END $$;
RESET ROLE;
ROLLBACK;
SELECT 'PASS: foreign account, forged initiator, negative amount and history deletion denied' AS result,
 (SELECT count(*) FROM auth.users) AS remaining_users;

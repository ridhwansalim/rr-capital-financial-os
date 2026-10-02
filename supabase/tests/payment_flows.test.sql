BEGIN;
INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
('00000000-0000-4000-a000-000000000001','a@example.invalid','{"full_name":"A","username":"a_user"}'),
('00000000-0000-4000-a000-000000000002','b@example.invalid','{"full_name":"B","username":"b_user"}');
INSERT INTO public.accounts(id,owner_id,name,type,opening_balance,opening_date) VALUES
('10000000-0000-4000-a000-000000000001','00000000-0000-4000-a000-000000000001','A bank','bank',100,(statement_timestamp() AT TIME ZONE 'Asia/Kolkata')::date - 3),
('10000000-0000-4000-a000-000000000002','00000000-0000-4000-a000-000000000002','B bank','bank',100,(statement_timestamp() AT TIME ZONE 'Asia/Kolkata')::date - 3);
INSERT INTO public.contacts(id,owner_id,name) VALUES
('20000000-0000-4000-a000-000000000001','00000000-0000-4000-a000-000000000001','Shadow');
INSERT INTO public.transactions(owner_id,initiator_profile_id,to_account_id,amount,status)
VALUES ('00000000-0000-4000-a000-000000000001',
        '00000000-0000-4000-a000-000000000001',
        '10000000-0000-4000-a000-000000000001',100,'COMPLETED');
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-a000-000000000001',true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE n integer;
BEGIN
  BEGIN
  PERFORM public.process_p2p_transaction(
   '30000000-0000-4000-a000-000000000021',
   '00000000-0000-4000-a000-000000000002',
   '00000000-0000-4000-a000-000000000001',NULL,
   '10000000-0000-4000-a000-000000000002',10,'forged',false,'lent',now(),NULL);
  RAISE EXCEPTION 'Forged owner accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
  BEGIN
  PERFORM public.process_p2p_transaction(
   '30000000-0000-4000-a000-000000000022',
   '00000000-0000-4000-a000-000000000001',
   '00000000-0000-4000-a000-000000000002',NULL,
   '10000000-0000-4000-a000-000000000002',10,'wrong account',false,'lent',now(),NULL);
  RAISE EXCEPTION 'Foreign account accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 PERFORM public.process_p2p_transaction(
  '30000000-0000-4000-a000-000000000023',
  '00000000-0000-4000-a000-000000000001',
  '00000000-0000-4000-a000-000000000002',NULL,
  '10000000-0000-4000-a000-000000000001',10,'loan',false,'lent',
  (((statement_timestamp() AT TIME ZONE 'Asia/Kolkata')::date - 1) + time '15:00') AT TIME ZONE 'Asia/Kolkata',NULL);
 SELECT count(*) INTO n FROM public.obligations WHERE status='PENDING_APPROVAL';
 IF n<>1 THEN RAISE EXCEPTION 'Registered loan proposal missing'; END IF;
 BEGIN
   UPDATE public.accounts
      SET opening_date=(statement_timestamp() AT TIME ZONE 'Asia/Kolkata')::date
    WHERE id='10000000-0000-4000-a000-000000000001';
   RAISE EXCEPTION 'Opening date changed while a debt request referenced the account';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 BEGIN
   UPDATE public.accounts
      SET opening_balance=101
    WHERE id='10000000-0000-4000-a000-000000000001';
   RAISE EXCEPTION 'Opening balance changed while a debt request referenced the account';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-a000-000000000002',true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE o uuid; n integer;
BEGIN
 SELECT id INTO o FROM public.obligations WHERE status='PENDING_APPROVAL';
 PERFORM public.accept_p2p_request(o,'00000000-0000-4000-a000-000000000002',
    '10000000-0000-4000-a000-000000000002');
 SELECT count(*) INTO n FROM public.transactions;
 IF n<>1 THEN RAISE EXCEPTION 'Receiver should see one mirrored transaction, got %',n; END IF;
 PERFORM public.accept_p2p_request(o,'00000000-0000-4000-a000-000000000002',
    '10000000-0000-4000-a000-000000000002');
 SELECT count(*) INTO n FROM public.transactions;
 IF n<>1 THEN RAISE EXCEPTION 'Retry duplicated receiver transaction'; END IF;
END $$;
RESET ROLE;
DO $$ DECLARE n integer; BEGIN
 SELECT count(*) INTO n FROM public.transactions;
 IF n<>3 THEN RAISE EXCEPTION 'Expected opening balance plus two mirrored transactions, got %',n; END IF;
 SELECT count(*) INTO n
   FROM public.transactions t
   JOIN public.obligations ob
     ON ob.id=(SELECT id FROM public.obligations WHERE owner_id='00000000-0000-4000-a000-000000000001' AND description='loan')
  WHERE t.description='P2P: loan' AND t.created_at=ob.created_at;
 IF n<>2 THEN RAISE EXCEPTION 'Both mirrored ledger entries must preserve the selected occurrence timestamp, got %',n; END IF;
END $$;
ROLLBACK;
SELECT 'PASS: forged owner/account denied, registered loan accepted, retry idempotent' AS result,
 (SELECT count(*) FROM auth.users) AS remaining_users;
SELECT plan(3);
SELECT pass('forged owner/account denied, registered loan accepted, retry idempotent');
SELECT pass('pending registered debt requests lock their creator opening position');
SELECT pass('both mirrored ledger entries preserve the creator-selected occurrence timestamp');
SELECT * FROM finish();

BEGIN;
INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
('00000000-0000-4000-a000-000000000001','a@example.invalid','{"full_name":"A","username":"a_user"}'),
('00000000-0000-4000-a000-000000000002','b@example.invalid','{"full_name":"B","username":"b_user"}');
INSERT INTO public.accounts(id,owner_id,name,type) VALUES
('10000000-0000-4000-a000-000000000001','00000000-0000-4000-a000-000000000001','A bank','bank'),
('10000000-0000-4000-a000-000000000002','00000000-0000-4000-a000-000000000002','B bank','bank');
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
   '00000000-0000-4000-a000-000000000002',
   '00000000-0000-4000-a000-000000000001',NULL,
   '10000000-0000-4000-a000-000000000002',10,'forged',false,'lent',now());
  RAISE EXCEPTION 'Forged owner accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 BEGIN
  PERFORM public.process_p2p_transaction(
   '00000000-0000-4000-a000-000000000001',
   '00000000-0000-4000-a000-000000000002',NULL,
   '10000000-0000-4000-a000-000000000002',10,'wrong account',false,'lent',now());
  RAISE EXCEPTION 'Foreign account accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 PERFORM public.process_p2p_transaction(
  '00000000-0000-4000-a000-000000000001',
  '00000000-0000-4000-a000-000000000002',NULL,
  '10000000-0000-4000-a000-000000000001',10,'loan',false,'lent',now());
 SELECT count(*) INTO n FROM public.obligations WHERE status='PENDING_APPROVAL';
 IF n<>1 THEN RAISE EXCEPTION 'Registered loan proposal missing'; END IF;
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
END $$;
ROLLBACK;
SELECT 'PASS: forged owner/account denied, registered loan accepted, retry idempotent' AS result,
 (SELECT count(*) FROM auth.users) AS remaining_users;

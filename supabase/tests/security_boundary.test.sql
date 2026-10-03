BEGIN;
INSERT INTO auth.users(id, email, raw_user_meta_data) VALUES
 ('00000000-0000-4000-a000-000000000001','rr-audit-a@example.invalid','{"full_name":"Audit A","username":"rr_audit_a"}'),
 ('00000000-0000-4000-a000-000000000002','rr-audit-b@example.invalid','{"full_name":"Audit B","username":"rr_audit_b"}');
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-a000-000000000001',true);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-4000-a000-000000000001","role":"authenticated"}',true);
DO $$ DECLARE n integer; BEGIN
 SELECT count(*) INTO n FROM public.profiles;
 IF n <> 1 THEN RAISE EXCEPTION 'Profile isolation failed: % rows',n; END IF;
 SELECT count(*) INTO n FROM public.profiles WHERE id='00000000-0000-4000-a000-000000000002';
 IF n <> 0 THEN RAISE EXCEPTION 'Other profile exposed'; END IF;
 UPDATE public.profiles SET full_name='Must not change' WHERE id='00000000-0000-4000-a000-000000000002';
 GET DIAGNOSTICS n=ROW_COUNT;
 IF n <> 0 THEN RAISE EXCEPTION 'Cross-user profile update allowed'; END IF;
 UPDATE public.profiles SET navbar_layout='{"mobileSelectedUrls":["/ledger"],"desktopSelectedUrls":["/ledger","/calendar"]}'::jsonb
  WHERE id='00000000-0000-4000-a000-000000000001';
 GET DIAGNOSTICS n=ROW_COUNT;
 IF n <> 1 THEN RAISE EXCEPTION 'Owner navbar preference update denied'; END IF;
 BEGIN
  UPDATE public.profiles SET navbar_layout='{"mobileSelectedUrls":["/ledger","/calendar","/chittis"],"desktopSelectedUrls":[]}'::jsonb
   WHERE id='00000000-0000-4000-a000-000000000001';
  RAISE EXCEPTION 'Oversized mobile navbar preference accepted';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
END $$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $$ BEGIN
 BEGIN
  PERFORM 1 FROM public.profiles;
  RAISE EXCEPTION 'Anonymous profile read allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 BEGIN
  PERFORM 1 FROM public.transactions;
  RAISE EXCEPTION 'Anonymous ledger read allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
RESET ROLE;
ROLLBACK;
SELECT 'PASS: owner-only profiles, scoped navbar preference update, cross-user update denied, anonymous reads denied; fixtures rolled back' as result,
 (select count(*) from auth.users) as remaining_users;
SELECT plan(1);
SELECT pass('owner-boundary SQL assertions completed without exception');
SELECT * FROM finish();

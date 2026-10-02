BEGIN;
SELECT plan(1);

INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
('00000000-0000-4000-a000-000000000021','directory-a@example.invalid','{"full_name":"Directory A","username":"a_directory"}'),
('00000000-0000-4000-a000-000000000022','directory-b@example.invalid','{"full_name":"Directory B","username":"b_directory"}'),
('00000000-0000-4000-a000-000000000023','directory-c@example.invalid','{"full_name":"Directory C","username":"c_directory"}');
INSERT INTO public.accounts(id,owner_id,name,type,opening_balance)
VALUES ('10000000-0000-4000-a000-000000000021','00000000-0000-4000-a000-000000000021','Synthetic label account','bank',10);
UPDATE public.profiles SET telegram_chat_id='private'
WHERE id='00000000-0000-4000-a000-000000000022';
INSERT INTO public.transactions(owner_id,from_account_id,tagged_profile_id,amount,description)
VALUES ('00000000-0000-4000-a000-000000000021','10000000-0000-4000-a000-000000000021','00000000-0000-4000-a000-000000000022',1,'synthetic profile-label link');
INSERT INTO public.recurring_emis(id,owner_id,name,amount,start_date,end_date,type,counterparty_profile_id,status)
VALUES ('20000000-0000-4000-a000-000000000021','00000000-0000-4000-a000-000000000021','Synthetic shared EMI',1,current_date,current_date + 1,'lent','00000000-0000-4000-a000-000000000022','ACTIVE');

DO $$ BEGIN
 IF EXISTS (
   SELECT 1 FROM information_schema.columns
   WHERE table_schema='public' AND table_name='profiles' AND column_name='ai_api_key'
 ) THEN RAISE EXCEPTION 'Provider key remains in the client-readable profile table'; END IF;
 IF has_table_privilege('authenticated','public.profile_directory','SELECT')
    OR has_table_privilege('anon','public.profile_directory','SELECT') THEN
   RAISE EXCEPTION 'API role can enumerate profile_directory directly';
 END IF;
 IF NOT has_function_privilege('authenticated','public.profile_labels(uuid[])','EXECUTE')
    OR has_function_privilege('anon','public.profile_labels(uuid[])','EXECUTE') THEN
   RAISE EXCEPTION 'Profile label RPC grants are incorrect';
 END IF;
END $$;

SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-a000-000000000021',true);
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-4000-a000-000000000021","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE n integer; BEGIN
 SELECT count(*) INTO n FROM public.profile_labels(ARRAY[
   '00000000-0000-4000-a000-000000000022'::uuid,
   '00000000-0000-4000-a000-000000000023'::uuid
 ]) WHERE id='00000000-0000-4000-a000-000000000022' AND full_name='Directory B';
 IF n<>1 THEN RAISE EXCEPTION 'Owner cannot resolve label for its own linked transaction'; END IF;
SELECT count(*) INTO n FROM public.profile_labels(ARRAY['00000000-0000-4000-a000-000000000023'::uuid]);
 IF n<>0 THEN RAISE EXCEPTION 'Forged unrelated profile ID returned a label'; END IF;
 SELECT count(*) INTO n FROM public.search_users('Directory B') WHERE id='00000000-0000-4000-a000-000000000022';
 IF n<>1 THEN RAISE EXCEPTION 'Bounded profile search no longer finds a matching user'; END IF;
 SELECT count(*) INTO n FROM public.profiles WHERE id='00000000-0000-4000-a000-000000000022';
 IF n<>0 THEN RAISE EXCEPTION 'Private profile row exposed'; END IF;
 BEGIN
  PERFORM 1 FROM public.profile_directory;
  RAISE EXCEPTION 'Authenticated direct directory read allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
RESET ROLE;

SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-a000-000000000023',true);
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-4000-a000-000000000023","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE n integer; BEGIN
 SELECT count(*) INTO n FROM public.profile_labels(ARRAY['00000000-0000-4000-a000-000000000022'::uuid]);
 IF n<>0 THEN RAISE EXCEPTION 'Unrelated signed-in user resolved a private label'; END IF;
END $$;
RESET ROLE;

SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-a000-000000000022',true);
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-4000-a000-000000000022","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE n integer; BEGIN
 SELECT count(*) INTO n FROM public.profile_labels(ARRAY['00000000-0000-4000-a000-000000000021'::uuid])
 WHERE id='00000000-0000-4000-a000-000000000021' AND username='a_directory';
 IF n<>1 THEN RAISE EXCEPTION 'Shared EMI counterparty cannot resolve the EMI owner label'; END IF;
END $$;
RESET ROLE;

SET LOCAL ROLE anon;
DO $$ BEGIN
 BEGIN
  PERFORM 1 FROM public.profile_directory;
  RAISE EXCEPTION 'Anonymous directory read allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 BEGIN
  PERFORM 1 FROM public.profile_labels(ARRAY['00000000-0000-4000-a000-000000000022'::uuid]);
  RAISE EXCEPTION 'Anonymous label RPC allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
RESET ROLE;

SELECT pass('profile labels require a real linked record; direct enumeration, forged IDs, cross-user and anonymous reads are denied');
SELECT * FROM finish();
ROLLBACK;

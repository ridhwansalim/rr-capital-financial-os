BEGIN;
INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
('00000000-0000-4000-a000-000000000021','directory-a@example.invalid','{"full_name":"Directory A","username":"a_directory"}'),
('00000000-0000-4000-a000-000000000022','directory-b@example.invalid','{"full_name":"Directory B","username":"b_directory"}');
UPDATE public.profiles SET telegram_chat_id='private'
WHERE id='00000000-0000-4000-a000-000000000022';
DO $$ BEGIN
 IF EXISTS (
   SELECT 1 FROM information_schema.columns
   WHERE table_schema='public' AND table_name='profiles' AND column_name='ai_api_key'
 ) THEN RAISE EXCEPTION 'Provider key remains in the client-readable profile table'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-a000-000000000021',true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE n integer; BEGIN
 SELECT count(*) INTO n FROM public.profile_directory
 WHERE id='00000000-0000-4000-a000-000000000022' AND full_name='Directory B';
 IF n<>1 THEN RAISE EXCEPTION 'Other user display name unavailable'; END IF;
 SELECT count(*) INTO n FROM public.profiles
 WHERE id='00000000-0000-4000-a000-000000000022';
 IF n<>0 THEN RAISE EXCEPTION 'Private profile row exposed'; END IF;
END $$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $$ BEGIN
 BEGIN
  PERFORM 1 FROM public.profile_directory;
  RAISE EXCEPTION 'Anonymous directory read allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
RESET ROLE;
ROLLBACK;
SELECT 'PASS: authenticated names visible; private profile and anonymous names hidden' AS result;

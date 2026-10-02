BEGIN;
SELECT plan(7);

INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
('00000000-0000-4000-a000-000000000031','profile-write-a@example.invalid','{}'),
('00000000-0000-4000-a000-000000000032','profile-write-b@example.invalid','{}');

SELECT ok(
  NOT has_table_privilege('authenticated','public.profiles','UPDATE')
  AND NOT has_table_privilege('authenticated','public.profiles','INSERT')
  AND NOT has_table_privilege('authenticated','public.profiles','DELETE')
  AND has_column_privilege('authenticated','public.profiles','full_name','UPDATE')
  AND has_column_privilege('authenticated','public.profiles','registered_devices','UPDATE')
  AND NOT has_column_privilege('authenticated','public.profiles','telegram_chat_id','UPDATE')
  AND NOT has_column_privilege('authenticated','public.profiles','id','UPDATE'),
  'authenticated profile updates are limited to approved preference columns'
);

SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-a000-000000000031',true);
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-4000-a000-000000000031","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;

UPDATE public.profiles
   SET full_name = 'Updated synthetic profile', username = 'profile_write_a'
 WHERE id = '00000000-0000-4000-a000-000000000031';
SELECT is(
  (SELECT full_name FROM public.profiles WHERE id = '00000000-0000-4000-a000-000000000031'),
  'Updated synthetic profile',
  'owner can update approved profile preferences'
);

DO $$ BEGIN
  BEGIN
    UPDATE public.profiles SET telegram_chat_id = '999999999'
     WHERE id = '00000000-0000-4000-a000-000000000031';
    RAISE EXCEPTION 'direct Telegram destination update unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END $$;
SELECT ok(true, 'authenticated owner cannot directly set the Telegram destination');

DO $$ BEGIN
  BEGIN
    INSERT INTO public.profiles(id, full_name, telegram_chat_id)
    VALUES ('00000000-0000-4000-a000-000000000031', 'Forged profile', '999999999');
    RAISE EXCEPTION 'direct profile insert unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END $$;
SELECT ok(true, 'authenticated owner cannot create or forge profile workflow fields');

DO $$ BEGIN
  BEGIN
    DELETE FROM public.profiles WHERE id = '00000000-0000-4000-a000-000000000031';
    RAISE EXCEPTION 'direct profile delete unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END $$;
SELECT ok(true, 'authenticated owner cannot delete the protected profile row');

UPDATE public.profiles
   SET full_name = 'Forged cross-user update'
 WHERE id = '00000000-0000-4000-a000-000000000032';
RESET ROLE;
SELECT is(
  (SELECT full_name FROM public.profiles WHERE id = '00000000-0000-4000-a000-000000000032'),
  NULL,
  'RLS prevents an owner from changing another profile through the allowed columns'
);

SET LOCAL ROLE anon;
SELECT ok(
  NOT has_table_privilege('anon','public.profiles','UPDATE')
  AND NOT has_column_privilege('anon','public.profiles','telegram_chat_id','UPDATE'),
  'anonymous role has no profile update privilege'
);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;

BEGIN;
SELECT plan(4);

INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
('00000000-0000-4000-a000-000000000061','telegram-status-a@example.invalid','{}'),
('00000000-0000-4000-a000-000000000062','telegram-status-b@example.invalid','{}');
UPDATE public.profiles SET telegram_chat_id='123456789'
 WHERE id='00000000-0000-4000-a000-000000000061';

SELECT ok(
  NOT has_table_privilege('authenticated','public.profiles','SELECT')
  AND NOT has_table_privilege('anon','public.profiles','SELECT')
  AND has_column_privilege('authenticated','public.profiles','full_name','SELECT')
  AND has_column_privilege('authenticated','public.profiles','username','SELECT')
  AND has_column_privilege('authenticated','public.profiles','registered_devices','SELECT')
  AND NOT has_column_privilege('authenticated','public.profiles','telegram_chat_id','SELECT')
  AND NOT has_column_privilege('anon','public.profiles','telegram_chat_id','SELECT')
  AND NOT has_column_privilege('authenticated','public.profiles','telegram_chat_id','UPDATE'),
  'Telegram destination is not selectable or writable by API roles'
);
SELECT ok(
  has_function_privilege('authenticated','public.get_telegram_link_status()','EXECUTE')
  AND NOT has_function_privilege('anon','public.get_telegram_link_status()','EXECUTE')
  AND NOT EXISTS (
    SELECT 1 FROM pg_proc p
    CROSS JOIN LATERAL aclexplode(p.proacl) a
    WHERE p.oid='public.get_telegram_link_status()'::regprocedure
      AND a.grantee=0 AND a.privilege_type='EXECUTE'
  ),
  'only authenticated sessions can query the safe link-status function'
);

SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-a000-000000000061',true);
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-4000-a000-000000000061","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT ok(public.get_telegram_link_status(), 'owner receives linked=true without receiving the chat ID');
DO $$ BEGIN
  BEGIN
    PERFORM telegram_chat_id FROM public.profiles
     WHERE id='00000000-0000-4000-a000-000000000061';
    RAISE EXCEPTION 'authenticated profile read unexpectedly exposed the Telegram destination';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-a000-000000000062',true);
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-4000-a000-000000000062","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT ok(NOT public.get_telegram_link_status(), 'unlinked owner receives linked=false');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;

-- Run after the Telegram link migration in an isolated Supabase-schema DB.
BEGIN;
INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
  ('00000000-0000-4000-a000-000000000031','telegram-a@example.invalid','{}');
CREATE TEMP TABLE link_test(token text);
GRANT SELECT, INSERT ON link_test TO authenticated, service_role;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-a000-000000000031',true);
SET LOCAL ROLE authenticated;
INSERT INTO link_test SELECT public.issue_telegram_link_token();
INSERT INTO link_test SELECT public.issue_telegram_link_token();
DO $$ BEGIN
  IF (SELECT count(*) FROM link_test WHERE token ~ '^[0-9a-f]{48}$') <> 2 THEN
    RAISE EXCEPTION 'Tokens are not Telegram deep-link compatible';
  END IF;
  BEGIN
    PERFORM public.consume_telegram_link_token((SELECT token FROM link_test LIMIT 1),'123456');
    RAISE EXCEPTION 'Browser was allowed to consume Telegram token';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM 1 FROM private.telegram_link_challenges;
    RAISE EXCEPTION 'Browser could read private link tokens';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $$ BEGIN
  BEGIN
    PERFORM public.issue_telegram_link_token();
    RAISE EXCEPTION 'Anonymous caller could issue a link token';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;
SET LOCAL ROLE service_role;
DO $$
DECLARE old_token text; new_token text;
BEGIN
  SELECT token INTO old_token FROM link_test ORDER BY ctid LIMIT 1;
  SELECT token INTO new_token FROM link_test ORDER BY ctid DESC LIMIT 1;
  IF public.consume_telegram_link_token(old_token,'123456') THEN
    RAISE EXCEPTION 'Previous token was not invalidated';
  END IF;
  IF public.consume_telegram_link_token('not-a-token','123456') THEN
    RAISE EXCEPTION 'Invalid token was accepted';
  END IF;
  IF NOT public.consume_telegram_link_token(new_token,'123456') THEN
    RAISE EXCEPTION 'Valid token was rejected';
  END IF;
  IF public.consume_telegram_link_token(new_token,'987654') THEN
    RAISE EXCEPTION 'Token was consumed twice';
  END IF;
END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
INSERT INTO link_test SELECT public.issue_telegram_link_token();
RESET ROLE;
UPDATE private.telegram_link_challenges SET expires_at=now() - interval '1 minute'
  WHERE owner_id='00000000-0000-4000-a000-000000000031';
SET LOCAL ROLE service_role;
DO $$ BEGIN
  IF public.consume_telegram_link_token(
       (SELECT token FROM link_test ORDER BY ctid DESC LIMIT 1),'999999') THEN
    RAISE EXCEPTION 'Expired token was accepted';
  END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
  IF (SELECT telegram_chat_id FROM public.profiles
      WHERE id='00000000-0000-4000-a000-000000000031') <> '123456' THEN
    RAISE EXCEPTION 'Telegram chat was not linked to the token owner';
  END IF;
END $$;
ROLLBACK;
SELECT 'PASS: private, authenticated, expiring, single-use Telegram link tokens' AS result;

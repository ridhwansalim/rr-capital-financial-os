-- Telegram linking needs proof of both an authenticated app session and
-- possession of the Telegram private chat. A public profile UUID proves neither.
CREATE TABLE private.telegram_link_challenges (
  token_hash bytea PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX telegram_link_challenges_one_per_owner
  ON private.telegram_link_challenges(owner_id);
REVOKE ALL ON private.telegram_link_challenges FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.issue_telegram_link_token()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  v_owner uuid := private.require_user();
  v_token text := encode(extensions.gen_random_bytes(24), 'hex');
BEGIN
  PERFORM 1 FROM auth.users WHERE id = v_owner FOR UPDATE;
  DELETE FROM private.telegram_link_challenges
   WHERE owner_id = v_owner OR expires_at <= now();
  INSERT INTO private.telegram_link_challenges(token_hash, owner_id, expires_at)
    VALUES (extensions.digest(v_token, 'sha256'), v_owner, now() + interval '10 minutes');
  RETURN v_token;
END $$;
REVOKE ALL ON FUNCTION private.issue_telegram_link_token() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.issue_telegram_link_token() TO authenticated;

CREATE OR REPLACE FUNCTION public.issue_telegram_link_token()
RETURNS text LANGUAGE sql SECURITY INVOKER
SET search_path = public, pg_temp AS $$
  SELECT private.issue_telegram_link_token();
$$;
REVOKE ALL ON FUNCTION public.issue_telegram_link_token() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_telegram_link_token() TO authenticated;

CREATE OR REPLACE FUNCTION private.consume_telegram_link_token(
  p_token text, p_chat_id text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE v_owner uuid;
BEGIN
  IF p_token IS NULL OR p_token !~ '^[0-9a-f]{48}$'
     OR p_chat_id IS NULL OR p_chat_id !~ '^[1-9][0-9]{0,19}$' THEN
    RETURN false;
  END IF;
  DELETE FROM private.telegram_link_challenges
   WHERE token_hash = extensions.digest(p_token, 'sha256')
     AND expires_at > now()
   RETURNING owner_id INTO v_owner;
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE public.profiles SET telegram_chat_id = p_chat_id WHERE id = v_owner;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile unavailable' USING ERRCODE = '23503';
  END IF;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION private.consume_telegram_link_token(text,text)
  FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA private TO service_role;
GRANT EXECUTE ON FUNCTION private.consume_telegram_link_token(text,text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.consume_telegram_link_token(
  p_token text, p_chat_id text
) RETURNS boolean LANGUAGE sql SECURITY INVOKER
SET search_path = public, pg_temp AS $$
  SELECT private.consume_telegram_link_token(p_token, p_chat_id);
$$;
REVOKE ALL ON FUNCTION public.consume_telegram_link_token(text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_telegram_link_token(text,text)
  TO service_role;
NOTIFY pgrst, 'reload schema';

-- Keep each user's Gemini key encrypted in Supabase Vault and out of the
-- client-readable profiles table. Existing values are migrated before removal.
CREATE TABLE IF NOT EXISTS private.user_gemini_key_refs (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  vault_secret_id uuid NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);

ALTER TABLE private.user_gemini_key_refs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.user_gemini_key_refs FROM PUBLIC, anon, authenticated, service_role;

DO $$
DECLARE
  profile_row record;
  created_secret_id uuid;
BEGIN
  FOR profile_row IN
    SELECT id, ai_api_key
    FROM public.profiles
    WHERE ai_api_key IS NOT NULL AND pg_catalog.btrim(ai_api_key) <> ''
  LOOP
    created_secret_id := vault.create_secret(
      profile_row.ai_api_key,
      'rr-capital-gemini-' || profile_row.id::text,
      'Per-user Gemini API key for RR Capital receipt scanning'
    );
    INSERT INTO private.user_gemini_key_refs (user_id, vault_secret_id)
    VALUES (profile_row.id, created_secret_id)
    ON CONFLICT (user_id) DO UPDATE
      SET vault_secret_id = EXCLUDED.vault_secret_id,
          updated_at = pg_catalog.now();
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_user_gemini_key(p_user_id uuid, p_secret text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  existing_secret_id uuid;
  new_secret_id uuid;
BEGIN
  IF pg_catalog.current_setting('request.jwt.claim.role', true) IS DISTINCT FROM 'service_role'
     OR p_user_id IS NULL OR p_secret IS NULL
     OR pg_catalog.length(p_secret) < 20 OR pg_catalog.length(p_secret) > 256 THEN
    RETURN false;
  END IF;

  SELECT vault_secret_id INTO existing_secret_id
  FROM private.user_gemini_key_refs WHERE user_id = p_user_id FOR UPDATE;

  IF existing_secret_id IS NULL THEN
    new_secret_id := vault.create_secret(
      p_secret,
      'rr-capital-gemini-' || p_user_id::text,
      'Per-user Gemini API key for RR Capital receipt scanning'
    );
    INSERT INTO private.user_gemini_key_refs (user_id, vault_secret_id)
    VALUES (p_user_id, new_secret_id);
  ELSE
    PERFORM vault.update_secret(existing_secret_id, p_secret);
    UPDATE private.user_gemini_key_refs
      SET updated_at = pg_catalog.now() WHERE user_id = p_user_id;
  END IF;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_user_gemini_key(p_user_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE result text;
BEGIN
  IF pg_catalog.current_setting('request.jwt.claim.role', true) IS DISTINCT FROM 'service_role'
     OR p_user_id IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT secret.decrypted_secret INTO result
  FROM private.user_gemini_key_refs AS key_ref
  JOIN vault.decrypted_secrets AS secret ON secret.id = key_ref.vault_secret_id
  WHERE key_ref.user_id = p_user_id;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.has_user_gemini_key(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF pg_catalog.current_setting('request.jwt.claim.role', true) IS DISTINCT FROM 'service_role'
     OR p_user_id IS NULL THEN
    RETURN false;
  END IF;
  RETURN EXISTS (SELECT 1 FROM private.user_gemini_key_refs WHERE user_id = p_user_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_user_gemini_key(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE existing_secret_id uuid;
BEGIN
  IF pg_catalog.current_setting('request.jwt.claim.role', true) IS DISTINCT FROM 'service_role'
     OR p_user_id IS NULL THEN
    RETURN false;
  END IF;
  SELECT vault_secret_id INTO existing_secret_id
  FROM private.user_gemini_key_refs WHERE user_id = p_user_id FOR UPDATE;
  IF existing_secret_id IS NULL THEN RETURN true; END IF;
  DELETE FROM vault.secrets WHERE id = existing_secret_id;
  DELETE FROM private.user_gemini_key_refs WHERE user_id = p_user_id;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.save_user_gemini_key(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_user_gemini_key(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.has_user_gemini_key(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.delete_user_gemini_key(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_user_gemini_key(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_user_gemini_key(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.has_user_gemini_key(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_user_gemini_key(uuid) TO service_role;

ALTER TABLE public.profiles DROP COLUMN IF EXISTS ai_api_key;
NOTIFY pgrst, 'reload schema';

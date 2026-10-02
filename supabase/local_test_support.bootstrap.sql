-- ONLY for an isolated PostgreSQL rebuild test. A real Supabase project
-- supplies auth, extension schemas, roles, and their functions itself.
CREATE SCHEMA auth;
CREATE SCHEMA extensions;
CREATE SCHEMA vault;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role;
CREATE TABLE auth.users (
  id uuid PRIMARY KEY,
  email text,
  raw_user_meta_data jsonb DEFAULT '{}'::jsonb
);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
GRANT USAGE ON SCHEMA auth TO authenticated, anon;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon;

-- Empty Vault-compatible test stub. It preserves the columns and signatures
-- used by migrations without storing real application secrets or claiming to
-- emulate Supabase Vault encryption.
CREATE TABLE vault.secrets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE,
  description text,
  secret text,
  decrypted_secret text
);
CREATE VIEW vault.decrypted_secrets AS
  SELECT id, name, decrypted_secret FROM vault.secrets;
CREATE FUNCTION vault.create_secret(p_secret text, p_name text, p_description text)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO vault.secrets(name, description, secret, decrypted_secret)
  VALUES (p_name, p_description, p_secret, p_secret)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
CREATE FUNCTION vault.update_secret(p_id uuid, p_secret text)
RETURNS uuid LANGUAGE plpgsql AS $$
BEGIN
  UPDATE vault.secrets SET secret=p_secret, decrypted_secret=p_secret WHERE id=p_id;
  RETURN p_id;
END;
$$;

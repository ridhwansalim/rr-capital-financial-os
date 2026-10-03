-- ONLY for an isolated PostgreSQL rebuild test. A real Supabase project
-- supplies auth, extension schemas, roles, and their functions itself.
CREATE SCHEMA auth;
CREATE SCHEMA extensions;
CREATE SCHEMA vault;
CREATE PUBLICATION supabase_realtime;
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

-- The local replay has no Vault extension or secrets. This empty compatibility
-- view lets migrations safely query configured webhook names without exposing
-- credentials or attempting to deliver notifications in the scratch database.
CREATE VIEW vault.decrypted_secrets AS
SELECT NULL::text AS name, NULL::text AS decrypted_secret
WHERE false;

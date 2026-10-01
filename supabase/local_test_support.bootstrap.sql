-- ONLY for an isolated PostgreSQL rebuild test. A real Supabase project
-- supplies auth, extension schemas, roles, and their functions itself.
CREATE SCHEMA auth;
CREATE SCHEMA extensions;
CREATE SCHEMA net;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
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

-- Model pg_net's default PUBLIC exposure so the hardening migration and its
-- privilege regression test run on plain PostgreSQL without a pg_net binary.
CREATE FUNCTION net.http_post(url text, body jsonb DEFAULT '{}'::jsonb,
  params jsonb DEFAULT '{}'::jsonb, headers jsonb DEFAULT '{}'::jsonb,
  timeout_milliseconds integer DEFAULT 2000)
RETURNS bigint LANGUAGE sql AS $$ SELECT 1::bigint $$;
GRANT USAGE ON SCHEMA net TO PUBLIC;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA net TO PUBLIC;

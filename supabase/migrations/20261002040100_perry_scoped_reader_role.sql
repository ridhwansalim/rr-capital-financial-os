-- A narrowly scoped database login for the server-side Perry broker.
-- Its password is provisioned out of band and exists only in the Edge secret
-- PERRY_DATABASE_URL. The role is not granted to PostgREST's authenticator.
DO $$ BEGIN
  CREATE ROLE perry_reader LOGIN NOINHERIT NOBYPASSRLS PASSWORD NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
ALTER ROLE perry_reader LOGIN NOINHERIT NOBYPASSRLS PASSWORD NULL;
REVOKE perry_reader FROM authenticator;

-- The broker calls one RPC in the private schema. Do not grant public-schema
-- USAGE: it contains extension functions that retain PUBLIC EXECUTE grants.
GRANT USAGE ON SCHEMA private TO perry_reader;
REVOKE CREATE ON SCHEMA public, private FROM perry_reader;
REVOKE ALL ON ALL TABLES IN SCHEMA public, private FROM perry_reader;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public, private FROM perry_reader;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public, private FROM perry_reader;

-- New private functions must not become callable by the database login via
-- PostgreSQL's default PUBLIC EXECUTE privilege. Public is intentionally
-- inaccessible to perry_reader even where extension functions retain PUBLIC.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA private
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- The public schema's default PUBLIC USAGE would otherwise be impossible to
-- revoke for one login. Restrict namespace access to the Supabase API roles;
-- Perry receives no public-schema path even to extension functions.
REVOKE USAGE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
-- A role can retain a direct USAGE grant even after PUBLIC access is revoked.
-- Perry must have no namespace path into exposed objects or extension RPCs.
REVOKE USAGE, CREATE ON SCHEMA public FROM perry_reader;

-- This singleton is provisioned out of band for the verified owner UUID.
-- The application and broker roles cannot read or change the row directly.
CREATE TABLE IF NOT EXISTS private.perry_owner_config (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  configured_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);
ALTER TABLE private.perry_owner_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.perry_owner_config
  FROM PUBLIC, anon, authenticated, service_role, perry_reader;

CREATE OR REPLACE FUNCTION private.assert_perry_owner(p_subject uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, pg_temp
AS $$
BEGIN
  IF (session_user = 'perry_reader'
      OR pg_catalog.current_setting('role', true) = 'perry_reader')
     AND NOT EXISTS (
       SELECT 1 FROM private.perry_owner_config
        WHERE singleton AND owner_id = p_subject
     ) THEN
    RAISE EXCEPTION 'Perry identity is not the configured owner'
      USING ERRCODE = '42501';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION private.assert_perry_owner(uuid)
  FROM PUBLIC, anon, authenticated, service_role, perry_reader;

-- Replace the existing summary implementation with the same allowlisted
-- aggregation plus a database-enforced owner pin for the broker role.
CREATE OR REPLACE FUNCTION private.personal_summary()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, private, pg_temp
AS $$
DECLARE
  v_user uuid;
  v_summary jsonb;
BEGIN
  IF (session_user = 'perry_reader'
      OR pg_catalog.current_setting('role', true) = 'perry_reader') THEN
    v_user := auth.uid();
    IF v_user IS NULL OR NOT EXISTS (
      SELECT 1 FROM private.perry_owner_config
       WHERE singleton AND owner_id = v_user
    ) THEN
      RAISE EXCEPTION 'Perry identity is not authorized' USING ERRCODE = '42501';
    END IF;
  ELSE
    v_user := private.require_user();
  END IF;
  PERFORM private.assert_perry_owner(v_user);

  WITH personal_transactions AS MATERIALIZED (
    SELECT t.id, t.from_account_id, t.to_account_id, t.amount,
           COALESCE(t.fee_amount, 0) AS fee_amount, t.created_at
      FROM public.transactions AS t
     WHERE t.owner_id = v_user
       AND t.initiator_profile_id = v_user
       AND t.status = 'COMPLETED'
       AND t.tagged_profile_id IS NULL
       AND t.contact_id IS NULL
       AND (t.from_account_id IS NULL OR EXISTS (
         SELECT 1 FROM public.accounts AS a
          WHERE a.id = t.from_account_id AND a.owner_id = v_user
       ))
       AND (t.to_account_id IS NULL OR EXISTS (
         SELECT 1 FROM public.accounts AS a
          WHERE a.id = t.to_account_id AND a.owner_id = v_user
       ))
       AND NOT EXISTS (
         SELECT 1 FROM public.obligations AS o
          WHERE o.related_transaction_id = t.id
       )
       AND NOT EXISTS (
         SELECT 1 FROM public.obligation_payments AS p
          WHERE p.transaction_id = t.id
       )
       AND NOT EXISTS (
         SELECT 1 FROM private.transaction_corrections AS c
          WHERE c.original_transaction_id = t.id
             OR c.replacement_transaction_id = t.id
       )
       AND NOT EXISTS (
         SELECT 1 FROM private.chitti_action_requests AS c
          WHERE c.transaction_id = t.id
       )
       AND NOT EXISTS (
         SELECT 1 FROM private.emi_bank_action_requests AS e
          WHERE e.transaction_id = t.id
       )
  )
  SELECT jsonb_build_object(
    'as_of', statement_timestamp(),
    'accounts', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'name', a.name,
        'type', a.type,
        'personal_balance', COALESCE((
          SELECT sum(
            CASE WHEN t.to_account_id = a.id THEN t.amount ELSE 0 END
            - CASE WHEN t.from_account_id = a.id THEN t.amount + t.fee_amount ELSE 0 END
          )
          FROM personal_transactions AS t
          WHERE t.to_account_id = a.id OR t.from_account_id = a.id
        ), 0)
      ) ORDER BY a.created_at, a.id)
      FROM public.accounts AS a
      WHERE a.owner_id = v_user
    ), '[]'::jsonb),
    'ledger', (
      SELECT jsonb_build_object(
        'completed_personal_transaction_count', count(*),
        'completed_personal_income_total', COALESCE(sum(
          CASE WHEN t.to_account_id IS NOT NULL AND t.from_account_id IS NULL
               THEN t.amount ELSE 0 END
        ), 0),
        'completed_personal_expense_total', COALESCE(sum(
          CASE WHEN t.from_account_id IS NOT NULL AND t.to_account_id IS NULL
               THEN t.amount + t.fee_amount ELSE 0 END
        ), 0),
        'completed_personal_transfer_total', COALESCE(sum(
          CASE WHEN t.from_account_id IS NOT NULL AND t.to_account_id IS NOT NULL
               THEN t.amount ELSE 0 END
        ), 0),
        'first_completed_at', min(t.created_at),
        'last_completed_at', max(t.created_at)
      ) FROM personal_transactions AS t
    )
  ) INTO v_summary;

  RETURN v_summary;
END;
$$;
REVOKE ALL ON FUNCTION private.personal_summary()
  FROM PUBLIC, anon, authenticated, service_role, perry_reader;
GRANT EXECUTE ON FUNCTION private.personal_summary()
  TO authenticated, perry_reader;

-- Future functions do not become part of the Perry API by default.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM perry_reader;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA private
  REVOKE EXECUTE ON FUNCTIONS FROM perry_reader;

NOTIFY pgrst, 'reload schema';

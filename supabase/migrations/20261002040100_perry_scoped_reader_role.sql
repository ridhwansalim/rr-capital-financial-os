-- Retain a disabled compatibility role only for reversible migration history.
-- Perry uses an authenticated user-token RPC and never connects to Postgres.
DO $$ BEGIN
  CREATE ROLE perry_reader NOLOGIN NOINHERIT NOBYPASSRLS PASSWORD NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
ALTER ROLE perry_reader NOLOGIN NOINHERIT NOBYPASSRLS PASSWORD NULL;
REVOKE perry_reader FROM authenticator;

-- No direct schema access is granted to the retired database role.
REVOKE ALL ON SCHEMA public, private FROM perry_reader;
REVOKE ALL ON ALL TABLES IN SCHEMA public, private FROM perry_reader;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public, private FROM perry_reader;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public, private FROM perry_reader;

-- New private functions must not become callable through PostgreSQL's default
-- PUBLIC EXECUTE privilege.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA private
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

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
  IF NOT EXISTS (
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
  v_user := private.require_user();
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
  TO authenticated;

-- The retired role remains unusable even if a later migration grants an
-- object accidentally; default privileges prevent future function drift.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM perry_reader;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA private
  REVOKE EXECUTE ON FUNCTIONS FROM perry_reader;

NOTIFY pgrst, 'reload schema';

-- Fixed read-only summary boundary for authenticated users and the Perry
-- database login. For Perry, auth.uid() is set only by the Edge Function after
-- remote Supabase Auth verification, then checked against a private owner pin.

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

REVOKE ALL ON FUNCTION private.personal_summary() FROM PUBLIC, anon, authenticated, service_role, perry_reader;
GRANT EXECUTE ON FUNCTION private.personal_summary() TO authenticated, perry_reader;

CREATE OR REPLACE FUNCTION public.personal_summary()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public, private, pg_temp
AS $$ SELECT private.personal_summary(); $$;
REVOKE ALL ON FUNCTION public.personal_summary() FROM PUBLIC, anon, service_role, perry_reader;
GRANT EXECUTE ON FUNCTION public.personal_summary() TO authenticated;

NOTIFY pgrst, 'reload schema';

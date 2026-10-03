-- Credit lines have a maximum outstanding balance at every point in their
-- dated ledger, not only at the current net balance. Backdated purchases must
-- not be masked by later repayments or credits.
CREATE OR REPLACE FUNCTION private.assert_credit_line_timeline(
  p_owner_id uuid,
  p_account_id uuid,
  p_excluded_transaction_id uuid DEFAULT NULL,
  p_candidate_status text DEFAULT NULL,
  p_candidate_from uuid DEFAULT NULL,
  p_candidate_to uuid DEFAULT NULL,
  p_candidate_amount numeric DEFAULT NULL,
  p_candidate_fee numeric DEFAULT NULL,
  p_candidate_created_at timestamptz DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, pg_temp
AS $$
DECLARE
  v_type text;
  v_credit_limit numeric;
  v_opening_balance numeric;
  v_opening_date date;
  v_minimum numeric;
BEGIN
  SELECT type, credit_limit, opening_balance, opening_date
    INTO v_type, v_credit_limit, v_opening_balance, v_opening_date
    FROM public.accounts
   WHERE id = p_account_id AND owner_id = p_owner_id
   FOR UPDATE;
  IF NOT FOUND OR v_type NOT IN ('credit', 'credit_card', 'pay_later') THEN
    RETURN;
  END IF;

  WITH events AS (
    SELECT t.created_at AS occurred_at,
           sum(CASE WHEN t.to_account_id = p_account_id THEN t.amount ELSE 0 END
             - CASE WHEN t.from_account_id = p_account_id
                    THEN t.amount + COALESCE(t.fee_amount, 0) ELSE 0 END) AS delta
      FROM public.transactions AS t
     WHERE t.status = 'COMPLETED'
       AND t.owner_id = p_owner_id
       AND t.id IS DISTINCT FROM p_excluded_transaction_id
       AND (t.from_account_id = p_account_id OR t.to_account_id = p_account_id)
       AND (t.created_at AT TIME ZONE 'Asia/Kolkata')::date >= v_opening_date
     GROUP BY t.created_at
    UNION ALL
    SELECT p_candidate_created_at,
           sum(CASE WHEN p_candidate_to = p_account_id THEN p_candidate_amount ELSE 0 END
             - CASE WHEN p_candidate_from = p_account_id
                    THEN p_candidate_amount + COALESCE(p_candidate_fee, 0) ELSE 0 END)
      WHERE p_candidate_status = 'COMPLETED'
        AND (p_candidate_from = p_account_id OR p_candidate_to = p_account_id)
        AND (p_candidate_created_at AT TIME ZONE 'Asia/Kolkata')::date >= v_opening_date
  ), moments AS (
    SELECT occurred_at, sum(delta) AS delta
      FROM events
     GROUP BY occurred_at
  ), running AS (
    SELECT v_opening_balance
             + sum(delta) OVER (ORDER BY occurred_at ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS balance
      FROM moments
  )
  SELECT min(balance) INTO v_minimum FROM running;

  IF COALESCE(v_minimum, v_opening_balance) < -v_credit_limit THEN
    RAISE EXCEPTION 'Transaction would exceed the approved credit line at that date'
      USING ERRCODE = '22023';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION private.assert_credit_line_timeline(
  uuid,uuid,uuid,text,uuid,uuid,numeric,numeric,timestamptz
) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.validate_credit_line_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, pg_temp
AS $$
DECLARE
  v_account record;
  v_excluded_id uuid;
  v_account_ids uuid[];
  v_owner_id uuid;
  v_status text;
  v_from uuid;
  v_to uuid;
  v_amount numeric;
  v_fee numeric;
  v_created_at timestamptz;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_account_ids := ARRAY[NEW.from_account_id, NEW.to_account_id]::uuid[];
    v_owner_id := NEW.owner_id;
  ELSIF TG_OP = 'UPDATE' THEN
    v_excluded_id := OLD.id;
    v_account_ids := ARRAY[OLD.from_account_id, OLD.to_account_id,
                           NEW.from_account_id, NEW.to_account_id]::uuid[];
    v_owner_id := NEW.owner_id;
  ELSE
    v_excluded_id := OLD.id;
    v_account_ids := ARRAY[OLD.from_account_id, OLD.to_account_id]::uuid[];
    v_owner_id := OLD.owner_id;
  END IF;

  IF TG_OP <> 'DELETE' THEN
    v_status := NEW.status;
    v_from := NEW.from_account_id;
    v_to := NEW.to_account_id;
    v_amount := NEW.amount;
    v_fee := NEW.fee_amount;
    v_created_at := NEW.created_at;
  END IF;

  -- Preserve the existing stable account lock order before validating both
  -- sides of a transfer or a paired ledger edit.
  FOR v_account IN
    SELECT id, owner_id, type
      FROM public.accounts
     WHERE id = ANY (v_account_ids)
       AND owner_id = v_owner_id
       AND type IN ('credit', 'credit_card', 'pay_later')
     ORDER BY id
     FOR UPDATE
  LOOP
    PERFORM private.assert_credit_line_timeline(
      v_account.owner_id, v_account.id, v_excluded_id,
      v_status, v_from, v_to, v_amount, v_fee, v_created_at
    );
  END LOOP;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.validate_credit_line_limit()
  FROM PUBLIC, anon, authenticated, service_role;
NOTIFY pgrst, 'reload schema';

-- Enforce the liquid-account invariant against the dated ledger, not merely
-- against its final net sum. This matters when a user enters history out of
-- chronological order or edits/voids a transaction after later entries exist.

CREATE OR REPLACE FUNCTION private.assert_liquid_account_timeline(
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
  v_opening_balance numeric;
  v_opening_date date;
  v_minimum numeric;
BEGIN
  SELECT type, opening_balance, opening_date
    INTO v_type, v_opening_balance, v_opening_date
    FROM public.accounts
   WHERE id = p_account_id AND owner_id = p_owner_id
   FOR UPDATE;
  IF NOT FOUND OR v_type IN ('credit', 'credit_card') THEN
    RETURN;
  END IF;

  WITH events AS (
    SELECT t.created_at AS occurred_at,
           sum(CASE WHEN t.to_account_id = p_account_id THEN t.amount ELSE 0 END
             - CASE WHEN t.from_account_id = p_account_id
                    THEN t.amount + COALESCE(t.fee_amount, 0) ELSE 0 END) AS delta
      FROM public.transactions AS t
     WHERE t.owner_id = p_owner_id
       AND t.status = 'COMPLETED'
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

  IF COALESCE(v_minimum, v_opening_balance) < 0 THEN
    RAISE EXCEPTION 'Transaction would make liquid account history negative'
      USING ERRCODE = '22023';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION private.assert_liquid_account_timeline(
  uuid,uuid,uuid,text,uuid,uuid,numeric,numeric,timestamptz
) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.validate_dated_transaction_balance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, pg_temp
AS $$
DECLARE
  v_account record;
  v_ids uuid[];
  v_owners uuid[];
  v_candidate_id uuid;
  v_candidate_status text;
  v_candidate_owner uuid;
  v_candidate_from uuid;
  v_candidate_to uuid;
  v_candidate_amount numeric;
  v_candidate_fee numeric;
  v_candidate_created_at timestamptz;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_ids := ARRAY[OLD.from_account_id, OLD.to_account_id]::uuid[];
    v_owners := ARRAY[OLD.owner_id]::uuid[];
    v_candidate_id := OLD.id;
    v_candidate_status := NULL;
  ELSE
    IF NEW.from_account_id IS NOT NULL THEN
      PERFORM private.require_account(NEW.owner_id, NEW.from_account_id);
    END IF;
    IF NEW.to_account_id IS NOT NULL THEN
      PERFORM private.require_account(NEW.owner_id, NEW.to_account_id);
    END IF;

    IF NEW.created_at IS NULL THEN
      RAISE EXCEPTION 'Transaction date is required' USING ERRCODE = '22023';
    END IF;
    IF NEW.from_account_id IS NOT NULL OR NEW.to_account_id IS NOT NULL THEN
      IF (NEW.from_account_id IS NOT NULL AND
          (NEW.created_at AT TIME ZONE 'Asia/Kolkata')::date <
          (SELECT opening_date FROM public.accounts WHERE id = NEW.from_account_id AND owner_id = NEW.owner_id))
         OR (NEW.to_account_id IS NOT NULL AND
          (NEW.created_at AT TIME ZONE 'Asia/Kolkata')::date <
          (SELECT opening_date FROM public.accounts WHERE id = NEW.to_account_id AND owner_id = NEW.owner_id)) THEN
        RAISE EXCEPTION 'Transaction date precedes account opening date' USING ERRCODE = '22023';
      END IF;
    END IF;

    IF TG_OP = 'INSERT' THEN
      v_ids := ARRAY[NEW.from_account_id, NEW.to_account_id]::uuid[];
      v_owners := ARRAY[NEW.owner_id]::uuid[];
      v_candidate_id := NEW.id;
    ELSE
      v_ids := ARRAY[OLD.from_account_id, OLD.to_account_id,
                     NEW.from_account_id, NEW.to_account_id]::uuid[];
      v_owners := ARRAY[OLD.owner_id, NEW.owner_id]::uuid[];
      v_candidate_id := OLD.id;
    END IF;
    v_candidate_status := NEW.status;
    v_candidate_owner := NEW.owner_id;
    v_candidate_from := NEW.from_account_id;
    v_candidate_to := NEW.to_account_id;
    v_candidate_amount := NEW.amount;
    v_candidate_fee := NEW.fee_amount;
    v_candidate_created_at := NEW.created_at;
  END IF;

  -- One stable lock order serializes all ledger edits touching these accounts.
  FOR v_account IN
    SELECT a.id, a.owner_id, a.opening_date
      FROM public.accounts AS a
     WHERE a.id = ANY(v_ids) AND a.owner_id = ANY(v_owners)
     ORDER BY a.id
     FOR UPDATE
  LOOP
    IF TG_OP <> 'DELETE' AND
       (v_account.id = v_candidate_from OR v_account.id = v_candidate_to) AND
       (v_candidate_created_at AT TIME ZONE 'Asia/Kolkata')::date < v_account.opening_date THEN
      RAISE EXCEPTION 'Transaction date precedes account opening date (%)', v_account.opening_date
        USING ERRCODE = '22023';
    END IF;
    IF TG_OP <> 'DELETE' AND v_candidate_status = 'COMPLETED' THEN
      PERFORM private.assert_liquid_account_timeline(
        v_candidate_owner, v_account.id, v_candidate_id,
        v_candidate_status, v_candidate_from, v_candidate_to,
        v_candidate_amount, v_candidate_fee, v_candidate_created_at
      );
    END IF;
  END LOOP;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.validate_dated_transaction_balance()
  FROM PUBLIC, anon, authenticated, service_role;

-- Replace the net-only immediate overdraft rule. The opening-date trigger
-- keeps its name so it continues to run before any other transaction trigger.
DROP TRIGGER IF EXISTS enforce_liquid_balance ON public.transactions;
DROP TRIGGER IF EXISTS a_transaction_opening_date_boundary ON public.transactions;
CREATE TRIGGER a_transaction_opening_date_boundary
  BEFORE INSERT OR UPDATE OR DELETE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION private.validate_dated_transaction_balance();

CREATE OR REPLACE FUNCTION private.validate_dated_transaction_balance_at_commit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, pg_temp
AS $$
DECLARE
  v_account_id uuid;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    FOREACH v_account_id IN ARRAY ARRAY[OLD.from_account_id, OLD.to_account_id]::uuid[] LOOP
      IF v_account_id IS NOT NULL THEN
        PERFORM private.assert_liquid_account_timeline(OLD.owner_id, v_account_id);
      END IF;
    END LOOP;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    FOREACH v_account_id IN ARRAY ARRAY[NEW.from_account_id, NEW.to_account_id]::uuid[] LOOP
      IF v_account_id IS NOT NULL THEN
        PERFORM private.assert_liquid_account_timeline(NEW.owner_id, v_account_id);
      END IF;
    END LOOP;
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION private.validate_dated_transaction_balance_at_commit()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS validate_dated_transaction_balance_at_commit ON public.transactions;
CREATE CONSTRAINT TRIGGER validate_dated_transaction_balance_at_commit
  AFTER INSERT OR UPDATE OR DELETE ON public.transactions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION private.validate_dated_transaction_balance_at_commit();

NOTIFY pgrst, 'reload schema';

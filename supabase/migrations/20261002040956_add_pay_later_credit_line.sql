-- Pay Later products are revolving credit lines. Their purchases, repayments,
-- opening liabilities, available credit, and date bounds follow the existing
-- credit-card ledger semantics; only their account presentation differs.

UPDATE public.accounts SET credit_limit = 0 WHERE credit_limit IS NULL;
ALTER TABLE public.accounts
  ALTER COLUMN credit_limit SET DEFAULT 0,
  ALTER COLUMN credit_limit SET NOT NULL;
DO $$ BEGIN
  ALTER TABLE public.accounts ADD CONSTRAINT accounts_credit_limit_valid
    CHECK (credit_limit BETWEEN 0 AND 9999999999.99
       AND credit_limit = round(credit_limit, 2)
       AND (type NOT IN ('credit', 'credit_card', 'pay_later') OR credit_limit > 0));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.recurring_emis
  ADD COLUMN IF NOT EXISTS credit_account_id uuid REFERENCES public.accounts(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS recurring_emis_credit_account_id_idx
  ON public.recurring_emis(credit_account_id) WHERE credit_account_id IS NOT NULL;
ALTER TABLE private.emi_bank_action_requests
  ADD COLUMN IF NOT EXISTS credit_account_id uuid REFERENCES public.accounts(id) ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION private.validate_account_opening_position()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, private, pg_temp AS $$
DECLARE v_existing_balance numeric;
BEGIN
  IF NEW.type IS NULL THEN RAISE EXCEPTION 'Account type is required' USING ERRCODE = '22023'; END IF;
  IF NEW.opening_date > (statement_timestamp() AT TIME ZONE 'Asia/Kolkata')::date THEN
    RAISE EXCEPTION 'Account opening date cannot be in the future' USING ERRCODE = '22023';
  END IF;
  IF NEW.type IN ('credit', 'credit_card', 'pay_later') THEN
    IF NEW.opening_balance > 0 THEN
      RAISE EXCEPTION 'Credit-line opening balance must be zero or a negative outstanding amount' USING ERRCODE = '22023';
    END IF;
    IF NEW.type = 'pay_later' AND NEW.credit_limit <= 0 THEN
      RAISE EXCEPTION 'A credit line needs a positive approved limit' USING ERRCODE = '22023';
    END IF;
    IF NEW.credit_limit > 0 AND -NEW.opening_balance > NEW.credit_limit THEN
      RAISE EXCEPTION 'Opening outstanding balance exceeds the approved credit limit' USING ERRCODE = '22023';
    END IF;
    IF TG_OP = 'UPDATE' AND (NEW.credit_limit IS DISTINCT FROM OLD.credit_limit OR NEW.type IS DISTINCT FROM OLD.type)
       AND NEW.credit_limit > 0 THEN
      SELECT balance INTO v_existing_balance FROM public.account_balances WHERE id = OLD.id;
      IF GREATEST(0, -COALESCE(v_existing_balance, NEW.opening_balance)) > NEW.credit_limit THEN
        RAISE EXCEPTION 'Approved credit limit cannot be lower than current outstanding balance' USING ERRCODE = '22023';
      END IF;
    END IF;
  ELSIF NEW.opening_balance < 0 THEN
    RAISE EXCEPTION 'Bank, cash, and wallet opening balances cannot be negative' USING ERRCODE = '22023';
  END IF;
  IF TG_OP = 'UPDATE' AND ROW(NEW.opening_balance, NEW.opening_date) IS DISTINCT FROM ROW(OLD.opening_balance, OLD.opening_date)
     AND (EXISTS (SELECT 1 FROM public.transactions t WHERE t.from_account_id = OLD.id OR t.to_account_id = OLD.id)
       OR EXISTS (SELECT 1 FROM public.obligations o WHERE o.initiator_account_id = OLD.id AND o.status = 'PENDING_APPROVAL')) THEN
    RAISE EXCEPTION 'Opening balance and date are locked while referenced by ledger history or a pending debt request' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.validate_account_opening_position() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS validate_account_opening_position ON public.accounts;
CREATE TRIGGER validate_account_opening_position
  BEFORE INSERT OR UPDATE OF opening_balance, opening_date, type, credit_limit ON public.accounts
  FOR EACH ROW EXECUTE FUNCTION private.validate_account_opening_position();

CREATE OR REPLACE FUNCTION private.enforce_personal_emi_write()
RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF current_user IN ('postgres', 'service_role') THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' AND current_user = 'authenticated'
     AND NEW.owner_id = (SELECT auth.uid()) AND NEW.type = 'personal'
     AND NEW.counterparty_profile_id IS NULL AND NEW.shadow_contact_id IS NULL
     AND NEW.related_obligation_id IS NULL AND NEW.status = 'ACTIVE'
     AND NEW.amount > 0 AND NEW.amount = round(NEW.amount, 2)
     AND (NEW.end_date IS NULL OR NEW.end_date >= NEW.start_date)
     AND COALESCE(NEW.owner_months_paid, 0) = 0
     AND COALESCE(NEW.counterparty_months_paid, 0) = 0 THEN
    IF (NEW.initiator_account_id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM public.accounts WHERE id = NEW.initiator_account_id AND owner_id = NEW.owner_id))
       OR (NEW.account_id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM public.accounts WHERE id = NEW.account_id AND owner_id = NEW.owner_id)) THEN
      RAISE EXCEPTION 'EMI account does not belong to you' USING ERRCODE = '42501';
    END IF;
    IF NEW.credit_account_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.accounts
       WHERE id = NEW.credit_account_id AND owner_id = NEW.owner_id
         AND type IN ('credit', 'credit_card', 'pay_later')
    ) THEN
      RAISE EXCEPTION 'EMI credit account must be your own credit card or Pay Later account'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Use the supported EMI action for this change' USING ERRCODE = '42501';
END;
$$;
REVOKE ALL ON FUNCTION private.enforce_personal_emi_write() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.pay_bank_emi(
  p_request_id uuid, p_emi_id uuid, p_account_id uuid,
  p_expected_month integer, p_created_at timestamptz
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, private, pg_temp AS $$
DECLARE
  v_owner uuid := private.require_user();
  v_emi public.recurring_emis%ROWTYPE;
  v_account_opening_date date;
  v_previous private.emi_bank_action_requests%ROWTYPE;
  v_occurrence private.installment_occurrences%ROWTYPE;
  v_progress integer;
  v_total_months integer;
  v_transaction_id uuid;
BEGIN
  IF p_request_id IS NULL OR p_emi_id IS NULL OR p_account_id IS NULL OR p_created_at IS NULL THEN
    RAISE EXCEPTION 'Missing EMI payment details' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_owner::text || p_request_id::text, 0));
  SELECT * INTO v_previous FROM private.emi_bank_action_requests
   WHERE owner_id = v_owner AND request_id = p_request_id;
  IF FOUND THEN
    IF v_previous.emi_id <> p_emi_id OR v_previous.account_id <> p_account_id
       OR v_previous.month_number IS DISTINCT FROM p_expected_month
       OR v_previous.transaction_date IS DISTINCT FROM p_created_at THEN
      RAISE EXCEPTION 'Request ID was already used for different EMI data' USING ERRCODE = '23505';
    END IF;
    IF EXISTS (SELECT 1 FROM public.recurring_emis
                WHERE id = p_emi_id AND credit_account_id IS DISTINCT FROM v_previous.credit_account_id) THEN
      RAISE EXCEPTION 'Linked EMI destination changed after this payment request' USING ERRCODE = '23505';
    END IF;
    RETURN v_previous.transaction_id;
  END IF;
  IF EXISTS (SELECT 1 FROM public.transactions WHERE owner_id = v_owner AND client_request_id = p_request_id) THEN
    RAISE EXCEPTION 'Request ID already belongs to another transaction' USING ERRCODE = '23505';
  END IF;
  SELECT * INTO v_emi FROM public.recurring_emis
   WHERE id = p_emi_id AND status = 'ACTIVE'
     AND (owner_id = v_owner OR counterparty_profile_id = v_owner) FOR UPDATE;
  IF NOT FOUND OR NOT ((v_emi.type IN ('personal', 'lent') AND v_emi.owner_id = v_owner)
          OR (v_emi.type = 'borrowed' AND v_emi.counterparty_profile_id = v_owner)) THEN
    RAISE EXCEPTION 'EMI is unavailable to this bank payer' USING ERRCODE = '42501';
  END IF;
  SELECT opening_date INTO v_account_opening_date FROM public.accounts
   WHERE id = p_account_id AND owner_id = v_owner FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment account is unavailable' USING ERRCODE = '42501'; END IF;
  IF (p_created_at AT TIME ZONE 'Asia/Kolkata')::date < v_account_opening_date THEN
    RAISE EXCEPTION 'Payment date precedes account opening date (%)', v_account_opening_date USING ERRCODE = '22023';
  END IF;
  IF v_emi.type = 'personal' AND v_emi.credit_account_id IS NOT NULL THEN
    IF v_emi.credit_account_id = p_account_id OR NOT EXISTS (
      SELECT 1 FROM public.accounts WHERE id = v_emi.credit_account_id AND owner_id = v_owner
        AND type IN ('credit', 'credit_card', 'pay_later')
    ) THEN
      RAISE EXCEPTION 'Linked EMI destination is unavailable' USING ERRCODE = '42501';
    END IF;
  END IF;
  v_progress := CASE WHEN v_emi.owner_id = v_owner THEN COALESCE(v_emi.owner_months_paid, 0)
                     ELSE COALESCE(v_emi.counterparty_months_paid, 0) END;
  IF v_emi.type = 'personal' THEN
    SELECT * INTO v_occurrence FROM private.installment_occurrences
     WHERE schedule_kind = 'BANK_EMI' AND schedule_id = p_emi_id
       AND owner_id = v_owner AND installment_number = p_expected_month FOR UPDATE;
    IF NOT FOUND OR v_occurrence.status = 'PAID'
       OR (v_occurrence.status = 'UNCONFIRMED' AND v_occurrence.due_date < (statement_timestamp() AT TIME ZONE 'Asia/Kolkata')::date) THEN
      RAISE EXCEPTION 'Choose an unpaid installment; confirm past installment history first' USING ERRCODE = '22023';
    END IF;
  ELSE
    v_total_months := CASE WHEN v_emi.end_date IS NULL THEN 1
      ELSE private.installment_count_through_date(v_emi.start_date, v_emi.end_date) END;
    IF p_expected_month IS DISTINCT FROM v_progress + 1 OR p_expected_month > v_total_months THEN
      RAISE EXCEPTION 'EMI installment is unavailable or already paid' USING ERRCODE = '22023';
    END IF;
  END IF;
  v_transaction_id := private.post_ledger_transaction(
    p_request_id, p_account_id,
    CASE WHEN v_emi.type = 'personal' THEN v_emi.credit_account_id ELSE NULL END,
    v_emi.amount, 0,
    format('Bank EMI Installment: %s (Month %s)', v_emi.name, p_expected_month),
    p_created_at, NULL, NULL, NULL, NULL);
  IF v_emi.type = 'personal' THEN
    UPDATE private.installment_occurrences SET status = 'PAID', historical = false,
      transaction_id = v_transaction_id, updated_at = now()
     WHERE schedule_kind = 'BANK_EMI' AND schedule_id = p_emi_id AND installment_number = p_expected_month;
    SELECT count(*)::integer INTO v_progress FROM private.installment_occurrences
     WHERE schedule_kind = 'BANK_EMI' AND schedule_id = p_emi_id AND status = 'PAID';
  ELSE v_progress := p_expected_month; END IF;
  IF v_emi.owner_id = v_owner THEN
    UPDATE public.recurring_emis SET owner_months_paid = v_progress WHERE id = p_emi_id;
  ELSE
    UPDATE public.recurring_emis SET counterparty_months_paid = v_progress WHERE id = p_emi_id;
  END IF;
  INSERT INTO private.emi_bank_action_requests(owner_id, request_id, emi_id, account_id, month_number, transaction_date, transaction_id, credit_account_id)
  VALUES (v_owner, p_request_id, p_emi_id, p_account_id, p_expected_month, p_created_at, v_transaction_id,
          CASE WHEN v_emi.type = 'personal' THEN v_emi.credit_account_id ELSE NULL END);
  RETURN v_transaction_id;
END;
$$;
REVOKE ALL ON FUNCTION private.pay_bank_emi(uuid,uuid,uuid,integer,timestamptz) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION private.pay_bank_emi(uuid,uuid,uuid,integer,timestamptz) TO authenticated;
NOTIFY pgrst, 'reload schema';

CREATE OR REPLACE FUNCTION private.validate_account_opening_position()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, pg_temp
AS $$
DECLARE
  v_existing_balance numeric;
BEGIN
  IF NEW.type IS NULL THEN
    RAISE EXCEPTION 'Account type is required' USING ERRCODE = '22023';
  END IF;
  IF NEW.opening_date >
     (statement_timestamp() AT TIME ZONE 'Asia/Kolkata')::date THEN
    RAISE EXCEPTION 'Account opening date cannot be in the future' USING ERRCODE = '22023';
  END IF;

  -- Assets are positive and revolving-credit liabilities are negative.
  IF NEW.type IN ('credit', 'credit_card', 'pay_later') THEN
    IF NEW.opening_balance > 0 THEN
      RAISE EXCEPTION 'Credit-line opening balance must be zero or a negative outstanding amount'
        USING ERRCODE = '22023';
    END IF;
    IF NEW.credit_limit <= 0 THEN
      RAISE EXCEPTION 'A credit line needs a positive approved limit'
        USING ERRCODE = '22023';
    END IF;
    IF NEW.credit_limit > 0 AND -NEW.opening_balance > NEW.credit_limit THEN
      RAISE EXCEPTION 'Opening outstanding balance exceeds the approved credit limit'
        USING ERRCODE = '22023';
    END IF;
    IF TG_OP = 'UPDATE' AND
       (NEW.credit_limit IS DISTINCT FROM OLD.credit_limit OR
        NEW.type IS DISTINCT FROM OLD.type) AND NEW.credit_limit > 0 THEN
      SELECT balance INTO v_existing_balance FROM public.account_balances WHERE id = OLD.id;
      IF GREATEST(0, -COALESCE(v_existing_balance, NEW.opening_balance)) > NEW.credit_limit THEN
        RAISE EXCEPTION 'Approved credit limit cannot be lower than current outstanding balance'
          USING ERRCODE = '22023';
      END IF;
    END IF;
  ELSIF NEW.opening_balance < 0 THEN
    RAISE EXCEPTION 'Bank, cash, and wallet opening balances cannot be negative'
      USING ERRCODE = '22023';
  END IF;

  IF TG_OP = 'UPDATE'
     AND ROW(NEW.opening_balance, NEW.opening_date)
         IS DISTINCT FROM ROW(OLD.opening_balance, OLD.opening_date)
     AND (
       EXISTS (SELECT 1 FROM public.transactions AS t
                WHERE t.from_account_id = OLD.id OR t.to_account_id = OLD.id)
       OR EXISTS (SELECT 1 FROM public.obligations AS o
                   WHERE o.initiator_account_id = OLD.id
                     AND o.status = 'PENDING_APPROVAL')
     ) THEN
    RAISE EXCEPTION 'Opening balance and date are locked while referenced by ledger history or a pending debt request'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.validate_account_opening_position()
  FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS validate_account_opening_position ON public.accounts;
CREATE TRIGGER validate_account_opening_position
  BEFORE INSERT OR UPDATE OF opening_balance, opening_date, type, credit_limit
  ON public.accounts
  FOR EACH ROW EXECUTE FUNCTION private.validate_account_opening_position();

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
  IF NOT FOUND OR v_type IN ('credit', 'credit_card', 'pay_later') THEN
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

CREATE OR REPLACE FUNCTION private.validate_credit_line_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, pg_temp
AS $$
DECLARE
  v_account record;
  v_balance numeric;
  v_delta numeric;
  v_excluded_id uuid;
  v_account_ids uuid[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_account_ids := ARRAY[NEW.from_account_id, NEW.to_account_id]::uuid[];
  ELSIF TG_OP = 'UPDATE' THEN
    v_excluded_id := OLD.id;
    v_account_ids := ARRAY[OLD.from_account_id, OLD.to_account_id,
                           NEW.from_account_id, NEW.to_account_id]::uuid[];
  ELSE
    v_excluded_id := OLD.id;
    v_account_ids := ARRAY[OLD.from_account_id, OLD.to_account_id]::uuid[];
  END IF;

  FOR v_account IN
    SELECT id, type, credit_limit, opening_balance, opening_date
      FROM public.accounts
     WHERE id = ANY (v_account_ids)
     ORDER BY id
     FOR UPDATE
  LOOP
    IF v_account.type NOT IN ('credit', 'credit_card', 'pay_later') THEN
      CONTINUE;
    END IF;
    SELECT v_account.opening_balance + COALESCE(sum(
             CASE WHEN t.to_account_id = v_account.id THEN t.amount ELSE 0 END
             - CASE WHEN t.from_account_id = v_account.id
                    THEN t.amount + COALESCE(t.fee_amount, 0) ELSE 0 END
           ), 0)
      INTO v_balance
      FROM public.transactions AS t
     WHERE t.status = 'COMPLETED'
       AND t.id IS DISTINCT FROM v_excluded_id
       AND (t.from_account_id = v_account.id OR t.to_account_id = v_account.id)
       AND (t.created_at AT TIME ZONE 'Asia/Kolkata')::date >= v_account.opening_date;

    IF TG_OP <> 'DELETE' AND NEW.status = 'COMPLETED' THEN
      v_delta := CASE WHEN NEW.to_account_id = v_account.id THEN NEW.amount ELSE 0 END
               - CASE WHEN NEW.from_account_id = v_account.id
                      THEN NEW.amount + COALESCE(NEW.fee_amount, 0) ELSE 0 END;
      v_balance := v_balance + v_delta;
    END IF;
    IF v_balance < -v_account.credit_limit THEN
      RAISE EXCEPTION 'Transaction exceeds the approved credit limit for this account'
        USING ERRCODE = '22023';
    END IF;
  END LOOP;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.validate_credit_line_limit()
  FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS z_validate_credit_line_limit ON public.transactions;
CREATE TRIGGER z_validate_credit_line_limit
  BEFORE INSERT OR UPDATE OR DELETE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION private.validate_credit_line_limit();

NOTIFY pgrst, 'reload schema';

-- A settlement's occurrence date is chosen by its initiator, but the ledger
-- entries are still created atomically only after the counterparty approves.
ALTER TABLE public.settlements ADD COLUMN IF NOT EXISTS transaction_date date;
UPDATE public.settlements
   SET transaction_date = COALESCE(
     (created_at AT TIME ZONE 'Asia/Kolkata')::date,
     (statement_timestamp() AT TIME ZONE 'Asia/Kolkata')::date
   )
 WHERE transaction_date IS NULL;
ALTER TABLE public.settlements
  ALTER COLUMN transaction_date SET DEFAULT ((statement_timestamp() AT TIME ZONE 'Asia/Kolkata')::date),
  ALTER COLUMN transaction_date SET NOT NULL;

-- Replace both request wrappers so the new optional date does not leave an
-- ambiguous PostgREST overload. Omitting the date preserves the legacy default;
-- retries with the same request ID reuse the stored date when omitted.
DROP FUNCTION IF EXISTS public.request_settlement(uuid,uuid,uuid,numeric,integer);
DROP FUNCTION IF EXISTS private.request_settlement(uuid,uuid,uuid,numeric,integer);

CREATE FUNCTION private.request_settlement(
  p_request_id uuid, p_obligation_id uuid, p_source_account_id uuid,
  p_amount numeric, p_expected_month integer DEFAULT NULL,
  p_transaction_date date DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  v_owner uuid := private.require_user();
  v_existing public.settlements%ROWTYPE;
  v_ob public.obligations%ROWTYPE;
  v_emi public.recurring_emis%ROWTYPE;
  v_progress integer;
  v_month integer;
  v_id uuid;
  v_transaction_date date := p_transaction_date;
  v_opening_date date;
BEGIN
  IF p_request_id IS NULL OR p_obligation_id IS NULL
     OR p_source_account_id IS NULL THEN
    RAISE EXCEPTION 'Missing settlement request details' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_owner::text || p_request_id::text, 0));
  SELECT * INTO v_existing FROM public.settlements
   WHERE initiator_id = v_owner AND client_request_id = p_request_id;
  IF FOUND THEN
    IF v_transaction_date IS NULL THEN
      v_transaction_date := v_existing.transaction_date;
    END IF;
    IF v_existing.obligation_id <> p_obligation_id
       OR v_existing.source_account_id <> p_source_account_id
       OR v_existing.amount IS DISTINCT FROM p_amount
       OR v_existing.transaction_date IS DISTINCT FROM v_transaction_date
       OR (p_expected_month IS NOT NULL
           AND v_existing.emi_month_number IS DISTINCT FROM p_expected_month) THEN
      RAISE EXCEPTION 'Request ID was used for different settlement data'
        USING ERRCODE = '23505';
    END IF;
    RETURN v_existing.id;
  END IF;

  IF v_transaction_date IS NULL THEN
    v_transaction_date := (statement_timestamp() AT TIME ZONE 'Asia/Kolkata')::date;
  END IF;
  IF v_transaction_date > (statement_timestamp() AT TIME ZONE 'Asia/Kolkata')::date THEN
    RAISE EXCEPTION 'Settlement date cannot be in the future' USING ERRCODE = '22023';
  END IF;
  PERFORM private.require_account(v_owner, p_source_account_id);
  SELECT opening_date INTO v_opening_date FROM public.accounts
   WHERE id = p_source_account_id AND owner_id = v_owner FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment account is unavailable' USING ERRCODE = '42501';
  END IF;
  IF v_transaction_date < v_opening_date THEN
    RAISE EXCEPTION 'Settlement date precedes the payment account opening date (%)', v_opening_date
      USING ERRCODE = '22023';
  END IF;
  PERFORM private.require_amount(p_amount);
  SELECT * INTO v_ob FROM public.obligations
   WHERE id = p_obligation_id FOR UPDATE;
  IF NOT FOUND OR v_ob.debtor_profile_id IS DISTINCT FROM v_owner
     OR v_ob.creditor_profile_id IS NULL
     OR v_ob.creditor_profile_id = v_owner
     OR v_ob.status NOT IN ('ACCEPTED', 'PENDING')
     OR p_amount > v_ob.amount THEN
    RAISE EXCEPTION 'Debt is unavailable for this settlement'
      USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_emi FROM public.recurring_emis
   WHERE related_obligation_id = p_obligation_id FOR UPDATE;
  IF FOUND THEN
    v_progress := CASE WHEN v_emi.type = 'lent'
                       THEN COALESCE(v_emi.counterparty_months_paid, 0)
                       ELSE COALESCE(v_emi.owner_months_paid, 0) END;
    v_month := COALESCE(p_expected_month, v_progress + 1);
    IF v_month IS DISTINCT FROM v_progress + 1 THEN
      RAISE EXCEPTION 'EMI month is unavailable or already requested'
        USING ERRCODE = '22023';
    END IF;
  ELSIF p_expected_month IS NOT NULL THEN
    RAISE EXCEPTION 'Debt has no EMI schedule' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.settlements
    (obligation_id, initiator_id, counterparty_profile_id, amount,
     source_account_id, status, client_request_id, emi_month_number,
     transaction_date)
  VALUES (p_obligation_id, v_owner, v_ob.creditor_profile_id, p_amount,
          p_source_account_id, 'PENDING_APPROVAL', p_request_id,
          v_month, v_transaction_date)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION private.accept_settlement(
  p_settlement_id uuid, p_destination_account_id uuid, p_receiver_user_id uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  v_settlement public.settlements%ROWTYPE;
  v_ob public.obligations%ROWTYPE;
  v_emi public.recurring_emis%ROWTYPE;
  v_progress integer;
  v_source_opening_date date;
  v_destination_opening_date date;
  v_occurs_at timestamptz;
BEGIN
  IF p_receiver_user_id IS DISTINCT FROM private.require_user() THEN
    RAISE EXCEPTION 'Caller cannot act for another user' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_settlement FROM public.settlements
   WHERE id = p_settlement_id AND counterparty_profile_id = p_receiver_user_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Settlement unavailable' USING ERRCODE = '42501';
  END IF;
  PERFORM private.require_account(p_receiver_user_id, p_destination_account_id);
  IF v_settlement.status = 'COMPLETED'
     AND v_settlement.destination_account_id = p_destination_account_id THEN
    RETURN;
  END IF;
  IF v_settlement.status <> 'PENDING_APPROVAL' THEN
    RAISE EXCEPTION 'Settlement is not pending' USING ERRCODE = '22023';
  END IF;
  PERFORM private.require_account(v_settlement.initiator_id,
                                  v_settlement.source_account_id);
  PERFORM private.require_amount(v_settlement.amount);
  SELECT opening_date INTO v_source_opening_date FROM public.accounts
   WHERE id=v_settlement.source_account_id AND owner_id=v_settlement.initiator_id;
  SELECT opening_date INTO v_destination_opening_date FROM public.accounts
   WHERE id=p_destination_account_id AND owner_id=p_receiver_user_id;
  IF v_source_opening_date IS NULL OR v_destination_opening_date IS NULL
     OR v_settlement.transaction_date < v_source_opening_date
     OR v_settlement.transaction_date < v_destination_opening_date THEN
    RAISE EXCEPTION 'Settlement date precedes a payment account opening date' USING ERRCODE = '22023';
  END IF;
  v_occurs_at := (v_settlement.transaction_date + time '12:00') AT TIME ZONE 'Asia/Kolkata';
  SELECT * INTO v_ob FROM public.obligations
   WHERE id = v_settlement.obligation_id FOR UPDATE;
  IF NOT FOUND OR v_ob.creditor_profile_id IS DISTINCT FROM p_receiver_user_id
     OR v_ob.debtor_profile_id IS DISTINCT FROM v_settlement.initiator_id THEN
    RAISE EXCEPTION 'Settlement participants do not match debt'
      USING ERRCODE = '42501';
  END IF;
  IF v_ob.status NOT IN ('ACCEPTED', 'PENDING')
     OR v_settlement.amount > v_ob.amount THEN
    RAISE EXCEPTION 'Settlement exceeds outstanding debt or debt is inactive'
      USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_emi FROM public.recurring_emis
   WHERE related_obligation_id = v_ob.id FOR UPDATE;
  IF FOUND THEN
    v_progress := CASE WHEN v_emi.type = 'lent'
                       THEN COALESCE(v_emi.counterparty_months_paid, 0)
                       ELSE COALESCE(v_emi.owner_months_paid, 0) END;
    IF v_settlement.emi_month_number IS DISTINCT FROM v_progress + 1 THEN
      RAISE EXCEPTION 'EMI month changed before approval'
        USING ERRCODE = '22023';
    END IF;
  END IF;
  INSERT INTO public.transactions
    (owner_id, initiator_profile_id, from_account_id, amount,
     description, status, tagged_profile_id, created_at)
  VALUES (v_settlement.initiator_id, v_settlement.initiator_id,
          v_settlement.source_account_id, v_settlement.amount,
          'Repayment Sent: ' || v_ob.description, 'COMPLETED',
          p_receiver_user_id, v_occurs_at);
  INSERT INTO public.transactions
    (owner_id, initiator_profile_id, to_account_id, amount,
     description, status, tagged_profile_id, created_at)
  VALUES (p_receiver_user_id, p_receiver_user_id,
          p_destination_account_id, v_settlement.amount,
          'Repayment Received: ' || v_ob.description, 'COMPLETED',
          v_settlement.initiator_id, v_occurs_at);
  UPDATE public.obligations SET amount = amount - v_settlement.amount,
    status = CASE WHEN amount - v_settlement.amount = 0
                  THEN 'SETTLED' ELSE 'PENDING' END
   WHERE id = v_ob.id;
  UPDATE public.settlements
     SET status = 'COMPLETED', destination_account_id = p_destination_account_id
   WHERE id = p_settlement_id;
  IF FOUND AND v_emi.id IS NOT NULL THEN
    IF v_emi.type = 'lent' THEN
      UPDATE public.recurring_emis
         SET counterparty_months_paid = v_settlement.emi_month_number
       WHERE id = v_emi.id;
    ELSIF v_emi.type = 'borrowed' THEN
      UPDATE public.recurring_emis
         SET owner_months_paid = v_settlement.emi_month_number
       WHERE id = v_emi.id;
    END IF;
  END IF;
END $$;

REVOKE ALL ON FUNCTION private.request_settlement(uuid,uuid,uuid,numeric,integer,date)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.request_settlement(uuid,uuid,uuid,numeric,integer,date)
  TO authenticated;

CREATE FUNCTION public.request_settlement(
  p_request_id uuid, p_obligation_id uuid, p_source_account_id uuid,
  p_amount numeric, p_expected_month integer DEFAULT NULL,
  p_transaction_date date DEFAULT NULL
) RETURNS uuid LANGUAGE sql SECURITY INVOKER
SET search_path = public, pg_temp AS $$
  SELECT private.request_settlement(p_request_id,p_obligation_id,
    p_source_account_id,p_amount,p_expected_month,p_transaction_date);
$$;
REVOKE ALL ON FUNCTION public.request_settlement(uuid,uuid,uuid,numeric,integer,date)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.request_settlement(uuid,uuid,uuid,numeric,integer,date)
  TO authenticated;

NOTIFY pgrst, 'reload schema';

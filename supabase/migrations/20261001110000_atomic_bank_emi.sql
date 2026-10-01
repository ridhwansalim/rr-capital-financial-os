-- Bank EMI payments are external outflows. The ledger posting and progress
-- counter must commit together and a lost response must be safe to retry.
CREATE TABLE private.emi_bank_action_requests (
  owner_id uuid NOT NULL,
  request_id uuid NOT NULL,
  emi_id uuid NOT NULL,
  account_id uuid NOT NULL,
  month_number integer NOT NULL,
  transaction_date timestamptz NOT NULL,
  transaction_id uuid NOT NULL REFERENCES public.transactions(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, request_id)
);
REVOKE ALL ON private.emi_bank_action_requests FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.pay_bank_emi(
  p_request_id uuid, p_emi_id uuid, p_account_id uuid,
  p_expected_month integer, p_created_at timestamptz
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  v_owner uuid := private.require_user();
  v_emi public.recurring_emis%ROWTYPE;
  v_previous private.emi_bank_action_requests%ROWTYPE;
  v_progress integer;
  v_total_months integer;
  v_transaction_id uuid;
BEGIN
  IF p_request_id IS NULL OR p_emi_id IS NULL OR p_account_id IS NULL
     OR p_created_at IS NULL THEN
    RAISE EXCEPTION 'Missing EMI payment details' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_owner::text || p_request_id::text, 0));
  SELECT * INTO v_previous FROM private.emi_bank_action_requests
   WHERE owner_id = v_owner AND request_id = p_request_id;
  IF FOUND THEN
    IF v_previous.emi_id <> p_emi_id OR v_previous.account_id <> p_account_id
       OR v_previous.month_number IS DISTINCT FROM p_expected_month
       OR v_previous.transaction_date IS DISTINCT FROM p_created_at THEN
      RAISE EXCEPTION 'Request ID was already used for different EMI data'
        USING ERRCODE = '23505';
    END IF;
    RETURN v_previous.transaction_id;
  END IF;
  IF EXISTS (SELECT 1 FROM public.transactions
              WHERE owner_id = v_owner AND client_request_id = p_request_id) THEN
    RAISE EXCEPTION 'Request ID already belongs to another transaction'
      USING ERRCODE = '23505';
  END IF;
  SELECT * INTO v_emi FROM public.recurring_emis
   WHERE id = p_emi_id AND status = 'ACTIVE'
     AND (owner_id = v_owner OR counterparty_profile_id = v_owner)
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'EMI is unavailable' USING ERRCODE = '22023';
  END IF;
  IF NOT ((v_emi.type IN ('personal', 'lent') AND v_emi.owner_id = v_owner)
          OR (v_emi.type = 'borrowed' AND v_emi.counterparty_profile_id = v_owner)) THEN
    RAISE EXCEPTION 'Only the bank payer can log this payment'
      USING ERRCODE = '42501';
  END IF;
  IF v_emi.end_date IS NULL THEN
    v_total_months := 1;
  ELSE
    v_total_months := GREATEST(1, (
      extract(year FROM age(v_emi.end_date, v_emi.start_date)) * 12 +
      extract(month FROM age(v_emi.end_date, v_emi.start_date))
    )::integer + 1);
  END IF;
  v_progress := CASE WHEN v_emi.owner_id = v_owner
                     THEN COALESCE(v_emi.owner_months_paid, 0)
                     ELSE COALESCE(v_emi.counterparty_months_paid, 0) END;
  IF p_expected_month IS DISTINCT FROM v_progress + 1
     OR p_expected_month > v_total_months THEN
    RAISE EXCEPTION 'EMI installment is unavailable or already paid'
      USING ERRCODE = '22023';
  END IF;
  v_transaction_id := private.post_ledger_transaction(
    p_request_id, p_account_id, NULL, v_emi.amount, 0,
    format('Bank EMI Installment: %s (Month %s)', v_emi.name, p_expected_month),
    p_created_at, NULL, NULL, NULL, NULL
  );
  IF v_emi.owner_id = v_owner THEN
    UPDATE public.recurring_emis SET owner_months_paid = p_expected_month
     WHERE id = p_emi_id;
  ELSE
    UPDATE public.recurring_emis SET counterparty_months_paid = p_expected_month
     WHERE id = p_emi_id;
  END IF;
  INSERT INTO private.emi_bank_action_requests
    (owner_id, request_id, emi_id, account_id, month_number,
     transaction_date, transaction_id)
  VALUES (v_owner, p_request_id, p_emi_id, p_account_id, p_expected_month,
          p_created_at, v_transaction_id);
  RETURN v_transaction_id;
END $$;
REVOKE ALL ON FUNCTION private.pay_bank_emi(uuid,uuid,uuid,integer,timestamptz)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.pay_bank_emi(uuid,uuid,uuid,integer,timestamptz)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.pay_bank_emi(
  p_request_id uuid, p_emi_id uuid, p_account_id uuid,
  p_expected_month integer, p_created_at timestamptz
) RETURNS uuid LANGUAGE sql SECURITY INVOKER
SET search_path = public, pg_temp AS $$
  SELECT private.pay_bank_emi(p_request_id, p_emi_id, p_account_id,
                               p_expected_month, p_created_at);
$$;
REVOKE ALL ON FUNCTION public.pay_bank_emi(uuid,uuid,uuid,integer,timestamptz)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pay_bank_emi(uuid,uuid,uuid,integer,timestamptz)
  TO authenticated;

CREATE OR REPLACE FUNCTION private.protect_emi_bank_progress()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF current_user IN ('postgres', 'service_role') THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF COALESCE(NEW.owner_months_paid, 0) <> 0
       OR COALESCE(NEW.counterparty_months_paid, 0) <> 0 THEN
      RAISE EXCEPTION 'EMI progress cannot be set directly'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM private.emi_bank_action_requests
                WHERE emi_id = OLD.id) THEN
      RAISE EXCEPTION 'EMI with posted bank payments cannot be deleted'
        USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.owner_months_paid IS DISTINCT FROM OLD.owner_months_paid
     OR NEW.counterparty_months_paid IS DISTINCT FROM OLD.counterparty_months_paid THEN
    RAISE EXCEPTION 'EMI progress cannot be changed directly'
      USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM private.emi_bank_action_requests
              WHERE emi_id = OLD.id)
     AND ROW(NEW.owner_id, NEW.type, NEW.amount, NEW.start_date,
             NEW.end_date, NEW.counterparty_profile_id) IS DISTINCT FROM
         ROW(OLD.owner_id, OLD.type, OLD.amount, OLD.start_date,
             OLD.end_date, OLD.counterparty_profile_id) THEN
    RAISE EXCEPTION 'EMI financial terms are locked after posting'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS protect_emi_bank_progress ON public.recurring_emis;
CREATE TRIGGER protect_emi_bank_progress BEFORE INSERT OR UPDATE OR DELETE
  ON public.recurring_emis FOR EACH ROW EXECUTE FUNCTION private.protect_emi_bank_progress();
NOTIFY pgrst, 'reload schema';

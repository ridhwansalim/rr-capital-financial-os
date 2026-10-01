-- A Chitti claim or installment is one financial action: its ledger entry and
-- plan progress must commit or roll back together. Keep a durable request key
-- so a lost HTTP response can be retried without posting twice.
CREATE TABLE IF NOT EXISTS private.chitti_action_requests (
  owner_id uuid NOT NULL,
  request_id uuid NOT NULL,
  action_kind text NOT NULL CHECK (action_kind IN ('CLAIM', 'INSTALLMENT')),
  chitti_id uuid NOT NULL,
  account_id uuid NOT NULL,
  month_number integer NOT NULL,
  fee_amount numeric NOT NULL DEFAULT 0,
  transaction_date timestamptz,
  transaction_id uuid NOT NULL REFERENCES public.transactions(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, request_id)
);
REVOKE ALL ON private.chitti_action_requests FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.protect_chitti_state()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF current_user IN ('postgres', 'service_role') THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.months_paid <> 0 OR NEW.received_month_number IS NOT NULL
       OR NEW.fee_deducted <> 0 OR NEW.payout_received <> 0
       OR NEW.status <> 'ACTIVE' THEN
      RAISE EXCEPTION 'Chitti progress cannot be set directly'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM private.chitti_action_requests
                WHERE chitti_id = OLD.id) THEN
      RAISE EXCEPTION 'Chitti with posted financial actions cannot be deleted'
        USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.owner_id IS DISTINCT FROM OLD.owner_id
     OR NEW.months_paid IS DISTINCT FROM OLD.months_paid
     OR NEW.received_month_number IS DISTINCT FROM OLD.received_month_number
     OR NEW.fee_deducted IS DISTINCT FROM OLD.fee_deducted
     OR NEW.payout_received IS DISTINCT FROM OLD.payout_received
     OR NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'Chitti progress cannot be changed directly'
      USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM private.chitti_action_requests
              WHERE chitti_id = OLD.id)
     AND ROW(NEW.total_pot, NEW.duration_months, NEW.monthly_installment,
             NEW.start_date) IS DISTINCT FROM
         ROW(OLD.total_pot, OLD.duration_months, OLD.monthly_installment,
             OLD.start_date) THEN
    RAISE EXCEPTION 'Chitti financial terms are locked after posting'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS protect_chitti_state ON public.chittis;
CREATE TRIGGER protect_chitti_state BEFORE INSERT OR UPDATE OR DELETE
  ON public.chittis FOR EACH ROW EXECUTE FUNCTION private.protect_chitti_state();

CREATE OR REPLACE FUNCTION private.claim_chitti_pot(
  p_request_id uuid, p_chitti_id uuid, p_account_id uuid,
  p_month_number integer, p_fee_amount numeric
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  v_owner uuid := private.require_user();
  v_plan public.chittis%ROWTYPE;
  v_previous private.chitti_action_requests%ROWTYPE;
  v_transaction_id uuid;
  v_payout numeric;
BEGIN
  IF p_request_id IS NULL OR p_chitti_id IS NULL OR p_account_id IS NULL THEN
    RAISE EXCEPTION 'Missing Chitti action details' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_owner::text || p_request_id::text, 0));
  SELECT * INTO v_previous FROM private.chitti_action_requests
   WHERE owner_id = v_owner AND request_id = p_request_id;
  IF FOUND THEN
    IF v_previous.action_kind <> 'CLAIM' OR v_previous.chitti_id <> p_chitti_id
       OR v_previous.account_id <> p_account_id
       OR v_previous.month_number IS DISTINCT FROM p_month_number
       OR v_previous.fee_amount IS DISTINCT FROM p_fee_amount THEN
      RAISE EXCEPTION 'Request ID was already used for different Chitti data'
        USING ERRCODE = '23505';
    END IF;
    RETURN v_previous.transaction_id;
  END IF;
  IF EXISTS (SELECT 1 FROM public.transactions
              WHERE owner_id = v_owner AND client_request_id = p_request_id) THEN
    RAISE EXCEPTION 'Request ID already belongs to another transaction'
      USING ERRCODE = '23505';
  END IF;
  SELECT * INTO v_plan FROM public.chittis
   WHERE id = p_chitti_id AND owner_id = v_owner FOR UPDATE;
  IF NOT FOUND OR v_plan.status = 'CANCELLED' OR v_plan.received_month_number IS NOT NULL THEN
    RAISE EXCEPTION 'Chitti is unavailable for claim' USING ERRCODE = '22023';
  END IF;
  IF p_month_number NOT BETWEEN 1 AND v_plan.duration_months
     OR p_fee_amount IS NULL OR p_fee_amount < 0
     OR p_fee_amount > 9999999999.99 OR p_fee_amount <> round(p_fee_amount, 2) THEN
    RAISE EXCEPTION 'Invalid claim month or fee' USING ERRCODE = '22023';
  END IF;
  v_payout := v_plan.total_pot - p_fee_amount;
  PERFORM private.require_amount(v_payout);
  v_transaction_id := private.post_ledger_transaction(
    p_request_id, NULL, p_account_id, v_payout, 0,
    format('Chitti Claim: %s (Month %s)', v_plan.name, p_month_number),
    now(), NULL, NULL, NULL, NULL
  );
  UPDATE public.chittis SET received_month_number = p_month_number,
    fee_deducted = p_fee_amount, payout_received = v_payout
   WHERE id = p_chitti_id;
  INSERT INTO private.chitti_action_requests
    (owner_id, request_id, action_kind, chitti_id, account_id,
     month_number, fee_amount, transaction_id)
  VALUES (v_owner, p_request_id, 'CLAIM', p_chitti_id, p_account_id,
          p_month_number, p_fee_amount, v_transaction_id);
  RETURN v_transaction_id;
END $$;

CREATE OR REPLACE FUNCTION private.pay_chitti_installment(
  p_request_id uuid, p_chitti_id uuid, p_account_id uuid,
  p_expected_month integer, p_created_at timestamptz
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  v_owner uuid := private.require_user();
  v_plan public.chittis%ROWTYPE;
  v_previous private.chitti_action_requests%ROWTYPE;
  v_transaction_id uuid;
BEGIN
  IF p_request_id IS NULL OR p_chitti_id IS NULL OR p_account_id IS NULL
     OR p_created_at IS NULL THEN
    RAISE EXCEPTION 'Missing Chitti payment details' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_owner::text || p_request_id::text, 0));
  SELECT * INTO v_previous FROM private.chitti_action_requests
   WHERE owner_id = v_owner AND request_id = p_request_id;
  IF FOUND THEN
    IF v_previous.action_kind <> 'INSTALLMENT' OR v_previous.chitti_id <> p_chitti_id
       OR v_previous.account_id <> p_account_id
       OR v_previous.month_number IS DISTINCT FROM p_expected_month
       OR v_previous.transaction_date IS DISTINCT FROM p_created_at THEN
      RAISE EXCEPTION 'Request ID was already used for different Chitti data'
        USING ERRCODE = '23505';
    END IF;
    RETURN v_previous.transaction_id;
  END IF;
  IF EXISTS (SELECT 1 FROM public.transactions
              WHERE owner_id = v_owner AND client_request_id = p_request_id) THEN
    RAISE EXCEPTION 'Request ID already belongs to another transaction'
      USING ERRCODE = '23505';
  END IF;
  SELECT * INTO v_plan FROM public.chittis
   WHERE id = p_chitti_id AND owner_id = v_owner FOR UPDATE;
  IF NOT FOUND OR v_plan.status <> 'ACTIVE'
     OR p_expected_month IS DISTINCT FROM v_plan.months_paid + 1
     OR p_expected_month > v_plan.duration_months THEN
    RAISE EXCEPTION 'Chitti installment is unavailable or already paid'
      USING ERRCODE = '22023';
  END IF;
  v_transaction_id := private.post_ledger_transaction(
    p_request_id, p_account_id, NULL, v_plan.monthly_installment, 0,
    format('Chitti Installment: %s (Month %s/%s)',
           v_plan.name, p_expected_month, v_plan.duration_months),
    p_created_at, NULL, NULL, NULL, NULL
  );
  UPDATE public.chittis SET months_paid = p_expected_month,
    status = CASE WHEN p_expected_month = duration_months
                  THEN 'COMPLETED' ELSE status END
   WHERE id = p_chitti_id;
  INSERT INTO private.chitti_action_requests
    (owner_id, request_id, action_kind, chitti_id, account_id,
     month_number, transaction_date, transaction_id)
  VALUES (v_owner, p_request_id, 'INSTALLMENT', p_chitti_id, p_account_id,
          p_expected_month, p_created_at, v_transaction_id);
  RETURN v_transaction_id;
END $$;

REVOKE ALL ON FUNCTION private.claim_chitti_pot(uuid,uuid,uuid,integer,numeric)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.pay_chitti_installment(uuid,uuid,uuid,integer,timestamptz)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.claim_chitti_pot(uuid,uuid,uuid,integer,numeric)
  TO authenticated;
GRANT EXECUTE ON FUNCTION private.pay_chitti_installment(uuid,uuid,uuid,integer,timestamptz)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.claim_chitti_pot(
  p_request_id uuid, p_chitti_id uuid, p_account_id uuid,
  p_month_number integer, p_fee_amount numeric
) RETURNS uuid LANGUAGE sql SECURITY INVOKER
SET search_path = public, pg_temp AS $$
  SELECT private.claim_chitti_pot(p_request_id, p_chitti_id, p_account_id,
                                  p_month_number, p_fee_amount);
$$;
CREATE OR REPLACE FUNCTION public.pay_chitti_installment(
  p_request_id uuid, p_chitti_id uuid, p_account_id uuid,
  p_expected_month integer, p_created_at timestamptz
) RETURNS uuid LANGUAGE sql SECURITY INVOKER
SET search_path = public, pg_temp AS $$
  SELECT private.pay_chitti_installment(p_request_id, p_chitti_id, p_account_id,
                                         p_expected_month, p_created_at);
$$;
REVOKE ALL ON FUNCTION public.claim_chitti_pot(uuid,uuid,uuid,integer,numeric)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.pay_chitti_installment(uuid,uuid,uuid,integer,timestamptz)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_chitti_pot(uuid,uuid,uuid,integer,numeric)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.pay_chitti_installment(uuid,uuid,uuid,integer,timestamptz)
  TO authenticated;
NOTIFY pgrst, 'reload schema';

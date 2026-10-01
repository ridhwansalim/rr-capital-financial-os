-- A settlement request is immutable after creation. Only audited RPCs may
-- request, decline, or complete it; clients cannot forge status or amounts.
ALTER TABLE public.settlements ADD COLUMN client_request_id uuid;
ALTER TABLE public.settlements ADD COLUMN decline_reason text;
ALTER TABLE public.settlements ADD COLUMN emi_month_number integer;
ALTER TABLE public.settlements ADD COLUMN initiator_dismissed_at timestamptz;
CREATE UNIQUE INDEX settlements_initiator_request_key
  ON public.settlements(initiator_id, client_request_id)
  WHERE client_request_id IS NOT NULL;
CREATE UNIQUE INDEX settlements_one_emi_month_key
  ON public.settlements(obligation_id, emi_month_number)
  WHERE emi_month_number IS NOT NULL
    AND status IN ('PENDING_APPROVAL', 'COMPLETED');

CREATE OR REPLACE FUNCTION private.protect_settlement_state()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF current_user NOT IN ('postgres', 'service_role') THEN
    RAISE EXCEPTION 'Use settlement request and decision actions'
      USING ERRCODE = '42501';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
DROP TRIGGER IF EXISTS protect_settlement_state ON public.settlements;
CREATE TRIGGER protect_settlement_state BEFORE INSERT OR UPDATE OR DELETE
  ON public.settlements FOR EACH ROW EXECUTE FUNCTION private.protect_settlement_state();

CREATE OR REPLACE FUNCTION private.request_settlement(
  p_request_id uuid, p_obligation_id uuid, p_source_account_id uuid,
  p_amount numeric, p_expected_month integer DEFAULT NULL
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
BEGIN
  IF p_request_id IS NULL OR p_obligation_id IS NULL
     OR p_source_account_id IS NULL THEN
    RAISE EXCEPTION 'Missing settlement request details' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_owner::text || p_request_id::text, 0));
  SELECT * INTO v_existing FROM public.settlements
   WHERE initiator_id = v_owner AND client_request_id = p_request_id;
  IF FOUND THEN
    IF v_existing.obligation_id <> p_obligation_id
       OR v_existing.source_account_id <> p_source_account_id
       OR v_existing.amount IS DISTINCT FROM p_amount
       OR (p_expected_month IS NOT NULL
           AND v_existing.emi_month_number IS DISTINCT FROM p_expected_month) THEN
      RAISE EXCEPTION 'Request ID was used for different settlement data'
        USING ERRCODE = '23505';
    END IF;
    RETURN v_existing.id;
  END IF;
  PERFORM private.require_account(v_owner, p_source_account_id);
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
     source_account_id, status, client_request_id, emi_month_number)
  VALUES (p_obligation_id, v_owner, v_ob.creditor_profile_id, p_amount,
          p_source_account_id, 'PENDING_APPROVAL', p_request_id,
          v_month)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION private.dismiss_declined_settlement(
  p_settlement_id uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE v_owner uuid := private.require_user();
BEGIN
  UPDATE public.settlements SET initiator_dismissed_at = now()
   WHERE id = p_settlement_id AND initiator_id = v_owner
     AND status = 'DECLINED' AND initiator_dismissed_at IS NULL;
  IF NOT FOUND AND NOT EXISTS (
    SELECT 1 FROM public.settlements
     WHERE id = p_settlement_id AND initiator_id = v_owner
       AND status = 'DECLINED' AND initiator_dismissed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Declined settlement is unavailable'
      USING ERRCODE = '42501';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION private.decline_settlement(
  p_settlement_id uuid, p_reason text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  v_owner uuid := private.require_user();
  v_settlement public.settlements%ROWTYPE;
BEGIN
  SELECT * INTO v_settlement FROM public.settlements
   WHERE id = p_settlement_id AND counterparty_profile_id = v_owner FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Settlement is unavailable' USING ERRCODE = '42501';
  END IF;
  IF v_settlement.status = 'DECLINED' THEN RETURN; END IF;
  IF v_settlement.status <> 'PENDING_APPROVAL' THEN
    RAISE EXCEPTION 'Only a pending settlement can be declined'
      USING ERRCODE = '22023';
  END IF;
  IF length(btrim(COALESCE(p_reason, ''))) > 200 THEN
    RAISE EXCEPTION 'Decline reason is too long' USING ERRCODE = '22023';
  END IF;
  UPDATE public.settlements
     SET status = 'DECLINED', decline_reason = NULLIF(btrim(p_reason), '')
   WHERE id = p_settlement_id;
END $$;

-- Keep approval atomic and idempotent, but count only the peer repayment.
-- Bank progress advances only through pay_bank_emi.
CREATE OR REPLACE FUNCTION private.accept_settlement(
  p_settlement_id uuid, p_destination_account_id uuid, p_receiver_user_id uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  v_settlement public.settlements%ROWTYPE;
  v_ob public.obligations%ROWTYPE;
  v_emi public.recurring_emis%ROWTYPE;
  v_progress integer;
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
          p_receiver_user_id, now());
  INSERT INTO public.transactions
    (owner_id, initiator_profile_id, to_account_id, amount,
     description, status, tagged_profile_id, created_at)
  VALUES (p_receiver_user_id, p_receiver_user_id,
          p_destination_account_id, v_settlement.amount,
          'Repayment Received: ' || v_ob.description, 'COMPLETED',
          v_settlement.initiator_id, now());
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

REVOKE ALL ON FUNCTION private.request_settlement(uuid,uuid,uuid,numeric,integer)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.decline_settlement(uuid,text)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.dismiss_declined_settlement(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.request_settlement(uuid,uuid,uuid,numeric,integer)
  TO authenticated;
GRANT EXECUTE ON FUNCTION private.decline_settlement(uuid,text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION private.dismiss_declined_settlement(uuid)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.request_settlement(
  p_request_id uuid, p_obligation_id uuid, p_source_account_id uuid,
  p_amount numeric, p_expected_month integer DEFAULT NULL
) RETURNS uuid LANGUAGE sql SECURITY INVOKER
SET search_path = public, pg_temp AS $$
  SELECT private.request_settlement(p_request_id,p_obligation_id,
                                    p_source_account_id,p_amount,p_expected_month);
$$;
CREATE OR REPLACE FUNCTION public.decline_settlement(
  p_settlement_id uuid, p_reason text
) RETURNS void LANGUAGE sql SECURITY INVOKER
SET search_path = public, pg_temp AS $$
  SELECT private.decline_settlement(p_settlement_id,p_reason);
$$;
CREATE OR REPLACE FUNCTION public.dismiss_declined_settlement(
  p_settlement_id uuid
) RETURNS void LANGUAGE sql SECURITY INVOKER
SET search_path = public, pg_temp AS $$
  SELECT private.dismiss_declined_settlement(p_settlement_id);
$$;
REVOKE ALL ON FUNCTION public.request_settlement(uuid,uuid,uuid,numeric,integer)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.decline_settlement(uuid,text)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dismiss_declined_settlement(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_settlement(uuid,uuid,uuid,numeric,integer)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.decline_settlement(uuid,text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.dismiss_declined_settlement(uuid)
  TO authenticated;
NOTIFY pgrst, 'reload schema';

-- A device may retry an offline write after the server committed but before
-- the response arrived. Keep its request ID on the ledger so the retry cannot
-- create another transaction or another obligation-payment link.
ALTER TABLE public.transactions ADD COLUMN client_request_id uuid;
ALTER TABLE public.transactions ADD COLUMN client_new_contact_name text;
CREATE UNIQUE INDEX transactions_owner_client_request_id_key
  ON public.transactions(owner_id, client_request_id)
  WHERE client_request_id IS NOT NULL;

-- Financial facts stay immutable after completion, while the existing
-- shadow-contact merge flow may retag a transaction later.
CREATE OR REPLACE FUNCTION private.protect_idempotent_transaction()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF (OLD.status = 'COMPLETED' OR OLD.client_request_id IS NOT NULL)
     AND current_user NOT IN ('postgres', 'service_role') THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Posted transaction cannot be deleted directly'
        USING ERRCODE = '42501';
    END IF;
    IF ROW(OLD.owner_id, OLD.initiator_profile_id, OLD.from_account_id,
              OLD.to_account_id, OLD.amount, OLD.fee_amount, OLD.description,
              OLD.status, OLD.created_at, OLD.client_request_id,
              OLD.client_new_contact_name)
       IS DISTINCT FROM
       ROW(NEW.owner_id, NEW.initiator_profile_id, NEW.from_account_id,
              NEW.to_account_id, NEW.amount, NEW.fee_amount, NEW.description,
              NEW.status, NEW.created_at, NEW.client_request_id,
              NEW.client_new_contact_name) THEN
      RAISE EXCEPTION 'Posted transaction cannot be changed directly'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.protect_idempotent_transaction() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER protect_idempotent_transaction
  BEFORE UPDATE OR DELETE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION private.protect_idempotent_transaction();

CREATE UNIQUE INDEX obligation_payments_transaction_id_key
  ON public.obligation_payments(transaction_id);

CREATE OR REPLACE FUNCTION private.post_ledger_transaction(
  p_request_id uuid, p_from_account_id uuid, p_to_account_id uuid,
  p_amount numeric, p_fee_amount numeric, p_description text,
  p_created_at timestamptz, p_tagged_profile_id uuid DEFAULT NULL,
  p_contact_id uuid DEFAULT NULL, p_obligation_id uuid DEFAULT NULL,
  p_new_contact_name text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  v_owner uuid := private.require_user();
  v_existing public.transactions%ROWTYPE;
  v_transaction_id uuid;
  v_obligation public.obligations%ROWTYPE;
  v_contact_id uuid := p_contact_id;
BEGIN
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'Request ID is required' USING ERRCODE = '22023';
  END IF;
  IF p_new_contact_name IS NOT NULL AND
     (p_contact_id IS NOT NULL OR p_tagged_profile_id IS NOT NULL
      OR length(btrim(p_new_contact_name)) NOT BETWEEN 1 AND 100) THEN
    RAISE EXCEPTION 'Invalid new contact' USING ERRCODE = '22023';
  END IF;
  -- Serialize two attempts with the same owner and request ID before any
  -- side effect, including the optional debt link.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_owner::text || p_request_id::text, 0));
  SELECT * INTO v_existing FROM public.transactions
   WHERE owner_id = v_owner AND client_request_id = p_request_id;
  IF FOUND THEN
    IF v_existing.from_account_id IS DISTINCT FROM p_from_account_id
       OR v_existing.to_account_id IS DISTINCT FROM p_to_account_id
       OR v_existing.amount IS DISTINCT FROM p_amount
       OR COALESCE(v_existing.fee_amount, 0) IS DISTINCT FROM COALESCE(p_fee_amount, 0)
       OR v_existing.description IS DISTINCT FROM p_description
       OR v_existing.created_at IS DISTINCT FROM p_created_at
       OR v_existing.client_new_contact_name IS DISTINCT FROM
          (CASE WHEN p_new_contact_name IS NULL THEN NULL ELSE btrim(p_new_contact_name) END)
       OR ((p_obligation_id IS NULL) <> NOT EXISTS (
             SELECT 1 FROM public.obligation_payments op
              WHERE op.transaction_id = v_existing.id AND op.obligation_id = p_obligation_id
           )) THEN
      RAISE EXCEPTION 'Request ID was already used for different transaction data'
        USING ERRCODE = '23505';
    END IF;
    RETURN v_existing.id;
  END IF;

  PERFORM private.require_amount(p_amount);
  IF p_fee_amount IS NOT NULL AND
     (p_fee_amount < 0 OR p_fee_amount > 9999999999.99 OR p_fee_amount <> round(p_fee_amount, 2)) THEN
    RAISE EXCEPTION 'Invalid fee amount' USING ERRCODE = '22023';
  END IF;
  IF p_from_account_id IS NULL AND p_to_account_id IS NULL THEN
    RAISE EXCEPTION 'An account endpoint is required' USING ERRCODE = '22023';
  END IF;
  IF p_from_account_id IS NOT NULL THEN
    PERFORM private.require_account(v_owner, p_from_account_id);
  END IF;
  IF p_to_account_id IS NOT NULL THEN
    PERFORM private.require_account(v_owner, p_to_account_id);
  END IF;
  IF p_tagged_profile_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = p_tagged_profile_id
  ) THEN
    RAISE EXCEPTION 'Tagged user does not exist' USING ERRCODE = '22023';
  END IF;
  IF p_new_contact_name IS NOT NULL THEN
    INSERT INTO public.contacts(owner_id, name)
      VALUES (v_owner, btrim(p_new_contact_name)) RETURNING id INTO v_contact_id;
  END IF;
  IF p_contact_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.contacts WHERE id = p_contact_id AND owner_id = v_owner
  ) THEN
    RAISE EXCEPTION 'Contact does not belong to you' USING ERRCODE = '42501';
  END IF;
  IF p_created_at IS NULL OR p_created_at > now() + interval '1 day'
     OR p_created_at < now() - interval '5 years' THEN
    RAISE EXCEPTION 'Invalid transaction date' USING ERRCODE = '22023';
  END IF;
  IF p_obligation_id IS NOT NULL THEN
    SELECT * INTO v_obligation FROM public.obligations
     WHERE id = p_obligation_id AND owner_id = v_owner FOR UPDATE;
    IF NOT FOUND OR v_obligation.status NOT IN ('PENDING', 'ACCEPTED') THEN
      RAISE EXCEPTION 'Debt is unavailable for payment' USING ERRCODE = '42501';
    END IF;
    IF p_amount > v_obligation.amount THEN
      RAISE EXCEPTION 'Payment exceeds outstanding debt' USING ERRCODE = '22023';
    END IF;
  END IF;

  INSERT INTO public.transactions (
    owner_id, initiator_profile_id, from_account_id, to_account_id,
    amount, fee_amount, description, status, created_at,
    tagged_profile_id, contact_id, client_request_id, client_new_contact_name
  ) VALUES (
    v_owner, v_owner, p_from_account_id, p_to_account_id,
    p_amount, COALESCE(p_fee_amount, 0), p_description, 'COMPLETED', p_created_at,
    p_tagged_profile_id, v_contact_id, p_request_id,
    CASE WHEN p_new_contact_name IS NULL THEN NULL ELSE btrim(p_new_contact_name) END
  ) RETURNING id INTO v_transaction_id;

  IF p_obligation_id IS NOT NULL THEN
    INSERT INTO public.obligation_payments(obligation_id, transaction_id, amount)
      VALUES (p_obligation_id, v_transaction_id, p_amount);
    UPDATE public.obligations
       SET amount = amount - p_amount,
           status = CASE WHEN amount - p_amount = 0 THEN 'SETTLED' ELSE status END
     WHERE id = p_obligation_id;
  END IF;
  RETURN v_transaction_id;
END $$;

REVOKE ALL ON FUNCTION private.post_ledger_transaction(uuid,uuid,uuid,numeric,numeric,text,timestamptz,uuid,uuid,uuid,text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.post_ledger_transaction(uuid,uuid,uuid,numeric,numeric,text,timestamptz,uuid,uuid,uuid,text)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.post_ledger_transaction(
  p_request_id uuid, p_from_account_id uuid, p_to_account_id uuid,
  p_amount numeric, p_fee_amount numeric, p_description text,
  p_created_at timestamptz, p_tagged_profile_id uuid DEFAULT NULL,
  p_contact_id uuid DEFAULT NULL, p_obligation_id uuid DEFAULT NULL,
  p_new_contact_name text DEFAULT NULL
) RETURNS uuid LANGUAGE sql SECURITY INVOKER
SET search_path = public, pg_temp AS $$
  SELECT private.post_ledger_transaction(
    p_request_id, p_from_account_id, p_to_account_id, p_amount,
    p_fee_amount, p_description, p_created_at, p_tagged_profile_id,
    p_contact_id, p_obligation_id, p_new_contact_name
  );
$$;
REVOKE ALL ON FUNCTION public.post_ledger_transaction(uuid,uuid,uuid,numeric,numeric,text,timestamptz,uuid,uuid,uuid,text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_ledger_transaction(uuid,uuid,uuid,numeric,numeric,text,timestamptz,uuid,uuid,uuid,text)
  TO authenticated;
NOTIFY pgrst, 'reload schema';

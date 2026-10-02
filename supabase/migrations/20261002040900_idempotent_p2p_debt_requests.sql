-- P2P debt creation can be retried after an ambiguous network failure. Store
-- the complete request boundary privately and create ad-hoc contacts in the
-- same transaction as the obligation/ledger entry.
CREATE TABLE IF NOT EXISTS private.p2p_request_metadata (
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  counterparty_profile_id uuid,
  requested_shadow_contact_id uuid,
  created_shadow_contact_id uuid,
  new_shadow_contact_name text,
  account_id uuid NOT NULL,
  amount numeric NOT NULL,
  description text,
  is_emi boolean NOT NULL,
  debt_type text NOT NULL,
  transaction_date timestamptz NOT NULL,
  obligation_id uuid NOT NULL,
  PRIMARY KEY (owner_id, request_id)
);
ALTER TABLE private.p2p_request_metadata ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.p2p_request_metadata FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.process_p2p_transaction_checked(
  p_request_id uuid,
  p_owner_id uuid,
  p_counterparty_profile_id uuid,
  p_shadow_contact_id uuid,
  p_account_id uuid,
  p_amount numeric,
  p_description text,
  p_is_emi boolean,
  p_type text,
  p_transaction_date timestamptz,
  p_new_shadow_contact_name text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, private, pg_temp AS $$
DECLARE
  v_owner uuid := private.require_user();
  v_new_name text := NULLIF(btrim(p_new_shadow_contact_name), '');
  v_contact_id uuid := p_shadow_contact_id;
  v_obligation_id uuid;
  v_transaction_id uuid;
  v_creditor_id uuid;
  v_debtor_id uuid;
  v_account_opening_date date;
  v_is_emi boolean := COALESCE(p_is_emi, false);
  v_previous private.p2p_request_metadata%ROWTYPE;
BEGIN
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'Request ID is required' USING ERRCODE = '22023';
  END IF;
  IF p_owner_id IS DISTINCT FROM v_owner THEN
    RAISE EXCEPTION 'Caller cannot act for another user' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_owner::text || p_request_id::text, 0));
  SELECT * INTO v_previous FROM private.p2p_request_metadata
   WHERE owner_id = v_owner AND request_id = p_request_id;
  IF FOUND THEN
    IF v_previous.counterparty_profile_id IS DISTINCT FROM p_counterparty_profile_id
       OR v_previous.requested_shadow_contact_id IS DISTINCT FROM p_shadow_contact_id
       OR v_previous.new_shadow_contact_name IS DISTINCT FROM v_new_name
       OR v_previous.account_id IS DISTINCT FROM p_account_id
       OR v_previous.amount IS DISTINCT FROM p_amount
       OR v_previous.description IS DISTINCT FROM p_description
       OR v_previous.is_emi IS DISTINCT FROM v_is_emi
       OR v_previous.debt_type IS DISTINCT FROM p_type
       OR v_previous.transaction_date IS DISTINCT FROM p_transaction_date THEN
      RAISE EXCEPTION 'Request ID was already used for different debt data'
        USING ERRCODE = '23505';
    END IF;
    RETURN v_previous.obligation_id;
  END IF;

  PERFORM private.require_account(v_owner, p_account_id);
  SELECT opening_date INTO v_account_opening_date
    FROM public.accounts
   WHERE id = p_account_id AND owner_id = v_owner
   FOR UPDATE;
  PERFORM private.require_amount(p_amount);
  IF p_type IS NULL OR p_type NOT IN ('lent', 'borrowed') THEN
    RAISE EXCEPTION 'Invalid debt direction' USING ERRCODE = '22023';
  END IF;
  -- Keep debt dates inside the same bounded history window used by ledger
  -- posting. Apply the opening date up front so a registered-user request
  -- cannot remain pending until acceptance inevitably fails for its creator.
  IF p_transaction_date IS NULL
     OR p_transaction_date > statement_timestamp() + interval '1 day'
     OR p_transaction_date < statement_timestamp() - interval '5 years' THEN
    RAISE EXCEPTION 'Invalid debt transaction date' USING ERRCODE = '22023';
  END IF;
  IF (p_transaction_date AT TIME ZONE 'Asia/Kolkata')::date < v_account_opening_date THEN
    RAISE EXCEPTION 'Debt date precedes account opening date (%)', v_account_opening_date
      USING ERRCODE = '22023';
  END IF;
  IF (p_counterparty_profile_id IS NOT NULL)::integer
     + (p_shadow_contact_id IS NOT NULL)::integer
     + (v_new_name IS NOT NULL)::integer <> 1 THEN
    RAISE EXCEPTION 'Choose one registered user or shadow contact' USING ERRCODE = '22023';
  END IF;
  IF v_new_name IS NOT NULL AND length(v_new_name) > 120 THEN
    RAISE EXCEPTION 'Contact name is too long' USING ERRCODE = '22023';
  END IF;

  IF v_new_name IS NOT NULL THEN
    INSERT INTO public.contacts(owner_id, name) VALUES (v_owner, v_new_name)
      RETURNING id INTO v_contact_id;
  END IF;
  PERFORM private.require_counterparty(v_owner, p_counterparty_profile_id, v_contact_id);

  IF p_type = 'lent' THEN
    v_creditor_id := v_owner;
    v_debtor_id := p_counterparty_profile_id;
  ELSE
    v_creditor_id := p_counterparty_profile_id;
    v_debtor_id := v_owner;
  END IF;

  IF p_counterparty_profile_id IS NOT NULL THEN
    INSERT INTO public.obligations (
      owner_id, creditor_profile_id, debtor_profile_id, amount, total_amount,
      description, reason, status, is_emi, type, created_at, initiator_account_id
    ) VALUES (
      v_owner, v_creditor_id, v_debtor_id, p_amount, p_amount,
      p_description, p_description, 'PENDING_APPROVAL', v_is_emi,
      p_type, p_transaction_date, p_account_id
    ) RETURNING id INTO v_obligation_id;
  ELSE
    INSERT INTO public.transactions (
      owner_id, initiator_profile_id, from_account_id, to_account_id,
      amount, description, status, contact_id, created_at
    ) VALUES (
      v_owner, v_owner,
      CASE WHEN p_type = 'lent' THEN p_account_id ELSE NULL END,
      CASE WHEN p_type = 'borrowed' THEN p_account_id ELSE NULL END,
      p_amount, p_description, 'COMPLETED', v_contact_id, p_transaction_date
    ) RETURNING id INTO v_transaction_id;
    INSERT INTO public.obligations (
      owner_id, creditor_profile_id, debtor_profile_id, shadow_contact_id,
      amount, total_amount, description, reason, status, is_emi,
      related_transaction_id, type, created_at, initiator_account_id
    ) VALUES (
      v_owner, v_creditor_id, v_debtor_id, v_contact_id,
      p_amount, p_amount, p_description, p_description, 'ACCEPTED',
      v_is_emi,
      v_transaction_id,
      p_type, p_transaction_date, p_account_id
    ) RETURNING id INTO v_obligation_id;
  END IF;

  INSERT INTO private.p2p_request_metadata (
    owner_id, request_id, counterparty_profile_id, requested_shadow_contact_id,
    created_shadow_contact_id, new_shadow_contact_name, account_id, amount,
    description, is_emi, debt_type, transaction_date, obligation_id
  ) VALUES (
    v_owner, p_request_id, p_counterparty_profile_id, p_shadow_contact_id,
    CASE WHEN v_new_name IS NOT NULL THEN v_contact_id ELSE NULL END,
    v_new_name, p_account_id, p_amount, p_description, v_is_emi,
    p_type, p_transaction_date, v_obligation_id
  );
  RETURN v_obligation_id;
END $$;
REVOKE ALL ON FUNCTION private.process_p2p_transaction_checked(
  uuid,uuid,uuid,uuid,uuid,numeric,text,boolean,text,timestamptz,text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.process_p2p_transaction_checked(
  uuid,uuid,uuid,uuid,uuid,numeric,text,boolean,text,timestamptz,text
) TO authenticated;

CREATE OR REPLACE FUNCTION public.process_p2p_transaction(
  p_request_id uuid,
  p_owner_id uuid,
  p_counterparty_profile_id uuid,
  p_shadow_contact_id uuid,
  p_account_id uuid,
  p_amount numeric,
  p_description text,
  p_is_emi boolean,
  p_type text,
  p_transaction_date timestamptz,
  p_new_shadow_contact_name text DEFAULT NULL
) RETURNS uuid LANGUAGE sql SECURITY INVOKER
SET search_path = pg_catalog, public, private, pg_temp AS $$
  SELECT private.process_p2p_transaction_checked(
    p_request_id, p_owner_id, p_counterparty_profile_id, p_shadow_contact_id,
    p_account_id, p_amount, p_description, p_is_emi, p_type,
    p_transaction_date, p_new_shadow_contact_name
  );
$$;
REVOKE ALL ON FUNCTION public.process_p2p_transaction(
  uuid,uuid,uuid,uuid,uuid,numeric,text,boolean,text,timestamptz,text
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.process_p2p_transaction(
  uuid,uuid,uuid,uuid,uuid,numeric,text,boolean,text,timestamptz,text
) TO authenticated;

-- Acceptance posts both participants' mirrored ledger entries at the original
-- occurrence date selected by the creator, not at the later approval time.
CREATE OR REPLACE FUNCTION private.accept_p2p_request(
  p_obligation_id uuid,
  p_receiver_user_id uuid,
  p_receiver_account_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, private, pg_temp
AS $$
DECLARE
  v_user uuid := private.require_user();
  v_obligation public.obligations%ROWTYPE;
  v_creator_transaction_id uuid;
  v_receiver_transaction_id uuid;
BEGIN
  IF p_receiver_user_id IS DISTINCT FROM v_user THEN
    RAISE EXCEPTION 'Caller cannot act for another user' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_obligation
    FROM public.obligations
   WHERE id = p_obligation_id
     AND owner_id <> v_user
     AND (creditor_profile_id = v_user OR debtor_profile_id = v_user)
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request unavailable' USING ERRCODE = '42501';
  END IF;
  PERFORM private.require_account(v_user, p_receiver_account_id);
  PERFORM private.require_account(v_obligation.owner_id, v_obligation.initiator_account_id);

  IF v_obligation.status = 'ACCEPTED'
     AND v_obligation.receiver_account_id = p_receiver_account_id THEN
    RETURN;
  END IF;
  IF v_obligation.status IS DISTINCT FROM 'PENDING_APPROVAL' THEN
    RAISE EXCEPTION 'Request is not pending' USING ERRCODE = '42501';
  END IF;
  PERFORM private.require_amount(v_obligation.amount);

  INSERT INTO public.transactions (
    owner_id, initiator_profile_id, from_account_id, to_account_id,
    amount, description, status, tagged_profile_id, created_at
  ) VALUES (
    v_obligation.owner_id, v_obligation.owner_id,
    CASE WHEN v_obligation.type = 'lent' THEN v_obligation.initiator_account_id ELSE NULL END,
    CASE WHEN v_obligation.type = 'borrowed' THEN v_obligation.initiator_account_id ELSE NULL END,
    v_obligation.amount, 'P2P: ' || v_obligation.description, 'COMPLETED', v_user,
    v_obligation.created_at
  ) RETURNING id INTO v_creator_transaction_id;

  INSERT INTO public.transactions (
    owner_id, initiator_profile_id, from_account_id, to_account_id,
    amount, description, status, tagged_profile_id, created_at
  ) VALUES (
    v_user, v_user,
    CASE WHEN v_obligation.type = 'lent' THEN NULL ELSE p_receiver_account_id END,
    CASE WHEN v_obligation.type = 'lent' THEN p_receiver_account_id ELSE NULL END,
    v_obligation.amount, 'P2P: ' || v_obligation.description, 'COMPLETED',
    v_obligation.owner_id, v_obligation.created_at
  ) RETURNING id INTO v_receiver_transaction_id;

  UPDATE public.obligations
     SET status = 'ACCEPTED',
         related_transaction_id = v_creator_transaction_id,
         receiver_account_id = p_receiver_account_id
   WHERE id = p_obligation_id;
END;
$$;
REVOKE ALL ON FUNCTION private.accept_p2p_request(uuid,uuid,uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.accept_p2p_request(uuid,uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.accept_p2p_request(
  p_obligation_id uuid,
  p_receiver_user_id uuid,
  p_receiver_account_id uuid
) RETURNS void
LANGUAGE sql SECURITY INVOKER
SET search_path = pg_catalog, public, private, pg_temp
AS $$
  SELECT private.accept_p2p_request(
    p_obligation_id, p_receiver_user_id, p_receiver_account_id
  );
$$;
REVOKE ALL ON FUNCTION public.accept_p2p_request(uuid,uuid,uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.accept_p2p_request(uuid,uuid,uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

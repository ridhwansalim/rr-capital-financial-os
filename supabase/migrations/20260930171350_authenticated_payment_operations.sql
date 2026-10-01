-- Preserve existing RPC signatures and P2P flows. Privileged implementations
-- live outside the exposed API schema and validate identity and ownership.
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA private TO authenticated;

CREATE OR REPLACE FUNCTION private.require_user() RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE u uuid := auth.uid();
BEGIN
 IF u IS NULL OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id=u) THEN
   RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501';
 END IF;
 RETURN u;
END $$;
REVOKE ALL ON FUNCTION private.require_user() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.require_user() TO authenticated;

CREATE OR REPLACE FUNCTION private.require_account(p_owner uuid,p_account uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
 IF p_account IS NULL OR NOT EXISTS (SELECT 1 FROM public.accounts WHERE id=p_account AND owner_id=p_owner) THEN
   RAISE EXCEPTION 'Account does not belong to the participant' USING ERRCODE='42501';
 END IF;
END $$;
REVOKE ALL ON FUNCTION private.require_account(uuid,uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.require_amount(p_amount numeric) RETURNS void
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
 IF p_amount IS NULL OR p_amount<=0 OR p_amount>9999999999.99
    OR p_amount<>round(p_amount,2) THEN
   RAISE EXCEPTION 'Amount must be positive, finite, and have at most two decimal places' USING ERRCODE='22023';
 END IF;
END $$;
REVOKE ALL ON FUNCTION private.require_amount(numeric) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.require_counterparty(p_owner uuid,p_profile uuid,p_contact uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
 IF (p_profile IS NULL)=(p_contact IS NULL) THEN
   RAISE EXCEPTION 'Choose one registered user or shadow contact' USING ERRCODE='22023';
 END IF;
 IF p_profile IS NOT NULL AND (p_profile=p_owner OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_profile)) THEN
   RAISE EXCEPTION 'Invalid counterparty' USING ERRCODE='22023';
 END IF;
 IF p_contact IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.contacts WHERE id=p_contact AND owner_id=p_owner) THEN
   RAISE EXCEPTION 'Contact does not belong to you' USING ERRCODE='42501';
 END IF;
END $$;
REVOKE ALL ON FUNCTION private.require_counterparty(uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.process_p2p_transaction(p_owner_id uuid, p_counterparty_profile_id uuid, p_shadow_contact_id uuid, p_account_id uuid, p_amount numeric, p_description text, p_is_emi boolean, p_type text, p_transaction_date timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE
    v_transaction_id UUID;
    v_creditor_id UUID;
    v_debtor_id UUID;
BEGIN

    IF p_owner_id IS DISTINCT FROM private.require_user() THEN
      RAISE EXCEPTION 'Caller cannot act for another user' USING ERRCODE='42501';
    END IF;
    PERFORM private.require_account(p_owner_id,p_account_id);
    PERFORM private.require_counterparty(p_owner_id,p_counterparty_profile_id,p_shadow_contact_id);
    PERFORM private.require_amount(p_amount);
    IF p_type IS NULL OR p_type NOT IN ('lent','borrowed') THEN
      RAISE EXCEPTION 'Invalid debt direction' USING ERRCODE='22023';
    END IF;
    IF p_type = 'lent' THEN
        v_creditor_id := p_owner_id;
        v_debtor_id := p_counterparty_profile_id;
    ELSE
        v_creditor_id := p_counterparty_profile_id;
        v_debtor_id := p_owner_id;
    END IF;

    IF p_counterparty_profile_id IS NOT NULL THEN
        -- REGISTERED USER: Do NOT move money yet. Just create the PENDING proposal.
        INSERT INTO obligations (
            owner_id, creditor_profile_id, debtor_profile_id, amount, total_amount,
            description, reason, status, is_emi, type, created_at, initiator_account_id
        ) VALUES (
            p_owner_id, v_creditor_id, v_debtor_id, p_amount, p_amount,
            p_description, p_description, 'PENDING_APPROVAL', p_is_emi, p_type, p_transaction_date, p_account_id
        );
    ELSE
        -- OFFLINE SHADOW CONTACT: Execute instantly because there is no 2nd user to accept it
        INSERT INTO transactions (
            owner_id, initiator_profile_id, from_account_id, to_account_id, amount, description, status, contact_id, created_at
        ) VALUES (
            p_owner_id, p_owner_id, CASE WHEN p_type = 'lent' THEN p_account_id ELSE NULL END, CASE WHEN p_type = 'borrowed' THEN p_account_id ELSE NULL END, p_amount, p_description, 'COMPLETED', p_shadow_contact_id, p_transaction_date
        ) RETURNING id INTO v_transaction_id;

        INSERT INTO obligations (
            owner_id, creditor_profile_id, debtor_profile_id, shadow_contact_id, amount, total_amount, description, reason, status, is_emi, related_transaction_id, type, created_at, initiator_account_id
        ) VALUES (
            p_owner_id, v_creditor_id, v_debtor_id, p_shadow_contact_id, p_amount, p_amount, p_description, p_description, 'ACCEPTED', p_is_emi, v_transaction_id, p_type, p_transaction_date, p_account_id
        );
    END IF;
END;
$function$;

REVOKE ALL ON FUNCTION private.process_p2p_transaction(p_owner_id uuid, p_counterparty_profile_id uuid, p_shadow_contact_id uuid, p_account_id uuid, p_amount numeric, p_description text, p_is_emi boolean, p_type text, p_transaction_date timestamp with time zone) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.process_p2p_transaction(p_owner_id uuid, p_counterparty_profile_id uuid, p_shadow_contact_id uuid, p_account_id uuid, p_amount numeric, p_description text, p_is_emi boolean, p_type text, p_transaction_date timestamp with time zone) TO authenticated;
CREATE OR REPLACE FUNCTION public.process_p2p_transaction(p_owner_id uuid, p_counterparty_profile_id uuid, p_shadow_contact_id uuid, p_account_id uuid, p_amount numeric, p_description text, p_is_emi boolean, p_type text, p_transaction_date timestamp with time zone) RETURNS void
LANGUAGE sql SECURITY INVOKER SET search_path = public, pg_temp AS $wrapper$
 SELECT private.process_p2p_transaction(p_owner_id,p_counterparty_profile_id,p_shadow_contact_id,p_account_id,p_amount,p_description,p_is_emi,p_type,p_transaction_date);
$wrapper$;
REVOKE ALL ON FUNCTION public.process_p2p_transaction(p_owner_id uuid, p_counterparty_profile_id uuid, p_shadow_contact_id uuid, p_account_id uuid, p_amount numeric, p_description text, p_is_emi boolean, p_type text, p_transaction_date timestamp with time zone) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.process_p2p_transaction(p_owner_id uuid, p_counterparty_profile_id uuid, p_shadow_contact_id uuid, p_account_id uuid, p_amount numeric, p_description text, p_is_emi boolean, p_type text, p_transaction_date timestamp with time zone) TO authenticated;

CREATE OR REPLACE FUNCTION private.log_proxy_debt(p_owner_id uuid, p_borrower_profile_id uuid, p_shadow_contact_id uuid, p_account_id uuid, p_amount numeric, p_description text, p_is_emi boolean, p_transaction_date timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE
    v_transaction_id UUID;
BEGIN

    IF p_owner_id IS DISTINCT FROM private.require_user() THEN
      RAISE EXCEPTION 'Caller cannot act for another user' USING ERRCODE='42501';
    END IF;
    PERFORM private.require_account(p_owner_id,p_account_id);
    PERFORM private.require_counterparty(p_owner_id,p_borrower_profile_id,p_shadow_contact_id);
    PERFORM private.require_amount(p_amount);
    INSERT INTO transactions (
        owner_id, initiator_profile_id, from_account_id, amount, description, status, tagged_profile_id, contact_id, created_at
    ) VALUES (
        p_owner_id, p_owner_id, p_account_id, p_amount, 'Proxy Purchase: ' || p_description, 'COMPLETED', p_borrower_profile_id, p_shadow_contact_id, p_transaction_date
    ) RETURNING id INTO v_transaction_id;

    INSERT INTO obligations (
        owner_id, creditor_profile_id, debtor_profile_id, shadow_contact_id, amount, total_amount, description, status, is_emi, related_transaction_id, created_at, type
    ) VALUES (
        p_owner_id, p_owner_id, p_borrower_profile_id, p_shadow_contact_id, p_amount, p_amount, p_description, 'PENDING', p_is_emi, v_transaction_id, p_transaction_date, 'lent'
    );
END;
$function$;

REVOKE ALL ON FUNCTION private.log_proxy_debt(p_owner_id uuid, p_borrower_profile_id uuid, p_shadow_contact_id uuid, p_account_id uuid, p_amount numeric, p_description text, p_is_emi boolean, p_transaction_date timestamp with time zone) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.log_proxy_debt(p_owner_id uuid, p_borrower_profile_id uuid, p_shadow_contact_id uuid, p_account_id uuid, p_amount numeric, p_description text, p_is_emi boolean, p_transaction_date timestamp with time zone) TO authenticated;
CREATE OR REPLACE FUNCTION public.log_proxy_debt(p_owner_id uuid, p_borrower_profile_id uuid, p_shadow_contact_id uuid, p_account_id uuid, p_amount numeric, p_description text, p_is_emi boolean, p_transaction_date timestamp with time zone) RETURNS void
LANGUAGE sql SECURITY INVOKER SET search_path = public, pg_temp AS $wrapper$
 SELECT private.log_proxy_debt(p_owner_id,p_borrower_profile_id,p_shadow_contact_id,p_account_id,p_amount,p_description,p_is_emi,p_transaction_date);
$wrapper$;
REVOKE ALL ON FUNCTION public.log_proxy_debt(p_owner_id uuid, p_borrower_profile_id uuid, p_shadow_contact_id uuid, p_account_id uuid, p_amount numeric, p_description text, p_is_emi boolean, p_transaction_date timestamp with time zone) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_proxy_debt(p_owner_id uuid, p_borrower_profile_id uuid, p_shadow_contact_id uuid, p_account_id uuid, p_amount numeric, p_description text, p_is_emi boolean, p_transaction_date timestamp with time zone) TO authenticated;

CREATE OR REPLACE FUNCTION private.propose_p2p_emi(p_owner_id uuid, p_counterparty_profile_id uuid, p_shadow_contact_id uuid, p_account_id uuid, p_type text, p_name text, p_total_principal numeric, p_processing_fee numeric, p_monthly_amount numeric, p_start_date date, p_end_date date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE
    v_emi_id UUID;
BEGIN

    IF p_owner_id IS DISTINCT FROM private.require_user() THEN
      RAISE EXCEPTION 'Caller cannot act for another user' USING ERRCODE='42501';
    END IF;
    PERFORM private.require_account(p_owner_id,p_account_id);
    PERFORM private.require_counterparty(p_owner_id,p_counterparty_profile_id,p_shadow_contact_id);
    PERFORM private.require_amount(p_total_principal);
    PERFORM private.require_amount(p_monthly_amount);
    IF p_processing_fee IS NULL OR p_processing_fee<0 OR p_processing_fee>9999999999.99 OR p_processing_fee<>round(p_processing_fee,2) THEN
      RAISE EXCEPTION 'Invalid processing fee' USING ERRCODE='22023';
    END IF;
    IF p_start_date IS NULL OR p_end_date IS NULL OR p_end_date<p_start_date THEN
      RAISE EXCEPTION 'Invalid EMI date range' USING ERRCODE='22023';
    END IF;
    IF p_type IS NULL OR p_type NOT IN ('lent','borrowed') THEN
      RAISE EXCEPTION 'Invalid debt direction' USING ERRCODE='22023';
    END IF;
    INSERT INTO recurring_emis (
        owner_id, type, counterparty_profile_id, shadow_contact_id, status,
        name, total_principal, processing_fee, amount, start_date, end_date, initiator_account_id
    ) VALUES (
        p_owner_id, p_type, p_counterparty_profile_id, p_shadow_contact_id, 'PENDING_APPROVAL',
        p_name, p_total_principal, p_processing_fee, p_monthly_amount, p_start_date, p_end_date, p_account_id
    ) RETURNING id INTO v_emi_id;

    -- If this is an offline shadow contact, auto-accept it immediately on behalf of the owner
    IF p_counterparty_profile_id IS NULL THEN
        PERFORM private.accept_p2p_emi(v_emi_id, p_owner_id);
    END IF;
END;
$function$;

REVOKE ALL ON FUNCTION private.propose_p2p_emi(p_owner_id uuid, p_counterparty_profile_id uuid, p_shadow_contact_id uuid, p_account_id uuid, p_type text, p_name text, p_total_principal numeric, p_processing_fee numeric, p_monthly_amount numeric, p_start_date date, p_end_date date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.propose_p2p_emi(p_owner_id uuid, p_counterparty_profile_id uuid, p_shadow_contact_id uuid, p_account_id uuid, p_type text, p_name text, p_total_principal numeric, p_processing_fee numeric, p_monthly_amount numeric, p_start_date date, p_end_date date) TO authenticated;
CREATE OR REPLACE FUNCTION public.propose_p2p_emi(p_owner_id uuid, p_counterparty_profile_id uuid, p_shadow_contact_id uuid, p_account_id uuid, p_type text, p_name text, p_total_principal numeric, p_processing_fee numeric, p_monthly_amount numeric, p_start_date date, p_end_date date) RETURNS void
LANGUAGE sql SECURITY INVOKER SET search_path = public, pg_temp AS $wrapper$
 SELECT private.propose_p2p_emi(p_owner_id,p_counterparty_profile_id,p_shadow_contact_id,p_account_id,p_type,p_name,p_total_principal,p_processing_fee,p_monthly_amount,p_start_date,p_end_date);
$wrapper$;
REVOKE ALL ON FUNCTION public.propose_p2p_emi(p_owner_id uuid, p_counterparty_profile_id uuid, p_shadow_contact_id uuid, p_account_id uuid, p_type text, p_name text, p_total_principal numeric, p_processing_fee numeric, p_monthly_amount numeric, p_start_date date, p_end_date date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.propose_p2p_emi(p_owner_id uuid, p_counterparty_profile_id uuid, p_shadow_contact_id uuid, p_account_id uuid, p_type text, p_name text, p_total_principal numeric, p_processing_fee numeric, p_monthly_amount numeric, p_start_date date, p_end_date date) TO authenticated;

CREATE OR REPLACE FUNCTION private.accept_p2p_emi(p_emi_id uuid, p_receiver_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE
    v_emi recurring_emis%ROWTYPE;
    v_creditor_id UUID;
    v_debtor_id UUID;
    v_obligation_id UUID;
    v_total_debt NUMERIC;
BEGIN
    IF p_receiver_user_id IS DISTINCT FROM private.require_user() THEN
      RAISE EXCEPTION 'Caller cannot act for another user' USING ERRCODE='42501';
    END IF;
    SELECT * INTO v_emi FROM recurring_emis WHERE id = p_emi_id AND (counterparty_profile_id=p_receiver_user_id OR (counterparty_profile_id IS NULL AND owner_id=p_receiver_user_id)) FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'EMI request unavailable' USING ERRCODE='42501'; END IF;
    IF v_emi.status='ACTIVE' AND v_emi.related_obligation_id IS NOT NULL THEN RETURN; END IF;
    IF v_emi.status IS DISTINCT FROM 'PENDING_APPROVAL' THEN RAISE EXCEPTION 'EMI request is not pending'; END IF;
    PERFORM private.require_account(v_emi.owner_id,v_emi.initiator_account_id);

    -- Map Creditor vs Debtor
    IF v_emi.type = 'lent' THEN
        v_creditor_id := v_emi.owner_id;
        v_debtor_id := v_emi.counterparty_profile_id;
    ELSE
        v_creditor_id := v_emi.counterparty_profile_id;
        v_debtor_id := v_emi.owner_id;
    END IF;

    v_total_debt := v_emi.total_principal + v_emi.processing_fee;

    -- A: Log the Processing Fee Expense on the Credit Card instantly (if applicable)
    IF v_emi.processing_fee > 0 AND v_emi.initiator_account_id IS NOT NULL THEN
        INSERT INTO transactions (
            owner_id, initiator_profile_id, from_account_id, amount, description, status, created_at
        ) VALUES (
            v_emi.owner_id, v_emi.owner_id, v_emi.initiator_account_id, v_emi.processing_fee,
            'Bank Processing Fee: ' || v_emi.name, 'COMPLETED', NOW()
        );
    END IF;

    -- B: Create the Master Obligation (Total Debt Owed)
    INSERT INTO obligations (
        owner_id, creditor_profile_id, debtor_profile_id, shadow_contact_id,
        amount, total_amount, description, reason, status, is_emi, type, created_at
    ) VALUES (
        v_emi.owner_id, v_creditor_id, v_debtor_id, v_emi.shadow_contact_id,
        v_total_debt, v_total_debt, 'EMI Master Debt: ' || v_emi.name, 'EMI Master Debt: ' || v_emi.name,
        'PENDING', true, v_emi.type, NOW()
    ) RETURNING id INTO v_obligation_id;

    -- C: Activate the EMI schedule in the Calendar
    UPDATE recurring_emis
    SET status = 'ACTIVE', related_obligation_id = v_obligation_id
    WHERE id = p_emi_id;
END;
$function$;

REVOKE ALL ON FUNCTION private.accept_p2p_emi(p_emi_id uuid, p_receiver_user_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.accept_p2p_emi(p_emi_id uuid, p_receiver_user_id uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.accept_p2p_emi(p_emi_id uuid, p_receiver_user_id uuid) RETURNS void
LANGUAGE sql SECURITY INVOKER SET search_path = public, pg_temp AS $wrapper$
 SELECT private.accept_p2p_emi(p_emi_id,p_receiver_user_id);
$wrapper$;
REVOKE ALL ON FUNCTION public.accept_p2p_emi(p_emi_id uuid, p_receiver_user_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_p2p_emi(p_emi_id uuid, p_receiver_user_id uuid) TO authenticated;

CREATE OR REPLACE FUNCTION private.accept_p2p_request(p_obligation_id uuid, p_receiver_user_id uuid, p_receiver_account_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE
    v_ob obligations%ROWTYPE;
    v_initiator_tx UUID;
    v_receiver_tx UUID;
BEGIN
    IF p_receiver_user_id IS DISTINCT FROM private.require_user() THEN
      RAISE EXCEPTION 'Caller cannot act for another user' USING ERRCODE='42501';
    END IF;
    SELECT * INTO v_ob FROM obligations WHERE id = p_obligation_id AND owner_id<>p_receiver_user_id AND (creditor_profile_id=p_receiver_user_id OR debtor_profile_id=p_receiver_user_id) FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Request unavailable' USING ERRCODE='42501'; END IF;
    PERFORM private.require_account(p_receiver_user_id,p_receiver_account_id);
    PERFORM private.require_account(v_ob.owner_id,v_ob.initiator_account_id);
    IF v_ob.status='ACCEPTED' AND v_ob.receiver_account_id=p_receiver_account_id THEN RETURN; END IF;
    IF v_ob.status IS DISTINCT FROM 'PENDING_APPROVAL' THEN RAISE EXCEPTION 'Request is not pending'; END IF;
    PERFORM private.require_amount(v_ob.amount);

    -- Create Ridhwan's Transaction (e.g., Money leaves HDFC)
    INSERT INTO transactions (
        owner_id, initiator_profile_id, from_account_id, to_account_id, amount, description, status, tagged_profile_id, created_at
    ) VALUES (
        v_ob.owner_id, v_ob.owner_id,
        CASE WHEN v_ob.type = 'lent' THEN v_ob.initiator_account_id ELSE NULL END,
        CASE WHEN v_ob.type = 'borrowed' THEN v_ob.initiator_account_id ELSE NULL END,
        v_ob.amount, 'P2P: ' || v_ob.description, 'COMPLETED', p_receiver_user_id, NOW()
    ) RETURNING id INTO v_initiator_tx;

    -- Create Ruksana's Transaction (e.g., Money enters SBI)
    INSERT INTO transactions (
        owner_id, initiator_profile_id, from_account_id, to_account_id, amount, description, status, tagged_profile_id, created_at
    ) VALUES (
        p_receiver_user_id, p_receiver_user_id,
        CASE WHEN v_ob.type = 'lent' THEN NULL ELSE p_receiver_account_id END,
        CASE WHEN v_ob.type = 'lent' THEN p_receiver_account_id ELSE NULL END,
        v_ob.amount, 'P2P: ' || v_ob.description, 'COMPLETED', v_ob.owner_id, NOW()
    ) RETURNING id INTO v_receiver_tx;

    -- Lock the Obligation to Accepted and save Ruksana's account choice
    UPDATE obligations
    SET status = 'ACCEPTED',
        related_transaction_id = v_initiator_tx,
        receiver_account_id = p_receiver_account_id
    WHERE id = p_obligation_id;
END;
$function$;

REVOKE ALL ON FUNCTION private.accept_p2p_request(p_obligation_id uuid, p_receiver_user_id uuid, p_receiver_account_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.accept_p2p_request(p_obligation_id uuid, p_receiver_user_id uuid, p_receiver_account_id uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.accept_p2p_request(p_obligation_id uuid, p_receiver_user_id uuid, p_receiver_account_id uuid) RETURNS void
LANGUAGE sql SECURITY INVOKER SET search_path = public, pg_temp AS $wrapper$
 SELECT private.accept_p2p_request(p_obligation_id,p_receiver_user_id,p_receiver_account_id);
$wrapper$;
REVOKE ALL ON FUNCTION public.accept_p2p_request(p_obligation_id uuid, p_receiver_user_id uuid, p_receiver_account_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_p2p_request(p_obligation_id uuid, p_receiver_user_id uuid, p_receiver_account_id uuid) TO authenticated;

CREATE OR REPLACE FUNCTION private.accept_settlement(p_settlement_id uuid, p_destination_account_id uuid, p_receiver_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE
    v_settlement settlements%ROWTYPE;
    v_ob obligations%ROWTYPE;
    v_emi recurring_emis%ROWTYPE;
BEGIN
    IF p_receiver_user_id IS DISTINCT FROM private.require_user() THEN
      RAISE EXCEPTION 'Caller cannot act for another user' USING ERRCODE='42501';
    END IF;
    SELECT * INTO v_settlement FROM settlements WHERE id = p_settlement_id AND counterparty_profile_id=p_receiver_user_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Settlement unavailable' USING ERRCODE='42501'; END IF;
    PERFORM private.require_account(p_receiver_user_id,p_destination_account_id);
    PERFORM private.require_account(v_settlement.initiator_id,v_settlement.source_account_id);
    IF v_settlement.status='COMPLETED' AND v_settlement.destination_account_id=p_destination_account_id THEN RETURN; END IF;
    IF v_settlement.status IS DISTINCT FROM 'PENDING_APPROVAL' THEN RAISE EXCEPTION 'Settlement is not pending'; END IF;
    PERFORM private.require_amount(v_settlement.amount);

    SELECT * INTO v_ob FROM obligations WHERE id = v_settlement.obligation_id FOR UPDATE;
    IF NOT FOUND OR v_ob.creditor_profile_id IS DISTINCT FROM p_receiver_user_id
       OR v_ob.debtor_profile_id IS DISTINCT FROM v_settlement.initiator_id THEN
      RAISE EXCEPTION 'Settlement participants do not match debt' USING ERRCODE='42501';
    END IF;
    IF v_ob.status NOT IN ('ACCEPTED','PENDING') OR v_settlement.amount>v_ob.amount THEN
      RAISE EXCEPTION 'Settlement exceeds outstanding debt or debt is inactive' USING ERRCODE='22023';
    END IF;

    -- 1. Deduct money from Payer
    INSERT INTO transactions (
        owner_id, initiator_profile_id, from_account_id, amount, description, status, tagged_profile_id, created_at
    ) VALUES (
        v_settlement.initiator_id, v_settlement.initiator_id, v_settlement.source_account_id,
        v_settlement.amount, 'Repayment Sent: ' || v_ob.description, 'COMPLETED', p_receiver_user_id, NOW()
    );

    -- 2. Add money to Receiver
    INSERT INTO transactions (
        owner_id, initiator_profile_id, to_account_id, amount, description, status, tagged_profile_id, created_at
    ) VALUES (
        p_receiver_user_id, p_receiver_user_id, p_destination_account_id,
        v_settlement.amount, 'Repayment Received: ' || v_ob.description, 'COMPLETED', v_settlement.initiator_id, NOW()
    );

    -- 3. Reduce Master Debt Balance
    UPDATE obligations
    SET amount = amount - v_settlement.amount,
        status = CASE WHEN (amount - v_settlement.amount) <= 0 THEN 'SETTLED' ELSE 'PENDING' END
    WHERE id = v_settlement.obligation_id;

    -- 4. Mark Settlement as Completed
    UPDATE settlements
    SET status = 'COMPLETED', destination_account_id = p_destination_account_id
    WHERE id = p_settlement_id;

    -- 5. THE FIX: Atomic Dual-Progress Sync
    SELECT * INTO v_emi FROM recurring_emis WHERE related_obligation_id = v_ob.id;
    IF FOUND THEN
        IF v_emi.type = 'lent' THEN
            UPDATE recurring_emis
            SET counterparty_months_paid = COALESCE(counterparty_months_paid, 0) + 1,
                owner_months_paid = CASE WHEN p_destination_account_id = initiator_account_id THEN COALESCE(owner_months_paid, 0) + 1 ELSE owner_months_paid END
            WHERE id = v_emi.id;
        ELSIF v_emi.type = 'borrowed' THEN
            UPDATE recurring_emis
            SET owner_months_paid = COALESCE(owner_months_paid, 0) + 1,
                counterparty_months_paid = CASE WHEN p_destination_account_id = initiator_account_id THEN COALESCE(counterparty_months_paid, 0) + 1 ELSE counterparty_months_paid END
            WHERE id = v_emi.id;
        END IF;
    END IF;
END;
$function$;

REVOKE ALL ON FUNCTION private.accept_settlement(p_settlement_id uuid, p_destination_account_id uuid, p_receiver_user_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.accept_settlement(p_settlement_id uuid, p_destination_account_id uuid, p_receiver_user_id uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.accept_settlement(p_settlement_id uuid, p_destination_account_id uuid, p_receiver_user_id uuid) RETURNS void
LANGUAGE sql SECURITY INVOKER SET search_path = public, pg_temp AS $wrapper$
 SELECT private.accept_settlement(p_settlement_id,p_destination_account_id,p_receiver_user_id);
$wrapper$;
REVOKE ALL ON FUNCTION public.accept_settlement(p_settlement_id uuid, p_destination_account_id uuid, p_receiver_user_id uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_settlement(p_settlement_id uuid, p_destination_account_id uuid, p_receiver_user_id uuid) TO authenticated;

-- Keep the existing search response shape; never return email addresses.
CREATE OR REPLACE FUNCTION private.search_users(search_term text)
RETURNS TABLE(id uuid,username text,full_name text,email text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE u uuid := private.require_user();
BEGIN
 IF length(btrim(search_term))<2 OR length(search_term)>100 THEN RETURN; END IF;
 RETURN QUERY SELECT p.id, p.username,p.full_name,NULL::text FROM public.profiles p
 WHERE p.id<>u AND (position(lower(btrim(search_term)) in lower(p.username))>0
 OR position(lower(btrim(search_term)) in lower(p.full_name))>0)
 ORDER BY p.username NULLS LAST,p.id LIMIT 10;
END $$;
CREATE OR REPLACE FUNCTION public.search_users(search_term text)
RETURNS TABLE(id uuid,username text,full_name text,email text)
LANGUAGE sql SECURITY INVOKER SET search_path=public,pg_temp AS $$
 SELECT * FROM private.search_users(search_term);
$$;
REVOKE ALL ON FUNCTION private.search_users(text),public.search_users(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.search_users(text),public.search_users(text) TO authenticated;
NOTIFY pgrst, 'reload schema';
;

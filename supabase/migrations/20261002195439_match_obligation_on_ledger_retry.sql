-- A repeated ledger request must preserve its debt-payment association.
-- The previous boolean comparison accepted a retry that omitted the original
-- obligation_id because NULL equality made NOT EXISTS true for both cases.
CREATE OR REPLACE FUNCTION private.post_ledger_transaction_checked(
  p_request_id uuid, p_from_account_id uuid, p_to_account_id uuid,
  p_amount numeric, p_fee_amount numeric, p_description text,
  p_created_at timestamptz, p_tagged_profile_id uuid,
  p_contact_id uuid, p_obligation_id uuid, p_new_contact_name text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, private, pg_temp AS $$
DECLARE
  v_owner uuid := private.require_user();
  v_existing public.transactions%ROWTYPE;
  v_metadata private.ledger_request_metadata%ROWTYPE;
  v_transaction_id uuid;
BEGIN
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'Request ID is required' USING ERRCODE = '22023';
  END IF;

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
       OR (p_obligation_id IS NULL AND EXISTS (
             SELECT 1 FROM public.obligation_payments op
              WHERE op.transaction_id = v_existing.id
           ))
       OR (p_obligation_id IS NOT NULL AND NOT EXISTS (
             SELECT 1 FROM public.obligation_payments op
              WHERE op.transaction_id = v_existing.id
                AND op.obligation_id = p_obligation_id
           )) THEN
      RAISE EXCEPTION 'Request ID was already used for different transaction data'
        USING ERRCODE = '23505';
    END IF;
    SELECT * INTO v_metadata FROM private.ledger_request_metadata
     WHERE owner_id = v_owner AND request_id = p_request_id;
    IF FOUND AND (v_metadata.tagged_profile_id IS DISTINCT FROM p_tagged_profile_id
                  OR v_metadata.contact_id IS DISTINCT FROM p_contact_id) THEN
      RAISE EXCEPTION 'Request ID was already used for different transaction data'
        USING ERRCODE = '23505';
    END IF;
    RETURN v_existing.id;
  END IF;

  v_transaction_id := private.post_ledger_transaction(
    p_request_id, p_from_account_id, p_to_account_id, p_amount,
    p_fee_amount, p_description, p_created_at, p_tagged_profile_id,
    p_contact_id, p_obligation_id, p_new_contact_name
  );
  INSERT INTO private.ledger_request_metadata(owner_id, request_id, tagged_profile_id, contact_id)
    VALUES (v_owner, p_request_id, p_tagged_profile_id, p_contact_id);
  RETURN v_transaction_id;
END;
$$;

REVOKE ALL ON FUNCTION private.post_ledger_transaction_checked(
  uuid,uuid,uuid,numeric,numeric,text,timestamptz,uuid,uuid,uuid,text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.post_ledger_transaction_checked(
  uuid,uuid,uuid,numeric,numeric,text,timestamptz,uuid,uuid,uuid,text
) TO authenticated;

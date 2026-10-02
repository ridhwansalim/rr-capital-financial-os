-- Ledger retry integrity and least-privilege API grants.
-- A retried offline request must match every field that can affect ownership
-- and peer/contact semantics, not only the financial amounts and endpoints.
-- Keep these original request values private because contact merging is allowed
-- to change the transaction's live tag/contact fields after posting.
CREATE TABLE IF NOT EXISTS private.ledger_request_metadata (
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  tagged_profile_id uuid,
  contact_id uuid,
  PRIMARY KEY (owner_id, request_id)
);
ALTER TABLE private.ledger_request_metadata ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.ledger_request_metadata FROM PUBLIC, anon, authenticated, service_role;

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

  -- Match post_ledger_transaction's lock key so comparisons stay serialized
  -- with both old clients and the underlying posting routine.
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

-- The lower-level function remains an internal implementation. Applications
-- reach it only through the checked public wrapper below.
REVOKE ALL ON FUNCTION private.post_ledger_transaction(
  uuid,uuid,uuid,numeric,numeric,text,timestamptz,uuid,uuid,uuid,text
) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.post_ledger_transaction(
  p_request_id uuid, p_from_account_id uuid, p_to_account_id uuid,
  p_amount numeric, p_fee_amount numeric, p_description text,
  p_created_at timestamptz, p_tagged_profile_id uuid DEFAULT NULL,
  p_contact_id uuid DEFAULT NULL, p_obligation_id uuid DEFAULT NULL,
  p_new_contact_name text DEFAULT NULL
) RETURNS uuid LANGUAGE sql SECURITY INVOKER
SET search_path = pg_catalog, public, private, pg_temp AS $$
  SELECT private.post_ledger_transaction_checked(
    p_request_id, p_from_account_id, p_to_account_id, p_amount,
    p_fee_amount, p_description, p_created_at, p_tagged_profile_id,
    p_contact_id, p_obligation_id, p_new_contact_name
  );
$$;
REVOKE ALL ON FUNCTION public.post_ledger_transaction(
  uuid,uuid,uuid,numeric,numeric,text,timestamptz,uuid,uuid,uuid,text
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.post_ledger_transaction(
  uuid,uuid,uuid,numeric,numeric,text,timestamptz,uuid,uuid,uuid,text
) TO authenticated;

-- The balance view is read-only for app users. Its security-invoker setting
-- ensures its underlying account/transaction SELECTs remain subject to RLS.
REVOKE ALL ON TABLE public.account_balances FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.account_balances FROM authenticated;
GRANT SELECT ON TABLE public.account_balances TO authenticated;

-- Trigger guards are invoked by PostgreSQL, never by client RPC calls.
REVOKE ALL ON FUNCTION private.protect_chitti_state()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.protect_emi_bank_progress()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.protect_settlement_state()
  FROM PUBLIC, anon, authenticated, service_role;

-- Categories remain owner-manageable, but API roles receive no table-wide
-- privileges and anonymous users receive no access.
REVOKE ALL ON TABLE public.transaction_categories FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.transaction_categories FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.transaction_categories TO authenticated;

-- Account CRUD remains available through owner-scoped RLS, but table-wide
-- privileges are not row-scoped by RLS and are unnecessary for the app.
REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE public.accounts FROM authenticated;

-- The historical baseline accidentally made every future public function
-- executable by API roles by default. New functions must be explicitly granted.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';

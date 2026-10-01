-- Per-owner categories are metadata around immutable ledger facts. A category
-- can be reassigned without altering the amount, accounts, or posting time.
CREATE TABLE public.transaction_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 48),
  color text NOT NULL DEFAULT '#64748b' CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT transaction_categories_owner_name_key UNIQUE(owner_id, name),
  CONSTRAINT transaction_categories_id_owner_key UNIQUE(id, owner_id)
);

ALTER TABLE public.transaction_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY transaction_categories_select_own ON public.transaction_categories
  FOR SELECT TO authenticated USING (owner_id = (SELECT auth.uid()));
CREATE POLICY transaction_categories_insert_own ON public.transaction_categories
  FOR INSERT TO authenticated WITH CHECK (owner_id = (SELECT auth.uid()));
CREATE POLICY transaction_categories_update_own ON public.transaction_categories
  FOR UPDATE TO authenticated USING (owner_id = (SELECT auth.uid()))
  WITH CHECK (owner_id = (SELECT auth.uid()));
CREATE POLICY transaction_categories_delete_own ON public.transaction_categories
  FOR DELETE TO authenticated USING (owner_id = (SELECT auth.uid()));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.transaction_categories TO authenticated;
REVOKE ALL ON public.transaction_categories FROM anon;

ALTER TABLE public.transactions ADD COLUMN category_id uuid;
ALTER TABLE public.transactions ADD CONSTRAINT transactions_category_owner_fkey
  FOREIGN KEY (category_id, owner_id)
  REFERENCES public.transaction_categories(id, owner_id) ON DELETE SET NULL (category_id);
CREATE INDEX transactions_owner_category_date_idx
  ON public.transactions(owner_id, category_id, created_at DESC)
  WHERE status = 'COMPLETED';

-- Direct table UPDATE remains revoked. This narrow RPC only changes metadata
-- and verifies both rows belong to the signed-in user.
CREATE OR REPLACE FUNCTION private.set_transaction_category(
  p_transaction_id uuid, p_category_id uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE v_user uuid := private.require_user();
BEGIN
  IF p_category_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.transaction_categories
     WHERE id = p_category_id AND owner_id = v_user
  ) THEN
    RAISE EXCEPTION 'Category is unavailable' USING ERRCODE = '42501';
  END IF;
  UPDATE public.transactions SET category_id = p_category_id
   WHERE id = p_transaction_id AND owner_id = v_user AND status = 'COMPLETED';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transaction is unavailable' USING ERRCODE = '42501';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION private.set_transaction_category(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.set_transaction_category(uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_transaction_category(
  p_transaction_id uuid, p_category_id uuid
) RETURNS void LANGUAGE sql SECURITY INVOKER
SET search_path = public, pg_temp AS $$
  SELECT private.set_transaction_category(p_transaction_id, p_category_id);
$$;
REVOKE ALL ON FUNCTION public.set_transaction_category(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_transaction_category(uuid,uuid) TO authenticated;

-- Corrections replace a mistaken ordinary entry while retaining its original
-- row and a reason. Transactions that already drive a debt, Chitti, or EMI
-- workflow cannot be rewritten by this general-purpose action.
CREATE TABLE private.transaction_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  original_transaction_id uuid NOT NULL UNIQUE REFERENCES public.transactions(id),
  replacement_transaction_id uuid UNIQUE REFERENCES public.transactions(id),
  request_id uuid UNIQUE,
  action text NOT NULL CHECK (action IN ('VOID', 'REPLACE')),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON private.transaction_corrections FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.require_correctable_transaction(p_transaction_id uuid)
RETURNS public.transactions LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, private, pg_temp AS $$
DECLARE v_user uuid := private.require_user(); v_tx public.transactions%ROWTYPE;
BEGIN
  SELECT * INTO v_tx FROM public.transactions
   WHERE id = p_transaction_id AND owner_id = v_user AND status = 'COMPLETED'
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Transaction is unavailable' USING ERRCODE = '42501'; END IF;
  IF EXISTS (SELECT 1 FROM public.obligation_payments WHERE transaction_id = p_transaction_id)
     OR EXISTS (SELECT 1 FROM public.obligations WHERE related_transaction_id = p_transaction_id)
     OR EXISTS (SELECT 1 FROM private.chitti_action_requests WHERE transaction_id = p_transaction_id)
     OR EXISTS (SELECT 1 FROM private.emi_bank_action_requests WHERE transaction_id = p_transaction_id)
     OR v_tx.description LIKE 'Repayment Sent:%'
     OR v_tx.description LIKE 'Repayment Received:%' THEN
    RAISE EXCEPTION 'This linked financial entry must be corrected in its original workflow'
      USING ERRCODE = '55000';
  END IF;
  RETURN v_tx;
END;
$$;
REVOKE ALL ON FUNCTION private.require_correctable_transaction(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.void_ledger_transaction(
  p_transaction_id uuid, p_reason text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, private, pg_temp AS $$
DECLARE v_user uuid := private.require_user();
BEGIN
  IF length(btrim(COALESCE(p_reason, ''))) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'A reason of 1 to 200 characters is required' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM private.transaction_corrections
              WHERE original_transaction_id = p_transaction_id AND owner_id = v_user) THEN
    RETURN;
  END IF;
  PERFORM private.require_correctable_transaction(p_transaction_id);
  UPDATE public.transactions SET status = 'VOIDED'
   WHERE id = p_transaction_id AND owner_id = v_user AND status = 'COMPLETED';
  INSERT INTO private.transaction_corrections(owner_id, original_transaction_id, action, reason)
    VALUES (v_user, p_transaction_id, 'VOID', btrim(p_reason));
END;
$$;
REVOKE ALL ON FUNCTION private.void_ledger_transaction(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.void_ledger_transaction(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.void_ledger_transaction(
  p_transaction_id uuid, p_reason text
) RETURNS void LANGUAGE sql SECURITY INVOKER
SET search_path = public, pg_temp AS $$
  SELECT private.void_ledger_transaction(p_transaction_id, p_reason);
$$;
REVOKE ALL ON FUNCTION public.void_ledger_transaction(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.void_ledger_transaction(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION private.correct_ledger_transaction(
  p_request_id uuid, p_transaction_id uuid, p_amount numeric,
  p_description text, p_created_at timestamptz, p_reason text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, private, pg_temp AS $$
DECLARE v_user uuid := private.require_user(); v_old public.transactions%ROWTYPE;
        v_existing private.transaction_corrections%ROWTYPE; v_replacement uuid;
BEGIN
  IF p_request_id IS NULL OR length(btrim(COALESCE(p_reason, ''))) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'A request ID and reason of 1 to 200 characters are required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_existing FROM private.transaction_corrections
   WHERE original_transaction_id = p_transaction_id AND owner_id = v_user;
  IF FOUND THEN
    IF v_existing.request_id = p_request_id AND v_existing.action = 'REPLACE' THEN
      SELECT * INTO v_old FROM public.transactions
       WHERE id = p_transaction_id AND owner_id = v_user;
      RETURN private.post_ledger_transaction(
        p_request_id, v_old.from_account_id, v_old.to_account_id,
        p_amount, COALESCE(v_old.fee_amount, 0), p_description, p_created_at,
        v_old.tagged_profile_id, v_old.contact_id, NULL, NULL
      );
    END IF;
    RAISE EXCEPTION 'This entry has already been corrected' USING ERRCODE = '55000';
  END IF;
  v_old := private.require_correctable_transaction(p_transaction_id);
  UPDATE public.transactions SET status = 'VOIDED'
   WHERE id = p_transaction_id AND owner_id = v_user AND status = 'COMPLETED';
  v_replacement := private.post_ledger_transaction(
    p_request_id, v_old.from_account_id, v_old.to_account_id,
    p_amount, COALESCE(v_old.fee_amount, 0), p_description, p_created_at,
    v_old.tagged_profile_id, v_old.contact_id, NULL, NULL
  );
  UPDATE public.transactions SET category_id = v_old.category_id WHERE id = v_replacement;
  INSERT INTO private.transaction_corrections(
    owner_id, original_transaction_id, replacement_transaction_id,
    request_id, action, reason
  ) VALUES (v_user, p_transaction_id, v_replacement, p_request_id, 'REPLACE', btrim(p_reason));
  RETURN v_replacement;
END;
$$;
REVOKE ALL ON FUNCTION private.correct_ledger_transaction(uuid,uuid,numeric,text,timestamptz,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.correct_ledger_transaction(uuid,uuid,numeric,text,timestamptz,text)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.correct_ledger_transaction(
  p_request_id uuid, p_transaction_id uuid, p_amount numeric,
  p_description text, p_created_at timestamptz, p_reason text
) RETURNS uuid LANGUAGE sql SECURITY INVOKER
SET search_path = public, pg_temp AS $$
  SELECT private.correct_ledger_transaction(
    p_request_id, p_transaction_id, p_amount, p_description, p_created_at, p_reason
  );
$$;
REVOKE ALL ON FUNCTION public.correct_ledger_transaction(uuid,uuid,numeric,text,timestamptz,text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.correct_ledger_transaction(uuid,uuid,numeric,text,timestamptz,text)
  TO authenticated;

NOTIFY pgrst, 'reload schema';

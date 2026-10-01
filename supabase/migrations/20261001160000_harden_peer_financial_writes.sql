-- Shared debt and repayment rows encode the financial history of both
-- participants. Keep reads in RLS, but route all writes through narrowly
-- scoped SECURITY DEFINER operations that validate the caller and transition.
-- A later historical CREATE OR REPLACE reset this validator's hardened path.
ALTER FUNCTION private.require_amount(numeric)
  SET search_path = pg_catalog, public, pg_temp;

REVOKE ALL ON TABLE public.obligations FROM anon, authenticated;
GRANT SELECT ON TABLE public.obligations TO authenticated;

DROP POLICY IF EXISTS "Obligations owner" ON public.obligations;
DROP POLICY IF EXISTS "Users can update shared obligations" ON public.obligations;
DROP POLICY IF EXISTS "Users can view shared obligations" ON public.obligations;
CREATE POLICY obligations_select_owner ON public.obligations
  FOR SELECT TO authenticated
  USING (owner_id = (SELECT auth.uid()));
CREATE POLICY obligations_select_shared ON public.obligations
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = creditor_profile_id
      OR (SELECT auth.uid()) = debtor_profile_id);

-- All current transaction writers already use validated SECURITY DEFINER RPCs
-- (including offline retries). Do not leave a second, non-idempotent REST path.
REVOKE ALL ON TABLE public.transactions FROM anon, authenticated;
GRANT SELECT ON TABLE public.transactions TO authenticated;
DROP POLICY IF EXISTS transactions_insert_own ON public.transactions;
DROP POLICY IF EXISTS transactions_update_own ON public.transactions;
DROP POLICY IF EXISTS transactions_delete_own ON public.transactions;

REVOKE ALL ON TABLE public.settlements FROM anon, authenticated;
GRANT SELECT ON TABLE public.settlements TO authenticated;
DROP POLICY IF EXISTS "Users can insert settlements" ON public.settlements;
DROP POLICY IF EXISTS "Users can update shared settlements" ON public.settlements;
DROP POLICY IF EXISTS "Users can view shared settlements" ON public.settlements;
CREATE POLICY settlements_select_participants ON public.settlements
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = initiator_id
      OR (SELECT auth.uid()) = counterparty_profile_id);

-- Personal EMI entries remain creatable by their owner. Updates, cancellation,
-- and peer request decisions go through the functions below. Cancellation is
-- a status transition so a recurring plan's history is retained.
REVOKE ALL ON TABLE public.recurring_emis FROM anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.recurring_emis TO authenticated;
DROP POLICY IF EXISTS "Enable all for EMI owner" ON public.recurring_emis;
DROP POLICY IF EXISTS "Users can update shared emis" ON public.recurring_emis;
DROP POLICY IF EXISTS "Users can view shared emis" ON public.recurring_emis;
CREATE POLICY recurring_emis_select_owner ON public.recurring_emis
  FOR SELECT TO authenticated USING (owner_id = (SELECT auth.uid()));
CREATE POLICY recurring_emis_select_counterparty ON public.recurring_emis
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = counterparty_profile_id);
CREATE POLICY recurring_emis_insert_personal ON public.recurring_emis
  FOR INSERT TO authenticated
  WITH CHECK (owner_id = (SELECT auth.uid())
          AND type = 'personal'
          AND counterparty_profile_id IS NULL
          AND shadow_contact_id IS NULL
          AND related_obligation_id IS NULL
          AND status = 'ACTIVE'
          AND COALESCE(owner_months_paid, 0) = 0
          AND COALESCE(counterparty_months_paid, 0) = 0);

CREATE OR REPLACE FUNCTION private.enforce_personal_emi_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF current_user IN ('postgres', 'service_role') THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT'
     AND current_user = 'authenticated'
     AND NEW.owner_id = (SELECT auth.uid())
     AND NEW.type = 'personal'
     AND NEW.counterparty_profile_id IS NULL
     AND NEW.shadow_contact_id IS NULL
     AND NEW.related_obligation_id IS NULL
     AND NEW.status = 'ACTIVE'
     AND NEW.amount > 0
     AND NEW.amount = round(NEW.amount, 2)
     AND (NEW.end_date IS NULL OR NEW.end_date >= NEW.start_date)
     AND COALESCE(NEW.owner_months_paid, 0) = 0
     AND COALESCE(NEW.counterparty_months_paid, 0) = 0 THEN
    IF NEW.initiator_account_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.accounts
       WHERE id = NEW.initiator_account_id AND owner_id = NEW.owner_id
    ) THEN
      RAISE EXCEPTION 'EMI account does not belong to you'
        USING ERRCODE = '42501';
    END IF;
    IF NEW.account_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.accounts
       WHERE id = NEW.account_id AND owner_id = NEW.owner_id
    ) THEN
      RAISE EXCEPTION 'EMI account does not belong to you'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Use the supported EMI action for this change'
    USING ERRCODE = '42501';
END;
$$;
REVOKE ALL ON FUNCTION private.enforce_personal_emi_write() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS enforce_personal_emi_write ON public.recurring_emis;
CREATE TRIGGER enforce_personal_emi_write
  BEFORE INSERT OR UPDATE OR DELETE ON public.recurring_emis
  FOR EACH ROW EXECUTE FUNCTION private.enforce_personal_emi_write();

CREATE OR REPLACE FUNCTION private.decline_p2p_obligation(
  p_obligation_id uuid, p_reason text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE v_user uuid := private.require_user();
BEGIN
  IF length(btrim(COALESCE(p_reason, ''))) > 200 THEN
    RAISE EXCEPTION 'Decline reason is too long' USING ERRCODE = '22023';
  END IF;
  UPDATE public.obligations
     SET status = 'DECLINED', decline_reason = NULLIF(btrim(p_reason), '')
   WHERE id = p_obligation_id AND owner_id <> v_user
     AND (creditor_profile_id = v_user OR debtor_profile_id = v_user)
     AND status = 'PENDING_APPROVAL';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pending request is unavailable' USING ERRCODE = '42501';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION private.dismiss_declined_obligation(
  p_obligation_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE v_user uuid := private.require_user();
BEGIN
  UPDATE public.obligations SET status = 'CANCELED'
   WHERE id = p_obligation_id AND owner_id = v_user AND status = 'DECLINED';
  IF NOT FOUND AND NOT EXISTS (
    SELECT 1 FROM public.obligations
     WHERE id = p_obligation_id AND owner_id = v_user AND status = 'CANCELED'
  ) THEN
    RAISE EXCEPTION 'Declined request is unavailable' USING ERRCODE = '42501';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION private.decline_p2p_emi(
  p_emi_id uuid, p_reason text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE v_user uuid := private.require_user();
BEGIN
  IF length(btrim(COALESCE(p_reason, ''))) > 200 THEN
    RAISE EXCEPTION 'Decline reason is too long' USING ERRCODE = '22023';
  END IF;
  UPDATE public.recurring_emis
     SET status = 'DECLINED', decline_reason = NULLIF(btrim(p_reason), '')
   WHERE id = p_emi_id AND counterparty_profile_id = v_user
     AND type <> 'personal' AND status = 'PENDING_APPROVAL';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pending EMI request is unavailable' USING ERRCODE = '42501';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION private.dismiss_declined_emi(p_emi_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE v_user uuid := private.require_user();
BEGIN
  UPDATE public.recurring_emis SET status = 'CANCELED'
   WHERE id = p_emi_id AND owner_id = v_user AND status = 'DECLINED';
  IF NOT FOUND AND NOT EXISTS (
    SELECT 1 FROM public.recurring_emis
     WHERE id = p_emi_id AND owner_id = v_user AND status = 'CANCELED'
  ) THEN
    RAISE EXCEPTION 'Declined EMI request is unavailable' USING ERRCODE = '42501';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION private.cancel_owned_emi(p_emi_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE v_user uuid := private.require_user();
BEGIN
  UPDATE public.recurring_emis SET status = 'CANCELED'
   WHERE id = p_emi_id AND owner_id = v_user AND status <> 'CANCELED';
  IF NOT FOUND AND NOT EXISTS (
    SELECT 1 FROM public.recurring_emis
     WHERE id = p_emi_id AND owner_id = v_user AND status = 'CANCELED'
  ) THEN
    RAISE EXCEPTION 'Recurring payment is unavailable' USING ERRCODE = '42501';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION private.merge_shadow_contact(
  p_contact_id uuid, p_profile_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE v_user uuid := private.require_user();
BEGIN
  IF p_profile_id IS NULL OR p_profile_id = v_user
     OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_profile_id) THEN
    RAISE EXCEPTION 'Selected profile is unavailable' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.contacts
   WHERE id = p_contact_id AND owner_id = v_user FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Contact is unavailable' USING ERRCODE = '42501';
  END IF;
  UPDATE public.transactions
     SET tagged_profile_id = p_profile_id, contact_id = NULL
   WHERE owner_id = v_user AND contact_id = p_contact_id;
  UPDATE public.obligations
     SET profile_id = p_profile_id, contact_id = NULL, shadow_contact_id = NULL
   WHERE owner_id = v_user
     AND (contact_id = p_contact_id OR shadow_contact_id = p_contact_id);
  UPDATE public.recurring_emis
     SET counterparty_profile_id = p_profile_id, shadow_contact_id = NULL
   WHERE owner_id = v_user AND shadow_contact_id = p_contact_id
     AND type IN ('lent', 'borrowed');
  DELETE FROM public.contacts WHERE id = p_contact_id AND owner_id = v_user;
END;
$$;

REVOKE ALL ON FUNCTION private.decline_p2p_obligation(uuid,text),
  private.dismiss_declined_obligation(uuid), private.decline_p2p_emi(uuid,text),
  private.dismiss_declined_emi(uuid), private.cancel_owned_emi(uuid),
  private.merge_shadow_contact(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.decline_p2p_obligation(uuid,text),
  private.dismiss_declined_obligation(uuid), private.decline_p2p_emi(uuid,text),
  private.dismiss_declined_emi(uuid), private.cancel_owned_emi(uuid),
  private.merge_shadow_contact(uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.decline_p2p_obligation(
  p_obligation_id uuid, p_reason text
) RETURNS void LANGUAGE sql SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$ SELECT private.decline_p2p_obligation(p_obligation_id, p_reason); $$;
CREATE OR REPLACE FUNCTION public.dismiss_declined_obligation(
  p_obligation_id uuid
) RETURNS void LANGUAGE sql SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$ SELECT private.dismiss_declined_obligation(p_obligation_id); $$;
CREATE OR REPLACE FUNCTION public.decline_p2p_emi(
  p_emi_id uuid, p_reason text
) RETURNS void LANGUAGE sql SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$ SELECT private.decline_p2p_emi(p_emi_id, p_reason); $$;
CREATE OR REPLACE FUNCTION public.dismiss_declined_emi(
  p_emi_id uuid
) RETURNS void LANGUAGE sql SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$ SELECT private.dismiss_declined_emi(p_emi_id); $$;
CREATE OR REPLACE FUNCTION public.cancel_owned_emi(p_emi_id uuid)
RETURNS void LANGUAGE sql SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$ SELECT private.cancel_owned_emi(p_emi_id); $$;
CREATE OR REPLACE FUNCTION public.merge_shadow_contact(
  p_contact_id uuid, p_profile_id uuid
) RETURNS void LANGUAGE sql SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$ SELECT private.merge_shadow_contact(p_contact_id, p_profile_id); $$;

REVOKE ALL ON FUNCTION public.decline_p2p_obligation(uuid,text),
  public.dismiss_declined_obligation(uuid), public.decline_p2p_emi(uuid,text),
  public.dismiss_declined_emi(uuid), public.cancel_owned_emi(uuid),
  public.merge_shadow_contact(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decline_p2p_obligation(uuid,text),
  public.dismiss_declined_obligation(uuid), public.decline_p2p_emi(uuid,text),
  public.dismiss_declined_emi(uuid), public.cancel_owned_emi(uuid),
  public.merge_shadow_contact(uuid,uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

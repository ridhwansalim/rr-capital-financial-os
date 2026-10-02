-- Complete participant label resolution for shared EMIs: both the owner and
-- counterparty may need the other participant's display name.
CREATE OR REPLACE FUNCTION private.profile_labels(p_profile_ids uuid[])
RETURNS TABLE(id uuid, username text, full_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, private, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF p_profile_ids IS NULL OR cardinality(p_profile_ids) > 100 THEN
    RAISE EXCEPTION 'Invalid profile label request' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT d.id, d.username, d.full_name
  FROM public.profile_directory d
  WHERE d.id = ANY (p_profile_ids)
    AND d.id <> v_user_id
    AND (
      EXISTS (
        SELECT 1 FROM public.transactions t
        WHERE t.owner_id = v_user_id AND t.tagged_profile_id = d.id
      )
      OR EXISTS (
        SELECT 1 FROM public.obligations o
        WHERE (o.owner_id = v_user_id OR o.creditor_profile_id = v_user_id OR o.debtor_profile_id = v_user_id)
          AND (o.creditor_profile_id = d.id OR o.debtor_profile_id = d.id)
      )
      OR EXISTS (
        SELECT 1 FROM public.recurring_emis e
        WHERE (e.owner_id = v_user_id OR e.counterparty_profile_id = v_user_id)
          AND (e.owner_id = d.id OR e.counterparty_profile_id = d.id)
      )
      OR EXISTS (
        SELECT 1 FROM public.settlements s
        WHERE (s.initiator_id = v_user_id OR s.counterparty_profile_id = v_user_id)
          AND (s.initiator_id = d.id OR s.counterparty_profile_id = d.id)
      )
    );
END;
$$;
NOTIFY pgrst, 'reload schema';

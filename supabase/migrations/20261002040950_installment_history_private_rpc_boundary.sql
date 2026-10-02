-- Keep SECURITY DEFINER implementations out of the exposed PostgREST schema.
-- Public RPC wrappers are invokers; private implementations still derive and
-- validate auth.uid() and enforce schedule ownership.
CREATE OR REPLACE FUNCTION private.list_installment_occurrences(
  p_schedule_kind text, p_schedule_id uuid
) RETURNS TABLE(installment_number integer, due_date date, amount numeric,
                status text, historical boolean)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, private, pg_temp AS $$
DECLARE v_owner uuid := private.require_user();
BEGIN
  IF p_schedule_kind = 'CHITTI' AND EXISTS (
    SELECT 1 FROM public.chittis WHERE id = p_schedule_id AND owner_id = v_owner
  ) THEN
    RETURN QUERY SELECT o.installment_number, o.due_date, o.amount, o.status, o.historical
      FROM private.installment_occurrences o
     WHERE o.schedule_kind = p_schedule_kind AND o.schedule_id = p_schedule_id
       AND o.owner_id = v_owner ORDER BY o.installment_number;
  ELSIF p_schedule_kind = 'BANK_EMI' AND EXISTS (
    SELECT 1 FROM public.recurring_emis WHERE id = p_schedule_id
      AND owner_id = v_owner AND type = 'personal'
  ) THEN
    RETURN QUERY SELECT o.installment_number, o.due_date, o.amount, o.status, o.historical
      FROM private.installment_occurrences o
     WHERE o.schedule_kind = p_schedule_kind AND o.schedule_id = p_schedule_id
       AND o.owner_id = v_owner ORDER BY o.installment_number;
  ELSE
    RAISE EXCEPTION 'Installment schedule is unavailable' USING ERRCODE = '42501';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION private.list_installment_occurrences(text,uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION private.list_installment_occurrences(text,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION private.set_historical_installment_status(
  p_schedule_kind text, p_schedule_id uuid, p_installment_number integer, p_status text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, private, pg_temp AS $$
DECLARE v_owner uuid := private.require_user(); v_row private.installment_occurrences%ROWTYPE;
BEGIN
  IF p_status NOT IN ('PAID', 'MISSED', 'UNCONFIRMED')
     OR p_installment_number NOT BETWEEN 1 AND 600 THEN
    RAISE EXCEPTION 'Invalid historical installment status' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.chittis WHERE p_schedule_kind = 'CHITTI'
    AND id = p_schedule_id AND owner_id = v_owner;
  IF NOT FOUND THEN
    PERFORM 1 FROM public.recurring_emis WHERE p_schedule_kind = 'BANK_EMI'
      AND id = p_schedule_id AND owner_id = v_owner AND type = 'personal';
    IF NOT FOUND THEN RAISE EXCEPTION 'Installment schedule is unavailable' USING ERRCODE = '42501'; END IF;
  END IF;
  SELECT * INTO v_row FROM private.installment_occurrences
   WHERE schedule_kind = p_schedule_kind AND schedule_id = p_schedule_id
     AND owner_id = v_owner AND installment_number = p_installment_number FOR UPDATE;
  IF NOT FOUND OR v_row.due_date > (statement_timestamp() AT TIME ZONE 'Asia/Kolkata')::date THEN
    RAISE EXCEPTION 'Only an existing installment due today or earlier can be classified' USING ERRCODE = '22023';
  END IF;
  IF v_row.transaction_id IS NOT NULL THEN
    RAISE EXCEPTION 'A ledger-paid installment cannot be reclassified' USING ERRCODE = '42501';
  END IF;
  UPDATE private.installment_occurrences
     SET status = p_status, historical = (p_status = 'PAID'), updated_at = now()
   WHERE schedule_kind = p_schedule_kind AND schedule_id = p_schedule_id
     AND installment_number = p_installment_number;
  IF p_schedule_kind = 'CHITTI' THEN
    UPDATE public.chittis c
       SET months_paid = (SELECT count(*)::integer FROM private.installment_occurrences o
                           WHERE o.schedule_kind = 'CHITTI' AND o.schedule_id = c.id
                             AND o.status = 'PAID'),
           status = CASE
             WHEN c.status = 'CANCELLED' THEN c.status
             WHEN (SELECT count(*) FROM private.installment_occurrences o
                    WHERE o.schedule_kind = 'CHITTI' AND o.schedule_id = c.id
                      AND o.status = 'PAID') >= c.duration_months THEN 'COMPLETED'
             ELSE 'ACTIVE' END
     WHERE c.id = p_schedule_id;
  ELSE
    UPDATE public.recurring_emis e
       SET owner_months_paid = (SELECT count(*)::integer FROM private.installment_occurrences o
                                 WHERE o.schedule_kind = 'BANK_EMI' AND o.schedule_id = e.id
                                   AND o.status = 'PAID')
     WHERE e.id = p_schedule_id;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION private.set_historical_installment_status(text,uuid,integer,text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION private.set_historical_installment_status(text,uuid,integer,text)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.list_installment_occurrences(
  p_schedule_kind text, p_schedule_id uuid
) RETURNS TABLE(installment_number integer, due_date date, amount numeric,
                status text, historical boolean)
LANGUAGE sql SECURITY INVOKER
SET search_path = pg_catalog, public, private, pg_temp
AS $$
  SELECT * FROM private.list_installment_occurrences(p_schedule_kind, p_schedule_id);
$$;
REVOKE ALL ON FUNCTION public.list_installment_occurrences(text,uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.list_installment_occurrences(text,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_historical_installment_status(
  p_schedule_kind text, p_schedule_id uuid, p_installment_number integer, p_status text
) RETURNS void LANGUAGE sql SECURITY INVOKER
SET search_path = pg_catalog, public, private, pg_temp
AS $$
  SELECT private.set_historical_installment_status(
    p_schedule_kind, p_schedule_id, p_installment_number, p_status
  );
$$;
REVOKE ALL ON FUNCTION public.set_historical_installment_status(text,uuid,integer,text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.set_historical_installment_status(text,uuid,integer,text)
  TO authenticated;

NOTIFY pgrst, 'reload schema';

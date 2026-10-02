-- Explicit history for monthly Chitti and personal bank EMI schedules.
-- Historical paid statuses never create ledger rows; only normal payment RPCs do.
CREATE TABLE IF NOT EXISTS private.installment_occurrences (
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  schedule_kind text NOT NULL CHECK (schedule_kind IN ('CHITTI', 'BANK_EMI')),
  schedule_id uuid NOT NULL,
  installment_number integer NOT NULL CHECK (installment_number BETWEEN 1 AND 600),
  due_date date NOT NULL,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  status text NOT NULL CHECK (status IN ('SCHEDULED', 'PAID', 'MISSED', 'UNCONFIRMED')),
  historical boolean NOT NULL DEFAULT false,
  transaction_id uuid REFERENCES public.transactions(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (schedule_kind, schedule_id, installment_number),
  CHECK ((historical AND status = 'PAID' AND transaction_id IS NULL)
      OR (NOT historical AND (status <> 'PAID' OR transaction_id IS NOT NULL)))
);
ALTER TABLE private.installment_occurrences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.installment_occurrences FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.installment_due_date(p_start date, p_number integer)
RETURNS date LANGUAGE sql IMMUTABLE STRICT
SET search_path = pg_catalog AS $$
  SELECT make_date(
    extract(year FROM (p_start + make_interval(months => p_number - 1)))::integer,
    extract(month FROM (p_start + make_interval(months => p_number - 1)))::integer,
    least(extract(day FROM p_start)::integer,
          extract(day FROM (date_trunc('month', p_start + make_interval(months => p_number - 1))
                            + interval '1 month - 1 day'))::integer)
  )
$$;
REVOKE ALL ON FUNCTION private.installment_due_date(date,integer) FROM PUBLIC, anon, authenticated, service_role;

-- Treat end_date as the inclusive last eligible installment date. Calendar
-- month arithmetic alone is insufficient for anchored month-end schedules:
-- Jan 31 -> Feb 28 is an installment when end_date is Feb 28, but not Feb 27.
CREATE OR REPLACE FUNCTION private.installment_count_through_date(p_start date, p_end date)
RETURNS integer LANGUAGE plpgsql IMMUTABLE STRICT
SET search_path = pg_catalog, private AS $$
DECLARE v_count integer;
BEGIN
  IF p_end < p_start THEN
    RAISE EXCEPTION 'Schedule end date precedes its start date' USING ERRCODE = '22023';
  END IF;
  v_count := (extract(year FROM p_end)::integer - extract(year FROM p_start)::integer) * 12
           + extract(month FROM p_end)::integer - extract(month FROM p_start)::integer + 1;
  IF private.installment_due_date(p_start, v_count) > p_end THEN
    v_count := v_count - 1;
  END IF;
  IF v_count < 1 OR v_count > 600 THEN
    RAISE EXCEPTION 'Schedule must contain between 1 and 600 monthly installments' USING ERRCODE = '22023';
  END IF;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION private.installment_count_through_date(date,date) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.sync_installment_occurrences()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, private, pg_temp AS $$
DECLARE
  v_kind text;
  v_schedule_id uuid;
  v_owner_id uuid;
  v_start date;
  v_count integer;
  v_amount numeric;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_kind := CASE WHEN TG_TABLE_NAME = 'chittis' THEN 'CHITTI' ELSE 'BANK_EMI' END;
    v_schedule_id := OLD.id;
    IF EXISTS (SELECT 1 FROM private.installment_occurrences
                WHERE schedule_kind = v_kind AND schedule_id = v_schedule_id
                  AND (historical OR status = 'MISSED' OR transaction_id IS NOT NULL)) THEN
      RAISE EXCEPTION 'Schedule with installment history cannot be deleted' USING ERRCODE = '42501';
    END IF;
    DELETE FROM private.installment_occurrences
     WHERE schedule_kind = v_kind AND schedule_id = v_schedule_id;
    RETURN OLD;
  END IF;

  IF TG_TABLE_NAME = 'chittis' THEN
    v_kind := 'CHITTI'; v_schedule_id := NEW.id; v_owner_id := NEW.owner_id;
    v_start := NEW.start_date; v_count := NEW.duration_months; v_amount := NEW.monthly_installment;
  ELSE
    IF NEW.type <> 'personal' THEN
      IF TG_OP = 'UPDATE' AND OLD.type = 'personal' THEN
        IF EXISTS (SELECT 1 FROM private.installment_occurrences
                    WHERE schedule_kind = 'BANK_EMI' AND schedule_id = OLD.id
                      AND (historical OR status = 'MISSED' OR transaction_id IS NOT NULL)) THEN
          RAISE EXCEPTION 'Schedule terms are locked after installment history is recorded' USING ERRCODE = '42501';
        END IF;
        DELETE FROM private.installment_occurrences
         WHERE schedule_kind = 'BANK_EMI' AND schedule_id = OLD.id;
      END IF;
      RETURN NEW;
    END IF;
    v_kind := 'BANK_EMI'; v_schedule_id := NEW.id; v_owner_id := NEW.owner_id;
    v_start := NEW.start_date;
    v_count := CASE WHEN NEW.end_date IS NULL THEN 1
                    ELSE private.installment_count_through_date(NEW.start_date, NEW.end_date) END;
    v_amount := NEW.amount;
  END IF;

  IF v_start IS NULL OR v_count NOT BETWEEN 1 AND 600 OR v_amount IS NULL OR v_amount <= 0 THEN
    RAISE EXCEPTION 'Invalid monthly installment schedule' USING ERRCODE = '22023';
  END IF;
  IF TG_OP = 'UPDATE' AND EXISTS (
    SELECT 1 FROM private.installment_occurrences
     WHERE schedule_kind = v_kind AND schedule_id = v_schedule_id
       AND (historical OR status = 'MISSED' OR transaction_id IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'Schedule terms are locked after installment history is recorded' USING ERRCODE = '42501';
  END IF;

  DELETE FROM private.installment_occurrences
   WHERE schedule_kind = v_kind AND schedule_id = v_schedule_id;
  INSERT INTO private.installment_occurrences
    (owner_id, schedule_kind, schedule_id, installment_number, due_date, amount, status)
  SELECT v_owner_id, v_kind, v_schedule_id, n,
         private.installment_due_date(v_start, n), v_amount,
         CASE WHEN private.installment_due_date(v_start, n) <= (statement_timestamp() AT TIME ZONE 'Asia/Kolkata')::date
              THEN 'UNCONFIRMED' ELSE 'SCHEDULED' END
    FROM generate_series(1, v_count) AS n;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.sync_installment_occurrences() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS sync_chitti_installments ON public.chittis;
CREATE TRIGGER sync_chitti_installments
  AFTER INSERT OR UPDATE OF start_date, duration_months, monthly_installment OR DELETE
  ON public.chittis FOR EACH ROW EXECUTE FUNCTION private.sync_installment_occurrences();
DROP TRIGGER IF EXISTS sync_personal_emi_installments ON public.recurring_emis;
CREATE TRIGGER sync_personal_emi_installments
  AFTER INSERT OR UPDATE OF start_date, end_date, amount, type OR DELETE
  ON public.recurring_emis FOR EACH ROW EXECUTE FUNCTION private.sync_installment_occurrences();

-- Backfill schedule rows without claiming any legacy counter was paid.
INSERT INTO private.installment_occurrences
  (owner_id, schedule_kind, schedule_id, installment_number, due_date, amount, status)
SELECT c.owner_id, 'CHITTI', c.id, n,
       private.installment_due_date(c.start_date, n), c.monthly_installment,
       CASE WHEN private.installment_due_date(c.start_date, n) <= (statement_timestamp() AT TIME ZONE 'Asia/Kolkata')::date
            THEN 'UNCONFIRMED' ELSE 'SCHEDULED' END
  FROM public.chittis c
  CROSS JOIN LATERAL generate_series(1, c.duration_months) n
 WHERE c.duration_months BETWEEN 1 AND 600
ON CONFLICT DO NOTHING;
INSERT INTO private.installment_occurrences
  (owner_id, schedule_kind, schedule_id, installment_number, due_date, amount, status)
SELECT e.owner_id, 'BANK_EMI', e.id, n,
       private.installment_due_date(e.start_date, n), e.amount,
       CASE WHEN private.installment_due_date(e.start_date, n) <= (statement_timestamp() AT TIME ZONE 'Asia/Kolkata')::date
            THEN 'UNCONFIRMED' ELSE 'SCHEDULED' END
  FROM public.recurring_emis e
  CROSS JOIN LATERAL generate_series(1, CASE WHEN e.end_date IS NULL THEN 1
    ELSE private.installment_count_through_date(e.start_date, e.end_date) END) n
 WHERE e.type = 'personal'
   AND (CASE WHEN e.end_date IS NULL THEN 1
     ELSE private.installment_count_through_date(e.start_date, e.end_date) END) BETWEEN 1 AND 600
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.list_installment_occurrences(
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
REVOKE ALL ON FUNCTION public.list_installment_occurrences(text,uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.list_installment_occurrences(text,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_historical_installment_status(
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
REVOKE ALL ON FUNCTION public.set_historical_installment_status(text,uuid,integer,text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.set_historical_installment_status(text,uuid,integer,text)
  TO authenticated;

-- Personal Chitti payments can now pay any due occurrence, including a missed
-- month, while the occurrence and ledger transaction remain one atomic action.
CREATE OR REPLACE FUNCTION private.pay_chitti_installment(
  p_request_id uuid, p_chitti_id uuid, p_account_id uuid,
  p_expected_month integer, p_created_at timestamptz
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, private, pg_temp AS $$
DECLARE
  v_owner uuid := private.require_user();
  v_plan public.chittis%ROWTYPE;
  v_account_opening_date date;
  v_previous private.chitti_action_requests%ROWTYPE;
  v_occurrence private.installment_occurrences%ROWTYPE;
  v_transaction_id uuid;
  v_paid integer;
BEGIN
  IF p_request_id IS NULL OR p_chitti_id IS NULL OR p_account_id IS NULL OR p_created_at IS NULL THEN
    RAISE EXCEPTION 'Missing Chitti payment details' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_owner::text || p_request_id::text, 0));
  SELECT * INTO v_previous FROM private.chitti_action_requests
   WHERE owner_id = v_owner AND request_id = p_request_id;
  IF FOUND THEN
    IF v_previous.action_kind <> 'INSTALLMENT' OR v_previous.chitti_id <> p_chitti_id
       OR v_previous.account_id <> p_account_id
       OR v_previous.month_number IS DISTINCT FROM p_expected_month
       OR v_previous.transaction_date IS DISTINCT FROM p_created_at THEN
      RAISE EXCEPTION 'Request ID was already used for different Chitti data' USING ERRCODE = '23505';
    END IF;
    RETURN v_previous.transaction_id;
  END IF;
  IF EXISTS (SELECT 1 FROM public.transactions
              WHERE owner_id = v_owner AND client_request_id = p_request_id) THEN
    RAISE EXCEPTION 'Request ID already belongs to another transaction' USING ERRCODE = '23505';
  END IF;
  SELECT * INTO v_plan FROM public.chittis
   WHERE id = p_chitti_id AND owner_id = v_owner FOR UPDATE;
  IF NOT FOUND OR v_plan.status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'Chitti is unavailable' USING ERRCODE = '22023';
  END IF;
  SELECT opening_date INTO v_account_opening_date FROM public.accounts
   WHERE id = p_account_id AND owner_id = v_owner FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment account is unavailable' USING ERRCODE = '42501';
  END IF;
    SELECT * INTO v_occurrence FROM private.installment_occurrences
     WHERE schedule_kind = 'CHITTI' AND schedule_id = p_chitti_id
       AND owner_id = v_owner AND installment_number = p_expected_month FOR UPDATE;
    IF NOT FOUND OR v_occurrence.status = 'PAID'
       OR (v_occurrence.status = 'UNCONFIRMED'
           AND v_occurrence.due_date < (statement_timestamp() AT TIME ZONE 'Asia/Kolkata')::date) THEN
      RAISE EXCEPTION 'Choose an unpaid installment; confirm past installment history first' USING ERRCODE = '22023';
  END IF;
  IF (p_created_at AT TIME ZONE 'Asia/Kolkata')::date < v_account_opening_date THEN
    RAISE EXCEPTION 'Payment date precedes account opening date (%)', v_account_opening_date
      USING ERRCODE = '22023';
  END IF;
  v_transaction_id := private.post_ledger_transaction(
    p_request_id, p_account_id, NULL, v_occurrence.amount, 0,
    format('Chitti Installment: %s (Month %s/%s)',
           v_plan.name, p_expected_month, v_plan.duration_months),
    p_created_at, NULL, NULL, NULL, NULL
  );
  UPDATE private.installment_occurrences SET status = 'PAID', historical = false,
    transaction_id = v_transaction_id, updated_at = now()
   WHERE schedule_kind = 'CHITTI' AND schedule_id = p_chitti_id
     AND installment_number = p_expected_month;
  SELECT count(*)::integer INTO v_paid FROM private.installment_occurrences
   WHERE schedule_kind = 'CHITTI' AND schedule_id = p_chitti_id AND status = 'PAID';
  UPDATE public.chittis SET months_paid = v_paid,
    status = CASE WHEN v_paid >= duration_months THEN 'COMPLETED' ELSE 'ACTIVE' END
   WHERE id = p_chitti_id;
  INSERT INTO private.chitti_action_requests
    (owner_id, request_id, action_kind, chitti_id, account_id,
     month_number, transaction_date, transaction_id)
  VALUES (v_owner, p_request_id, 'INSTALLMENT', p_chitti_id, p_account_id,
          p_expected_month, p_created_at, v_transaction_id);
  RETURN v_transaction_id;
END;
$$;
REVOKE ALL ON FUNCTION private.pay_chitti_installment(uuid,uuid,uuid,integer,timestamptz)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION private.pay_chitti_installment(uuid,uuid,uuid,integer,timestamptz)
  TO authenticated;

-- Personal bank EMIs share the occurrence model. Peer EMI/settlement counters
-- retain their existing two-party approval rules and sequential semantics.
CREATE OR REPLACE FUNCTION private.pay_bank_emi(
  p_request_id uuid, p_emi_id uuid, p_account_id uuid,
  p_expected_month integer, p_created_at timestamptz
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, private, pg_temp AS $$
DECLARE
  v_owner uuid := private.require_user();
  v_emi public.recurring_emis%ROWTYPE;
  v_account_opening_date date;
  v_previous private.emi_bank_action_requests%ROWTYPE;
  v_occurrence private.installment_occurrences%ROWTYPE;
  v_progress integer;
  v_total_months integer;
  v_transaction_id uuid;
BEGIN
  IF p_request_id IS NULL OR p_emi_id IS NULL OR p_account_id IS NULL OR p_created_at IS NULL THEN
    RAISE EXCEPTION 'Missing EMI payment details' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_owner::text || p_request_id::text, 0));
  SELECT * INTO v_previous FROM private.emi_bank_action_requests
   WHERE owner_id = v_owner AND request_id = p_request_id;
  IF FOUND THEN
    IF v_previous.emi_id <> p_emi_id OR v_previous.account_id <> p_account_id
       OR v_previous.month_number IS DISTINCT FROM p_expected_month
       OR v_previous.transaction_date IS DISTINCT FROM p_created_at THEN
      RAISE EXCEPTION 'Request ID was already used for different EMI data' USING ERRCODE = '23505';
    END IF;
    RETURN v_previous.transaction_id;
  END IF;
  IF EXISTS (SELECT 1 FROM public.transactions
              WHERE owner_id = v_owner AND client_request_id = p_request_id) THEN
    RAISE EXCEPTION 'Request ID already belongs to another transaction' USING ERRCODE = '23505';
  END IF;
  SELECT * INTO v_emi FROM public.recurring_emis
   WHERE id = p_emi_id AND status = 'ACTIVE'
     AND (owner_id = v_owner OR counterparty_profile_id = v_owner) FOR UPDATE;
  IF NOT FOUND OR NOT ((v_emi.type IN ('personal', 'lent') AND v_emi.owner_id = v_owner)
          OR (v_emi.type = 'borrowed' AND v_emi.counterparty_profile_id = v_owner)) THEN
    RAISE EXCEPTION 'EMI is unavailable to this bank payer' USING ERRCODE = '42501';
  END IF;
  SELECT opening_date INTO v_account_opening_date FROM public.accounts
   WHERE id = p_account_id AND owner_id = v_owner FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment account is unavailable' USING ERRCODE = '42501';
  END IF;
  IF (p_created_at AT TIME ZONE 'Asia/Kolkata')::date < v_account_opening_date THEN
    RAISE EXCEPTION 'Payment date precedes account opening date (%)', v_account_opening_date
      USING ERRCODE = '22023';
  END IF;

  v_progress := CASE WHEN v_emi.owner_id = v_owner
                     THEN COALESCE(v_emi.owner_months_paid, 0)
                     ELSE COALESCE(v_emi.counterparty_months_paid, 0) END;
  IF v_emi.type = 'personal' THEN
    SELECT * INTO v_occurrence FROM private.installment_occurrences
     WHERE schedule_kind = 'BANK_EMI' AND schedule_id = p_emi_id
       AND owner_id = v_owner AND installment_number = p_expected_month FOR UPDATE;
    IF NOT FOUND OR v_occurrence.status = 'PAID'
       OR (v_occurrence.status = 'UNCONFIRMED'
           AND v_occurrence.due_date < (statement_timestamp() AT TIME ZONE 'Asia/Kolkata')::date) THEN
      RAISE EXCEPTION 'Choose an unpaid installment; confirm past installment history first' USING ERRCODE = '22023';
    END IF;
  ELSE
    IF v_emi.end_date IS NULL THEN
      v_total_months := 1;
    ELSE
      v_total_months := private.installment_count_through_date(v_emi.start_date, v_emi.end_date);
    END IF;
    IF p_expected_month IS DISTINCT FROM v_progress + 1 OR p_expected_month > v_total_months THEN
      RAISE EXCEPTION 'EMI installment is unavailable or already paid' USING ERRCODE = '22023';
    END IF;
  END IF;
  v_transaction_id := private.post_ledger_transaction(
    p_request_id, p_account_id, NULL, v_emi.amount, 0,
    format('Bank EMI Installment: %s (Month %s)', v_emi.name, p_expected_month),
    p_created_at, NULL, NULL, NULL, NULL
  );
  IF v_emi.type = 'personal' THEN
    UPDATE private.installment_occurrences SET status = 'PAID', historical = false,
      transaction_id = v_transaction_id, updated_at = now()
     WHERE schedule_kind = 'BANK_EMI' AND schedule_id = p_emi_id
       AND installment_number = p_expected_month;
    SELECT count(*)::integer INTO v_progress FROM private.installment_occurrences
     WHERE schedule_kind = 'BANK_EMI' AND schedule_id = p_emi_id AND status = 'PAID';
  ELSE
    v_progress := p_expected_month;
  END IF;
  IF v_emi.owner_id = v_owner THEN
    UPDATE public.recurring_emis SET owner_months_paid = v_progress WHERE id = p_emi_id;
  ELSE
    UPDATE public.recurring_emis SET counterparty_months_paid = v_progress WHERE id = p_emi_id;
  END IF;
  INSERT INTO private.emi_bank_action_requests
    (owner_id, request_id, emi_id, account_id, month_number, transaction_date, transaction_id)
  VALUES (v_owner, p_request_id, p_emi_id, p_account_id, p_expected_month,
          p_created_at, v_transaction_id);
  RETURN v_transaction_id;
END;
$$;
REVOKE ALL ON FUNCTION private.pay_bank_emi(uuid,uuid,uuid,integer,timestamptz)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION private.pay_bank_emi(uuid,uuid,uuid,integer,timestamptz)
  TO authenticated;

NOTIFY pgrst, 'reload schema';

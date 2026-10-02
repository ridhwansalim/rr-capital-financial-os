-- Only synthetic local fixtures. Historical paid flags must never create ledger rows.
SELECT plan(1);
BEGIN;
INSERT INTO auth.users(id, email, raw_user_meta_data) VALUES
 ('00000000-0000-4000-a000-000000000405', 'installment-history@example.invalid', '{}'),
 ('00000000-0000-4000-a000-000000000406', 'other-installment-user@example.invalid', '{}');
INSERT INTO public.accounts(id, owner_id, name, type, opening_balance, opening_date) VALUES
 ('10000000-0000-4000-a000-000000000408', '00000000-0000-4000-a000-000000000405', 'Installment bank', 'bank', 5000, current_date);
INSERT INTO public.chittis(id, owner_id, name, total_pot, duration_months, monthly_installment, start_date)
VALUES ('20000000-0000-4000-a000-000000000408', '00000000-0000-4000-a000-000000000405',
        'Started before setup', 1000, 10, 100, date_trunc('month', current_date)::date - interval '7 months');
INSERT INTO public.recurring_emis(id, owner_id, name, amount, start_date, end_date, type, status)
VALUES ('30000000-0000-4000-a000-000000000405', '00000000-0000-4000-a000-000000000405',
        'Personal bank EMI', 250, date_trunc('month', current_date)::date - interval '7 months',
        date_trunc('month', current_date)::date + interval '2 months', 'personal', 'ACTIVE');
INSERT INTO public.chittis(id, owner_id, name, total_pot, duration_months, monthly_installment, start_date)
VALUES ('20000000-0000-4000-a000-000000000409', '00000000-0000-4000-a000-000000000406',
        'Private other plan', 500, 5, 100, current_date);
INSERT INTO public.recurring_emis(id, owner_id, name, amount, start_date, end_date, type, status)
VALUES ('30000000-0000-4000-a000-000000000410', '00000000-0000-4000-a000-000000000405',
        'Ends before February due date', 250, '2026-01-31', '2026-02-27', 'personal', 'ACTIVE'),
       ('30000000-0000-4000-a000-000000000411', '00000000-0000-4000-a000-000000000405',
        'Ends on February due date', 250, '2026-01-31', '2026-02-28', 'personal', 'ACTIVE');

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc
     WHERE oid IN (
       to_regprocedure('public.list_installment_occurrences(text,uuid)'),
       to_regprocedure('public.set_historical_installment_status(text,uuid,integer,text)')
     ) AND prosecdef
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_proc
     WHERE oid=to_regprocedure('public.list_installment_occurrences(text,uuid)')
       AND NOT prosecdef
       AND proconfig @> ARRAY['search_path=pg_catalog, public, private, pg_temp']
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_proc
     WHERE oid=to_regprocedure('public.set_historical_installment_status(text,uuid,integer,text)')
       AND NOT prosecdef
       AND proconfig @> ARRAY['search_path=pg_catalog, public, private, pg_temp']
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_proc
     WHERE oid=to_regprocedure('private.list_installment_occurrences(text,uuid)')
       AND prosecdef
       AND proconfig @> ARRAY['search_path=pg_catalog, public, private, pg_temp']
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_proc
     WHERE oid=to_regprocedure('private.set_historical_installment_status(text,uuid,integer,text)')
       AND prosecdef
       AND proconfig @> ARRAY['search_path=pg_catalog, public, private, pg_temp']
  ) THEN
    RAISE EXCEPTION 'Installment RPC wrappers must be invokers and private implementations must use a fixed path';
  END IF;
  IF has_function_privilege('anon','private.list_installment_occurrences(text,uuid)','EXECUTE')
     OR has_function_privilege('public','private.list_installment_occurrences(text,uuid)','EXECUTE')
     OR NOT has_function_privilege('authenticated','private.list_installment_occurrences(text,uuid)','EXECUTE')
     OR has_function_privilege('anon','public.list_installment_occurrences(text,uuid)','EXECUTE')
     OR has_function_privilege('public','public.list_installment_occurrences(text,uuid)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.list_installment_occurrences(text,uuid)','EXECUTE')
     OR has_function_privilege('anon','private.set_historical_installment_status(text,uuid,integer,text)','EXECUTE')
     OR has_function_privilege('public','private.set_historical_installment_status(text,uuid,integer,text)','EXECUTE')
     OR NOT has_function_privilege('authenticated','private.set_historical_installment_status(text,uuid,integer,text)','EXECUTE')
     OR has_function_privilege('anon','public.set_historical_installment_status(text,uuid,integer,text)','EXECUTE')
     OR has_function_privilege('public','public.set_historical_installment_status(text,uuid,integer,text)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.set_historical_installment_status(text,uuid,integer,text)','EXECUTE')
     OR has_schema_privilege('anon','private','USAGE') THEN
    RAISE EXCEPTION 'Installment function or private schema grants exceed the authenticated-only boundary';
  END IF;
END $$;

DO $$ BEGIN
  IF private.installment_due_date('2026-01-31', 2) <> '2026-02-28'::date
     OR private.installment_due_date('2026-01-31', 3) <> '2026-03-31'::date
     OR private.installment_due_date('2024-01-31', 2) <> '2024-02-29'::date
     OR private.installment_count_through_date('2026-01-31', '2026-02-27') <> 1
     OR private.installment_count_through_date('2026-01-31', '2026-02-28') <> 2
     OR private.installment_count_through_date('2026-01-31', '2026-03-30') <> 2
     OR private.installment_count_through_date('2026-01-31', '2026-03-31') <> 3 THEN
    RAISE EXCEPTION 'Month-end due dates or inclusive schedule end date calculation is incorrect';
  END IF;
  IF (SELECT count(*) FROM private.installment_occurrences
       WHERE schedule_kind = 'BANK_EMI' AND schedule_id = '30000000-0000-4000-a000-000000000410') <> 1
     OR (SELECT count(*) FROM private.installment_occurrences
          WHERE schedule_kind = 'BANK_EMI' AND schedule_id = '30000000-0000-4000-a000-000000000411') <> 2 THEN
    RAISE EXCEPTION 'Personal EMI occurrence generation does not honor its inclusive end date';
  END IF;
END $$;

SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-a000-000000000405', true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  v_owner uuid := '00000000-0000-4000-a000-000000000405';
  v_chitti uuid := '20000000-0000-4000-a000-000000000408';
  v_emi uuid := '30000000-0000-4000-a000-000000000405';
  v_count integer;
  v_ledger_before integer;
  v_chitti_payment uuid;
  v_bank_payment uuid;
  v_due_date date;
  v_payment_at timestamptz := ((current_date + time '12:00') AT TIME ZONE 'Asia/Kolkata');
BEGIN
  SELECT due_date INTO v_due_date FROM public.list_installment_occurrences('CHITTI', v_chitti)
    WHERE installment_number = 2;
  IF v_due_date IS NULL THEN RAISE EXCEPTION 'Owner-scoped schedule read failed'; END IF;

  SELECT count(*) INTO v_count FROM public.list_installment_occurrences('CHITTI', v_chitti);
  IF v_count <> 10 THEN RAISE EXCEPTION 'Chitti schedule should contain 10 monthly occurrences'; END IF;
  IF (SELECT due_date FROM public.list_installment_occurrences('CHITTI', v_chitti)
       WHERE installment_number = 8) <> date_trunc('month', current_date)::date THEN
    RAISE EXCEPTION 'Monthly occurrence dates do not follow the original anchor';
  END IF;
  IF (SELECT status FROM public.list_installment_occurrences('CHITTI', v_chitti)
       WHERE installment_number = 8) <> 'UNCONFIRMED' THEN
    RAISE EXCEPTION 'Elapsed installments must not be assumed paid or unpaid';
  END IF;
  IF (SELECT status FROM public.list_installment_occurrences('CHITTI', v_chitti)
       WHERE installment_number = 10) <> 'SCHEDULED' THEN
    RAISE EXCEPTION 'Future installments must remain scheduled';
  END IF;

  SELECT count(*) INTO v_ledger_before FROM public.transactions WHERE owner_id = v_owner;
  PERFORM public.set_historical_installment_status('CHITTI', v_chitti, 1, 'PAID');
  PERFORM public.set_historical_installment_status('CHITTI', v_chitti, 2, 'MISSED');
  PERFORM public.set_historical_installment_status('CHITTI', v_chitti, 3, 'PAID');
  PERFORM public.set_historical_installment_status('BANK_EMI', v_emi, 1, 'MISSED');
  IF (SELECT count(*) FROM public.list_installment_occurrences('CHITTI', v_chitti)
       WHERE status = 'PAID' AND historical) <> 2 THEN
    RAISE EXCEPTION 'Individually paid Chitti occurrences were not retained';
  END IF;
  IF (SELECT count(*) FROM public.list_installment_occurrences('CHITTI', v_chitti)
       WHERE status = 'MISSED') <> 1 THEN
    RAISE EXCEPTION 'A missed installment was not retained';
  END IF;
  IF (SELECT count(*) FROM public.transactions WHERE owner_id = v_owner) <> v_ledger_before THEN
    RAISE EXCEPTION 'Historical setup must not create ledger movements';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-4000-a000-000000000406', true);
  BEGIN
    PERFORM * FROM public.list_installment_occurrences('CHITTI', v_chitti);
    RAISE EXCEPTION 'Another user read the creator installment schedule';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM * FROM private.installment_occurrences WHERE schedule_id = v_chitti;
    RAISE EXCEPTION 'Authenticated role directly read the private occurrence table';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);

  BEGIN
    PERFORM public.pay_bank_emi(
      '40000000-0000-4000-a000-000000000407', v_emi,
      '10000000-0000-4000-a000-000000000408', 4, v_payment_at);
    RAISE EXCEPTION 'An unconfirmed past installment was posted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.pay_chitti_installment(
      '40000000-0000-4000-a000-000000000409', v_chitti,
      '10000000-0000-4000-a000-000000000408', 2,
      ((SELECT due_date FROM public.list_installment_occurrences('CHITTI', v_chitti)
         WHERE installment_number = 2) + time '12:00') AT TIME ZONE 'Asia/Kolkata');
    RAISE EXCEPTION 'A historical payment predating account opening unexpectedly succeeded';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.pay_bank_emi(
      '40000000-0000-4000-a000-000000000410', v_emi,
      '10000000-0000-4000-a000-000000000408', 1,
      ((SELECT due_date FROM public.list_installment_occurrences('BANK_EMI', v_emi)
         WHERE installment_number = 1) + time '12:00') AT TIME ZONE 'Asia/Kolkata');
    RAISE EXCEPTION 'A historical bank EMI payment predating account opening unexpectedly succeeded';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  PERFORM public.post_ledger_transaction(
    '40000000-0000-4000-a000-000000000408',
    '10000000-0000-4000-a000-000000000408', NULL, 1, 0,
    'Unrelated request key', v_payment_at);
  BEGIN
    PERFORM public.pay_chitti_installment(
      '40000000-0000-4000-a000-000000000408', v_chitti,
      '10000000-0000-4000-a000-000000000408', 2, v_payment_at);
    RAISE EXCEPTION 'Chitti reused another ledger action request ID';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  v_chitti_payment := public.pay_chitti_installment(
    '40000000-0000-4000-a000-000000000405', v_chitti,
    '10000000-0000-4000-a000-000000000408', 2, v_payment_at);
  IF public.pay_chitti_installment(
       '40000000-0000-4000-a000-000000000405', v_chitti,
       '10000000-0000-4000-a000-000000000408', 2, v_payment_at) <> v_chitti_payment THEN
    RAISE EXCEPTION 'Retry duplicated an installment payment';
  END IF;
  v_bank_payment := public.pay_bank_emi(
    '40000000-0000-4000-a000-000000000406', v_emi,
    '10000000-0000-4000-a000-000000000408', 1, v_payment_at);
  IF v_bank_payment IS NULL OR (SELECT months_paid FROM public.chittis WHERE id = v_chitti) <> 3
     OR (SELECT owner_months_paid FROM public.recurring_emis WHERE id = v_emi) <> 1
     OR (SELECT balance FROM public.account_balances WHERE id = '10000000-0000-4000-a000-000000000408') <> 4649 THEN
    RAISE EXCEPTION 'Occurrence payments and progress did not commit atomically';
  END IF;

  BEGIN
    PERFORM public.set_historical_installment_status('CHITTI', v_chitti, 10, 'PAID');
    RAISE EXCEPTION 'Future installment was historically classified';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    UPDATE public.chittis SET start_date = start_date + 1 WHERE id = v_chitti;
    RAISE EXCEPTION 'Schedule terms changed after explicit installment history';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', true);
SET LOCAL ROLE anon;
DO $$ BEGIN
  BEGIN
    PERFORM * FROM public.list_installment_occurrences(
      'CHITTI', '20000000-0000-4000-a000-000000000408');
    RAISE EXCEPTION 'Anonymous schedule read succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;
ROLLBACK;
SELECT pass('pre-existing schedules stay anchored; actual paid/missed history is explicit and ledger-neutral');
SELECT * FROM finish();

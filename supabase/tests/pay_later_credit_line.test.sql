SELECT plan(2);
BEGIN;
INSERT INTO auth.users(id, email, raw_user_meta_data) VALUES
  ('00000000-0000-4000-a000-000000000419', 'pay-later@example.invalid', '{}');
INSERT INTO public.accounts(id, owner_id, name, type, credit_limit, opening_balance, opening_date) VALUES
  ('10000000-0000-4000-a000-000000000419', '00000000-0000-4000-a000-000000000419', 'Everyday bank', 'bank', 0, 1000, current_date),
  ('10000000-0000-4000-a000-000000000420', '00000000-0000-4000-a000-000000000419', 'Card', 'credit_card', 100, 0, current_date),
  ('10000000-0000-4000-a000-000000000421', '00000000-0000-4000-a000-000000000419', 'Pay Later', 'pay_later', 200, -30, current_date),
  ('10000000-0000-4000-a000-000000000422', '00000000-0000-4000-a000-000000000419', 'Second bank', 'bank', 0, 1000, current_date),
  ('10000000-0000-4000-a000-000000000424', '00000000-0000-4000-a000-000000000419', 'Cash in Hand', 'cash', 0, 375, current_date);
INSERT INTO auth.users(id, email, raw_user_meta_data) VALUES
  ('00000000-0000-4000-a000-000000000420', 'pay-later-other@example.invalid', '{}');
INSERT INTO public.accounts(id, owner_id, name, type, credit_limit, opening_balance, opening_date) VALUES
  ('10000000-0000-4000-a000-000000000423', '00000000-0000-4000-a000-000000000420', 'Other user Pay Later', 'pay_later', 100, 0, current_date);
INSERT INTO public.recurring_emis(id, owner_id, name, amount, start_date, end_date, type, status, initiator_account_id, credit_account_id)
VALUES ('20000000-0000-4000-a000-000000000419', '00000000-0000-4000-a000-000000000419', 'Pay Later purchase EMI', 25,
        (statement_timestamp() AT TIME ZONE 'Asia/Kolkata')::date,
        ((statement_timestamp() AT TIME ZONE 'Asia/Kolkata')::date + interval '1 month')::date,
        'personal', 'ACTIVE', '10000000-0000-4000-a000-000000000419', '10000000-0000-4000-a000-000000000421');
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-a000-000000000419', true);
SET LOCAL ROLE authenticated;

DO $$
BEGIN
  BEGIN
    INSERT INTO public.recurring_emis(owner_id, name, amount, start_date, end_date, type, status, credit_account_id)
    VALUES ('00000000-0000-4000-a000-000000000419', 'Invalid bank link', 5, current_date,
            current_date + interval '1 month', 'personal', 'ACTIVE', '10000000-0000-4000-a000-000000000419');
    RAISE EXCEPTION 'A personal EMI was linked to a non-credit account';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.recurring_emis(owner_id, name, amount, start_date, end_date, type, status, credit_account_id)
    VALUES ('00000000-0000-4000-a000-000000000419', 'Cross-owner link', 5, current_date,
            current_date + interval '1 month', 'personal', 'ACTIVE', '10000000-0000-4000-a000-000000000423');
    RAISE EXCEPTION 'A personal EMI was linked to another owner credit account';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  PERFORM public.post_ledger_transaction(
    gen_random_uuid(), '10000000-0000-4000-a000-000000000420', NULL,
    80, 0, 'Synthetic card purchase', statement_timestamp());
  PERFORM public.post_ledger_transaction(
    gen_random_uuid(), '10000000-0000-4000-a000-000000000421', NULL,
    125, 0, 'Synthetic Pay Later purchase', statement_timestamp());

  BEGIN
    PERFORM public.post_ledger_transaction(gen_random_uuid(),
      '10000000-0000-4000-a000-000000000420', NULL, 21, 0,
      'Over limit card purchase', statement_timestamp());
    RAISE EXCEPTION 'Credit-card purchase above the approved line succeeded';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  BEGIN
    PERFORM public.post_ledger_transaction(gen_random_uuid(),
      '10000000-0000-4000-a000-000000000421', NULL, 46, 0,
      'Over limit Pay Later purchase', statement_timestamp());
    RAISE EXCEPTION 'Pay Later purchase above the approved line succeeded';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  BEGIN
    UPDATE public.accounts SET credit_limit = 70
     WHERE id = '10000000-0000-4000-a000-000000000420';
    RAISE EXCEPTION 'Credit limit was lowered below existing debt';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  PERFORM public.post_ledger_transaction(
    gen_random_uuid(), '10000000-0000-4000-a000-000000000419',
    '10000000-0000-4000-a000-000000000421', 55, 0,
    'Synthetic Pay Later repayment', statement_timestamp());

  BEGIN
    INSERT INTO public.accounts(owner_id, name, type, credit_limit, opening_date)
    VALUES ('00000000-0000-4000-a000-000000000419', 'Unconfigured card', 'credit_card', 0, current_date);
    RAISE EXCEPTION 'A credit line without a limit was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  IF (SELECT balance FROM public.account_balances
       WHERE id = '10000000-0000-4000-a000-000000000419') <> 945
     OR (SELECT balance FROM public.account_balances
          WHERE id = '10000000-0000-4000-a000-000000000420') <> -80
     OR (SELECT balance FROM public.account_balances
          WHERE id = '10000000-0000-4000-a000-000000000421') <> -100 THEN
    RAISE EXCEPTION 'Credit-card and Pay Later balances did not use the expected sign convention';
  END IF;
  IF (SELECT balance FROM public.account_balances WHERE id = '10000000-0000-4000-a000-000000000424') <> 375 THEN
    RAISE EXCEPTION 'A Pay Later purchase changed Cash in Hand';
  END IF;

  PERFORM public.pay_bank_emi(gen_random_uuid(), '20000000-0000-4000-a000-000000000419',
    '10000000-0000-4000-a000-000000000419', 1, statement_timestamp());
  IF (SELECT balance FROM public.account_balances WHERE id = '10000000-0000-4000-a000-000000000419') <> 920
     OR (SELECT balance FROM public.account_balances WHERE id = '10000000-0000-4000-a000-000000000421') <> -75
     OR (SELECT balance FROM public.account_balances WHERE id = '10000000-0000-4000-a000-000000000424') <> 375
     OR (SELECT to_account_id FROM public.transactions WHERE description LIKE 'Bank EMI Installment: Pay Later purchase EMI%') <> '10000000-0000-4000-a000-000000000421' THEN
    RAISE EXCEPTION 'Linked Pay Later EMI did not reduce the credit balance as a transfer';
  END IF;
END $$;
RESET ROLE;
ROLLBACK;
SELECT pass('credit-line purchases respect limits, repayments reduce Pay Later debt, and failed writes are atomic');
SELECT ok(EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'private'
  AND tablename = 'emi_bank_action_requests'
  AND indexname = 'emi_bank_action_requests_credit_account_id_idx'),
  'Pay Later action request credit-account foreign key has a covering index');
SELECT * FROM finish();

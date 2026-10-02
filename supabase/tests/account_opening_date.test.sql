-- Run only after all migrations in an isolated local database. All fixtures
-- are synthetic and the transaction is rolled back at the end.
SELECT plan(1);
BEGIN;

INSERT INTO auth.users(id, email, raw_user_meta_data) VALUES
  ('00000000-0000-4000-a000-000000000404', 'opening-date@example.invalid', '{}');
INSERT INTO public.accounts(id, owner_id, name, type, opening_balance, opening_date) VALUES
  ('10000000-0000-4000-a000-000000000404', '00000000-0000-4000-a000-000000000404', 'Opening bank', 'bank', 1000, (statement_timestamp() AT TIME ZONE 'Asia/Kolkata')::date),
  ('10000000-0000-4000-a000-000000000405', '00000000-0000-4000-a000-000000000404', 'Earlier bank', 'bank', 400, (statement_timestamp() AT TIME ZONE 'Asia/Kolkata')::date - 1),
  ('10000000-0000-4000-a000-000000000406', '00000000-0000-4000-a000-000000000404', 'Opening card', 'credit_card', -12000, (statement_timestamp() AT TIME ZONE 'Asia/Kolkata')::date);
INSERT INTO public.contacts(id, owner_id, name) VALUES
  ('20000000-0000-4000-a000-000000000404', '00000000-0000-4000-a000-000000000404', 'Synthetic contact');

SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-a000-000000000404', true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  v_owner_id uuid := '00000000-0000-4000-a000-000000000404';
  bank_id uuid := '10000000-0000-4000-a000-000000000404';
  earlier_bank_id uuid := '10000000-0000-4000-a000-000000000405';
  card_id uuid := '10000000-0000-4000-a000-000000000406';
  opening_day date := (statement_timestamp() AT TIME ZONE 'Asia/Kolkata')::date;
  transaction_at timestamptz := ((statement_timestamp() AT TIME ZONE 'Asia/Kolkata')::date + time '12:00') AT TIME ZONE 'Asia/Kolkata';
  before_opening timestamptz := (((statement_timestamp() AT TIME ZONE 'Asia/Kolkata')::date - 1) + time '12:00') AT TIME ZONE 'Asia/Kolkata';
  current_balance numeric;
BEGIN
  -- Initial bank/card balances contribute directly and are not fake ledger rows.
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.transactions'::regclass
       AND tgname = 'a_transaction_opening_date_boundary'
       AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'Opening-date lock trigger must run before overdraft locking';
  END IF;

  IF (SELECT balance FROM public.account_balances WHERE id = bank_id) <> 1000
     OR (SELECT balance FROM public.account_balances WHERE id = card_id) <> -12000 THEN
    RAISE EXCEPTION 'Opening balance was not reflected in the balance view';
  END IF;

  -- Setup corrections remain possible before the first ledger entry.
  UPDATE public.accounts SET opening_balance = 1001 WHERE id = bank_id;
  UPDATE public.accounts SET opening_balance = 1000 WHERE id = bank_id;

  BEGIN
    INSERT INTO public.accounts(owner_id, name, type, opening_balance, opening_date)
    VALUES (v_owner_id, 'Missing type', NULL, 10, opening_day);
    RAISE EXCEPTION 'Account without a type unexpectedly succeeded';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  -- Opening day is inclusive; opening funds also participate in overdraft checks.
  PERFORM public.post_ledger_transaction(
    '30000000-0000-4000-a000-000000000404', bank_id, NULL, 100, 0,
    'Opening-day expense', transaction_at);
  PERFORM public.post_ledger_transaction(
    '30000000-0000-4000-a000-000000000405', NULL, bank_id, 200, 0,
    'Opening-day income', transaction_at);
  PERFORM public.post_ledger_transaction(
    '30000000-0000-4000-a000-000000000406', earlier_bank_id, bank_id, 50, 0,
    'Opening-day transfer', transaction_at);
  PERFORM public.post_ledger_transaction(
    '30000000-0000-4000-a000-000000000407', card_id, NULL, 500, 0,
    'Opening-day card spend', transaction_at);
  IF (SELECT balance FROM public.account_balances WHERE id = bank_id) <> 1150
     OR (SELECT balance FROM public.account_balances WHERE id = earlier_bank_id) <> 350
     OR (SELECT balance FROM public.account_balances WHERE id = card_id) <> -12500 THEN
    RAISE EXCEPTION 'Opening-day transaction totals are incorrect';
  END IF;

  BEGIN
    PERFORM public.post_ledger_transaction(
      '30000000-0000-4000-a000-000000000408', bank_id, NULL, 1, 0,
      'Before opening', before_opening);
    RAISE EXCEPTION 'Backdated expense unexpectedly succeeded';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  BEGIN
    -- This transfer predates its destination account even though its source is open.
    PERFORM public.post_ledger_transaction(
      '30000000-0000-4000-a000-000000000409', earlier_bank_id, bank_id, 1, 0,
      'Before destination opening', before_opening);
    RAISE EXCEPTION 'Backdated transfer unexpectedly succeeded';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  BEGIN
    -- The immediate shadow-contact lend path must hit the same ledger boundary.
    PERFORM public.process_p2p_transaction(
      '30000000-0000-4000-a000-000000000410', v_owner_id, NULL,
      '20000000-0000-4000-a000-000000000404', bank_id,
      10, 'Before opening lend', false, 'lent', before_opening, NULL);
    RAISE EXCEPTION 'Backdated lend unexpectedly succeeded';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  IF EXISTS (SELECT 1 FROM public.transactions
              WHERE public.transactions.owner_id = v_owner_id
                AND (public.transactions.created_at AT TIME ZONE 'Asia/Kolkata')::date < opening_day) THEN
    RAISE EXCEPTION 'A pre-opening ledger row was created';
  END IF;

  BEGIN
    UPDATE public.accounts SET opening_balance = 2000 WHERE id = bank_id;
    RAISE EXCEPTION 'Opening baseline changed after posting';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  SELECT balance INTO current_balance FROM public.account_balances WHERE id = bank_id;
  IF current_balance <> 1150 THEN
    RAISE EXCEPTION 'Failed operations changed the opening balance';
  END IF;
END $$;
RESET ROLE;
ROLLBACK;
SELECT pass('opening balances, inclusive date boundary, transfers, peer lends, immutable baseline, and overdraft calculation verified');
SELECT * FROM finish();

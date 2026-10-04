-- Run after all migrations in an isolated Supabase-schema database only.
-- Synthetic users and ledger rows are rolled back; never points at hosted DB.
SELECT plan(7);
BEGIN;

INSERT INTO auth.users(id, email, raw_user_meta_data) VALUES
  ('00000000-0000-4000-a000-000000000901', 'split-owner@example.invalid', '{}'),
  ('00000000-0000-4000-a000-000000000902', 'split-participant@example.invalid', '{}');
INSERT INTO public.accounts(id, owner_id, name, type, credit_limit, opening_balance, opening_date) VALUES
  ('10000000-0000-4000-a000-000000000901', '00000000-0000-4000-a000-000000000901', 'Split fixture account', 'bank', 0, 1000,
   (statement_timestamp() AT TIME ZONE 'Asia/Kolkata')::date);
INSERT INTO public.contacts(id, owner_id, name) VALUES
  ('20000000-0000-4000-a000-000000000901', '00000000-0000-4000-a000-000000000901', 'Split fixture shadow');
INSERT INTO public.split_groups(id, owner_id, name) VALUES
  ('40000000-0000-4000-a000-000000000901', '00000000-0000-4000-a000-000000000902', 'Other owner group');
INSERT INTO public.split_group_members(group_id, profile_id) VALUES
  ('40000000-0000-4000-a000-000000000901', '00000000-0000-4000-a000-000000000902');

SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-a000-000000000901', true);
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE split_result(transaction_id uuid);
INSERT INTO split_result
SELECT public.process_group_split(
  '00000000-0000-4000-a000-000000000901',
  '10000000-0000-4000-a000-000000000901',
  300, 'Fixture shared meal', NULL,
  '[{"profile_id":"00000000-0000-4000-a000-000000000902","amount":100},
    {"shadow_contact_id":"20000000-0000-4000-a000-000000000901","amount":100}]'::jsonb,
  ((statement_timestamp() AT TIME ZONE 'Asia/Kolkata')::date + time '12:00') AT TIME ZONE 'Asia/Kolkata',
  '30000000-0000-4000-a000-000000000901'
);
DO $$
BEGIN
  BEGIN
    PERFORM public.process_group_split(
      '00000000-0000-4000-a000-000000000901',
      '10000000-0000-4000-a000-000000000901',
      10, 'Foreign group fixture', '40000000-0000-4000-a000-000000000901',
      '[{"profile_id":"00000000-0000-4000-a000-000000000902","amount":5}]'::jsonb,
      ((statement_timestamp() AT TIME ZONE 'Asia/Kolkata')::date + time '12:00') AT TIME ZONE 'Asia/Kolkata',
      '30000000-0000-4000-a000-000000000906'
    );
    RAISE EXCEPTION 'Split RPC accepted another owner''s saved group';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
SELECT pass('a split cannot attach another owner''s saved group');
-- Exact retry must return the existing transaction and not duplicate any row.
SELECT is(
  public.process_group_split(
    '00000000-0000-4000-a000-000000000901',
    '10000000-0000-4000-a000-000000000901',
    300, 'Fixture shared meal', NULL,
    '[{"profile_id":"00000000-0000-4000-a000-000000000902","amount":100},
      {"shadow_contact_id":"20000000-0000-4000-a000-000000000901","amount":100}]'::jsonb,
    ((statement_timestamp() AT TIME ZONE 'Asia/Kolkata')::date + time '12:00') AT TIME ZONE 'Asia/Kolkata',
    '30000000-0000-4000-a000-000000000901'
  ),
  (SELECT transaction_id FROM split_result),
  'group split retry returns the single committed expense'
);
DO $$
BEGIN
  BEGIN
    PERFORM public.process_group_split(
      '00000000-0000-4000-a000-000000000901',
      '10000000-0000-4000-a000-000000000901',
      300, 'Changed payload', NULL,
      '[{"profile_id":"00000000-0000-4000-a000-000000000902","amount":100},
        {"shadow_contact_id":"20000000-0000-4000-a000-000000000901","amount":100}]'::jsonb,
      ((statement_timestamp() AT TIME ZONE 'Asia/Kolkata')::date + time '12:00') AT TIME ZONE 'Asia/Kolkata',
      '30000000-0000-4000-a000-000000000901'
    );
    RAISE EXCEPTION 'Split RPC accepted an idempotency key with a different payload';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  IF (SELECT count(*) FROM public.transactions WHERE owner_id = '00000000-0000-4000-a000-000000000901'
      AND client_request_id = '30000000-0000-4000-a000-000000000901') <> 1 THEN
    RAISE EXCEPTION 'Conflicting idempotency retry changed the committed transaction count';
  END IF;
END $$;
SELECT pass('reusing a split request ID with different bill data is rejected without duplicates');
DO $$
BEGIN
  BEGIN
    PERFORM public.process_group_split(
      '00000000-0000-4000-a000-000000000901',
      '10000000-0000-4000-a000-000000000901',
      10, 'Precision fixture', NULL,
      '[{"profile_id":"00000000-0000-4000-a000-000000000902","amount":1.001}]'::jsonb,
      ((statement_timestamp() AT TIME ZONE 'Asia/Kolkata')::date + time '12:00') AT TIME ZONE 'Asia/Kolkata',
      '30000000-0000-4000-a000-000000000905'
    );
    RAISE EXCEPTION 'Split RPC rounded a share with more than two decimal places';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
END $$;
SELECT pass('split shares reject sub-paisa precision before numeric storage rounds them');
DO $$
DECLARE tx_id uuid := (SELECT transaction_id FROM split_result);
BEGIN
  IF (SELECT count(*) FROM public.transactions WHERE id = tx_id AND owner_id = '00000000-0000-4000-a000-000000000901'
      AND from_account_id = '10000000-0000-4000-a000-000000000901' AND to_account_id IS NULL
      AND amount = 300 AND status = 'COMPLETED') <> 1 THEN
    RAISE EXCEPTION 'Split must create exactly one full source-account expense';
  END IF;
  IF (SELECT balance FROM public.account_balances WHERE id = '10000000-0000-4000-a000-000000000901') <> 700 THEN
    RAISE EXCEPTION 'Full group expense was not deducted from payer account';
  END IF;
  IF (SELECT count(*) FROM public.obligations WHERE related_transaction_id = tx_id AND is_split_share
      AND total_bill_amount = 300) <> 2 THEN
    RAISE EXCEPTION 'One split-share obligation per participant was not created';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.obligations WHERE related_transaction_id = tx_id
      AND debtor_profile_id = '00000000-0000-4000-a000-000000000902'
      AND status = 'PENDING_APPROVAL' AND amount = 100 AND type = 'lent') THEN
    RAISE EXCEPTION 'Registered participant share was not sent for approval';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.obligations WHERE related_transaction_id = tx_id
      AND shadow_contact_id = '20000000-0000-4000-a000-000000000901'
      AND status = 'ACCEPTED' AND amount = 100 AND type = 'lent') THEN
    RAISE EXCEPTION 'Shadow contact share is not immediately active';
  END IF;
END $$;
RESET ROLE;

-- Acceptance as the registered debtor activates only the obligation. It must
-- not post a mirror/income row to the participant's account or ledger.
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-a000-000000000902', true);
SET LOCAL ROLE authenticated;
SELECT public.accept_split_share(
  (SELECT id FROM public.obligations WHERE debtor_profile_id = '00000000-0000-4000-a000-000000000902' AND is_split_share),
  '00000000-0000-4000-a000-000000000902'
);
DO $$
BEGIN
  IF (SELECT status FROM public.obligations WHERE debtor_profile_id = '00000000-0000-4000-a000-000000000902' AND is_split_share) <> 'ACCEPTED' THEN
    RAISE EXCEPTION 'Split approval did not activate the obligation';
  END IF;
  IF EXISTS (SELECT 1 FROM public.transactions WHERE owner_id = '00000000-0000-4000-a000-000000000902') THEN
    RAISE EXCEPTION 'Split acceptance created a receiver transaction';
  END IF;
END $$;
RESET ROLE;
SELECT pass('accepting a split share activates the obligation without mirroring a transaction');

-- Force an error after the master expense insert. The enclosing RPC statement
-- must roll the transaction back, proving expense, contacts, and shares are atomic.
CREATE FUNCTION pg_temp.reject_atomicity_fixture_share() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.description = 'Atomic failure fixture' THEN
    RAISE EXCEPTION 'injected split-share failure' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER reject_atomicity_fixture_share
  BEFORE INSERT ON public.obligations
  FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_atomicity_fixture_share();
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-a000-000000000901', true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE v_failed boolean := false;
BEGIN
  BEGIN
    PERFORM public.process_group_split(
      '00000000-0000-4000-a000-000000000901',
      '10000000-0000-4000-a000-000000000901',
      30, 'Atomic failure fixture', NULL,
      '[{"profile_id":"00000000-0000-4000-a000-000000000902","amount":10}]'::jsonb,
      ((statement_timestamp() AT TIME ZONE 'Asia/Kolkata')::date + time '12:00') AT TIME ZONE 'Asia/Kolkata',
      '30000000-0000-4000-a000-000000000903'
    );
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'Injected share failure did not abort the split'; END IF;
  IF EXISTS (SELECT 1 FROM public.transactions
      WHERE owner_id = '00000000-0000-4000-a000-000000000901'
        AND client_request_id = '30000000-0000-4000-a000-000000000903') THEN
    RAISE EXCEPTION 'Failed split left its master expense committed';
  END IF;
END $$;
RESET ROLE;
DROP TRIGGER reject_atomicity_fixture_share ON public.obligations;
DROP FUNCTION pg_temp.reject_atomicity_fixture_share();
SELECT pass('a share insert failure rolls back the full expense atomically');

-- Authenticated callers must not be able to create a split for another owner.
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-a000-000000000902', true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN
    PERFORM public.process_group_split(
      '00000000-0000-4000-a000-000000000901',
      '10000000-0000-4000-a000-000000000901', 10, 'Unauthorized', NULL,
      '[{"shadow_contact_id":"20000000-0000-4000-a000-000000000901","amount":10}]'::jsonb,
      statement_timestamp(), '30000000-0000-4000-a000-000000000902'
    );
    RAISE EXCEPTION 'Split RPC allowed owner impersonation';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;

-- Declining a separate share uses the existing P2P decline path and preserves
-- the reason for the initiator without posting a transaction for the receiver.
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-a000-000000000901', true);
SET LOCAL ROLE authenticated;
SELECT public.process_group_split(
  '00000000-0000-4000-a000-000000000901',
  '10000000-0000-4000-a000-000000000901',
  300, 'Decline fixture', NULL,
  '[{"profile_id":"00000000-0000-4000-a000-000000000902","amount":100}]'::jsonb,
  ((statement_timestamp() AT TIME ZONE 'Asia/Kolkata')::date + time '12:00') AT TIME ZONE 'Asia/Kolkata',
  '30000000-0000-4000-a000-000000000904'
);
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-a000-000000000902', true);
SET LOCAL ROLE authenticated;
SELECT public.decline_p2p_obligation(
  (SELECT id FROM public.obligations WHERE debtor_profile_id = '00000000-0000-4000-a000-000000000902'
    AND description = 'Decline fixture' AND is_split_share),
  'Incorrect amount'
);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.transactions WHERE owner_id = '00000000-0000-4000-a000-000000000902') THEN
    RAISE EXCEPTION 'Declining a split share created a receiver transaction';
  END IF;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-a000-000000000901', true);
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.obligations WHERE debtor_profile_id = '00000000-0000-4000-a000-000000000902'
      AND description = 'Decline fixture' AND is_split_share AND status = 'DECLINED'
      AND decline_reason = 'Incorrect amount') THEN
    RAISE EXCEPTION 'Split decline state/reason was not visible to the initiator';
  END IF;
END $$;
RESET ROLE;
SELECT pass('declining a split share preserves the reason without a receiver ledger entry');
SELECT * FROM finish();
-- Run pgTAP's finish before rolling back so its assertion records are still
-- visible. The fixtures and pgTAP state are then both discarded.
ROLLBACK;

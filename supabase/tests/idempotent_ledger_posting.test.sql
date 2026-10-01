-- Run against an isolated database with the production schema and migrations.
-- All fixtures and writes are rolled back.
BEGIN;
INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
  ('00000000-0000-4000-a000-000000000021','posting-a@example.invalid','{}'),
  ('00000000-0000-4000-a000-000000000022','posting-b@example.invalid','{}');
INSERT INTO public.accounts(id,owner_id,name,type) VALUES
  ('10000000-0000-4000-a000-000000000021','00000000-0000-4000-a000-000000000021','A','bank'),
  ('10000000-0000-4000-a000-000000000022','00000000-0000-4000-a000-000000000022','B','bank');
INSERT INTO public.obligations(id,owner_id,type,amount,total_amount,status) VALUES
  ('20000000-0000-4000-a000-000000000021','00000000-0000-4000-a000-000000000021','borrowed',50,50,'ACCEPTED'),
  ('20000000-0000-4000-a000-000000000022','00000000-0000-4000-a000-000000000022','borrowed',50,50,'ACCEPTED');
INSERT INTO public.transactions(owner_id,initiator_profile_id,to_account_id,amount,status)
  VALUES ('00000000-0000-4000-a000-000000000021',
          '00000000-0000-4000-a000-000000000021',
          '10000000-0000-4000-a000-000000000021',100,'COMPLETED');
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-a000-000000000021',true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  a uuid := '10000000-0000-4000-a000-000000000021';
  other_account uuid := '10000000-0000-4000-a000-000000000022';
  debt uuid := '20000000-0000-4000-a000-000000000021';
  other_debt uuid := '20000000-0000-4000-a000-000000000022';
  request_id uuid := '30000000-0000-4000-a000-000000000021';
  posted_at timestamptz := now();
  first_id uuid;
  retry_id uuid;
  new_tx_id uuid;
  new_contact_id uuid;
BEGIN
  first_id := public.post_ledger_transaction(request_id,a,NULL,20,0,'Payment',posted_at,NULL,NULL,debt);
  retry_id := public.post_ledger_transaction(request_id,a,NULL,20,0,'Payment',posted_at,NULL,NULL,debt);
  IF first_id IS DISTINCT FROM retry_id THEN RAISE EXCEPTION 'Retry changed transaction ID'; END IF;
  IF (SELECT count(*) FROM public.transactions WHERE client_request_id=request_id) <> 1 THEN
    RAISE EXCEPTION 'Retry duplicated ledger entry';
  END IF;
  IF (SELECT amount FROM public.obligations WHERE id=debt) <> 30 THEN
    RAISE EXCEPTION 'Outstanding debt was reduced incorrectly';
  END IF;
  new_tx_id := public.post_ledger_transaction(
    gen_random_uuid(),a,NULL,1,0,'New contact',posted_at,NULL,NULL,NULL,'Queued Contact'
  );
  SELECT t.contact_id INTO new_contact_id FROM public.transactions t WHERE t.id=new_tx_id;
  UPDATE public.contacts SET name='Renamed Contact' WHERE id=new_contact_id;
  -- Contact merging is allowed to change only the label fields on a posted
  -- financial entry. The original request must still be safe to retry.
  PERFORM public.merge_shadow_contact(new_contact_id,
    '00000000-0000-4000-a000-000000000022');
  -- Reuse the exact request ID found on the first posted row.
  retry_id := public.post_ledger_transaction(
    (SELECT client_request_id FROM public.transactions WHERE id=new_tx_id),
    a,NULL,1,0,'New contact',posted_at,NULL,NULL,NULL,'Queued Contact'
  );
  IF new_tx_id IS DISTINCT FROM retry_id OR
     (SELECT count(*) FROM public.contacts
       WHERE owner_id='00000000-0000-4000-a000-000000000021'
         AND name='Renamed Contact') <> 0 OR
     NOT EXISTS (SELECT 1 FROM public.transactions
       WHERE id=new_tx_id AND contact_id IS NULL
         AND tagged_profile_id='00000000-0000-4000-a000-000000000022') THEN
    RAISE EXCEPTION 'New contact retry duplicated a record';
  END IF;
  BEGIN
    UPDATE public.transactions SET amount=1 WHERE id=first_id;
    RAISE EXCEPTION 'Posted ledger entry was editable';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    DELETE FROM public.transactions WHERE id=first_id;
    RAISE EXCEPTION 'Posted ledger entry was deletable';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.post_ledger_transaction(request_id,a,NULL,21,0,'Payment',posted_at,NULL,NULL,debt);
    RAISE EXCEPTION 'Changed retry was accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    PERFORM public.post_ledger_transaction(gen_random_uuid(),other_account,NULL,1,0,'Foreign account',posted_at);
    RAISE EXCEPTION 'Foreign account was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.post_ledger_transaction(gen_random_uuid(),a,NULL,1,0,'Foreign debt',posted_at,NULL,NULL,other_debt);
    RAISE EXCEPTION 'Foreign debt was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.post_ledger_transaction(gen_random_uuid(),a,NULL,31,0,'Overpayment',posted_at,NULL,NULL,debt);
    RAISE EXCEPTION 'Overpayment was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  IF (SELECT count(*) FROM public.transactions WHERE owner_id='00000000-0000-4000-a000-000000000021') <> 3 THEN
    RAISE EXCEPTION 'Rejected calls posted a transaction';
  END IF;
  BEGIN
    INSERT INTO public.transactions(owner_id, initiator_profile_id, from_account_id,
                                    amount, status, description)
      VALUES ('00000000-0000-4000-a000-000000000021',
              '00000000-0000-4000-a000-000000000021',a,1,'COMPLETED','Legacy entry');
    RAISE EXCEPTION 'Direct non-idempotent ledger insert succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.obligation_payments
      WHERE obligation_id='20000000-0000-4000-a000-000000000021') <> 1 THEN
    RAISE EXCEPTION 'Retry duplicated or omitted debt link';
  END IF;
END $$;
ROLLBACK;
SELECT 'PASS: idempotent transaction and debt link; foreign account/debt and overpayment denied' AS result;
SELECT plan(1);
SELECT pass('idempotent-ledger SQL assertions completed without exception');
SELECT * FROM finish();

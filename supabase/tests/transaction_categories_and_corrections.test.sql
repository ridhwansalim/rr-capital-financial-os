-- Run in the isolated Supabase test database. The enclosing rollback preserves it.
BEGIN;
INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
  ('00000000-0000-4000-a000-000000000061','category-a@example.invalid','{}'),
  ('00000000-0000-4000-a000-000000000062','category-b@example.invalid','{}');
INSERT INTO public.accounts(id,owner_id,name,type) VALUES
  ('10000000-0000-4000-a000-000000000061','00000000-0000-4000-a000-000000000061','A','bank'),
  ('10000000-0000-4000-a000-000000000062','00000000-0000-4000-a000-000000000062','B','bank'),
  ('10000000-0000-4000-a000-000000000063','00000000-0000-4000-a000-000000000061','C','bank');
INSERT INTO public.accounts(id,owner_id,name,type,opening_balance,opening_date) VALUES
  ('10000000-0000-4000-a000-000000000064','00000000-0000-4000-a000-000000000061',
   'Historical correction bank','bank',0,'2024-01-01');
INSERT INTO public.transaction_categories(id,owner_id,name,color) VALUES
  ('30000000-0000-4000-a000-000000000061','00000000-0000-4000-a000-000000000061','Salary','#34d399'),
  ('30000000-0000-4000-a000-000000000062','00000000-0000-4000-a000-000000000062','Private','#fb7185');
INSERT INTO public.transactions(id,owner_id,initiator_profile_id,to_account_id,amount,description,status,created_at,category_id)
VALUES ('20000000-0000-4000-a000-000000000061','00000000-0000-4000-a000-000000000061',
        '00000000-0000-4000-a000-000000000061','10000000-0000-4000-a000-000000000061',100,
        'Test income','COMPLETED',now(),'30000000-0000-4000-a000-000000000061');
INSERT INTO public.transactions(id,owner_id,initiator_profile_id,to_account_id,amount,description,status,created_at)
VALUES ('20000000-0000-4000-a000-000000000062','00000000-0000-4000-a000-000000000061',
        '00000000-0000-4000-a000-000000000061','10000000-0000-4000-a000-000000000063',10,
        'Debt advance','COMPLETED',now());
INSERT INTO public.transactions(id,owner_id,initiator_profile_id,to_account_id,amount,description,status,created_at)
VALUES ('20000000-0000-4000-a000-000000000063','00000000-0000-4000-a000-000000000061',
        '00000000-0000-4000-a000-000000000061','10000000-0000-4000-a000-000000000064',100,
        'Historical income','COMPLETED','2024-01-02 12:00:00+05:30');
INSERT INTO public.transactions(id,owner_id,initiator_profile_id,from_account_id,amount,description,status,created_at)
VALUES ('20000000-0000-4000-a000-000000000064','00000000-0000-4000-a000-000000000061',
        '00000000-0000-4000-a000-000000000061','10000000-0000-4000-a000-000000000064',80,
        'Later expense','COMPLETED','2024-01-03 12:00:00+05:30');
INSERT INTO public.obligations(id,owner_id,type,amount,total_amount,status,related_transaction_id)
VALUES ('50000000-0000-4000-a000-000000000061','00000000-0000-4000-a000-000000000061',
        'lent',10,10,'ACCEPTED','20000000-0000-4000-a000-000000000062');

SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-a000-000000000061',true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE replacement uuid; retry uuid;
BEGIN
  IF (SELECT count(*) FROM public.transaction_categories) <> 1 THEN
    RAISE EXCEPTION 'Category RLS exposed another owner category';
  END IF;
  replacement := public.correct_ledger_transaction(
    '40000000-0000-4000-a000-000000000061',
    '20000000-0000-4000-a000-000000000061',80,'Corrected income',now(),'Wrong amount entered'
  );
  retry := public.correct_ledger_transaction(
    '40000000-0000-4000-a000-000000000061',
    '20000000-0000-4000-a000-000000000061',80,'Corrected income',now(),'Wrong amount entered'
  );
  IF replacement IS DISTINCT FROM retry THEN RAISE EXCEPTION 'Correction retry changed ID'; END IF;
  BEGIN
    PERFORM public.correct_ledger_transaction(
      '40000000-0000-4000-a000-000000000061',
      '20000000-0000-4000-a000-000000000061',81,'Changed correction retry',now(),'Wrong amount entered'
    );
    RAISE EXCEPTION 'Correction retry accepted changed replacement data';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  IF (SELECT count(*) FROM public.transactions
       WHERE owner_id='00000000-0000-4000-a000-000000000061'
         AND client_request_id='40000000-0000-4000-a000-000000000061') <> 1 THEN
    RAISE EXCEPTION 'Changed correction retry created another ledger entry';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.transactions WHERE id='20000000-0000-4000-a000-000000000061' AND status='VOIDED')
     OR NOT EXISTS (SELECT 1 FROM public.transactions WHERE id=replacement AND amount=80
                    AND category_id='30000000-0000-4000-a000-000000000061') THEN
    RAISE EXCEPTION 'Corrected entry did not preserve history and category';
  END IF;
  IF (SELECT balance FROM public.account_balances WHERE id='10000000-0000-4000-a000-000000000061') <> 80 THEN
    RAISE EXCEPTION 'Corrected balance is wrong';
  END IF;
  PERFORM public.void_ledger_transaction(replacement,'Duplicate entry');
  IF (SELECT balance FROM public.account_balances WHERE id='10000000-0000-4000-a000-000000000061') <> 0 THEN
    RAISE EXCEPTION 'Voided entry still affects balance';
  END IF;
  BEGIN
    PERFORM public.void_ledger_transaction('20000000-0000-4000-a000-000000000062','Linked debt');
    RAISE EXCEPTION 'Linked obligation entry was voided';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
  END;
  BEGIN
    PERFORM public.correct_ledger_transaction(gen_random_uuid(),
      '20000000-0000-4000-a000-000000000062',9,'Changed debt entry',now(),'Linked debt');
    RAISE EXCEPTION 'Linked obligation entry was corrected';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
  END;
  BEGIN
    PERFORM public.set_transaction_category(replacement,'30000000-0000-4000-a000-000000000062');
    RAISE EXCEPTION 'Foreign category was accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.correct_ledger_transaction(
      '40000000-0000-4000-a000-000000000063',
      '20000000-0000-4000-a000-000000000063',
      50,'Incorrectly reduced historical income','2024-01-02 12:00:00+05:30',
      'Synthetic historical balance regression'
    );
    RAISE EXCEPTION 'Correction that overdraws later history was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  IF (SELECT status FROM public.transactions WHERE id='20000000-0000-4000-a000-000000000063') <> 'COMPLETED'
     OR (SELECT count(*) FROM public.transactions
          WHERE owner_id='00000000-0000-4000-a000-000000000061'
            AND (from_account_id='10000000-0000-4000-a000-000000000064'
              OR to_account_id='10000000-0000-4000-a000-000000000064')) <> 2
     OR (SELECT balance FROM public.account_balances
          WHERE id='10000000-0000-4000-a000-000000000064') <> 20 THEN
    RAISE EXCEPTION 'Rejected historical correction partially changed transaction or balance state';
  END IF;
END $$;
RESET ROLE;
ROLLBACK;
SELECT 'PASS: category ownership, audit-safe edit/void, retry idempotency, and balances' AS result;
SELECT plan(2);
SELECT pass('category and correction SQL assertions completed without exception');
SELECT pass('corrections that create a later historical overdraft roll back atomically');
SELECT * FROM finish();

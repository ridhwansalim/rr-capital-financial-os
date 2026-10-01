-- Run in the isolated Supabase test database. The enclosing rollback preserves it.
BEGIN;
INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
  ('00000000-0000-4000-a000-000000000061','category-a@example.invalid','{}'),
  ('00000000-0000-4000-a000-000000000062','category-b@example.invalid','{}');
INSERT INTO public.accounts(id,owner_id,name,type) VALUES
  ('10000000-0000-4000-a000-000000000061','00000000-0000-4000-a000-000000000061','A','bank'),
  ('10000000-0000-4000-a000-000000000062','00000000-0000-4000-a000-000000000062','B','bank'),
  ('10000000-0000-4000-a000-000000000063','00000000-0000-4000-a000-000000000061','C','bank');
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
END $$;
RESET ROLE;
ROLLBACK;
SELECT 'PASS: category ownership, audit-safe edit/void, retry idempotency, and balances' AS result;
SELECT plan(1);
SELECT pass('category and correction SQL assertions completed without exception');
SELECT * FROM finish();

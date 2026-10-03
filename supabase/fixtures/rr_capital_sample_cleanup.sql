-- RR Capital sample-data cleanup.
-- Run only after an explicit request to clear the sample dataset.
-- Deletes only the fixed fixture rows created by rr_capital_sample_seed.sql.
BEGIN;

-- Fail closed if the fixture owner changed or any real/unrecognized records
-- were added after the seed. Never erase activity merely because it shares a
-- sample account or carries a similar label.
DO $$
DECLARE
  v_owner uuid := '5bf09e85-e346-4c79-808f-29d8577d04ae';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_owner)
     OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_owner) THEN
    RAISE EXCEPTION 'Cleanup guard: expected RR Capital sample owner/profile is missing';
  END IF;

  IF (SELECT count(*) FROM public.accounts
       WHERE id IN (
         'f37a0b61-7118-4bc2-a7f6-000000000011',
         'f37a0b61-7118-4bc2-a7f6-000000000012',
         'f37a0b61-7118-4bc2-a7f6-000000000013'
       ) AND owner_id = v_owner) <> 3 THEN
    RAISE EXCEPTION 'Cleanup guard: the three fixture accounts do not match the expected owner';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.transactions
     WHERE (from_account_id IN (
       'f37a0b61-7118-4bc2-a7f6-000000000011',
       'f37a0b61-7118-4bc2-a7f6-000000000012',
       'f37a0b61-7118-4bc2-a7f6-000000000013'
     ) OR to_account_id IN (
       'f37a0b61-7118-4bc2-a7f6-000000000011',
       'f37a0b61-7118-4bc2-a7f6-000000000012',
       'f37a0b61-7118-4bc2-a7f6-000000000013'
     )) AND (owner_id <> v_owner OR description NOT LIKE '[RR SAMPLE]%')
  ) THEN
    RAISE EXCEPTION 'Cleanup guard: a fixture account contains a non-sample or differently owned transaction';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.accounts
     WHERE name LIKE '[RR SAMPLE]%'
       AND id NOT IN (
         'f37a0b61-7118-4bc2-a7f6-000000000011',
         'f37a0b61-7118-4bc2-a7f6-000000000012',
         'f37a0b61-7118-4bc2-a7f6-000000000013'
       )
  ) OR EXISTS (
    SELECT 1 FROM public.transaction_categories
     WHERE name LIKE '[RR SAMPLE]%'
       AND id NOT IN (
         'f37a0b61-7118-4bc2-a7f6-000000000c11',
         'f37a0b61-7118-4bc2-a7f6-000000000c12',
         'f37a0b61-7118-4bc2-a7f6-000000000c13',
         'f37a0b61-7118-4bc2-a7f6-000000000c14',
         'f37a0b61-7118-4bc2-a7f6-000000000c15',
         'f37a0b61-7118-4bc2-a7f6-000000000c16',
         'f37a0b61-7118-4bc2-a7f6-000000000c17',
         'f37a0b61-7118-4bc2-a7f6-000000000c18',
         'f37a0b61-7118-4bc2-a7f6-000000000c19',
         'f37a0b61-7118-4bc2-a7f6-000000000c20',
         'f37a0b61-7118-4bc2-a7f6-209b826a0c01',
         'f37a0b61-7118-4bc2-a7f6-209b826a0c02'
       )
  ) THEN
    RAISE EXCEPTION 'Cleanup guard: unrecognized sample-labeled accounts or categories exist';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.transaction_categories
     WHERE id IN (
       'f37a0b61-7118-4bc2-a7f6-000000000c11',
       'f37a0b61-7118-4bc2-a7f6-000000000c12',
       'f37a0b61-7118-4bc2-a7f6-000000000c13',
       'f37a0b61-7118-4bc2-a7f6-000000000c14',
       'f37a0b61-7118-4bc2-a7f6-000000000c15',
       'f37a0b61-7118-4bc2-a7f6-000000000c16',
       'f37a0b61-7118-4bc2-a7f6-000000000c17',
       'f37a0b61-7118-4bc2-a7f6-000000000c18',
       'f37a0b61-7118-4bc2-a7f6-000000000c19',
       'f37a0b61-7118-4bc2-a7f6-000000000c20',
       'f37a0b61-7118-4bc2-a7f6-209b826a0c01',
       'f37a0b61-7118-4bc2-a7f6-209b826a0c02'
     ) AND owner_id <> v_owner
  ) THEN
    RAISE EXCEPTION 'Cleanup guard: a fixture category belongs to a different owner';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.transactions
     WHERE description LIKE '[RR SAMPLE]%'
       AND NOT (
         coalesce(from_account_id IN (
           'f37a0b61-7118-4bc2-a7f6-000000000011',
           'f37a0b61-7118-4bc2-a7f6-000000000012',
           'f37a0b61-7118-4bc2-a7f6-000000000013'
         ), false)
         OR coalesce(to_account_id IN (
           'f37a0b61-7118-4bc2-a7f6-000000000011',
           'f37a0b61-7118-4bc2-a7f6-000000000012',
           'f37a0b61-7118-4bc2-a7f6-000000000013'
         ), false)
       )
       AND id NOT IN (
         'f37a0b61-7118-4bc2-a7f6-209b826a0d01',
         'f37a0b61-7118-4bc2-a7f6-209b826a0d02',
         'f37a0b61-7118-4bc2-a7f6-209b826a0d03',
         'f37a0b61-7118-4bc2-a7f6-209b826a0d04',
         'f37a0b61-7118-4bc2-a7f6-209b826a0d05',
         'f37a0b61-7118-4bc2-a7f6-209b826a0d06'
       )
  ) THEN
    RAISE EXCEPTION 'Cleanup guard: unrecognized sample-labeled transactions exist';
  END IF;
END $$;

-- Three-year chart/ledger fixture accounts added on 2026-10-03. Delete only
-- transactions attached to these dedicated fixture accounts, then the accounts.
DELETE FROM public.transactions
 WHERE owner_id = '5bf09e85-e346-4c79-808f-29d8577d04ae'
   AND description LIKE '[RR SAMPLE]%'
   AND (from_account_id IN (
   'f37a0b61-7118-4bc2-a7f6-000000000011',
   'f37a0b61-7118-4bc2-a7f6-000000000012',
   'f37a0b61-7118-4bc2-a7f6-000000000013'
 ) OR to_account_id IN (
   'f37a0b61-7118-4bc2-a7f6-000000000011',
   'f37a0b61-7118-4bc2-a7f6-000000000012',
   'f37a0b61-7118-4bc2-a7f6-000000000013'
 ));

DELETE FROM public.accounts
 WHERE id IN (
   'f37a0b61-7118-4bc2-a7f6-000000000011',
   'f37a0b61-7118-4bc2-a7f6-000000000012',
   'f37a0b61-7118-4bc2-a7f6-000000000013'
 ) AND owner_id = '5bf09e85-e346-4c79-808f-29d8577d04ae';

DELETE FROM public.recurring_emis
 WHERE id = 'f37a0b61-7118-4bc2-a7f6-209b826a1004'
   AND owner_id = '5bf09e85-e346-4c79-808f-29d8577d04ae';

DELETE FROM public.chittis
 WHERE id = 'f37a0b61-7118-4bc2-a7f6-209b826a1003'
   AND owner_id = '5bf09e85-e346-4c79-808f-29d8577d04ae';

DELETE FROM public.obligations
 WHERE id IN (
   'f37a0b61-7118-4bc2-a7f6-209b826a1001',
   'f37a0b61-7118-4bc2-a7f6-209b826a1002'
 ) AND owner_id = '5bf09e85-e346-4c79-808f-29d8577d04ae';

DELETE FROM public.transactions
 WHERE id IN (
   'f37a0b61-7118-4bc2-a7f6-209b826a0d01',
   'f37a0b61-7118-4bc2-a7f6-209b826a0d02',
   'f37a0b61-7118-4bc2-a7f6-209b826a0d03',
   'f37a0b61-7118-4bc2-a7f6-209b826a0d04',
   'f37a0b61-7118-4bc2-a7f6-209b826a0d05',
   'f37a0b61-7118-4bc2-a7f6-209b826a0d06'
 ) AND owner_id = '5bf09e85-e346-4c79-808f-29d8577d04ae';

DELETE FROM public.contacts
 WHERE id = 'f37a0b61-7118-4bc2-a7f6-209b826a0f01'
   AND owner_id = '5bf09e85-e346-4c79-808f-29d8577d04ae';

DELETE FROM public.transaction_categories
 WHERE id IN (
   'f37a0b61-7118-4bc2-a7f6-000000000c11',
   'f37a0b61-7118-4bc2-a7f6-000000000c12',
   'f37a0b61-7118-4bc2-a7f6-000000000c13',
   'f37a0b61-7118-4bc2-a7f6-000000000c14',
   'f37a0b61-7118-4bc2-a7f6-000000000c15',
   'f37a0b61-7118-4bc2-a7f6-000000000c16',
   'f37a0b61-7118-4bc2-a7f6-000000000c17',
   'f37a0b61-7118-4bc2-a7f6-000000000c18',
   'f37a0b61-7118-4bc2-a7f6-000000000c19',
   'f37a0b61-7118-4bc2-a7f6-000000000c20',
   'f37a0b61-7118-4bc2-a7f6-209b826a0c01',
   'f37a0b61-7118-4bc2-a7f6-209b826a0c02'
 ) AND owner_id = '5bf09e85-e346-4c79-808f-29d8577d04ae';

DELETE FROM public.accounts
 WHERE id IN (
   'f37a0b61-7118-4bc2-a7f6-209b826a0b01',
   'f37a0b61-7118-4bc2-a7f6-209b826a0b02',
   'f37a0b61-7118-4bc2-a7f6-209b826a0b03'
 ) AND owner_id = '5bf09e85-e346-4c79-808f-29d8577d04ae';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.accounts WHERE id IN (
    'f37a0b61-7118-4bc2-a7f6-000000000011',
    'f37a0b61-7118-4bc2-a7f6-000000000012',
    'f37a0b61-7118-4bc2-a7f6-000000000013',
    'f37a0b61-7118-4bc2-a7f6-209b826a0b01',
    'f37a0b61-7118-4bc2-a7f6-209b826a0b02',
    'f37a0b61-7118-4bc2-a7f6-209b826a0b03'
  )) OR EXISTS (SELECT 1 FROM public.transactions WHERE description LIKE '[RR SAMPLE]%')
    OR EXISTS (SELECT 1 FROM public.transactions WHERE id IN (
      'f37a0b61-7118-4bc2-a7f6-209b826a0d01',
      'f37a0b61-7118-4bc2-a7f6-209b826a0d02',
      'f37a0b61-7118-4bc2-a7f6-209b826a0d03',
      'f37a0b61-7118-4bc2-a7f6-209b826a0d04',
      'f37a0b61-7118-4bc2-a7f6-209b826a0d05',
      'f37a0b61-7118-4bc2-a7f6-209b826a0d06'
    )) OR EXISTS (SELECT 1 FROM public.transaction_categories WHERE name LIKE '[RR SAMPLE]%')
    OR EXISTS (SELECT 1 FROM public.transaction_categories WHERE id IN (
      'f37a0b61-7118-4bc2-a7f6-000000000c11',
      'f37a0b61-7118-4bc2-a7f6-000000000c12',
      'f37a0b61-7118-4bc2-a7f6-000000000c13',
      'f37a0b61-7118-4bc2-a7f6-000000000c14',
      'f37a0b61-7118-4bc2-a7f6-000000000c15',
      'f37a0b61-7118-4bc2-a7f6-000000000c16',
      'f37a0b61-7118-4bc2-a7f6-000000000c17',
      'f37a0b61-7118-4bc2-a7f6-000000000c18',
      'f37a0b61-7118-4bc2-a7f6-000000000c19',
      'f37a0b61-7118-4bc2-a7f6-000000000c20',
      'f37a0b61-7118-4bc2-a7f6-209b826a0c01',
      'f37a0b61-7118-4bc2-a7f6-209b826a0c02'
    ))
    OR EXISTS (SELECT 1 FROM public.obligations WHERE id IN (
      'f37a0b61-7118-4bc2-a7f6-209b826a1001',
      'f37a0b61-7118-4bc2-a7f6-209b826a1002'
    )) OR EXISTS (SELECT 1 FROM public.chittis WHERE id = 'f37a0b61-7118-4bc2-a7f6-209b826a1003')
      OR EXISTS (SELECT 1 FROM public.recurring_emis WHERE id = 'f37a0b61-7118-4bc2-a7f6-209b826a1004')
      OR EXISTS (SELECT 1 FROM public.contacts WHERE id = 'f37a0b61-7118-4bc2-a7f6-209b826a0f01') THEN
    RAISE EXCEPTION 'Cleanup postcondition failed; rolling back the fixture cleanup';
  END IF;
END $$;

COMMIT;

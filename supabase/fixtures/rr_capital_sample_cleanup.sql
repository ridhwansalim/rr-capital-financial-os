-- RR Capital evaluation fixture cleanup. Run only after the user asks to clear data.
-- Deletes fixed IDs in the a7300000-0000-4000-8000-* fixture namespace only.
-- Refuses to proceed if fixture accounts have acquired any unrecognized ledger activity.
BEGIN;
DO $$
DECLARE v_owner uuid := '5bf09e85-e346-4c79-808f-29d8577d04ae';
BEGIN
  IF (SELECT count(*) FROM auth.users) <> 1
     OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_owner)
     OR (SELECT count(*) FROM public.profiles WHERE id = v_owner) <> 1 THEN
    RAISE EXCEPTION 'Cleanup guard: expected the dedicated RR Capital test owner';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.transactions t
    WHERE (t.from_account_id::text LIKE 'a7300000-0000-4000-8000-%'
        OR t.to_account_id::text LIKE 'a7300000-0000-4000-8000-%')
      AND (t.owner_id <> v_owner OR t.id::text NOT LIKE 'a7300000-0000-4000-8003-%'
           OR t.description NOT LIKE '[RR SAMPLE]%')
  ) THEN RAISE EXCEPTION 'Cleanup guard: unrecognized activity is attached to a fixture account'; END IF;
  IF EXISTS (SELECT 1 FROM public.accounts WHERE id::text LIKE 'a7300000-0000-4000-8000-%' AND owner_id <> v_owner)
     OR EXISTS (SELECT 1 FROM public.transaction_categories WHERE id::text LIKE 'a7300000-0000-4000-8002-%' AND owner_id <> v_owner)
     OR EXISTS (SELECT 1 FROM public.obligations WHERE id::text LIKE 'a7300000-0000-4000-8005-%' AND owner_id <> v_owner)
     OR EXISTS (SELECT 1 FROM public.recurring_emis WHERE id::text LIKE 'a7300000-0000-4000-8006-%' AND owner_id <> v_owner)
  THEN RAISE EXCEPTION 'Cleanup guard: a fixture ID belongs to a different owner'; END IF;
END $$;

DELETE FROM public.shopping_list_items WHERE id::text LIKE 'a7300000-0000-4000-8013-%' AND owner_id='5bf09e85-e346-4c79-808f-29d8577d04ae';
DELETE FROM public.shopping_lists WHERE id::text LIKE 'a7300000-0000-4000-8012-%' AND owner_id='5bf09e85-e346-4c79-808f-29d8577d04ae';
DELETE FROM public.savings_goal_contributions WHERE id::text LIKE 'a7300000-0000-4000-8011-%' AND owner_id='5bf09e85-e346-4c79-808f-29d8577d04ae';
DELETE FROM public.savings_goals WHERE id::text LIKE 'a7300000-0000-4000-8010-%' AND owner_id='5bf09e85-e346-4c79-808f-29d8577d04ae';
DELETE FROM public.transaction_templates WHERE id::text LIKE 'a7300000-0000-4000-8009-%' AND owner_id='5bf09e85-e346-4c79-808f-29d8577d04ae';
DELETE FROM public.budget_envelopes WHERE id::text LIKE 'a7300000-0000-4000-8008-%' AND owner_id='5bf09e85-e346-4c79-808f-29d8577d04ae';
DELETE FROM public.chittis WHERE id::text LIKE 'a7300000-0000-4000-8007-%' AND owner_id='5bf09e85-e346-4c79-808f-29d8577d04ae';
DELETE FROM public.recurring_emis WHERE id::text LIKE 'a7300000-0000-4000-8006-%' AND owner_id='5bf09e85-e346-4c79-808f-29d8577d04ae';
DELETE FROM public.obligations WHERE id::text LIKE 'a7300000-0000-4000-8005-%' AND owner_id='5bf09e85-e346-4c79-808f-29d8577d04ae';
DELETE FROM public.transactions WHERE id::text LIKE 'a7300000-0000-4000-8003-%' AND owner_id='5bf09e85-e346-4c79-808f-29d8577d04ae';
DELETE FROM public.transaction_categories WHERE id::text LIKE 'a7300000-0000-4000-8002-%' AND owner_id='5bf09e85-e346-4c79-808f-29d8577d04ae';
DELETE FROM public.contacts WHERE id::text LIKE 'a7300000-0000-4000-8001-%' AND owner_id='5bf09e85-e346-4c79-808f-29d8577d04ae';
DELETE FROM public.accounts WHERE id::text LIKE 'a7300000-0000-4000-8000-%' AND owner_id='5bf09e85-e346-4c79-808f-29d8577d04ae';
DELETE FROM public.parties WHERE id::text LIKE 'a7300000-0000-4000-8004-%';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.accounts WHERE id::text LIKE 'a7300000-0000-4000-8000-%')
     OR EXISTS (SELECT 1 FROM public.transactions WHERE id::text LIKE 'a7300000-0000-4000-8003-%')
     OR EXISTS (SELECT 1 FROM public.parties WHERE id::text LIKE 'a7300000-0000-4000-8004-%')
  THEN RAISE EXCEPTION 'Cleanup postcondition failed'; END IF;
END $$;
COMMIT;

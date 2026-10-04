-- RR Capital evaluation fixture cleanup. Run only after the user asks to clear data.
-- Deletes fixed IDs in the a7300000-0000-4000-8000-* fixture namespace only.
-- Refuses to proceed if fixture rows have acquired unrecognized links or financial history.
BEGIN;
DO $$
DECLARE
  v_owner uuid := '5bf09e85-e346-4c79-808f-29d8577d04ae';
  v_referenced boolean;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_owner)
     OR (SELECT count(*) FROM public.profiles WHERE id = v_owner) <> 1 THEN
    RAISE EXCEPTION 'Cleanup guard: expected the dedicated RR Capital test owner';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.transactions t
    WHERE (t.from_account_id::text LIKE 'a7300000-0000-4000-8000-%'
        OR t.to_account_id::text LIKE 'a7300000-0000-4000-8000-%'
        OR t.contact_id::text LIKE 'a7300000-0000-4000-8001-%'
        OR t.category_id::text LIKE 'a7300000-0000-4000-8002-%'
        OR t.id::text LIKE 'a7300000-0000-4000-8003-%')
      AND NOT (
        t.owner_id = v_owner
        AND t.id::text LIKE 'a7300000-0000-4000-8003-%'
        AND t.description LIKE '[RR SAMPLE]%'
        AND (t.from_account_id IS NULL OR t.from_account_id::text LIKE 'a7300000-0000-4000-8000-%')
        AND (t.to_account_id IS NULL OR t.to_account_id::text LIKE 'a7300000-0000-4000-8000-%')
        AND (t.contact_id IS NULL OR t.contact_id::text LIKE 'a7300000-0000-4000-8001-%')
        AND (t.category_id IS NULL OR t.category_id::text LIKE 'a7300000-0000-4000-8002-%')
        AND t.tagged_profile_id IS NULL
      )
  ) THEN RAISE EXCEPTION 'Cleanup guard: unrecognized ledger activity is attached to fixture data'; END IF;
  IF EXISTS (
       SELECT 1 FROM public.settlements s
       JOIN public.obligations o ON o.id = s.obligation_id
       WHERE o.id::text LIKE 'a7300000-0000-4000-8005-%'
     ) OR EXISTS (
       SELECT 1 FROM public.obligation_payments p
       JOIN public.obligations o ON o.id = p.obligation_id
       WHERE o.id::text LIKE 'a7300000-0000-4000-8005-%'
  ) THEN
    RAISE EXCEPTION 'Cleanup guard: fixture obligations have settlement or payment history';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.obligation_payments p
    WHERE p.transaction_id::text LIKE 'a7300000-0000-4000-8003-%'
  ) OR EXISTS (
    SELECT 1 FROM public.settlements s
    WHERE s.source_account_id::text LIKE 'a7300000-0000-4000-8000-%'
       OR s.destination_account_id::text LIKE 'a7300000-0000-4000-8000-%'
  ) THEN RAISE EXCEPTION 'Cleanup guard: fixture transactions or accounts have settlement/payment references'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.recurring_emis e
    JOIN public.obligations o ON o.id = e.related_obligation_id
    WHERE o.id::text LIKE 'a7300000-0000-4000-8005-%'
      AND (e.owner_id <> v_owner OR e.id::text NOT LIKE 'a7300000-0000-4000-8006-%')
  ) OR EXISTS (
    SELECT 1 FROM public.recurring_emis e
    WHERE e.account_id::text LIKE 'a7300000-0000-4000-8000-%'
      AND (e.owner_id <> v_owner OR e.id::text NOT LIKE 'a7300000-0000-4000-8006-%')
  ) THEN RAISE EXCEPTION 'Cleanup guard: non-fixture EMI references fixture data'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.obligations o
    WHERE o.contact_id::text LIKE 'a7300000-0000-4000-8001-%'
      AND o.id::text NOT LIKE 'a7300000-0000-4000-8005-%'
  ) THEN RAISE EXCEPTION 'Cleanup guard: non-fixture obligation references a fixture contact'; END IF;
  IF to_regclass('public.split_group_members') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.split_group_members m WHERE m.shadow_contact_id::text LIKE ''a7300000-0000-4000-8001-%'')'
      INTO v_referenced;
    IF v_referenced THEN RAISE EXCEPTION 'Cleanup guard: a saved split group references a fixture contact'; END IF;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.account_health_settings h
    WHERE h.account_id::text LIKE 'a7300000-0000-4000-8000-%'
  ) THEN RAISE EXCEPTION 'Cleanup guard: account health settings are attached to fixture accounts'; END IF;
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
DECLARE v_owner uuid := '5bf09e85-e346-4c79-808f-29d8577d04ae';
BEGIN
  IF EXISTS (SELECT 1 FROM public.accounts WHERE id::text LIKE 'a7300000-0000-4000-8000-%')
     OR EXISTS (SELECT 1 FROM public.contacts WHERE id::text LIKE 'a7300000-0000-4000-8001-%')
     OR EXISTS (SELECT 1 FROM public.transaction_categories WHERE id::text LIKE 'a7300000-0000-4000-8002-%')
     OR EXISTS (SELECT 1 FROM public.transactions WHERE id::text LIKE 'a7300000-0000-4000-8003-%')
     OR EXISTS (SELECT 1 FROM public.parties WHERE id::text LIKE 'a7300000-0000-4000-8004-%')
     OR EXISTS (SELECT 1 FROM public.obligations WHERE id::text LIKE 'a7300000-0000-4000-8005-%')
     OR EXISTS (SELECT 1 FROM public.recurring_emis WHERE id::text LIKE 'a7300000-0000-4000-8006-%')
     OR EXISTS (SELECT 1 FROM public.chittis WHERE id::text LIKE 'a7300000-0000-4000-8007-%')
     OR EXISTS (SELECT 1 FROM public.budget_envelopes WHERE id::text LIKE 'a7300000-0000-4000-8008-%')
     OR EXISTS (SELECT 1 FROM public.transaction_templates WHERE id::text LIKE 'a7300000-0000-4000-8009-%')
     OR EXISTS (SELECT 1 FROM public.savings_goals WHERE id::text LIKE 'a7300000-0000-4000-8010-%')
     OR EXISTS (SELECT 1 FROM public.savings_goal_contributions WHERE id::text LIKE 'a7300000-0000-4000-8011-%')
     OR EXISTS (SELECT 1 FROM public.shopping_lists WHERE id::text LIKE 'a7300000-0000-4000-8012-%')
     OR EXISTS (SELECT 1 FROM public.shopping_list_items WHERE id::text LIKE 'a7300000-0000-4000-8013-%')
     OR EXISTS (SELECT 1 FROM private.installment_occurrences
                WHERE (schedule_kind = 'BANK_EMI' AND schedule_id::text LIKE 'a7300000-0000-4000-8006-%')
                   OR (schedule_kind = 'CHITTI' AND schedule_id::text LIKE 'a7300000-0000-4000-8007-%'))
     OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_owner)
     OR NOT EXISTS (SELECT 1 FROM public.profile_directory WHERE id = v_owner)
  THEN RAISE EXCEPTION 'Cleanup postcondition failed'; END IF;
END $$;
COMMIT;

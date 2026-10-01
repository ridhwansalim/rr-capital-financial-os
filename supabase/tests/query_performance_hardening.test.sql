BEGIN;
SELECT plan(4);

SELECT is(
  (SELECT count(*)::integer FROM pg_indexes
   WHERE (schemaname = 'public' AND indexname IN (
     'accounts_owner_id_fk_idx','chittis_owner_id_fk_idx','contacts_owner_id_fk_idx',
     'obligations_contact_id_fk_idx','obligations_creditor_profile_id_fk_idx',
     'obligations_debtor_profile_id_fk_idx','obligations_initiator_account_id_fk_idx',
     'obligations_owner_id_fk_idx','obligations_profile_id_fk_idx',
     'obligations_receiver_account_id_fk_idx','obligations_related_transaction_id_fk_idx',
     'obligations_shadow_contact_id_fk_idx','recurring_emis_account_id_fk_idx',
     'recurring_emis_counterparty_profile_id_fk_idx','recurring_emis_initiator_account_id_fk_idx',
     'recurring_emis_owner_id_fk_idx','recurring_emis_related_obligation_id_fk_idx',
     'recurring_emis_shadow_contact_id_fk_idx','settlements_counterparty_profile_id_fk_idx',
     'settlements_destination_account_id_fk_idx','settlements_source_account_id_fk_idx',
     'transactions_contact_id_fk_idx','transactions_from_account_id_fk_idx',
     'transactions_initiator_profile_id_fk_idx','transactions_tagged_profile_id_fk_idx',
     'transactions_to_account_id_fk_idx'
   )) OR (schemaname = 'private' AND indexname IN (
     'chitti_action_requests_transaction_id_idx','emi_bank_action_requests_transaction_id_idx'
   ))),
  28,
  'all 28 advisor-identified foreign-key columns have indexes'
);

SELECT is(
  (SELECT count(*)::integer FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename IN ('accounts','contacts','chittis','profiles','obligations','recurring_emis')
     AND (coalesce(qual,'') || coalesce(with_check,'')) LIKE '%SELECT auth.uid()%'),
  12,
  'all owner and participant policies on the affected tables evaluate auth.uid through a scalar subquery'
);

SELECT is(
  (SELECT count(*)::integer FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'obligations' AND cmd = 'SELECT'
     AND policyname = 'obligations_select_participants'),
  1,
  'obligation read access uses one combined participant policy'
);

SELECT is(
  (SELECT count(*)::integer FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'recurring_emis' AND cmd = 'SELECT'
     AND policyname = 'recurring_emis_select_participants'),
  1,
  'recurring payment read access uses one combined participant policy'
);

SELECT * FROM finish();
ROLLBACK;

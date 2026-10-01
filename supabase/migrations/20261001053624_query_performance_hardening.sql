-- Index foreign-key columns used by cascades/joins and evaluate auth.uid once
-- per statement in policies. Access predicates remain unchanged.

CREATE INDEX IF NOT EXISTS chitti_action_requests_transaction_id_idx
  ON private.chitti_action_requests(transaction_id);
CREATE INDEX IF NOT EXISTS emi_bank_action_requests_transaction_id_idx
  ON private.emi_bank_action_requests(transaction_id);

CREATE INDEX IF NOT EXISTS accounts_owner_id_fk_idx ON public.accounts(owner_id);
CREATE INDEX IF NOT EXISTS chittis_owner_id_fk_idx ON public.chittis(owner_id);
CREATE INDEX IF NOT EXISTS contacts_owner_id_fk_idx ON public.contacts(owner_id);

CREATE INDEX IF NOT EXISTS obligations_contact_id_fk_idx ON public.obligations(contact_id);
CREATE INDEX IF NOT EXISTS obligations_creditor_profile_id_fk_idx ON public.obligations(creditor_profile_id);
CREATE INDEX IF NOT EXISTS obligations_debtor_profile_id_fk_idx ON public.obligations(debtor_profile_id);
CREATE INDEX IF NOT EXISTS obligations_initiator_account_id_fk_idx ON public.obligations(initiator_account_id);
CREATE INDEX IF NOT EXISTS obligations_owner_id_fk_idx ON public.obligations(owner_id);
CREATE INDEX IF NOT EXISTS obligations_profile_id_fk_idx ON public.obligations(profile_id);
CREATE INDEX IF NOT EXISTS obligations_receiver_account_id_fk_idx ON public.obligations(receiver_account_id);
CREATE INDEX IF NOT EXISTS obligations_related_transaction_id_fk_idx ON public.obligations(related_transaction_id);
CREATE INDEX IF NOT EXISTS obligations_shadow_contact_id_fk_idx ON public.obligations(shadow_contact_id);

CREATE INDEX IF NOT EXISTS recurring_emis_account_id_fk_idx ON public.recurring_emis(account_id);
CREATE INDEX IF NOT EXISTS recurring_emis_counterparty_profile_id_fk_idx ON public.recurring_emis(counterparty_profile_id);
CREATE INDEX IF NOT EXISTS recurring_emis_initiator_account_id_fk_idx ON public.recurring_emis(initiator_account_id);
CREATE INDEX IF NOT EXISTS recurring_emis_owner_id_fk_idx ON public.recurring_emis(owner_id);
CREATE INDEX IF NOT EXISTS recurring_emis_related_obligation_id_fk_idx ON public.recurring_emis(related_obligation_id);
CREATE INDEX IF NOT EXISTS recurring_emis_shadow_contact_id_fk_idx ON public.recurring_emis(shadow_contact_id);

CREATE INDEX IF NOT EXISTS settlements_counterparty_profile_id_fk_idx ON public.settlements(counterparty_profile_id);
CREATE INDEX IF NOT EXISTS settlements_destination_account_id_fk_idx ON public.settlements(destination_account_id);
CREATE INDEX IF NOT EXISTS settlements_source_account_id_fk_idx ON public.settlements(source_account_id);

CREATE INDEX IF NOT EXISTS transactions_contact_id_fk_idx ON public.transactions(contact_id);
CREATE INDEX IF NOT EXISTS transactions_from_account_id_fk_idx ON public.transactions(from_account_id);
CREATE INDEX IF NOT EXISTS transactions_initiator_profile_id_fk_idx ON public.transactions(initiator_profile_id);
CREATE INDEX IF NOT EXISTS transactions_tagged_profile_id_fk_idx ON public.transactions(tagged_profile_id);
CREATE INDEX IF NOT EXISTS transactions_to_account_id_fk_idx ON public.transactions(to_account_id);

DROP POLICY IF EXISTS "Accounts owner" ON public.accounts;
CREATE POLICY "Accounts owner" ON public.accounts FOR ALL
  USING (owner_id = (SELECT auth.uid()))
  WITH CHECK (owner_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Contacts owner" ON public.contacts;
CREATE POLICY "Contacts owner" ON public.contacts FOR ALL
  USING (owner_id = (SELECT auth.uid()))
  WITH CHECK (owner_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Users can delete own chittis" ON public.chittis;
DROP POLICY IF EXISTS "Users can insert own chittis" ON public.chittis;
DROP POLICY IF EXISTS "Users can update own chittis" ON public.chittis;
DROP POLICY IF EXISTS "Users can view own chittis" ON public.chittis;
CREATE POLICY "Users can delete own chittis" ON public.chittis FOR DELETE
  USING ((SELECT auth.uid()) = owner_id);
CREATE POLICY "Users can insert own chittis" ON public.chittis FOR INSERT
  WITH CHECK ((SELECT auth.uid()) = owner_id);
CREATE POLICY "Users can update own chittis" ON public.chittis FOR UPDATE
  USING ((SELECT auth.uid()) = owner_id)
  WITH CHECK ((SELECT auth.uid()) = owner_id);
CREATE POLICY "Users can view own chittis" ON public.chittis FOR SELECT
  USING ((SELECT auth.uid()) = owner_id);

DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT
  WITH CHECK ((SELECT auth.uid()) = id);
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE
  USING ((SELECT auth.uid()) = id)
  WITH CHECK ((SELECT auth.uid()) = id);

DROP POLICY IF EXISTS obligations_select_owner ON public.obligations;
DROP POLICY IF EXISTS obligations_select_shared ON public.obligations;
CREATE POLICY obligations_select_participants ON public.obligations FOR SELECT TO authenticated
  USING (
    owner_id = (SELECT auth.uid())
    OR creditor_profile_id = (SELECT auth.uid())
    OR debtor_profile_id = (SELECT auth.uid())
  );

DROP POLICY IF EXISTS recurring_emis_select_counterparty ON public.recurring_emis;
DROP POLICY IF EXISTS recurring_emis_select_owner ON public.recurring_emis;
CREATE POLICY recurring_emis_select_participants ON public.recurring_emis FOR SELECT TO authenticated
  USING (owner_id = (SELECT auth.uid()) OR counterparty_profile_id = (SELECT auth.uid()));

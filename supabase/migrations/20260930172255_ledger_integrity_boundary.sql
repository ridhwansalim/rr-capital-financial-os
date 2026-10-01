-- Every posted transaction has a positive currency amount and at least one
-- account endpoint. A transfer cannot send money to the same account.
ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_amount_valid
    CHECK (amount IS NOT NULL AND amount > 0 AND amount = round(amount, 2)),
  ADD CONSTRAINT transactions_fee_valid
    CHECK (fee_amount IS NULL OR (fee_amount >= 0 AND fee_amount = round(fee_amount, 2))),
  ADD CONSTRAINT transactions_accounts_valid
    CHECK ((from_account_id IS NOT NULL OR to_account_id IS NOT NULL)
       AND (from_account_id IS NULL OR to_account_id IS NULL OR from_account_id <> to_account_id));

CREATE OR REPLACE FUNCTION private.validate_transaction_accounts()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.from_account_id IS NOT NULL THEN
    PERFORM private.require_account(NEW.owner_id, NEW.from_account_id);
  END IF;
  IF NEW.to_account_id IS NOT NULL THEN
    PERFORM private.require_account(NEW.owner_id, NEW.to_account_id);
  END IF;
  IF NEW.contact_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.contacts
    WHERE id = NEW.contact_id AND owner_id = NEW.owner_id
  ) THEN
    RAISE EXCEPTION 'Contact does not belong to the transaction owner'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.validate_transaction_accounts() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER validate_transaction_accounts
  BEFORE INSERT OR UPDATE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION private.validate_transaction_accounts();

-- Keep history attached to its original account. The app already presents a
-- deletion error for accounts with transactions; the old SET NULL foreign key
-- silently changed past ledger entries instead.
ALTER TABLE public.transactions
  DROP CONSTRAINT transactions_from_account_id_fkey,
  DROP CONSTRAINT transactions_to_account_id_fkey,
  ADD CONSTRAINT transactions_from_account_id_fkey
    FOREIGN KEY (from_account_id) REFERENCES public.accounts(id) ON DELETE RESTRICT,
  ADD CONSTRAINT transactions_to_account_id_fkey
    FOREIGN KEY (to_account_id) REFERENCES public.accounts(id) ON DELETE RESTRICT;

DROP POLICY "Transactions owner" ON public.transactions;
CREATE POLICY transactions_select_own ON public.transactions
  FOR SELECT TO authenticated USING (owner_id = (SELECT auth.uid()));
CREATE POLICY transactions_insert_own ON public.transactions
  FOR INSERT TO authenticated
  WITH CHECK (owner_id = (SELECT auth.uid())
          AND initiator_profile_id = (SELECT auth.uid()));
CREATE POLICY transactions_update_own ON public.transactions
  FOR UPDATE TO authenticated
  USING (owner_id = (SELECT auth.uid()))
  WITH CHECK (owner_id = (SELECT auth.uid())
          AND initiator_profile_id = (SELECT auth.uid()));
CREATE POLICY transactions_delete_own ON public.transactions
  FOR DELETE TO authenticated USING (owner_id = (SELECT auth.uid()));

NOTIFY pgrst, 'reload schema';

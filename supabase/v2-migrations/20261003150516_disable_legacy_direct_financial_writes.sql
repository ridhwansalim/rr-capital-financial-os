-- Financial OS v2 only. The v2 schema is a separate legacy project; do not
-- place this migration in the RR Capital migration sequence.
--
-- The current v2 policies allow every transaction participant to update the
-- whole shared row and allow either debt participant to perform every write
-- on an obligation. The owner-wide transaction policy also permits direct
-- edits/deletes that bypass the ledger RPCs. Keep reads available to linked
-- parties, but stop direct API writes until v2 has reviewed atomic write RPCs.

DROP POLICY IF EXISTS "Enable all for transaction owner" ON public.transactions;
DROP POLICY IF EXISTS "Users can insert own transactions" ON public.transactions;
DROP POLICY IF EXISTS "Users can update involved transactions" ON public.transactions;

DROP POLICY IF EXISTS "Users can manage their own obligations" ON public.obligations;

CREATE POLICY transactions_read_owner_or_participant
  ON public.transactions
  FOR SELECT TO authenticated
  USING (
    owner_id = (SELECT auth.uid())
    OR initiator_profile_id = (SELECT auth.uid())
    OR receiver_profile_id = (SELECT auth.uid())
  );

CREATE POLICY obligations_read_owner_or_participant
  ON public.obligations
  FOR SELECT TO authenticated
  USING (
    creditor_profile_id = (SELECT auth.uid())
    OR debtor_profile_id = (SELECT auth.uid())
  );

REVOKE ALL ON TABLE public.transactions, public.obligations FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.transactions, public.obligations FROM authenticated;
GRANT SELECT ON TABLE public.transactions, public.obligations TO authenticated;

NOTIFY pgrst, 'reload schema';

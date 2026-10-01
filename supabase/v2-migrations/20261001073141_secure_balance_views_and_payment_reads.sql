-- Financial OS v2 only. This legacy database diverges from RR Capital and
-- this file must not be placed in the root production migration sequence.

ALTER VIEW public.account_balances SET (security_invoker = true);
ALTER VIEW public.obligation_balances SET (security_invoker = true);

GRANT SELECT ON TABLE public.obligation_payments TO authenticated;
DROP POLICY IF EXISTS obligation_payments_participant_read
  ON public.obligation_payments;
CREATE POLICY obligation_payments_participant_read
ON public.obligation_payments
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.obligations o
    WHERE o.id = obligation_payments.obligation_id
      AND ((SELECT auth.uid()) = o.creditor_profile_id
        OR (SELECT auth.uid()) = o.debtor_profile_id)
  )
);

CREATE INDEX IF NOT EXISTS idx_obligation_payments_obligation_id
  ON public.obligation_payments (obligation_id);
CREATE INDEX IF NOT EXISTS idx_obligation_payments_transaction_id
  ON public.obligation_payments (transaction_id);

NOTIFY pgrst, 'reload schema';

-- Expose only transaction IDs that the authenticated caller must exclude from
-- personal-only derived summaries. No financial values or arbitrary IDs enter.
CREATE OR REPLACE FUNCTION private.financial_health_excluded_transaction_ids()
RETURNS TABLE (transaction_id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, pg_temp
AS $$
  SELECT requests.transaction_id
    FROM private.chitti_action_requests AS requests
    JOIN public.transactions AS transactions
      ON transactions.id = requests.transaction_id
     AND transactions.owner_id = auth.uid()
   WHERE requests.owner_id = auth.uid()
  UNION
  SELECT requests.transaction_id
    FROM private.emi_bank_action_requests AS requests
    JOIN public.transactions AS transactions
      ON transactions.id = requests.transaction_id
     AND transactions.owner_id = auth.uid()
   WHERE requests.owner_id = auth.uid()
  UNION
  SELECT payments.transaction_id
    FROM public.obligation_payments AS payments
    JOIN public.obligations AS obligations ON obligations.id = payments.obligation_id
    JOIN public.transactions AS transactions
      ON transactions.id = payments.transaction_id
     AND transactions.owner_id = auth.uid()
   WHERE auth.uid() IN (
     obligations.owner_id,
     obligations.creditor_profile_id,
     obligations.debtor_profile_id
   )
  UNION
  SELECT obligations.related_transaction_id
    FROM public.obligations AS obligations
    JOIN public.transactions AS transactions
      ON transactions.id = obligations.related_transaction_id
     AND transactions.owner_id = auth.uid()
   WHERE obligations.related_transaction_id IS NOT NULL
     AND auth.uid() IN (
       obligations.owner_id,
       obligations.creditor_profile_id,
       obligations.debtor_profile_id
     );
$$;
REVOKE ALL ON FUNCTION private.financial_health_excluded_transaction_ids() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.financial_health_excluded_transaction_ids() TO authenticated;

CREATE OR REPLACE FUNCTION public.financial_health_excluded_transaction_ids()
RETURNS TABLE (transaction_id uuid)
LANGUAGE sql
SECURITY INVOKER
SET search_path = pg_catalog, public, private, pg_temp
AS $$
  SELECT * FROM private.financial_health_excluded_transaction_ids();
$$;
REVOKE ALL ON FUNCTION public.financial_health_excluded_transaction_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.financial_health_excluded_transaction_ids() TO authenticated;

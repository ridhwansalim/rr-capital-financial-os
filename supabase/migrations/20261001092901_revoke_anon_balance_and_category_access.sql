-- The initial schema grants ALL to anon on this security-invoker view.
-- No anonymous financial reads or writes are permitted.
REVOKE ALL ON TABLE public.account_balances FROM anon;
REVOKE ALL ON TABLE public.transaction_categories FROM anon;
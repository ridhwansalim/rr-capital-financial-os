-- Balance calculations are read-only to application users.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.account_balances FROM authenticated;
GRANT SELECT ON TABLE public.account_balances TO authenticated;

-- The Reports UI performs category CRUD directly; owner-only RLS policies guard these grants.
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.transaction_categories TO authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.transaction_categories FROM authenticated;

-- Trigger functions are invoked by triggers and must not be callable as API RPCs.
REVOKE ALL ON FUNCTION private.protect_chitti_state()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.protect_emi_bank_progress()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.protect_settlement_state()
  FROM PUBLIC, anon, authenticated, service_role;
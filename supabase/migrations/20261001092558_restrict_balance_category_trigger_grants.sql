-- Balance calculations are read-only to application users.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.account_balances FROM authenticated;
GRANT SELECT ON TABLE public.account_balances TO authenticated;

-- The Reports UI performs category CRUD directly; owner-only RLS policies guard these grants.
-- Categories are introduced by a later migration. Keep this historical
-- hardening migration replayable from a clean database; that later migration
-- grants only the required row operations after it creates the table.
DO $$ BEGIN
  IF to_regclass('public.transaction_categories') IS NOT NULL THEN
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON TABLE public.transaction_categories TO authenticated;
    REVOKE TRUNCATE, REFERENCES, TRIGGER
      ON TABLE public.transaction_categories FROM authenticated;
  END IF;
END $$;

-- Trigger functions are invoked by triggers and must not be callable as API RPCs.
DO $$ BEGIN
  IF to_regprocedure('private.protect_chitti_state()') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION private.protect_chitti_state()
      FROM PUBLIC, anon, authenticated, service_role;
  END IF;
  IF to_regprocedure('private.protect_emi_bank_progress()') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION private.protect_emi_bank_progress()
      FROM PUBLIC, anon, authenticated, service_role;
  END IF;
  IF to_regprocedure('private.protect_settlement_state()') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION private.protect_settlement_state()
      FROM PUBLIC, anon, authenticated, service_role;
  END IF;
END $$;

-- Match the existing overdraft behavior for bank, cash, and wallet accounts
-- at the database boundary. Every completed debit uses an account row lock,
-- so concurrent writers cannot both spend the same balance.
CREATE OR REPLACE FUNCTION private.enforce_liquid_balance()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  v_type text;
  v_available numeric;
  v_exclude uuid;
BEGIN
  IF NEW.status IS DISTINCT FROM 'COMPLETED' OR NEW.from_account_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT type INTO v_type FROM public.accounts
   WHERE id = NEW.from_account_id AND owner_id = NEW.owner_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Source account does not belong to transaction owner'
      USING ERRCODE = '42501';
  END IF;
  IF v_type IN ('credit', 'credit_card') THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' THEN v_exclude := OLD.id; END IF;

  SELECT COALESCE(sum(CASE WHEN to_account_id = NEW.from_account_id
                           THEN amount ELSE 0 END), 0)
       - COALESCE(sum(CASE WHEN from_account_id = NEW.from_account_id
                           THEN amount + COALESCE(fee_amount, 0) ELSE 0 END), 0)
    INTO v_available
    FROM public.transactions
   WHERE status = 'COMPLETED'
     AND id IS DISTINCT FROM v_exclude
     AND (from_account_id = NEW.from_account_id OR to_account_id = NEW.from_account_id);
  IF v_available < NEW.amount + COALESCE(NEW.fee_amount, 0) THEN
    RAISE EXCEPTION 'Insufficient account balance'
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.enforce_liquid_balance() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER enforce_liquid_balance
  BEFORE INSERT OR UPDATE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION private.enforce_liquid_balance();

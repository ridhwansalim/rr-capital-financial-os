-- A dated opening position lets a user begin tracking an existing account without
-- inventing an income/expense transaction. Ledger writes before this date are
-- rejected centrally, regardless of whether they come from the PWA or an RPC.

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS opening_balance numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS opening_date date;

-- Preserve every existing ledger timestamp by placing a zero opening position
-- at the earliest linked entry. Accounts with no ledger entries start on their
-- own creation date; no historical rows are rewritten.
UPDATE public.accounts AS a
   SET opening_date = COALESCE(
     (SELECT min((t.created_at AT TIME ZONE 'Asia/Kolkata')::date)
        FROM public.transactions AS t
       WHERE t.from_account_id = a.id OR t.to_account_id = a.id),
     (a.created_at AT TIME ZONE 'Asia/Kolkata')::date,
     (statement_timestamp() AT TIME ZONE 'Asia/Kolkata')::date
   )
 WHERE a.opening_date IS NULL;

ALTER TABLE public.accounts
  ALTER COLUMN opening_date SET DEFAULT ((statement_timestamp() AT TIME ZONE 'Asia/Kolkata')::date),
  ALTER COLUMN opening_date SET NOT NULL;
DO $$ BEGIN
  ALTER TABLE public.accounts ADD CONSTRAINT accounts_opening_balance_valid
    CHECK (opening_balance BETWEEN -9999999999.99 AND 9999999999.99
       AND opening_balance = round(opening_balance, 2));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE OR REPLACE FUNCTION private.validate_account_opening_position()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, pg_temp
AS $$
BEGIN
  IF NEW.type IS NULL THEN
    RAISE EXCEPTION 'Account type is required'
      USING ERRCODE = '22023';
  END IF;

  IF NEW.opening_date >
     (statement_timestamp() AT TIME ZONE 'Asia/Kolkata')::date THEN
    RAISE EXCEPTION 'Account opening date cannot be in the future'
      USING ERRCODE = '22023';
  END IF;

  -- Account balance convention: assets are positive; card debt is negative.
  IF NEW.type IN ('credit', 'credit_card') AND NEW.opening_balance > 0 THEN
    RAISE EXCEPTION 'Credit-card opening balance must be zero or a negative outstanding amount'
      USING ERRCODE = '22023';
  ELSIF NEW.type NOT IN ('credit', 'credit_card') AND NEW.opening_balance < 0 THEN
    RAISE EXCEPTION 'Bank, cash, and wallet opening balances cannot be negative'
      USING ERRCODE = '22023';
  END IF;

  IF TG_OP = 'UPDATE'
     AND ROW(NEW.opening_balance, NEW.opening_date)
         IS DISTINCT FROM ROW(OLD.opening_balance, OLD.opening_date)
     AND (
       EXISTS (
         SELECT 1 FROM public.transactions AS t
          WHERE t.from_account_id = OLD.id OR t.to_account_id = OLD.id
       )
       OR EXISTS (
         SELECT 1 FROM public.obligations AS o
          WHERE o.initiator_account_id = OLD.id
            AND o.status = 'PENDING_APPROVAL'
       )
     ) THEN
    RAISE EXCEPTION 'Opening balance and date are locked while referenced by ledger history or a pending debt request'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.validate_account_opening_position()
  FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS validate_account_opening_position ON public.accounts;
CREATE TRIGGER validate_account_opening_position
  BEFORE INSERT OR UPDATE OF opening_balance, opening_date, type
  ON public.accounts
  FOR EACH ROW EXECUTE FUNCTION private.validate_account_opening_position();

CREATE OR REPLACE FUNCTION private.enforce_transaction_opening_date()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, pg_temp
AS $$
DECLARE
  v_account record;
  v_expected integer := 0;
  v_seen integer := 0;
  v_occurrence_date date;
BEGIN
  IF NEW.created_at IS NULL THEN
    RAISE EXCEPTION 'Transaction date is required'
      USING ERRCODE = '22023';
  END IF;
  v_occurrence_date := (NEW.created_at AT TIME ZONE 'Asia/Kolkata')::date;

  IF NEW.from_account_id IS NOT NULL THEN
    PERFORM private.require_account(NEW.owner_id, NEW.from_account_id);
    v_expected := v_expected + 1;
  END IF;
  IF NEW.to_account_id IS NOT NULL THEN
    PERFORM private.require_account(NEW.owner_id, NEW.to_account_id);
    v_expected := v_expected + 1;
  END IF;

  -- Lock both endpoints in stable order. This serializes the date check against
  -- opening-position edits and avoids opposite-direction transfer deadlocks.
  FOR v_account IN
    SELECT a.id, a.opening_date
      FROM public.accounts AS a
     WHERE a.owner_id = NEW.owner_id
       AND a.id = ANY (ARRAY[NEW.from_account_id, NEW.to_account_id]::uuid[])
     ORDER BY a.id
     FOR UPDATE
  LOOP
    v_seen := v_seen + 1;
    IF v_occurrence_date < v_account.opening_date THEN
      RAISE EXCEPTION 'Transaction date precedes account opening date (%)', v_account.opening_date
        USING ERRCODE = '22023';
    END IF;
  END LOOP;

  IF v_seen <> v_expected THEN
    RAISE EXCEPTION 'Account does not belong to the transaction owner'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.enforce_transaction_opening_date()
  FROM PUBLIC, anon, authenticated, service_role;
-- PostgreSQL fires same-event triggers by name. This date-boundary trigger
-- takes both endpoint locks in UUID order before the overdraft trigger takes
-- its source-account lock, so opposite-direction transfers cannot deadlock.
DROP TRIGGER IF EXISTS transactions_opening_date_boundary ON public.transactions;
DROP TRIGGER IF EXISTS a_transaction_opening_date_boundary ON public.transactions;
CREATE TRIGGER a_transaction_opening_date_boundary
  BEFORE INSERT OR UPDATE OF owner_id, from_account_id, to_account_id, created_at
  ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION private.enforce_transaction_opening_date();

-- The database-side overdraft check must include the same dated opening
-- position as the account_balances view or valid initial-balance spending would
-- be rejected before the first income transaction exists.
CREATE OR REPLACE FUNCTION private.enforce_liquid_balance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, pg_temp
AS $$
DECLARE
  v_type text;
  v_opening_balance numeric;
  v_opening_date date;
  v_available numeric;
  v_exclude uuid;
BEGIN
  IF NEW.status IS DISTINCT FROM 'COMPLETED' OR NEW.from_account_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT type, opening_balance, opening_date
    INTO v_type, v_opening_balance, v_opening_date
    FROM public.accounts
   WHERE id = NEW.from_account_id AND owner_id = NEW.owner_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Source account does not belong to transaction owner'
      USING ERRCODE = '42501';
  END IF;
  IF v_type IN ('credit', 'credit_card') THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' THEN v_exclude := OLD.id; END IF;

  SELECT v_opening_balance + COALESCE(sum(
           CASE WHEN t.to_account_id = NEW.from_account_id THEN t.amount ELSE 0 END
           - CASE WHEN t.from_account_id = NEW.from_account_id
                  THEN t.amount + COALESCE(t.fee_amount, 0) ELSE 0 END
         ), 0)
    INTO v_available
    FROM public.transactions AS t
   WHERE t.status = 'COMPLETED'
     AND t.id IS DISTINCT FROM v_exclude
     AND (t.from_account_id = NEW.from_account_id OR t.to_account_id = NEW.from_account_id)
     AND (t.created_at AT TIME ZONE 'Asia/Kolkata')::date >= v_opening_date;
  IF v_available < NEW.amount + COALESCE(NEW.fee_amount, 0) THEN
    RAISE EXCEPTION 'Insufficient account balance'
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;
-- Keep the established invoker-security boundary. A current balance is the
-- opening position plus completed ledger movement on or after opening_date.
CREATE OR REPLACE VIEW public.account_balances
  WITH (security_invoker = true)
AS
SELECT a.id,
       a.opening_balance
       + COALESCE((
           SELECT sum(t.amount)
             FROM public.transactions AS t
            WHERE t.to_account_id = a.id
              AND t.status = 'COMPLETED'
              AND (t.created_at AT TIME ZONE 'Asia/Kolkata')::date >= a.opening_date
         ), 0::numeric)
       - COALESCE((
           SELECT sum(t.amount + COALESCE(t.fee_amount, 0))
             FROM public.transactions AS t
            WHERE t.from_account_id = a.id
              AND t.status = 'COMPLETED'
              AND (t.created_at AT TIME ZONE 'Asia/Kolkata')::date >= a.opening_date
         ), 0::numeric) AS balance
  FROM public.accounts AS a;

NOTIFY pgrst, 'reload schema';

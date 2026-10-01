CREATE OR REPLACE FUNCTION private.require_amount(p_amount numeric) RETURNS void
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
 IF p_amount IS NULL OR p_amount<=0 OR p_amount>9999999999.99
    OR p_amount<>round(p_amount,2) THEN
   RAISE EXCEPTION 'Amount must be positive, finite, and have at most two decimal places' USING ERRCODE='22023';
 END IF;
END $$;
REVOKE ALL ON FUNCTION private.require_amount(numeric) FROM PUBLIC, anon, authenticated;
NOTIFY pgrst, 'reload schema';

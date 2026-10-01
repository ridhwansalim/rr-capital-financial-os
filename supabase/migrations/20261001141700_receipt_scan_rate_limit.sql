-- Keep paid receipt-image processing bounded per authenticated account.
CREATE TABLE IF NOT EXISTS private.receipt_scan_rate_limits (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  window_started_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  request_count integer NOT NULL DEFAULT 1 CHECK (request_count >= 1)
);

ALTER TABLE private.receipt_scan_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.receipt_scan_rate_limits FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.consume_receipt_scan_quota(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  requests_in_window integer;
BEGIN
  IF p_user_id IS NULL OR pg_catalog.current_setting('request.jwt.claim.role', true) IS DISTINCT FROM 'service_role' THEN
    RETURN false;
  END IF;

  INSERT INTO private.receipt_scan_rate_limits (user_id, window_started_at, request_count)
  VALUES (p_user_id, pg_catalog.now(), 1)
  ON CONFLICT (user_id) DO UPDATE
    SET window_started_at = CASE
          WHEN private.receipt_scan_rate_limits.window_started_at <= pg_catalog.now() - interval '1 minute'
            THEN pg_catalog.now()
          ELSE private.receipt_scan_rate_limits.window_started_at
        END,
        request_count = CASE
          WHEN private.receipt_scan_rate_limits.window_started_at <= pg_catalog.now() - interval '1 minute'
            THEN 1
          ELSE least(private.receipt_scan_rate_limits.request_count + 1, 11)
        END
  RETURNING request_count INTO requests_in_window;

  RETURN requests_in_window <= 10;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_receipt_scan_quota(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_receipt_scan_quota(uuid) TO service_role;

COMMENT ON FUNCTION public.consume_receipt_scan_quota(uuid) IS
  'Atomically allows at most ten receipt scans per authenticated user in a rolling one-minute window; callable only by service_role.';

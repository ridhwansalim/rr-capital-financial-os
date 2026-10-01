-- Send only a minimal, asynchronous alert for a newly-created financial
-- request. The webhook URL and verification value are read from Vault at call
-- time; neither is stored in migration source or browser-visible settings.
CREATE OR REPLACE FUNCTION private.enqueue_financial_request_alert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  event_row jsonb := pg_catalog.to_jsonb(NEW);
  owner_id uuid;
  counterparty_id uuid;
  receiver_id uuid;
  webhook_url text;
  webhook_secret text;
BEGIN
  CASE TG_TABLE_NAME
    WHEN 'obligations' THEN
      owner_id := (event_row->>'owner_id')::uuid;
      IF (event_row->>'creditor_profile_id')::uuid = owner_id THEN
        counterparty_id := (event_row->>'debtor_profile_id')::uuid;
      ELSIF (event_row->>'debtor_profile_id')::uuid = owner_id THEN
        counterparty_id := (event_row->>'creditor_profile_id')::uuid;
      ELSE
        RETURN NEW;
      END IF;
    WHEN 'recurring_emis' THEN
      owner_id := (event_row->>'owner_id')::uuid;
      counterparty_id := (event_row->>'counterparty_profile_id')::uuid;
    WHEN 'settlements' THEN
      owner_id := (event_row->>'initiator_id')::uuid;
      counterparty_id := (event_row->>'counterparty_profile_id')::uuid;
    ELSE
      RETURN NEW;
  END CASE;

  receiver_id := counterparty_id;
  IF receiver_id IS NULL OR receiver_id = owner_id THEN
    RETURN NEW;
  END IF;

  SELECT
    max(decrypted_secret) FILTER (WHERE name = 'financial_os_webhook_url'),
    max(decrypted_secret) FILTER (WHERE name = 'financial_os_webhook_secret')
    INTO webhook_url, webhook_secret
    FROM vault.decrypted_secrets
   WHERE name IN ('financial_os_webhook_url', 'financial_os_webhook_secret');

  IF webhook_url IS NULL
     OR webhook_url !~ '^https://[a-z0-9]{20,30}\.supabase\.co/functions/v1/send-alert$'
     OR webhook_secret IS NULL
     OR length(webhook_secret) < 32 THEN
    RAISE WARNING 'Financial request alert skipped: webhook settings are not configured';
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url := webhook_url,
    body := pg_catalog.jsonb_build_object(
      'type', 'INSERT',
      'table', TG_TABLE_NAME,
      'schema', 'public',
      'record', pg_catalog.jsonb_build_object(
        'receiver_profile_id', receiver_id,
        'status', 'PENDING_APPROVAL'
      ),
      'old_record', NULL
    ),
    headers := pg_catalog.jsonb_build_object(
      'Content-Type', 'application/json',
      'x-financial-os-webhook-secret', webhook_secret
    ),
    timeout_milliseconds := 5000
  );

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.enqueue_financial_request_alert()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS obligation_request_alert_insert ON public.obligations;
CREATE TRIGGER obligation_request_alert_insert
  AFTER INSERT ON public.obligations
  FOR EACH ROW WHEN (NEW.status = 'PENDING_APPROVAL')
  EXECUTE FUNCTION private.enqueue_financial_request_alert();

DROP TRIGGER IF EXISTS emi_request_alert_insert ON public.recurring_emis;
CREATE TRIGGER emi_request_alert_insert
  AFTER INSERT ON public.recurring_emis
  FOR EACH ROW WHEN (NEW.status = 'PENDING_APPROVAL')
  EXECUTE FUNCTION private.enqueue_financial_request_alert();

DROP TRIGGER IF EXISTS settlement_request_alert_insert ON public.settlements;
CREATE TRIGGER settlement_request_alert_insert
  AFTER INSERT ON public.settlements
  FOR EACH ROW WHEN (NEW.status = 'PENDING_APPROVAL')
  EXECUTE FUNCTION private.enqueue_financial_request_alert();

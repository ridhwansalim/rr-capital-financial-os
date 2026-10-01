-- Keep the existing Telegram alert for a new request and inform the creator
-- when the other participant accepts or declines it. Never include private
-- account identifiers or financial amounts in the webhook payload.
CREATE OR REPLACE FUNCTION private.enqueue_financial_request_alert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  event_row jsonb;
  owner_id uuid;
  counterparty_id uuid;
  recipient_id uuid;
  event_status text;
  webhook_url text;
  webhook_secret text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    event_row := pg_catalog.to_jsonb(NEW);
    event_status := event_row->>'status';
    IF event_status <> 'PENDING_APPROVAL' THEN
      RETURN NEW;
    END IF;

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
    recipient_id := counterparty_id;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
      RETURN NEW;
    END IF;
    event_row := pg_catalog.to_jsonb(NEW);
    event_status := event_row->>'status';
    CASE TG_TABLE_NAME
      WHEN 'obligations' THEN
        IF event_status NOT IN ('ACCEPTED', 'DECLINED') THEN RETURN NEW; END IF;
        owner_id := (event_row->>'owner_id')::uuid;
      WHEN 'recurring_emis' THEN
        IF event_status NOT IN ('ACTIVE', 'DECLINED') THEN RETURN NEW; END IF;
        owner_id := (event_row->>'owner_id')::uuid;
      WHEN 'settlements' THEN
        IF event_status NOT IN ('COMPLETED', 'DECLINED') THEN RETURN NEW; END IF;
        owner_id := (event_row->>'initiator_id')::uuid;
      ELSE
        RETURN NEW;
    END CASE;
    recipient_id := owner_id;
  ELSE
    RETURN NEW;
  END IF;

  IF recipient_id IS NULL OR (TG_OP = 'INSERT' AND recipient_id = owner_id) THEN
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
      'type', TG_OP,
      'table', TG_TABLE_NAME,
      'schema', 'public',
      'record', pg_catalog.jsonb_build_object(
        'receiver_profile_id', recipient_id,
        'status', event_status
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

DROP TRIGGER IF EXISTS obligation_request_alert_response ON public.obligations;
CREATE TRIGGER obligation_request_alert_response
  AFTER UPDATE OF status ON public.obligations
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status
                     AND NEW.status IN ('ACCEPTED', 'DECLINED'))
  EXECUTE FUNCTION private.enqueue_financial_request_alert();

DROP TRIGGER IF EXISTS emi_request_alert_response ON public.recurring_emis;
CREATE TRIGGER emi_request_alert_response
  AFTER UPDATE OF status ON public.recurring_emis
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status
                     AND NEW.status IN ('ACTIVE', 'DECLINED'))
  EXECUTE FUNCTION private.enqueue_financial_request_alert();

DROP TRIGGER IF EXISTS settlement_request_alert_response ON public.settlements;
CREATE TRIGGER settlement_request_alert_response
  AFTER UPDATE OF status ON public.settlements
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status
                     AND NEW.status IN ('COMPLETED', 'DECLINED'))
  EXECUTE FUNCTION private.enqueue_financial_request_alert();

-- Keep these service/RPC-only relations inaccessible to PostgREST roles even
-- if a permissive policy or table grant is introduced in a later migration.
-- Security-definer functions owned by the table owner continue to work because
-- RLS is not forced on these relations.
DO $migration$
DECLARE
  target record;
BEGIN
  FOR target IN
    SELECT * FROM (VALUES
      ('private', 'chitti_action_requests'),
      ('private', 'emi_bank_action_requests'),
      ('private', 'installment_occurrences'),
      ('private', 'ledger_request_metadata'),
      ('private', 'p2p_request_metadata'),
      ('private', 'receipt_scan_rate_limits'),
      ('private', 'telegram_link_challenges'),
      ('private', 'transaction_corrections'),
      ('private', 'user_gemini_key_refs'),
      ('public', 'obligation_payments'),
      ('public', 'parties'),
      ('public', 'profile_directory')
    ) AS relations(schema_name, table_name)
  LOOP
    EXECUTE format(
      'CREATE POLICY api_roles_denied ON %I.%I AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)',
      target.schema_name,
      target.table_name
    );
  END LOOP;
END
$migration$;

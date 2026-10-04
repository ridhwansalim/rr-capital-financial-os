BEGIN;
SELECT plan(4);

-- These are deliberately absent from the PostgREST client surface. Their
-- advisor notices are the expected deny-by-default shape, not missing RLS.
SELECT is(
  (SELECT count(*)::integer
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE (n.nspname, c.relname) IN (
      ('private','chitti_action_requests'),
      ('private','emi_bank_action_requests'),
      ('private','installment_occurrences'),
      ('private','ledger_request_metadata'),
      ('private','p2p_request_metadata'),
      ('private','receipt_scan_rate_limits'),
      ('private','telegram_link_challenges'),
      ('private','transaction_corrections'),
      ('private','user_gemini_key_refs'),
      ('public','obligation_payments'),
      ('public','parties'),
      ('public','profile_directory')
    )
      AND c.relkind = 'r'
      AND c.relrowsecurity),
  12,
  'all 12 advisor no-policy relations have RLS enabled'
);

SELECT is(
  (SELECT count(*)::integer
     FROM pg_policies p
    WHERE (p.schemaname, p.tablename) IN (
      ('private','chitti_action_requests'),
      ('private','emi_bank_action_requests'),
      ('private','installment_occurrences'),
      ('private','ledger_request_metadata'),
      ('private','p2p_request_metadata'),
      ('private','receipt_scan_rate_limits'),
      ('private','telegram_link_challenges'),
      ('private','transaction_corrections'),
      ('private','user_gemini_key_refs'),
      ('public','obligation_payments'),
      ('public','parties'),
      ('public','profile_directory')
    )
      AND p.policyname = 'api_roles_denied'
      AND p.permissive = 'RESTRICTIVE'
      AND p.cmd = 'ALL'
      AND p.roles @> ARRAY['anon','authenticated']::name[]
      AND p.qual = 'false'
      AND p.with_check = 'false'),
  12,
  'all 12 relations have restrictive deny policies for API roles'
);

SELECT is(
  (SELECT count(*)::integer
     FROM pg_policies p
    WHERE (p.schemaname, p.tablename) IN (
      ('private','chitti_action_requests'),
      ('private','emi_bank_action_requests'),
      ('private','installment_occurrences'),
      ('private','ledger_request_metadata'),
      ('private','p2p_request_metadata'),
      ('private','receipt_scan_rate_limits'),
      ('private','telegram_link_challenges'),
      ('private','transaction_corrections'),
      ('private','user_gemini_key_refs'),
      ('public','obligation_payments'),
      ('public','parties'),
      ('public','profile_directory')
    )),
  12,
  'no additional policies can silently broaden the API-role surface'
);

SELECT ok(NOT EXISTS (
  SELECT 1
    FROM unnest(ARRAY[
      'private.chitti_action_requests'::regclass,
      'private.emi_bank_action_requests'::regclass,
      'private.installment_occurrences'::regclass,
      'private.ledger_request_metadata'::regclass,
      'private.p2p_request_metadata'::regclass,
      'private.receipt_scan_rate_limits'::regclass,
      'private.telegram_link_challenges'::regclass,
      'private.transaction_corrections'::regclass,
      'private.user_gemini_key_refs'::regclass,
      'public.obligation_payments'::regclass,
      'public.parties'::regclass,
      'public.profile_directory'::regclass
    ]) AS relations(relation)
    CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) AS privileges(privilege)
   WHERE has_table_privilege('anon', relations.relation, privileges.privilege)
      OR has_table_privilege('authenticated', relations.relation, privileges.privilege)
), 'anon and authenticated have no direct privileges on these relations');

SELECT * FROM finish();
ROLLBACK;

BEGIN;
SELECT plan(27);

CREATE FUNCTION pg_temp.retry_with_changed_tag_is_rejected() RETURNS boolean
LANGUAGE plpgsql AS $$ BEGIN
  PERFORM public.post_ledger_transaction(
    '90000000-0000-4000-a000-000000000081',
    '10000000-0000-4000-a000-000000000081', NULL,
    1, 0, 'idempotency fixture', now(),
    '00000000-0000-4000-a000-000000000082', NULL, NULL, NULL
  );
  RETURN false;
EXCEPTION WHEN unique_violation THEN RETURN true;
END $$;
CREATE FUNCTION pg_temp.retry_with_changed_contact_is_rejected() RETURNS boolean
LANGUAGE plpgsql AS $$ BEGIN
  PERFORM public.post_ledger_transaction(
    '90000000-0000-4000-a000-000000000081',
    '10000000-0000-4000-a000-000000000081', NULL,
    1, 0, 'idempotency fixture', now(), NULL,
    '50000000-0000-4000-a000-000000000081', NULL, NULL
  );
  RETURN false;
EXCEPTION WHEN unique_violation THEN RETURN true;
END $$;
CREATE FUNCTION pg_temp.personal_summary_denied_for_non_owner() RETURNS boolean
LANGUAGE plpgsql AS $$ BEGIN
  PERFORM public.personal_summary();
  RETURN false;
EXCEPTION WHEN insufficient_privilege THEN RETURN true;
END $$;

INSERT INTO auth.users(id, email, raw_user_meta_data) VALUES
  ('00000000-0000-4000-a000-000000000081', 'perry-owner@example.invalid', '{}'),
  ('00000000-0000-4000-a000-000000000082', 'perry-other@example.invalid', '{}');
INSERT INTO private.perry_owner_config(singleton, owner_id)
VALUES (true, '00000000-0000-4000-a000-000000000081');
INSERT INTO public.accounts(id, owner_id, name, type, opening_balance, opening_date) VALUES
  ('10000000-0000-4000-a000-000000000081', '00000000-0000-4000-a000-000000000081', 'Synthetic bank', 'bank', 250, current_date),
  ('10000000-0000-4000-a000-000000000082', '00000000-0000-4000-a000-000000000082', 'Other bank secret', 'bank', 0, current_date);
INSERT INTO public.transaction_categories(id, owner_id, name, color) VALUES
  ('40000000-0000-4000-a000-000000000081', '00000000-0000-4000-a000-000000000081', 'Food', '#64748b');
INSERT INTO public.contacts(id, owner_id, name) VALUES
  ('50000000-0000-4000-a000-000000000081', '00000000-0000-4000-a000-000000000081', 'Shadow contact secret');
INSERT INTO public.transactions(id, owner_id, initiator_profile_id, to_account_id, amount,
                                description, status, created_at) VALUES
  ('20000000-0000-4000-a000-000000000081', '00000000-0000-4000-a000-000000000081',
   '00000000-0000-4000-a000-000000000081', '10000000-0000-4000-a000-000000000081',
   100, 'synthetic own income', 'COMPLETED', now()),
  ('20000000-0000-4000-a000-000000000082', '00000000-0000-4000-a000-000000000082',
   '00000000-0000-4000-a000-000000000082', '10000000-0000-4000-a000-000000000082',
   999, 'OTHER USER SECRET', 'COMPLETED', now()),
  ('20000000-0000-4000-a000-000000000083', '00000000-0000-4000-a000-000000000081',
   '00000000-0000-4000-a000-000000000081', '10000000-0000-4000-a000-000000000081',
   50, 'shared-counterparty secret', 'COMPLETED', now()),
  ('20000000-0000-4000-a000-000000000084', '00000000-0000-4000-a000-000000000081',
   '00000000-0000-4000-a000-000000000081', '10000000-0000-4000-a000-000000000081',
   25, 'corrected secret', 'COMPLETED', now()),
  ('20000000-0000-4000-a000-000000000085', '00000000-0000-4000-a000-000000000081',
   '00000000-0000-4000-a000-000000000081', '10000000-0000-4000-a000-000000000081',
   75, 'obligation secret', 'COMPLETED', now()),
  ('20000000-0000-4000-a000-000000000086', '00000000-0000-4000-a000-000000000081',
   NULL, '10000000-0000-4000-a000-000000000081',
   88, 'ambiguous owner secret', 'COMPLETED', now()),
  ('20000000-0000-4000-a000-000000000087', '00000000-0000-4000-a000-000000000081',
   '00000000-0000-4000-a000-000000000081', '10000000-0000-4000-a000-000000000081',
   40, 'categorized personal expense', 'COMPLETED', now()),
  ('20000000-0000-4000-a000-000000000088', '00000000-0000-4000-a000-000000000081',
   '00000000-0000-4000-a000-000000000081', '10000000-0000-4000-a000-000000000081',
   65, 'shadow contact secret', 'COMPLETED', now()),
  ('20000000-0000-4000-a000-000000000089', '00000000-0000-4000-a000-000000000081',
   '00000000-0000-4000-a000-000000000081', '10000000-0000-4000-a000-000000000081',
   35, 'chitti workflow secret', 'COMPLETED', now()),
  ('20000000-0000-4000-a000-000000000090', '00000000-0000-4000-a000-000000000081',
   '00000000-0000-4000-a000-000000000081', '10000000-0000-4000-a000-000000000081',
   45, 'bank emi workflow secret', 'COMPLETED', now()),
  ('20000000-0000-4000-a000-000000000091', '00000000-0000-4000-a000-000000000081',
   '00000000-0000-4000-a000-000000000081', '10000000-0000-4000-a000-000000000081',
   55, 'settlement workflow secret', 'COMPLETED', now());
UPDATE public.transactions SET from_account_id = to_account_id, to_account_id = NULL
 WHERE id = '20000000-0000-4000-a000-000000000087';
UPDATE public.transactions SET tagged_profile_id = '00000000-0000-4000-a000-000000000082'
 WHERE id = '20000000-0000-4000-a000-000000000091';
UPDATE public.transactions SET category_id = '40000000-0000-4000-a000-000000000081'
 WHERE id = '20000000-0000-4000-a000-000000000087';
UPDATE public.transactions SET contact_id = '50000000-0000-4000-a000-000000000081'
 WHERE id = '20000000-0000-4000-a000-000000000088';
UPDATE public.transactions SET tagged_profile_id = '00000000-0000-4000-a000-000000000082'
 WHERE id = '20000000-0000-4000-a000-000000000083';
INSERT INTO private.transaction_corrections(owner_id, original_transaction_id, action, reason)
VALUES ('00000000-0000-4000-a000-000000000081', '20000000-0000-4000-a000-000000000084', 'VOID', 'synthetic');
INSERT INTO private.chitti_action_requests(owner_id, request_id, action_kind, chitti_id,
  account_id, month_number, fee_amount, transaction_id)
VALUES ('00000000-0000-4000-a000-000000000081', '60000000-0000-4000-a000-000000000081',
  'INSTALLMENT', '70000000-0000-4000-a000-000000000081',
  '10000000-0000-4000-a000-000000000081', 1, 0,
  '20000000-0000-4000-a000-000000000089');
INSERT INTO private.emi_bank_action_requests(owner_id, request_id, emi_id, account_id,
  month_number, transaction_date, transaction_id)
VALUES ('00000000-0000-4000-a000-000000000081', '60000000-0000-4000-a000-000000000082',
  '70000000-0000-4000-a000-000000000082',
  '10000000-0000-4000-a000-000000000081', 1, now(),
  '20000000-0000-4000-a000-000000000090');
INSERT INTO public.obligations(id, owner_id, type, amount, total_amount, status, related_transaction_id)
VALUES ('30000000-0000-4000-a000-000000000081', '00000000-0000-4000-a000-000000000081',
        'lent', 75, 75, 'ACCEPTED', '20000000-0000-4000-a000-000000000085');
UPDATE public.obligations SET initiator_account_id = '10000000-0000-4000-a000-000000000081',
  creditor_profile_id = '00000000-0000-4000-a000-000000000081',
  debtor_profile_id = '00000000-0000-4000-a000-000000000082',
  created_at = (SELECT created_at FROM public.transactions WHERE id = '20000000-0000-4000-a000-000000000091')
 WHERE id = '30000000-0000-4000-a000-000000000081';
INSERT INTO public.settlements(id, obligation_id, initiator_id, counterparty_profile_id,
  amount, source_account_id, status, created_at)
VALUES ('80000000-0000-4000-a000-000000000081', '30000000-0000-4000-a000-000000000081',
  '00000000-0000-4000-a000-000000000081', '00000000-0000-4000-a000-000000000082',
  55, '10000000-0000-4000-a000-000000000081', 'COMPLETED',
  (SELECT created_at FROM public.transactions WHERE id = '20000000-0000-4000-a000-000000000091'));
INSERT INTO public.recurring_emis(owner_id, name, amount, start_date, type, status)
VALUES ('00000000-0000-4000-a000-000000000081', 'COUNTERPARTY EMI SECRET', 12, current_date, 'lent', 'ACTIVE');
INSERT INTO public.settlements(initiator_id, counterparty_profile_id, amount, status)
VALUES ('00000000-0000-4000-a000-000000000081', '00000000-0000-4000-a000-000000000082', 30, 'PENDING_APPROVAL');

SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-a000-000000000081', true);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-000000000081","role":"authenticated"}', true);
SELECT is(public.personal_summary()->'ledger'->>'completed_personal_transaction_count', '2',
          'signed-in owner sees only clearly personal transactions, including categorized entries');
SELECT is(public.personal_summary()->'ledger'->>'completed_personal_income_total', '100',
          'income total excludes personal expenses and other owners');
SELECT is(public.personal_summary()->'ledger'->>'completed_personal_expense_total', '40',
          'categorized personal expense is aggregated without exposing its category');
SELECT is(public.personal_summary()->'accounts'->0->>'personal_balance', '310',
          'personal balance includes the dated opening amount plus only approved personal ledger movements');
SELECT is(jsonb_array_length(public.personal_summary()->'accounts'), 1,
          'only the authenticated owner account is returned');
SELECT is((SELECT count(*)::integer FROM public.account_balances), 1,
          'security-invoker balance view exposes only the authenticated owners account');
SELECT ok(position('OTHER USER SECRET' in public.personal_summary()::text) = 0
      AND position('shared-counterparty secret' in public.personal_summary()::text) = 0
      AND position('corrected secret' in public.personal_summary()::text) = 0
      AND position('obligation secret' in public.personal_summary()::text) = 0
      AND position('ambiguous owner secret' in public.personal_summary()::text) = 0
      AND position('COUNTERPARTY EMI SECRET' in public.personal_summary()::text) = 0
      AND position('shadow contact secret' in public.personal_summary()::text) = 0
      AND position('Shadow contact secret' in public.personal_summary()::text) = 0
      AND position('chitti workflow secret' in public.personal_summary()::text) = 0
      AND position('bank emi workflow secret' in public.personal_summary()::text) = 0
      AND position('settlement workflow secret' in public.personal_summary()::text) = 0
      AND position('synthetic own income' in public.personal_summary()::text) = 0
      AND position('categorized personal expense' in public.personal_summary()::text) = 0,
      'other-user, shared, corrected, obligation, ambiguous, EMI, and settlement data are excluded');
SELECT ok((SELECT count(*) FROM jsonb_object_keys(public.personal_summary())) = 3
      AND (SELECT count(*) FROM jsonb_object_keys(public.personal_summary()->'ledger')) = 6
      AND (SELECT count(*) FROM jsonb_object_keys(public.personal_summary()->'accounts'->0)) = 3,
      'response contains only fixed summary fields and no row IDs, descriptions, or filters');
SELECT ok(NOT has_function_privilege('anon', 'public.personal_summary()', 'EXECUTE'),
          'anonymous role cannot execute summary RPC');
SELECT ok(to_regprocedure('public.personal_summary(uuid)') IS NULL,
          'there is no RPC overload accepting a supplied user ID');
SELECT ok((SELECT p.prosecdef AND p.proconfig @> ARRAY['search_path=pg_catalog, public, private, pg_temp']
            FROM pg_proc p WHERE p.oid = 'private.personal_summary()'::regprocedure)
      AND (SELECT NOT p.prosecdef AND p.proconfig @> ARRAY['search_path=pg_catalog, public, private, pg_temp']
            FROM pg_proc p WHERE p.oid = 'public.personal_summary()'::regprocedure)
      AND NOT has_function_privilege('authenticated',
        'private.post_ledger_transaction(uuid,uuid,uuid,numeric,numeric,text,timestamptz,uuid,uuid,uuid,text)', 'EXECUTE'),
      'private summary is fixed-search-path SECURITY DEFINER and public wrapper is fixed-search-path INVOKER');
SELECT ok(NOT has_table_privilege('authenticated', 'public.account_balances', 'INSERT')
      AND NOT has_table_privilege('authenticated', 'public.account_balances', 'UPDATE')
      AND NOT has_table_privilege('authenticated', 'public.account_balances', 'DELETE')
      AND NOT has_table_privilege('authenticated', 'public.account_balances', 'TRUNCATE')
      AND NOT has_table_privilege('authenticated', 'public.account_balances', 'REFERENCES')
      AND NOT has_table_privilege('authenticated', 'public.account_balances', 'TRIGGER')
      AND EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = 'public.account_balances'::regclass
                   AND c.reloptions @> ARRAY['security_invoker=true'])
      AND NOT has_table_privilege('anon', 'public.account_balances', 'SELECT'),
      'balance view is security-invoker, denies anonymous reads, and has no authenticated write-like grants');
SELECT ok(NOT has_table_privilege('authenticated', 'public.transaction_categories', 'TRUNCATE')
      AND NOT has_table_privilege('authenticated', 'public.transaction_categories', 'REFERENCES')
      AND NOT has_table_privilege('authenticated', 'public.transaction_categories', 'TRIGGER')
      AND NOT has_table_privilege('anon', 'public.transaction_categories', 'SELECT')
      AND has_table_privilege('authenticated', 'public.transaction_categories', 'SELECT')
      AND NOT has_table_privilege('authenticated', 'public.transaction_categories', 'INSERT')
      AND NOT has_table_privilege('authenticated', 'public.transaction_categories', 'UPDATE')
      AND has_column_privilege('authenticated', 'public.transaction_categories', 'name', 'INSERT')
      AND has_column_privilege('authenticated', 'public.transaction_categories', 'color', 'INSERT')
      AND has_column_privilege('authenticated', 'public.transaction_categories', 'name', 'UPDATE')
      AND has_column_privilege('authenticated', 'public.transaction_categories', 'color', 'UPDATE')
      AND NOT has_column_privilege('authenticated', 'public.transaction_categories', 'owner_id', 'INSERT')
      AND NOT has_column_privilege('authenticated', 'public.transaction_categories', 'owner_id', 'UPDATE')
      AND has_table_privilege('authenticated', 'public.transaction_categories', 'DELETE'),
      'category CRUD is column-scoped without anonymous access');
SELECT ok(NOT has_table_privilege('anon', 'public.parties', 'SELECT')
      AND NOT has_table_privilege('authenticated', 'public.parties', 'SELECT')
      AND NOT has_table_privilege('anon', 'public.obligation_payments', 'SELECT')
      AND NOT has_table_privilege('authenticated', 'public.obligation_payments', 'SELECT'),
      'party and obligation-payment records remain unavailable through API table grants');
SELECT ok(NOT has_table_privilege('authenticated', 'public.accounts', 'TRUNCATE')
      AND NOT has_table_privilege('authenticated', 'public.accounts', 'REFERENCES')
      AND NOT has_table_privilege('authenticated', 'public.accounts', 'TRIGGER'),
      'account owner CRUD does not include table-wide privileges');

DO $$ BEGIN
  BEGIN
    TRUNCATE public.transaction_categories;
    RAISE EXCEPTION 'TRUNCATE unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.account_balances(id, balance) VALUES (gen_random_uuid(), 1);
    RAISE EXCEPTION 'INSERT to balance view unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege OR feature_not_supported THEN NULL;
  END;
END $$;
SELECT pass('write-path denials hold under authenticated role');

SELECT public.post_ledger_transaction(
  '90000000-0000-4000-a000-000000000081',
  '10000000-0000-4000-a000-000000000081', NULL,
  1, 0, 'idempotency fixture', now(), NULL, NULL, NULL, NULL
);
SELECT is(public.post_ledger_transaction(
  '90000000-0000-4000-a000-000000000081',
  '10000000-0000-4000-a000-000000000081', NULL,
  1, 0, 'idempotency fixture', now(), NULL, NULL, NULL, NULL
)::text, (SELECT id::text FROM public.transactions
            WHERE client_request_id = '90000000-0000-4000-a000-000000000081'),
  'an identical retry returns the original transaction ID');
SELECT ok(pg_temp.retry_with_changed_tag_is_rejected()
      AND pg_temp.retry_with_changed_contact_is_rejected(),
      'idempotent retries reject changed profile/contact ownership metadata');

RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-a000-000000000082', true);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-000000000082","role":"authenticated"}', true);
SELECT ok(pg_temp.personal_summary_denied_for_non_owner(),
          'a different authenticated user is denied by the private owner pin');
SELECT ok(NOT has_function_privilege('anon','public.personal_summary()','EXECUTE'),
          'the fixed summary RPC remains unavailable to anonymous callers');
RESET ROLE;

SELECT ok(position('private.require_user()' in
              pg_get_functiondef('private.personal_summary()'::regprocedure)) > 0
      AND position('private.assert_perry_owner(v_user)' in
              pg_get_functiondef('private.personal_summary()'::regprocedure)) > 0
      AND position('owner_id = p_subject' in
              pg_get_functiondef('private.assert_perry_owner(uuid)'::regprocedure)) > 0
      AND position('owner_id = v_user' in
              pg_get_functiondef('private.personal_summary()'::regprocedure)) > 0
      AND NOT has_function_privilege('anon','public.personal_summary()','EXECUTE'),
      'summary derives auth.uid(), checks the private owner pin, and has a fixed-search-path boundary');
SELECT ok(NOT has_table_privilege('perry_reader','public.accounts','SELECT')
      AND NOT has_table_privilege('perry_reader','public.transactions','SELECT')
      AND NOT has_table_privilege('perry_reader','public.transaction_categories','SELECT')
      AND NOT has_table_privilege('perry_reader','public.accounts','INSERT')
      AND NOT has_table_privilege('perry_reader','public.accounts','UPDATE')
      AND NOT has_table_privilege('perry_reader','public.accounts','DELETE')
      AND NOT has_table_privilege('perry_reader','private.perry_owner_config','SELECT'),
      'Perry role has no direct table reads, writes, or owner-config access');
SELECT ok(NOT (SELECT rolcanlogin FROM pg_roles WHERE rolname='perry_reader')
      AND NOT has_schema_privilege('perry_reader','private','USAGE'),
      'legacy Perry database role is disabled and has no private RPC access');
SELECT ok(NOT pg_has_role('authenticator','perry_reader','MEMBER')
      AND NOT pg_has_role('perry_reader','authenticator','MEMBER')
      AND has_function_privilege('authenticated','public.personal_summary()','EXECUTE')
      AND NOT has_function_privilege('anon','public.personal_summary()','EXECUTE'),
      'user-scoped summary RPC is available only through authenticated Supabase API access');
SELECT ok((SELECT NOT r.rolcanlogin AND NOT r.rolinherit AND NOT r.rolbypassrls
                   AND a.rolpassword IS NULL
            FROM pg_roles r JOIN pg_authid a USING (oid)
            WHERE r.rolname='perry_reader'),
          'legacy Perry role cannot log in, inherit, bypass RLS, or use a source-managed password');

SELECT ok(to_regprocedure('public.personal_summary(uuid)') IS NULL,
          'Perry summary RPC accepts no caller-supplied subject');

SET LOCAL ROLE anon;
DO $$ BEGIN
  BEGIN
    PERFORM public.personal_summary();
    RAISE EXCEPTION 'anonymous summary unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
SELECT pass('anonymous summary access denied');

SELECT * FROM finish();
ROLLBACK;

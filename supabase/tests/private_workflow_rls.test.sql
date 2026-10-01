BEGIN;
SELECT plan(4);

SELECT is(
  (SELECT count(*)::integer
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'private'
      AND c.relname IN (
        'telegram_link_challenges', 'chitti_action_requests',
        'emi_bank_action_requests', 'transaction_corrections'
      )
      AND c.relrowsecurity),
  4,
  'RLS is enabled on each private workflow and audit table'
);

SELECT ok(NOT EXISTS (
  SELECT 1 FROM unnest(ARRAY[
    'private.telegram_link_challenges'::regclass,
    'private.chitti_action_requests'::regclass,
    'private.emi_bank_action_requests'::regclass,
    'private.transaction_corrections'::regclass
  ]) AS t(relation)
  WHERE has_table_privilege('anon', relation, 'SELECT')
     OR has_table_privilege('anon', relation, 'INSERT')
     OR has_table_privilege('anon', relation, 'UPDATE')
     OR has_table_privilege('anon', relation, 'DELETE')
), 'anon has no direct access to private workflow or audit tables');

SELECT ok(NOT EXISTS (
  SELECT 1 FROM unnest(ARRAY[
    'private.telegram_link_challenges'::regclass,
    'private.chitti_action_requests'::regclass,
    'private.emi_bank_action_requests'::regclass,
    'private.transaction_corrections'::regclass
  ]) AS t(relation)
  WHERE has_table_privilege('authenticated', relation, 'SELECT')
     OR has_table_privilege('authenticated', relation, 'INSERT')
     OR has_table_privilege('authenticated', relation, 'UPDATE')
     OR has_table_privilege('authenticated', relation, 'DELETE')
), 'authenticated has no direct access to private workflow or audit tables');

SELECT is(
  (SELECT count(*)::integer FROM pg_class c
    WHERE c.relname IN ('transactions_category_owner_fk_idx', 'transaction_corrections_owner_id_idx')
      AND c.relkind = 'i' AND c.relam = (SELECT oid FROM pg_am WHERE amname = 'btree')),
  2,
  'the category and correction foreign keys have B-tree child indexes'
);

SELECT * FROM finish();
ROLLBACK;

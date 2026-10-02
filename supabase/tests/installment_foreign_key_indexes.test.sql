SELECT plan(2);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_index i
    JOIN pg_class t ON t.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = i.indkey[0]
    WHERE n.nspname = 'private'
      AND t.relname = 'installment_occurrences'
      AND a.attname = 'owner_id'
      AND i.indisvalid
  ),
  'installment owner foreign key is indexed'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_index i
    JOIN pg_class t ON t.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = i.indkey[0]
    WHERE n.nspname = 'private'
      AND t.relname = 'installment_occurrences'
      AND a.attname = 'transaction_id'
      AND i.indisvalid
  ),
  'installment transaction foreign key is indexed'
);

SELECT * FROM finish();

-- PostgreSQL does not automatically index referencing foreign-key columns.
-- These indexes support owner cleanup and historical transaction references.
CREATE INDEX IF NOT EXISTS installment_occurrences_owner_id_idx
  ON private.installment_occurrences(owner_id);

CREATE INDEX IF NOT EXISTS installment_occurrences_transaction_id_idx
  ON private.installment_occurrences(transaction_id);

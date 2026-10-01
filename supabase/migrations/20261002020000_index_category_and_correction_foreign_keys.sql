-- Cover the child-side FK lookups used when a category is removed and when
-- an owner account is removed. Keep the category pair in FK column order.
CREATE INDEX transactions_category_owner_fk_idx
  ON public.transactions(category_id, owner_id)
  WHERE category_id IS NOT NULL;

CREATE INDEX transaction_corrections_owner_id_idx
  ON private.transaction_corrections(owner_id);

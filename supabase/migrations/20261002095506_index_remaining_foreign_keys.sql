-- Cover remaining foreign keys surfaced by the RR Capital performance advisor.
-- These indexes also keep parent-row deletes and updates from scanning child tables.
CREATE INDEX IF NOT EXISTS account_health_settings_account_id_idx
  ON public.account_health_settings (account_id);

CREATE INDEX IF NOT EXISTS budget_envelopes_category_owner_idx
  ON public.budget_envelopes (category_id, owner_id);

CREATE INDEX IF NOT EXISTS shopping_list_items_list_owner_idx
  ON public.shopping_list_items (list_id, owner_id);

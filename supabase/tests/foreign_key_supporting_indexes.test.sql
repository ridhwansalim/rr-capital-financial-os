BEGIN;
SELECT plan(3);

SELECT ok(
  to_regclass('public.account_health_settings_account_id_idx') IS NOT NULL,
  'account health settings account foreign key has a supporting index'
);
SELECT ok(
  to_regclass('public.budget_envelopes_category_owner_idx') IS NOT NULL,
  'budget category-owner foreign key has a supporting index'
);
SELECT ok(
  to_regclass('public.shopping_list_items_list_owner_idx') IS NOT NULL,
  'shopping list-owner foreign key has a supporting index'
);

SELECT * FROM finish();
ROLLBACK;

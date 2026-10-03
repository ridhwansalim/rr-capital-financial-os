-- Synthetic RR Capital test history: 36 months and 864 completed ledger rows.
-- Run only against the dedicated RR Capital test owner after verifying its scope.
-- All accounts, categories, and transaction descriptions are visibly marked.
-- The transaction timeline runs 2023-10 through 2026-09.
BEGIN;

DO $$
DECLARE
  v_owner uuid := '5bf09e85-e346-4c79-808f-29d8577d04ae';
BEGIN
  IF (SELECT count(*) FROM auth.users) <> 1
     OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_owner) THEN
    RAISE EXCEPTION 'Fixture guard: expected exactly the dedicated RR Capital test owner';
  END IF;
  IF (SELECT count(*) FROM public.profiles WHERE id = v_owner) <> 1 THEN
    RAISE EXCEPTION 'Fixture guard: expected the existing owner profile';
  END IF;
  IF EXISTS (SELECT 1 FROM public.accounts WHERE owner_id = v_owner)
     OR EXISTS (SELECT 1 FROM public.transactions WHERE owner_id = v_owner) THEN
    RAISE EXCEPTION 'Fixture guard: owner already has financial data; refusing to mix fixtures';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.transaction_categories
     WHERE id BETWEEN 'f37a0b61-7118-4bc2-a7f6-000000000c11'::uuid
                  AND 'f37a0b61-7118-4bc2-a7f6-000000000c20'::uuid
  ) THEN
    RAISE EXCEPTION 'Fixture guard: one or more stable fixture category IDs already exist';
  END IF;
END $$;

INSERT INTO public.transaction_categories (id, owner_id, name, color) VALUES
  ('f37a0b61-7118-4bc2-a7f6-000000000c11', '5bf09e85-e346-4c79-808f-29d8577d04ae', '[RR SAMPLE] Housing', '#8b5cf6'),
  ('f37a0b61-7118-4bc2-a7f6-000000000c12', '5bf09e85-e346-4c79-808f-29d8577d04ae', '[RR SAMPLE] Groceries', '#34d399'),
  ('f37a0b61-7118-4bc2-a7f6-000000000c13', '5bf09e85-e346-4c79-808f-29d8577d04ae', '[RR SAMPLE] Utilities', '#38bdf8'),
  ('f37a0b61-7118-4bc2-a7f6-000000000c14', '5bf09e85-e346-4c79-808f-29d8577d04ae', '[RR SAMPLE] Transport', '#fbbf24'),
  ('f37a0b61-7118-4bc2-a7f6-000000000c15', '5bf09e85-e346-4c79-808f-29d8577d04ae', '[RR SAMPLE] Dining', '#fb7185'),
  ('f37a0b61-7118-4bc2-a7f6-000000000c16', '5bf09e85-e346-4c79-808f-29d8577d04ae', '[RR SAMPLE] Shopping', '#f472b6'),
  ('f37a0b61-7118-4bc2-a7f6-000000000c17', '5bf09e85-e346-4c79-808f-29d8577d04ae', '[RR SAMPLE] Health', '#a3e635'),
  ('f37a0b61-7118-4bc2-a7f6-000000000c18', '5bf09e85-e346-4c79-808f-29d8577d04ae', '[RR SAMPLE] Home', '#c084fc'),
  ('f37a0b61-7118-4bc2-a7f6-000000000c19', '5bf09e85-e346-4c79-808f-29d8577d04ae', '[RR SAMPLE] Coffee & Cash', '#f97316'),
  ('f37a0b61-7118-4bc2-a7f6-000000000c20', '5bf09e85-e346-4c79-808f-29d8577d04ae', '[RR SAMPLE] Subscriptions', '#60a5fa');

INSERT INTO public.accounts
  (id, owner_id, name, type, credit_limit, opening_balance, opening_date)
VALUES
  ('f37a0b61-7118-4bc2-a7f6-000000000011', '5bf09e85-e346-4c79-808f-29d8577d04ae', '[RR SAMPLE] Everyday Bank', 'bank', 0, 250000, '2023-09-03'),
  ('f37a0b61-7118-4bc2-a7f6-000000000012', '5bf09e85-e346-4c79-808f-29d8577d04ae', '[RR SAMPLE] Cash Wallet', 'cash', 0, 5000, '2023-09-03'),
  ('f37a0b61-7118-4bc2-a7f6-000000000013', '5bf09e85-e346-4c79-808f-29d8577d04ae', '[RR SAMPLE] Rewards Card', 'credit_card', 100000, 0, '2023-09-03');

WITH months AS (
  SELECT n,
         (DATE '2023-10-01' + (n || ' months')::interval)::date AS month_start
    FROM generate_series(0, 35) AS n
),
bank_plan(slot, category_id, label, day_of_month, base_amount, spread) AS (
  VALUES
    (1, 11, 'Rent',                 2, 24000, 1000),
    (2, 12, 'Groceries · market',   3,  1600,  700),
    (3, 12, 'Groceries · produce',  8,  1100,  500),
    (4, 12, 'Groceries · pantry',  14,  1300,  600),
    (5, 12, 'Groceries · weekly',  21,  1500,  700),
    (6, 13, 'Electricity bill',     6,  1900, 1400),
    (7, 13, 'Internet bill',       10,   899,  100),
    (8, 14, 'Metro & commute',      4,   650,  450),
    (9, 14, 'Metro & commute',     11,   700,  450),
    (10,14, 'Metro & commute',     19,   750,  450),
    (11,15, 'Dining · lunch',       9,  1100, 1400),
    (12,15, 'Dining · dinner',     22,  1300, 1700),
    (13,16, 'Shopping · essentials',15,1800, 4200),
    (14,16, 'Shopping · household',27,1200, 3000),
    (15,17, 'Pharmacy & health',   17,   800, 2400),
    (16,18, 'Home & personal',     24,   900, 2200)
),
bank_expenses AS (
  SELECT m.month_start + (p.day_of_month - 1) AS occurred_on,
         p.slot::integer AS sort_key,
         'f37a0b61-7118-4bc2-a7f6-000000000011'::uuid AS from_id,
         NULL::uuid AS to_id,
         (p.base_amount + ((m.n * (p.slot + 11) * 97) % p.spread))::numeric AS amount,
         ('[RR SAMPLE] ' || p.label || ' · ' || to_char(m.month_start, 'Mon YYYY'))::text AS description,
         ('f37a0b61-7118-4bc2-a7f6-000000000c' || lpad(p.category_id::text, 2, '0'))::uuid AS category_id
    FROM months m CROSS JOIN bank_plan p
),
cash_expenses AS (
  SELECT m.month_start + (p.day_of_month - 1) AS occurred_on,
         (30 + p.slot)::integer AS sort_key,
         'f37a0b61-7118-4bc2-a7f6-000000000012'::uuid AS from_id,
         NULL::uuid AS to_id,
         (p.base_amount + ((m.n * (p.slot + 17) * 41) % p.spread))::numeric AS amount,
         ('[RR SAMPLE] ' || p.label || ' · ' || to_char(m.month_start, 'Mon YYYY'))::text AS description,
         'f37a0b61-7118-4bc2-a7f6-000000000c19'::uuid AS category_id
    FROM months m
    CROSS JOIN (VALUES
      (1, 'Coffee & snacks',  5, 220, 260),
      (2, 'Auto & local travel',13, 300, 350),
      (3, 'Neighborhood market',23, 850, 700)
    ) AS p(slot, label, day_of_month, base_amount, spread)
),
salary AS (
  SELECT m.month_start + 24 AS occurred_on,
         40 AS sort_key,
         NULL::uuid AS from_id,
         'f37a0b61-7118-4bc2-a7f6-000000000011'::uuid AS to_id,
         (78000 + ((m.n * 137) % 9000))::numeric AS amount,
         ('[RR SAMPLE] Salary · ' || to_char(m.month_start, 'Mon YYYY'))::text AS description,
         NULL::uuid AS category_id
    FROM months m
),
card_spend AS (
  SELECT m.month_start + (p.day_of_month - 1) AS occurred_on,
         (50 + p.slot)::integer AS sort_key,
         'f37a0b61-7118-4bc2-a7f6-000000000013'::uuid AS from_id,
         NULL::uuid AS to_id,
         (p.base_amount + ((m.n * p.multiplier) % p.spread))::numeric AS amount,
         ('[RR SAMPLE] ' || p.label || ' · ' || to_char(m.month_start, 'Mon YYYY'))::text AS description,
         'f37a0b61-7118-4bc2-a7f6-000000000c20'::uuid AS category_id
    FROM months m
    CROSS JOIN (VALUES
      (1, 'Streaming subscription',  6,  599, 151,  83),
      (2, 'Online purchase',        20, 3200, 900, 127)
    ) AS p(slot, label, day_of_month, base_amount, spread, multiplier)
),
transfers AS (
  SELECT m.month_start + 1 AS occurred_on,
         60 AS sort_key,
         'f37a0b61-7118-4bc2-a7f6-000000000011'::uuid AS from_id,
         'f37a0b61-7118-4bc2-a7f6-000000000012'::uuid AS to_id,
         3000::numeric AS amount,
         ('[RR SAMPLE] Monthly cash transfer · ' || to_char(m.month_start, 'Mon YYYY'))::text AS description,
         NULL::uuid AS category_id
    FROM months m
  UNION ALL
  SELECT m.month_start + 23 AS occurred_on,
         61 AS sort_key,
         'f37a0b61-7118-4bc2-a7f6-000000000011'::uuid AS from_id,
         'f37a0b61-7118-4bc2-a7f6-000000000013'::uuid AS to_id,
         (599 + ((m.n * 83) % 151) + 3200 + ((m.n * 127) % 900))::numeric AS amount,
         ('[RR SAMPLE] Card payment · ' || to_char(m.month_start, 'Mon YYYY'))::text AS description,
         NULL::uuid AS category_id
    FROM months m
),
all_events AS (
  SELECT * FROM bank_expenses
  UNION ALL SELECT * FROM cash_expenses
  UNION ALL SELECT * FROM salary
  UNION ALL SELECT * FROM card_spend
  UNION ALL SELECT * FROM transfers
)
INSERT INTO public.transactions
  (id, owner_id, initiator_profile_id, from_account_id, to_account_id,
   amount, fee_amount, description, status, created_at, category_id)
SELECT
  ('f37a0b61-7118-4bc2-a7f6-' || lpad((3000 + row_number() OVER (ORDER BY occurred_on, sort_key, description))::text, 12, '0'))::uuid,
  '5bf09e85-e346-4c79-808f-29d8577d04ae'::uuid,
  '5bf09e85-e346-4c79-808f-29d8577d04ae'::uuid,
  from_id,
  to_id,
  amount,
  0,
  description,
  'COMPLETED',
  ((occurred_on + time '12:00') AT TIME ZONE 'Asia/Kolkata'),
  category_id
FROM all_events
ORDER BY occurred_on, sort_key, description;

COMMIT;

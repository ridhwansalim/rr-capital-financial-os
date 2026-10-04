# RR Capital sample data — expanded evaluation fixture

## Current authoritative status (2026-10-04)

At the user's request, RR Capital (`hnebvwfgsotrknxpgpmv`) was populated with a synthetic 40-month dataset on 2026-10-04. The owner has 10 accounts, 12 contacts, 12 categories, 480 transactions dated 2023-06-02 through 2026-09-30, 12 obligations, 12 recurring EMI schedules, 12 chittis, 12 budgets, 15 templates, 12 savings goals, 36 contributions, 12 shopping lists, 48 shopping items, and 10 parties. Financial OS v2 (`guvkfuxniprtqdsqlqtx`) was not modified. All six optional feature flags were already enabled. Per-account health settings remain empty because their trigger requires an authenticated owner context.

The paragraphs below this current-state note that describe zero rows or the former 3-account/864-transaction fixture are historical checkpoints and have been superseded by the expanded fixture described above.

The RR Capital migration ledger currently ends at `20261003182502_profile_navbar_layout_preferences`. Two migrations remain pending: `20261004120000_enforce_chronological_credit_line_limits` and `20261004130000_protect_telegram_destination`. A current read-only privilege check confirms authenticated clients can still select `profiles.telegram_chat_id`, and the safe Telegram link-status RPC is absent. Do not treat the pending protection as deployed.

As of 2026-10-04, the guarded core release dry-run selects three pending migrations: the two above plus `20261004140000_explicit_api_deny_policies`. The latter strengthens deny-by-default boundaries on 12 service/RPC-only relations. Updated local core replay passes 58 migrations and 165 SQL assertions. No hosted migrations were applied during that validation; live data remains unchanged.

Read-only readiness recheck (2026-10-04 Asia/Kolkata): exact hosted counts remain profiles=1, profile directory=1, feature flags=6, and zero accounts, contacts, transactions, obligations, obligation payments, parties, recurring EMIs, Chittis, or settlements. `authenticated` can still select `profiles.telegram_chat_id`; `anon` cannot, and `get_telegram_link_status()` is absent. The Supabase security advisor reports 12 RLS-enabled/no-policy INFO findings and the leaked-password-protection WARN. Direct ACL checks confirm `anon` and `authenticated` have no table SELECT or write privileges on any of those 12 no-policy relations, so those INFO findings currently correspond to inaccessible relations. RR Capital's hosted migration ledger was independently read through `20261003182502`; the guarded CLI dry-run selected exactly the two migrations above and made no hosted changes. A clean local core replay passed 57 migrations, 34 SQL test files, and 164 pgTAP assertions; the temporary replay database was dropped.

The newest verified full application-schema/data backup is `20261003-193017-075`, created at `2026-10-03T14:00:17Z`. It predates the latest schema migrations. The later `20261003-205712-139` snapshot is schema-only. Neither is a current full recovery point for the pending release; managed Auth/Storage data and project settings are also outside their scope.

The application unit/regression suite passed on 2026-10-04 (`npm test`), and both `npm run typecheck:e2e` and `npx tsc -b --pretty false` passed. `git diff --check` passed. Vercel's latest listed READY deployment remains a preview of commit `748fe2aa21d5c653dc227f737579fc8cd8b3c746`; it is not production and predates the current uncommitted layout changes. The local Vite build and Playwright run are still unverified in this environment (`spawn EPERM`; Tailwind Oxide native module failed to load).

Historical reset verification (2026-10-03 16:23 UTC):

Fresh aggregate-only reads at that time confirmed the hosted fixture had been cleared: Auth users=1, profiles=1, accounts=0, transactions=0, obligations=0, obligation payments=0, and feature flags=6. A follow-up catalog count found no `[RR SAMPLE]` transactions/categories. The separate Financial OS v2 project was not modified. The three-year fixture details below are historical and describe the data that was intentionally cleared.

The protected snapshot `%LOCALAPPDATA%\\RR-Capital-Backups\\20261003-205712-139` predates cleanup and still contains the fixture. It must not be restored over the live project as part of routine recovery. The post-cleanup empty-finance checkpoint is `%LOCALAPPDATA%\\RR-Capital-Backups\\20261003-193017-075`. Both are local application database snapshots only; neither covers managed Auth identity, Vault secrets, Storage objects, project settings, or off-site recovery.

On 2026-10-03, populated RR Capital Supabase project `hnebvwfgsotrknxpgpmv` with an owner-scoped synthetic history so the ledger, dashboard, reports, and account balances can be tested with substantial data.

The live fixture has 3 accounts, 10 sample categories, and 864 completed transactions across 36 consecutive months, from 2023-10-02 through 2026-09-27: 36 income entries, 756 expenses, and 72 transfers. Every account, category, and transaction is visibly marked `[RR SAMPLE]`. The history includes monthly salary, rent, groceries, bills, transport, dining, shopping, health, cash spending, card purchases, cash transfers, and monthly card payments.

Verified live balances: Everyday Bank ₹1,016,491; Cash Wallet ₹40,670; Rewards Card ₹0. The card payment entries pay off the generated monthly purchases. RR Capital still has the original single Auth user, profile, and 6 feature flags. The separate Financial OS v2 project `guvkfuxniprtqdsqlqtx` remains a legacy project with zero finance rows; its access-boundary and direct-write hardening migrations were applied on 2026-10-03. No sample data was added there.

The seed is in `supabase/fixtures/rr_capital_three_year_seed.sql`. It contains a fail-closed owner/profile/data guard and fixed fixture IDs. The matching `supabase/fixtures/rr_capital_sample_cleanup.sql` was executed against RR Capital after its expected-owner and fixture-only preconditions passed; the transaction's ID-based postconditions passed before commit. Do not run the seed against an owner who already has accounts or transactions. No schema migration or application deployment was performed for this data load or cleanup.

## Pre-seed recovery checkpoint

Created protected snapshot `%LOCALAPPDATA%\RR-Capital-Backups\20261003-193017-075` after the reset and before loading the current 864-row fixture. The read-only verifier passed the project-reference, protected ACL, manifest, expected-file, size, and SHA-256 checks. The isolated schema-and-data rehearsal passed with 29 tables, 1 view, 94 functions, and 8 aggregate rows; the script confirmed its uniquely named scratch database and temporary SQL files were removed. This snapshot does not contain the current sample transactions. It validates application-schema/data restoration for the then-empty financial baseline, not managed Auth identity, Vault secrets, Storage objects, project settings, or an independent off-site backup.

## Remaining readiness evidence

The live RR Capital project is `ACTIVE_HEALTHY`, Postgres 17.6.1, with 54 hosted migrations through `20261002195439_match_obligation_on_ledger_retry`. The security advisor still reports 12 RLS-enabled/no-policy informational findings on deny-by-default relations and one warning that leaked-password protection is disabled (the current Supabase Free plan limitation remains unresolved).

Local test/build/browser checks passed on the existing worktree before this reset. Production Vercel currently serves commit `56bb11027fdfed4243c20b143c19f102c4d0febf`; the worktree still contains uncommitted changes. Full project restore rehearsal and owner-authenticated production workflows remain outstanding. Do not claim production readiness until these are verified.

## Cleanup rehearsal (historical)

`supabase/fixtures/rr_capital_sample_cleanup.sql` was rehearsed against the protected fixture snapshot with `supabase/Test-RR-Capital-Schema-Restore.ps1 -IncludeData -VerifySampleCleanup`. The isolated rehearsal removed 864 tagged sample transactions, 3 dedicated sample accounts, and 10 sample categories, preserving the owner profile, directory, and 6 feature flags. Guards roll back on unexpected owner/account/category/transaction state.

The cleanup SQL postcondition was tightened to check fixed fixture transaction/category IDs even if labels have been edited. The isolated protected-snapshot rehearsal passed again after the change.

## Hosted sample reset — 2026-10-03 16:15 UTC

Following the active goal's explicit reset instruction, ran the guarded cleanup against RR Capital only after a fresh scope query matched the expected fixture (3 dedicated accounts, 10 categories, 864 tagged transactions, zero untagged account activity). Postflight verifies Auth owner=1, profile=1, directory=1, preferences/feature flags=6, owner accounts=0, owner transactions=0, and zero sample-labeled transactions/categories. Cleanup SQL also checked all dedicated fixture IDs were gone before commit. Financial OS v2 was not modified.
# Current RR Capital evaluation dataset — 2026-10-04

The user requested a broad synthetic dataset for evaluation. RR Capital (`hnebvwfgsotrknxpgpmv`) now contains a 40-month activity window from 2023-06-01 through 2026-09-30. All inserted sample-facing names and ledger descriptions carry the `[RR SAMPLE]` prefix. The seed was applied atomically to the dedicated test owner after confirming the project had one Auth owner/profile and no existing financial records. The separate Financial OS v2 project was not modified.

Verified counts for the dedicated owner: 10 accounts, 12 contacts, 12 categories, 480 transactions, 12 obligations/IOUs, 12 recurring EMI schedules, 12 chittis, 12 budget envelopes, 15 transaction templates, 12 savings goals, 36 goal contributions, 12 shopping lists, and 48 shopping-list items. Ten `[RR SAMPLE]` parties were also added. Every relevant collection exceeds the requested minimum of 10.

All six optional feature flags (budgets, calculators, financial health, savings goals, shopping lists, account health) were already enabled and were left unchanged. `account_health_settings` remains empty because its database trigger only permits writes in a signed-in owner context; its feature flag remains enabled so the Accounts health area can be evaluated where it does not require a configured account threshold.

Cleanup is available at `supabase/fixtures/rr_capital_sample_cleanup.sql`. It targets only the fixed `a7300000-0000-4000-8000-*` fixture ID families and refuses to delete when unexpected transactions have been attached to fixture accounts. Do not run cleanup unless the user asks to clear the sample data. `rr_capital_three_year_seed.sql` now deliberately refuses replay against the populated owner; create a fresh isolated test owner/database before preparing a future reseed.

The older notes below describe a prior 36-month fixture that was cleared and are historical only.

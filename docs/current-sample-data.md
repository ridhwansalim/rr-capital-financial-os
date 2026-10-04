# RR Capital sample data — current status

## Current authoritative status (2026-10-04)

The user confirmed that the testing-data reset should target RR Capital (`hnebvwfgsotrknxpgpmv`) only. The guarded cleanup completed in one transaction after fresh scope checks. The dedicated testing owner's finance fixture remains cleared: owner-scoped accounts, contacts, categories, transactions, obligations, recurring EMI schedules, budgets, templates, savings goals/contributions, shopping lists/items, installment occurrences, and fixture parties are zero. The hosted project still has one Auth user, its owner profile, directory, six feature flags, and pre-existing aggregate rows owned outside the reset scope. Pre/post migration checks confirmed those other-owner rows were preserved. Financial OS v2 (`guvkfuxniprtqdsqlqtx`) was not modified and its finance tables remain empty.

The newest complete protected RR Capital snapshot is `20261004-092828-133` (captured 2026-10-04 03:58 UTC); its integrity verifier passed. A newer backup attempt could not complete because Supabase `db dump` requires the unavailable Docker Desktop Linux engine. This application snapshot excludes managed Auth identity, Vault secrets, Storage objects, and project-level settings.

The hosted migration ledger is current through `20261004163119_group_split_metadata_hardening`. The Group Split migrations `20261004162756_group_split_expenses` and `20261004163119_group_split_metadata_hardening` are applied; the RPC/catalog checks and seven Group Split SQL cases passed. An isolated clean replay passed 62 migrations, 35 SQL test files, and 173 pgTAP assertions. No production finance rows were inserted or altered by these verification runs.

Application verification passed: unit/math tests, TypeScript build checking, lint (with existing warnings), Playwright (24 tests), and production build. Vercel production is deployed at `https://financial-os-orcin-ten.vercel.app`; latest verified deployment before the local source commit is `dpl_268JKNo1pxYmqoKQGJwfJ8m5e28k`. Basic protected SPA routes return 200, but authenticated user workflows have not been exercised against production. The full source worktree is being anchored in a local commit; no public Git push has been made.

Current remaining external readiness items: Supabase Security Advisor reports leaked-password protection disabled (the available MCP integration cannot change hosted Auth configuration) and four informational unused-index findings. The protected application snapshot and isolated schema replay are not a full managed-service restore rehearsal.

Historical reset verification (2026-10-03 16:23 UTC; superseded by the 2026-10-04 restoration below):

Fresh aggregate-only reads at that time confirmed the hosted fixture had been cleared: Auth users=1, profiles=1, accounts=0, transactions=0, obligations=0, obligation payments=0, and feature flags=6. A follow-up catalog count found no `[RR SAMPLE]` transactions/categories. The separate Financial OS v2 project was not modified. This temporary reset was followed by a restoration from the checksum-verified snapshot described below, and then by the current user-authorized reset recorded at the top of this document.

The protected snapshot %LOCALAPPDATA%\\RR-Capital-Backups\\20261004-092828-133 is the verified source used to restore the fixture. Local application snapshots do not cover managed Auth identity, Vault secrets, Storage objects, project settings, or off-site recovery.

On 2026-10-03, populated RR Capital Supabase project `hnebvwfgsotrknxpgpmv` with an owner-scoped synthetic history so the ledger, dashboard, reports, and account balances can be tested with substantial data.

The live fixture has 3 accounts, 10 sample categories, and 864 completed transactions across 36 consecutive months, from 2023-10-02 through 2026-09-27: 36 income entries, 756 expenses, and 72 transfers. Every account, category, and transaction is visibly marked `[RR SAMPLE]`. The history includes monthly salary, rent, groceries, bills, transport, dining, shopping, health, cash spending, card purchases, cash transfers, and monthly card payments.

Verified live balances: Everyday Bank â‚¹1,016,491; Cash Wallet â‚¹40,670; Rewards Card â‚¹0. The card payment entries pay off the generated monthly purchases. RR Capital still has the original single Auth user, profile, and 6 feature flags. The separate Financial OS v2 project `guvkfuxniprtqdsqlqtx` remains a legacy project with zero finance rows; its access-boundary and direct-write hardening migrations were applied on 2026-10-03. No sample data was added there.

The seed is in `supabase/fixtures/rr_capital_three_year_seed.sql`. It contains a fail-closed owner/profile/data guard and fixed fixture IDs. The matching `supabase/fixtures/rr_capital_sample_cleanup.sql` was executed against RR Capital after its expected-owner and fixture-only preconditions passed; the transaction's ID-based postconditions passed before commit. Do not run the seed against an owner who already has accounts or transactions. No schema migration or application deployment was performed for this data load or cleanup.

## Pre-seed recovery checkpoint

Created protected snapshot `%LOCALAPPDATA%\RR-Capital-Backups\20261003-193017-075` after the reset and before loading the current 864-row fixture. The read-only verifier passed the project-reference, protected ACL, manifest, expected-file, size, and SHA-256 checks. The isolated schema-and-data rehearsal passed with 29 tables, 1 view, 94 functions, and 8 aggregate rows; the script confirmed its uniquely named scratch database and temporary SQL files were removed. This snapshot does not contain the current sample transactions. It validates application-schema/data restoration for the then-empty financial baseline, not managed Auth identity, Vault secrets, Storage objects, project settings, or an independent off-site backup.

## Historical readiness checkpoint (superseded)

The readiness note below records the earlier 2026-10-03 baseline and is retained only as historical context. Current hosted migration, security, test, deployment, and remaining readiness details are recorded in the authoritative status at the top of this document.

## Cleanup rehearsal (historical)

`supabase/fixtures/rr_capital_sample_cleanup.sql` was rehearsed against the protected fixture snapshot with `supabase/Test-RR-Capital-Schema-Restore.ps1 -IncludeData -VerifySampleCleanup`. The isolated rehearsal removed 864 tagged sample transactions, 3 dedicated sample accounts, and 10 sample categories, preserving the owner profile, directory, and 6 feature flags. Guards roll back on unexpected owner/account/category/transaction state.

The cleanup SQL postcondition was tightened to check fixed fixture transaction/category IDs even if labels have been edited. The isolated protected-snapshot rehearsal passed again after the change.

## Hosted sample reset â€” 2026-10-03 16:15 UTC

Following the active goal's explicit reset instruction, ran the guarded cleanup against RR Capital only after a fresh scope query matched the expected fixture (3 dedicated accounts, 10 categories, 864 tagged transactions, zero untagged account activity). Postflight verifies Auth owner=1, profile=1, directory=1, preferences/feature flags=6, owner accounts=0, owner transactions=0, and zero sample-labeled transactions/categories. Cleanup SQL also checked all dedicated fixture IDs were gone before commit. Financial OS v2 was not modified.
# Current RR Capital evaluation dataset â€” 2026-10-04

The user requested a broad synthetic dataset for evaluation. RR Capital (`hnebvwfgsotrknxpgpmv`) now contains a 40-month activity window from 2023-06-01 through 2026-09-30. All inserted sample-facing names and ledger descriptions carry the `[RR SAMPLE]` prefix. The seed was applied atomically to the dedicated test owner after confirming the project had one Auth owner/profile and no existing financial records. The separate Financial OS v2 project was not modified.

Verified counts for the dedicated owner: 10 accounts, 12 contacts, 12 categories, 480 transactions, 12 obligations/IOUs, 12 recurring EMI schedules, 12 chittis, 12 budget envelopes, 15 transaction templates, 12 savings goals, 36 goal contributions, 12 shopping lists, and 48 shopping-list items. Ten `[RR SAMPLE]` parties were also added. Every relevant collection exceeds the requested minimum of 10.

All six optional feature flags (budgets, calculators, financial health, savings goals, shopping lists, account health) were already enabled and were left unchanged. `account_health_settings` remains empty because its database trigger only permits writes in a signed-in owner context; its feature flag remains enabled so the Accounts health area can be evaluated where it does not require a configured account threshold.

The cleanup script targets only fixed fixture ID families and refuses to delete when unexpected transactions have been attached to fixture accounts. Do not run it unless the user explicitly asks to clear the sample data. The checked-in seed deliberately refuses replay; prepare a fresh isolated test owner/database before any future reseed.

The fixture details below describe data that was cleared on 2026-10-04 and are historical only.

## Hosted fixture recovery - 2026-10-04 (historical; superseded by current reset)

The user clarified that evaluation was not complete and the fixture must remain. Restored the exact application rows from checksum-verified snapshot 20261004-092828-133 to RR Capital using a single guarded database operation. This state was later reset at the user's direction; see the current authoritative status at the top. Financial OS v2 (guvkfuxniprtqdsqlqtx) was not modified.

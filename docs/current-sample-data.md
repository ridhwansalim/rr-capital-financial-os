# RR Capital sample data — archived three-year test fixture

## Current authoritative status (2026-10-03 16:23 UTC)

Fresh aggregate-only reads against RR Capital (`hnebvwfgsotrknxpgpmv`) confirm the hosted fixture has been cleared: Auth users=1, profiles=1, accounts=0, transactions=0, obligations=0, obligation payments=0, and feature flags=6. A follow-up catalog count found no `[RR SAMPLE]` transactions/categories. The separate Financial OS v2 project was not modified. The three-year fixture details below are historical and describe the data that was intentionally cleared.

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

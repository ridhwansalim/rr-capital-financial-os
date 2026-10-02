# Dated opening-balance release plan

Status: eight reviewed core migrations are applied to RR Capital through 20261002040950; app code is not yet deployed. Perry-only migrations remain unapplied. Migration 20261002041000 remains deferred until the new client is deployed and household PWAs have refreshed.

This release carries the dated account baseline, historical transaction dates, personal installment history, chronological liquid-balance enforcement, repayment occurrence dates through settlement approval, and idempotent P2P debt requests with atomic shadow-contact creation. Perry remains a separate future integration and is excluded from this production release.

## Hosted preflight evidence Ã¢â‚¬â€ 2026-10-02

- Target: RR Capital Supabase project `hnebvwfgsotrknxpgpmv`, `ACTIVE_HEALTHY`, Postgres 17.6.1.
- Pre-release hosted ledger on 2026-10-02, before the core rollout, ended at 20261002030000. The current ledger includes the eight applied core/hotfix versions listed below.
- Aggregate-only counts on 2026-10-02: RR Capital has 1 Auth user and 1 profile (the user was created 2026-10-01 and has signed in at least once); accounts, contacts, transactions, obligations, recurring EMIs, settlements, Chittis, and obligation payments are all 0. Financial OS v2 has 0 Auth users, profiles, accounts, contacts, transactions, obligations, recurring EMIs, Chittis, and obligation payments. The owner confirmed on 2026-10-02 that the remaining RR Capital identity is their owner login and must be preserved. Counts are point-in-time; rerun immediately before any migration or account cleanup.
- The Vercel app project is `financial-os` (`prj_1eSVGjIiPnlMgOfUYGxqQI5wSQl5`, team `team_MW4Nz5bO1ZqYwLTalbAzfARt`), with production alias `financial-os-orcin-ten.vercel.app`. Its latest deployment is READY at commit `8952a165480d551f5b0dd064159bade7eae9b390`; direct inspection of its shipped JS bundles did not find opening-date, opening-balance, transaction-date, or installment-history markers. The app changes are local and uncommitted. `rr-capital.vercel.app` serves the separate public company site and is not the finance app domain.
- Fresh read-only catalog review found `authenticated` still has `TRUNCATE`, `REFERENCES`, and `TRIGGER` table privileges on `public.accounts`, `public.chittis`, `public.contacts`, and `public.profiles`. Their row policies are owner-scoped, but RLS does not scope these table-wide privileges. Core migration `20261002040000_revoke_authenticated_nonrow_privileges.sql` revokes them; retain this as a release blocker until the migration is applied and the live grants are verified absent. The isolated `grant_hardening.test.sql` test checks these four tables and attempts `TRUNCATE` as `authenticated`.
- No hosted rows, schema, auth settings, or deployments were changed for this plan.

## Migration order for the core release

Apply only these seven pending RR Capital migrations, in order:

1. `20261002040000_revoke_authenticated_nonrow_privileges.sql` Ã¢â‚¬â€ remove authenticated table-wide privileges that RLS cannot row-scope.
2. `20261002040300_ledger_retry_and_api_privilege_hardening.sql` Ã¢â‚¬â€ harden idempotency metadata and API grants. It no longer depends on a Perry database role.
3. `20261002040400_dated_account_opening_balances.sql` Ã¢â‚¬â€ add and backfill each account's opening position/date; enforce account/date invariants and update the balance view.
4. `20261002040500_installment_history_tracking.sql` Ã¢â‚¬â€ create the private history of Chitti and personal EMI occurrences without inventing paid ledger rows.
5. `20261002040700_chronological_liquid_balance_validation.sql` Ã¢â‚¬â€ reject pre-opening entries and histories that go negative at any point.
6. `20261002040800_dated_settlement_payments.sql` Ã¢â‚¬â€ preserve the requested repayment occurrence date through peer approval and reject dates before either payment account's opening date.

7. `20261002040900_idempotent_p2p_debt_requests.sql` - make lend/borrow creation idempotent on retries, reject dates before the creator account opened, lock that account baseline while a registered request is pending, create new shadow contacts atomically, and preserve the creator-selected occurrence timestamp through registered-user acceptance. The existing RPC signature remains temporarily available.

Do not apply Perry-only migrations `20261002040100_perry_scoped_reader_role.sql`, `20261002040200_readonly_personal_summary.sql`, or `20261002040600_perry_include_opening_balance.sql` as part of this release. Do not deploy/connect the `perry-summary` Edge Function. Those changes remain local for review.

## Local verification

- Core-only blank replay, including post-deployment legacy RPC retirement and excluding Perry-only migrations/tests: 36 migrations, 20 SQL test files, 50 pgTAP assertions. P2P regression tests cover retries, changed-payload rejection, exact obligation/transaction linkage, atomic contact rollback, date bounds, opening-date rejection, occurrence-date preservation through registered-user acceptance, pending-request account-baseline lock, receiver account eligibility, and legacy RPC retirement.
- The dated-ledger release catalog check also verifies the previously deployed `transactions_from_account_id_fkey` and `transactions_to_account_id_fkey` remain `ON DELETE RESTRICT`. Synthetic SQL tests attempt deleting both ends of a transfer and confirm the historical transaction remains attached to both accounts.
- Full blank replay including future Perry migrations/tests: 39 migrations, 21 SQL test files, 77 pgTAP assertions; scratch database dropped.
- A staged-order replay applied core migrations first, then deferred Perry migrations; all 39 migrations, 21 SQL test files, and 77 assertions passed. This simulates SQL order only; it is not evidence of Supabase hosted migration-ledger behavior.
- Core-only replay asserts the Perry migration versions, owner-config table, and summary functions are absent from that scratch database's own migration ledger/catalog. PostgreSQL roles are cluster-wide; the runner preserves a Perry role that already existed locally and cleans it up only when a full replay created it.
- Before the first apply, Supabase CLI 2.119.0 db push dry-run selected exactly seven reviewed core migrations and excluded Perry plus migration 410. Migration 40950 was later separately dry-run and applied. Run the P2P cutover dry-run only after the new app is deployed and household PWAs refresh; it must select only 20261002041000.
- Date helper tests now 9/9, including receiver-account opening-date eligibility; offline ownership 2/2, Perry HTTP contract 18/18, bounded Edge input 5/5, TypeScript and production Vite/PWA build, and `git diff --check` passed in the current checkout. The pending-request inbox now renders/dismisses declined notices and filters receiving accounts by occurrence date. `npm run lint` exits 0 with existing warnings, including hook/set-state, unused import, and dependency warnings. Build warns that the main JavaScript chunk is about 606 kB and that PWA `inlineDynamicImports` is deprecated.

## Operational staging

1. Before any hosted change, refresh the migration ledger, advisor findings, Auth settings, and aggregate row counts; confirm the target is still RR Capital.
2. **No-cost logical-export gate (completed 2026-10-02):** The owner chose the Supabase Free plan; do not upgrade or restore into RR Capital. The pinned Supabase CLI 2.119.0 authenticated through the existing CLI sign-in and wrote `roles.sql`, `schema.sql`, and `data.sql` to `%LOCALAPPDATA%\RR-Capital-Backups\<timestamp>`, outside Git. The directory ACL is protected from inheritance and allows only the owner, SYSTEM, and Administrators. Verified file sizes and SHA-256 hashes: roles.sql 431 bytes `0DECD601FAA70260A3A31E8CE63208CC4A4C1F99921BC6F3ED4FAF1CD980DA3A`; schema.sql 147391 bytes `E69F3F57A7C457E7D36DEEB47AAA3BB81E9C45DBEAC63A99529BCB22055E4822`; data.sql 19284 bytes `48FEE61219DA3F3C14B7E62D6F1FC2C5F2F1E20195F975FFDECBDBE1B29D48C0`. This is a limited database-only logical export: Supabase-managed Auth, Storage, extensions, and project/Auth/Edge settings are excluded; it cannot recreate the existing owner login and is not a full project backup or restore rehearsal. Preserve Auth by leaving it untouched. Never put these files or credentials in public GitHub. Avoid `supabase db dump --dry-run`: the CLI rendered its generated temporary login password in the printed shell script. The live role catalog showed that generated role expires; a later metadata-only check confirmed expired=true after the recorded 2026-10-02 01:17:19 UTC deadline. For future exports, use the authenticated real dump command, never echo command output, keep the output outside Git under an owner-only ACL, and verify hashes. Free has no automatic backups, downloadable provider backups, or PITR. Before the first apply, aggregate counts were rechecked: one Auth user/profile, all financial tables zero. The owner login was preserved. See [Supabase CLI backup and restore](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore), [automated backup guidance](https://supabase.com/docs/guides/deployment/ci/backups), and [current plan limits](https://supabase.com/pricing).
3. The hash-pinned core dry-run passed and selected exactly seven migrations before the first apply. A separate hotfix runner then selected exactly migration 20261002040950; it excludes Perry and 410. Both runners use a temporary bundle and --skip-vault; do not run db push from the full repository migration directory while deferred files are pending. A Perry follow-up must dry-run --include-all and select only 401, 402, and 406.
4. Applied the seven first-stage migrations plus the installment RPC boundary hotfix. The read-only supabase/snippets/core_release_catalog_check.sql passed and verified all eight migration versions and grants. Fresh SQL replays passed: core-only 37 migrations/20 SQL files/50 assertions; staged-then-Perry 40 migrations/21 files/77 assertions. Synthetic fixtures ran only in isolated scratch databases.
5. Deploy the reviewed Vercel commit after database verification. Smoke-test login, opening account creation, same-day and later transactions, pre-opening rejection, dated lend/borrow, and same-request retries. Check rows remain scoped to the signed-in owner.
6. Have each household PWA user refresh/load the updated app before removing compatibility. Run `supabase/tests/dry-run-p2p-cutover.ps1` and confirm it selects only migration 410; then apply `20261002041000_revoke_legacy_p2p_debt_rpc.sql` and run `supabase/snippets/post_deploy_p2p_cutover_check.sql`. Old cached clients cannot create debts until they refresh after this cutover.
7. After migration apply, the security advisor no longer reports exposed authenticated SECURITY DEFINER functions. Remaining notices: 11 informational RLS-enabled/no-policy tables with no direct API grants, managed pg_net placement warning, and leaked-password protection disabled (Free-plan restriction). Recheck advisors after client deployment and exercise forward-repair decisions. Treat schema migrations as forward-only; roll back by redeploying compatible app code while retaining additive schema unless a separately reviewed destructive rollback is approved.

## Current backup evidence and limitation

A fresh RR Capital logical export now exists at the protected path above and its three file hashes were verified. This is a limited database-only recovery copy: it excludes the existing Auth identity, Storage objects, extension-managed schemas, and project-level/Auth/Edge settings. It has not been restored into an isolated project, so it is not a complete backup or restore rehearsal. The owner dropped the paid provider-clone rehearsal because upgrading is unaffordable. A failure requiring full project restoration would still need Supabase support or paid provider backup capability.

## File integrity

SHA-256 of the seven reviewed local SQL files:

| Migration | SHA-256 |
| --- | --- |
| `20261002040000_revoke_authenticated_nonrow_privileges.sql` | `856BCE61488012F511C5F75628AC1412FB11FF42098F26F49F9422B2F93E964F` |
| `20261002040300_ledger_retry_and_api_privilege_hardening.sql` | `2DA283857916827D52B55AA7C2725BD030153C26C9D6BB9FE66596B3834C5915` |
| `20261002040400_dated_account_opening_balances.sql` | `68981CC57F518E117A9CC400CDFDE518A01AB9DC11C817710FC3B2097A3E0F62` |
| `20261002040500_installment_history_tracking.sql` | `3BAE7F02F745EA16BCE437FBEE4E2AD504EBCEFAE0F922B6DF85E9B24C7DDA2B` |
| `20261002040700_chronological_liquid_balance_validation.sql` | `5162208615DA7C8D024F717851DD44C28541C3683B0A6B6EE65755FA8BED7933` |
| `20261002040800_dated_settlement_payments.sql` | `82BAEEECEFCFEE348EFA522E6A3998EBB2E7E5123AC149F443689B1E9D1A2646` |
| `20261002040900_idempotent_p2p_debt_requests.sql` | `31B66570E17070CC7BF3193F52D985FFF16DAC42EA55E945FDE375E1681BB8F6` |

Post-deployment P2P cutover migration, applied only after the new client is deployed and refreshed on household devices:

| Migration | SHA-256 |
| --- | --- |
| `20261002041000_revoke_legacy_p2p_debt_rpc.sql` | `7AC6D80295AB2A53E34650C8C5DB5973352F0F0DA9CC7303A44E46953183E74F` |

Recompute hashes immediately before any hosted apply; this document is evidence of the reviewed file set, not an execution authorization.

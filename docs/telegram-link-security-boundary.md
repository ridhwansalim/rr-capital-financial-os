# Telegram linking and profile write boundary

## Current status — 2026-10-03

The approved profile/category permission migrations are present in RR Capital's hosted migration ledger. A fresh catalog check confirms authenticated users have no table-level INSERT/UPDATE/DELETE on `profiles`, cannot update `telegram_chat_id`, and can still update approved profile preferences. Category writes are column-limited to `name` and `color`; owner RLS policies remain in force. The latest Vercel production deployment (`7b5199c611385659fc88fdd72e0b69ef4f96271d`) contains the one-time Telegram linking UI; the old manual Chat ID field is absent from that deployed commit. The owner still needs to complete the private-chat `/start` link before Telegram alerts can be delivered.

The dated notes below preserve the original finding and rollout history; their pre-release status statements are historical.

## Verified finding

On 2026-10-02, a metadata-only query against RR Capital (`hnebvwfgsotrknxpgpmv`) showed that `authenticated` still has table-level `UPDATE` on `public.profiles`. The resulting column privileges included `telegram_chat_id`, `id`, and `updated_at`. RLS limits the row to the current user, but it does not stop that user from changing sensitive columns on their own profile. The Settings screen also had a manual Chat ID input that bypassed proof of control over the Telegram chat.

## Local remediation

- Settings now offers Telegram linking and relinking through the short-lived one-time bot challenge only; direct Chat ID entry and update code were removed.
- Migration `20261002055319_restrict_profile_update_columns.sql` revokes authenticated table-level profile updates and grants updates only to editable preference columns. RLS continues to enforce owner-only row access. The service-side Telegram challenge consumer retains its server-managed ability to update `telegram_chat_id`.
- Synthetic SQL test `profile_update_column_boundary.test.sql` checks allowed preference updates, denied direct Telegram destination changes, cross-user RLS denial, anonymous denial, and the effective column grants.

## Verification

- Chronological clean replay: 48 migrations, 25 SQL test files, 87 pgTAP assertions passed.
- Core-only replay: 44 migrations, 24 SQL test files, 60 assertions passed.
- Staged core-then-Perry replay: 48 migrations, 25 SQL test files, 87 assertions passed.
- TypeScript and production PWA build passed; the build reports a large-chunk warning and a deprecated PWA option warning.
- Focused app suites passed: dates (9), offline ownership (2), bounded JSON (5), reports (10), and Perry summary handler (20).

Hosted metadata also confirms the one-time challenge RPCs are present with the expected boundary: authenticated users can issue a challenge; only `service_role` can consume one; anonymous users cannot execute either path. The `telegram-webhook` Edge Function is active. The current production UI still contains the manual field until a Vercel release updates it.

Lint exited successfully with repository warnings.

## Release boundary

The latest Vercel production deployment inspected is commit `ce16653` (`Fit account modal without mobile scrolling`). Local `master` is one commit ahead at `2c54b63` (`Use user-scoped RPC for Perry summary`), and the worktree has additional unrelated uncommitted work. Deploying the whole local checkout as this Telegram-only release would also ship those changes, including Perry preparation covered by a separate no-deploy instruction. The live profile grants remain broad until the migration and matching UI change are reviewed and released as a clean scope. No hosted schema, user, or financial data was changed for this fix.

An isolated review worktree is based on `ce16653` and contains only the Settings change, profile-grant migration, regression test, and this note. Its TypeScript/Vite/PWA build passed. A core-only replay passed 44 migrations, 23 SQL test files, and 58 assertions, including the Telegram challenge and new profile-column test. A full replay of all migrations in the Vercel production-commit source tree reached the existing Perry summary SQL test and failed assertion 23: the legacy Perry role had 13 function execute permissions where that test expects only one. This is outside the Telegram patch, and remains an independent Perry security/replay issue; the Perry migration work was not added to the isolated branch.

A fresh metadata-only query of the live RR Capital role catalog returned no `perry_reader` role. The hosted migration ledger also does not contain versions `20261002040100`, `20261002040200`, `20261002040600`, or `20261002041011`; it does contain the surrounding core migrations through `20261002044711`. Therefore the 13-function result reproduces only when replaying historical Perry setup migrations from the older Vercel source tree; it does not indicate a currently provisioned database login in the hosted project. Current local commit `2c54b63` rewrites the unapplied Perry migrations to a disabled role and authenticated user-token RPC, and its chronological replay passed previously. Do not apply those Perry migrations while Perry remains deferred.

## Current verification checkpoint - 2026-10-02

The repository now includes a local source alias `20261002044711_revoke_legacy_p2p_debt_rpc.sql`, matching the hosted migration-ledger version and byte-identical to the reviewed 41000 SQL. A read-only hash-pinned dry-run verifies that 44711 is already applied. The guarded write-boundary dry-run selects only `20261002055319_restrict_profile_update_columns.sql` and `20261002055400_restrict_category_mutation_columns.sql`; neither has been applied to RR Capital. The category migration limits client writes to name/color and derives owner_id from auth.uid(). No hosted data or Perry state changed.

Five focused Node suites pass (dates 9, offline ownership 2, bounded input 5, report navigation 10, Perry handler 20). TypeScript no-emit checking and the Vite/PWA production build pass with output redirected to the writable temp directory. Lint exits zero with existing warnings. The local clean SQL replay was attempted but Docker API access failed with named-pipe permission denied, so this checkpoint does not claim fresh SQL replay coverage. The regular project build cannot write TypeScript incremental output under the protected E: checkout. No deployment occurred. The live Telegram UI/profile permission gap therefore remains until this migration and matching client UI are reviewed and released.
Fresh full SQL verification on 2026-10-02 used the accessible Docker `docker_engine` pipe: core-only 46 migrations/24 SQL test files/68 assertions; staged-then-Perry 50/26/97; chronological 50/26/97. All scratch databases were dropped. The former named-pipe denial was specific to the `desktop-linux` endpoint; no Docker context setting was changed.

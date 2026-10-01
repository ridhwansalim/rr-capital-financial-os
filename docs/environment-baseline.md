# Environment Baseline

Recorded 2026-09-29 from the local checkout and Supabase project inventory.

> Historical baseline: this page records the 2026-09-29 starting state. The user later authorized and verified a full test-data reset in both Supabase projects. As of 2026-10-01, this checkout contains eight local hardening migrations and seven SQL test files in `supabase/`. The newer idempotent posting, Telegram link challenge, and liquid-balance migrations remain local and are not yet verified in production. Do not use the original status table below as a current deployment report.

| Environment | Source checkout | Supabase project | Project ref | Status |
| --- | --- | --- | --- | --- |
| Local development / v2 test | `E:\RR Financial Manager\financial-os`, branch `master`, HEAD `414170e` (`Stop displaying emails in user search results`) | Financial OS v2 | `guvkfuxniprtqdsqlqtx` | Supabase project inventory reports inactive; `.env.local` and local CLI link metadata both identify this ref. |
| Production | Same application source lineage; production deployment commit not yet verified | RR Capital | `hnebvwfgsotrknxpgpmv` | Project inventory reports active healthy. Do not change local `.env.local` to this ref. |

## Source control and secrets

The source directory has Git metadata and local history. No Git remote is configured, so private remote backup/version control is not yet established. `.env*`, Supabase CLI `.temp/` state, and database backup formats are ignored. Never commit credentials, service-role keys, database dumps, or user data.

## Database baseline status

No `supabase/migrations` directory or verified migration history is present in the checkout. Read-only Supabase API calls to list migrations and inspect the Financial OS v2 schema timed out on 2026-09-29. RR Capital has not been inspected or changed in this continuation. A reviewed schema/policies/grants/functions baseline, secure backup, and restore verification remain prerequisites before any production changes.

## Safety gate

Perry remains disconnected from finance data. Do not deploy migrations or connect Perry until schema and policy behavior is captured, backup restore is verified on a safe target, access-control fixes pass staging tests, and production checks pass. Preserve Financial OS v2 data; do not restore over it without first verifying and preserving its contents.

# Environment Baseline

Current environment map, rechecked 2026-10-01. Financial OS v2 and RR Capital are separate Supabase projects with divergent database schemas. RR Capital is the production target; the local browser app still points to v2 for testing.

| Environment | Supabase project | Project ref | Current state |
| --- | --- | --- | --- |
| Local app/test target | Financial OS v2 | `guvkfuxniprtqdsqlqtx` | Active and healthy. Local `.env.local` points here. Its schema is older and materially different from RR Capital. |
| Production | RR Capital | `hnebvwfgsotrknxpgpmv` | Active and healthy. Supabase CLI link metadata targets this project; the full checked-in migration chain is aligned through `20261002030000`. |

## Data reset and current data

The owner authorized deleting all test users, profiles, and financial records in both projects. The resets were verified. Financial OS v2 currently has zero Auth users, profiles, contacts, accounts, transactions, obligations, obligation payments, recurring EMIs, Chittis, and storage objects. RR Capital has one owner profile, with zero accounts and zero transactions; do not remove the active owner profile or reset production again.

## Schema and migration boundaries

The root `supabase/migrations` chain is the current RR Capital schema and has been applied through `20261002030000`. Financial OS v2 has a divergent legacy schema and its own migration history; do not push the RR Capital migration chain to v2 or use v2 as proof that a production migration is safe. V2-only migration records belong in `supabase/v2-migrations/` and must be applied only to `guvkfuxniprtqdsqlqtx`.

RR Capital's CLI link and the local app's `.env.local` intentionally point to different projects. Before any CLI migration or Edge Function deployment, verify the target project ref explicitly. Never print or copy `.env.local`, API keys, service-role credentials, database passwords, Telegram tokens, webhook secrets, recovery snapshots, or user data into logs or Git.

## Verified security state

- RR Capital migration history matches the checked-in chain through `20261002030000_notify_creator_on_request_response.sql`; `supabase db push --linked --dry-run --skip-vault` reported no pending migration.
- Financial OS v2 balance views now use invoker security. Its `obligation_payments` table grants authenticated reads only for rows whose parent obligation includes the current user. Supabase's v2 security advisor currently returns no findings.
- The v2 performance advisor still flags missing foreign-key indexes, auth-policy init-plan work, and multiple permissive transaction policies. The legacy transaction table currently has no rows. Review its old transaction edit policy against the current peer request flow before changing it.
- RR Capital still has informational private-table RLS notices, a managed `pg_net` placement warning, and the Supabase Pro-plan leaked-password setting. See `database-recovery.md` for verified details and current limits.

## Source control and recovery

The public source repository is `https://github.com/ridhwansalim/rr-capital-financial-os`. `.env*`, Supabase CLI `.temp/` state, and database backup formats are ignored. Keep all credentials, service-role keys, database dumps, and user data out of source control. Local recovery snapshots are retained under restricted ACLs; their contents have not been modified.

A full isolated restore rehearsal remains outstanding. Schema and migration checks do not prove backup recoverability, phone/browser behavior, every Telegram delivery, or that the system is risk-free.

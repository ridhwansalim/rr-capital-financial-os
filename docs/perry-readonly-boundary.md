# Perry read-only boundary (local review draft)

Perry is not connected. No Perry Edge Function or Perry-only migration has been deployed or applied to a hosted project, and no Perry credentials have been created.

## Fixed endpoint and identity boundary

`POST /functions/v1/perry-summary` accepts no request body or query parameters. The Edge Function requires a short-lived RR Capital Supabase user access token, independently verifies it with `/auth/v1/user`, and forwards that same token only to the fixed `POST /rest/v1/rpc/personal_summary` endpoint. It uses the project's public anon/publishable API key plus the user's bearer token; it has no service-role key, database URL, PostgreSQL login, arbitrary SQL, caller-supplied user ID, or write capability.

PostgREST derives `auth.uid()` from the forwarded verified user token. The fixed SQL summary requires that subject to match the single owner UUID pinned in the private `private.perry_owner_config` row. A different authenticated user gets a permission-denied response from the database; anonymous users cannot execute the RPC. Authenticated direct requests can call only the same fixed summary projection and remain bound to the pinned owner. No query filters or IDs can change that scope.

The RPC returns only account names/types/personal balances and aggregate transaction counts, income/expense/transfer totals, and first/last timestamps. It includes only completed personal transactions with verified owner-owned accounts, and excludes shared/tagged/contact-linked rows, obligations/payments, corrections, Chitti actions, EMI actions, and ambiguous records. It does not return profiles, contacts, categories, descriptions, IDs, individual transactions, settlement details, recurring EMI rows, or offline outbox data.

## Why the direct database login was retired

The earlier `perry_reader` pooler design failed its least-privilege replay test: it could execute 12 `net` HTTP functions in addition to the intended summary function. A read-only hosted catalog check confirmed that `net` is owned by `supabase_admin` and grants `USAGE` to `PUBLIC` and API roles. The migration role cannot reliably narrow those managed extension grants. Because a direct database login could inherit those network functions, the direct login path is not acceptable. The migration set now leaves the legacy role `NOLOGIN`, removes its application-schema grants, and reasserts that state in a final migration.

The Edge Function must be configured only against RR Capital (`hnebvwfgsotrknxpgpmv`) and use `SUPABASE_URL` plus `SUPABASE_ANON_KEY` or `SUPABASE_PUBLISHABLE_KEY`. The function independently pins the project URL, and the database's private owner pin is the source of truth for Ridhu's identity. Do not add `PERRY_DATABASE_URL`, service-role credentials, or a second user-ID allowlist.

## Perry credential handling and remaining gates

Perry must sign in as Ridhu through Supabase Auth. Store its rotating refresh token only in Perry's supported OS credential store (Windows Credential Manager/DPAPI, macOS Keychain, or Linux Secret Service); keep access tokens in memory and send only short-lived access tokens to this endpoint. Atomically replace the stored refresh token after refresh and erase it on disconnect. If Perry cannot use protected credential storage, abort the integration rather than use plaintext files, browser storage, prompts, logs, or AI Memory.

Before connection, the synthetic SQL and handler tests must pass on a clean replay; the owner-pin singleton must be configured once for Ridhu on an isolated RR Capital branch; the deployed endpoint must reject anonymous, revoked, forged-ID, and non-owner requests; read-only and RPC grants must be rechecked; rate limiting and monitoring must be in place; and Perry's credential-store/refresh behavior must be tested on supported devices. Do not connect Perry until these gates are reviewed and the user explicitly authorizes the connection.

## Verification status

- Handler tests cover owner/non-owner token behavior, Supabase Auth verification, anonymous/revoked/malformed tokens, no body/filters/IDs, no writes, fixed RPC routing and headers, response allowlisting, project pinning, and fail-closed configuration; all 20 assertions passed on 2026-10-02.
- SQL tests use synthetic users/records and verify fixed response projection, owner-only summary, ambiguity exclusions, no direct write/table access, anonymous denial, and the retired database role's NOLOGIN/schema boundary. A clean isolated replay passed 47 migrations, 23 SQL test files, and all 80 pgTAP assertions on 2026-10-02. `npm run build`, `npm run lint` (existing warnings only), date, offline, and bounded-input test suites passed. Strict TypeScript checking passed for the pure handler/project/RPC modules.
- Remaining gates: Deno Edge bundle/typecheck and an end-to-end Auth-to-PostgREST check with synthetic identities on an isolated RR Capital branch; configure and verify the single private owner pin there; add rate limiting and monitoring. The endpoint remains undeployed and Perry remains unconnected.
- No hosted Supabase migration, Perry Edge deployment, owner setup, credential provisioning, user data read, or Perry connection has occurred.

# Financial OS v2 security hardening — 2026-10-03

Financial OS v2 (`guvkfuxniprtqdsqlqtx`) is separate from the RR Capital production database. Its zero-row legacy schema had broad transaction and obligation mutation policies, and its authenticated profile grants also exposed every column, including a plaintext `ai_api_key` and Telegram routing ID.

The hosted v2 chain now has four migrations:

- `20260930165649_secure_access_boundary` restricts profile reads and removes access to private legacy tables and unsafe callable functions.
- `20261001073141_secure_balance_views_and_payment_reads` makes balance views caller-aware and scopes payment reads.
- `20261003150516_disable_legacy_direct_financial_writes` removes direct client writes to transactions and obligations while retaining owner/participant reads.
- `20261003163938_restrict_legacy_profile_columns` permits only selected profile preference reads/updates. Authenticated clients cannot read or update `ai_api_key` or `telegram_chat_id`, nor update profile ID or creation time. There are no table-wide profile SELECT/UPDATE grants.

Fresh hosted postflight shows zero users, profiles, accounts, transactions, and obligations, and the Security Advisor returns zero lints. The isolated local fixture validates both the financial write boundary and sensitive profile column privileges, then confirms its scratch database and temporary SQL files are removed. This chain is v2-only; do not add it to RR Capital's migration sequence. RR Capital's separate readiness gaps remain tracked in `environment-baseline.md`.
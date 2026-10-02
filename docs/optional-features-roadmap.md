# Optional product features roadmap

Status: owner-approved direction and defaults; implementation proceeds phase by phase. Dashboard/report chart drill-down, repeat/templates, account suggestion, calculators, guided help, budgets, savings goals, shopping lists, account health context, and the private financial wellness indicator are implemented locally. No hosted state has been changed for these features.

Sixth implementation checkpoint (2026-10-02): migration `20261002083715_financial_health_score_exclusions.sql` exposes only the signed-in users linked obligation, recurring EMI, and Chitti transaction IDs for exclusion; it accepts no user ID and returns no financial values. Its invoker-rights public wrapper is authenticated-only. The optional Financial Wellness page calculates the approved reserve, cashflow, and credit-utilization factors locally from the signed-in user’s RLS-scoped accounts and completed transactions. It excludes tagged/contact-linked, obligation-payment, recurring-EMI, Chitti, transfer, and offline items through owner-scoped rules, and requires eligible activity in each of the last three complete Asia/Kolkata months, shows factor coverage, and normalizes the score when no credit line applies. No score is persisted and the feature is disabled unless the user enables it in Settings. Six synthetic formula/date/filter tests pass and the production build passes. This is local-only; hosted state and deployment remain unchanged.

First implementation checkpoint (2026-10-02): the local branch added per-user optional-feature flags and the Budgets/Envelopes module. Its migration is `20261002065906_optional_modules_and_budgets.sql`; new users have no flag row (disabled), and database policies hide and reject budget access while the flag is off without deleting saved envelopes. The page supports category envelopes, monthly navigation, completed personal expense totals, report drill-through, and optional positive-unused-amount rollover. This is local work only; it has not been applied to hosted Supabase or deployed. At this checkpoint its synthetic pgTAP test had 11 assertions; later security additions increased the test to 14 assertions.

Second usability checkpoint (2026-10-02): Reports now has a Repeat latest action that opens a fresh transaction draft; the transaction modal also supports owner-scoped cloud-synced templates containing only ordinary draft fields, and suggests the last-used account from a device-local per-user preference. Repeating or applying a template always sets the occurrence date to today and the existing submit path generates a new request ID; it clears contact selection and does not copy completion or settlement state. The template migration is `20261002071443_transaction_templates.sql`, with 9 synthetic ownership/field-boundary pgTAP assertions. Both migrations pass the core clean replay (48 migrations, 26 SQL test files, 91 assertions); the production build and report/date/offline/input/Perry unit suites pass. No hosted state or deployment was changed.

Third implementation checkpoint (2026-10-02): the separately switchable Calculators module provides loan/EMI estimates, extra-payment payoff comparison, and savings growth using only unsaved user inputs. Formula assumptions are visible and no result changes ledger data. Eight pure-math boundary checks pass. Guided page tips are also available once per page on each device, with dismiss, disable, and replay controls in Settings.

Fourth implementation checkpoint (2026-10-02): owner-scoped Savings Goals and Shopping Lists modules are implemented. Goals store targets and explicitly entered contributions as planning-only rows with no account/transaction linkage. Shopping lists store items, quantities, expected costs, and purchased state without implying payment or creating ledger activity. Each module is off by default, separately switchable, and protected by RLS that hides and blocks writes while disabled while retaining saved data. Synthetic SQL coverage adds 31 assertions. The clean local core replay passes 50 migrations, 28 SQL files, and 122 pgTAP assertions; the production build and focused lint/type checks pass. This is local-only work and has not been applied to hosted Supabase or deployed.

Fifth implementation checkpoint (2026-10-02): optional Account Health context is available on Accounts. Owners can set liquid-account minimums and monthly credit statement/due days, with optional in-page warnings; days above the last day of a short month clamp to that month’s last day using Asia/Kolkata calendar dates. The account-health migration is `20261002075519_account_health_settings.sql`. Synthetic RLS/ownership tests add 17 assertions and four date-math tests cover month/year boundaries. Latest isolated core replay passes 51 migrations, 29 SQL files, and 139 pgTAP assertions. No hosted state or deployment changed.

Sixth usability checkpoint (2026-10-02): active finance pages now share `PageHeader` for compact title sizing, icon alignment, consistent description spacing, and responsive action placement. Dashboard, Calendar, Ledger, Reports, Accounts, Debts, Chittis, Contacts, Settings, Offline Queue, and all optional tool pages use it. Page behavior, titles, and actions remain page-specific. TypeScript and production build pass; browser screenshots across light/system/AMOLED and mobile sizes remain to verify.

## Product rule

Preserve RR Capital's existing family/friend cloud-synced finance flows. New modules must not alter how existing transactions, accounts, debts, EMIs, Chittis, reports, or offline posting work. Usability improvements to existing flows are shared product improvements. New financial/workspace modules are independently opt-in per signed-in user in Settings, initially off for each user. Disabling a module hides its navigation and stops module reminders, but never deletes its records or changes ledger rows. Re-enabling restores access to saved module data. Each module must explain what it stores and how it interacts with the ledger before activation.

Feature preferences should be scoped to the authenticated owner (`auth.uid()`), synchronized across that user's devices, protected with RLS, and constrained to a known feature-key allowlist. They must not be stored in a broadly readable profile JSON blob. A user must never be able to change another user's toggles by supplying an owner ID. Navigation, deep links, and RPC/data boundaries must all enforce disabled state; hiding a button alone is insufficient.

## Feature sequence

### 0. Preference and feature-gating foundation

- Add per-user, server-synchronized optional-feature flags with a safe default of disabled for new modules.
- Add Settings controls with descriptions, clear enabled/disabled states, and confirmation for modules that create new personal data.
- Keep financial data when a flag is disabled; do not cascade-delete or rewrite it.
- Gate navigation, route entry, reminders, and write paths. Existing core screens remain available.
- Test owner isolation, anonymous denial, forged owner IDs, default-off behavior, disabling/re-enabling retention, and offline/cache behavior.

### 1. Existing-screen usability improvements

- Standardize page headings, spacing, and content framing across Dashboard, Calendar, Ledger, Reports, Accounts, Debts, Chittis, Contacts, and Settings while respecting light/system/AMOLED themes and mobile safe areas.
- Make dashboard chart segments and date-range selections open the corresponding filtered report/transaction view. Pass a bounded, typed filter state rather than building arbitrary database filters from chart input.
- Add duplicate-entry and saved-template actions. A duplicate/template starts as a draft; its date defaults to today, its request ID is newly generated at save time, and no save happens until user confirmation. Exclude immutable IDs, past status, completed payment/settlement linkage, and other workflow state from copied fields.
- Suggest the last-used account as an editable default; never auto-submit. Keep this preference local to the device unless users later request cross-device behavior.

Implementation note (2026-10-02): Dashboard daily income/expense bars now open the exact date and flow type in Reports. The Reports category donut/legend filter the displayed list and exports; query filters are bounded to valid dates, known transaction types, and UUID or uncategorized category keys. Ten focused helper assertions, app/node TypeScript checks, and a Vite/PWA production build pass. The full SQL suite also passes local core-only, chronological, and staged-then-Perry replays. A signed-in browser interaction check remains pending because browser automation is not installed in this checkout.

### 2. Guided navigation and help

- Group secondary tools in existing navigation without hiding core transaction and ledger access.
- Add short, dismissible explanations for uncommon flows and first-use tips, with a Settings control to replay or disable onboarding hints.
- Do not block normal use with a mandatory tutorial or use help content to steer users into enabling modules.

Implementation note (2026-10-02): dismissible page guidance appears once per page on a device, can be disabled, and can be replayed from Settings. It does not gate core workflows.

### Account context and health

- Add optional user-entered minimum balance thresholds for liquid accounts and statement/due-date context for credit lines.
- Show transparent upcoming-due and threshold indicators with user-controlled notice settings.
- Health findings must identify the exact observed rule and source data; no account values may be silently corrected and no external bank data is inferred.
- Test date boundaries, timezone behavior, missing/late data, and alert deduplication. This module must not mutate balances.

Implementation note (2026-10-02): Accounts supports owner-entered minimum balances for bank/cash/wallet accounts and statement/due days for credit-card/Pay Later accounts. Optional warnings appear only on Accounts and can be hidden. It does not send external reminders, read bank data, estimate statement totals, or alter balances. Days 29-31 clamp to month end. Synthetic SQL tests cover owner isolation, cross-account rejection, default-off retention, field grants, and valid day/type boundaries.

### 4. Budgets and category envelopes

- Optional, personal category budgets based on categorized completed expenses in the selected period; exclude transfers, lend/borrow principal, and voided rows.
- Each envelope should explain planned amount, spent amount, and remaining amount and drill into its matching report entries.
- Budget configuration and data remain private to its owner. They do not create transactions, move money, or prevent transaction entry.
- Owner approved optional rollover. Default behavior: each envelope resets each month; the user may opt an individual envelope into rolling unused allowance into the next month. Rollover calculation must be explicitly labeled and tested across month/year boundaries.

Implementation note (2026-10-02): the module is available per user with monthly category envelopes, report drill-through, and opt-in positive-unused rollover. Transaction entry remains unrestricted.

### 5. Savings goals

- Optional private goals with target amount, target date, and progress.
- Progress can use explicit user-recorded contributions or optionally link existing ledger transfers; linking never creates a second transaction or moves funds.
- A goal is a planning label, not a real bank account or investment product. No savings target changes account balance or creates a financial recommendation.
- Test duplicate linking, edited/voided source entries, target changes, and ownership isolation.

Implementation note (2026-10-02): private goals and explicit dated contributions are implemented as planning-only data. They do not link to transactions or account balances.

### 6. Shopping lists

- Optional private lists with items, quantity, expected cost, and purchased state.
- Purchased items remain list records unless the user explicitly chooses to start a separate transaction draft; never auto-post a transaction or imply that a purchase was paid from a specific account.
- Support archive/delete with clear confirmation and owner-only access.

Implementation note (2026-10-02): private lists support archive/restore, items, quantity, expected cost, and purchased status; no action records a transaction.

### 7. Calculators

- Optional, read-only calculators. Initial proposal: loan/EMI payment, remaining loan payoff comparison, and savings growth using user-entered assumptions.
- Show inputs, formula/assumptions, units, and approximate result; do not save assumptions unless the user explicitly saves a named scenario.
- Calculator output must never create a transaction, EMI schedule, or account record automatically. Do not present it as personalized investment or credit advice.

Implementation note (2026-10-02): EMI, additional-payment payoff comparison, and savings-growth calculators are available in the optional Calculators page; inputs are session-only and results do not mutate accounts or transactions.

### 10. Financial score

- Optional and private. Owner approved a transparent wellness indicator with no credit claim. It must not predict eligibility, rank users, be shared with counterparties, or influence other app behavior.
- Reserve: 40 points for liquid balance divided by average monthly personal expenses over the last three complete months, capped at full points at two months of reserve.
- Cash flow: 35 points mapping the three-month personal surplus share linearly from negative 20% (0 points) to positive 20% (35 points).
- Credit line: 25 times (1 minus utilization), with utilization clamped to 0-100%. If no personal credit line applies, that factor is not applicable and the score is normalized over remaining factors; factor coverage is displayed.
- Exclude tagged and contact-linked activity, Chitti-marked transactions, transfers, unknown-account entries, shared/ambiguous entries, and offline items. Debts and EMIs are not assessed.
- If any of the last three complete months has no eligible personal entry, show insufficient data instead of treating missing history as poor financial health. The score is derived at display time and is not persisted.
## Release and verification gates

Ship one phase at a time, with a reviewed migration if persistence changes, owner-scoped RLS tests, mobile and desktop UI verification, updated documentation, and a rollback-compatible release. No phase is complete based solely on a successful build. Verify disabled deep links and direct API attempts, theme contrast, device caching, and preservation of existing transaction/debt/EMI/Chitti behavior. Do not deploy a phase until its tests and release diff have been reviewed.

## Confirmed product choices

1. Shared usability improvements are universal. Each new module starts disabled per user; disabling hides it and stops reminders while retaining its data.
2. Budgets may optionally roll over unused amounts. Monthly reset is the default; rollover is an opt-in setting per envelope.
3. The financial score is a private, transparent wellness indicator and makes no credit-score claim. Review its factors and weights with synthetic examples before coding.
4. Later module-specific choices (budget period, goal contribution method, shopping-list details, calculator set, and account due/threshold notices) will be finalized at the start of each phase.

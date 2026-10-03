# RR Capital navigation map

The app navigation breakpoint is 768 px (`md`). `/auth` is public and renders outside the protected app shell, so it has no workspace navigation. Unknown protected routes redirect to `/` and show a short notice. Account Health is embedded in `/accounts`; its Settings toggle controls that panel.

| Page or module | Route | Access | Desktop (>= 768 px) | Mobile (< 768 px) |
| --- | --- | --- | --- | --- |
| Dashboard | `/` | Protected | Top bar 1 | Bottom bar 1 |
| Calendar | `/calendar` | Protected | Top bar 2 | More drawer |
| Ledger | `/ledger` | Protected | Top bar 3 | Bottom bar 2 |
| Reports | `/reports` | Protected | Top bar 4 | More drawer |
| Accounts | `/accounts` | Protected | Top bar 5 | More drawer |
| Chittis | `/chittis` | Protected | More: Workspace | Bottom bar 4 |
| Debts & IOUs | `/debts` | Protected | More: Workspace | More drawer |
| Contacts | `/contacts` | Protected | More: Workspace | More drawer |
| Offline queue | `/offline` | Protected | More: Workspace; pending badge | More drawer; pending header pill |
| Settings | `/settings` | Protected | More: Preferences | More drawer: Preferences |
| Budgets and envelopes | `/budgets` | Optional | More: Optional modules when enabled | More drawer when enabled |
| Calculators | `/calculators` | Optional | More: Optional modules when enabled | More drawer when enabled |
| Savings goals | `/savings-goals` | Optional | More: Optional modules when enabled | More drawer when enabled |
| Shopping lists | `/shopping-lists` | Optional | More: Optional modules when enabled | More drawer when enabled |
| Financial wellness | `/financial-health` | Optional | More: Optional modules when enabled | More drawer when enabled |
| Account Health | In `/accounts` | Optional sub-feature | Embedded in Accounts when enabled | Embedded in Accounts when enabled |
| Sign in | `/auth` | Public | Standalone editorial layout | Standalone editorial layout |

The desktop top bar is 64 px tall and includes the five primary pages, the coral Add menu, and categorized More menu. Mobile uses a compact context header and a pinned five-slot bar: Dashboard, Ledger, Add, Chittis, More. The More drawer groups other workspace pages, enabled optional modules, and Settings. Disabled optional routes redirect to Dashboard.

The RR Capital logo opens the creator profile dialog, with the project creator's portrait and profile links.

For each production release, update `public/release-notes.json` with that release's version, timestamp, brief, and detailed summary. Installed older clients fetch this file from the server when Settings is opened; the bundled notes remain available offline.

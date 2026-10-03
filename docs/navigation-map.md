# RR Capital navigation and workspace map

`src/lib/routeRegistry.ts` is the source of truth for all 15 protected routes: titles, icons, canonical Settings groups, default placement, optional-feature keys, page workspace slots, and lazy screen loaders. `/auth` is the single public route and is rendered outside the protected app shell, so neither navigation bar appears there. Unknown routes and disabled optional modules redirect to `/`.

The navigation breakpoint is 768 px. On desktop, routes placed in the navbar appear in the top bar, with Settings pinned at the end and the shared add action alongside it. On mobile, navbar routes are arranged around the centered add action in a floating bottom bar; Settings stays pinned at the end. Placement is user-scoped in local storage and updates the bars and Settings launcher immediately. Calendar defaults to the navbar on desktop and Settings on mobile; a saved placement can override either default.

Routes placed inside Settings are grouped automatically by their permanent `settingsGroup`:

| Canonical group | Routes |
| --- | --- |
| Core Operations & Daily Flow | Ledger, Calendar |
| Commitments, Credit & Chittis | Chittis, Debts & IOUs |
| Vaults, Directory & Sync | Accounts, Contacts, Offline queue |
| Analytics, Planning & Wellness | Reports, Financial wellness, Budgets, Savings goals |
| Tools & Lifestyle Utilities | Calculators, Shopping lists |

Dashboard and Settings remain fixed anchors rather than movable launcher modules. Optional modules appear in navigation and Settings only while enabled. Account Health is an optional sub-feature inside `/accounts`, not a route. Feature flags remain controlled by the existing signed-in feature settings and are mirrored alongside workspace preferences.

When a route is assigned to Settings, `SettingsPageShell` adds a Settings breadcrumb, a placement control, a three-card KPI summary placeholder row, and the route's 12-column bento workspace placeholders before rendering the existing page screen. Moving the route to the navbar removes it from the Settings groups and removes this contextual shell; moving it back restores both automatically.

For each production release, update `public/release-notes.json` with that release's version, timestamp, brief, and detailed summary. Installed older clients fetch this file from the server when Settings is opened; the bundled notes remain available offline.

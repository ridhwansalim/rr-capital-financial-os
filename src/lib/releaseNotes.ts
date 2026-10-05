export type ReleaseNotes = {
  version: string
  releasedAt: string
  brief: string
  details: string[]
}

// Update this entry for each user-facing production release. The date is the
// release date, not the time this client happens to check for a new build.
export const currentRelease: ReleaseNotes = {
  version: '2026.10.5',
  releasedAt: '2026-10-05T00:00:00+05:30',
  brief: 'RR Capital adds a native Android sign-in return, private on-device transaction message parsing, and automatic web-bundle updates.',
  details: [
    'Desktop and mobile navigation use one route registry. Settings remains pinned, and moving a module between navigation and Settings updates its canonical group automatically.',
    'Mobile navigation is a fixed, floating glass dock with a centered Add action and safe-area spacing.',
    'Optional modules can be enabled in Settings; disabled optional routes return to Dashboard, and Account Health remains embedded in Accounts.',
    'Page placeholders use a consistent KPI and workspace-slot layout, with a Settings breadcrumb and placement control for modules opened from the hub.',
    'Settings includes the light/dark appearance switcher and persistent workspace preferences.',
    'The mobile Add control opens Transaction and Debt / IOU forms reliably, including on short phone viewports.',
    'The RR Capital logo opens a responsive creator details modal with a liquid-glass surface and one close control.',
    'Creator profile social links use recognizable logos and network colors, with readable theme-aware text and no pointer-following highlight.',
    'Preference switches and selection controls use theme-aware liquid-glass styling, and the Dashboard heading no longer has excess space above it.',
    'Telegram Settings verifies webhook setup and one-time challenge linking; automated checks use synthetic responses and do not contact Telegram.',
    'The Mobile/Desktop navbar layout selector has a stronger translucent glass cap, while desktop Add remains a floating lower-right action.',
    'Backdated credit-line purchases are rejected if the dated balance would exceed the approved limit, even when a later credit would make the current balance appear safe.',
    'Android Google sign-in returns through the native app callback. Native message intake parses locally and only stores transaction candidates after explicit permission is enabled.',
    'Android web-only releases can update in the background with a self-hosted, checksum-verified bundle feed; native code changes still require an APK update.',
  ],
}

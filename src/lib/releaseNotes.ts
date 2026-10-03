export type ReleaseNotes = {
  version: string
  releasedAt: string
  brief: string
  details: string[]
}

// Update this entry for each user-facing production release. The date is the
// release date, not the time this client happens to check for a new build.
export const currentRelease: ReleaseNotes = {
  version: '2026.10.03.3',
  releasedAt: '2026-10-03T08:15:51+05:30',
  brief: 'Desktop Add actions now use the restored floating coral button. Liquid-glass controls and cleaner Dashboard spacing round out the updated navigation.',
  details: [
    'Desktop navigation keeps Dashboard, Calendar, Ledger, Reports, and Accounts in the top bar, with the coral Add action floating at the lower right.',
    'Mobile navigation keeps Dashboard, Ledger, Add, Chittis, and More in the bottom bar; the More drawer groups the remaining pages.',
    'The More menus show only enabled optional modules, and the offline queue shows its pending count.',
    'The RR Capital logo opens the creator profile with a photo and social links.',
    'When a new app build is available, the notice points to Settings. Settings can check for updates and show the release date, brief, and detailed notes.',
    'Preference switches and primary actions now use theme-aware liquid-glass styling, and the Dashboard heading no longer has excess space above it.',
    'A keyboard-accessible liquid-glass range control is available for future slider settings.',
  ],
}

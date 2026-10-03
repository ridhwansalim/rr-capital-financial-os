export type ReleaseNotes = {
  version: string
  releasedAt: string
  brief: string
  details: string[]
}

// Update this entry for each user-facing production release. The date is the
// release date, not the time this client happens to check for a new build.
export const currentRelease: ReleaseNotes = {
  version: '2026.10.03',
  releasedAt: '2026-10-03T06:36:00+05:30',
  brief: 'Clearer navigation, a creator profile from the RR Capital logo, and a Settings page for update details.',
  details: [
    'Desktop navigation now keeps Dashboard, Calendar, Ledger, Reports, and Accounts in the top bar, with the Add action beside them.',
    'Mobile navigation keeps Dashboard, Ledger, Add, Chittis, and More in the bottom bar; the More drawer groups the remaining pages.',
    'The More menus show only enabled optional modules, and the offline queue shows its pending count.',
    'The RR Capital logo opens the creator profile with a photo and social links.',
    'When a new app build is available, the notice points to Settings. Settings can check for updates and show the release date, brief, and detailed notes.',
  ],
}

const preferenceKey = (userId: string) => `rr:guided-help:${userId}`
const dismissedPrefix = (userId: string) => `rr:guided-help-dismissed:${userId}:`

export function isGuidedHelpEnabled(userId: string): boolean {
  try { return localStorage.getItem(preferenceKey(userId)) !== 'off' } catch { return true }
}

export function setGuidedHelpEnabled(userId: string, enabled: boolean) {
  try { localStorage.setItem(preferenceKey(userId), enabled ? 'on' : 'off') } catch { /* Local convenience preference only. */ }
  window.dispatchEvent(new Event('rr:guided-help-changed'))
}

export function isGuidanceDismissed(userId: string, page: string): boolean {
  try { return localStorage.getItem(`${dismissedPrefix(userId)}${page}`) === 'yes' } catch { return false }
}

export function dismissGuidance(userId: string, page: string) {
  try { localStorage.setItem(`${dismissedPrefix(userId)}${page}`, 'yes') } catch { /* Local convenience preference only. */ }
}

export function replayGuidance(userId: string) {
  try {
    const keys = Object.keys(localStorage).filter(key => key.startsWith(dismissedPrefix(userId)))
    keys.forEach(key => localStorage.removeItem(key))
  } catch { /* Local convenience preference only. */ }
  window.dispatchEvent(new Event('rr:guided-help-changed'))
}

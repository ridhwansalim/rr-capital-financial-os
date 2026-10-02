/** Safe copy for local queue errors. Never persist PostgREST/SQL error text,
 * which can echo submitted values, identifiers, or internal diagnostics. */
export function offlineRejectionMessage(code: string | null | undefined): string {
  if (code?.startsWith('22')) {
    return 'The server rejected the amount or date. Keep this entry for reference, then discard and enter it again with corrected details.'
  }
  if (code?.startsWith('23')) {
    return 'An account or related record is unavailable. Check your accounts and contacts, then discard and enter this transaction again.'
  }
  if (code === '42501') {
    return 'The server blocked this entry. Check the selected account, sign-in, and balance on the transaction date before entering it again.'
  }
  if (code?.startsWith('PGRST2')) {
    return 'The app and server schema may be out of date. Refresh the app, then retry this entry.'
  }
  return 'The server rejected this entry. Review it and enter it again if needed.'
}

export const OFFLINE_RETRY_MESSAGE = 'Connection or server issue. This entry remains safely queued and will retry with the same request ID.'

export type OfflineStatusRecord = { sync_status: string; last_error?: string | null }

export function safePersistedOfflineMessage(syncStatus: string, lastError?: string | null): string | null {
  if (!lastError) return null
  return syncStatus === 'failed' ? offlineRejectionMessage(null) : OFFLINE_RETRY_MESSAGE
}

/** Convert both new and legacy persisted diagnostics to fixed safe copy. */
export function redactPersistedOfflineError<T extends OfflineStatusRecord>(item: T): T {
  if (item.last_error) {
    item.last_error = safePersistedOfflineMessage(item.sync_status, item.last_error)
  }
  return item
}

import { localDB, type LocalTransaction } from './db'
import { supabase } from './supabase'
import { ensureOfflineRequestId } from './offlineRequestId'
import { discardFailedOutboxItem as discardFailedItem } from './offlineQueueActions'
import { canSyncOfflineItem } from './offlineOwnership'

let activeSync: Promise<void> | null = null

export function postQueuedTransaction(txn: LocalTransaction) {
  if (!txn.request_id) throw new Error('Offline transaction is missing its request ID')
  return supabase.rpc('post_ledger_transaction', {
    p_request_id: txn.request_id,
    p_from_account_id: txn.from_account_id,
    p_to_account_id: txn.to_account_id,
    p_amount: txn.amount,
    p_fee_amount: txn.fee_amount,
    p_description: txn.description,
    p_created_at: txn.created_at,
    p_tagged_profile_id: txn.tagged_profile_id || null,
    p_contact_id: txn.contact_id || null,
    p_obligation_id: txn.obligation_id || null,
    p_new_contact_name: txn.new_contact_name || null
  })
}

async function runSync() {
  if (!navigator.onLine) return
  try {
    const pending = await localDB.outbox.where('sync_status').equals('pending').toArray()
    if (pending.length === 0) return

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return

    for (const txn of pending) {
      // A shared browser can have pending entries for a different login.
      if (!canSyncOfflineItem(txn, user.id) || txn.id === undefined) continue

      // The account can change while this loop is running in another tab.
      // Stop before sending anything under a different session; the database
      // remains the final owner check for the narrow race after this read.
      const { data: { session: currentSession }, error: sessionError } = await supabase.auth.getSession()
      if (sessionError || !canSyncOfflineItem(txn, currentSession?.user.id)) return

      // Assign legacy IDs atomically: two tabs must not create different IDs
      // for one queued transaction, or the server would correctly treat them
      // as two distinct requests.
      const claimed = await ensureOfflineRequestId<LocalTransaction>(localDB, txn.id, user.id)
      if (!claimed?.request_id) continue
      const requestId = claimed.request_id

      const { data: { session: sendSession }, error: sendSessionError } = await supabase.auth.getSession()
      if (sendSessionError || !canSyncOfflineItem(claimed, sendSession?.user.id)) return

      try {
        const { error } = await postQueuedTransaction({ ...claimed, request_id: requestId })
        if (error) {
          // Validation and permission failures need user attention. Keep
          // transport/server failures pending so reconnection retries them.
          const needsAttention = /^(22|23|42501|PGRST2)/.test(error.code || '')
          await localDB.outbox.update(txn.id, {
            sync_status: needsAttention ? 'failed' : 'pending',
            last_error: error.message, last_attempt_at: new Date().toISOString()
          })
          if (!needsAttention) break
          continue
        }
        await localDB.outbox.delete(txn.id)
      } catch (error) {
        await localDB.outbox.update(txn.id, {
          last_error: error instanceof Error ? error.message : 'Connection failed',
          last_attempt_at: new Date().toISOString()
        })
        break
      }
    }
  } catch (error) {
    console.error('Could not read or sync offline transactions:', error)
  }
}

export function syncOutbox(): Promise<void> {
  if (activeSync) return activeSync
  activeSync = runSync().finally(() => { activeSync = null })
  return activeSync
}

export async function retryOutboxItem(id: number, ownerId: string): Promise<void> {
  if (activeSync) await activeSync
  const item = await localDB.outbox.get(id)
  if (!item || item.owner_id !== ownerId) return
  await localDB.outbox.update(id, { sync_status: 'pending', last_error: null })
  await syncOutbox()
}

export async function retryOutboxItems(ids: number[], ownerId: string): Promise<void> {
  if (activeSync) await activeSync
  const uniqueIds = [...new Set(ids.filter(Number.isSafeInteger))]
  await localDB.transaction('rw', localDB.outbox, async () => {
    for (const id of uniqueIds) {
      const item = await localDB.outbox.get(id)
      if (item?.owner_id === ownerId) {
        await localDB.outbox.update(id, { sync_status: 'pending', last_error: null })
      }
    }
  })
  await syncOutbox()
}

export async function discardFailedOutboxItem(id: number, ownerId: string): Promise<boolean> {
  const { data, error } = await supabase.auth.getUser()
  if (error || data.user?.id !== ownerId) throw new Error('Your sign-in changed. Reload the queue and try again.')
  return discardFailedItem<LocalTransaction>(localDB, id, ownerId)
}

window.addEventListener('online', () => { void syncOutbox() })
window.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void syncOutbox()
})
supabase.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_IN') setTimeout(() => { void syncOutbox() }, 0)
})
void syncOutbox()

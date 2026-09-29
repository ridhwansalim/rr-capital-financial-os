import { localDB } from './db'
import { supabase } from './supabase'

export async function syncOutbox() {
  // 1. If offline, stop immediately.
  if (!navigator.onLine) return

  const pendingTxns = await localDB.outbox.where('sync_status').equals('pending').toArray()
  if (pendingTxns.length === 0) return 

  console.log(`Attempting to sync ${pendingTxns.length} offline transactions...`)

  // 2. NEW FOR V2: We MUST get your cryptographic user ID for RLS!
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    console.error('Cannot sync: No authenticated user found.')
    return
  }

  for (const txn of pendingTxns) {
    try {
      // 3. Insert the real transaction WITH your initiator ID
      const { data: newTxn, error: txnError } = await supabase
        .from('transactions')
        .insert({
          initiator_profile_id: user.id, // <-- V2 Security Requirement
          from_account_id: txn.from_account_id,
          to_account_id: txn.to_account_id,
          amount: txn.amount,
          fee_amount: txn.fee_amount,
          description: txn.description,
          status: 'COMPLETED', // Offline outbox items are standard completed transfers
          created_at: txn.created_at
        })
        .select('id')
        .single() // Ask Supabase to return the new row ID

      if (txnError) {
        console.error('Transaction sync failed:', txnError.message)
        continue // Skip to the next one
      }

      // 4. Preserved V1 Logic: If this was a debt payment, link it!
      if (txn.obligation_id && newTxn) {
        const { error: oblError } = await supabase
          .from('obligation_payments')
          .insert({
            obligation_id: txn.obligation_id,
            transaction_id: newTxn.id,
            amount: txn.amount
          })
          
        if (oblError) {
          console.error('Failed to link obligation:', oblError.message)
          continue
        }
      }

      // 5. Success. Remove from the local offline device.
      await localDB.outbox.delete(txn.id!)
      console.log(`Successfully synced transaction ${txn.id}`)
      
    } catch (err) {
      console.error('Network error during sync:', err)
      break 
    }
  }
}

// Auto-sync the exact second the device reconnects to Wi-Fi or 4G/5G
window.addEventListener('online', syncOutbox)

// Attempt a sync immediately whenever the app boots up
syncOutbox()
import Dexie, { type Table } from 'dexie'

export interface CachedAccount {
  id: string
  name: string
  type: string
  opening_date?: string
}

export interface CachedContact {
  id: string
  name: string
}

export interface LocalTransaction {
  id?: number
  request_id?: string
  owner_id: string
  from_account_id: string | null
  to_account_id: string | null
  amount: number
  fee_amount: number
  description: string
  sync_status: 'pending' | 'synced' | 'failed'
  last_error?: string | null
  last_attempt_at?: string | null
  created_at: string
  obligation_id?: string | null // Preserved for the upcoming Debts phase!
  tagged_profile_id?: string | null
  contact_id?: string | null
  new_contact_name?: string | null
}

export class FinancialDatabase extends Dexie {
  outbox!: Table<LocalTransaction>
  accountCache!: Table<{ owner_id: string; accounts: CachedAccount[] }, string>
  contactCache!: Table<{ owner_id: string; contacts: CachedContact[] }, string>

  constructor() {
    super('FinancialOS_OfflineDB')
    
    // Bumped to version 4 to ensure a clean schema mapping for V2
    this.version(4).stores({
      outbox: '++id, sync_status, created_at'
    })
    this.version(5).stores({
      outbox: '++id, sync_status, created_at',
      accountCache: 'owner_id',
      contactCache: 'owner_id'
    })
    this.version(6).stores({
      outbox: '++id, sync_status, created_at',
      accountCache: 'owner_id',
      contactCache: 'owner_id'
    }).upgrade(async transaction => {
      // Remove financial amounts from caches created by versions <= 5 while
      // preserving account choices and every pending outbox transaction.
      await transaction.table('accountCache').toCollection().modify((cache: { accounts?: Array<Record<string, unknown>> }) => {
        if (!Array.isArray(cache.accounts)) return
        cache.accounts = cache.accounts.map(account => ({
          id: String(account.id ?? ''),
          name: String(account.name ?? ''),
          type: String(account.type ?? ''),
          ...(typeof account.opening_date === 'string' ? { opening_date: account.opening_date } : {})
        }))
      })
    })
  }
}

export const localDB = new FinancialDatabase()

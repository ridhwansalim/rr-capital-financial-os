import Dexie, { type Table } from 'dexie'

export interface LocalTransaction {
  id?: number
  from_account_id: string | null
  to_account_id: string | null
  amount: number
  fee_amount: number
  description: string
  sync_status: 'pending' | 'synced' | 'failed'
  created_at: string
  obligation_id?: string | null // Preserved for the upcoming Debts phase!
}

export class FinancialDatabase extends Dexie {
  outbox!: Table<LocalTransaction>

  constructor() {
    super('FinancialOS_OfflineDB')
    
    // Bumped to version 4 to ensure a clean schema mapping for V2
    this.version(4).stores({
      outbox: '++id, sync_status, created_at'
    })
  }
}

export const localDB = new FinancialDatabase()
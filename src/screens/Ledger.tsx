import React, { useState, useEffect } from 'react'
import { ArrowRightLeft, Search, Filter, Loader2, IndianRupee, User, Wallet, ArrowDownRight, ArrowUpRight } from 'lucide-react'
import { supabase } from '../lib/supabase'

interface Transaction {
  id: string
  amount: number
  description: string
  created_at: string
  type: 'income' | 'expense' | 'transfer'
  accountName: string
  taggedName: string | null
}

export default function Ledger() {
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [filterType, setFilterType] = useState<'all' | 'income' | 'expense' | 'transfer'>('all')

  useEffect(() => {
    fetchTransactions()
  }, [])

  const fetchTransactions = async () => {
    setIsLoading(true)
    try {
      // 1. Fetch all transactions
      const { data: txData, error: txError } = await supabase
        .from('transactions')
        .select('*')
        .order('created_at', { ascending: false })

      if (txError) throw txError
      if (!txData) return

      // 2. Extract unique IDs to fetch related names in bulk
      const accountIds = new Set<string>()
      const profileIds = new Set<string>()
      const contactIds = new Set<string>()

      txData.forEach(tx => {
        if (tx.from_account_id) accountIds.add(tx.from_account_id)
        if (tx.to_account_id) accountIds.add(tx.to_account_id)
        if (tx.tagged_profile_id) profileIds.add(tx.tagged_profile_id)
        if (tx.contact_id) contactIds.add(tx.contact_id)
      })

      // 3. Fetch all related names
      const nameMap: Record<string, string> = {}
      
      if (accountIds.size > 0) {
        const { data: accounts } = await supabase.from('accounts').select('id, name').in('id', Array.from(accountIds))
        accounts?.forEach(a => nameMap[a.id] = a.name)
      }
      if (profileIds.size > 0) {
        const { data: profiles } = await supabase.from('profile_directory').select('id, full_name, username').in('id', Array.from(profileIds))
        profiles?.forEach(p => nameMap[p.id] = p.full_name || p.username || 'User')
      }
      if (contactIds.size > 0) {
        const { data: contacts } = await supabase.from('contacts').select('id, name').in('id', Array.from(contactIds))
        contacts?.forEach(c => nameMap[c.id] = c.name)
      }

      // 4. Map the raw data into our clean UI interface
      const formattedData = txData.map(tx => {
        let type: 'income' | 'expense' | 'transfer' = 'transfer'
        let accountName = 'Unknown Account'
        
        if (!tx.from_account_id) {
          type = 'income'
          accountName = nameMap[tx.to_account_id] || accountName
        } else if (!tx.to_account_id) {
          type = 'expense'
          accountName = nameMap[tx.from_account_id] || accountName
        } else {
          accountName = `${nameMap[tx.from_account_id]} → ${nameMap[tx.to_account_id]}`
        }

        let taggedName = null
        if (tx.tagged_profile_id) taggedName = nameMap[tx.tagged_profile_id]
        else if (tx.contact_id) taggedName = nameMap[tx.contact_id]

        return {
          id: tx.id,
          amount: Number(tx.amount),
          description: tx.description,
          created_at: tx.created_at,
          type,
          accountName,
          taggedName
        }
      })

      setTransactions(formattedData)
    } catch (error) {
      console.error('Error fetching transactions:', error)
    } finally {
      setIsLoading(false)
    }
  }

  // Client-side filtering and searching
  const filteredTransactions = transactions.filter(tx => {
    const matchesFilter = filterType === 'all' || tx.type === filterType
    const searchLower = searchQuery.toLowerCase()
    const matchesSearch = 
      tx.description.toLowerCase().includes(searchLower) || 
      (tx.taggedName && tx.taggedName.toLowerCase().includes(searchLower)) ||
      tx.accountName.toLowerCase().includes(searchLower)
    
    return matchesFilter && matchesSearch
  })

  return (
    <div className="p-4 sm:p-6 w-full max-w-5xl mx-auto text-white animate-in fade-in duration-300 pb-32">
      
      {/* Header */}
      <div className="flex justify-between items-end mb-8">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold flex items-center">
            <ArrowRightLeft className="w-7 h-7 sm:w-8 sm:h-8 mr-3 text-indigo-400" />
            Transactions
          </h1>
          <p className="text-slate-400 mt-1">Your complete master ledger</p>
        </div>
      </div>

      {/* Search & Filters */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        
        <div className="relative flex-1 md:max-w-md">
          <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input 
            type="text" 
            placeholder="Search descriptions, contacts, or accounts..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded-xl pl-11 pr-4 py-3 text-sm outline-none focus:border-indigo-500/50 transition-colors placeholder:text-slate-500"
          />
        </div>

        <div className="grid grid-cols-4 p-1 bg-white/5 border border-white/10 rounded-xl backdrop-blur-md min-w-0">
          {(['all', 'income', 'expense', 'transfer'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilterType(f)}
              className={`px-2 sm:px-5 py-2 text-xs sm:text-sm font-semibold rounded-lg transition-all capitalize whitespace-nowrap ${
                filterType === f ? 'bg-indigo-500/20 text-indigo-400 shadow-sm' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {f}
            </button>
          ))}
        </div>

      </div>

      {/* Transaction List */}
      {isLoading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
        </div>
      ) : filteredTransactions.length === 0 ? (
        <div className="p-8 border border-dashed border-white/10 rounded-3xl bg-white/5 flex flex-col items-center justify-center text-center mt-4">
          <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mb-4">
            <ArrowRightLeft className="w-8 h-8 text-slate-500" />
          </div>
          <h3 className="text-lg font-semibold text-slate-300">No transactions found</h3>
          <p className="text-sm text-slate-500 max-w-sm mt-2">
            {searchQuery ? "Try adjusting your search or filters." : "Use the + button to log your first transaction."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredTransactions.map((tx) => (
            <div key={tx.id} className="p-4 bg-white/5 border border-white/10 rounded-2xl hover:bg-white/10 transition-colors backdrop-blur-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              
              <div className="flex items-start sm:items-center space-x-4">
                <div className={`p-3 rounded-xl flex-shrink-0 ${
                  tx.type === 'income' ? 'bg-emerald-500/20 text-emerald-400' : 
                  tx.type === 'expense' ? 'bg-rose-500/20 text-rose-400' : 
                  'bg-indigo-500/20 text-indigo-400'
                }`}>
                  {tx.type === 'income' ? <ArrowUpRight className="w-5 h-5" /> : 
                   tx.type === 'expense' ? <ArrowDownRight className="w-5 h-5" /> : 
                   <ArrowRightLeft className="w-5 h-5" />}
                </div>
                
                <div>
                  <h3 className="font-semibold text-slate-200 text-base">{tx.description}</h3>
                  <div className="flex flex-wrap items-center gap-2 mt-1">
                    <span className="text-xs text-slate-500">
                      {new Date(tx.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                    </span>
                    <span className="text-slate-700 text-xs">•</span>
                    <span className="flex items-center text-xs text-slate-400 font-medium">
                      <Wallet className="w-3 h-3 mr-1 opacity-70" /> {tx.accountName}
                    </span>
                    
                    {/* Tag Badge */}
                    {tx.taggedName && (
                      <>
                        <span className="text-slate-700 text-xs">•</span>
                        <span className="flex items-center text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                          <User className="w-3 h-3 mr-1" /> {tx.taggedName}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center sm:justify-end text-xl font-black ml-12 sm:ml-0">
                <span className={tx.type === 'income' ? 'text-emerald-400' : tx.type === 'expense' ? 'text-rose-400' : 'text-slate-300'}>
                  {tx.type === 'expense' ? '-' : tx.type === 'income' ? '+' : ''}₹{tx.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </span>
              </div>
              
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

import React, { useState, useEffect, useMemo } from 'react'
import { ArrowRightLeft, Search, Loader2, User, Wallet, ArrowDownRight, ArrowUpRight, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { formatIndiaDate } from '../lib/financeDate'
import PageHeader from '../components/PageHeader'
import LiquidGlassSwitcher from '../components/ui/LiquidGlassSwitcher'
import { liquidGlassItemProps } from '../components/ui/liquidGlassSwitcherItem'
import { Link, useSearchParams } from 'react-router-dom'

interface Transaction {
  id: string
  amount: number
  description: string
  created_at: string
  type: 'income' | 'expense' | 'transfer'
  accountName: string
  taggedName: string | null
  contactId: string | null
  profileId: string | null
  categoryId: string | null
  categoryName: string | null
}

export default function Ledger() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [filterType, setFilterType] = useState<'all' | 'income' | 'expense' | 'transfer'>('all')
  const [visibleCount, setVisibleCount] = useState(50)

  const fetchTransactions = async () => {
    try {
      // 1. Fetch all transactions
      const { data: txData, error: txError } = await supabase
        .from('transactions')
        .select('id, amount, description, created_at, from_account_id, to_account_id, tagged_profile_id, contact_id, category_id')
        .order('created_at', { ascending: false })

      if (txError) throw txError
      if (!txData) return

      // 2. Extract unique IDs to fetch related names in bulk
      const accountIds = new Set<string>()
      const profileIds = new Set<string>()
      const contactIds = new Set<string>()
      const categoryIds = new Set<string>()

      txData.forEach(tx => {
        if (tx.from_account_id) accountIds.add(tx.from_account_id)
        if (tx.to_account_id) accountIds.add(tx.to_account_id)
        if (tx.tagged_profile_id) profileIds.add(tx.tagged_profile_id)
        if (tx.contact_id) contactIds.add(tx.contact_id)
        if (tx.category_id) categoryIds.add(tx.category_id)
      })

      // 3. Fetch all related names
      const nameMap: Record<string, string> = {}
      
      // Enrichment tables are independent; query them together to avoid serial
      // round trips after the transaction list on higher-latency mobile networks.
      const [accountResult, profileResult, contactResult, categoryResult] = await Promise.all([
        accountIds.size > 0
          ? supabase.from('accounts').select('id, name').in('id', Array.from(accountIds))
          : Promise.resolve({ data: [], error: null }),
        profileIds.size > 0
          ? supabase.rpc('profile_labels', { p_profile_ids: Array.from(profileIds) })
          : Promise.resolve({ data: [], error: null }),
        contactIds.size > 0
          ? supabase.from('contacts').select('id, name').in('id', Array.from(contactIds))
          : Promise.resolve({ data: [], error: null }),
        categoryIds.size > 0
          ? supabase.from('transaction_categories').select('id, name').in('id', Array.from(categoryIds))
          : Promise.resolve({ data: [], error: null }),
      ])
      accountResult.data?.forEach(a => nameMap[a.id] = a.name)
      profileResult.data?.forEach((p: { id: string; full_name: string | null; username: string | null }) => nameMap[p.id] = p.full_name || p.username || 'User')
      contactResult.data?.forEach(c => nameMap[c.id] = c.name)
      categoryResult.data?.forEach(c => nameMap[`category:${c.id}`] = c.name)

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
          taggedName,
          contactId: tx.contact_id,
          profileId: tx.tagged_profile_id,
          categoryId: tx.category_id,
          categoryName: tx.category_id ? nameMap[`category:${tx.category_id}`] || 'Category' : null,
        }
      })

      setTransactions(formattedData)
    } catch {
      console.error('Could not load ledger entries')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void fetchTransactions()
  }, [])

  useEffect(() => {
    const type = searchParams.get('type')
    if (type === 'income' || type === 'expense' || type === 'transfer') setFilterType(type)
    else if (!type) setFilterType('all')
    setVisibleCount(50)
  }, [searchParams])

  // Client-side filtering and searching
  const filteredTransactions = useMemo(() => transactions.filter(tx => {
    const matchesFilter = filterType === 'all' || tx.type === filterType
    const searchLower = searchQuery.toLowerCase()
    const matchesSearch = 
      tx.description.toLowerCase().includes(searchLower) || 
      (tx.taggedName && tx.taggedName.toLowerCase().includes(searchLower)) ||
      tx.accountName.toLowerCase().includes(searchLower)
    
    const contactMatch = !searchParams.get('contact_id') || tx.contactId === searchParams.get('contact_id')
    const profileMatch = !searchParams.get('profile_id') || tx.profileId === searchParams.get('profile_id')
    const categoryMatch = !searchParams.get('category_id') || tx.categoryId === searchParams.get('category_id')
    return matchesFilter && matchesSearch && contactMatch && profileMatch && categoryMatch
  }), [transactions, filterType, searchQuery, searchParams])
  const visibleTransactions = filteredTransactions.slice(0, visibleCount)

  return (
    <div className="page-shell w-full max-w-5xl mx-auto animate-in fade-in duration-300 pb-32">
      
      <PageHeader title="Transactions" description="Your complete master ledger" icon={<ArrowRightLeft className="text-indigo-400" />} />

      {/* Search & Filters */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        
        <div className="relative flex-1 md:max-w-md">
          <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input 
            type="text" 
            placeholder="Search descriptions, contacts, or accounts..." 
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setVisibleCount(50) }}
            className="w-full bg-white/5 border border-white/10 rounded-xl pl-11 pr-4 py-3 text-sm outline-none focus:border-indigo-500/50 transition-colors placeholder:text-slate-500"
          />
        </div>

        <LiquidGlassSwitcher activeKey={filterType} label="Transaction filters" className="liquid-switcher--wide">
          {(['all', 'income', 'expense', 'transfer'] as const).map(f => (
            <button
              key={f}
              onClick={() => { setFilterType(f); setVisibleCount(50) }}
              {...liquidGlassItemProps(f, filterType === f)}
              className={`${liquidGlassItemProps(f, filterType === f).className} px-2 sm:px-5 py-2 text-xs sm:text-sm font-semibold capitalize`}
            >
              {f}
            </button>
          ))}
        </LiquidGlassSwitcher>

      </div>
      {(searchParams.has('contact_id') || searchParams.has('profile_id') || searchParams.has('category_id')) && <div className="-mt-4 mb-6 flex items-center gap-2 rounded-xl border border-indigo-500/20 bg-indigo-500/5 px-3 py-2 text-xs text-[var(--ink)]"><span className="min-w-0 flex-1 truncate">Filtered from Dashboard{searchParams.has('type') ? ` · ${searchParams.get('type')}` : ''}</span><button type="button" onClick={() => setSearchParams({})} className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 font-semibold text-[var(--brand-primary)] hover:bg-indigo-500/10"><X className="h-3 w-3" /> Clear filter</button></div>}

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
          {visibleTransactions.map((tx) => (
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
                      {formatIndiaDate(tx.created_at)}
                    </span>
                    <span className="text-slate-700 text-xs">•</span>
                    <span className="flex items-center text-xs text-slate-400 font-medium">
                      <Wallet className="w-3 h-3 mr-1 opacity-70" /> {tx.accountName}
                    </span>
                    
                    {/* Tag Badge */}
                    {tx.taggedName && (
                      <>
                        <span className="text-slate-700 text-xs">•</span>
                        <Link to={`/ledger?${tx.contactId ? `contact_id=${encodeURIComponent(tx.contactId)}` : `profile_id=${encodeURIComponent(tx.profileId || '')}`}&type=${encodeURIComponent(tx.type)}`} className="flex items-center text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 hover:bg-indigo-500/30">
                          <User className="w-3 h-3 mr-1" /> {tx.taggedName}
                        </Link>
                      </>
                    )}
                    {tx.categoryId && <><span className="text-slate-700 text-xs">â€¢</span><Link to={`/ledger?category_id=${encodeURIComponent(tx.categoryId)}&type=${encodeURIComponent(tx.type)}`} className="rounded-md border border-amber-500/20 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-bold text-amber-700 hover:bg-amber-500/20">{tx.categoryName || 'Category'}</Link></>}
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
          {filteredTransactions.length > visibleCount && <button type="button" onClick={() => setVisibleCount(count => count + 50)} className="w-full rounded-xl border border-white/10 px-4 py-3 text-sm font-semibold text-slate-300 hover:bg-white/5">
            Show next {Math.min(50, filteredTransactions.length - visibleCount)} · {visibleCount} of {filteredTransactions.length}
          </button>}
        </div>
      )}
    </div>
  )
}

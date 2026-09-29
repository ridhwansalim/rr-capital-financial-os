import React, { useState, useEffect } from 'react'
import { Users, IndianRupee, ArrowUpRight, ArrowDownRight, ChevronDown, ChevronUp, Loader2 } from 'lucide-react'
import { supabase } from '../lib/supabase'

interface Transaction {
  id: string
  amount: number
  description: string
  created_at: string
  type: 'lent' | 'borrowed'
}

interface AggregatedDebt {
  counterpartyName: string
  netBalance: number // Positive = they owe you. Negative = you owe them.
  transactions: Transaction[]
}

export default function Debts() {
  const [debts, setDebts] = useState<AggregatedDebt[]>([])
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    fetchDebts()
  }, [])

  const fetchDebts = async () => {
    setIsLoading(true)
    try {
      // 1. Get current user
      const { data: { user }, error: authError } = await supabase.auth.getUser()
      if (authError || !user) throw new Error('Auth error')
      const currentUserId = user.id

      // 2. Fetch obligations using CORRECT schema
      const { data: obs, error: obsError } = await supabase
        .from('obligations')
        .select('*')
        .or(`creditor_profile_id.eq.${currentUserId},debtor_profile_id.eq.${currentUserId}`)
        .order('created_at', { ascending: false })

      if (obsError) throw obsError
      if (!obs) return

      // 3. Extract unique IDs to fetch names
      const profileIds = new Set<string>()
      const contactIds = new Set<string>()

      obs.forEach(o => {
        if (o.creditor_profile_id && o.creditor_profile_id !== currentUserId) profileIds.add(o.creditor_profile_id)
        if (o.debtor_profile_id && o.debtor_profile_id !== currentUserId) profileIds.add(o.debtor_profile_id)
        if (o.debtor_contact_id) contactIds.add(o.debtor_contact_id)
      })

      // 4. Build the Name Map
      const nameMap: Record<string, string> = {}

      if (profileIds.size > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, full_name, username')
          .in('id', Array.from(profileIds))
        
        profiles?.forEach(p => {
          nameMap[p.id] = p.full_name || p.username || 'Unknown User'
        })
      }

      if (contactIds.size > 0) {
        const { data: contacts } = await supabase
          .from('contacts')
          .select('id, name')
          .in('id', Array.from(contactIds))
        
        contacts?.forEach(c => {
          nameMap[c.id] = c.name || 'Unknown Contact'
        })
      }

      // 5. Aggregate the data for the new UI
      const grouped: Record<string, AggregatedDebt> = {}

      obs.forEach(o => {
        const isLender = o.creditor_profile_id === currentUserId
        
        // Find counterparty name
        let cpName = 'Unknown'
        if (isLender) {
          if (o.debtor_profile_id) cpName = nameMap[o.debtor_profile_id] || cpName
          else if (o.debtor_contact_id) cpName = nameMap[o.debtor_contact_id] || cpName
        } else {
          if (o.creditor_profile_id) cpName = nameMap[o.creditor_profile_id] || cpName
          else if (o.debtor_contact_id) cpName = nameMap[o.debtor_contact_id] || cpName
        }

        const type = isLender ? 'lent' : 'borrowed'
        const amount = Number(o.total_amount)

        if (!grouped[cpName]) {
          grouped[cpName] = { counterpartyName: cpName, netBalance: 0, transactions: [] }
        }

        // Adjust Net Balance
        grouped[cpName].netBalance += isLender ? amount : -amount
        
        // Add to history
        grouped[cpName].transactions.push({
          id: o.id,
          amount,
          description: o.reason,
          created_at: o.created_at,
          type
        })
      })

      // Sort by largest absolute balance
      const sortedDebts = Object.values(grouped).sort((a, b) => Math.abs(b.netBalance) - Math.abs(a.netBalance))
      setDebts(sortedDebts)

    } catch (error: any) {
      console.error('Error fetching debts:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const toggleExpand = (name: string) => {
    setExpanded(prev => ({ ...prev, [name]: !prev[name] }))
  }

  return (
    <div className="p-6 w-full max-w-3xl mx-auto text-white animate-in fade-in duration-300 pb-32">
      <div className="mb-8">
        <h1 className="text-3xl font-bold flex items-center">
          <Users className="w-8 h-8 mr-3 text-indigo-400" />
          Debts & IOUs
        </h1>
        <p className="text-slate-400 mt-1">Track money you owe and are owed</p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
        </div>
      ) : debts.length === 0 ? (
        <div className="text-center py-20 bg-white/5 border border-white/10 rounded-3xl backdrop-blur-sm">
          <Users className="w-12 h-12 text-slate-500 mx-auto mb-4 opacity-50" />
          <p className="text-slate-400 text-lg">No debts recorded yet.</p>
          <p className="text-slate-500 text-sm mt-2">Click the + button to log an IOU.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {debts.map((contact) => {
            const isOwedToYou = contact.netBalance > 0
            const isSettled = contact.netBalance === 0
            const isExpanded = expanded[contact.counterpartyName]

            return (
              <div key={contact.counterpartyName} className="bg-white/5 border border-white/10 rounded-2xl backdrop-blur-md overflow-hidden transition-all duration-300">
                {/* Aggregated Header (Clickable) */}
                <div 
                  onClick={() => toggleExpand(contact.counterpartyName)}
                  className="p-5 flex items-center justify-between cursor-pointer hover:bg-white/5 transition-colors"
                >
                  <div className="flex items-center space-x-4">
                    <div className={`p-3 rounded-full ${isSettled ? 'bg-slate-500/20' : isOwedToYou ? 'bg-emerald-500/20' : 'bg-rose-500/20'}`}>
                      {isSettled ? <Users className="w-5 h-5 text-slate-400" /> : isOwedToYou ? <ArrowDownRight className="w-5 h-5 text-emerald-400" /> : <ArrowUpRight className="w-5 h-5 text-rose-400" />}
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-slate-200">{contact.counterpartyName}</h3>
                      <p className="text-sm text-slate-400">
                        {isSettled ? 'Settled up' : isOwedToYou ? 'Owes you' : 'You owe them'}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center space-x-4">
                    <span className={`text-xl font-bold ${isSettled ? 'text-slate-400' : isOwedToYou ? 'text-emerald-400' : 'text-rose-400'}`}>
                      ₹{Math.abs(contact.netBalance).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </span>
                    {isExpanded ? <ChevronUp className="w-5 h-5 text-slate-500" /> : <ChevronDown className="w-5 h-5 text-slate-500" />}
                  </div>
                </div>

                {/* Expanded Transaction History */}
                {isExpanded && (
                  <div className="bg-black/20 border-t border-white/5 p-4 space-y-2">
                    <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3 px-2">Transaction History</h4>
                    {contact.transactions.map((tx) => (
                      <div key={tx.id} className="flex justify-between items-center px-4 py-3 bg-white/5 rounded-xl">
                        <div>
                          <p className="text-sm font-medium text-slate-300">{tx.description}</p>
                          <p className="text-xs text-slate-500">{new Date(tx.created_at).toLocaleDateString()}</p>
                        </div>
                        <span className={`text-sm font-bold ${tx.type === 'lent' ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {tx.type === 'lent' ? '+' : '-'}₹{tx.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
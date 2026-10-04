import { useCallback, useEffect, useState } from 'react'
import PageHeader from '../components/PageHeader'
import { Users, ArrowUpRight, ArrowDownRight, ChevronDown, ChevronUp, Loader2, Plus, Wallet } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { formatIndiaDate } from '../lib/financeDate'
import SplitExpenseModal from '../components/SplitExpenseModal'
import SettleDebtModal from '../components/SettleDebtModal'

interface DebtEntry {
  id: string
  amount: number
  description: string
  created_at: string
  type: 'lent' | 'borrowed'
  isPayable: boolean
  isSplitShare: boolean
  totalBillAmount?: number
  splitGroupId?: string | null
  obligation: Record<string, any>
}
interface AggregatedDebt {
  key: string
  counterpartyName: string
  netBalance: number
  transactions: DebtEntry[]
}
interface SplitGroup { id: string; name: string }

export default function Debts() {
  const [debts, setDebts] = useState<AggregatedDebt[]>([])
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [isLoading, setIsLoading] = useState(true)
  const [splitOpen, setSplitOpen] = useState(false)
  const [settling, setSettling] = useState<Record<string, any> | null>(null)
  const [currentUserId, setCurrentUserId] = useState('')
  const [groups, setGroups] = useState<SplitGroup[]>([])
  const [groupFilter, setGroupFilter] = useState('all')

  const fetchDebts = useCallback(async () => {
    setIsLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Auth error')
      setCurrentUserId(user.id)
      const [{ data: obligations, error }, { data: savedGroups }] = await Promise.all([
        supabase.from('obligations').select('id, owner_id, creditor_profile_id, debtor_profile_id, shadow_contact_id, amount, reason, description, created_at, status, type, is_split_share, total_bill_amount, split_group_id, receiver_account_id, initiator_account_id, related_transaction_id')
          .or(`creditor_profile_id.eq.${user.id},debtor_profile_id.eq.${user.id}`).in('status', ['ACCEPTED', 'PENDING']).order('created_at', { ascending: false }),
        supabase.from('split_groups').select('id,name').order('name'),
      ])
      if (error) throw error
      setGroups((savedGroups || []) as SplitGroup[])
      const rows = obligations || []
      const profileIds = new Set<string>()
      const contactIds = new Set<string>()
      for (const row of rows) {
        if (row.creditor_profile_id && row.creditor_profile_id !== user.id) profileIds.add(row.creditor_profile_id)
        if (row.debtor_profile_id && row.debtor_profile_id !== user.id) profileIds.add(row.debtor_profile_id)
        if (row.shadow_contact_id) contactIds.add(row.shadow_contact_id)
      }
      const [profileResult, contactResult] = await Promise.all([
        profileIds.size ? supabase.rpc('profile_labels', { p_profile_ids: [...profileIds] }) : Promise.resolve({ data: [], error: null }),
        contactIds.size ? supabase.from('contacts').select('id,name').in('id', [...contactIds]) : Promise.resolve({ data: [], error: null }),
      ])
      const nameMap: Record<string, string> = {}
      profileResult.data?.forEach((profile: { id: string; full_name: string | null; username: string | null }) => { nameMap[profile.id] = profile.full_name || profile.username || 'Unknown user' })
      contactResult.data?.forEach(contact => { nameMap[contact.id] = contact.name || 'Unknown contact' })

      const grouped = new Map<string, AggregatedDebt>()
      rows.forEach(row => {
        const isLender = row.creditor_profile_id === user.id
        const counterpartyId = isLender ? row.debtor_profile_id : row.creditor_profile_id
        const key = row.shadow_contact_id ? `contact:${row.shadow_contact_id}` : `profile:${counterpartyId || row.owner_id}`
        const name = row.shadow_contact_id ? nameMap[row.shadow_contact_id] : nameMap[counterpartyId || '']
        const amount = Number(row.amount) || 0
        const entry: DebtEntry = {
          id: row.id,
          amount,
          description: row.reason || row.description || (row.is_split_share ? 'Split bill share' : 'Debt'),
          created_at: row.created_at,
          type: isLender ? 'lent' : 'borrowed',
          isPayable: !isLender && row.debtor_profile_id === user.id && Boolean(row.creditor_profile_id),
          isSplitShare: Boolean(row.is_split_share),
          totalBillAmount: row.total_bill_amount == null ? undefined : Number(row.total_bill_amount),
          splitGroupId: row.split_group_id,
          obligation: { ...row, amount, description: row.description || row.reason },
        }
        const group = grouped.get(key) || { key, counterpartyName: name || 'Unknown', netBalance: 0, transactions: [] }
        group.netBalance += isLender ? amount : -amount
        group.transactions.push(entry)
        grouped.set(key, group)
      })
      setDebts([...grouped.values()].sort((a, b) => Math.abs(b.netBalance) - Math.abs(a.netBalance)))
    } catch {
      console.error('Could not load debts and IOUs')
    } finally { setIsLoading(false) }
  }, [])

  useEffect(() => { void fetchDebts() }, [fetchDebts])
  useEffect(() => {
    const refreshAfterFinancialChange = () => { void fetchDebts() }
    window.addEventListener('rr:financial-data-changed', refreshAfterFinancialChange)
    return () => window.removeEventListener('rr:financial-data-changed', refreshAfterFinancialChange)
  }, [fetchDebts])
  const toggleExpand = (key: string) => setExpanded(previous => ({ ...previous, [key]: !previous[key] }))
  const shownDebts = groupFilter === 'all'
    ? debts
    : debts.map(debt => ({ ...debt, transactions: debt.transactions.filter(entry => entry.splitGroupId === groupFilter) }))
      .map(debt => ({ ...debt, netBalance: debt.transactions.reduce((sum, entry) => sum + (entry.type === 'lent' ? entry.amount : -entry.amount), 0) }))
      .filter(debt => debt.transactions.length)

  return (
    <div className="page-shell mx-auto w-full max-w-3xl animate-in fade-in duration-300 pb-32">
      <PageHeader title="Debts & IOUs" description="Track money you owe and are owed" icon={<Users className="text-indigo-400" />} action={<div className="flex gap-2"><label className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 text-xs text-slate-300"><Wallet className="h-3.5 w-3.5" /><select aria-label="Filter debts by split group" value={groupFilter} onChange={event => setGroupFilter(event.target.value)} className="max-w-32 bg-transparent py-2 text-xs text-inherit outline-none"><option value="all" className="text-slate-900">All groups</option>{groups.map(group => <option key={group.id} value={group.id} className="text-slate-900">{group.name}</option>)}</select></label><button type="button" onClick={() => setSplitOpen(true)} className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-500 px-3 py-2 text-sm font-bold text-white hover:bg-emerald-400"><Plus className="h-4 w-4" /><span>Split Bill</span></button></div>} actionClassName="sm:w-auto" />

      {isLoading ? <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-indigo-500" /></div>
        : shownDebts.length === 0 ? <div className="surface-panel rounded-3xl py-20 text-center"><Users className="mx-auto mb-4 h-12 w-12 text-slate-500 opacity-50" /><p className="text-lg text-slate-300">No active debts recorded.</p><p className="mt-2 text-sm text-slate-500">Pending approvals and declined requests appear in the inbox above.</p></div>
          : <div className="space-y-4">{shownDebts.map(contact => {
            const isOwedToYou = contact.netBalance > 0
            const isSettled = contact.netBalance === 0
            const isExpanded = expanded[contact.key]
            return <article key={contact.key} className="overflow-hidden rounded-2xl border border-white/10 bg-white/5 backdrop-blur-md transition-all duration-300">
              <button type="button" aria-expanded={isExpanded} onClick={() => toggleExpand(contact.key)} className="flex w-full items-center justify-between gap-3 p-4 text-left hover:bg-white/5 sm:p-5">
                <span className="flex min-w-0 items-center gap-3"><span className={`rounded-full p-3 ${isSettled ? 'bg-slate-500/20' : isOwedToYou ? 'bg-emerald-500/20' : 'bg-rose-500/20'}`}>{isSettled ? <Users className="h-5 w-5 text-slate-400" /> : isOwedToYou ? <ArrowDownRight className="h-5 w-5 text-emerald-400" /> : <ArrowUpRight className="h-5 w-5 text-rose-400" />}</span><span className="min-w-0"><span className="block truncate text-base font-bold text-slate-100">{contact.counterpartyName}</span><span className="text-sm text-slate-400">{isSettled ? 'Settled up' : isOwedToYou ? 'Owes you' : 'You owe them'}</span></span></span>
                <span className="flex shrink-0 items-center gap-2"><span className={`text-base font-bold sm:text-xl ${isSettled ? 'text-slate-400' : isOwedToYou ? 'text-emerald-400' : 'text-rose-400'}`}>₹{Math.abs(contact.netBalance).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>{isExpanded ? <ChevronUp className="h-5 w-5 text-slate-500" /> : <ChevronDown className="h-5 w-5 text-slate-500" />}</span>
              </button>
              {isExpanded && <div className="space-y-2 border-t border-white/5 bg-black/20 p-3 sm:p-4"><h3 className="px-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Transaction History</h3>{contact.transactions.map(entry => <div key={entry.id} className="flex items-center justify-between gap-2 rounded-xl bg-white/5 px-3 py-3 sm:px-4"><div className="min-w-0"><p className="truncate text-sm font-medium text-slate-200">{entry.isSplitShare ? 'Split Bill · ' : ''}{entry.description}</p><p className="text-xs text-slate-500">{formatIndiaDate(entry.created_at)}{entry.totalBillAmount ? ` · Bill ₹${entry.totalBillAmount.toLocaleString('en-IN')}` : ''}</p></div><span className={`shrink-0 text-sm font-bold ${entry.type === 'lent' ? 'text-emerald-400' : 'text-rose-400'}`}>{entry.type === 'lent' ? '+' : '-'}₹{entry.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>{entry.isPayable && <button type="button" onClick={() => setSettling(entry.obligation)} className="shrink-0 rounded-lg bg-emerald-500/15 px-2.5 py-1.5 text-xs font-bold text-emerald-300 hover:bg-emerald-500/25">Settle / Pay</button>}</div>)}</div>}
            </article>
          })}</div>}
      <SplitExpenseModal isOpen={splitOpen} onClose={() => setSplitOpen(false)} onSuccess={() => { setSplitOpen(false); void fetchDebts() }} />
      <SettleDebtModal isOpen={Boolean(settling)} obligation={settling} onClose={() => { setSettling(null); void fetchDebts() }} />
      <span className="sr-only">Signed in as {currentUserId || 'loading'}</span>
    </div>
  )
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, Loader2, Plus, Search, Users, Wallet, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { safeCaughtErrorMessage } from '../lib/safeErrorMessages'
import { indiaDateInputToIso, isDateBeforeOpeningDate, toIndiaDateInputValue } from '../lib/financeDate'
import { calculateGroupSplit, type SplitMode } from '../lib/groupSplitMath'
import LiquidGlassSwitcher from './ui/LiquidGlassSwitcher'
import { liquidGlassItemProps } from './ui/liquidGlassSwitcherItem'
import { useModalBack } from '../lib/useModalBack'

type Participant = { key: string; id?: string; name: string; kind: 'profile' | 'contact' | 'new'; amount: string; percentage: string }
type Account = { id: string; name: string; type: string; opening_date: string; balance: number }
type SavedGroup = { id: string; name: string }

export default function SplitExpenseModal({ isOpen, onClose, onSuccess }: { isOpen: boolean; onClose: () => void; onSuccess: () => void }) {
  const [total, setTotal] = useState('')
  const [description, setDescription] = useState('')
  const [date, setDate] = useState(() => toIndiaDateInputValue())
  const [accounts, setAccounts] = useState<Account[]>([])
  const [accountId, setAccountId] = useState('')
  const [participants, setParticipants] = useState<Participant[]>([])
  const [includeSelf, setIncludeSelf] = useState(true)
  const [mode, setMode] = useState<SplitMode>('equal')
  const [selfAmount, setSelfAmount] = useState('')
  const [selfPercentage, setSelfPercentage] = useState('')
  const [groups, setGroups] = useState<SavedGroup[]>([])
  const [groupId, setGroupId] = useState('')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<{ id: string; name: string; kind: 'profile' | 'contact' }[]>([])
  const [searching, setSearching] = useState(false)
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const requestId = useRef<string | null>(null)
  const requestFingerprint = useRef('')

  const reset = useCallback(() => {
    setTotal(''); setDescription(''); setDate(toIndiaDateInputValue()); setParticipants([])
    setIncludeSelf(true); setMode('equal'); setSelfAmount(''); setSelfPercentage('')
    setQuery(''); setResults([]); setError(''); setGroupId(''); setAccountId('')
    requestId.current = null; requestFingerprint.current = ''
  }, [])
  const isDirty = Boolean(total || description || participants.length || date !== toIndiaDateInputValue())
  useModalBack(isOpen, () => { reset(); onClose() }, isDirty, 'Discard this split expense?')

  useEffect(() => {
    if (!isOpen) return
    let cancelled = false
    setLoading(true)
    void (async () => {
      const [{ data: acc, error: accError }, { data: balances, error: balError }, { data: savedGroups }] = await Promise.all([
        supabase.from('accounts').select('id,name,type,opening_date').order('name'),
        supabase.from('account_balances').select('id,balance'),
        supabase.from('split_groups').select('id,name').order('name'),
      ])
      if (cancelled) return
      if (accError || balError) setError('Accounts could not be loaded. Try closing and reopening this form.')
      const balanceMap = new Map((balances || []).map(row => [row.id, Number(row.balance)]))
      const available = (acc || []).map(row => ({ ...row, opening_date: row.opening_date || '1900-01-01', balance: balanceMap.get(row.id) ?? 0 }))
      setAccounts(available)
      setAccountId(current => current || available[0]?.id || '')
      setGroups((savedGroups || []) as SavedGroup[])
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [isOpen])

  useEffect(() => {
    const term = query.trim()
    if (!isOpen || term.length < 2) { setResults([]); return }
    let cancelled = false
    const timer = window.setTimeout(async () => {
      setSearching(true)
      const [{ data: profileData }, { data: contactData }] = await Promise.all([
        supabase.rpc('search_users', { search_term: term }),
        supabase.from('contacts').select('id,name').ilike('name', `%${term}%`).order('name').limit(8),
      ])
      if (!cancelled) {
        const { data: { user } } = await supabase.auth.getUser()
        const next = [
          ...(contactData || []).map(item => ({ id: item.id, name: item.name, kind: 'contact' as const })),
          ...((profileData || []) as { id: string; full_name?: string | null; username?: string | null }[])
            .filter(item => item.id !== user?.id)
            .map(item => ({ id: item.id, name: item.full_name || item.username || 'Registered user', kind: 'profile' as const })),
        ]
        setResults(next.filter((item, index) => next.findIndex(other => other.kind === item.kind && other.id === item.id) === index))
      }
      setSearching(false)
    }, 300)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [isOpen, query])

  const addParticipant = (participant: Omit<Participant, 'key' | 'amount' | 'percentage'>) => {
    const key = `${participant.kind}:${participant.id || participant.name.toLocaleLowerCase()}`
    setParticipants(current => current.some(item => item.key === key) ? current : [...current, { ...participant, key, amount: '', percentage: '' }])
    setGroupId(''); setQuery(''); setResults([]); setError('')
  }

  const loadGroup = async (id: string) => {
    setGroupId(id)
    if (!id) return
    const { data, error: groupError } = await supabase.from('split_group_members').select('profile_id,shadow_contact_id').eq('group_id', id)
    if (groupError) { setError('That saved group could not be loaded.'); return }
    const profileIds = (data || []).flatMap(item => item.profile_id ? [item.profile_id] : [])
    const contactIds = (data || []).flatMap(item => item.shadow_contact_id ? [item.shadow_contact_id] : [])
    const [{ data: profiles }, { data: contacts }] = await Promise.all([
      profileIds.length ? supabase.rpc('profile_labels', { p_profile_ids: profileIds }) : Promise.resolve({ data: [] }),
      contactIds.length ? supabase.from('contacts').select('id,name').in('id', contactIds) : Promise.resolve({ data: [] }),
    ])
    const members: Participant[] = []
    for (const item of data || []) {
      if (item.profile_id) {
        const profile = (profiles || []).find((row: { id: string; full_name?: string | null; username?: string | null }) => row.id === item.profile_id)
        members.push({ key: `profile:${item.profile_id}`, id: item.profile_id, name: profile?.full_name || profile?.username || 'Registered user', kind: 'profile', amount: '', percentage: '' })
        continue
      }
      const contact = (contacts || []).find(row => row.id === item.shadow_contact_id)
      if (contact) members.push({ key: `contact:${contact.id}`, id: contact.id, name: contact.name, kind: 'contact', amount: '', percentage: '' })
    }
    setParticipants(members)
  }

  const calculation = useMemo(() => calculateGroupSplit(
    total,
    participants.map(item => ({ key: item.key, amount: item.amount, percentage: item.percentage })),
    includeSelf,
    mode,
    mode === 'exact' ? selfAmount : selfPercentage
  ), [total, participants, includeSelf, mode, selfAmount, selfPercentage])
  const handleClose = (discard = false) => {
    if (!discard && isDirty && !window.confirm('Discard this split expense?')) return
    reset(); onClose()
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError('')
    const account = accounts.find(item => item.id === accountId)
    if (!account) { setError('Choose the account that paid the full bill.'); return }
    if (isDateBeforeOpeningDate(date, account.opening_date)) { setError(`${account.name} started on ${account.opening_date}; choose that date or later.`); return }
    if (!calculation.valid) { setError(calculation.error || 'Check the split amounts.'); return }
    setSubmitting(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Authentication missing')
      const splitRows = participants.map((participant, index) => ({
        profile_id: participant.kind === 'profile' ? participant.id : null,
        shadow_contact_id: participant.kind === 'contact' ? participant.id : null,
        new_shadow_contact_name: participant.kind === 'new' ? participant.name : null,
        amount: calculation.allocations[index].amountCents / 100,
      }))
      const payload = {
        p_owner_id: user.id,
        p_account_id: accountId,
        p_total_bill: calculation.totalCents / 100,
        p_description: description.trim(),
        p_group_id: groupId || null,
        p_splits: splitRows,
        p_transaction_date: indiaDateInputToIso(date),
      }
      const fingerprint = JSON.stringify(payload)
      if (!requestId.current || requestFingerprint.current !== fingerprint) {
        requestId.current = crypto.randomUUID()
        requestFingerprint.current = fingerprint
      }
      const { error: rpcError } = await supabase.rpc('process_group_split', { p_request_id: requestId.current, ...payload } as never)
      if (rpcError) throw rpcError
      handleClose(true)
      onSuccess()
    } catch (submitError) {
      setError(safeCaughtErrorMessage(submitError, 'Could not save the split expense. Check the details and retry.'))
    } finally { setSubmitting(false) }
  }

  const saveGroup = async () => {
    const name = window.prompt('Name this participant group')?.trim()
    if (!name) return
    const members = participants.filter(item => item.kind !== 'new').map(item => ({
      profile_id: item.kind === 'profile' ? item.id : null,
      shadow_contact_id: item.kind === 'contact' ? item.id : null,
    }))
    if (members.length !== participants.length || !members.length) { setError('Save a group after selecting registered users and saved contacts.'); return }
    const { data, error: saveError } = await supabase.rpc('save_split_group', { p_name: name, p_members: members } as never)
    if (saveError) { setError(safeCaughtErrorMessage(saveError, 'Could not save this group.')); return }
    setGroups(current => [...current, { id: data as string, name }].sort((a, b) => a.name.localeCompare(b.name)))
    setGroupId(data as string)
  }

  if (!isOpen) return null
  const totalLabel = calculation.totalCents / 100
  const money = (cents: number) => `\u20B9${(cents / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-3 backdrop-blur-md sm:p-4">
      <section role="dialog" aria-modal="true" aria-labelledby="split-expense-title" className="app-financial-entry-modal app-split-expense-modal relative flex max-h-[calc(100dvh-1.5rem)] w-full max-w-xl flex-col overflow-hidden rounded-3xl border border-white/20 bg-white/10 p-4 text-white shadow-2xl backdrop-blur-2xl sm:p-6">
        <header className="mb-2.5 flex shrink-0 items-start justify-between gap-3">
          <div className="min-w-0"><h2 id="split-expense-title" className="flex items-center gap-2 text-xl font-bold"><Users className="h-5 w-5 shrink-0 text-emerald-400" /> Split a Bill</h2><p className="mt-1 max-w-md text-xs leading-relaxed text-slate-400">Record the full payment once; track each person's share separately.</p></div>
          <button type="button" aria-label="Close split bill" onClick={() => handleClose()} className="-mr-1 -mt-1 shrink-0 rounded-full p-2 text-white/70 transition-colors hover:bg-white/10"><X className="h-5 w-5" /></button>
        </header>
        <form onSubmit={handleSubmit} className="app-split-expense-form flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
          <LiquidGlassSwitcher activeKey={mode} label="Split calculation mode" className="app-modal-liquid-switcher w-full shrink-0">
            {([{ key: 'equal', label: 'Equal' }, { key: 'exact', label: 'Exact' }, { key: 'percentage', label: 'Percent' }] as const).map(item => <button key={item.key} type="button" onClick={() => setMode(item.key)} {...liquidGlassItemProps(item.key, mode === item.key, 'flex-1 justify-center whitespace-nowrap px-3 text-center text-xs font-semibold')}>{item.label}</button>)}
          </LiquidGlassSwitcher>
          <div className="grid grid-cols-2 gap-2">
            <label className="min-w-0 rounded-xl border border-white/10 bg-black/20 px-3 py-2"><span className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400">Total bill</span><span className="mt-0.5 flex items-center gap-1 text-xl font-bold"><span className="text-slate-400">&#8377;</span><input aria-label="Total bill amount" type="number" min="0.01" step="0.01" value={total} onChange={event => setTotal(event.target.value)} className="w-full min-w-0 bg-transparent text-white outline-none" required /></span></label>
            <label className="min-w-0 rounded-xl border border-white/10 bg-black/20 px-3 py-2"><span className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400">Paid on</span><input type="date" aria-label="Paid on" max={toIndiaDateInputValue()} value={date} onChange={event => setDate(event.target.value)} className="mt-1 w-full min-w-0 bg-transparent text-sm text-white outline-none" required /></label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input aria-label="Bill description" value={description} onChange={event => setDescription(event.target.value)} placeholder="Dinner at Paragon" maxLength={240} className="min-w-0 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none placeholder:text-white/35 focus:border-emerald-400/60" required />
            <label className="relative block min-w-0"><Wallet className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><select aria-label="Account that paid for the bill" value={accountId} onChange={event => setAccountId(event.target.value)} disabled={loading || accounts.length === 0} className="w-full min-w-0 appearance-none rounded-xl border border-white/10 bg-slate-950 py-2 pl-9 pr-2 text-xs text-white outline-none focus:border-emerald-400/60"><option value="" disabled>{loading ? 'Loading accounts...' : 'Paying account'}</option>{accounts.map(account => <option key={account.id} value={account.id} className="text-slate-900">{account.name} &middot; {account.type} &middot; &#8377;{account.balance.toLocaleString('en-IN')}</option>)}</select></label>
          </div>
          {groups.length > 0 && <label className="flex min-h-9 items-center gap-2 text-xs text-slate-300"><span className="shrink-0">Saved group</span><select value={groupId} onChange={event => void loadGroup(event.target.value)} className="min-w-0 flex-1 rounded-lg border border-white/10 bg-slate-950 px-3 py-1.5 text-white"><option value="">No saved group</option>{groups.map(group => <option key={group.id} value={group.id} className="text-slate-900">{group.name}</option>)}</select></label>}
          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
            <input aria-label="Search participants" value={query} onChange={event => setQuery(event.target.value)} placeholder="Find people or contacts..." className="w-full rounded-xl border border-white/10 bg-black/20 py-2 pl-9 pr-3 text-sm text-white outline-none placeholder:text-white/35 focus:border-emerald-400/60" />
            {(results.length > 0 || searching || (query.trim().length >= 2 && !searching)) && <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-20 max-h-40 overflow-y-auto rounded-xl border border-white/10 bg-slate-900 shadow-xl">{searching && <p className="p-3 text-xs text-slate-400">Searching...</p>}{results.map(item => <button type="button" key={`${item.kind}:${item.id}`} onClick={() => addParticipant({ id: item.id, name: item.name, kind: item.kind })} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-white/10"><span className="rounded-full bg-white/10 p-1.5"><Users className="h-3.5 w-3.5" /></span><span className="flex-1">{item.name}</span><span className="text-[10px] text-slate-400">{item.kind === 'profile' ? 'RR Capital user' : 'Contact'}</span></button>)}{query.trim().length >= 2 && !results.some(item => item.name.toLowerCase() === query.trim().toLowerCase()) && <button type="button" onClick={() => addParticipant({ name: query.trim(), kind: 'new' })} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-emerald-300 hover:bg-white/10"><Plus className="h-4 w-4" />Add &quot;{query.trim()}&quot; as a shadow contact</button>}</div>}
          </div>
          <div className="flex items-center justify-between gap-2 text-xs"><span className="font-semibold text-slate-300">Participants ({participants.length})</span><div className="flex gap-2"><button type="button" onClick={() => void saveGroup()} disabled={!participants.length} className="text-emerald-300 disabled:opacity-40">Save as group</button><label className="flex items-center gap-1.5 text-slate-300"><input type="checkbox" checked={includeSelf} onChange={event => setIncludeSelf(event.target.checked)} />Include me</label></div></div>
          <div className="max-h-28 space-y-1 overflow-y-auto rounded-xl border border-white/5 bg-black/10 p-1.5 sm:max-h-36">
            {participants.map((participant, index) => <div key={participant.key} className="grid grid-cols-[minmax(0,1fr)_84px_28px] items-center gap-1"><span className="min-w-0 truncate text-xs text-slate-200">{participant.name}<span className="ml-1 text-[10px] text-slate-500">{participant.kind === 'profile' ? 'registered' : participant.kind === 'new' ? 'new contact' : 'contact'}</span></span>{mode !== 'equal' ? <input aria-label={`${participant.name} ${mode === 'exact' ? 'share amount' : 'share percentage'}`} type="number" min="0" step="0.01" value={mode === 'exact' ? participant.amount : participant.percentage} onChange={event => setParticipants(current => current.map((item, i) => i === index ? { ...item, [mode === 'exact' ? 'amount' : 'percentage']: event.target.value } : item))} placeholder={mode === 'exact' ? '\u20B9 amount' : '%'} className="min-w-0 rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-xs text-white" /> : <span className="text-right text-xs tabular-nums text-slate-300">{calculation.allocations[index] ? money(calculation.allocations[index].amountCents) : '—'}</span>}<button type="button" aria-label={`Remove ${participant.name}`} onClick={() => { setParticipants(current => current.filter(item => item.key !== participant.key)); setGroupId('') }} className="rounded-full p-1 text-slate-400 hover:bg-white/10 hover:text-white"><X className="h-3.5 w-3.5" /></button></div>)}
            {!participants.length && <p className="px-1 py-2 text-center text-xs text-slate-500">Add people or contacts to divide the bill.</p>}
          </div>
          {includeSelf && mode !== 'equal' && <label className="grid grid-cols-[1fr_110px] items-center gap-2 text-xs text-slate-300">Your share<input aria-label={mode === 'exact' ? 'Your share amount' : 'Your share percentage'} type="number" min="0" step="0.01" value={mode === 'exact' ? selfAmount : selfPercentage} onChange={event => mode === 'exact' ? setSelfAmount(event.target.value) : setSelfPercentage(event.target.value)} placeholder={mode === 'exact' ? '\u20B9 amount' : '%'} className="rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-sm text-white" /></label>}
          <div className="flex items-center justify-between rounded-xl bg-white/5 px-3 py-1.5 text-xs"><span className="text-slate-400">Your share: {includeSelf ? money(calculation.ownerShareCents) : '\u20B90.00'}</span><span className="font-semibold text-slate-200">Bill {money(Math.round(totalLabel * 100))}</span></div>
          {error && <p role="alert" className="text-xs text-rose-300">{error}</p>}
          {!calculation.valid && participants.length > 0 && (mode !== 'equal' || total) && <p className="text-[11px] text-amber-300">{calculation.error}</p>}
          <footer className="flex shrink-0 gap-2 border-t border-white/10 pt-2">
            <button type="button" onClick={() => handleClose()} className="h-10 flex-1 rounded-xl border border-white/15 px-3 text-sm font-semibold text-slate-200 hover:bg-white/5">Cancel</button>
            <button type="submit" disabled={submitting || loading || !calculation.valid || !accounts.length || !accountId || !description.trim()} className="h-10 flex-1 rounded-xl bg-emerald-500 px-3 text-sm font-bold text-white hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40">{submitting ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : <><Check className="mr-1 inline h-4 w-4" />Record Split</>}</button>
          </footer>
        </form>
      </section>
    </div>
  )
}

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Loader2, Plus, RotateCcw, Trash2, WalletCards } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useOptionalFeatures } from '../lib/optionalFeatures'
import { formatIndiaDate, indiaDateStartToIso, toIndiaDateInputValue } from '../lib/financeDate'
import { buildReportPath } from '../lib/reportNavigation'
import { calculateBudgetPeriod } from '../lib/budgetMath'
import { safeBackendErrorMessage } from '../lib/safeErrorMessages'
import PageHeader from '../components/PageHeader'

type Category = { id: string; name: string; color: string }
type Envelope = { id: string; category_id: string; monthly_limit: number; rollover_enabled: boolean; created_at: string }
type Expense = { id: string; category_id: string | null; amount: number; fee_amount: number | null; created_at: string; from_account_id: string | null; to_account_id: string | null; contact_id: string | null; tagged_profile_id: string | null; status: string }
const money = (value: number) => `₹${value.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
const monthStart = (date: Date) => {
  const [year, month] = toIndiaDateInputValue(date).split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, 1))
}
const addMonth = (date: Date, count: number) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + count, 1))
const dateKey = (date: Date) => date.toISOString().slice(0, 10)

export default function Budgets() {
  const { flags, loading: flagsLoading } = useOptionalFeatures()
  const [categories, setCategories] = useState<Category[]>([])
  const [envelopes, setEnvelopes] = useState<Envelope[]>([])
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [month, setMonth] = useState(() => monthStart(new Date()))
  const [categoryId, setCategoryId] = useState('')
  const [amount, setAmount] = useState('')
  const [rollover, setRollover] = useState(false)

  const load = useCallback(async () => {
    const [{ data: cats, error: catsError }, { data: rows, error: rowsError }] = await Promise.all([
      supabase.from('transaction_categories').select('id,name,color').order('name'),
      supabase.from('budget_envelopes').select('id,category_id,monthly_limit,rollover_enabled,created_at').order('created_at'),
    ])
    if (catsError || rowsError) {
      setError(safeBackendErrorMessage(catsError || rowsError, 'Could not load budgets.'))
      setLoading(false)
      return
    }
    setError('')
    const next = (rows || []) as Envelope[]
    setCategories((cats || []) as Category[])
    setEnvelopes(next)
    if (next.length) {
      const earliest = new Date(Math.min(...next.map(row => new Date(row.created_at).getTime())))
      const from = dateKey(monthStart(earliest))
      const pageSize = 1000
      const all: Expense[] = []
      for (let start = 0; ; start += pageSize) {
        const { data, error: pageError } = await supabase.from('transactions')
          .select('id,category_id,amount,fee_amount,created_at,from_account_id,to_account_id,contact_id,tagged_profile_id,status')
          .eq('status', 'COMPLETED').not('from_account_id', 'is', null).is('to_account_id', null)
          .is('contact_id', null).is('tagged_profile_id', null)
          .gte('created_at', indiaDateStartToIso(from)).order('created_at').order('id').range(start, start + pageSize - 1)
        if (pageError) { setError(safeBackendErrorMessage(pageError, 'Could not load budget activity.')); setLoading(false); return }
        const page = (data || []) as Expense[]
        all.push(...page)
        if (page.length < pageSize) break
      }
      setExpenses(all)
    } else setExpenses([])
    setLoading(false)
  }, [])

  useEffect(() => {
    if (flagsLoading || !flags.budgets) return
    let active = true
    queueMicrotask(() => { if (active) void load() })
    return () => { active = false }
  }, [flagsLoading, flags.budgets, load])
  const summaries = useMemo(() => {
    const currentMonth = monthStart(month)
    return envelopes.map(envelope => {
      const createdMonth = monthStart(new Date(envelope.created_at))
      const byMonth = new Map<string, number>()
      for (const expense of expenses) {
        if (!expense.category_id || expense.category_id !== envelope.category_id) continue
        const at = new Date(expense.created_at)
        const key = dateKey(monthStart(at))
        byMonth.set(key, (byMonth.get(key) || 0) + Number(expense.amount) + Number(expense.fee_amount || 0))
      }
      const period = calculateBudgetPeriod(Number(envelope.monthly_limit), envelope.rollover_enabled, byMonth, dateKey(createdMonth).slice(0, 7), dateKey(currentMonth).slice(0, 7))
      return { envelope, category: categories.find(item => item.id === envelope.category_id), ...period }
    })
  }, [categories, envelopes, expenses, month])

  const saveEnvelope = async () => {
    const numeric = Number(amount)
    if (!categoryId || !Number.isFinite(numeric) || numeric <= 0 || Math.round(numeric * 100) !== numeric * 100) {
      setError('Choose a category and enter a positive budget amount with at most two decimal places.')
      return
    }
    setSaving(true); setError('')
    const existing = envelopes.find(item => item.category_id === categoryId)
    const { error: saveError } = existing
      ? await supabase.from('budget_envelopes').update({ monthly_limit: numeric, rollover_enabled: rollover }).eq('id', existing.id)
      : await supabase.from('budget_envelopes').insert({ category_id: categoryId, monthly_limit: numeric, rollover_enabled: rollover })
    if (saveError) setError(safeBackendErrorMessage(saveError, 'Could not save this budget.'))
    else { setAmount(''); setCategoryId(''); setRollover(false); await load() }
    setSaving(false)
  }

  const deleteEnvelope = async (id: string) => {
    if (!window.confirm('Delete this budget envelope? This keeps all transactions unchanged.')) return
    const { error: deleteError } = await supabase.from('budget_envelopes').delete().eq('id', id)
    if (deleteError) setError(safeBackendErrorMessage(deleteError, 'Could not delete this budget.')); else await load()
  }

  const prevMonth = () => setMonth(current => addMonth(current, -1))
  const nextMonth = () => setMonth(current => addMonth(current, 1))

  if (!flagsLoading && !flags.budgets) return <Navigate to="/" replace />
  if (flagsLoading || loading) return <div className="p-6 min-h-[50vh] grid place-items-center text-slate-400"><Loader2 className="animate-spin" aria-label="Loading budgets" /></div>
  return <div className="page-shell w-full max-w-5xl mx-auto pb-32 animate-in fade-in duration-300">
    <PageHeader eyebrow="Planning tools" title="Budgets" description="Track categorized expenses against personal monthly plans. Budgets never block entries or move money." icon={<WalletCards className="text-emerald-400" />} action={<Link to="/settings" className="inline-flex w-full justify-center rounded-xl border border-white/10 px-4 py-3 text-sm text-slate-300 hover:bg-white/5 sm:w-auto sm:py-2">Settings</Link>} />

    <div className="surface-panel flex items-center justify-between rounded-2xl px-3 py-3 mb-5">
      <button type="button" onClick={prevMonth} aria-label="Previous month" className="p-2 rounded-xl hover:bg-white/10"><ArrowLeft className="w-5 h-5" /></button>
      <h2 className="font-semibold">{formatIndiaDate(`${dateKey(month).slice(0, 7)}-15`, { month: 'long', year: 'numeric' })}</h2>
      <button type="button" onClick={nextMonth} disabled={dateKey(addMonth(month, 1)) > dateKey(monthStart(new Date()))} aria-label="Next month" className="p-2 rounded-xl hover:bg-white/10 disabled:opacity-30"><ArrowRight className="w-5 h-5" /></button>
    </div>

    {error && <p role="alert" className="mb-4 rounded-xl border border-rose-400/30 bg-rose-500/10 p-3 text-sm text-rose-200">{error}</p>}
    <section className="grid gap-4 md:grid-cols-2">
      {summaries.map(({ envelope, category, spent, carryover, available, remaining }) => {
        const percent = available > 0 ? Math.min(100, Math.round(spent / available * 100)) : 0
        const first = `${dateKey(month).slice(0, 7)}-01`
        const last = dateKey(addMonth(month, 1))
        const today = toIndiaDateInputValue()
        const end = last <= today ? last : today
        const reportTo = buildReportPath({ from: first, to: end, category: envelope.category_id, kind: 'expense' })
        return <article key={envelope.id} className="surface-panel rounded-3xl p-5">
          <div className="flex justify-between items-start gap-3"><div className="flex items-center gap-3 min-w-0"><span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: category?.color || '#64748b' }} /><div><h3 className="font-semibold truncate">{category?.name || 'Category removed'}</h3><p className="text-xs text-slate-500">Monthly plan {envelope.rollover_enabled ? '· rollover on' : ''}</p></div></div>
            <button type="button" onClick={() => void deleteEnvelope(envelope.id)} aria-label={`Delete ${category?.name || 'budget'} envelope`} className="p-2 text-slate-500 hover:text-rose-300"><Trash2 className="w-4 h-4" /></button></div>
          <div className="mt-5 flex justify-between items-end"><div><p className="text-xs text-slate-400">Spent</p><p className="text-xl font-bold">{money(spent)}</p></div><div className="text-right"><p className="text-xs text-slate-400">Remaining</p><p className={`text-lg font-semibold ${remaining < 0 ? 'text-rose-300' : 'text-emerald-300'}`}>{money(remaining)}</p></div></div>
          <div className="mt-3 h-2 rounded-full bg-white/10 overflow-hidden"><div className={`h-full rounded-full ${remaining < 0 ? 'bg-rose-400' : 'bg-emerald-400'}`} style={{ width: `${percent}%` }} /></div>
          <div className="mt-3 flex justify-between text-xs text-slate-500"><span>Plan {money(Number(envelope.monthly_limit))}{carryover > 0 ? ` + ${money(carryover)} carryover` : ''}</span><Link to={reportTo} className="text-emerald-300 hover:text-emerald-200">View expenses</Link></div>
        </article>
      })}
      {!summaries.length && <div className="md:col-span-2 rounded-3xl border border-dashed border-white/15 p-8 text-center"><p className="font-semibold">No envelopes yet</p><p className="text-sm text-slate-400 mt-2">Create one below after adding expense categories in Reports.</p></div>}
    </section>

    <section className="mt-6 surface-panel rounded-3xl p-5 sm:p-6">
      <h2 className="text-lg font-semibold flex items-center gap-2"><Plus className="w-5 h-5 text-emerald-400" />Add or update an envelope</h2>
      <p className="text-xs text-slate-400 mt-1 mb-4">Only completed, categorized personal expenses count. Transfers and contact-linked entries are excluded.</p>
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] items-end">
        <label className="text-xs text-slate-400">Category<select value={categoryId} onChange={event => setCategoryId(event.target.value)} className="mt-1 w-full rounded-xl bg-slate-900 border border-white/10 px-3 py-3 text-sm text-white"><option value="">Choose category</option>{categories.map(item => <option key={item.id} value={item.id}>{item.name}{envelopes.some(envelope => envelope.category_id === item.id) ? ' · update' : ''}</option>)}</select></label>
        <label className="text-xs text-slate-400">Monthly amount<input inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} placeholder="0.00" className="mt-1 w-full rounded-xl bg-slate-900 border border-white/10 px-3 py-3 text-sm text-white" /></label>
        <button type="button" disabled={saving || !categoryId || !amount} onClick={() => void saveEnvelope()} className="h-11 rounded-xl bg-emerald-500 px-5 font-semibold text-slate-950 disabled:opacity-40">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save envelope'}</button>
      </div>
      <label className="mt-4 flex items-start gap-3 text-sm text-slate-300"><input type="checkbox" checked={rollover} onChange={event => setRollover(event.target.checked)} className="mt-1 accent-emerald-400" /><span className="flex gap-2"><RotateCcw className="w-4 h-4 text-slate-400 shrink-0" /><span>Carry unused amount into the next month. Off by default; only positive unused allowance carries forward.</span></span></label>
    </section>
  </div>
}

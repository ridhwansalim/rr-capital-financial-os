import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { Loader2, PiggyBank, Target, Trash2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useOptionalFeatures } from '../lib/optionalFeatures'
import { toIndiaDateInputValue, formatIndiaDate } from '../lib/financeDate'
import PageHeader from '../components/PageHeader'

type Goal = { id: string; name: string; target_amount: number; target_date: string | null; created_at: string }
type Contribution = { id: string; goal_id: string; amount: number; contributed_on: string; note: string }
const money = (amount: number) => `₹${amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const amountInput = 'mt-1 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-3 text-sm text-white outline-none focus:border-emerald-400/50'

export default function SavingsGoals() {
  const { flags, loading: flagsLoading } = useOptionalFeatures()
  const [goals, setGoals] = useState<Goal[]>([])
  const [contributions, setContributions] = useState<Contribution[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [target, setTarget] = useState('')
  const [targetDate, setTargetDate] = useState('')
  const [contributionDrafts, setContributionDrafts] = useState<Record<string, { amount: string; date: string; note: string }>>({})

  const load = useCallback(async () => {
    const [goalResult, contributionResult] = await Promise.all([
      supabase.from('savings_goals').select('id,name,target_amount,target_date,created_at').order('created_at', { ascending: false }),
      supabase.from('savings_goal_contributions').select('id,goal_id,amount,contributed_on,note').order('contributed_on', { ascending: false }).order('created_at', { ascending: false }),
    ])
    if (goalResult.error || contributionResult.error) {
      setError(goalResult.error?.message || contributionResult.error?.message || 'Could not load savings goals.')
    } else {
      setError('')
      setGoals((goalResult.data || []) as Goal[])
      setContributions((contributionResult.data || []) as Contribution[])
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    if (flagsLoading || !flags.savings_goals) return
    let active = true
    queueMicrotask(() => { if (active) void load() })
    return () => { active = false }
  }, [flagsLoading, flags.savings_goals, load])

  const progress = useMemo(() => {
    const sums = new Map<string, number>()
    for (const item of contributions) sums.set(item.goal_id, (sums.get(item.goal_id) || 0) + Number(item.amount))
    return sums
  }, [contributions])

  if (!flagsLoading && !flags.savings_goals) return <Navigate to="/" replace />
  if (flagsLoading || loading) return <div className="p-6 min-h-[50vh] grid place-items-center text-slate-400"><Loader2 className="animate-spin" aria-label="Loading savings goals" /></div>

  const resetGoalForm = () => { setEditingId(null); setName(''); setTarget(''); setTargetDate('') }
  const saveGoal = async (event: FormEvent) => {
    event.preventDefault()
    const amount = Number(target)
    if (!name.trim() || !Number.isFinite(amount) || amount <= 0 || Math.round(amount * 100) !== amount * 100) {
      setError('Enter a goal name and a positive target amount with at most two decimal places.')
      return
    }
    setSaving(true); setError('')
    const values = { name: name.trim(), target_amount: amount, target_date: targetDate || null }
    const result = editingId
      ? await supabase.from('savings_goals').update(values).eq('id', editingId)
      : await supabase.from('savings_goals').insert(values)
    if (result.error) setError(result.error.message)
    else { resetGoalForm(); await load() }
    setSaving(false)
  }

  const editGoal = (goal: Goal) => {
    setEditingId(goal.id); setName(goal.name); setTarget(String(goal.target_amount)); setTargetDate(goal.target_date || '')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const deleteGoal = async (goal: Goal) => {
    if (!window.confirm(`Delete “${goal.name}” and its planning contributions? Ledger transactions and account balances are never affected.`)) return
    const { error: deleteError } = await supabase.from('savings_goals').delete().eq('id', goal.id)
    if (deleteError) setError(deleteError.message); else await load()
  }

  const addContribution = async (goalId: string) => {
    const draft = contributionDrafts[goalId] || { amount: '', date: toIndiaDateInputValue(), note: '' }
    const amount = Number(draft.amount)
    if (!Number.isFinite(amount) || amount <= 0 || Math.round(amount * 100) !== amount * 100) {
      setError('Enter a positive contribution amount with at most two decimal places.')
      return
    }
    setSaving(true); setError('')
    const { error: saveError } = await supabase.from('savings_goal_contributions').insert({
      goal_id: goalId, amount, contributed_on: draft.date, note: draft.note.trim(),
    })
    if (saveError) setError(saveError.message)
    else { setContributionDrafts(current => { const next = { ...current }; delete next[goalId]; return next }); await load() }
    setSaving(false)
  }

  const deleteContribution = async (row: Contribution) => {
    if (!window.confirm(`Delete the ${money(Number(row.amount))} planning contribution? No account or transaction will change.`)) return
    const { error: deleteError } = await supabase.from('savings_goal_contributions').delete().eq('id', row.id)
    if (deleteError) setError(deleteError.message); else await load()
  }

  return <main className="p-4 sm:p-6 w-full max-w-5xl mx-auto text-white pb-32 animate-in fade-in duration-300">
    <PageHeader eyebrow="Planning tools" title="Savings goals" description="Private planning targets with contributions you record explicitly. They are not bank balances and never move or link money." icon={<PiggyBank className="text-emerald-300" />} action={<Link to="/settings" className="inline-flex w-full justify-center rounded-xl border border-white/10 px-4 py-3 text-sm text-slate-300 hover:bg-white/5 sm:w-auto sm:py-2">Manage optional features</Link>} />

    {error && <p role="alert" className="mb-4 rounded-xl border border-rose-400/30 bg-rose-500/10 p-3 text-sm text-rose-200">{error}</p>}
    <form onSubmit={event => void saveGoal(event)} className="mb-6 rounded-3xl border border-white/10 bg-white/5 p-5 sm:p-6">
      <h2 className="text-lg font-semibold flex items-center gap-2"><Target className="w-5 h-5 text-emerald-300" />{editingId ? 'Edit goal' : 'Create a goal'}</h2>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <label className="text-xs text-slate-400">Goal name<input maxLength={80} value={name} onChange={event => setName(event.target.value)} placeholder="Family trip" className={amountInput} /></label>
        <label className="text-xs text-slate-400">Target amount (₹)<input inputMode="decimal" value={target} onChange={event => setTarget(event.target.value)} placeholder="0.00" className={amountInput} /></label>
        <label className="text-xs text-slate-400">Target date (optional)<input type="date" value={targetDate} onChange={event => setTargetDate(event.target.value)} className={amountInput} /></label>
      </div>
      <div className="mt-4 flex flex-wrap gap-2"><button type="submit" disabled={saving || !name.trim() || !target} className="rounded-xl bg-emerald-400 px-4 py-2.5 text-sm font-bold text-slate-950 disabled:opacity-40">{saving ? 'Saving…' : editingId ? 'Save changes' : 'Create goal'}</button>{editingId && <button type="button" onClick={resetGoalForm} className="rounded-xl border border-white/10 px-4 py-2.5 text-sm text-slate-300">Cancel edit</button>}</div>
    </form>

    <section className="grid gap-4 md:grid-cols-2">
      {goals.map(goal => {
        const saved = progress.get(goal.id) || 0
        const percent = goal.target_amount > 0 ? Math.min(100, saved / Number(goal.target_amount) * 100) : 0
        const rows = contributions.filter(item => item.goal_id === goal.id)
        const draft = contributionDrafts[goal.id] || { amount: '', date: toIndiaDateInputValue(), note: '' }
        const updateDraft = (patch: Partial<typeof draft>) => setContributionDrafts(current => ({ ...current, [goal.id]: { ...draft, ...patch } }))
        return <article key={goal.id} className="rounded-3xl border border-white/10 bg-white/5 p-5">
          <div className="flex justify-between items-start gap-3"><div className="min-w-0"><h3 className="font-semibold text-lg truncate">{goal.name}</h3><p className="text-xs text-slate-500 mt-1">{goal.target_date ? `Target ${formatIndiaDate(goal.target_date)}` : 'No target date'}</p></div><div className="flex gap-1 shrink-0"><button type="button" onClick={() => editGoal(goal)} className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/5">Edit</button><button type="button" aria-label={`Delete ${goal.name}`} onClick={() => void deleteGoal(goal)} className="rounded-lg p-2 text-slate-500 hover:text-rose-300"><Trash2 className="w-4 h-4" /></button></div></div>
          <div className="mt-5 flex justify-between items-end gap-2"><div><p className="text-xs text-slate-400">Recorded contributions</p><p className="text-xl font-bold text-emerald-200">{money(saved)}</p></div><p className="text-sm text-slate-400">of {money(Number(goal.target_amount))}</p></div>
          <div className="mt-3 h-2 rounded-full bg-white/10 overflow-hidden"><div className="h-full rounded-full bg-emerald-400" style={{ width: `${percent}%` }} /></div>
          <p className="mt-2 text-xs text-slate-500">{percent.toFixed(0)}% · {money(Math.max(0, Number(goal.target_amount) - saved))} to target. This planning total is separate from account balances.</p>
          <details className="mt-4 rounded-xl border border-white/10 bg-black/10 p-3"><summary className="cursor-pointer text-sm font-semibold text-emerald-200">Record or review contributions ({rows.length})</summary>
            <div className="mt-3 space-y-3">
              <div className="grid grid-cols-2 gap-2"><label className="text-[11px] text-slate-400">Amount<input inputMode="decimal" value={draft.amount} onChange={event => updateDraft({ amount: event.target.value })} placeholder="0.00" className={amountInput} /></label><label className="text-[11px] text-slate-400">Date<input type="date" value={draft.date} onChange={event => updateDraft({ date: event.target.value })} className={amountInput} /></label></div>
              <label className="block text-[11px] text-slate-400">Note (optional)<input maxLength={200} value={draft.note} onChange={event => updateDraft({ note: event.target.value })} placeholder="e.g. Monthly savings entry" className={amountInput} /></label>
              <button type="button" disabled={saving || !draft.amount} onClick={() => void addContribution(goal.id)} className="rounded-xl bg-emerald-400/15 px-3 py-2 text-xs font-semibold text-emerald-200 disabled:opacity-40">Add planning contribution</button>
              {rows.length > 0 && <ul className="divide-y divide-white/5">{rows.map(row => <li key={row.id} className="flex items-center justify-between gap-3 py-2 text-xs"><span className="min-w-0"><strong className="text-slate-200">{money(Number(row.amount))}</strong><span className="ml-2 text-slate-500">{formatIndiaDate(row.contributed_on)}</span>{row.note && <span className="block truncate text-slate-500">{row.note}</span>}</span><button type="button" onClick={() => void deleteContribution(row)} aria-label="Delete contribution" className="p-1 text-slate-500 hover:text-rose-300"><Trash2 className="w-3.5 h-3.5" /></button></li>)}</ul>}
            </div>
          </details>
        </article>
      })}
      {!goals.length && <div className="md:col-span-2 rounded-3xl border border-dashed border-white/15 p-8 text-center"><p className="font-semibold">No savings goals yet</p><p className="text-sm text-slate-400 mt-2">Create a personal target, then add planning contributions when you want to track progress.</p></div>}
    </section>
  </main>
}

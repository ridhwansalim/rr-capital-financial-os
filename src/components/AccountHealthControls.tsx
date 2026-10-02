import { useState } from 'react'
import { BellOff, CalendarClock, Loader2, Save, ShieldAlert } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { formatDueDate, nextMonthlyDueDate, type AccountHealthSetting } from '../lib/accountHealth'

interface Props {
  accountId: string
  accountType: string
  balance: number
  setting?: AccountHealthSetting
  onSaved: () => void
}

const liquidTypes = new Set(['bank', 'cash', 'wallet'])
const creditTypes = new Set(['credit', 'credit_card', 'pay_later'])

export default function AccountHealthControls({ accountId, accountType, balance, setting, onSaved }: Props) {
  const [editing, setEditing] = useState(false)
  const [minimum, setMinimum] = useState('')
  const [statementDay, setStatementDay] = useState('')
  const [dueDay, setDueDay] = useState('')
  const [showNotices, setShowNotices] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const liquid = liquidTypes.has(accountType)
  const credit = creditTypes.has(accountType)

  if (!liquid && !credit) return null
  const hasConfiguration = Boolean(setting && (setting.minimum_balance != null || setting.statement_day != null || setting.due_day != null))
  const nextDue = credit && setting?.due_day ? nextMonthlyDueDate(setting.due_day) : null
  const lowBalance = liquid && setting?.minimum_balance != null && balance < Number(setting.minimum_balance)
  const dueSoon = Boolean(nextDue && nextDue.daysUntil <= 7)
  const beginEditing = () => {
    setMinimum(setting?.minimum_balance == null ? '' : String(setting.minimum_balance))
    setStatementDay(setting?.statement_day == null ? '' : String(setting.statement_day))
    setDueDay(setting?.due_day == null ? '' : String(setting.due_day))
    setShowNotices(setting?.show_notices ?? true)
    setError('')
    setEditing(true)
  }

  const save = async () => {
    setError('')
    const parsedMinimum = minimum.trim() === '' ? null : Number(minimum)
    const parsedStatement = statementDay.trim() === '' ? null : Number(statementDay)
    const parsedDue = dueDay.trim() === '' ? null : Number(dueDay)
    if (parsedMinimum != null && (!Number.isFinite(parsedMinimum) || parsedMinimum < 0)) { setError('Minimum balance must be zero or higher.'); return }
    if (parsedStatement != null && (!Number.isInteger(parsedStatement) || parsedStatement < 1 || parsedStatement > 31)) { setError('Statement day must be from 1 to 31.'); return }
    if (parsedDue != null && (!Number.isInteger(parsedDue) || parsedDue < 1 || parsedDue > 31)) { setError('Due day must be from 1 to 31.'); return }
    setBusy(true)
    try {
      const values = { minimum_balance: liquid ? parsedMinimum : null, statement_day: credit ? parsedStatement : null, due_day: credit ? parsedDue : null, show_notices: showNotices }
      const result = setting
        ? await supabase.from('account_health_settings').update(values).eq('account_id', accountId)
        : await supabase.from('account_health_settings').insert({ account_id: accountId, ...values })
      if (result.error) throw result.error
      setEditing(false)
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save account health settings.')
    } finally { setBusy(false) }
  }

  const clear = async () => {
    if (!window.confirm('Clear this account’s minimum, statement and due-day settings? Your account and transaction data will remain unchanged.')) return
    setError(''); setBusy(true)
    try {
      const { error: deleteError } = await supabase.from('account_health_settings').delete().eq('account_id', accountId)
      if (deleteError) throw deleteError
      setEditing(false); onSaved()
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not clear these settings.') }
    finally { setBusy(false) }
  }

  return (
    <div className="mt-4 border-t border-white/10 pt-3" data-testid={`account-health-${accountId}`}>
      {!editing ? (
        <div className="space-y-2">
          {liquid && setting?.minimum_balance != null && <p className="text-xs text-slate-400">Minimum balance: ₹{Number(setting.minimum_balance).toLocaleString('en-IN')}</p>}
          {credit && setting?.statement_day != null && <p className="text-xs text-slate-400">Statement day: {setting.statement_day} of each month</p>}
          {credit && setting?.due_day != null && <p className="text-xs text-slate-400 flex items-center gap-1"><CalendarClock className="h-3.5 w-3.5" /> Due day: {setting.due_day} · next {nextDue ? formatDueDate(nextDue) : ''}{nextDue ? ` (in ${nextDue.daysUntil} days)` : ''}</p>}
          {setting?.show_notices && lowBalance && <p className="text-xs font-medium text-amber-300 flex items-center gap-1"><ShieldAlert className="h-3.5 w-3.5" /> Balance is below your minimum threshold.</p>}
          {setting?.show_notices && dueSoon && nextDue && <p className="text-xs font-medium text-amber-300 flex items-center gap-1"><CalendarClock className="h-3.5 w-3.5" /> Your monthly payment due day is within 7 days. Check your provider for the amount due.</p>}
          {setting && !setting.show_notices && <p className="text-xs text-slate-500 flex items-center gap-1"><BellOff className="h-3.5 w-3.5" /> Account warnings are hidden.</p>}
          <button type="button" onClick={beginEditing} className="text-xs font-semibold text-indigo-300 hover:text-indigo-200">{hasConfiguration ? 'Edit account context' : 'Set balance or due dates'}</button>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-slate-400">Optional account context only. It does not change balances or calculate a bill amount.</p>
          {liquid && <label className="block text-xs text-slate-300">Minimum balance (₹)<input type="number" min="0" step="0.01" inputMode="decimal" value={minimum} onChange={event => setMinimum(event.target.value)} className="mt-1 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white" placeholder="Leave blank to skip" /></label>}
          {credit && <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-slate-300">Statement day<input type="number" min="1" max="31" step="1" inputMode="numeric" value={statementDay} onChange={event => setStatementDay(event.target.value)} className="mt-1 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white" placeholder="1–31" /></label>
            <label className="text-xs text-slate-300">Due day<input type="number" min="1" max="31" step="1" inputMode="numeric" value={dueDay} onChange={event => setDueDay(event.target.value)} className="mt-1 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white" placeholder="1–31" /></label>
          </div>}
          <label className="flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" checked={showNotices} onChange={event => setShowNotices(event.target.checked)} /> Show threshold and due-day warnings on Accounts</label>
          {error && <p role="alert" className="text-xs text-rose-300">{error}</p>}
          <div className="flex items-center gap-2"><button type="button" disabled={busy} onClick={() => void save()} className="inline-flex items-center gap-1 rounded-lg bg-indigo-500 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save</button><button type="button" disabled={busy} onClick={() => { setEditing(false); setError('') }} className="rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-300">Cancel</button>{setting && <button type="button" disabled={busy} onClick={() => void clear()} className="ml-auto text-xs text-rose-300 disabled:opacity-50">Clear</button>}</div>
        </div>
      )}
    </div>
  )
}

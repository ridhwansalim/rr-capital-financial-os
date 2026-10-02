import React, { useCallback, useEffect, useState } from 'react'
import { CalendarDays, Check, Clock3, Loader2, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { formatIndiaDate } from '../lib/financeDate'
import { toIndiaDateInputValue } from '../lib/financeDate'
import { useModalBack } from '../lib/useModalBack'
import { safeBackendErrorMessage } from '../lib/safeErrorMessages'

type ScheduleKind = 'CHITTI' | 'BANK_EMI'
type Installment = {
  installment_number: number
  due_date: string
  amount: number
  status: 'SCHEDULED' | 'PAID' | 'MISSED' | 'UNCONFIRMED'
  historical: boolean
}

interface InstallmentHistoryModalProps {
  isOpen: boolean
  scheduleKind: ScheduleKind
  scheduleId: string
  title: string
  onClose: () => void
  onChanged?: () => void
}

const money = (amount: number) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(amount)

export default function InstallmentHistoryModal({ isOpen, scheduleKind, scheduleId, title, onClose, onChanged }: InstallmentHistoryModalProps) {
  const [items, setItems] = useState<Installment[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [saving, setSaving] = useState<number | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!isOpen || !scheduleId) return
    setIsLoading(true)
    setError('')
    const { data, error: loadError } = await supabase.rpc('list_installment_occurrences', {
      p_schedule_kind: scheduleKind,
      p_schedule_id: scheduleId
    })
    if (loadError) setError(safeBackendErrorMessage(loadError, 'Could not load installment history.'))
    else setItems((data || []) as Installment[])
    setIsLoading(false)
  }, [isOpen, scheduleId, scheduleKind])

  useEffect(() => { void load() }, [load])
  useModalBack(isOpen, onClose, false)

  const setStatus = async (item: Installment, status: 'PAID' | 'MISSED' | 'UNCONFIRMED') => {
    setSaving(item.installment_number)
    setError('')
    const { error: updateError } = await supabase.rpc('set_historical_installment_status', {
      p_schedule_kind: scheduleKind,
      p_schedule_id: scheduleId,
      p_installment_number: item.installment_number,
      p_status: status
    })
    if (updateError) setError(safeBackendErrorMessage(updateError, 'Could not update installment history.'))
    else {
      await load()
      onChanged?.()
    }
    setSaving(null)
  }

  if (!isOpen) return null

  const today = toIndiaDateInputValue()
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <section role="dialog" aria-modal="true" aria-labelledby="installment-history-title" className="w-full max-w-xl max-h-[85vh] flex flex-col rounded-3xl border border-white/10 bg-slate-950 shadow-2xl text-white">
        <header className="flex items-start justify-between gap-4 p-5 border-b border-white/10">
          <div>
            <h2 id="installment-history-title" className="text-lg font-bold">Payment history</h2>
            <p className="mt-1 text-sm text-slate-400">{title} · confirm what actually happened</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close payment history" className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/10"><X className="w-5 h-5" /></button>
        </header>
        <div className="overflow-y-auto p-4 space-y-2">
          <p className="px-1 pb-1 text-xs text-slate-500">Past installments start as unconfirmed. Marking one Paid records history only; it does not create or change an account transaction.</p>
          {error && <p role="alert" className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-sm text-rose-300">{error}</p>}
          {isLoading ? <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-indigo-300" /></div> : items.map(item => {
            const pastOrDue = item.due_date <= today
            const statusLabel = item.status === 'PAID'
              ? (item.historical ? 'Paid before setup' : 'Paid in ledger')
              : item.status === 'MISSED' ? 'Missed / unpaid'
                : pastOrDue ? 'Needs confirmation' : 'Upcoming'
            return (
              <article key={item.installment_number} className="rounded-2xl border border-white/10 bg-white/[0.035] p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold">Installment {item.installment_number}</p>
                    <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-400"><CalendarDays className="w-3.5 h-3.5" />{formatIndiaDate(item.due_date)}<span>·</span>₹{money(Number(item.amount))}</p>
                  </div>
                  <span className={`shrink-0 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold ${item.status === 'PAID' ? 'bg-emerald-500/10 text-emerald-300' : item.status === 'MISSED' ? 'bg-rose-500/10 text-rose-300' : pastOrDue ? 'bg-amber-500/10 text-amber-200' : 'bg-slate-700/50 text-slate-300'}`}>
                    {item.status === 'PAID' ? <Check className="w-3 h-3" /> : pastOrDue ? <Clock3 className="w-3 h-3" /> : null}{statusLabel}
                  </span>
                </div>
                {pastOrDue && item.status !== 'PAID' && (
                  <div className="flex gap-2 mt-3">
                    <button type="button" disabled={saving === item.installment_number} onClick={() => void setStatus(item, 'PAID')} className="flex-1 rounded-lg border border-emerald-400/20 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-200 disabled:opacity-50">{saving === item.installment_number ? 'Saving…' : 'Mark paid before setup'}</button>
                    <button type="button" disabled={saving === item.installment_number} onClick={() => void setStatus(item, 'MISSED')} className="rounded-lg border border-rose-400/20 px-3 py-2 text-xs font-semibold text-rose-200 disabled:opacity-50">Missed</button>
                  </div>
                )}
                {pastOrDue && item.historical && item.status === 'PAID' && (
                  <button type="button" disabled={saving === item.installment_number} onClick={() => void setStatus(item, 'UNCONFIRMED')} className="mt-2 text-xs text-slate-500 underline underline-offset-2 disabled:opacity-50">Undo confirmation</button>
                )}
              </article>
            )
          })}
          {!isLoading && items.length === 0 && <p className="py-8 text-center text-sm text-slate-500">No installment schedule is available.</p>}
        </div>
        <footer className="p-4 border-t border-white/10"><button type="button" onClick={onClose} className="w-full rounded-xl bg-white/10 py-3 text-sm font-semibold hover:bg-white/15">Done</button></footer>
      </section>
    </div>
  )
}

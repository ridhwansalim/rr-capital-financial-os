import { useEffect, useState } from 'react'
import { Info, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { dismissGuidance, isGuidanceDismissed, isGuidedHelpEnabled } from '../lib/guidedHelp'

const tips: Record<string, { title: string; text: string }> = {
  '/': { title: 'Dashboard tip', text: 'Choose a date range to focus the totals, then select a chart bar to open its matching report entries.' },
  '/ledger': { title: 'Ledger tip', text: 'Use the filters to narrow entries. Transactions created offline stay in the Pending Offline queue until they sync.' },
  '/reports': { title: 'Reports tip', text: 'Chart segments and category names filter the entry list and exports. Repeat latest starts a fresh draft dated today.' },
  '/accounts': { title: 'Accounts tip', text: 'Opening balances establish an account’s starting position. Pay Later is a credit line and is never counted as cash in hand.' },
  '/debts': { title: 'Debts tip', text: 'Use the settlement flow to record repayments so both sides and any linked installment progress stay in sync.' },
  '/contacts': { title: 'Contacts tip', text: 'Contact records help label your own lend/borrow activity; they do not create a shared login or give that person account access.' },
  '/calendar': { title: 'Calendar tip', text: 'Select a day to review that date’s activity, or use the add action to create an entry for its actual occurrence date.' },
  '/chittis': { title: 'Chittis tip', text: 'Use installment history to confirm earlier payments before recording the next scheduled contribution.' },
  '/settings': { title: 'Settings tip', text: 'Optional modules can be enabled separately. Turning one off hides it and keeps its saved data.' },
  '/budgets': { title: 'Budgets tip', text: 'Only completed categorized personal expenses count. Budgets do not stop entries or move account balances.' },
  '/calculators': { title: 'Calculators tip', text: 'Results are estimates from the assumptions shown on each tool. They are not saved and never change your financial records.' },
  '/offline': { title: 'Offline queue tip', text: 'Review pending transactions here. A row remains pending until it syncs successfully or you discard it.' },
}

export default function PageGuidance({ page }: { page: string }) {
  const [userId, setUserId] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  const tip = tips[page]

  useEffect(() => {
    let active = true
    void supabase.auth.getUser().then(({ data }) => { if (active) setUserId(data.user?.id || null) })
    return () => { active = false }
  }, [])

  useEffect(() => {
    const update = () => setRevision(value => value + 1)
    window.addEventListener('rr:guided-help-changed', update)
    return () => window.removeEventListener('rr:guided-help-changed', update)
  }, [])

  const visible = Boolean(userId && tip && isGuidedHelpEnabled(userId) && !isGuidanceDismissed(userId, page))
  void revision
  if (!visible || !tip || !userId) return null
  return <aside className="mx-4 mt-4 sm:mx-6 lg:mx-8 rounded-2xl border border-indigo-400/20 bg-indigo-500/5 px-4 py-3 text-sm text-slate-300" aria-label={tip.title}>
    <div className="flex items-start gap-3"><Info className="w-4 h-4 mt-0.5 shrink-0 text-indigo-300" /><p className="flex-1"><strong className="mr-2 text-indigo-200">{tip.title}</strong>{tip.text}</p><button type="button" aria-label="Dismiss this tip" onClick={() => { dismissGuidance(userId, page); setRevision(value => value + 1) }} className="p-1 -mr-1 text-slate-500 hover:text-white"><X className="w-4 h-4" /></button></div>
  </aside>
}

import React, { useState, useEffect } from 'react'
import { ArrowRightLeft, TrendingUp, IndianRupee, User, CalendarDays, ShieldCheck, AlertTriangle, Landmark, ChartNoAxesCombined } from 'lucide-react'
import { supabase } from '../lib/supabase'
import PendingRequests from '../components/PendingRequests'
import { Link, useNavigate } from 'react-router-dom'
import { formatIndiaDate, indiaDateExclusiveEndToIso, indiaDateStartToIso, toIndiaDateInputValue } from '../lib/financeDate'
import { buildReportPath } from '../lib/reportNavigation'
import PageHeader from '../components/PageHeader'

export default function Dashboard() {
  const navigate = useNavigate()
  const [netWorth, setNetWorth] = useState(0)
  const [liquidCash, setLiquidCash] = useState(0)
  const [upcomingOutflow, setUpcomingOutflow] = useState(0)
  const [monthIncome, setMonthIncome] = useState(0)
  const [monthExpenses, setMonthExpenses] = useState(0)

  const [accounts, setAccounts] = useState<any[]>([])
  const [accountsLoaded, setAccountsLoaded] = useState(false)
  const [recentTx, setRecentTx] = useState<any[]>([])
  const [rangeStart, setRangeStart] = useState(() => `${toIndiaDateInputValue().slice(0, 7)}-01`)
  const [rangeEnd, setRangeEnd] = useState(() => toIndiaDateInputValue())
  const [cashFlowDays, setCashFlowDays] = useState<{ day: string; income: number; expense: number }[]>([])

  useEffect(() => {
    const fetchDashboardData = async () => {
      let balData: any[] = []
      let accData: any[] = []
      let emiData: any[] = []
      let chittiData: any[] = []

      // These summaries are independent. Fetch them in one network wave instead
      // of making mobile clients wait through four sequential database round trips.
      try {
        const [balanceResult, accountResult, emiResult, chittiResult] = await Promise.all([
          supabase.from('account_balances').select('id, balance'),
          supabase.from('accounts').select('id, name, type'),
          supabase.from('recurring_emis').select('amount, start_date, end_date'),
          supabase.from('chittis').select('monthly_installment, start_date, duration_months').eq('status', 'ACTIVE'),
        ])
        if (balanceResult.error) console.warn('Could not fetch balances:', balanceResult.error)
        if (accountResult.error) console.warn('Could not fetch accounts:', accountResult.error)
        if (emiResult.error) console.warn('Could not fetch recurring commitments:', emiResult.error)
        if (chittiResult.error) console.warn('Could not fetch active chittis:', chittiResult.error)
        balData = balanceResult.data || []
        accData = accountResult.data || []
        emiData = emiResult.data || []
        chittiData = chittiResult.data || []
        setNetWorth(balData.reduce((sum, acc) => sum + Number(acc.balance), 0))
      } catch (err) {
        console.warn('Could not fetch dashboard account and commitment summaries:', err)
      }

      let currentLiquid = 0
      try {
        const balancesById = new Map(balData.map(balance => [balance.id, Number(balance.balance)]))
        const merged = accData.map(acc => {
          const balance = balancesById.get(acc.id) ?? 0
          if (['bank', 'cash', 'wallet'].includes(acc.type)) currentLiquid += balance
          return { ...acc, balance }
        })
        setAccounts(merged)
        setLiquidCash(currentLiquid)
      } catch (err) {
        console.warn('Could not fetch accounts:', err)
      } finally {
        setAccountsLoaded(true)
      }

      // Unified Math Engine for EMIs and Chittis
      try {
        let totalOutflow = 0
        const today = toIndiaDateInputValue()
        const [todayYear, todayMonth] = today.split('-').map(Number)
        const viewMonth = todayYear * 12 + todayMonth - 1

        // 1. Fetch Standard EMIs
        if (emiData) {
          totalOutflow += emiData.reduce((sum, emi) => {
            const [startYear, startMonth] = emi.start_date.split('-').map(Number)
            const emiStartMonth = startYear * 12 + startMonth - 1
            if (viewMonth < emiStartMonth) return sum

            if (emi.end_date) {
              const [endYear, endMonth] = emi.end_date.split('-').map(Number)
              const emiEndMonth = endYear * 12 + endMonth - 1
              if (viewMonth > emiEndMonth) return sum
            }
            return sum + Number(emi.amount)
          }, 0)
        }

        // 2. Fetch Active Chittis
        if (chittiData) {
           chittiData.forEach(chitti => {
             const [startYear, startMonth] = chitti.start_date.split('-').map(Number)
             const emiStartMonth = startYear * 12 + startMonth - 1
             const emiEndMonth = emiStartMonth + chitti.duration_months - 1

             if (viewMonth >= emiStartMonth && viewMonth <= emiEndMonth) {
                totalOutflow += Number(chitti.monthly_installment)
             }
           })
        }

        setUpcomingOutflow(totalOutflow)
      } catch (err) {
        console.warn('Could not fetch obligations for forecast:', err)
      }

      // Start the recent-activity request before paging the selected date range,
      // so its latency overlaps with the potentially larger chart query.
      const recentTransactionsPromise = supabase
        .from('transactions')
        .select('id, amount, description, created_at, from_account_id, to_account_id, tagged_profile_id, contact_id')
        .order('created_at', { ascending: false })
        .limit(5)

      try {
        if (rangeStart > rangeEnd) throw new Error('Invalid dashboard date range')
        const monthTx: { amount: number; fee_amount: number | null; from_account_id: string | null; to_account_id: string | null; created_at: string }[] = []
        for (let offset = 0; ; offset += 1000) {
          const { data, error } = await supabase
            .from('transactions')
            .select('amount, fee_amount, from_account_id, to_account_id, created_at')
            .eq('status', 'COMPLETED')
            .gte('created_at', indiaDateStartToIso(rangeStart))
            .lt('created_at', indiaDateExclusiveEndToIso(rangeEnd))
            .order('created_at', { ascending: true })
            .order('id', { ascending: true })
            .range(offset, offset + 999)
          if (error) throw error
          monthTx.push(...(data || []))
          if ((data || []).length < 1000) break
        }
        setMonthIncome(monthTx.reduce((sum, tx) => sum + (!tx.from_account_id ? Number(tx.amount) : 0), 0))
        setMonthExpenses(monthTx.reduce((sum, tx) => sum + (!tx.to_account_id ? Number(tx.amount) : 0) + Number(tx.fee_amount || 0), 0))
        const byDay = new Map<string, { day: string; income: number; expense: number }>()
        monthTx.forEach(tx => {
          const day = toIndiaDateInputValue(new Date(tx.created_at))
          const row = byDay.get(day) || { day, income: 0, expense: 0 }
          if (!tx.from_account_id) row.income += Number(tx.amount)
          if (!tx.to_account_id) row.expense += Number(tx.amount)
          row.expense += Number(tx.fee_amount || 0)
          byDay.set(day, row)
        })
        setCashFlowDays([...byDay.values()].slice(-31))
      } catch (err) {
        console.warn('Could not fetch this month\'s cash flow:', err)
      }

      try {
        const { data: txData } = await recentTransactionsPromise

        if (txData) {
          const pIds = new Set<string>()
          const cIds = new Set<string>()
          txData.forEach(tx => {
            if (tx.tagged_profile_id) pIds.add(tx.tagged_profile_id)
            if (tx.contact_id) cIds.add(tx.contact_id)
          })

          const nameMap: Record<string, string> = {}
          if (pIds.size > 0) {
            const { data: profiles } = await supabase.rpc('profile_labels', { p_profile_ids: Array.from(pIds) })
            profiles?.forEach((p: { id: string; full_name: string | null; username: string | null }) => nameMap[p.id] = p.full_name || p.username || 'User')
          }
          if (cIds.size > 0) {
            const { data: contacts } = await supabase.from('contacts').select('id, name').in('id', Array.from(cIds))
            contacts?.forEach(c => nameMap[c.id] = c.name)
          }

          const formattedTx = txData.map(tx => {
            let txType = 'transfer'
            if (!tx.from_account_id) txType = 'income'
            if (!tx.to_account_id) txType = 'expense'

            let taggedName = null
            if (tx.tagged_profile_id) taggedName = nameMap[tx.tagged_profile_id]
            else if (tx.contact_id) taggedName = nameMap[tx.contact_id]

            return { ...tx, type: txType, taggedName }
          })
          setRecentTx(formattedTx)
        }
      } catch (err) {
        console.error('Failed to fetch transactions:', err)
      }
    }
    fetchDashboardData()
  }, [rangeStart, rangeEnd])

  const safeToSpend = liquidCash - upcomingOutflow
  const monthNet = monthIncome - monthExpenses
  const selectedPeriod = `${formatIndiaDate(rangeStart, { month: 'short', day: 'numeric' })} – ${formatIndiaDate(rangeEnd, { month: 'short', day: 'numeric', year: 'numeric' })}`
  const maxFlowBar = Math.max(1, ...cashFlowDays.flatMap(day => [day.income, day.expense]))
  const matchesQuickRange = (days: number | 'month' | 'year') => {
    const end = toIndiaDateInputValue()
    const [year, month, day] = end.split('-').map(Number)
    const start = days === 'month' ? `${end.slice(0, 7)}-01` : days === 'year' ? `${year}-01-01` : new Date(Date.UTC(year, month - 1, day - days + 1)).toISOString().slice(0, 10)
    return rangeStart === start && rangeEnd === end
  }
  const setQuickRange = (days: number | 'month' | 'year') => {
    const end = toIndiaDateInputValue()
    const [year, month, day] = end.split('-').map(Number)
    const start = days === 'month' ? `${end.slice(0, 7)}-01` : days === 'year' ? `${year}-01-01` : new Date(Date.UTC(year, month - 1, day - days + 1)).toISOString().slice(0, 10)
    setRangeStart(start); setRangeEnd(end)
  }

  return (
    <div className="page-shell w-full max-w-7xl mx-auto animate-in fade-in duration-300 pb-32">

      <PageHeader eyebrow="RR CAPITAL · YOUR MONEY" title="Financial overview" description="Balances, commitments, and everyday activity, all in one place." icon={<TrendingUp />} />

      {/* P2P APPROVALS INBOX INJECTED HERE */}
      <PendingRequests />

      {accountsLoaded && accounts.length === 0 && <section aria-labelledby="dashboard-first-account-title" className="dashboard-onboarding surface-panel mb-5 grid gap-5 rounded-xl p-5 sm:grid-cols-[1fr_auto] sm:items-center sm:p-6">
        <div className="flex items-start gap-4">
          <span className="dashboard-onboarding-mark" aria-hidden="true"><Landmark className="h-5 w-5" /></span>
          <div>
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-accent-400">A clear start</p>
            <h2 id="dashboard-first-account-title" className="text-lg font-semibold text-[var(--ink)]">Add your first account</h2>
            <p className="mt-1 max-w-xl text-sm leading-6 text-[var(--muted)]">Set up a bank, wallet, cash, or credit line and its starting balance. Your dashboard will fill in as you record activity.</p>
          </div>
        </div>
        <Link to="/accounts" className="dashboard-onboarding-link inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors">
          <Landmark className="h-4 w-4" /> Create an account
        </Link>
      </section>}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-6 items-stretch">

        <section className="dashboard-hero lg:col-span-6 rounded-xl overflow-hidden flex flex-col justify-between min-h-56">
            <div className="p-5 sm:p-6 flex-1 flex flex-col justify-center">
              <div className="mb-7 flex items-center justify-between gap-4"><div><p className="text-xs uppercase tracking-[0.16em] text-slate-400">Your total net worth</p><h3 className="mt-1 text-sm font-normal">Across your accounts and credit lines</h3></div><span className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-slate-300">Live balance</span></div>
              <div className="dashboard-net-worth flex min-w-0 items-center text-4xl sm:text-5xl lg:text-6xl">
                <IndianRupee className="w-7 h-7 md:w-9 md:h-9 text-[#cc785c] mr-2" />
                <span className={netWorth < 0 ? 'dashboard-net-worth-value dashboard-net-worth-negative' : 'dashboard-net-worth-value'}>
                  <span className="min-w-0 break-all">{netWorth.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </span>
              </div>
              <p className="mt-6 text-xs text-slate-400">Based on the latest recorded account balances</p>
            </div>
        </section>

        <section className="dashboard-runway lg:col-span-6 rounded-xl overflow-hidden flex flex-col min-h-56">
            <div className="p-5 sm:p-6 flex-1 flex flex-col justify-center">
              <h3 className="text-slate-500 font-bold mb-3 flex items-center text-xs uppercase tracking-wider">
                <CalendarDays className="w-4 h-4 mr-2" /> Runway Forecast
              </h3>

              <div className="flex justify-between items-end mb-2">
                <div>
                  <p className="text-xs text-slate-400 mb-0.5">Liquid Assets</p>
                  <p className="font-bold text-emerald-400">+₹{liquidCash.toLocaleString('en-IN')}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-slate-400 mb-0.5">Monthly EMIs & Chittis</p>
                  <p className="font-bold text-rose-400">-₹{upcomingOutflow.toLocaleString('en-IN')}</p>
                </div>
              </div>

              <div className="border-t border-[var(--line)] pt-3 mt-3 flex justify-between items-center">
                <span className="text-sm font-medium text-slate-600">Available after commitments</span>
                <div className={`flex items-center font-bold text-lg ${safeToSpend >= 0 ? 'text-[var(--ink)]' : 'text-rose-600'}`}>
                  {safeToSpend >= 0 ? (
                    <ShieldCheck className="w-4 h-4 mr-1.5 text-emerald-400" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 mr-1.5 text-rose-400" />
                  )}
                  ₹{safeToSpend.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </div>
              </div>
            </div>
        </section>

        <section className="surface-panel lg:col-span-7 rounded-xl p-5 sm:p-6">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <h3 className="font-bold text-slate-200">Monthly cash flow</h3>
              <p className="text-xs text-slate-500 mt-0.5">{selectedPeriod} · transfers excluded</p>
            </div>
            <span className={`text-sm sm:text-base font-bold ${monthNet >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              {monthNet >= 0 ? '+' : '-'}₹{Math.abs(monthNet).toLocaleString('en-IN', { maximumFractionDigits: 0 })} net
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="rounded-2xl bg-emerald-500/10 border border-emerald-500/15 p-3 sm:p-4">
              <p className="text-xs text-slate-400">Income</p>
              <p className="mt-1 font-bold text-emerald-400 break-all">+₹{monthIncome.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</p>
            </div>
            <div className="rounded-2xl bg-rose-500/10 border border-rose-500/15 p-3 sm:p-4">
              <p className="text-xs text-slate-400">Expenses</p>
              <p className="mt-1 font-bold text-rose-400 break-all">-₹{monthExpenses.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</p>
            </div>
            <div className="col-span-2 sm:col-span-1 rounded-2xl bg-white/5 border border-white/10 p-3 sm:p-4">
              <p className="text-xs text-slate-400">Savings rate</p>
              <p className={`mt-1 font-bold ${monthIncome > 0 && monthNet >= 0 ? 'text-emerald-400' : 'text-slate-200'}`}>
                {monthIncome > 0 ? `${Math.round((monthNet / monthIncome) * 100)}%` : '—'}
              </p>
            </div>
          </div>
        </section>

        <section className="surface-panel lg:col-span-5 rounded-xl overflow-hidden flex flex-col min-h-60">
            <div className="p-5 border-b border-white/5 flex items-center justify-between bg-black/10">
              <h3 className="font-bold flex items-center text-slate-200">
                <Landmark className="w-4 h-4 mr-2 text-indigo-400" /> Accounts <span className="ml-2 text-xs font-normal text-slate-500">{accounts.length}</span>
              </h3>
            </div>
            <div className="p-4 flex-1 overflow-y-auto space-y-2">
              {accounts.map(acc => (
                <div key={acc.id} className="flex justify-between items-center p-3 rounded-xl hover:bg-white/5 transition-colors">
                    <span className="text-sm font-medium text-slate-300 min-w-0 truncate">{acc.name}</span>
                  <span className={`text-sm font-bold shrink-0 ml-3 ${Number(acc.balance) < 0 ? 'text-rose-400' : 'text-white'}`}>
                    ₹{Number(acc.balance).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </span>
                </div>
              ))}
              {accounts.length === 0 && <p className="text-sm text-slate-500 text-center py-4">No accounts found.</p>}
            </div>
        </section>

        <section className="surface-panel lg:col-span-12 rounded-xl p-5 sm:p-6">
          <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 mb-5">
            <div><h3 className="font-bold flex items-center text-slate-100"><ChartNoAxesCombined className="w-4 h-4 mr-2 text-indigo-300" /> Cash flow</h3><p className="text-xs text-slate-500 mt-1">Income and expenses for the selected period</p></div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2" role="group" aria-label="Quick date ranges">{[['7 days', 7], ['30 days', 30], ['This month', 'month'], ['This year', 'year']].map(([label, value]) => { const active = matchesQuickRange(value as number | 'month' | 'year'); return <button key={label} type="button" aria-pressed={active} onClick={() => setQuickRange(value as number | 'month' | 'year')} className={`rounded-xl border px-3 py-2.5 text-xs font-medium transition-colors ${active ? 'border-accent-400/40 bg-accent-500/15 text-accent-300 shadow-sm' : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'}`}>{label}</button> })}</div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] items-end gap-3 mb-4"><label className="text-xs text-slate-500">From<input type="date" value={rangeStart} max={rangeEnd} onChange={e => setRangeStart(e.target.value)} className="mt-1 block w-full rounded-xl bg-slate-900 border border-white/10 px-3 py-2 text-white" /></label><span className="hidden sm:block text-slate-500 pb-2">through</span><label className="text-xs text-slate-500">To<input type="date" value={rangeEnd} min={rangeStart} max={toIndiaDateInputValue()} onChange={e => setRangeEnd(e.target.value)} className="mt-1 block w-full rounded-xl bg-slate-900 border border-white/10 px-3 py-2 text-white" /></label></div>
          <div className="flex items-center gap-4 text-xs text-slate-400 mb-2"><span className="flex items-center gap-1.5"><i className="w-2 h-2 rounded-full bg-emerald-400" />Income</span><span className="flex items-center gap-1.5"><i className="w-2 h-2 rounded-full bg-rose-400" />Expenses</span><span className="ml-auto">{selectedPeriod}</span></div>
          {cashFlowDays.length ? <div className="flex h-36 items-end gap-1 overflow-x-auto rounded-2xl bg-black/10 p-3">{cashFlowDays.map(day => <div key={day.day} title={`${day.day} · Income ${day.income.toLocaleString('en-IN')} · Expenses ${day.expense.toLocaleString('en-IN')}`} className="min-w-7 flex-1 h-full flex items-end justify-center gap-0.5"><button type="button" aria-label={`Open income report for ${day.day}: ${day.income.toLocaleString('en-IN')}`} disabled={day.income <= 0} onClick={() => navigate(buildReportPath({ from: day.day, to: day.day, kind: 'income' }))} className="w-1/2 min-w-2 h-full flex items-end justify-center rounded-t focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300 disabled:cursor-default"><span aria-hidden="true" className="w-full rounded-t bg-emerald-400/80 hover:bg-emerald-300 transition-colors" style={{ height: day.income > 0 ? `${Math.max(2, day.income / maxFlowBar * 100)}%` : '0%' }} /></button><button type="button" aria-label={`Open expense report for ${day.day}: ${day.expense.toLocaleString('en-IN')}`} disabled={day.expense <= 0} onClick={() => navigate(buildReportPath({ from: day.day, to: day.day, kind: 'expense' }))} className="w-1/2 min-w-2 h-full flex items-end justify-center rounded-t focus-visible:outline focus-visible:outline-2 focus-visible:outline-rose-300 disabled:cursor-default"><span aria-hidden="true" className="w-full rounded-t bg-rose-400/80 hover:bg-rose-300 transition-colors" style={{ height: day.expense > 0 ? `${Math.max(2, day.expense / maxFlowBar * 100)}%` : '0%' }} /></button></div>)}</div> : <div className="grid place-items-center h-36 rounded-2xl bg-black/10 text-sm text-slate-500">No cash flow for these dates.</div>}
          <div className="mt-4 flex justify-between items-center"><span className="text-xs text-slate-500">Select an income or expense bar to open that day's entries. Transfers are excluded.</span><Link to={buildReportPath({ from: rangeStart, to: rangeEnd })} className="text-sm font-semibold text-indigo-300 hover:text-indigo-200">Open detailed reports →</Link></div>
        </section>

        <section className="surface-panel lg:col-span-12 rounded-xl overflow-hidden flex flex-col min-h-60">
            <div className="p-5 border-b border-white/5 flex items-center justify-between bg-black/10">
              <h3 className="font-bold flex items-center text-slate-200">
                <ArrowRightLeft className="w-4 h-4 mr-2 text-rose-400" /> Recent Activity
              </h3>
            </div>
            <div className="p-4 flex-1 overflow-y-auto space-y-2">
              {recentTx.map(tx => (
                <div key={tx.id} className="flex justify-between items-center p-3 rounded-xl hover:bg-white/5 transition-colors">
                  <div>
                    <p className="text-sm font-medium text-slate-200 line-clamp-1">{tx.description}</p>
                    <div className="flex items-center space-x-2 mt-1">
                      <p className="text-xs text-slate-500">{formatIndiaDate(tx.created_at)}</p>
                      {tx.taggedName && (
                        <span className="flex items-center text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                          <User className="w-3 h-3 mr-1" /> {tx.taggedName}
                        </span>
                      )}
                    </div>
                  </div>
                  <span className={`text-sm font-bold ${tx.type === 'income' ? 'text-emerald-400' : tx.type === 'expense' ? 'text-rose-400' : 'text-slate-300'}`}>
                    {tx.type === 'expense' ? '-' : tx.type === 'income' ? '+' : ''}₹{Number(tx.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </span>
                </div>
              ))}
              {recentTx.length === 0 && <p className="text-sm text-slate-500 text-center py-8">No transactions yet. Add your first transaction to see it here.</p>}
            </div>
        </section>

      </div>
    </div>
  )
}

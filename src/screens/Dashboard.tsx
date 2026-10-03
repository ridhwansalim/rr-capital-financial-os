import React, { Suspense, useState, useEffect } from 'react'
import { ArrowRightLeft, TrendingUp, CalendarDays, Landmark, Eye, EyeOff, ArrowDownLeft, ArrowUpRight, Wallet, CreditCard, ChevronRight } from 'lucide-react'
import { supabase } from '../lib/supabase'
import PendingRequests from '../components/PendingRequests'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { formatIndiaDate, indiaDateExclusiveEndToIso, indiaDateStartToIso, toIndiaDateInputValue } from '../lib/financeDate'
import { buildReportPath } from '../lib/reportNavigation'
import PageHeader from '../components/PageHeader'
import { buildCashFlowBuckets, type CashFlowBucket } from '../lib/dashboardCashFlow'

const DashboardClassic = React.lazy(() => import('./DashboardClassic'))

export default function Dashboard() {
  const location = useLocation()
  if (new URLSearchParams(location.search).get('layout') === 'classic') {
    return <Suspense fallback={<div className="page-shell">Opening the previous dashboard…</div>}><DashboardClassic /></Suspense>
  }
  return <DashboardEditorial />
}

function DashboardEditorial() {
  const navigate = useNavigate()
  const [netWorth, setNetWorth] = useState(0)
  const [liquidCash, setLiquidCash] = useState(0)
  const [upcomingOutflow, setUpcomingOutflow] = useState(0)
  const [nextMonthOutflow, setNextMonthOutflow] = useState(0)
  const [monthIncome, setMonthIncome] = useState(0)
  const [monthExpenses, setMonthExpenses] = useState(0)
  
  const [accounts, setAccounts] = useState<any[]>([])
  const [activeEmis, setActiveEmis] = useState<any[]>([])
  const [activeChittis, setActiveChittis] = useState<any[]>([])
  const [accountsLoaded, setAccountsLoaded] = useState(false)
  const [recentTx, setRecentTx] = useState<any[]>([])
  const [accountTab, setAccountTab] = useState<'all' | 'liquid' | 'credit' | 'chitti'>('all')
  const [transactionTab, setTransactionTab] = useState<'all' | 'income' | 'expense' | 'transfer'>('all')
  const [showMoreActivity, setShowMoreActivity] = useState(false)
  const [privacyMode, setPrivacyMode] = useState(false)
  const [rangeStart, setRangeStart] = useState(() => `${toIndiaDateInputValue().slice(0, 7)}-01`)
  const [rangeEnd, setRangeEnd] = useState(() => toIndiaDateInputValue())
  const [cashFlowDays, setCashFlowDays] = useState<CashFlowBucket[]>([])
  const [cashFlowGranularity, setCashFlowGranularity] = useState<'day' | 'month'>('day')
  const [emiOutflow, setEmiOutflow] = useState(0)
  const [chittiOutflow, setChittiOutflow] = useState(0)

  useEffect(() => {
    const fetchDashboardData = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      const ownerId = session?.user.id
      if (!ownerId) { setAccountsLoaded(true); return }
      let balData: any[] = []
      let accData: any[] = []
      let emiData: any[] = []
      let chittiData: any[] = []

      // These summaries are independent. Fetch them in one network wave instead
      // of making mobile clients wait through four sequential database round trips.
      try {
        const [balanceResult, accountResult, emiResult, chittiResult] = await Promise.all([
          supabase.from('account_balances').select('id, balance'),
          supabase.from('accounts').select('id, name, type, credit_limit'),
          supabase.from('recurring_emis').select('name, amount, start_date, end_date, status').eq('status', 'ACTIVE'),
          supabase.from('chittis').select('id, name, monthly_installment, start_date, duration_months, months_paid, payout_received, received_month_number').eq('status', 'ACTIVE'),
        ])
        if (balanceResult.error) console.warn('Could not fetch dashboard balances')
        if (accountResult.error) console.warn('Could not fetch dashboard accounts')
        if (emiResult.error) console.warn('Could not fetch recurring commitments')
        if (chittiResult.error) console.warn('Could not fetch active chittis')
        balData = balanceResult.data || []
        accData = accountResult.data || []
        emiData = emiResult.data || []
        chittiData = chittiResult.data || []
        setActiveEmis(emiData)
        setActiveChittis(chittiData)
        setNetWorth(balData.reduce((sum, acc) => sum + Number(acc.balance), 0))
      } catch {
        console.warn('Could not fetch dashboard account and commitment summaries')
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
      } catch {
        console.warn('Could not assemble dashboard accounts')
      } finally {
        setAccountsLoaded(true)
      }

      // Unified Math Engine for EMIs and Chittis
      try {
        const today = toIndiaDateInputValue()
        const [todayYear, todayMonth] = today.split('-').map(Number)
        const viewMonth = todayYear * 12 + todayMonth - 1
        const nextMonth = viewMonth + 1
        let totalEmiOutflow = 0
        let totalChittiOutflow = 0
        let projectedOutflow = 0

        // 1. Fetch Standard EMIs
        if (emiData) {
          const emiOutflowForMonth = (monthIndex: number) => emiData.reduce((sum, emi) => {
            const [startYear, startMonth] = emi.start_date.split('-').map(Number)
            const emiStartMonth = startYear * 12 + startMonth - 1
            if (monthIndex < emiStartMonth) return sum
            
            if (emi.end_date) {
              const [endYear, endMonth] = emi.end_date.split('-').map(Number)
              const emiEndMonth = endYear * 12 + endMonth - 1
              if (monthIndex > emiEndMonth) return sum
            }
            return sum + Number(emi.amount)
          }, 0)
          totalEmiOutflow = emiOutflowForMonth(viewMonth)
          projectedOutflow += emiOutflowForMonth(nextMonth)
        }

        // 2. Fetch Active Chittis
        if (chittiData) {
           chittiData.forEach(chitti => {
             const [startYear, startMonth] = chitti.start_date.split('-').map(Number)
             const emiStartMonth = startYear * 12 + startMonth - 1
             const emiEndMonth = emiStartMonth + chitti.duration_months - 1

             if (viewMonth >= emiStartMonth && viewMonth <= emiEndMonth) {
                totalChittiOutflow += Number(chitti.monthly_installment)
             }
             if (nextMonth >= emiStartMonth && nextMonth <= emiEndMonth) {
                projectedOutflow += Number(chitti.monthly_installment)
             }
           })
        }
        
        setEmiOutflow(totalEmiOutflow)
        setChittiOutflow(totalChittiOutflow)
        setUpcomingOutflow(totalEmiOutflow + totalChittiOutflow)
        setNextMonthOutflow(projectedOutflow)
      } catch {
        console.warn('Could not calculate dashboard forecast')
      }

      // Start the recent-activity request before paging the selected date range,
      // so its latency overlaps with the potentially larger chart query.
      const recentTransactionsPromise = supabase
        .from('transactions')
        .select('id, amount, description, created_at, from_account_id, to_account_id, tagged_profile_id, contact_id')
        .eq('owner_id', ownerId)
        .eq('status', 'COMPLETED')
        .order('created_at', { ascending: false })
        .limit(25)

      try {
        if (rangeStart > rangeEnd) throw new Error('Invalid dashboard date range')
        const monthTx: { amount: number; fee_amount: number | null; from_account_id: string | null; to_account_id: string | null; created_at: string }[] = []
        for (let offset = 0; ; offset += 1000) {
          const { data, error } = await supabase
            .from('transactions')
            .select('amount, fee_amount, from_account_id, to_account_id, created_at')
            .eq('owner_id', ownerId)
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
        const cashFlow = buildCashFlowBuckets(monthTx.map(tx => ({
          ...tx,
          date: toIndiaDateInputValue(new Date(tx.created_at)),
        })), rangeStart, rangeEnd)
        setCashFlowGranularity(cashFlow.granularity)
        setCashFlowDays(cashFlow.buckets)
      } catch {
        console.warn('Could not calculate dashboard cash flow')
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
      } catch {
        console.error('Could not load recent dashboard activity')
      }
    }
    fetchDashboardData()
  }, [rangeStart, rangeEnd])

  const safeToSpend = liquidCash - upcomingOutflow
  const nextMonthSafeToSpend = liquidCash - nextMonthOutflow
  const savingsRate = monthIncome > 0 ? ((monthIncome - monthExpenses) / monthIncome) * 100 : null
  const obligationBurden = liquidCash > 0 ? (upcomingOutflow / liquidCash) * 100 : null
  const selectedPeriod = `${formatIndiaDate(rangeStart, { month: 'short', day: 'numeric' })} – ${formatIndiaDate(rangeEnd, { month: 'short', day: 'numeric', year: 'numeric' })}`
  const maxFlowBar = Math.max(1, ...cashFlowDays.flatMap(day => [day.income, day.expense]))
  const today = toIndiaDateInputValue()
  const [todayYear, todayMonth] = today.split('-').map(Number)
  const nextMonthDate = new Date(Date.UTC(todayYear, todayMonth, 15, 6))
  const nextMonthLabel = new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(nextMonthDate)
  const money = (value: number, decimals = 0) => privacyMode ? '••••••' : `₹${value.toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`
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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'p' || event.altKey || event.ctrlKey || event.metaKey) return
      if (event.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)) return
      setPrivacyMode(current => !current)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const liquidAccounts = accounts.filter(account => ['bank', 'cash', 'wallet'].includes(account.type))
  const creditAccounts = accounts.filter(account => ['credit', 'credit_card', 'pay_later'].includes(account.type))
  const visibleAccounts = accountTab === 'liquid' ? liquidAccounts : accountTab === 'credit' ? creditAccounts : accounts
  const filteredTransactions = recentTx.filter(tx => transactionTab === 'all' || tx.type === transactionTab)
  const shownTransactions = showMoreActivity ? filteredTransactions : filteredTransactions.slice(0, 5)
  const composition = [
    { label: 'Banks', value: liquidAccounts.filter(account => account.type === 'bank').reduce((sum, account) => sum + Math.max(0, Number(account.balance)), 0), color: 'var(--ed-coral)' },
    { label: 'Cash & wallets', value: liquidAccounts.filter(account => ['cash', 'wallet'].includes(account.type)).reduce((sum, account) => sum + Math.max(0, Number(account.balance)), 0), color: 'var(--ed-teal)' },
    { label: 'Credit used', value: creditAccounts.reduce((sum, account) => sum + Math.max(0, -Number(account.balance)), 0), color: 'var(--ed-coral)' },
    { label: 'Other', value: accounts.filter(account => !['bank', 'cash', 'wallet', 'credit', 'credit_card', 'pay_later'].includes(account.type)).reduce((sum, account) => sum + Math.max(0, Number(account.balance)), 0), color: 'var(--ed-ink)' },
  ]
  const compositionTotal = composition.reduce((sum, item) => sum + item.value, 0)

  return <EditorialBoard {...{ navigate, netWorth, liquidCash, upcomingOutflow, nextMonthOutflow, emiOutflow, chittiOutflow, obligationBurden, monthIncome, monthExpenses, savingsRate, accounts, activeEmis, activeChittis, accountsLoaded, recentTx, accountTab, setAccountTab, transactionTab, setTransactionTab, showMoreActivity, setShowMoreActivity, privacyMode, setPrivacyMode, rangeStart, rangeEnd, setRangeStart, setRangeEnd, cashFlowDays, cashFlowGranularity, selectedPeriod, maxFlowBar, safeToSpend, nextMonthSafeToSpend, nextMonthLabel, money, matchesQuickRange, setQuickRange, liquidAccounts, creditAccounts, visibleAccounts, filteredTransactions, shownTransactions, composition, compositionTotal }} />

}

function EditorialBoard(p: any) {
  const money = p.money as (n: number, d?: number) => string
  const group = 'ed-panel rounded-[1.35rem] border p-5 sm:p-6'
  const accountKinds: Record<string, string> = { bank: 'Bank', cash: 'Cash', wallet: 'Wallet', credit: 'Credit card', credit_card: 'Credit card', pay_later: 'Pay later' }
  const accountViewRows = p.accountTab === 'chitti' ? p.activeChittis.map((item: any) => ({ id: item.id, name: item.name, type: 'chitti', balance: Number(item.monthly_installment), href: '/chittis' })) : p.visibleAccounts
  const cashBars = p.cashFlowDays as CashFlowBucket[]
  const formatBucketLabel = (bucket: CashFlowBucket) => p.cashFlowGranularity === 'month'
    ? formatIndiaDate(`${bucket.start.slice(0, 7)}-15`, { month: 'short', year: '2-digit' })
    : formatIndiaDate(bucket.start, { month: 'short', day: 'numeric' })
  const bucketDescription = (bucket: CashFlowBucket) => bucket.start === bucket.end
    ? bucket.start
    : `${bucket.start} through ${bucket.end}`
  return <div className="page-shell dashboard-editorial mx-auto w-full max-w-[1500px] pb-32">
    <PageHeader eyebrow="RR CAPITAL · YOUR MONEY" title="Financial overview" description="A clear view of what you have, what is committed, and where it is going." icon={<TrendingUp />} />
    {p.accountsLoaded && p.accounts.length === 0 && <section className="dashboard-onboarding ed-panel mb-5 grid gap-5 rounded-[1.35rem] p-5 sm:grid-cols-[1fr_auto] sm:items-center sm:p-6">
      <div className="flex items-start gap-4"><span className="dashboard-onboarding-mark"><Landmark className="h-5 w-5" /></span><div><p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-accent-400">A clear start</p><h2 className="text-lg font-semibold text-[var(--ink)]">Add your first account</h2><p className="mt-1 max-w-xl text-sm leading-6 text-[var(--muted)]">Set a bank, wallet, cash, or credit line with its starting balance. Your dashboard fills in as you record activity.</p></div></div>
      <Link to="/accounts" className="dashboard-onboarding-link liquid-action inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold"><Landmark className="h-4 w-4" /> Create an account</Link>
    </section>}
    <div className="grid grid-cols-1 items-stretch gap-4 sm:gap-5 xl:grid-cols-12">
      <section className="ed-networth xl:col-span-5"><div className="flex items-start justify-between gap-3"><div><p className="ed-kicker">Your total net worth</p><p className="mt-1 text-sm opacity-70">Across your accounts and credit lines</p></div><button type="button" onClick={() => p.setPrivacyMode(!p.privacyMode)} className="ed-icon-button" aria-label={p.privacyMode ? 'Show balances' : 'Hide balances'}>{p.privacyMode ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}</button></div>
        <div className="ed-total mt-8">{money(p.netWorth, 2)}</div><div className="mt-2 text-xs opacity-65">Across {p.accounts.length} recorded accounts · latest balances</div>
        <div className="ed-composition mt-7" aria-label="Balance composition">{p.compositionTotal > 0 ? p.composition.map((x: any) => <i key={x.label} title={x.label} style={{ width: `${Math.max(1, x.value / p.compositionTotal * 100)}%`, background: x.color }} />) : <i style={{ width: '100%' }} />}</div>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2">{p.composition.map((x: any) => <span key={x.label} className="ed-legend"><i style={{ background: x.color }} />{x.label}<b>{money(x.value)}</b></span>)}</div>
        <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('rr:transaction-draft', { detail: { type: 'transfer' } }))} className="ed-action mt-7"><ArrowRightLeft className="h-4 w-4" /> Move money <ChevronRight className="ml-auto h-4 w-4" /></button>
      </section>
      <section className="ed-commitments xl:col-span-7"><div className="flex items-start justify-between gap-3"><div><p className="ed-kicker">Commitments &amp; liquidity</p><p className="mt-1 text-sm opacity-70">Current balance less scheduled payments</p></div><CalendarDays className="h-5 w-5 opacity-60" /></div>
        <div className="mt-7 grid gap-5 sm:grid-cols-2"><div><p className="text-xs opacity-65">Liquid balance</p><p className="ed-stat mt-1">{money(p.liquidCash)}</p></div><div><p className="text-xs opacity-65">This month · EMIs &amp; Chittis</p><p className="ed-stat mt-1">−{money(p.upcomingOutflow)}</p></div></div>
        <div className="ed-forecast mt-6"><div><p className="text-xs opacity-65">After this month’s commitments</p><p className="mt-1 text-xl font-semibold">{money(p.safeToSpend)}</p></div><div className="ed-forecast-next"><p className="text-xs opacity-65">Next month · {p.nextMonthLabel}</p><p className="mt-1 text-lg font-semibold">{money(p.nextMonthSafeToSpend)}</p><span>{money(p.nextMonthOutflow)} scheduled</span></div></div>
        <p className="mt-4 text-[11px] opacity-60">Projection holds today’s liquid balance constant and subtracts listed recurring commitments.</p>
      </section>
      <section className="ed-chart xl:col-span-8"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start"><div><p className="ed-kicker">Cash flow · {p.selectedPeriod}</p><p className="mt-1 text-sm opacity-65">{p.cashFlowGranularity === 'day' ? 'Daily' : 'Monthly'} income and expenses · transfers excluded</p></div><Link className="ed-link" to={buildReportPath({ from: p.rangeStart, to: p.rangeEnd })}>Open detailed report <ChevronRight className="h-4 w-4" /></Link></div>
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">{[['Income', p.monthIncome, 'income'], ['Expenses', p.monthExpenses, 'expense'], ['Net flow', p.monthIncome-p.monthExpenses, 'net']].map(([label,value,key]: any) => <div className="ed-metric" key={key}><span>{label}</span><b className={key}>{money(value)}</b></div>)}<div className="ed-metric ed-savings-metric"><div><span>Savings rate</span><b>{p.savingsRate === null ? '—' : `${p.savingsRate.toFixed(1)}%`}</b></div><span className="ed-savings-ring" style={{ '--savings-progress': `${Math.max(0, Math.min(100, p.savingsRate ?? 0))}%` } as React.CSSProperties} aria-hidden="true" /></div></div>
        <div className="mt-5 flex flex-wrap gap-2" role="group" aria-label="Quick date ranges">{[['7 days',7],['30 days',30],['This month','month'],['This year','year']].map(([label,value]: any) => <button key={label} type="button" aria-pressed={p.matchesQuickRange(value)} onClick={() => p.setQuickRange(value)} className={`ed-range ${p.matchesQuickRange(value) ? 'active' : ''}`}>{label}</button>)}</div>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:max-w-md"><label className="ed-date">From<input type="date" value={p.rangeStart} max={p.rangeEnd} onChange={e => p.setRangeStart(e.target.value)} /></label><label className="ed-date">To<input type="date" value={p.rangeEnd} min={p.rangeStart} max={toIndiaDateInputValue()} onChange={e => p.setRangeEnd(e.target.value)} /></label></div>
        {cashBars.length ? <div className="ed-bars mt-5" role="group" aria-label={`${p.cashFlowGranularity === 'day' ? 'Daily' : 'Monthly'} cash flow chart`}>{cashBars.map((bucket, i) => { const dates = { from: bucket.start, to: bucket.end }; const description = bucketDescription(bucket); return <div className="ed-bar-day" key={bucket.start} title={`${description}: income ${money(bucket.income)}, expenses ${money(bucket.expense)}`}><button aria-label={`View income entries ${bucket.start === bucket.end ? 'on' : 'from'} ${description}`} disabled={!bucket.income} onClick={() => p.navigate(buildReportPath({ ...dates, kind: 'income' }))}><i style={{ height: `${bucket.income ? Math.max(3, bucket.income / p.maxFlowBar * 100) : 0}%` }} /></button><button aria-label={`View expense entries ${bucket.start === bucket.end ? 'on' : 'from'} ${description}`} disabled={!bucket.expense} onClick={() => p.navigate(buildReportPath({ ...dates, kind: 'expense' }))}><i style={{ height: `${bucket.expense ? Math.max(3, bucket.expense / p.maxFlowBar * 100) : 0}%` }} /></button>{(i % Math.max(1, Math.ceil(cashBars.length/6)) === 0 || i === cashBars.length-1) && <small>{formatBucketLabel(bucket)}</small>}</div> })}</div> : <div className="ed-empty mt-5">No completed income or expense entries in this period.</div>}
        <div className="mt-4 flex gap-4 text-xs opacity-65"><span className="ed-dot income-dot"/> Income <span className="ed-dot expense-dot"/> Expenses <span className="ml-auto">Select a bar to view matching report entries</span></div>
      </section>
      <div className="flex flex-col gap-4 xl:col-span-4"><section className={group}><div className="flex items-center justify-between"><div><p className="ed-kicker">Accounts</p><p className="mt-1 text-sm opacity-65">{p.accounts.length} accounts and credit lines</p></div><Link to="/accounts" className="ed-icon-button" aria-label="Manage accounts"><ChevronRight className="h-4 w-4" /></Link></div>
        <div className="mt-4 flex flex-wrap gap-1" role="tablist" aria-label="Account filters">{[['all','All'],['liquid','Liquid'],['credit','Credit'],['chitti','Chittis']].map(([key,label]) => <button role="tab" aria-selected={p.accountTab===key} className={`ed-tab ${p.accountTab===key?'active':''}`} key={key} onClick={() => p.setAccountTab(key)}>{label}</button>)}</div>
        <div className="mt-3 divide-y ed-divider">{accountViewRows.map((acc: any) => <Link to={acc.href || '/accounts'} key={acc.id} className="ed-account"><span className="ed-account-mark">{['bank','cash','wallet'].includes(acc.type) ? <Wallet className="h-4 w-4"/> : <CreditCard className="h-4 w-4"/>}</span><span className="min-w-0 flex-1"><b className="block truncate">{acc.name}</b><small>{accountKinds[acc.type] || (acc.type === 'chitti' ? 'Active Chitti · monthly installment' : 'Account')}</small></span><strong>{money(Number(acc.balance))}</strong></Link>)}{accountViewRows.length===0 && <div className="py-6 text-center text-sm opacity-60">No entries in this view.</div>}</div>
      </section><PendingRequests /></div>
      <section className={`${group} xl:col-span-7`}><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><div><p className="ed-kicker">Recent activity</p><p className="mt-1 text-sm opacity-65">Latest recorded transactions</p></div><Link to="/ledger" className="ed-link">Open ledger <ChevronRight className="h-4 w-4"/></Link></div>
        <div className="mt-4 flex flex-wrap gap-1" role="tablist" aria-label="Transaction filters">{[['all','All'],['income','Income'],['expense','Expenses'],['transfer','Transfers']].map(([key,label])=><button role="tab" aria-selected={p.transactionTab===key} className={`ed-tab ${p.transactionTab===key?'active':''}`} key={key} onClick={()=>p.setTransactionTab(key)}>{label}</button>)}</div>
        <div className="mt-3 divide-y ed-divider">{p.shownTransactions.map((tx:any)=><div key={tx.id} className="ed-transaction"><span className={`ed-transaction-icon ${tx.type}`} aria-hidden="true">{tx.type==='income'?<ArrowDownLeft className="h-4 w-4"/>:tx.type==='expense'?<ArrowUpRight className="h-4 w-4"/>:<ArrowRightLeft className="h-4 w-4"/>}</span><span className="min-w-0 flex-1"><b className="block truncate">{tx.description || (tx.type==='transfer'?'Transfer':tx.type)}</b><small>{formatIndiaDate(tx.created_at)}{tx.taggedName?` · ${tx.taggedName}`:''}</small></span><strong className={tx.type}>{tx.type==='expense'?'−':tx.type==='income'?'+':''}{money(Number(tx.amount),2)}</strong></div>)}{p.shownTransactions.length===0 && <div className="py-6 text-center text-sm opacity-60">No matching transactions found.</div>}</div>
        {p.filteredTransactions.length>5 && <button className="ed-show-more mt-4" onClick={()=>p.setShowMoreActivity(!p.showMoreActivity)}>{p.showMoreActivity?'Show fewer':'Show up to 25 recent entries'} <ChevronRight className={`h-4 w-4 ${p.showMoreActivity?'rotate-90':''}`}/></button>}
      </section>
      <section className={`${group} xl:col-span-5`}><div className="flex items-center justify-between"><div><p className="ed-kicker">Schedules</p><p className="mt-1 text-sm opacity-65">Active Chittis and recurring EMIs · {money(p.upcomingOutflow)} this month</p></div><Link to="/calendar" className="ed-link">Calendar <ChevronRight className="h-4 w-4"/></Link></div>
        <div className="ed-commitment-summary mt-4 grid grid-cols-2 gap-2"><div><span>EMIs</span><strong>{money(p.emiOutflow)}</strong></div><div><span>Chittis</span><strong>{money(p.chittiOutflow)}</strong></div><div className="col-span-2"><span>Share of liquid balance</span><strong>{p.obligationBurden === null ? 'Add a liquid account to compare' : `${p.obligationBurden.toFixed(1)}%`}</strong></div></div>
        <div className="mt-4 divide-y ed-divider">{[...p.activeChittis.map((x:any)=>({...x, scheduleType:'Chitti', installment:x.monthly_installment})),...p.activeEmis.map((x:any)=>({...x, scheduleType:'Recurring EMI', installment:x.amount}))].slice(0,5).map((item:any,i:number)=><div className="ed-schedule" key={`${item.scheduleType}-${item.id || item.name}-${i}`}><span className="ed-schedule-mark"><CalendarDays className="h-4 w-4"/></span><span className="min-w-0 flex-1"><b className="block truncate">{item.name || item.scheduleType}</b><small>{item.scheduleType}</small></span><strong>{money(Number(item.installment))}<small>/ month</small></strong></div>)}{!p.activeChittis.length && !p.activeEmis.length && <div className="py-6 text-center text-sm opacity-60">No active recurring schedules.</div>}</div>
      </section>
    </div>
  </div>
}

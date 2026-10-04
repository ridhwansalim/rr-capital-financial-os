import React, { Suspense, useState, useEffect } from 'react'
import { ArrowRightLeft, TrendingUp, CalendarDays, Landmark, Eye, EyeOff, ArrowDownLeft, ArrowUpRight, Wallet, CreditCard, ChevronRight, Gauge, ShieldCheck, Clock3 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { formatIndiaDate, indiaDateExclusiveEndToIso, indiaDateStartToIso, toIndiaDateInputValue } from '../lib/financeDate'
import { buildReportPath } from '../lib/reportNavigation'
import PageHeader from '../components/PageHeader'
import LiquidGlassSwitcher from '../components/ui/LiquidGlassSwitcher'
import { liquidGlassItemProps } from '../components/ui/liquidGlassSwitcherItem'
import PageGuidance from '../components/PageGuidance'
import { buildCashFlowBuckets, type CashFlowBucket } from '../lib/dashboardCashFlow'
import { useDashboardInsightsContext } from '../lib/dashboardInsights'

const DashboardClassic = React.lazy(() => import('./DashboardClassic'))

export default function Dashboard() {
  const location = useLocation()
  if (new URLSearchParams(location.search).get('layout') === 'classic') {
    return <Suspense fallback={<div className="page-shell">Opening the previous dashboard…</div>}><DashboardClassic showGuidance /></Suspense>
  }
  return <DashboardEditorial />
}

function DashboardEditorial() {
  const navigate = useNavigate()
  const sharedInsights = useDashboardInsightsContext()
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
  const [viewerId, setViewerId] = useState<string | null>(null)
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
  const [dashboardRefresh, setDashboardRefresh] = useState(0)

  useEffect(() => {
    const refreshAfterFinancialChange = () => setDashboardRefresh(current => current + 1)
    window.addEventListener('rr:financial-data-changed', refreshAfterFinancialChange)
    return () => window.removeEventListener('rr:financial-data-changed', refreshAfterFinancialChange)
  }, [])

  useEffect(() => {
    const fetchDashboardData = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      const ownerId = session?.user.id
      if (!ownerId) { setAccountsLoaded(true); return }
      setViewerId(ownerId)
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
          supabase.from('recurring_emis').select('id, name, amount, total_principal, start_date, end_date, status, type, owner_id, owner_months_paid, counterparty_months_paid, counterparty_profile_id').eq('status', 'ACTIVE'),
          supabase.from('chittis').select('id, name, monthly_installment, start_date, duration_months, months_paid, payout_received, received_month_number, status').eq('status', 'ACTIVE'),
        ])
        if (balanceResult.error) console.warn('Could not fetch dashboard balances')
        if (accountResult.error) console.warn('Could not fetch dashboard accounts')
        if (emiResult.error) console.warn('Could not fetch recurring commitments')
        if (chittiResult.error) console.warn('Could not fetch active chittis')
        balData = balanceResult.data || []
        accData = accountResult.data || []
        emiData = emiResult.data || []
        chittiData = (chittiResult.data || []).filter(chitti => Number(chitti.months_paid || 0) < Number(chitti.duration_months || 0))
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
        .select('id, amount, fee_amount, description, created_at, from_account_id, to_account_id, tagged_profile_id, contact_id, category_id')
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
          const categoryIds = new Set<string>()
          txData.forEach(tx => {
            if (tx.tagged_profile_id) pIds.add(tx.tagged_profile_id)
            if (tx.contact_id) cIds.add(tx.contact_id)
            if (tx.category_id) categoryIds.add(tx.category_id)
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
          if (categoryIds.size > 0) {
            const { data: categories } = await supabase.from('transaction_categories').select('id, name').in('id', Array.from(categoryIds))
            categories?.forEach(category => nameMap[`category:${category.id}`] = category.name)
          }

          const formattedTx = txData.map(tx => {
            let txType = 'transfer'
            if (!tx.from_account_id) txType = 'income'
            if (!tx.to_account_id) txType = 'expense'
            
            let taggedName = null
            if (tx.tagged_profile_id) taggedName = nameMap[tx.tagged_profile_id]
            else if (tx.contact_id) taggedName = nameMap[tx.contact_id]

            return { ...tx, type: txType, taggedName, categoryName: tx.category_id ? nameMap[`category:${tx.category_id}`] || 'Category' : null }
          })
          setRecentTx(formattedTx)
        }
      } catch {
        console.error('Could not load recent dashboard activity')
      }
    }
    fetchDashboardData()
  }, [rangeStart, rangeEnd, dashboardRefresh])

  const displayedNetWorth = sharedInsights && !sharedInsights.loading ? sharedInsights.netWorth : netWorth
  const displayedLiquidCash = sharedInsights && !sharedInsights.loading ? sharedInsights.liquidBalance : liquidCash
  const displayedUpcomingOutflow = sharedInsights && !sharedInsights.loading ? sharedInsights.datedCommitments30Day : upcomingOutflow
  const safeToSpend = displayedLiquidCash - displayedUpcomingOutflow
  const nextMonthSafeToSpend = displayedLiquidCash - nextMonthOutflow
  const savingsRate = monthIncome > 0 ? ((monthIncome - monthExpenses) / monthIncome) * 100 : null
  const obligationBurden = displayedLiquidCash > 0 ? (displayedUpcomingOutflow / displayedLiquidCash) * 100 : null
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

  return <EditorialBoard {...{ navigate, insights: sharedInsights, netWorth: displayedNetWorth, liquidCash: displayedLiquidCash, upcomingOutflow: displayedUpcomingOutflow, nextMonthOutflow, emiOutflow, chittiOutflow, obligationBurden, monthIncome, monthExpenses, savingsRate, accounts, activeEmis, activeChittis, accountsLoaded, viewerId, recentTx, accountTab, setAccountTab, transactionTab, setTransactionTab, showMoreActivity, setShowMoreActivity, privacyMode, setPrivacyMode, rangeStart, rangeEnd, setRangeStart, setRangeEnd, cashFlowDays, cashFlowGranularity, selectedPeriod, maxFlowBar, safeToSpend, nextMonthSafeToSpend, nextMonthLabel, money, matchesQuickRange, setQuickRange, liquidAccounts, creditAccounts, visibleAccounts, composition, compositionTotal, filteredTransactions, shownTransactions }} />

}

function EditorialBoard(p: any) {
  const [netWorthView, setNetWorthView] = useState<'composition' | 'runway'>('composition')
  const [commitmentView, setCommitmentView] = useState<'monthly' | 'coverage'>('monthly')
  const [cashFlowMode, setCashFlowMode] = useState<'flow' | 'budget' | 'savings'>('flow')
  const [exposureFilter, setExposureFilter] = useState<'all' | 'receivable' | 'payable'>('all')
  const money = p.money as (n: number, d?: number) => string
  const group = 'ed-panel rounded-[1.35rem] border p-5 sm:p-6'
  const insights = p.insights
  const creditRows = (insights?.accounts || []).filter((account: any) => account.isCredit)
  const creditLimitTotal = creditRows.reduce((sum: number, account: any) => sum + Number(account.creditLimit || 0), 0)
  const creditOutstandingTotal = creditRows.reduce((sum: number, account: any) => sum + Number(account.creditOutstanding || 0), 0)
  const availableCreditTotal = creditRows.reduce((sum: number, account: any) => sum + Number(account.availableCredit || 0), 0)
  const aggregateCreditUtilization = creditLimitTotal > 0 ? creditOutstandingTotal / creditLimitTotal * 100 : null
  const liquidCommitment = Number(p.emiOutflow || 0) + Number(p.chittiOutflow || 0)
  const monthlySafeLeftover = Number(p.liquidCash || 0) - liquidCommitment
  const monthlyCommitmentShare = Number(p.liquidCash || 0) > 0 ? liquidCommitment / Number(p.liquidCash) * 100 : null
  const today = insights?.asOfDate || toIndiaDateInputValue()
  const horizon = new Date(`${today}T00:00:00Z`)
  horizon.setUTCDate(horizon.getUTCDate() + 30)
  const horizonDate = horizon.toISOString().slice(0, 10)
  const unassignedRows = (insights?.unassignedOccurrences || []) as Array<{ scheduleId: string; dueDate: string; amount: number }>
  const unassignedScheduleCount = new Set(unassignedRows.map(item => item.scheduleId)).size
  const unassignedDated30 = unassignedRows.filter(item => item.dueDate && item.dueDate >= today && item.dueDate <= horizonDate).reduce((sum, item) => sum + Number(item.amount || 0), 0)
  const undatedMonthlyEstimate = Number(insights?.unassignedUndatedMonthlyEstimate || 0)
  const coveredAccounts = ((insights?.accounts || []) as any[]).filter(account => account.isLiquid && Number(account.dated30DayDebits || 0) > 0)
  const linkedCoverageSufficient = coveredAccounts.length > 0 && coveredAccounts.every(account => Number(account.balanceAfterDated30DayDebits) >= 0)
  const accountKinds: Record<string, string> = { bank: 'Bank', cash: 'Cash', wallet: 'Wallet', credit: 'Credit card', credit_card: 'Credit card', pay_later: 'Pay later' }
  const accountViewRows = p.accountTab === 'chitti' ? p.activeChittis.map((item: any) => ({ id: item.id, name: item.name, type: 'chitti', balance: Number(item.monthly_installment), href: '/chittis' })) : p.visibleAccounts
  const accountInsightsById = new Map(((insights?.accounts || []) as any[]).map(account => [account.id, account]))
  const budgetRows = (insights?.budgets || []) as Array<{ categoryId: string; categoryName: string; spent: number; available: number; remaining: number; utilizationPercent: number; projectedMonthEnd: number; carryover: number }>
  const savingsGoalRows = (insights?.savingsGoals || []) as Array<{ id: string; name: string; progressPercent: number; targetGap: number; targetDate: string | null; requiredMonthlyContribution: number | null }>
  const cashFlowModes = [
    { key: 'flow', label: 'Flow' },
    ...(budgetRows.length ? [{ key: 'budget', label: 'Budget Pace' }] : []),
    ...(savingsGoalRows.length ? [{ key: 'savings', label: 'Saving Pace' }] : []),
  ]
  const activeCashFlowMode = cashFlowModes.some(mode => mode.key === cashFlowMode) ? cashFlowMode : 'flow'
  const budgetSpent = budgetRows.reduce((sum, row) => sum + row.spent, 0)
  const budgetAvailable = budgetRows.reduce((sum, row) => sum + row.available, 0)
  const budgetProjectedMonthEnd = budgetRows.reduce((sum, row) => sum + row.projectedMonthEnd, 0)
  const topBudgetRows = [...budgetRows].sort((a, b) => b.utilizationPercent - a.utilizationPercent).slice(0, 4)
  const requiredSavingsPace = savingsGoalRows.reduce((sum, goal) => sum + Number(goal.requiredMonthlyContribution || 0), 0)
  const savingsCapacity = Number(insights?.recentMonthlyNetSavings || 0)
  const counterparties = (insights?.counterparties || []).filter((party: any) => exposureFilter === 'all' || (exposureFilter === 'receivable' ? party.receivable > 0 : party.payable > 0))
  const shownFeeTotal = (p.shownTransactions || []).reduce((sum: number, tx: any) => sum + Number(tx.fee_amount || 0), 0)
  const nextOccurrenceFor = (scheduleId: string) => insights?.nextOccurrenceBySchedule?.[scheduleId]
  const emiDurationMonths = (item: any) => {
    if (item.start_date && item.end_date) {
      const [sy, sm] = item.start_date.slice(0, 7).split('-').map(Number)
      const [ey, em] = item.end_date.slice(0, 7).split('-').map(Number)
      return Math.max(1, (ey - sy) * 12 + em - sm + 1)
    }
    return Number(item.total_principal) > 0 && Number(item.amount) > 0 ? Math.ceil(Number(item.total_principal) / Number(item.amount)) : null
  }
  const scheduleRows = [
    ...p.activeChittis.map((item: any) => ({ ...item, scheduleType: 'Chitti', installment: Number(item.monthly_installment), paid: Number(item.months_paid || 0), duration: Number(item.duration_months || 0), remaining: Math.max(0, Number(item.duration_months || 0) - Number(item.months_paid || 0)), href: '/chittis', isChitti: true })),
    ...p.activeEmis.map((item: any) => {
      const duration = emiDurationMonths(item)
      const paid = item.owner_id === p.viewerId ? Number(item.owner_months_paid || 0) : Number(item.counterparty_months_paid || 0)
      return { ...item, scheduleType: 'Recurring EMI', installment: Number(item.amount), paid, duration, remaining: duration == null ? null : Math.max(0, duration - paid), href: '/calendar', isChitti: false }
    }),
  ]
  const focusAccountHref = (account: any) => account.href === '/chittis'
    ? '/chittis'
    : `/accounts?focus=${encodeURIComponent(account.id)}#account-${encodeURIComponent(account.id)}`
  const cashBars = p.cashFlowDays as CashFlowBucket[]
  const formatBucketLabel = (bucket: CashFlowBucket) => p.cashFlowGranularity === 'month'
    ? formatIndiaDate(`${bucket.start.slice(0, 7)}-15`, { month: 'short', year: '2-digit' })
    : formatIndiaDate(bucket.start, { month: 'short', day: 'numeric' })
  const bucketDescription = (bucket: CashFlowBucket) => bucket.start === bucket.end
    ? bucket.start
    : `${bucket.start} through ${bucket.end}`
  return <div className="page-shell dashboard-editorial mx-auto w-full max-w-[1500px] pb-32">
    <PageHeader eyebrow="RR CAPITAL · YOUR MONEY" title="Financial overview" description="A clear view of what you have, what is committed, and where it is going." icon={<TrendingUp />} />
    <PageGuidance page="/" />
    {p.accountsLoaded && p.accounts.length === 0 && <section className="dashboard-onboarding ed-panel mb-5 grid gap-5 rounded-[1.35rem] p-5 sm:grid-cols-[1fr_auto] sm:items-center sm:p-6">
      <div className="flex items-start gap-4"><span className="dashboard-onboarding-mark"><Landmark className="h-5 w-5" /></span><div><p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-accent-400">A clear start</p><h2 className="text-lg font-semibold text-[var(--ink)]">Add your first account</h2><p className="mt-1 max-w-xl text-sm leading-6 text-[var(--muted)]">Set a bank, wallet, cash, or credit line with its starting balance. Your dashboard fills in as you record activity.</p></div></div>
      <Link to="/accounts" className="dashboard-onboarding-link liquid-action inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold"><Landmark className="h-4 w-4" /> Create an account</Link>
    </section>}
    <div className="grid grid-cols-1 items-stretch gap-4 sm:gap-5 md:grid-cols-12">
      <section className="ed-networth dashboard-hero-card flex h-full min-h-0 flex-col md:col-span-5">
        <div className="flex shrink-0 items-start justify-between gap-3"><div><p className="ed-kicker">Your total net worth</p><p className="mt-1 text-sm opacity-70">Across your accounts and credit lines</p></div><button type="button" onClick={() => p.setPrivacyMode(!p.privacyMode)} className="ed-icon-button" aria-label={p.privacyMode ? 'Show balances' : 'Hide balances'}>{p.privacyMode ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}</button></div>
        <div className="ed-total mt-5">{money(p.netWorth, 2)}</div><div className="mt-1 text-xs opacity-65">Across {p.accounts.length} recorded accounts · latest balances</div>
        <LiquidGlassSwitcher activeKey={netWorthView} label="Net worth details" className="liquid-switcher--compact mt-3 w-full">
          <button type="button" {...liquidGlassItemProps('composition', netWorthView === 'composition', 'min-h-9 flex-1 justify-center px-3 text-center text-xs font-semibold')} aria-pressed={netWorthView === 'composition'} onClick={() => setNetWorthView('composition')}>Composition</button>
          <button type="button" {...liquidGlassItemProps('runway', netWorthView === 'runway', 'min-h-9 flex-1 justify-center px-3 text-center text-xs font-semibold')} aria-pressed={netWorthView === 'runway'} onClick={() => setNetWorthView('runway')}>Runway &amp; Credit</button>
        </LiquidGlassSwitcher>
        {netWorthView === 'composition' ? <div className="min-h-[70px]"><div className="ed-composition mt-3" aria-label="Balance composition">{p.compositionTotal > 0 ? p.composition.map((x: any) => <i key={x.label} title={x.label} style={{ width: `${Math.max(1, x.value / p.compositionTotal * 100)}%`, background: x.color }} />) : <i style={{ width: '100%' }} />}</div><div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">{p.composition.map((x: any) => <span key={x.label} className="ed-legend"><i style={{ background: x.color }} />{x.label}<b>{money(x.value)}</b></span>)}</div></div> : <div className="grid min-h-[70px] grid-cols-2 gap-3 py-2">
          <div><p className="flex items-center gap-1.5 text-[11px] opacity-65"><Gauge className="h-3.5 w-3.5" />Commitment-adjusted runway</p><p className="mt-1 text-lg font-semibold">{p.privacyMode ? '••••' : insights?.commitmentAdjustedRunwayDays == null ? '—' : `${insights.commitmentAdjustedRunwayDays.toFixed(0)} days`}</p><span className="text-[10px] opacity-60">{insights?.reserveMonths == null ? 'Reserve: —' : `Unadjusted reserve · ${insights.reserveMonths.toFixed(1)} months`}</span></div>
          <div><p className="flex items-center gap-1.5 text-[11px] opacity-65"><ShieldCheck className="h-3.5 w-3.5" />Credit line utilization</p><p className="mt-1 text-lg font-semibold">{creditRows.length === 0 || aggregateCreditUtilization == null ? '—' : p.privacyMode ? '•••' : `${aggregateCreditUtilization.toFixed(1)}%`}</p><span className="text-[10px] opacity-60">{creditRows.length === 0 ? 'No credit accounts' : `${money(p.privacyMode ? 0 : availableCreditTotal)} available headroom`}</span></div>
        </div>}
        <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('rr:transaction-draft', { detail: { type: 'transfer' } }))} className="ed-action mt-auto"><ArrowRightLeft className="h-4 w-4" /> Move money <ChevronRight className="ml-auto h-4 w-4" /></button>
      </section>
      <section className="ed-commitments dashboard-hero-card flex h-full min-h-0 flex-col md:col-span-7">
        <div className="flex shrink-0 items-start justify-between gap-3"><div><p className="ed-kicker">Commitments &amp; liquidity</p><p className="mt-1 text-sm opacity-70">Recurring outflow and dated account coverage</p></div><CalendarDays className="h-5 w-5 opacity-60" /></div>
        <LiquidGlassSwitcher activeKey={commitmentView} label="Commitments and liquidity views" className="liquid-switcher--compact mt-3 w-full">
          <button type="button" {...liquidGlassItemProps('monthly', commitmentView === 'monthly', 'min-h-9 flex-1 justify-center px-3 text-center text-xs font-semibold')} aria-pressed={commitmentView === 'monthly'} onClick={() => setCommitmentView('monthly')}>Monthly Buffer</button>
          <button type="button" {...liquidGlassItemProps('coverage', commitmentView === 'coverage', 'min-h-9 flex-1 justify-center px-3 text-center text-xs font-semibold')} aria-pressed={commitmentView === 'coverage'} onClick={() => setCommitmentView('coverage')}>Next Due &amp; Coverage</button>
        </LiquidGlassSwitcher>
        {commitmentView === 'monthly' ? <><div className="mt-4 grid gap-4 sm:grid-cols-2"><div><p className="text-xs opacity-65">Liquid balance</p><p className="ed-stat mt-1">{money(p.liquidCash)}</p></div><div><p className="text-xs opacity-65">This month · EMIs &amp; Chittis</p><p className="ed-stat mt-1">−{money(liquidCommitment)}</p></div></div>
          <div className="ed-forecast mt-4"><div><p className="text-xs opacity-65">Safe leftover this month</p><p className="mt-1 text-xl font-semibold">{money(monthlySafeLeftover)}</p><span className="text-[10px] opacity-60">{monthlyCommitmentShare === null ? 'Add a liquid account to compare' : `${monthlyCommitmentShare.toFixed(1)}% of liquid balance committed`}</span></div><div className="ed-forecast-next"><p className="text-xs opacity-65">Next month · {p.nextMonthLabel}</p><p className="mt-1 text-lg font-semibold">{money(p.nextMonthSafeToSpend)}</p><span>{money(p.nextMonthOutflow)} scheduled</span></div></div>
          <p className="mt-auto pt-2 text-[10px] opacity-60">Monthly schedule estimate; dated debits are shown in the coverage view.</p></> : <div className="mt-3 min-h-0 flex-1">
            <div className="flex items-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--surface)]/45 p-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[var(--brand-tint)] text-[var(--brand-primary-active)]"><Clock3 className="h-4 w-4" /></span><div className="min-w-0 flex-1"><p className="text-[10px] font-semibold uppercase tracking-wide opacity-60">Next dated due</p>{insights?.nextDatedOccurrence ? <><p className="truncate text-sm font-semibold">{insights.nextDatedOccurrence.name}</p><p className="text-[10px] opacity-65">{formatIndiaDate(insights.nextDatedOccurrence.dueDate)} · {insights.nextDatedOccurrence.status === 'UNCONFIRMED' ? 'Unconfirmed' : 'Scheduled'}</p></> : <p className="text-sm opacity-65">No upcoming dated installment found</p>}</div>{insights?.nextDatedOccurrence && <strong className="shrink-0 text-sm">{money(insights.nextDatedOccurrence.amount)}</strong>}<Link to="/calendar" className="ed-link shrink-0 text-[11px]">View schedule <ChevronRight className="h-3.5 w-3.5" /></Link></div>
            <div className="mt-3 flex items-center justify-between gap-2"><div><p className="text-[10px] font-semibold uppercase tracking-wide opacity-60">Dated 30-day coverage</p><p className={`mt-0.5 text-sm font-semibold ${linkedCoverageSufficient ? 'text-emerald-600' : coveredAccounts.length ? 'text-rose-500' : 'opacity-70'}`}>{coveredAccounts.length === 0 ? 'No linked liquid-account debits' : linkedCoverageSufficient ? 'Linked balances cover scheduled debits' : 'One or more accounts may fall short'}</p></div><span className="shrink-0 text-right text-xs font-semibold">{money(insights?.datedCommitments30Day || 0)} total</span></div>
            {coveredAccounts.length > 0 && <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">{coveredAccounts.slice(0, 2).map((account: any) => <div key={account.id} className="flex min-w-0 items-center justify-between gap-2 rounded-lg bg-[var(--surface)]/45 px-2.5 py-1.5 text-[10px]"><span className="truncate font-medium">{account.name}</span><span className={Number(account.balanceAfterDated30DayDebits) < 0 ? 'shrink-0 text-rose-500' : 'shrink-0 opacity-70'}>{money(account.dated30DayDebits)} due · {money(account.balanceAfterDated30DayDebits)} left</span></div>)}</div>}
            {(coveredAccounts.length > 2 || unassignedScheduleCount > 0) && <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[10px] opacity-70">{coveredAccounts.length > 2 && <span>+{coveredAccounts.length - 2} linked accounts</span>}{unassignedScheduleCount > 0 && <span className="font-semibold text-amber-700">Unassigned / Undated · {unassignedScheduleCount} schedules{unassignedDated30 || undatedMonthlyEstimate ? ` · ${money(unassignedDated30)} dated / ${money(undatedMonthlyEstimate)} monthly estimate` : ''}</span>}</div>}
          </div>}
      </section>      <div className="md:col-span-12 grid min-h-0 grid-cols-1 items-stretch gap-4 sm:gap-5 md:grid-cols-12">
      <section className="ed-chart dashboard-cash-flow-card flex min-h-0 flex-col overflow-hidden md:col-span-8"><div className="flex shrink-0 flex-col justify-between gap-3 lg:flex-row lg:items-center"><div><p className="ed-kicker">Cash flow · {p.selectedPeriod}</p><p className="mt-1 text-sm opacity-65">{p.cashFlowGranularity === 'day' ? 'Daily' : 'Monthly'} income and expenses · transfers excluded</p></div><div className="flex min-w-0 flex-wrap items-center gap-2 lg:justify-end"><LiquidGlassSwitcher activeKey={activeCashFlowMode} label="Cash flow analysis modes" className="liquid-switcher--compact min-w-0 flex-1 lg:flex-none">{cashFlowModes.map(mode => <button key={mode.key} type="button" {...liquidGlassItemProps(mode.key, activeCashFlowMode === mode.key, 'min-h-8 flex-1 justify-center px-2.5 text-center text-[11px] font-semibold sm:px-3')} aria-pressed={activeCashFlowMode === mode.key} onClick={() => setCashFlowMode(mode.key as typeof cashFlowMode)}>{mode.label}</button>)}</LiquidGlassSwitcher>{activeCashFlowMode === 'flow' && <Link className="ed-link shrink-0 text-xs" to={buildReportPath({ from: p.rangeStart, to: p.rangeEnd })}>Open report <ChevronRight className="h-4 w-4" /></Link>}</div></div>
        {activeCashFlowMode === 'flow' ? <div className="dashboard-cash-flow-body dashboard-card-scroll flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain"><div className="mt-4 grid shrink-0 grid-cols-2 gap-3 sm:grid-cols-4">{[['Income', p.monthIncome, 'income'], ['Expenses', p.monthExpenses, 'expense'], ['Net flow', p.monthIncome-p.monthExpenses, 'net']].map(([label,value,key]: any) => <div className="ed-metric" key={key}><span>{label}</span><b className={key}>{money(value)}</b></div>)}<div className="ed-metric ed-savings-metric"><div><span>Savings rate</span><b>{p.savingsRate === null ? '—' : `${p.savingsRate.toFixed(1)}%`}</b></div><span className="ed-savings-ring" style={{ '--savings-progress': `${Math.max(0, Math.min(100, p.savingsRate ?? 0))}%` } as React.CSSProperties} aria-hidden="true" /></div></div>
        {(() => { const options: [string, number | 'month' | 'year'][] = [['7 days',7],['30 days',30],['This month','month'],['This year','year']]; const active = options.find(([, value]) => p.matchesQuickRange(value)); const activeKey = String(active?.[1] ?? ''); return <LiquidGlassSwitcher activeKey={activeKey} label="Quick date ranges" className="liquid-switcher--compact mt-4 shrink-0 self-start">{options.map(([label,value]) => <button key={label} type="button" {...liquidGlassItemProps(String(value), activeKey === String(value))} aria-pressed={p.matchesQuickRange(value)} onClick={() => p.setQuickRange(value)}>{label}</button>)}</LiquidGlassSwitcher> })()}
        <div className="mt-3 grid shrink-0 grid-cols-2 gap-3 sm:max-w-md"><label className="ed-date">From<input type="date" value={p.rangeStart} max={p.rangeEnd} onChange={e => p.setRangeStart(e.target.value)} /></label><label className="ed-date">To<input type="date" value={p.rangeEnd} min={p.rangeStart} max={toIndiaDateInputValue()} onChange={e => p.setRangeEnd(e.target.value)} /></label></div>
        <div className="dashboard-card-scroll mt-3 min-h-[150px] flex-1 overflow-y-auto overscroll-contain"><div className="min-h-full flex flex-col">{cashBars.length ? <div className="ed-bars mt-1 flex-1" role="group" aria-label={`${p.cashFlowGranularity === 'day' ? 'Daily' : 'Monthly'} cash flow chart`}>{cashBars.map((bucket, i) => { const dates = { from: bucket.start, to: bucket.end }; const description = bucketDescription(bucket); return <div className="ed-bar-day" key={bucket.start} title={`${description}: income ${money(bucket.income)}, expenses ${money(bucket.expense)}`}><button aria-label={`View income entries ${bucket.start === bucket.end ? 'on' : 'from'} ${description}`} disabled={!bucket.income} onClick={() => p.navigate(buildReportPath({ ...dates, kind: 'income' }))}><i style={{ height: `${bucket.income ? Math.max(3, bucket.income / p.maxFlowBar * 100) : 0}%` }} /></button><button aria-label={`View expense entries ${bucket.start === bucket.end ? 'on' : 'from'} ${description}`} disabled={!bucket.expense} onClick={() => p.navigate(buildReportPath({ ...dates, kind: 'expense' }))}><i style={{ height: `${bucket.expense ? Math.max(3, bucket.expense / p.maxFlowBar * 100) : 0}%` }} /></button>{(i % Math.max(1, Math.ceil(cashBars.length/6)) === 0 || i === cashBars.length-1) && <small>{formatBucketLabel(bucket)}</small>}</div> })}</div> : <div className="ed-empty mt-5 flex-1">No completed income or expense entries in this period.</div>}<div className="mt-4 flex shrink-0 gap-4 text-xs opacity-65"><span className="ed-dot income-dot"/> Income <span className="ed-dot expense-dot"/> Expenses <span className="ml-auto">Select a bar to view matching report entries</span></div></div></div></div> : activeCashFlowMode === 'budget' ? <div className="dashboard-cash-flow-body dashboard-card-scroll mt-3 min-h-0 flex-1 overflow-y-auto overscroll-contain"><Link to="/budgets" className="block rounded-xl border border-[var(--line)] bg-[var(--surface)]/45 p-3 transition-colors hover:bg-[var(--surface)]/70"><div className="flex flex-wrap items-end justify-between gap-2"><div><p className="text-[10px] font-semibold uppercase tracking-wide opacity-60">Month-to-date category spend</p><p className="mt-1 text-xl font-bold">{money(budgetSpent)} <span className="text-xs font-medium opacity-65">of {money(budgetAvailable)} available · includes rollover</span></p></div><span className="ed-link shrink-0 text-xs">Open budgets <ChevronRight className="inline h-4 w-4" /></span></div><div className="mt-2 flex items-center justify-between gap-2 border-t border-[var(--line)] pt-2 text-xs"><span className="font-semibold">Projected Month-End Pace <span className="font-normal opacity-60">· estimate</span></span><strong>{money(budgetProjectedMonthEnd)}</strong></div></Link><div className="mt-2 space-y-2">{topBudgetRows.map(row => <Link key={row.categoryId} to="/budgets" className="block rounded-lg px-2 py-1.5 transition-colors hover:bg-[var(--surface)]/45"><div className="flex items-center justify-between gap-3 text-xs"><span className="min-w-0 truncate font-medium">{row.categoryName}</span><span className="shrink-0 opacity-70">{money(row.spent)} / {money(row.available)} · {row.utilizationPercent.toFixed(0)}%</span></div><div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--line)]"><div className="h-full rounded-full bg-[var(--brand-primary)]" style={{ width: `${Math.max(0, Math.min(100, row.utilizationPercent))}%` }} /></div><p className="mt-0.5 text-[10px] opacity-55">{money(row.remaining)} remaining{row.carryover > 0 ? ` · ${money(row.carryover)} rollover carryover` : ''}</p></Link>)}</div></div> : <div className="dashboard-cash-flow-body dashboard-card-scroll mt-3 min-h-0 flex-1 overflow-y-auto overscroll-contain"><Link to="/savings-goals" className="mb-2 block rounded-xl border border-[var(--line)] bg-[var(--surface)]/45 p-3 transition-colors hover:bg-[var(--surface)]/70"><div className="flex flex-wrap items-end justify-between gap-2"><div><p className="text-[10px] font-semibold uppercase tracking-wide opacity-60">Required monthly goal pace</p><p className="mt-1 text-xl font-bold">{money(requiredSavingsPace)}</p></div><span className={`text-xs font-semibold ${savingsCapacity >= requiredSavingsPace ? 'text-emerald-600' : 'text-amber-700'}`}>{savingsCapacity >= requiredSavingsPace ? 'Within recent savings capacity' : 'Above recent savings capacity'}</span></div><p className="mt-1 text-[10px] opacity-60">Recent eligible personal net savings: {money(savingsCapacity)} / month. Planning estimate; not deducted from liquid bank balances.</p></Link><div className="space-y-2">{savingsGoalRows.slice(0, 4).map(goal => <Link key={goal.id} to="/savings-goals" className="block rounded-lg px-2 py-1.5 transition-colors hover:bg-[var(--surface)]/45"><div className="flex items-center justify-between gap-3 text-xs"><span className="min-w-0 truncate font-semibold">{goal.name}</span><span className="shrink-0 opacity-70">{goal.progressPercent.toFixed(0)}% · {money(goal.targetGap)} to target</span></div><div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--line)]"><div className="h-full rounded-full bg-[var(--brand-primary)]" style={{ width: `${Math.max(0, Math.min(100, goal.progressPercent))}%` }} /></div><p className="mt-0.5 text-[10px] opacity-55">{goal.requiredMonthlyContribution == null ? 'No target date set' : `${money(goal.requiredMonthlyContribution)} / month required${goal.targetDate ? ` to ${formatIndiaDate(goal.targetDate)}` : ''}`}</p></Link>)}</div></div>}
      </section>
      <div className="relative min-h-0 md:col-span-4">
        <section className={`${group} dashboard-accounts-card flex max-h-[340px] min-h-[260px] flex-col overflow-hidden md:absolute md:inset-0 md:h-full md:max-h-none md:min-h-0`}>
          <div className="flex shrink-0 items-center justify-between"><div><p className="ed-kicker">Accounts</p><p className="mt-1 text-sm opacity-65">{p.accounts.length} accounts and credit lines</p></div><Link to="/accounts" className="ed-icon-button" aria-label="Manage accounts"><ChevronRight className="h-4 w-4" /></Link></div>
          <LiquidGlassSwitcher activeKey={p.accountTab} label="Account filters" className="liquid-switcher--compact mt-4 shrink-0 self-start">{[['all','All'],['liquid','Liquid'],['credit','Credit'],['chitti','Chittis']].map(([key,label]) => <button type="button" {...liquidGlassItemProps(key, p.accountTab===key)} role="tab" aria-selected={p.accountTab===key} key={key} onClick={() => p.setAccountTab(key)}>{label}</button>)}</LiquidGlassSwitcher>
          <div className="mt-3 min-h-0 flex-1 divide-y overflow-y-auto overscroll-contain pr-1 ed-divider dashboard-card-scroll">{accountViewRows.map((acc: any) => {
            const diagnostic = accountInsightsById.get(acc.id)
            const isChitti = acc.type === 'chitti'
            const href = focusAccountHref(acc)
            const diagnostics = isChitti ? [] : [
              diagnostic?.isLiquid && diagnostic.showNotices && diagnostic.belowMinimum ? <span key="low" className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-amber-700">Low balance</span> : null,
              diagnostic?.isCredit && diagnostic.creditLimit > 0 ? <span key="util" className="rounded-full bg-[var(--surface)] px-1.5 py-0.5 text-[9px] font-semibold opacity-75">{(diagnostic.creditUtilizationPercent ?? 0).toFixed(0)}% used</span> : null,
              diagnostic?.isCredit && diagnostic.showNotices && diagnostic.daysUntilDue != null ? <span key="due" className="rounded-full bg-rose-500/10 px-1.5 py-0.5 text-[9px] font-semibold text-rose-600">Due in {diagnostic.daysUntilDue}d</span> : null,
              diagnostic?.isCredit && diagnostic.showNotices && diagnostic.daysUntilStatement != null ? <span key="stmt" className="rounded-full bg-sky-500/10 px-1.5 py-0.5 text-[9px] font-semibold text-sky-700">Stmt in {diagnostic.daysUntilStatement}d</span> : null,
            ].filter(Boolean)
            return <Link to={href} key={acc.id} className="ed-account"><span className="ed-account-mark">{['bank','cash','wallet'].includes(acc.type) ? <Wallet className="h-4 w-4"/> : <CreditCard className="h-4 w-4"/>}</span><span className="min-w-0 flex-1"><b className="block truncate">{acc.name}</b><small>{accountKinds[acc.type] || (isChitti ? 'Active Chitti · monthly installment' : 'Account')}</small>{diagnostics.length > 0 && <span className="mt-1 flex flex-wrap gap-1">{diagnostics}</span>}</span><strong>{money(Number(acc.balance))}</strong></Link>
          })}{accountViewRows.length===0 && <div className="py-6 text-center text-sm opacity-60">No entries in this view.</div>}</div>
        </section>
      </div>
      </div>
      <div className="md:col-span-12 grid min-h-0 grid-cols-1 items-stretch gap-4 sm:gap-5 md:grid-cols-12">
      <section className={`${group} dashboard-fixed-list-card flex max-h-[360px] min-h-0 flex-col overflow-hidden md:col-span-7`}><div className="flex shrink-0 flex-col justify-between gap-3 sm:flex-row sm:items-center"><div><p className="ed-kicker">Recent activity</p><p className="mt-1 text-sm opacity-65">Latest recorded transactions</p></div><div className="flex items-center gap-2">{shownFeeTotal > 0 && <span className="rounded-full bg-amber-500/10 px-2.5 py-1 text-[10px] font-semibold text-amber-700">Fees {money(shownFeeTotal, 2)}</span>}<Link to="/ledger" className="ed-link">Open ledger <ChevronRight className="h-4 w-4"/></Link></div></div>
        <LiquidGlassSwitcher activeKey={p.transactionTab} label="Transaction filters" className="liquid-switcher--compact mt-4 shrink-0 self-start">{[['all','All'],['income','Income'],['expense','Expenses'],['transfer','Transfers']].map(([key,label])=><button type="button" {...liquidGlassItemProps(key, p.transactionTab===key)} role="tab" aria-selected={p.transactionTab===key} key={key} onClick={()=>p.setTransactionTab(key)}>{label}</button>)}</LiquidGlassSwitcher>
        <div className="mt-3 min-h-0 flex-1 divide-y overflow-y-auto overscroll-contain pr-1 ed-divider dashboard-card-scroll">{p.shownTransactions.map((tx:any)=>{const typeParam = encodeURIComponent(tx.type); const contactHref = tx.contact_id ? `/ledger?contact_id=${encodeURIComponent(tx.contact_id)}&type=${typeParam}` : tx.tagged_profile_id ? `/ledger?profile_id=${encodeURIComponent(tx.tagged_profile_id)}&type=${typeParam}` : null; const categoryHref = tx.category_id ? `/ledger?category_id=${encodeURIComponent(tx.category_id)}&type=${typeParam}` : null; return <div key={tx.id} className="ed-transaction"><span className={`ed-transaction-icon ${tx.type}`} aria-hidden="true">{tx.type==='income'?<ArrowDownLeft className="h-4 w-4"/>:tx.type==='expense'?<ArrowUpRight className="h-4 w-4"/>:<ArrowRightLeft className="h-4 w-4"/>}</span><span className="min-w-0 flex-1"><b className="block truncate">{tx.description || (tx.type==='transfer'?'Transfer':tx.type)}</b><small className="flex flex-wrap items-center gap-x-1">{formatIndiaDate(tx.created_at)}{contactHref && <><span>·</span><Link className="underline-offset-2 hover:underline" to={contactHref}>{tx.taggedName || 'Counterparty'}</Link></>}{categoryHref && <><span>·</span><Link className="underline-offset-2 hover:underline" to={categoryHref}>{tx.categoryName || 'Category'}</Link></>}</small></span><strong className={tx.type}>{tx.type==='expense'?'−':tx.type==='income'?'+':''}{money(Number(tx.amount),2)}</strong></div>})}{p.shownTransactions.length===0 && <div className="py-6 text-center text-sm opacity-60">No matching transactions found.</div>}</div>
        {p.filteredTransactions.length>5 && <button className="ed-show-more mt-3 shrink-0" onClick={()=>p.setShowMoreActivity(!p.showMoreActivity)}>{p.showMoreActivity?'Show fewer':'Show up to 25 recent entries'} <ChevronRight className={`h-4 w-4 ${p.showMoreActivity?'rotate-90':''}`}/></button>}
      </section>
      <section className="ed-panel dashboard-fixed-list-card flex max-h-[360px] min-h-0 flex-col overflow-hidden rounded-[1.35rem] border p-5 sm:p-6 md:col-span-5"><div className="flex shrink-0 items-start justify-between gap-2"><div><p className="ed-kicker">Counterparty Exposure</p><p className="mt-1 text-sm text-[var(--muted)]">Accepted, unsettled positions</p></div><div className="flex shrink-0 flex-col items-end gap-1.5"><Link to="/debts" className="ed-link">Debts &amp; IOUs <ChevronRight className="h-4 w-4"/></Link>{Number(insights?.pendingApprovalCount || 0) > 0 && <Link to="/notifications" className="rounded-full bg-rose-500/10 px-2 py-1 text-[9px] font-bold text-rose-600">{insights.pendingApprovalCount} Pending Approvals →</Link>}</div></div>
        <div className="mt-3 grid shrink-0 grid-cols-2 gap-2"><div className="rounded-xl border border-emerald-500/15 bg-emerald-500/5 px-3 py-2"><span className="block text-[9px] font-semibold uppercase tracking-wide opacity-60">Owed to You</span><strong className="mt-0.5 block text-sm text-emerald-700">{money(Number(insights?.receivableTotal || 0))}</strong></div><div className="rounded-xl border border-rose-500/15 bg-rose-500/5 px-3 py-2"><span className="block text-[9px] font-semibold uppercase tracking-wide opacity-60">You Owe</span><strong className="mt-0.5 block text-sm text-rose-600">{money(Number(insights?.payableTotal || 0))}</strong></div></div>
        <LiquidGlassSwitcher activeKey={exposureFilter} label="Counterparty exposure filters" className="liquid-switcher--compact mt-3 w-full shrink-0">{[['all','All'],['receivable','Owed to You'],['payable','You Owe']].map(([key,label])=><button key={key} type="button" {...liquidGlassItemProps(key, exposureFilter===key, 'min-h-8 flex-1 justify-center px-1.5 text-center text-[10px] font-semibold')} aria-pressed={exposureFilter===key} onClick={()=>setExposureFilter(key as typeof exposureFilter)}>{label}</button>)}</LiquidGlassSwitcher>
        <div className="dashboard-card-scroll mt-2 min-h-0 flex-1 divide-y overflow-y-auto overscroll-contain pr-1 ed-divider">{counterparties.map((party:any)=><div key={`${party.kind}-${party.id}`} className="flex min-h-[50px] items-center gap-2 py-2"><span className="min-w-0 flex-1"><b className="block truncate text-xs">{party.label}</b><small className="mt-0.5 block text-[9px] text-[var(--muted)]">{party.obligationCount} active obligation{party.obligationCount===1?'':'s'}</small></span><strong className={`shrink-0 text-xs ${party.net >= 0 ? 'text-emerald-700' : 'text-rose-600'}`}>{party.net >= 0 ? '+' : '−'}{money(Math.abs(Number(party.net || 0)))}</strong><Link to="/debts" className="shrink-0 rounded-lg border border-[var(--line)] px-2 py-1 text-[9px] font-semibold hover:bg-[var(--surface)]">View</Link></div>)}{counterparties.length===0 && <div className="py-5 text-center text-xs text-[var(--muted)]">No unsettled counterparties in this view.</div>}</div>
      </section>
      </div>
      <section className={`${group} dashboard-fixed-list-card flex max-h-[360px] min-h-0 flex-col overflow-hidden md:col-span-12`}><div className="flex shrink-0 items-center justify-between"><div><p className="ed-kicker">Schedules</p><p className="mt-1 text-sm opacity-65">Active Chittis and recurring EMIs · {money(p.upcomingOutflow)} this month</p></div><Link to="/calendar" className="ed-link">Calendar <ChevronRight className="h-4 w-4"/></Link></div>
        <div className="ed-commitment-summary mt-4 grid shrink-0 grid-cols-2 gap-2"><div><span>EMIs</span><strong>{money(p.emiOutflow)}</strong></div><div><span>Chittis</span><strong>{money(p.chittiOutflow)}</strong></div><div className="col-span-2"><span>Share of liquid balance</span><strong>{p.obligationBurden === null ? 'Add a liquid account to compare' : `${p.obligationBurden.toFixed(1)}%`}</strong></div></div>
        <div className="dashboard-card-scroll mt-3 min-h-0 flex-1 divide-y overflow-y-auto overscroll-contain pr-1 ed-divider">{scheduleRows.slice(0,8).map((item:any)=><div className="ed-schedule items-start" key={`${item.scheduleType}-${item.id}`}><span className="ed-schedule-mark mt-1"><CalendarDays className="h-4 w-4"/></span><span className="min-w-0 flex-1"><b className="block truncate">{item.name || item.scheduleType}</b><small>{item.paid}{item.duration == null ? ' paid' : ` / ${item.duration} paid`} · {item.remaining == null ? 'open-ended schedule' : `${item.remaining} installments left · est. ${money(item.remaining * item.installment)}`}</small>{item.isChitti && <span className="mt-1 flex flex-wrap items-center gap-1"><span className={`rounded-full px-1.5 py-0.5 text-[8px] font-bold ${Number(item.payout_received || 0) > 0 || item.received_month_number ? 'bg-violet-500/10 text-violet-700' : 'bg-[var(--surface)] text-[var(--muted)]'}`}>{Number(item.payout_received || 0) > 0 || item.received_month_number ? 'Prized / Payout Received' : 'Non-Prized'}</span><span className="text-[9px] text-[var(--muted)]">Paid contributions {money(item.paid * item.installment)}</span></span>}{(() => { const occurrence = nextOccurrenceFor(item.id); return <small className="mt-1 flex flex-wrap items-center gap-1">{occurrence ? <>Next {formatIndiaDate(occurrence.dueDate)} · {occurrence.status === 'UNCONFIRMED' ? 'Unconfirmed' : 'Scheduled'}</> : 'No upcoming dated occurrence'}<Link to={item.href} className="ml-1 font-semibold text-[var(--brand-primary)] hover:underline">{item.isChitti ? 'Chitti' : 'Calendar'} →</Link></small> })()}</span><strong className="pt-1">{money(Number(item.installment))}<small>/ month</small></strong></div>)}{!scheduleRows.length && <div className="py-6 text-center text-sm opacity-60">No active recurring schedules.</div>}</div>
      </section>
    </div>
  </div>
}

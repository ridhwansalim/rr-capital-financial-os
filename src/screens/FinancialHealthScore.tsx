import { useEffect, useMemo, useState } from 'react'
import { Info, Loader2, ShieldCheck } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { toIndiaDateInputValue, indiaDateStartToIso, indiaDateExclusiveEndToIso } from '../lib/financeDate'
import { isEligiblePersonalScoreTransaction, lastThreeCompleteMonths, scoreFinancialHealth, type FinancialHealthResult } from '../lib/financialHealth'
import PageHeader from '../components/PageHeader'

type TransactionRow = {
  id: string; amount: number; fee_amount: number | null; from_account_id: string | null; to_account_id: string | null
  tagged_profile_id: string | null; contact_id: string | null; description: string | null; status: string; created_at: string
}

const LIQUID_TYPES = new Set(['bank', 'cash', 'wallet'])
const CREDIT_TYPES = new Set(['credit', 'credit_card', 'pay_later'])
const percent = (value: number) => `${(value * 100).toFixed(1)}%`
const indiaMonthKey = (value: string) => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit' }).formatToParts(new Date(value))
  return `${parts.find(part => part.type === 'year')?.value}-${parts.find(part => part.type === 'month')?.value}`
}

export default function FinancialHealthScore() {
  const [result, setResult] = useState<FinancialHealthResult | null>(null)
  const [period, setPeriod] = useState<{ start: string; endExclusive: string; months: string[] } | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const today = useMemo(() => toIndiaDateInputValue(), [])

  useEffect(() => {
    let active = true
    const load = async () => {
      setLoading(true); setError('')
      try {
        const range = lastThreeCompleteMonths(today)
        setPeriod(range)
        const [excludedResult, accountResult] = await Promise.all([
          supabase.rpc('financial_health_excluded_transaction_ids'),
          supabase.from('accounts').select('id, type, credit_limit'),
        ])
        const { data: excludedRows, error: excludedError } = excludedResult
        if (excludedError) throw excludedError
        const excludedIds = new Set((excludedRows || []).map((row: { transaction_id: string }) => row.transaction_id))
        const { data: accounts, error: accountError } = accountResult
        if (accountError) throw accountError
        const ownAccounts = accounts || []
        const accountIds = new Set(ownAccounts.map(account => account.id))

        // The account balance summary and three-month ledger history are
        // independent after the owned account IDs are known.
        const rowsPromise = (async () => {
          const rows: TransactionRow[] = []
          const pageSize = 1000
          for (let offset = 0; ; offset += pageSize) {
            const { data, error: transactionError } = await supabase.from('transactions')
              .select('id, amount, fee_amount, from_account_id, to_account_id, tagged_profile_id, contact_id, description, status, created_at')
              .eq('status', 'COMPLETED')
              .gte('created_at', indiaDateStartToIso(range.start))
              .lt('created_at', indiaDateExclusiveEndToIso(range.endExclusive.slice(0, 10)))
              .order('created_at', { ascending: true }).range(offset, offset + pageSize - 1)
            if (transactionError) throw transactionError
            rows.push(...((data || []) as TransactionRow[]))
            if (!data || data.length < pageSize) break
          }
          return rows
        })()
        const balancePromise = ownAccounts.length
          ? supabase.from('account_balances').select('id, balance').in('id', [...accountIds])
          : Promise.resolve({ data: [], error: null })
        const [balanceResult, rows] = await Promise.all([balancePromise, rowsPromise])
        if (balanceResult.error) throw balanceResult.error
        const accountBalances = new Map<string, number>((balanceResult.data || []).map(balance => [balance.id, Number(balance.balance)]))

        const included = rows.filter(row => !excludedIds.has(row.id) && isEligiblePersonalScoreTransaction(row, accountIds))
        const monthly = new Map(range.months.map(month => [month, { income: 0, expenses: 0, entries: 0 }]))
        for (const row of included) {
          const month = indiaMonthKey(row.created_at)
          const totals = monthly.get(month)
          if (!totals) continue
          const amount = Number(row.amount)
          const ownFrom = Boolean(row.from_account_id && accountIds.has(row.from_account_id))
          const ownTo = Boolean(row.to_account_id && accountIds.has(row.to_account_id))
          if (!ownFrom && ownTo) totals.income += amount
          else if (ownFrom && !ownTo) totals.expenses += amount + Number(row.fee_amount || 0)
          else continue
          totals.entries++
        }
        if ([...monthly.values()].some(month => month.entries === 0)) {
          if (active) { setResult(null); setError('Not enough history yet. The score needs eligible personal entries in each of the last three complete months.') }
          return
        }
        const income = [...monthly.values()].reduce((sum, month) => sum + month.income, 0)
        const expenses = [...monthly.values()].reduce((sum, month) => sum + month.expenses, 0)
        const liquidBalance = ownAccounts.filter(account => LIQUID_TYPES.has(account.type)).reduce((sum, account) => sum + (accountBalances.get(account.id) || 0), 0)
        const creditAccounts = ownAccounts.filter(account => CREDIT_TYPES.has(account.type) && Number(account.credit_limit) > 0)
        const creditLimit = creditAccounts.reduce((sum, account) => sum + Number(account.credit_limit), 0)
        const creditOutstanding = creditAccounts.reduce((sum, account) => sum + Math.max(0, -(accountBalances.get(account.id) || 0)), 0)
        const nextResult = scoreFinancialHealth({ liquidBalance, monthlyExpenses: expenses / 3, income, expenses, creditOutstanding, creditLimit, hasCreditLine: creditAccounts.length > 0 })
        if (active) setResult(nextResult)
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Could not calculate the private score.')
      } finally { if (active) setLoading(false) }
    }
    void load()
    return () => { active = false }
  }, [today])

  return <div className="page-shell space-y-6">
    <PageHeader title="Financial wellness" description="A private, transparent indicator calculated from your personal recorded activity." />
    {loading ? <div className="flex min-h-48 items-center justify-center text-slate-400"><Loader2 className="mr-2 h-5 w-5 animate-spin" />Calculating from your records...</div>
      : error ? <div role="status" className="rounded-2xl border border-white/10 bg-white/5 p-6 text-slate-300">{error}</div>
      : result && <>
        <section className="surface-panel rounded-3xl border-emerald-400/15 bg-gradient-to-br from-emerald-500/10 to-white/[0.03] p-6 md:p-8">
          <div className="flex items-center gap-2 text-sm text-emerald-200"><ShieldCheck className="h-4 w-4" />Private wellness indicator</div>
          <div className="mt-3 flex items-end gap-2"><span className="text-6xl font-semibold tracking-tight">{result.score ?? '-'}</span>{result.score !== null && <span className="pb-2 text-slate-400">/ 100</span>}</div>
          <p className="mt-2 text-sm text-slate-400">Based on {result.applicableFactors} of 3 applicable factors | {period?.months[0]} through {period?.months[2]}</p>
          {result.score === null && <p className="mt-3 text-sm text-amber-200">At least two factors need enough personal data before a score can be shown.</p>}
        </section>
        <section className="grid gap-3 md:grid-cols-3">
          <Factor title="Reserve (40 points)" value={result.reserveMonths === null ? 'Not available' : `${result.reserveMonths.toFixed(2)} months`} detail={result.reserveMonths === null ? 'Needs eligible personal expenses.' : `Liquid balance covers ${result.reserveMonths.toFixed(2)} months of average recorded expenses.`} points={result.factors.reserve?.points} max={40} />
          <Factor title="Cash flow (35 points)" value={result.savingsRate === null ? 'Not available' : percent(result.savingsRate)} detail={result.savingsRate === null ? 'Needs eligible personal income.' : 'Three-month personal surplus as a share of personal income.'} points={result.factors.cashflow?.points} max={35} />
          <Factor title="Credit line (25 points)" value={result.utilization === null ? 'Not applicable' : percent(result.utilization)} detail={result.utilization === null ? 'No personal credit line with a recorded limit.' : 'Outstanding balance divided by recorded credit limit.'} points={result.factors.credit?.points} max={25} />
        </section>
      </>}
    <section className="surface-panel rounded-2xl p-5 text-sm text-slate-400">
      <h2 className="flex items-center gap-2 font-semibold text-slate-200"><Info className="h-4 w-4" />How this is calculated</h2>
      <p className="mt-2">Reserve rewards up to two months of coverage (40%). Cash flow maps the savings rate linearly from negative 20% (0 points) to positive 20% (35 points). Credit utilization contributes 25 times (1 minus utilization), clamped to 0 to 100%. With no credit line, points are normalized across available factors and coverage is shown.</p>
      <p className="mt-2">Only completed personal entries with no person tag or contact link are considered, for the last three complete months. The app also excludes linked obligation payments, recurring EMI payments, Chitti actions, transfers, shared or ambiguous entries, and offline items. This is not a credit score, lending assessment, or financial advice; it depends on what you recorded.</p>
    </section>
  </div>
}

function Factor({ title, value, detail, points, max }: { title: string; value: string; detail: string; points?: number; max: number }) {
  return <article className="surface-panel rounded-2xl p-5"><h2 className="text-sm font-semibold text-slate-300">{title}</h2><p className="mt-3 text-2xl font-semibold">{value}</p><p className="mt-2 min-h-10 text-xs leading-relaxed text-slate-400">{detail}</p><p className="mt-4 text-xs text-emerald-200">{points === undefined ? 'Not scored' : `${points.toFixed(1)} / ${max} points`}</p></article>
}

export type HealthFactor = { points: number; maxPoints: number; value: number }
export type FinancialHealthInputs = {
  liquidBalance: number
  monthlyExpenses: number
  income: number
  expenses: number
  creditOutstanding: number
  creditLimit: number
  hasCreditLine: boolean
}
export type FinancialHealthResult = {
  score: number | null
  applicableFactors: number
  reserveMonths: number | null
  savingsRate: number | null
  utilization: number | null
  factors: { reserve: HealthFactor | null; cashflow: HealthFactor | null; credit: HealthFactor | null }
  reason?: string
}

export type PersonalScoreTransaction = {
  status: string
  tagged_profile_id: string | null
  contact_id: string | null
  description: string | null
  from_account_id: string | null
  to_account_id: string | null
}

export function isEligiblePersonalScoreTransaction(row: PersonalScoreTransaction, accountIds: ReadonlySet<string>): boolean {
  if (row.status !== 'COMPLETED' || row.tagged_profile_id || row.contact_id) return false
  if (/^chitti\s+(claim|installment):/i.test(row.description || '')) return false
  const fromOwned = Boolean(row.from_account_id && accountIds.has(row.from_account_id))
  const toOwned = Boolean(row.to_account_id && accountIds.has(row.to_account_id))
  return fromOwned !== toOwned
    && (!row.from_account_id || fromOwned)
    && (!row.to_account_id || toOwned)
}

export function lastThreeCompleteMonths(today: string): { start: string; endExclusive: string; months: string[] } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) throw new Error('A valid local date is required.')
  const [year, month] = today.split('-').map(Number)
  const months: string[] = []
  for (let offset = 3; offset >= 1; offset--) {
    const date = new Date(Date.UTC(year, month - 1 - offset, 1))
    months.push(`${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`)
  }
  const end = new Date(Date.UTC(year, month - 1, 1)).toISOString().slice(0, 10)
  return { start: `${months[0]}-01`, endExclusive: end, months }
}

export function scoreFinancialHealth(input: FinancialHealthInputs): FinancialHealthResult {
  const finite = Object.values(input).filter((value): value is number => typeof value === 'number').every(Number.isFinite)
  if (!finite) return { score: null, applicableFactors: 0, reserveMonths: null, savingsRate: null, utilization: null, factors: { reserve: null, cashflow: null, credit: null }, reason: 'Some required totals could not be calculated.' }

  const reserveMonths = input.monthlyExpenses > 0 ? Math.max(0, input.liquidBalance) / input.monthlyExpenses : null
  const reserve = reserveMonths === null ? null : { points: Math.min(reserveMonths / 2, 1) * 40, maxPoints: 40, value: reserveMonths }
  const savingsRate = input.income > 0 ? (input.income - input.expenses) / input.income : null
  const cashflow = savingsRate === null ? null : { points: Math.max(0, Math.min(1, (savingsRate + 0.2) / 0.4)) * 35, maxPoints: 35, value: savingsRate }
  const utilization = input.hasCreditLine && input.creditLimit > 0
    ? Math.max(0, Math.min(1, input.creditOutstanding / input.creditLimit))
    : null
  const credit = utilization === null ? null : { points: 25 * (1 - utilization), maxPoints: 25, value: utilization }
  const factors = [reserve, cashflow, credit].filter((factor): factor is HealthFactor => factor !== null)
  const maxPoints = factors.reduce((sum, factor) => sum + factor.maxPoints, 0)
  const score = factors.length >= 2 && maxPoints > 0 ? Math.round(factors.reduce((sum, factor) => sum + factor.points, 0) / maxPoints * 100) : null
  return {
    score,
    applicableFactors: factors.length,
    reserveMonths,
    savingsRate,
    utilization,
    factors: { reserve, cashflow, credit },
    ...(score === null ? { reason: 'At least two factors need enough personal data before a score can be shown.' } : {}),
  }
}

import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { calculateBudgetPeriod } from './budgetMath'
import { nextMonthlyDueDate, type AccountHealthSetting } from './accountHealth'
import { indiaDateExclusiveEndToIso, indiaDateStartToIso, monthlyInstallmentDate, toIndiaDateInputValue } from './financeDate'
import { isEligiblePersonalScoreTransaction, lastThreeCompleteMonths, observedHistoryDays } from './financialHealth'
import { localDB, type LocalTransaction } from './db'
import { visibleOfflineItems } from './offlineOwnership'
import { supabase } from './supabase'
import type { FeatureFlags } from './optionalFeatures'
import { addIndiaCalendarDays as addIndiaDays, budgetTransactionWindow } from './dashboardInsightsMath'
import { syncAndroidDashboardWidget } from './dashboardWidget'
import { calculateWidgetMonthlyCommitments, calculateWidgetNetFlow30Day } from './dashboardWidgetMath'

export type ActionableAlert = { id: string; title: string; detail: string; href: string; kind: 'offline' | 'account' | 'commitment' | 'approval' }
export type DatedOccurrence = { id: string; scheduleId: string; name: string; kind: 'chitti' | 'emi'; dueDate: string; amount: number; accountId: string | null; status: string; href: string }
export type AccountInsight = {
  id: string; name: string; type: string; balance: number; isLiquid: boolean; isCredit: boolean
  minimumBalance: number | null; belowMinimum: boolean; showNotices: boolean; creditLimit: number; creditOutstanding: number
  creditUtilizationPercent: number | null; availableCredit: number | null; daysUntilStatement: number | null; daysUntilDue: number | null
  dated7DayDebits: number; dated30DayDebits: number; balanceAfterDated7DayDebits: number; balanceAfterDated30DayDebits: number
  coverage7Day: number | null; coverage30Day: number | null
}
export type CounterpartyExposure = { id: string; label: string; kind: 'profile' | 'contact' | 'unknown'; receivable: number; payable: number; net: number; obligationCount: number; settledAmount: number }
export type BudgetInsight = { categoryId: string; categoryName: string; spent: number; carryover: number; available: number; remaining: number; utilizationPercent: number; projectedMonthEnd: number; isEstimate: true }
export type SavingsGoalInsight = { id: string; name: string; targetAmount: number; savedAmount: number; progressPercent: number; targetGap: number; targetDate: string | null; requiredMonthlyContribution: number | null; recentMonthlyNetSavings: number; planningOnly: true }
export type OfflineInsight = { pendingCount: number; failedCount: number; lastAttemptAt: string | null; isOnline: boolean; items: LocalTransaction[] }
export type DashboardInsights = {
  loading: boolean; error: string | null; ownerId: string | null; asOfDate: string
  netWorth: number; liquidBalance: number; reserveMonths: number | null; eligibleMonthlyExpense: number; avgDailyEligiblePersonalExpense: number
  monthlyCommitmentsThisMonth: number; safeLeftoverThisMonth: number; netFlow30Day: number
  datedCommitments7Day: number; datedCommitments30Day: number; unassignedUndatedMonthlyEstimate: number
  datedOccurrences7Day: DatedOccurrence[]; datedOccurrences30Day: DatedOccurrence[]; nextDatedOccurrence: DatedOccurrence | null
  nextOccurrenceBySchedule: Record<string, DatedOccurrence>; unassignedOccurrences: DatedOccurrence[]
  commitmentAdjustedRunwayDays: number | null; accounts: AccountInsight[]; lowBalanceAccountCount: number; creditAccountCount: number
  receivableTotal: number; payableTotal: number; counterparties: CounterpartyExposure[]; confirmedSettlementTotal: number
  pendingApprovalCount: number; pendingApprovalItems: Array<{ id: string; label: string; amount: number; kind: string; totalBillAmount?: number | null }>
  budgets: BudgetInsight[]; savingsGoals: SavingsGoalInsight[]; recentMonthlyNetSavings: number | null
  offline: OfflineInsight; alerts: ActionableAlert[]; approvalCount: number; offlineCount: number
}

const emptyOffline = (): OfflineInsight => ({ pendingCount: 0, failedCount: 0, lastAttemptAt: null, isOnline: typeof navigator === 'undefined' ? true : navigator.onLine, items: [] })
const emptyInsights = (ownerId: string | null): DashboardInsights => ({
  loading: Boolean(ownerId), error: null, ownerId, asOfDate: toIndiaDateInputValue(), netWorth: 0, liquidBalance: 0, reserveMonths: null,
  monthlyCommitmentsThisMonth: 0, safeLeftoverThisMonth: 0, netFlow30Day: 0,
  eligibleMonthlyExpense: 0, avgDailyEligiblePersonalExpense: 0, datedCommitments7Day: 0, datedCommitments30Day: 0,
  unassignedUndatedMonthlyEstimate: 0, datedOccurrences7Day: [], datedOccurrences30Day: [], nextDatedOccurrence: null, nextOccurrenceBySchedule: {}, unassignedOccurrences: [],
  commitmentAdjustedRunwayDays: null, accounts: [], lowBalanceAccountCount: 0, creditAccountCount: 0, receivableTotal: 0, payableTotal: 0,
  counterparties: [], confirmedSettlementTotal: 0, pendingApprovalCount: 0, pendingApprovalItems: [], budgets: [], savingsGoals: [],
  recentMonthlyNetSavings: null, offline: emptyOffline(), alerts: [], approvalCount: 0, offlineCount: 0,
})

type TransactionRow = { id: string; amount: number; fee_amount: number | null; created_at: string; status: string; description: string | null; from_account_id: string | null; to_account_id: string | null; tagged_profile_id: string | null; contact_id: string | null; category_id: string | null }
type ScheduleRow = { id: string; name: string; status: string; start_date: string | null; end_date?: string | null; type?: string; amount?: number; monthly_installment?: number; duration_months?: number; months_paid?: number; account_id?: string | null; initiator_account_id?: string | null; owner_months_paid?: number; counterparty_months_paid?: number; owner_id?: string; counterparty_profile_id?: string | null }
type OccurrenceRow = { installment_number: number; due_date: string | null; amount: number; status: string }
type ObligationRow = { id: string; owner_id?: string; type?: string; creditor_profile_id: string | null; debtor_profile_id: string | null; shadow_contact_id: string | null; contact_id: string | null; profile_id: string | null; amount: number; total_amount: number | null; description: string | null; status: string }

function monthDays(date: string): number {
  const [year, month] = date.split('-').map(Number)
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}
function monthsUntilTarget(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number)
  const [ty, tm, td] = to.split('-').map(Number)
  const days = (Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000
  return Math.max(0, days / 30.4375)
}
function accountFlags(type: string) {
  const normalized = type.toLowerCase()
  return { liquid: ['bank', 'cash', 'wallet'].includes(normalized), credit: ['credit', 'credit_card', 'pay_later'].includes(normalized) }
}
function numeric(value: unknown): number { const n = Number(value); return Number.isFinite(n) ? n : 0 }
function money(value: number): string { return `₹${Math.round(value).toLocaleString('en-IN')}` }

async function fetchAllTransactions(ownerId: string, fromDate: string, toDate: string): Promise<TransactionRow[]> {
  const rows: TransactionRow[] = []
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.from('transactions')
      .select('id,amount,fee_amount,created_at,status,description,from_account_id,to_account_id,tagged_profile_id,contact_id,category_id')
      .eq('owner_id', ownerId).gte('created_at', indiaDateStartToIso(fromDate)).lt('created_at', indiaDateExclusiveEndToIso(toDate))
      .order('created_at').order('id').range(offset, offset + 999)
    if (error) throw error
    rows.push(...((data || []) as TransactionRow[]))
    if (!data || data.length < 1000) return rows
  }
}

async function fetchScheduleOccurrences(schedule: ScheduleRow, kind: 'CHITTI' | 'BANK_EMI', today: string): Promise<OccurrenceRow[]> {
  const { data, error } = await supabase.rpc('list_installment_occurrences', { p_schedule_kind: kind, p_schedule_id: schedule.id })
  if (!error && data?.length) {
    const rows = data as OccurrenceRow[]
    if (kind === 'BANK_EMI' && !schedule.end_date && schedule.start_date) {
      const nextNumber = numeric(schedule.owner_months_paid) + 1
      if (nextNumber <= 600 && !rows.some(item => item.installment_number >= nextNumber && item.due_date && item.due_date >= today)) {
        rows.push({ installment_number: nextNumber, due_date: monthlyInstallmentDate(schedule.start_date, nextNumber), amount: numeric(schedule.amount), status: 'SCHEDULED' })
      }
    }
    return rows
  }
  // Open-ended personal EMIs can lack a materialized occurrence row until the
  // tracking trigger runs. Derive only the next installment from its recorded
  // start date and paid count; never infer an account when none is assigned.
  if (kind === 'BANK_EMI' && !schedule.end_date && schedule.start_date) {
    const nextNumber = numeric(schedule.owner_months_paid) + 1
    if (nextNumber <= 600) return [{ installment_number: nextNumber, due_date: monthlyInstallmentDate(schedule.start_date, nextNumber), amount: numeric(schedule.amount), status: 'SCHEDULED' }]
  }
  return []
}

async function calculateInsights(ownerId: string, flags: FeatureFlags): Promise<DashboardInsights> {
  const today = toIndiaDateInputValue()
  const weekEnd = addIndiaDays(today, 7)
  const monthEndHorizon = addIndiaDays(today, 30)
  const { start: historyStart, endExclusive: historyEnd } = lastThreeCompleteMonths(today)
  const query = async <T,>(promise: PromiseLike<{ data: T | null; error: { message: string } | null }>): Promise<T> => {
    const { data, error } = await promise
    if (error) throw new Error(error.message)
    return (data || []) as T
  }

  const [accountRows, balanceRows, healthRows, chittiRows, emiRows, obligationRows, pendingObligations, pendingEmis, pendingSettlements, settlementRows, transactionRows, budgetRows, goalRows, contributionRows] = await Promise.all([
    query<any[]>(supabase.from('accounts').select('id,name,type,credit_limit,opening_date').order('name')),
    query<any[]>(supabase.from('account_balances').select('id,balance')),
    flags.account_health ? query<AccountHealthSetting[]>(supabase.from('account_health_settings').select('account_id,minimum_balance,statement_day,due_day,show_notices')) : Promise.resolve([]),
    query<ScheduleRow[]>(supabase.from('chittis').select('id,name,status,start_date,duration_months,monthly_installment,months_paid').eq('status', 'ACTIVE')),
    query<ScheduleRow[]>(supabase.from('recurring_emis').select('id,name,status,start_date,end_date,type,amount,account_id,initiator_account_id,owner_months_paid,counterparty_months_paid,owner_id,counterparty_profile_id').eq('status', 'ACTIVE').or(`owner_id.eq.${ownerId},counterparty_profile_id.eq.${ownerId}`)),
    query<ObligationRow[]>(supabase.from('obligations').select('id,owner_id,type,creditor_profile_id,debtor_profile_id,shadow_contact_id,contact_id,profile_id,amount,total_amount,description,status').or(`creditor_profile_id.eq.${ownerId},debtor_profile_id.eq.${ownerId}`).in('status', ['ACCEPTED', 'PENDING'])),
    query<any[]>(supabase.from('obligations').select('id,creditor_profile_id,debtor_profile_id,shadow_contact_id,contact_id,profile_id,amount,total_bill_amount,description').eq('status', 'PENDING_APPROVAL').neq('owner_id', ownerId).or(`creditor_profile_id.eq.${ownerId},debtor_profile_id.eq.${ownerId}`)),
    query<any[]>(supabase.from('recurring_emis').select('id,name,amount').eq('status', 'PENDING_APPROVAL').eq('counterparty_profile_id', ownerId)),
    query<any[]>(supabase.from('settlements').select('id,amount,obligation_id').eq('status', 'PENDING_APPROVAL').eq('counterparty_profile_id', ownerId)),
    query<any[]>(supabase.from('settlements').select('id,amount,obligation_id,initiator_id,counterparty_profile_id,status').eq('status', 'COMPLETED').or(`initiator_id.eq.${ownerId},counterparty_profile_id.eq.${ownerId}`)),
    fetchAllTransactions(ownerId, historyStart, today),
    flags.budgets ? query<any[]>(supabase.from('budget_envelopes').select('id,category_id,monthly_limit,rollover_enabled,created_at')) : Promise.resolve([]),
    flags.savings_goals ? query<any[]>(supabase.from('savings_goals').select('id,name,target_amount,target_date,created_at')) : Promise.resolve([]),
    flags.savings_goals ? query<any[]>(supabase.from('savings_goal_contributions').select('id,goal_id,amount,contributed_on')) : Promise.resolve([]),
  ])
  const monthlyCommitmentsThisMonth = calculateWidgetMonthlyCommitments(today, ownerId, chittiRows, emiRows)

  const balances = new Map<string, number>((balanceRows as any[]).map(row => [row.id, numeric(row.balance)]))
  const ownedAccountIds = new Set<string>((accountRows as any[]).map(row => row.id))
  const healthByAccount = new Map(healthRows.map(row => [row.account_id, row]))
  const pendingItems = [
    ...pendingObligations.map(row => ({ id: row.id, label: row.description || (row.total_bill_amount ? 'Split bill share' : 'Debt / IOU request'), amount: numeric(row.amount), kind: row.total_bill_amount ? 'split' : 'obligation', totalBillAmount: row.total_bill_amount == null ? null : numeric(row.total_bill_amount) })),
    ...pendingEmis.map(row => ({ id: row.id, label: row.name || 'Recurring EMI request', amount: numeric(row.amount), kind: 'emi' })),
    ...pendingSettlements.map(row => ({ id: row.id, label: 'Settlement confirmation', amount: numeric(row.amount), kind: 'settlement' })),
  ]

  const personalTransactions = transactionRows.filter(row => isEligiblePersonalScoreTransaction(row, ownedAccountIds))
  const recentStartIso = indiaDateStartToIso(historyStart)
  const recentEndIso = indiaDateStartToIso(historyEnd)
  const recentEligible = personalTransactions.filter(row => row.created_at >= recentStartIso && row.created_at < recentEndIso)
  const netFlow30Day = calculateWidgetNetFlow30Day(today, personalTransactions)
  const fullHistoryDays = observedHistoryDays(historyStart, historyEnd, [])
  const historyDays = observedHistoryDays(historyStart, historyEnd, (accountRows as any[]).map(row => row.opening_date))
  const historyExpenses = recentEligible.filter(row => row.from_account_id && !row.to_account_id).reduce((sum, row) => sum + numeric(row.amount) + numeric(row.fee_amount), 0)
  const avgDailyExpense = historyDays > 0 ? historyExpenses / historyDays : 0
  // Preserve the existing three-month average when the full window is
  // available, while scaling short tracked histories to the same month length.
  const averageMonthDays = fullHistoryDays / 3
  const eligibleMonthlyExpense = avgDailyExpense * averageMonthDays
  const recentIncome = recentEligible.filter(row => !row.from_account_id && row.to_account_id).reduce((sum, row) => sum + numeric(row.amount), 0)
  const recentNetSavings = recentIncome - historyExpenses
  const recentMonthlyNetSavings = historyDays > 0 ? (recentNetSavings / historyDays) * averageMonthDays : 0

  const scheduleJobs: Array<Promise<{ row: ScheduleRow; kind: 'chitti' | 'emi'; href: string; occurrences: OccurrenceRow[]; accountId: string | null }>> = []
  for (const chitti of chittiRows) {
    if (numeric(chitti.months_paid) >= numeric(chitti.duration_months)) continue
    scheduleJobs.push(fetchScheduleOccurrences(chitti, 'CHITTI', today).then(occurrences => ({ row: chitti, kind: 'chitti' as const, href: '/chittis', occurrences, accountId: null })))
  }
  for (const emi of emiRows) {
    if (emi.type === 'personal' && emi.owner_id === ownerId) {
      const paid = numeric(emi.owner_months_paid)
      scheduleJobs.push(fetchScheduleOccurrences(emi, 'BANK_EMI', today).then(occurrences => ({ row: emi, kind: 'emi' as const, href: '/calendar', occurrences: occurrences.filter(item => item.installment_number > paid), accountId: emi.initiator_account_id || emi.account_id || null })))
      continue
    }
    // In a peer EMI, only the debtor has an expected personal debit. Payment
    // account is selected during settlement, so this is deliberately unassigned.
    const isOwnerDebtor = emi.type === 'borrowed' && emi.owner_id === ownerId
    const isCounterpartyDebtor = emi.type === 'lent' && emi.counterparty_profile_id === ownerId
    if (!isOwnerDebtor && !isCounterpartyDebtor) continue
    if (!emi.start_date) continue
    const paid = isOwnerDebtor ? numeric(emi.owner_months_paid) : numeric(emi.counterparty_months_paid)
    const installment = paid + 1
    if (emi.end_date && monthlyInstallmentDate(emi.start_date, installment) > emi.end_date) continue
    scheduleJobs.push(Promise.resolve({ row: emi, kind: 'emi', href: '/calendar', accountId: null, occurrences: [{ installment_number: installment, due_date: monthlyInstallmentDate(emi.start_date, installment), amount: numeric(emi.amount), status: 'SCHEDULED' }] }))
  }
  const schedules = await Promise.all(scheduleJobs)
  const datedAll: DatedOccurrence[] = []
  const unassigned: DatedOccurrence[] = []
  const undatedMonthlyEstimate = new Map<string, { amount: number; kind: 'chitti' | 'emi'; href: string }>()
  for (const schedule of schedules) {
    const expectedAmount = schedule.kind === 'chitti' ? numeric(schedule.row.monthly_installment) : numeric(schedule.row.amount)
    const futureOccurrences = schedule.occurrences.filter(item => ['SCHEDULED', 'UNCONFIRMED'].includes(item.status) && (!schedule.row.end_date || !item.due_date || item.due_date <= schedule.row.end_date))
    if (!futureOccurrences.some(item => item.due_date)) {
      if (expectedAmount > 0) undatedMonthlyEstimate.set(schedule.row.id, { amount: expectedAmount, kind: schedule.kind, href: schedule.href })
      unassigned.push({ id: `undated-${schedule.kind}-${schedule.row.id}`, scheduleId: schedule.row.id, name: schedule.row.name, kind: schedule.kind, dueDate: '', amount: expectedAmount, accountId: schedule.accountId, status: 'UNASSIGNED_UNDATED', href: schedule.href })
      continue
    }
    for (const occurrence of futureOccurrences) {
      const date = occurrence.due_date
      if (!date || date < today) {
        if (!date && expectedAmount > 0) undatedMonthlyEstimate.set(schedule.row.id, { amount: expectedAmount, kind: schedule.kind, href: schedule.href })
        continue
      }
      if (schedule.kind === 'chitti' && occurrence.installment_number > numeric(schedule.row.duration_months)) continue
      if (schedule.kind === 'chitti' && occurrence.installment_number <= numeric(schedule.row.months_paid)) continue
      const datedOccurrence = { id: `${schedule.kind}-${schedule.row.id}-${occurrence.installment_number}`, scheduleId: schedule.row.id, name: schedule.row.name, kind: schedule.kind, dueDate: date, amount: numeric(occurrence.amount), accountId: schedule.accountId, status: occurrence.status, href: schedule.href }
      datedAll.push(datedOccurrence)
      if (!schedule.accountId) unassigned.push({ ...datedOccurrence, status: 'UNASSIGNED_ACCOUNT' })
    }
  }
  const in7 = datedAll.filter(item => item.dueDate >= today && item.dueDate <= weekEnd).sort((a,b) => a.dueDate.localeCompare(b.dueDate))
  const in30 = datedAll.filter(item => item.dueDate >= today && item.dueDate <= monthEndHorizon).sort((a,b) => a.dueDate.localeCompare(b.dueDate))
  const dated7Total = in7.reduce((sum, row) => sum + row.amount, 0)
  const dated30Total = in30.reduce((sum, row) => sum + row.amount, 0)
  // Keep a per-schedule next occurrence for the dashboard schedule list. The
  // 7/30-day arrays intentionally have a short horizon and cannot supply a
  // next date for schedules whose next installment falls later than 30 days.
  const nextOccurrenceBySchedule: Record<string, DatedOccurrence> = {}
  for (const occurrence of datedAll
    .filter(item => item.dueDate >= today)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))) {
    nextOccurrenceBySchedule[occurrence.scheduleId] ||= occurrence
  }
  const accountRowsInsights: AccountInsight[] = (accountRows as any[]).map(row => {
    const flags = accountFlags(row.type)
    const balance = balances.get(row.id) || 0
    const setting = healthByAccount.get(row.id)
    const creditLimit = numeric(row.credit_limit)
    const creditOutstanding = Math.max(0, -balance)
    const monthDebits = in30.filter(item => item.accountId === row.id).reduce((sum, item) => sum + item.amount, 0)
    const weekDebits = in7.filter(item => item.accountId === row.id).reduce((sum, item) => sum + item.amount, 0)
    const statement = flags.credit && setting?.statement_day != null ? nextMonthlyDueDate(setting.statement_day) : null
    const due = flags.credit && setting?.due_day != null ? nextMonthlyDueDate(setting.due_day) : null
    return {
      id: row.id, name: row.name, type: row.type, balance, isLiquid: flags.liquid, isCredit: flags.credit,
      minimumBalance: setting?.minimum_balance == null ? null : numeric(setting.minimum_balance),
      belowMinimum: flags.liquid && setting?.minimum_balance != null && balance < numeric(setting.minimum_balance),
      showNotices: setting?.show_notices === true,
      creditLimit, creditOutstanding, creditUtilizationPercent: flags.credit && creditLimit > 0 ? creditOutstanding / creditLimit * 100 : null,
      availableCredit: flags.credit ? Math.max(0, creditLimit - creditOutstanding) : null,
      daysUntilStatement: statement?.daysUntil ?? null, daysUntilDue: due?.daysUntil ?? null,
      dated7DayDebits: weekDebits, dated30DayDebits: monthDebits,
      balanceAfterDated7DayDebits: flags.liquid ? balance - weekDebits : 0,
      balanceAfterDated30DayDebits: flags.liquid ? balance - monthDebits : 0,
      coverage7Day: flags.liquid && weekDebits > 0 ? balance / weekDebits : flags.liquid ? null : null,
      coverage30Day: flags.liquid && monthDebits > 0 ? balance / monthDebits : flags.liquid ? null : null,
    }
  })
  const totalNetWorth = accountRowsInsights.reduce((sum, row) => sum + row.balance, 0)
  const liquidBalance = accountRowsInsights.filter(row => row.isLiquid).reduce((sum, row) => sum + row.balance, 0)

  const profileIds = [...new Set((obligationRows as ObligationRow[]).flatMap(row => [row.creditor_profile_id, row.debtor_profile_id]).filter((id): id is string => Boolean(id) && id !== ownerId))]
  const [contactsResult, profileLabelsResult] = await Promise.all([
    supabase.from('contacts').select('id,name'),
    profileIds.length ? supabase.rpc('profile_labels', { p_profile_ids: profileIds }) : Promise.resolve({ data: [], error: null }),
  ])
  const contactLabels = new Map((contactsResult.data || []).map((row: any) => [row.id, row.name]))
  const profileLabels = new Map(((profileLabelsResult.data || []) as any[]).map(row => [row.id, row.full_name || row.username || 'RR Capital member']))
  const exposureByParty = new Map<string, CounterpartyExposure>()
  for (const row of obligationRows as ObligationRow[]) {
    const ownerIsCreditor = row.creditor_profile_id === ownerId || (!row.creditor_profile_id && row.type === 'lent' && row.owner_id === ownerId)
    const partyId = row.shadow_contact_id || row.contact_id || row.profile_id || (ownerIsCreditor ? row.debtor_profile_id : row.creditor_profile_id)
    const kind: CounterpartyExposure['kind'] = row.shadow_contact_id || row.contact_id ? 'contact' : partyId ? 'profile' : 'unknown'
    const key = `${kind}:${partyId || row.id}`
    const item = exposureByParty.get(key) || { id: partyId || row.id, label: kind === 'contact' ? contactLabels.get(partyId) || 'Contact' : kind === 'profile' ? profileLabels.get(partyId) || 'RR Capital member' : 'Unlabeled counterparty', kind, receivable: 0, payable: 0, net: 0, obligationCount: 0, settledAmount: 0 }
    // Settlement approval atomically reduces obligations.amount to the remaining
    // balance. Use that live amount for exposure totals; completed settlements
    // below are attribution only and must not be subtracted a second time.
    const amount = Math.max(0, numeric(row.amount))
    if (ownerIsCreditor) item.receivable += amount; else item.payable += amount
    item.obligationCount += 1
    item.net = item.receivable - item.payable
    exposureByParty.set(key, item)
  }
  const completedSettlements = settlementRows as any[]
  const confirmedSettlementTotal = completedSettlements.reduce((sum, row) => sum + numeric(row.amount), 0)
  for (const settlement of completedSettlements) {
    const obligation = (obligationRows as ObligationRow[]).find(row => row.id === settlement.obligation_id)
    if (!obligation) continue
    const partyId = obligation.shadow_contact_id || obligation.contact_id || obligation.profile_id || (obligation.creditor_profile_id === ownerId ? obligation.debtor_profile_id : obligation.creditor_profile_id)
    const kind = obligation.shadow_contact_id || obligation.contact_id ? 'contact' : 'profile'
    const exposure = exposureByParty.get(`${kind}:${partyId || obligation.id}`)
    if (exposure) exposure.settledAmount += numeric(settlement.amount)
  }

  let budgetInsights: BudgetInsight[] = []
  if (flags.budgets && budgetRows.length) {
    const earliestBudget = (budgetRows as any[]).reduce((earliest, row) => {
      const date = toIndiaDateInputValue(new Date(row.created_at))
      return date < earliest ? date : earliest
    }, today)
    const budgetWindow = budgetTransactionWindow(earliestBudget, historyStart, today)
    const budgetTransactions = await fetchAllTransactions(ownerId, budgetWindow.fromDate, budgetWindow.toDateExclusive)
    const eligibleExpenseRows = budgetTransactions.filter(row => row.status === 'COMPLETED' && row.from_account_id && !row.to_account_id && !row.contact_id && !row.tagged_profile_id)
    const byEnvelope = new Map<string, Map<string, number>>()
    for (const envelope of budgetRows as any[]) {
      const monthly = new Map<string, number>()
      for (const tx of eligibleExpenseRows) {
        if (tx.category_id !== envelope.category_id) continue
        const month = toIndiaDateInputValue(new Date(tx.created_at)).slice(0, 7)
        monthly.set(month, (monthly.get(month) || 0) + numeric(tx.amount) + numeric(tx.fee_amount))
      }
      byEnvelope.set(envelope.id, monthly)
    }
    const categoryIds = [...new Set((budgetRows as any[]).map(row => row.category_id))]
    const { data: categories } = await supabase.from('transaction_categories').select('id,name').in('id', categoryIds)
    const categoryNames = new Map((categories || []).map((row: any) => [row.id, row.name]))
    const elapsedDays = Number(today.slice(8, 10))
    const daysInMonth = monthDays(today)
    budgetInsights = (budgetRows as any[]).map(envelope => {
      const createdDate = toIndiaDateInputValue(new Date(envelope.created_at))
      const configuredMonth = createdDate.slice(0, 7)
      const currentMonth = today.slice(0, 7)
      const period = calculateBudgetPeriod(numeric(envelope.monthly_limit), Boolean(envelope.rollover_enabled), byEnvelope.get(envelope.id) || new Map(), configuredMonth, currentMonth)
      return { categoryId: envelope.category_id, categoryName: categoryNames.get(envelope.category_id) || 'Category', ...period, utilizationPercent: period.available > 0 ? period.spent / period.available * 100 : 0, projectedMonthEnd: elapsedDays ? period.spent / elapsedDays * daysInMonth : period.spent, isEstimate: true }
    })
  }

  let savingsGoals: SavingsGoalInsight[] = []
  if (flags.savings_goals && goalRows.length) {
    const savedByGoal = new Map<string, number>()
    for (const contribution of contributionRows as any[]) savedByGoal.set(contribution.goal_id, (savedByGoal.get(contribution.goal_id) || 0) + numeric(contribution.amount))
    savingsGoals = (goalRows as any[]).map(goal => {
      const savedAmount = savedByGoal.get(goal.id) || 0
      const targetAmount = numeric(goal.target_amount)
      const targetGap = Math.max(0, targetAmount - savedAmount)
      const monthsLeft = goal.target_date ? monthsUntilTarget(today, goal.target_date) : 0
      return { id: goal.id, name: goal.name, targetAmount, savedAmount, progressPercent: targetAmount > 0 ? Math.min(100, savedAmount / targetAmount * 100) : 0, targetGap, targetDate: goal.target_date, requiredMonthlyContribution: goal.target_date ? monthsLeft > 0 ? targetGap / monthsLeft : targetGap : null, recentMonthlyNetSavings, planningOnly: true }
    })
  }

  const alerts: ActionableAlert[] = []
  if (flags.account_health) for (const account of accountRowsInsights) {
    const setting = healthByAccount.get(account.id)
    if (setting?.show_notices === false) continue
    if (account.belowMinimum) alerts.push({ id: `balance-${account.id}`, title: `${account.name} is below its minimum`, detail: `Balance ${money(account.balance)} · minimum ${money(account.minimumBalance || 0)}`, href: '/accounts', kind: 'account' })
    if (account.isCredit && account.daysUntilDue !== null && account.daysUntilDue <= 3) alerts.push({ id: `credit-due-${account.id}`, title: `${account.name} payment due ${account.daysUntilDue === 0 ? 'today' : `in ${account.daysUntilDue} days`}`, detail: `Outstanding ${money(account.creditOutstanding)}${account.creditUtilizationPercent == null ? '' : ` · ${account.creditUtilizationPercent.toFixed(0)}% utilized`}`, href: '/accounts', kind: 'account' })
    if (account.isCredit && account.daysUntilStatement !== null && account.daysUntilStatement <= 3) alerts.push({ id: `credit-statement-${account.id}`, title: `${account.name} statement date is near`, detail: `Statement in ${account.daysUntilStatement} day${account.daysUntilStatement === 1 ? '' : 's'}`, href: '/accounts', kind: 'account' })
  }
  for (const occurrence of datedAll.filter(item => item.dueDate >= today && item.dueDate <= addIndiaDays(today, 3))) alerts.push({ id: `commitment-${occurrence.id}`, title: `${occurrence.name} installment due soon`, detail: `${money(occurrence.amount)} · ${occurrence.dueDate}`, href: occurrence.href, kind: 'commitment' })
  if (pendingItems.length) alerts.push({ id: 'pending-approvals', title: `${pendingItems.length} request${pendingItems.length === 1 ? '' : 's'} awaiting your response`, detail: 'Review approvals and settlement requests.', href: '/notifications', kind: 'approval' })

  const unassignedMonthly = [...undatedMonthlyEstimate.values()].reduce((sum, item) => sum + item.amount, 0)
  return {
    loading: false, error: null, ownerId, asOfDate: today, netWorth: totalNetWorth, liquidBalance,
    monthlyCommitmentsThisMonth, safeLeftoverThisMonth: liquidBalance - monthlyCommitmentsThisMonth, netFlow30Day,
    reserveMonths: eligibleMonthlyExpense > 0 ? Math.max(0, liquidBalance) / eligibleMonthlyExpense : null,
    eligibleMonthlyExpense, avgDailyEligiblePersonalExpense: avgDailyExpense, datedCommitments7Day: dated7Total,
    datedCommitments30Day: dated30Total, unassignedUndatedMonthlyEstimate: unassignedMonthly,
    datedOccurrences7Day: in7, datedOccurrences30Day: in30,
    nextOccurrenceBySchedule,
    nextDatedOccurrence: datedAll.filter(item => item.dueDate >= today).sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0] || null,
    unassignedOccurrences: unassigned,
    commitmentAdjustedRunwayDays: avgDailyExpense > 0 ? Math.max(0, liquidBalance - dated30Total) / avgDailyExpense : null,
    accounts: accountRowsInsights, lowBalanceAccountCount: accountRowsInsights.filter(row => row.belowMinimum).length,
    creditAccountCount: accountRowsInsights.filter(row => row.isCredit).length,
    receivableTotal: [...exposureByParty.values()].reduce((sum, row) => sum + row.receivable, 0),
    payableTotal: [...exposureByParty.values()].reduce((sum, row) => sum + row.payable, 0),
    counterparties: [...exposureByParty.values()].filter(row => row.receivable || row.payable).sort((a,b) => (b.receivable + b.payable) - (a.receivable + a.payable)),
    confirmedSettlementTotal, pendingApprovalCount: pendingItems.length, pendingApprovalItems: pendingItems,
    budgets: budgetInsights, savingsGoals, recentMonthlyNetSavings: flags.savings_goals ? recentMonthlyNetSavings : null,
    offline: emptyOffline(), alerts, approvalCount: pendingItems.length, offlineCount: 0,
  }
}

export const DashboardInsightsContext = createContext<DashboardInsights | null>(null)
export function useDashboardInsightsContext(): DashboardInsights | null { return useContext(DashboardInsightsContext) }

export function useDashboardInsights(ownerId: string | null, flags: FeatureFlags = {}): DashboardInsights {
  const outboxRows = useLiveQuery(async () => {
    if (!ownerId) return []
    try { return await localDB.outbox.where('owner_id').equals(ownerId).toArray() } catch { return [] }
  }, [ownerId], [] as LocalTransaction[])
  const [isOnline, setIsOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine)
  const [serverData, setServerData] = useState<DashboardInsights>(() => emptyInsights(ownerId))
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    const updateOnline = () => setIsOnline(navigator.onLine)
    const refresh = () => setRevision(value => value + 1)
    window.addEventListener('online', updateOnline); window.addEventListener('offline', updateOnline)
    window.addEventListener('focus', refresh); window.addEventListener('rr:financial-data-changed', refresh); window.addEventListener('rr:features-changed', refresh)
    const timer = window.setInterval(refresh, 60_000)
    return () => { window.removeEventListener('online', updateOnline); window.removeEventListener('offline', updateOnline); window.removeEventListener('focus', refresh); window.removeEventListener('rr:financial-data-changed', refresh); window.removeEventListener('rr:features-changed', refresh); window.clearInterval(timer) }
  }, [])
  const visibleOutbox = useMemo(() => visibleOfflineItems(outboxRows, ownerId), [outboxRows, ownerId])
  const offline = useMemo<OfflineInsight>(() => ({
    pendingCount: visibleOutbox.filter(item => item.sync_status === 'pending').length,
    failedCount: visibleOutbox.filter(item => item.sync_status === 'failed').length,
    lastAttemptAt: visibleOutbox.map(item => item.last_attempt_at).filter((value): value is string => Boolean(value)).sort().slice(-1)[0] || null,
    isOnline, items: visibleOutbox,
  }), [visibleOutbox, isOnline])
  useEffect(() => {
    let active = true
    const userId = ownerId
    if (!userId) return
    void calculateInsights(userId, flags).then(result => { if (active) setServerData(result) }).catch(error => {
      if (active) setServerData({ ...emptyInsights(userId), loading: false, error: error instanceof Error ? error.message : 'Could not refresh financial insights.' })
    })
    return () => { active = false }
  }, [ownerId, flags, revision])
  const ownerScopedData = serverData.ownerId === ownerId ? serverData : emptyInsights(ownerId)
  const result = useMemo(() => ({ ...ownerScopedData, offline, offlineCount: offline.pendingCount + offline.failedCount, alerts: [
    ...offline.items.map(item => ({ id: `offline-${item.id ?? item.request_id ?? item.created_at}`, title: item.sync_status === 'failed' ? 'Offline transaction needs attention' : 'Transaction waiting to sync', detail: item.description || money(numeric(item.amount)), href: '/offline', kind: 'offline' as const })),
    ...ownerScopedData.alerts.filter(alert => alert.kind !== 'offline'),
  ] }), [ownerScopedData, offline])
  useEffect(() => {
    // Keep the last good widget snapshot while an authenticated owner's data is
    // hydrating or temporarily unavailable. Only clear it on an actual sign-out.
    if (ownerId && (result.loading || result.error)) return
    const nextDue = result.nextDatedOccurrence
    void syncAndroidDashboardWidget({
      signedIn: Boolean(ownerId),
      netWorth: result.netWorth,
      safeLeftover: result.safeLeftoverThisMonth,
      netFlow30Day: result.netFlow30Day,
      nextDueName: nextDue?.name || 'No upcoming due',
      nextDueDate: nextDue?.dueDate || '',
      nextDueAmount: nextDue?.amount ?? null,
    })
  }, [ownerId, result])
  return result
}

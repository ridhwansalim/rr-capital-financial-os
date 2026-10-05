import { formatIndiaDateInputValue, indiaDateExclusiveEndToIso, indiaDateStartToIso, monthlyInstallmentDate, toIndiaDateInputValue } from './financeDate.ts'
import { addIndiaCalendarDays } from './dashboardInsightsMath.ts'

export type WidgetChittiSchedule = {
  status?: string | null
  start_date: string | null
  duration_months?: number | null
  months_paid?: number | null
  monthly_installment?: number | null
}

export type WidgetEmiSchedule = {
  status?: string | null
  start_date: string | null
  end_date?: string | null
  amount?: number | null
  type?: string | null
  owner_id?: string | null
  counterparty_profile_id?: string | null
  owner_months_paid?: number | null
  counterparty_months_paid?: number | null
}

type WidgetFlowRow = {
  created_at: string
  from_account_id: string | null
  to_account_id: string | null
  amount: number
  fee_amount?: number | null
}

function finite(value: number | null | undefined): number {
  return Number.isFinite(Number(value)) ? Number(value) : 0
}

function installmentNumberForMonth(today: string, startDate: string | null, paidCount: number, endDate?: string | null, duration?: number | null): number {
  if (!startDate) return 0
  const start = formatIndiaDateInputValue(startDate)
  const [startYear, startMonth] = start.split('-').map(Number)
  const [year, month] = today.split('-').map(Number)
  const installment = (year - startYear) * 12 + month - startMonth + 1
  if (installment < 1 || installment <= paidCount || (duration != null && installment > duration)) return 0
  const dueDate = monthlyInstallmentDate(start, installment)
  if (dueDate.slice(0, 7) !== today.slice(0, 7) || (endDate && dueDate > formatIndiaDateInputValue(endDate))) return 0
  return installment
}

export function calculateWidgetMonthlyCommitments(
  today: string,
  ownerId: string,
  chittis: WidgetChittiSchedule[],
  emis: WidgetEmiSchedule[]
): number {
  let total = 0
  for (const chitti of chittis) {
    if (chitti.status && chitti.status !== 'ACTIVE') continue
    if (finite(chitti.months_paid) >= finite(chitti.duration_months)) continue
    if (installmentNumberForMonth(today, chitti.start_date, finite(chitti.months_paid), null, chitti.duration_months)) {
      total += finite(chitti.monthly_installment)
    }
  }
  for (const emi of emis) {
    if (emi.status && emi.status !== 'ACTIVE') continue
    const isOwedByOwner = (emi.type === 'personal' && emi.owner_id === ownerId)
      || (emi.type === 'borrowed' && emi.owner_id === ownerId)
      || (emi.type === 'lent' && emi.counterparty_profile_id === ownerId)
    if (!isOwedByOwner) continue
    const paid = emi.type === 'lent' ? finite(emi.counterparty_months_paid) : finite(emi.owner_months_paid)
    if (installmentNumberForMonth(today, emi.start_date, paid, emi.end_date)) total += finite(emi.amount)
  }
  return total
}

export function calculateWidgetNetFlow30Day(today: string, rows: WidgetFlowRow[]): number {
  const start = indiaDateStartToIso(addIndiaCalendarDays(today, -29))
  const end = indiaDateExclusiveEndToIso(today)
  return rows.reduce((total, row) => {
    if (!row.created_at || row.created_at < start || row.created_at >= end) return total
    const date = toIndiaDateInputValue(new Date(row.created_at))
    if (date < addIndiaCalendarDays(today, -29) || date > today) return total
    if (!row.from_account_id && row.to_account_id) return total + finite(row.amount)
    if (row.from_account_id && !row.to_account_id) return total - finite(row.amount) - finite(row.fee_amount)
    return total
  }, 0)
}

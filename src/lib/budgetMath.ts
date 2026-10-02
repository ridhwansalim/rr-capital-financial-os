export type BudgetPeriodSummary = {
  spent: number
  carryover: number
  available: number
  remaining: number
}

function monthIndex(value: string): number {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(value)
  if (!match) throw new Error('Budget month must use YYYY-MM format.')
  return Number(match[1]) * 12 + Number(match[2]) - 1
}

const toCents = (value: number) => Math.round(value * 100)
const fromCents = (value: number) => value / 100

export function calculateBudgetPeriod(
  monthlyLimit: number,
  rolloverEnabled: boolean,
  spentByMonth: ReadonlyMap<string, number>,
  configuredMonth: string,
  selectedMonth: string,
): BudgetPeriodSummary {
  const start = monthIndex(configuredMonth)
  const selected = monthIndex(selectedMonth)
  if (!Number.isFinite(monthlyLimit) || monthlyLimit <= 0) throw new Error('Budget amount must be positive.')

  let carryCents = 0
  if (rolloverEnabled) {
    for (let cursor = start; cursor < selected; cursor++) {
      const year = Math.floor(cursor / 12)
      const month = String(cursor % 12 + 1).padStart(2, '0')
      const periodSpent = toCents(spentByMonth.get(`${year}-${month}`) || 0)
      carryCents = Math.max(0, toCents(monthlyLimit) + carryCents - periodSpent)
    }
  }

  const year = Math.floor(selected / 12)
  const month = String(selected % 12 + 1).padStart(2, '0')
  const spentCents = toCents(spentByMonth.get(`${year}-${month}`) || 0)
  const availableCents = toCents(monthlyLimit) + carryCents
  return {
    spent: fromCents(spentCents),
    carryover: fromCents(carryCents),
    available: fromCents(availableCents),
    remaining: fromCents(availableCents - spentCents),
  }
}

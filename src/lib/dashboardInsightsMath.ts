export function addIndiaCalendarDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)
}

export function budgetTransactionWindow(earliestBudget: string, historyStart: string, today: string) {
  return {
    fromDate: earliestBudget < historyStart ? earliestBudget : historyStart,
    // The query end is exclusive. Advancing one India calendar day includes
    // all transactions dated today without mixing today into completed-month
    // spending averages.
    toDateExclusive: addIndiaCalendarDays(today, 1),
  }
}

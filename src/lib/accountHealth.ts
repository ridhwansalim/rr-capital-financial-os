export interface AccountHealthSetting {
  account_id: string
  minimum_balance: number | null
  statement_day: number | null
  due_day: number | null
  show_notices: boolean
}

function indiaToday(now: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(now)
  const value = (type: string) => Number(parts.find(part => part.type === type)?.value)
  return { year: value('year'), month: value('month'), day: value('day') }
}

export function nextMonthlyDueDate(day: number, now = new Date()) {
  if (!Number.isInteger(day) || day < 1 || day > 31) return null
  const today = indiaToday(now)
  let year = today.year
  let monthIndex = today.month - 1
  const maxDay = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
  let dueDay = Math.min(day, maxDay(year, monthIndex))
  if (dueDay < today.day) {
    monthIndex += 1
    if (monthIndex > 11) { monthIndex = 0; year += 1 }
    dueDay = Math.min(day, maxDay(year, monthIndex))
  }
  const daysUntil = Math.round((Date.UTC(year, monthIndex, dueDay) - Date.UTC(today.year, today.month - 1, today.day)) / 86400000)
  return { year, month: monthIndex + 1, day: dueDay, daysUntil }
}

export function formatDueDate(date: NonNullable<ReturnType<typeof nextMonthlyDueDate>>) {
  const value = new Date(Date.UTC(date.year, date.month - 1, date.day))
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(value)
}

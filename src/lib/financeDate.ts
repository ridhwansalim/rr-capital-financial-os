const FINANCIAL_TIME_ZONE = 'Asia/Kolkata'

export function formatIndiaDate(value: string | Date, options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }): string {
  const dateOnly = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  const instant = value instanceof Date ? value : new Date(dateOnly ? `${value}T12:00:00+05:30` : value)
  if (!Number.isFinite(instant.getTime())) return ''
  return new Intl.DateTimeFormat('en-IN', { ...options, timeZone: FINANCIAL_TIME_ZONE }).format(instant)
}

export function formatIndiaDateTime(value: string | Date): string {
  return formatIndiaDate(value, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export function formatIndiaDateInputValue(value: string | Date): string {
  return toIndiaDateInputValue(value instanceof Date ? value : new Date(value))
}

export function toIndiaDateInputValue(value: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: FINANCIAL_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(value)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value || ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

export function indiaDateInputToIso(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error('Choose a valid occurrence date.')
  }
  const instant = new Date(`${value}T12:00:00+05:30`)
  if (!Number.isFinite(instant.getTime()) || toIndiaDateInputValue(instant) !== value) {
    throw new Error('Choose a valid occurrence date.')
  }
  return instant.toISOString()
}

export function indiaDateStartToIso(value: string): string {
  indiaDateInputToIso(value)
  return new Date(`${value}T00:00:00+05:30`).toISOString()
}

export function indiaDateExclusiveEndToIso(value: string): string {
  indiaDateInputToIso(value)
  const [year, month, day] = value.split('-').map(Number)
  const nextDate = new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10)
  return indiaDateStartToIso(nextDate)
}

export function isDateBeforeOpeningDate(date: string, openingDate?: string | null): boolean {
  return Boolean(openingDate && /^\d{4}-\d{2}-\d{2}$/.test(openingDate) && date < openingDate)
}

export function isAccountOpenForOccurrence(openingDate?: string | null, occurrence?: string | null): boolean {
  if (!openingDate) return true
  if (!/^\d{4}-\d{2}-\d{2}$/.test(openingDate) || !occurrence) return false

  const parsedOpening = new Date(`${openingDate}T00:00:00Z`)
  if (!Number.isFinite(parsedOpening.getTime()) || parsedOpening.toISOString().slice(0, 10) !== openingDate) return false

  let occurrenceDay = occurrence
  if (!/^\d{4}-\d{2}-\d{2}$/.test(occurrence)) {
    const instant = new Date(occurrence)
    if (!Number.isFinite(instant.getTime())) return false
    occurrenceDay = toIndiaDateInputValue(instant)
  }
  const parsedOccurrence = new Date(`${occurrenceDay}T00:00:00Z`)
  if (!Number.isFinite(parsedOccurrence.getTime()) || parsedOccurrence.toISOString().slice(0, 10) !== occurrenceDay) return false
  return occurrenceDay >= openingDate
}

export function openingBalanceForAccountType(value: string, type: string): number {
  const normalized = value.trim()
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) {
    throw new Error('Enter an opening balance with at most two decimal places.')
  }
  const amount = Number(normalized)
  if (!Number.isFinite(amount) || amount > 9_999_999_999.99) {
    throw new Error('Opening balance is outside the supported range.')
  }
  return type === 'credit' || type === 'credit_card' || type === 'pay_later' ? -amount : amount
}

export function monthlyInstallmentDate(startDate: string, installmentNumber: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !Number.isInteger(installmentNumber) || installmentNumber < 1 || installmentNumber > 600) {
    throw new Error('Choose a valid installment schedule date.')
  }
  const [year, month, day] = startDate.split('-').map(Number)
  const start = new Date(Date.UTC(year, month - 1, day))
  if (year < 100 || year > 9999 || start.toISOString().slice(0, 10) !== startDate) {
    throw new Error('Choose a valid installment schedule date.')
  }
  const targetMonth = month - 1 + installmentNumber - 1
  const targetYear = year + Math.floor(targetMonth / 12)
  if (targetYear > 9999) throw new Error('Installment date is outside the supported range.')
  const normalizedMonth = targetMonth % 12
  const lastDay = new Date(Date.UTC(targetYear, normalizedMonth + 1, 0)).getUTCDate()
  const occurrence = new Date(Date.UTC(targetYear, normalizedMonth, Math.min(day, lastDay)))
  return occurrence.toISOString().slice(0, 10)
}

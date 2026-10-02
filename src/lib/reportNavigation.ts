export type ReportEntryFilter = 'income' | 'expense' | 'all'

export type FocusedReport = {
  from: string
  to: string
  kind?: ReportEntryFilter
  category?: string
}

export type ParsedReportFocus = {
  from: string
  to: string
  kind?: ReportEntryFilter
  category?: string
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function isCalendarDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export function buildReportPath(filter: FocusedReport): string {
  const params = new URLSearchParams()
  params.set('from', filter.from)
  params.set('to', filter.to)
  if (filter.kind) params.set('kind', filter.kind)
  if (filter.category) params.set('category', filter.category)
  return `/reports?${params.toString()}`
}

export function parseReportFocus(search: string, defaultFrom: string, today: string): ParsedReportFocus {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  const requestedFrom = params.get('from') || ''
  const requestedTo = params.get('to') || ''
  const validRange = isCalendarDate(requestedFrom)
    && isCalendarDate(requestedTo)
    && requestedFrom <= requestedTo
    && requestedTo <= today

  const kindValue = params.get('kind')
  const kind = kindValue === 'income' || kindValue === 'expense' || kindValue === 'all' ? kindValue : undefined
  const categoryValue = params.get('category')
  const category = categoryValue === 'uncategorized' || (categoryValue && UUID.test(categoryValue))
    ? categoryValue
    : undefined

  return {
    from: validRange ? requestedFrom : defaultFrom,
    to: validRange ? requestedTo : today,
    kind,
    category,
  }
}

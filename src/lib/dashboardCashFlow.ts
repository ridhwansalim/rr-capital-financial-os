export type CashFlowTransaction = {
  amount: number
  fee_amount?: number | null
  from_account_id: string | null
  to_account_id: string | null
  date: string
}

export type CashFlowBucket = {
  start: string
  end: string
  income: number
  expense: number
}

const DAILY_BUCKET_LIMIT = 62

function parseDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Invalid cash-flow date.')
  const date = new Date(`${value}T00:00:00Z`)
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error('Invalid cash-flow date.')
  return date
}

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function buildCashFlowBuckets(
  transactions: CashFlowTransaction[],
  rangeStart: string,
  rangeEnd: string,
): { granularity: 'day' | 'month'; buckets: CashFlowBucket[] } {
  const start = parseDate(rangeStart)
  const end = parseDate(rangeEnd)
  if (start > end) throw new Error('Cash-flow range start must not be after its end.')

  const dayCount = Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1
  const granularity = dayCount <= DAILY_BUCKET_LIMIT ? 'day' : 'month'
  const buckets: CashFlowBucket[] = []
  const index = new Map<string, CashFlowBucket>()

  if (granularity === 'day') {
    for (let cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
      const day = dateKey(cursor)
      const bucket = { start: day, end: day, income: 0, expense: 0 }
      buckets.push(bucket)
      index.set(day, bucket)
    }
  } else {
    const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1))
    while (cursor <= end) {
      const monthStart = dateKey(cursor)
      const nextMonth = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1))
      const monthEnd = dateKey(new Date(nextMonth.getTime() - 86_400_000))
      const bucket = {
        start: monthStart < rangeStart ? rangeStart : monthStart,
        end: monthEnd > rangeEnd ? rangeEnd : monthEnd,
        income: 0,
        expense: 0,
      }
      buckets.push(bucket)
      index.set(monthStart.slice(0, 7), bucket)
      cursor.setUTCMonth(cursor.getUTCMonth() + 1)
    }
  }

  for (const transaction of transactions) {
    const key = granularity === 'day' ? transaction.date : transaction.date.slice(0, 7)
    const bucket = index.get(key)
    if (!bucket) continue
    if (!transaction.from_account_id) bucket.income += Number(transaction.amount)
    if (!transaction.to_account_id) bucket.expense += Number(transaction.amount)
    bucket.expense += Number(transaction.fee_amount || 0)
  }

  return { granularity, buckets }
}

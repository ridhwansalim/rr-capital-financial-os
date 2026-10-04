import assert from 'node:assert/strict'
import { budgetTransactionWindow } from '../../src/lib/dashboardInsightsMath.ts'

assert.deepEqual(
  budgetTransactionWindow('2026-09-15', '2026-07-01', '2026-10-04'),
  { fromDate: '2026-07-01', toDateExclusive: '2026-10-05' },
  'budget window includes the current day while retaining the analytics history needed for rollover',
)

assert.deepEqual(
  budgetTransactionWindow('2026-01-01', '2026-07-01', '2026-10-04'),
  { fromDate: '2026-01-01', toDateExclusive: '2026-10-05' },
  'older rollover budgets retain all configured history and include the current day',
)

console.log('Dashboard insights date-window checks passed.')

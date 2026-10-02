import assert from 'node:assert/strict'
import { buildCashFlowBuckets } from '../../src/lib/dashboardCashFlow.ts'

const daily = buildCashFlowBuckets([
  { date: '2026-10-02', amount: 120, fee_amount: 2, from_account_id: null, to_account_id: 'account' },
  { date: '2026-10-02', amount: 50, fee_amount: 0, from_account_id: 'account', to_account_id: null },
  { date: '2026-10-03', amount: 75, fee_amount: 1, from_account_id: 'account', to_account_id: null },
], '2026-10-01', '2026-10-03')
assert.equal(daily.granularity, 'day')
assert.deepEqual(daily.buckets, [
  { start: '2026-10-01', end: '2026-10-01', income: 0, expense: 0 },
  { start: '2026-10-02', end: '2026-10-02', income: 120, expense: 52 },
  { start: '2026-10-03', end: '2026-10-03', income: 0, expense: 76 },
])

const monthly = buildCashFlowBuckets([
  { date: '2025-12-31', amount: 10, from_account_id: null, to_account_id: 'account' },
  { date: '2026-01-15', amount: 100, from_account_id: null, to_account_id: 'account' },
  { date: '2026-03-05', amount: 40, from_account_id: 'account', to_account_id: null },
  { date: '2026-04-01', amount: 999, from_account_id: null, to_account_id: 'account' },
], '2025-12-15', '2026-03-31')
assert.equal(monthly.granularity, 'month')
assert.deepEqual(monthly.buckets, [
  { start: '2025-12-15', end: '2025-12-31', income: 10, expense: 0 },
  { start: '2026-01-01', end: '2026-01-31', income: 100, expense: 0 },
  { start: '2026-02-01', end: '2026-02-28', income: 0, expense: 0 },
  { start: '2026-03-01', end: '2026-03-31', income: 0, expense: 40 },
])

assert.throws(() => buildCashFlowBuckets([], '2026-02-30', '2026-03-01'), /Invalid cash-flow date/)
assert.throws(() => buildCashFlowBuckets([], '2026-03-02', '2026-03-01'), /must not be after/)
console.log('Passed 4 dashboard cash-flow aggregation checks.')

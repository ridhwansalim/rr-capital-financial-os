import test from 'node:test'
import assert from 'node:assert/strict'
import { formatDueDate, nextMonthlyDueDate } from '../../src/lib/accountHealth.ts'

test('monthly due day clamps to the last day of short months', () => {
  assert.deepEqual(nextMonthlyDueDate(31, new Date('2026-02-20T12:00:00Z')), { year: 2026, month: 2, day: 28, daysUntil: 8 })
  assert.deepEqual(nextMonthlyDueDate(31, new Date('2024-02-20T12:00:00Z')), { year: 2024, month: 2, day: 29, daysUntil: 9 })
})

test('today remains the next due date and past day advances one month', () => {
  assert.deepEqual(nextMonthlyDueDate(5, new Date('2026-03-05T12:00:00Z')), { year: 2026, month: 3, day: 5, daysUntil: 0 })
  assert.deepEqual(nextMonthlyDueDate(5, new Date('2026-03-06T12:00:00Z')), { year: 2026, month: 4, day: 5, daysUntil: 30 })
})

test('monthly date crosses the year boundary and formats clearly', () => {
  const next = nextMonthlyDueDate(2, new Date('2026-12-31T12:00:00Z'))
  assert.deepEqual(next, { year: 2027, month: 1, day: 2, daysUntil: 2 })
  assert.equal(formatDueDate(next), '2 Jan')
})

test('invalid day numbers are rejected', () => {
  assert.equal(nextMonthlyDueDate(0), null)
  assert.equal(nextMonthlyDueDate(32), null)
})

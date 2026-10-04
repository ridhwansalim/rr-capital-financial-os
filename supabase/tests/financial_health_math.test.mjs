import test from 'node:test'
import assert from 'node:assert/strict'
import { isEligiblePersonalScoreTransaction, lastThreeCompleteMonths, observedHistoryDays, scoreFinancialHealth } from '../../src/lib/financialHealth.ts'

test('uses the last three complete months, including year boundaries', () => {
  assert.deepEqual(lastThreeCompleteMonths('2026-01-15'), {
    start: '2025-10-01', endExclusive: '2026-01-01', months: ['2025-10', '2025-11', '2025-12'],
  })
})

test('normalizes runway history to dates the owner could actually have tracked', () => {
  assert.equal(observedHistoryDays('2026-01-01', '2026-04-01', ['2026-02-01']), 59)
  assert.equal(observedHistoryDays('2026-01-01', '2026-04-01', ['2025-11-15']), 90)
  assert.equal(observedHistoryDays('2026-01-01', '2026-04-01', ['2026-04-01']), 0)
  assert.equal(observedHistoryDays('2026-01-01', '2026-04-01', []), 90)
  assert.equal(observedHistoryDays('bad-date', '2026-04-01', []), 0)
})

test('matches approved factors and bands', () => {
  const result = scoreFinancialHealth({ liquidBalance: 2000, monthlyExpenses: 1000, income: 3000, expenses: 2700, creditOutstanding: 300, creditLimit: 1000, hasCreditLine: true })
  assert.equal(result.score, 84)
  assert.equal(result.reserveMonths, 2)
  assert.equal(result.savingsRate, 0.1)
  assert.equal(result.utilization, 0.3)
})

test('normalizes over available factors when there is no credit line and reports coverage', () => {
  const result = scoreFinancialHealth({ liquidBalance: 1000, monthlyExpenses: 1000, income: 1000, expenses: 900, creditOutstanding: 0, creditLimit: 0, hasCreditLine: false })
  assert.equal(result.score, 62)
  assert.equal(result.applicableFactors, 2)
  assert.equal(result.factors.credit, null)
})

test('requires two applicable factors and does not invent missing history', () => {
  const result = scoreFinancialHealth({ liquidBalance: 0, monthlyExpenses: 0, income: 0, expenses: 0, creditOutstanding: 0, creditLimit: 0, hasCreditLine: false })
  assert.equal(result.score, null)
  assert.equal(result.applicableFactors, 0)
})

test('clamps reserve, cashflow, and credit utilization to approved bands', () => {
  const result = scoreFinancialHealth({ liquidBalance: 100000, monthlyExpenses: 100, income: 100, expenses: 1000, creditOutstanding: 1200, creditLimit: 1000, hasCreditLine: true })
  assert.equal(result.factors.reserve?.points, 40)
  assert.equal(result.factors.cashflow?.points, 0)
  assert.equal(result.factors.credit?.points, 0)
})

test('excludes shared, contact-linked, transfer, Chitti, and unknown-account activity', () => {
  const accounts = new Set(['own-account'])
  const base = { status: 'COMPLETED', tagged_profile_id: null, contact_id: null, description: 'Groceries', from_account_id: 'own-account', to_account_id: null }
  assert.equal(isEligiblePersonalScoreTransaction(base, accounts), true)
  assert.equal(isEligiblePersonalScoreTransaction({ ...base, tagged_profile_id: 'other-user' }, accounts), false)
  assert.equal(isEligiblePersonalScoreTransaction({ ...base, contact_id: 'contact' }, accounts), false)
  assert.equal(isEligiblePersonalScoreTransaction({ ...base, description: 'Chitti Installment: Household (Month 2/10)' }, accounts), false)
  assert.equal(isEligiblePersonalScoreTransaction({ ...base, from_account_id: null, to_account_id: 'another-users-account' }, accounts), false)
  assert.equal(isEligiblePersonalScoreTransaction({ ...base, to_account_id: 'own-account' }, accounts), false)
})

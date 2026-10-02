import test from 'node:test'
import assert from 'node:assert/strict'
import { formatIndiaDate, formatIndiaDateInputValue, indiaDateExclusiveEndToIso, indiaDateInputToIso, indiaDateStartToIso, isAccountOpenForOccurrence, isDateBeforeOpeningDate, monthlyInstallmentDate, toIndiaDateInputValue } from '../../src/lib/financeDate.ts'

test('date inputs keep the selected Indian calendar day in their timestamp', () => {
  for (const day of ['2026-01-01', '2026-10-02', '2024-02-29']) {
    assert.equal(toIndiaDateInputValue(new Date(indiaDateInputToIso(day))), day)
  }
})

test('today uses the Indian calendar day independent of the machine timezone', () => {
  assert.equal(toIndiaDateInputValue(new Date('2026-10-01T20:00:00.000Z')), '2026-10-02')
})

test('stored occurrence dates display as India calendar dates on every device timezone', () => {
  const selectedDate = '2026-10-02'
  const storedAtNoonIndia = indiaDateInputToIso(selectedDate)
  assert.equal(formatIndiaDateInputValue(storedAtNoonIndia), selectedDate)
  assert.equal(formatIndiaDate(storedAtNoonIndia), '2 Oct 2026')
  assert.equal(formatIndiaDate('2026-10-02'), '2 Oct 2026')
  assert.equal(formatIndiaDate('2026-10-01T18:30:00.000Z'), '2 Oct 2026')
})

test('report ranges use exact half-open India-time calendar-day boundaries', () => {
  assert.equal(indiaDateStartToIso('2026-10-02'), '2026-10-01T18:30:00.000Z')
  assert.equal(indiaDateExclusiveEndToIso('2026-10-02'), '2026-10-02T18:30:00.000Z')
  assert.equal(indiaDateExclusiveEndToIso('2026-02-28'), '2026-02-28T18:30:00.000Z')
  assert.throws(() => indiaDateExclusiveEndToIso('2026-02-29'), /valid occurrence date/)
})

test('invalid and impossible dates are rejected', () => {
  assert.throws(() => indiaDateInputToIso('2026-02-29'), /valid occurrence date/)
  assert.throws(() => indiaDateInputToIso('2026-10-2'), /valid occurrence date/)
})

test('account opening dates form an inclusive boundary for posted entries', () => {
  assert.equal(isDateBeforeOpeningDate('2026-10-01', '2026-10-02'), true)
  assert.equal(isDateBeforeOpeningDate('2026-10-02', '2026-10-02'), false)
  assert.equal(isDateBeforeOpeningDate('2026-10-03', '2026-10-02'), false)
  assert.equal(isDateBeforeOpeningDate('2026-10-01', '0001-01-01'), false)
})

test('peer acceptance account choices honor the occurrence date in India time', () => {
  assert.equal(isAccountOpenForOccurrence('2026-10-02', '2026-10-01T20:00:00.000Z'), true)
  assert.equal(isAccountOpenForOccurrence('2026-10-03', '2026-10-01T20:00:00.000Z'), false)
  assert.equal(isAccountOpenForOccurrence('2026-10-02', '2026-10-02'), true)
  assert.equal(isAccountOpenForOccurrence('2026-10-03', '2026-10-02'), false)
  assert.equal(isAccountOpenForOccurrence('2026-10-02', 'not-a-date'), false)
  assert.equal(isAccountOpenForOccurrence(undefined, '2026-10-02'), true)
})

test('opening balances use the same sign convention as account balances', async () => {
  const { openingBalanceForAccountType } = await import('../../src/lib/financeDate.ts')
  assert.equal(openingBalanceForAccountType('1250.50', 'bank'), 1250.5)
  assert.equal(openingBalanceForAccountType('1250.50', 'cash'), 1250.5)
  assert.equal(openingBalanceForAccountType('1250.50', 'credit_card'), -1250.5)
  assert.equal(openingBalanceForAccountType('1250.50', 'pay_later'), -1250.5)
  assert.throws(() => openingBalanceForAccountType('1.234', 'bank'), /two decimal places/)
  assert.throws(() => openingBalanceForAccountType('-1', 'bank'), /two decimal places/)
})

test('monthly installments keep the original anchor day and clamp short months', () => {
  assert.equal(monthlyInstallmentDate('2026-03-01', 1), '2026-03-01')
  assert.equal(monthlyInstallmentDate('2026-03-01', 8), '2026-10-01')
  assert.equal(monthlyInstallmentDate('2026-01-31', 2), '2026-02-28')
  assert.equal(monthlyInstallmentDate('2026-01-31', 3), '2026-03-31')
  assert.equal(monthlyInstallmentDate('2024-01-31', 2), '2024-02-29')
  assert.throws(() => monthlyInstallmentDate('2026-02-29', 2), /valid installment schedule date/)
  assert.throws(() => monthlyInstallmentDate('2026-03-01', 0), /valid installment schedule date/)
})

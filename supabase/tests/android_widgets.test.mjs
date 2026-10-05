import test from 'node:test'
import assert from 'node:assert/strict'
import { calculateWidgetMonthlyCommitments, calculateWidgetNetFlow30Day } from '../../src/lib/dashboardWidgetMath.ts'

test('widget monthly commitments include only this month’s unpaid owner debits', () => {
  const chittis = [
    { status: 'ACTIVE', start_date: '2026-01-15', duration_months: 12, months_paid: 9, monthly_installment: 500 },
    { status: 'ACTIVE', start_date: '2026-10-20', duration_months: 12, months_paid: 0, monthly_installment: 300 },
    { status: 'ACTIVE', start_date: '2025-10-01', duration_months: 12, months_paid: 12, monthly_installment: 900 },
    { status: 'COMPLETED', start_date: '2026-01-01', duration_months: 12, months_paid: 0, monthly_installment: 700 },
  ]
  const emis = [
    { status: 'ACTIVE', start_date: '2026-01-10', end_date: null, amount: 1000, type: 'personal', owner_id: 'owner', owner_months_paid: 8 },
    { status: 'ACTIVE', start_date: '2026-07-01', end_date: null, amount: 800, type: 'borrowed', owner_id: 'owner', owner_months_paid: 2 },
    { status: 'ACTIVE', start_date: '2026-01-15', end_date: null, amount: 450, type: 'lent', counterparty_profile_id: 'owner', counterparty_months_paid: 9 },
    { status: 'ACTIVE', start_date: '2026-01-01', end_date: null, amount: 200, type: 'lent', owner_id: 'owner', owner_months_paid: 0 },
    { status: 'ACTIVE', start_date: '2026-01-10', end_date: '2026-10-09', amount: 600, type: 'personal', owner_id: 'owner', owner_months_paid: 8 },
  ]

  assert.equal(calculateWidgetMonthlyCommitments('2026-10-15', 'owner', chittis, emis), 3050)
})

test('widget 30-day net flow uses India-day boundaries, excludes transfers and includes fees', () => {
  const rows = [
    { created_at: '2026-10-04T19:00:00Z', from_account_id: null, to_account_id: 'a', amount: 10000 },
    { created_at: '2026-09-05T18:30:00Z', from_account_id: 'a', to_account_id: null, amount: 2000, fee_amount: 5 },
    { created_at: '2026-09-05T18:29:59Z', from_account_id: null, to_account_id: 'a', amount: 9000 },
    { created_at: '2026-10-02T00:00:00Z', from_account_id: 'a', to_account_id: 'b', amount: 4000 },
  ]

  assert.equal(calculateWidgetNetFlow30Day('2026-10-05', rows), 7995)
})

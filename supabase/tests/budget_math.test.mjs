import assert from 'node:assert/strict'
import { calculateBudgetPeriod } from '../../src/lib/budgetMath.ts'

const makeMap = entries => new Map(Object.entries(entries))

assert.deepEqual(
  calculateBudgetPeriod(1000, false, makeMap({ '2026-01': 700, '2026-02': 200 }), '2026-01', '2026-02'),
  { spent: 200, carryover: 0, available: 1000, remaining: 800 },
  'disabled rollover resets the allowance each month',
)
assert.deepEqual(
  calculateBudgetPeriod(1000, true, makeMap({ '2026-12': 700, '2027-01': 450 }), '2026-12', '2027-01'),
  { spent: 450, carryover: 300, available: 1300, remaining: 850 },
  'unused allowance carries across December and January',
)
assert.deepEqual(
  calculateBudgetPeriod(1000, true, makeMap({ '2026-01': 1200, '2026-02': 400 }), '2026-01', '2026-02'),
  { spent: 400, carryover: 0, available: 1000, remaining: 600 },
  'overspending does not create negative carryover debt',
)
assert.deepEqual(
  calculateBudgetPeriod(0.3, true, makeMap({ '2026-01': 0.1, '2026-02': 0.2 }), '2026-01', '2026-02'),
  { spent: 0.2, carryover: 0.2, available: 0.5, remaining: 0.3 },
  'currency math remains exact to the paise',
)
assert.throws(() => calculateBudgetPeriod(10, true, new Map(), '2026-13', '2027-01'), /YYYY-MM/)
console.log('Passed 5 budget rollover and currency checks.')

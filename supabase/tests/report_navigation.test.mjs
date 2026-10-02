import assert from 'node:assert/strict'
import { buildReportPath, parseReportFocus } from '../../src/lib/reportNavigation.ts'

const today = '2026-10-02'
const defaultFrom = '2026-10-01'
const categoryId = 'ad3101ad-30f0-4e1e-a136-7636824ff745'

assert.equal(
  buildReportPath({ from: '2026-09-14', to: '2026-09-14', kind: 'income' }),
  '/reports?from=2026-09-14&to=2026-09-14&kind=income',
)
assert.deepEqual(
  parseReportFocus('?from=2026-09-14&to=2026-09-14&kind=income', defaultFrom, today),
  { from: '2026-09-14', to: '2026-09-14', kind: 'income', category: undefined },
)
assert.deepEqual(
  parseReportFocus(`?from=2026-09-14&to=2026-09-20&kind=expense&category=${categoryId}`, defaultFrom, today),
  { from: '2026-09-14', to: '2026-09-20', kind: 'expense', category: categoryId },
)
assert.equal(parseReportFocus(`?from=2026-09-14&to=2026-09-20&category=${categoryId}`, defaultFrom, today).category, categoryId)
assert.equal(parseReportFocus('?category=uncategorized', defaultFrom, today).category, 'uncategorized')
assert.equal(parseReportFocus('?kind=all', defaultFrom, today).kind, 'all')
assert.deepEqual(
  parseReportFocus('?from=2026-02-30&to=2026-09-20&kind=delete', defaultFrom, today),
  { from: defaultFrom, to: today, kind: undefined, category: undefined },
)
assert.deepEqual(
  parseReportFocus('?from=2026-09-20&to=2026-09-14', defaultFrom, today),
  { from: defaultFrom, to: today, kind: undefined, category: undefined },
)
assert.deepEqual(
  parseReportFocus('?from=2026-10-01&to=2026-10-03', defaultFrom, today),
  { from: defaultFrom, to: today, kind: undefined, category: undefined },
)
assert.equal(parseReportFocus('?category=public.profiles', defaultFrom, today).category, undefined)
console.log('Passed 10 focused report navigation checks.')

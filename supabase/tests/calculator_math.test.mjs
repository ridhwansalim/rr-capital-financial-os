import assert from 'node:assert/strict'
import { calculateEmi, calculateSavingsGrowth, compareLoanPayoff } from '../../src/lib/calculatorMath.ts'

const zeroRate = calculateEmi(1200, 0, 12)
assert.equal(zeroRate.monthlyPayment, 100)
assert.equal(zeroRate.totalInterest, 0)

const normalEmi = calculateEmi(100000, 12, 12)
assert.ok(Math.abs(normalEmi.monthlyPayment - 8884.8789) < 0.01)
assert.ok(normalEmi.totalInterest > 0)

const comparison = compareLoanPayoff(100000, 12, 9000, 1000)
assert.ok(comparison.monthsSaved > 0)
assert.ok(comparison.interestSaved > 0)
assert.throws(() => compareLoanPayoff(100000, 12, 500, 0), /must exceed the monthly interest/)

const noGrowth = calculateSavingsGrowth(1000, 100, 0, 10)
assert.deepEqual(noGrowth, { futureValue: 2000, contributed: 2000, growth: 0 })
const growth = calculateSavingsGrowth(0, 1000, 12, 12)
assert.ok(growth.futureValue > growth.contributed)
assert.throws(() => calculateEmi(1000, 101, 12), /between 0% and 100%/)
assert.throws(() => calculateSavingsGrowth(100, 50, 5, 601), /600 months/)
console.log('Passed 8 calculator formula and boundary checks.')

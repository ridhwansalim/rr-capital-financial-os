import assert from 'node:assert/strict'
import { calculateGroupSplit } from '../../src/lib/groupSplitMath.ts'

const users = [{ key: 'p:a' }, { key: 'p:b' }]

let result = calculateGroupSplit('100.00', users, true, 'equal')
assert.equal(result.valid, true)
assert.deepEqual(result.allocations.map(item => item.amountCents), [3334, 3333])
assert.equal(result.ownerShareCents, 3333)
assert.equal(result.allocations.reduce((sum, item) => sum + item.amountCents, result.ownerShareCents), 10000)

result = calculateGroupSplit('10', users, false, 'equal')
assert.equal(result.valid, true)
assert.deepEqual(result.allocations.map(item => item.amountCents), [500, 500])
assert.equal(result.ownerShareCents, 0)

result = calculateGroupSplit('30.01', [
  { key: 'a', amount: '10.00' }, { key: 'b', amount: '15.01' },
], true, 'exact', '5.00')
assert.equal(result.valid, true)
assert.deepEqual(result.allocations.map(item => item.amountCents), [1000, 1501])
assert.equal(result.ownerShareCents, 500)

result = calculateGroupSplit('30', [
  { key: 'a', percentage: '33.33' }, { key: 'b', percentage: '50' },
], true, 'percentage', '16.67')
assert.equal(result.valid, true)
assert.equal(result.allocations.reduce((sum, item) => sum + item.amountCents, result.ownerShareCents), 3000)

assert.equal(calculateGroupSplit('10', users, true, 'exact', '2').valid, false)
assert.equal(calculateGroupSplit('10', users, false, 'percentage').valid, false)
assert.equal(calculateGroupSplit('0', users, false, 'equal').valid, false)
assert.equal(calculateGroupSplit('10.001', users, false, 'equal').valid, false)
assert.equal(calculateGroupSplit('10', [], true, 'equal').valid, false)

console.log('Group split money arithmetic tests passed.')

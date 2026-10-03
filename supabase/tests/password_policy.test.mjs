import assert from 'node:assert/strict'
import { getPasswordPolicyError, PASSWORD_MIN_LENGTH } from '../../src/lib/passwordPolicy.ts'

assert.equal(PASSWORD_MIN_LENGTH, 12)
assert.equal(getPasswordPolicyError('Abcdef12!xyz'), null)
assert.match(getPasswordPolicyError('Ab1!short'), /12 characters/)
assert.match(getPasswordPolicyError('abcdefghijkl!'), /uppercase/)
assert.match(getPasswordPolicyError('ABCDEFGHIJKL1!'), /lowercase/)
assert.match(getPasswordPolicyError('Abcdefghijkl!'), /number/)
assert.match(getPasswordPolicyError('Abcdefghijkl1'), /symbol/)

console.log('Password policy checks passed.')

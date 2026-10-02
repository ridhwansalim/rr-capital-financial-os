import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { safeBackendErrorMessage, safeCaughtErrorMessage } from '../../src/lib/safeErrorMessages.ts'

test('backend diagnostics never escape into user-visible messages', () => {
  const secret = 'SQL column account_secret; owner=synthetic-owner; amount=9876.54'
  assert.equal(safeBackendErrorMessage({ code: 'XX000', message: secret, details: secret }, 'Could not save.'), 'Could not save.')
  assert.equal(safeBackendErrorMessage({ code: '23505', message: secret }, 'Could not save.'), 'A record with those details already exists. Check the entry and try again.')
  assert.equal(safeCaughtErrorMessage({ code: 'PGRST204', message: secret }, 'Could not save.'), 'The app could not complete this request. Refresh RR Capital and try again.')
  assert.doesNotMatch(safeCaughtErrorMessage({ code: 'XX000', message: secret }, 'Could not save.'), /account_secret|synthetic-owner|9876\.54/)
})

test('known database error classes have short actionable safe messages', () => {
  assert.match(safeBackendErrorMessage({ code: '23503' }, 'fallback'), /linked account or record/)
  assert.match(safeBackendErrorMessage({ code: '42501' }, 'fallback'), /permission/)
  assert.match(safeBackendErrorMessage({ code: '55000' }, 'fallback'), /original financial workflow|linked to another financial workflow/i)
  assert.match(safeBackendErrorMessage({ code: '22003' }, 'fallback'), /amount and date/)
  assert.match(safeBackendErrorMessage({ status: 429 }, 'fallback'), /Wait a moment/)
  assert.equal(safeBackendErrorMessage({ code: 'XX000' }, 'fallback'), 'fallback')
})

test('app-authored validation copy is preserved while unknown exceptions use fallback', () => {
  assert.equal(safeCaughtErrorMessage(new Error('Choose two different accounts for a transfer.'), 'Could not save.'), 'Choose two different accounts for a transfer.')
  assert.equal(safeCaughtErrorMessage(new Error('The server rejected this entry. Review it and enter it again if needed.'), 'Could not save.'), 'The server rejected this entry. Review it and enter it again if needed.')
  assert.equal(safeCaughtErrorMessage(new TypeError('Request failed for https://internal.example/sql'), 'Could not save.'), 'Could not save.')
})

test('screens and components do not render raw error.message values', () => {
  const roots = ['src/screens', 'src/components']
  const files = []
  const visit = (directory) => {
    for (const item of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, item.name)
      if (item.isDirectory()) visit(path)
      else if (/\.tsx?$/.test(item.name)) files.push(path)
    }
  }
  roots.forEach(visit)

  const unsafe = files.filter(path => !path.endsWith('Calculators.tsx')
    && /(?:error|err|cause|loadError|saveError|deleteError)\??\.message/.test(readFileSync(path, 'utf8')))
  assert.deepEqual(unsafe, [], 'Render errors through safeErrorMessages instead of reflecting backend text.')
})

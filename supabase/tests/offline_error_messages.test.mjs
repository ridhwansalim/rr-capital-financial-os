import test from 'node:test'
import assert from 'node:assert/strict'
import { offlineRejectionMessage, OFFLINE_RETRY_MESSAGE, redactPersistedOfflineError, safePersistedOfflineMessage } from '../../src/lib/offlineErrorMessages.ts'

test('offline rejection messages are actionable and selected by safe error code', () => {
  assert.match(offlineRejectionMessage('22003'), /amount or date/)
  assert.match(offlineRejectionMessage('23503'), /account or related record/)
  assert.match(offlineRejectionMessage('42501'), /balance on the transaction date/)
  assert.match(offlineRejectionMessage('PGRST204'), /Refresh the app/)
  assert.match(offlineRejectionMessage('XX000'), /server rejected this entry/i)
  assert.equal(offlineRejectionMessage(null), offlineRejectionMessage('unknown'))
})

test('stored transport status explains retry safety without exposing an exception', () => {
  assert.match(OFFLINE_RETRY_MESSAGE, /same request ID/)
  assert.doesNotMatch(OFFLINE_RETRY_MESSAGE, /password|token|account id|SQLSTATE/i)
})

test('legacy persisted server diagnostics are redacted without changing queued financial data', () => {
  const item = {
    owner_id: 'synthetic-owner', request_id: 'synthetic-request', amount: 123.45,
    description: 'Synthetic groceries', sync_status: 'failed',
    last_error: 'secret-token; submitted amount=123.45; SQL diagnostic'
  }
  const redacted = redactPersistedOfflineError(item)
  assert.equal(redacted, item)
  assert.equal(redacted.last_error, offlineRejectionMessage(null))
  assert.equal(redacted.amount, 123.45)
  assert.equal(redacted.owner_id, 'synthetic-owner')
  assert.equal(redacted.request_id, 'synthetic-request')
  assert.equal(redacted.description, 'Synthetic groceries')
  assert.doesNotMatch(redacted.last_error, /secret-token|123\.45|SQL diagnostic/)
  assert.equal(safePersistedOfflineMessage('pending', 'secret-token'), OFFLINE_RETRY_MESSAGE)
  assert.equal(safePersistedOfflineMessage('pending', null), null)
})

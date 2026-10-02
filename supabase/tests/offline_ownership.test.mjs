import test from 'node:test'
import assert from 'node:assert/strict'
import { cacheForOwner, visibleOfflineItems } from '../../src/lib/offlineOwnership.ts'

test('offline queue hides previous owners and already completed records', () => {
  const records = [
    { id: 1, owner_id: 'ridhu', sync_status: 'pending' },
    { id: 2, owner_id: 'family', sync_status: 'failed' },
    { id: 3, owner_id: 'ridhu', sync_status: 'synced' }
  ]
  assert.deepEqual(visibleOfflineItems(records, 'family'), [records[1]])
  assert.deepEqual(visibleOfflineItems(records, null), [])
  assert.deepEqual(visibleOfflineItems(undefined, 'ridhu'), [])
})

test('offline account labels are used only for the matching signed-in owner', () => {
  const cache = { owner_id: 'ridhu', accounts: [{ id: 'secret-account', name: 'Personal Bank' }] }
  assert.equal(cacheForOwner(cache, 'ridhu'), cache)
  assert.equal(cacheForOwner(cache, 'family'), undefined)
  assert.equal(cacheForOwner(cache, null), undefined)
})

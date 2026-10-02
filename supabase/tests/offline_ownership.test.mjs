import test from 'node:test'
import assert from 'node:assert/strict'
import { cacheForOwner, canSyncOfflineItem, countOutstandingOfflineItems, offlineAccountChoices, visibleOfflineItems } from '../../src/lib/offlineOwnership.ts'
import { ensureOfflineRequestId } from '../../src/lib/offlineRequestId.ts'
import { discardFailedOutboxItem } from '../../src/lib/offlineQueueActions.ts'

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

test('sign-out warning counts only the active owner’s outstanding offline entries', () => {
  const records = [
    { owner_id: 'ridhu', sync_status: 'pending' },
    { owner_id: 'ridhu', sync_status: 'failed' },
    { owner_id: 'ridhu', sync_status: 'synced' },
    { owner_id: 'family', sync_status: 'pending' }
  ]
  assert.equal(countOutstandingOfflineItems(records, 'ridhu'), 2)
  assert.equal(countOutstandingOfflineItems(records, 'family'), 1)
  assert.equal(countOutstandingOfflineItems(records, null), 0)
})

test('offline sync stops when the active session does not own the queued item', () => {
  const item = { owner_id: 'ridhu', sync_status: 'pending' }
  assert.equal(canSyncOfflineItem(item, 'ridhu'), true)
  assert.equal(canSyncOfflineItem(item, 'family'), false)
  assert.equal(canSyncOfflineItem(item, null), false)
  assert.equal(canSyncOfflineItem({ ...item, sync_status: 'failed' }, 'ridhu'), false)
})

test('offline account labels are used only for the matching signed-in owner', () => {
  const cache = { owner_id: 'ridhu', accounts: [{ id: 'secret-account', name: 'Personal Bank' }] }
  assert.equal(cacheForOwner(cache, 'ridhu'), cache)
  assert.equal(cacheForOwner(cache, 'family'), undefined)
  assert.equal(cacheForOwner(cache, null), undefined)
})

test('offline account cache omits balances and credit limits', () => {
  assert.deepEqual(offlineAccountChoices([
    { id: 'a', name: 'Everyday', type: 'bank', opening_date: '2026-01-01', balance: 12500, credit_limit: 50000 }
  ]), [{ id: 'a', name: 'Everyday', type: 'bank', opening_date: '2026-01-01' }])
})

test('concurrent tabs atomically persist and reuse one legacy outbox request ID', async () => {
  const records = new Map([[7, { id: 7, owner_id: 'ridhu', amount: 125 }]])
  let tail = Promise.resolve()
  const outbox = {
    async get(id) { return records.get(id) },
    async update(id, changes) { records.set(id, { ...records.get(id), ...changes }) }
  }
  const database = {
    outbox,
    async transaction(_mode, _table, callback) {
      const prior = tail
      let release
      tail = new Promise(resolve => { release = resolve })
      await prior
      try { return await callback() } finally { release() }
    }
  }
  let generated = 0
  const makeId = () => `request-${++generated}`
  const [first, second] = await Promise.all([
    ensureOfflineRequestId(database, 7, 'ridhu', makeId),
    ensureOfflineRequestId(database, 7, 'ridhu', makeId)
  ])
  assert.equal(generated, 1)
  assert.equal(first.request_id, second.request_id)
  assert.equal(records.get(7).request_id, first.request_id)
  assert.equal(await ensureOfflineRequestId(database, 7, 'family', makeId), undefined)
})

test('discard removes only failed transactions owned by the current user', async () => {
  const records = new Map([
    [1, { id: 1, owner_id: 'ridhu', sync_status: 'failed' }],
    [2, { id: 2, owner_id: 'ridhu', sync_status: 'pending' }],
    [3, { id: 3, owner_id: 'family', sync_status: 'failed' }]
  ])
  const outbox = {
    async get(id) { return records.get(id) },
    async delete(id) { records.delete(id) }
  }
  const database = {
    outbox,
    async transaction(_mode, _table, callback) { return callback() }
  }
  assert.equal(await discardFailedOutboxItem(database, 1, 'ridhu'), true)
  assert.equal(await discardFailedOutboxItem(database, 2, 'ridhu'), false)
  assert.equal(await discardFailedOutboxItem(database, 3, 'ridhu'), false)
  assert.equal(records.has(1), false)
  assert.equal(records.has(2), true)
  assert.equal(records.has(3), true)
})

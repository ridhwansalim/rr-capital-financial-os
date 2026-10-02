import test from 'node:test'
import assert from 'node:assert/strict'
import { cacheForOwner, offlineAccountChoices, visibleOfflineItems } from '../../src/lib/offlineOwnership.ts'
import { ensureOfflineRequestId } from '../../src/lib/offlineRequestId.ts'

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

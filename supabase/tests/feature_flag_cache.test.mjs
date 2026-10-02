import test from 'node:test'
import assert from 'node:assert/strict'
import { createUserFeatureFlagCache } from '../../src/lib/featureFlagCache.ts'

function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

test('a forced feature refresh supersedes an older in-flight response', async () => {
  const requests = []
  const cache = createUserFeatureFlagCache(() => {
    const request = deferred()
    requests.push(request)
    return request.promise
  })

  const olderRead = cache.read('ridhu')
  await Promise.resolve()
  const forcedRead = cache.read('ridhu', true)
  await Promise.resolve()
  assert.equal(requests.length, 2)

  requests[1].resolve({ budgets: true })
  assert.deepEqual(await forcedRead, { budgets: true })
  requests[0].resolve({ budgets: false })
  assert.deepEqual(await olderRead, { budgets: false })

  assert.deepEqual(await cache.read('ridhu'), { budgets: true })
  assert.equal(requests.length, 2)
})

test('feature flags are isolated by owner and expire after the configured TTL', async () => {
  let now = 100
  const calls = []
  const cache = createUserFeatureFlagCache(async userId => {
    calls.push(userId)
    return { budgets: userId === 'ridhu' }
  }, 30, () => now)

  assert.deepEqual(await cache.read('ridhu'), { budgets: true })
  assert.deepEqual(await cache.read('family'), { budgets: false })
  assert.deepEqual(await cache.read('ridhu'), { budgets: true })
  assert.deepEqual(calls, ['ridhu', 'family'])

  now = 131
  assert.deepEqual(await cache.read('ridhu'), { budgets: true })
  assert.deepEqual(calls, ['ridhu', 'family', 'ridhu'])
})

test('a session-change null result is not cached', async () => {
  let calls = 0
  const cache = createUserFeatureFlagCache(async () => {
    calls += 1
    return calls === 1 ? null : { budgets: true }
  })

  assert.equal(await cache.read('ridhu'), null)
  assert.deepEqual(await cache.read('ridhu'), { budgets: true })
  assert.equal(calls, 2)
})

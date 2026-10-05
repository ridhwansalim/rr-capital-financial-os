import test from 'node:test'
import assert from 'node:assert/strict'
import { handleAuthDeepLink, resetProcessedAuthUrlsForTests } from '../../src/lib/nativeOAuthCallback.ts'

function dependencies(overrides = {}) {
  const calls = { closed: 0, sessions: [], codes: [], started: 0, completed: [] }
  return {
    calls,
    deps: {
      closeBrowser: async () => { calls.closed += 1 },
      setSession: async tokens => { calls.sessions.push(tokens); return { error: null } },
      exchangeCode: async code => { calls.codes.push(code); return { error: null } },
      onStarted: () => { calls.started += 1 },
      onComplete: result => { calls.completed.push(result) },
      ...overrides,
    },
  }
}

test('exchanges PKCE codes from both two-slash and three-slash custom callback URLs', async () => {
  for (const url of [
    'com.rrcapital.financialos://auth/callback?code=pkce-one',
    'com.rrcapital.financialos:///auth/callback/?code=pkce-two',
  ]) {
    resetProcessedAuthUrlsForTests()
    const { calls, deps } = dependencies()
    await handleAuthDeepLink(url, deps)
    assert.equal(calls.codes.length, 1)
    assert.equal(calls.completed[0]?.success, true)
  }
})

test('sets a session from token fragments and safely reports callback errors', async () => {
  resetProcessedAuthUrlsForTests()
  const tokenResult = dependencies()
  await handleAuthDeepLink('com.rrcapital.financialos://auth/callback#access_token=access&refresh_token=refresh', tokenResult.deps)
  assert.deepEqual(tokenResult.calls.sessions, [{ access_token: 'access', refresh_token: 'refresh' }])

  resetProcessedAuthUrlsForTests()
  const errorResult = dependencies()
  await handleAuthDeepLink('com.rrcapital.financialos:///auth/callback?error_description=Access+denied', errorResult.deps)
  assert.deepEqual(errorResult.calls.completed, [{ success: false, error: 'Access denied' }])
})

test('deduplicates concurrent launch-url and appUrlOpen delivery', async () => {
  resetProcessedAuthUrlsForTests()
  let releaseBrowser
  const browserWait = new Promise(resolve => { releaseBrowser = resolve })
  const { calls, deps } = dependencies({ closeBrowser: () => browserWait.then(() => { calls.closed += 1 }) })
  const url = 'com.rrcapital.financialos://auth/callback?code=one-use-code'
  const launchDelivery = handleAuthDeepLink(url, deps)
  const resumeDelivery = handleAuthDeepLink(url, deps)
  releaseBrowser()
  await Promise.all([launchDelivery, resumeDelivery])
  assert.equal(calls.codes.length, 1)
  assert.equal(calls.started, 1)
  assert.equal(calls.completed.length, 1)
})

test('allows retrying the same callback after code exchange failure', async () => {
  resetProcessedAuthUrlsForTests()
  let attempt = 0
  const { calls, deps } = dependencies({
    exchangeCode: async code => {
      calls.codes.push(code)
      attempt += 1
      return { error: attempt === 1 ? new Error('temporary error') : null }
    },
  })
  const url = 'com.rrcapital.financialos://auth/callback?code=retry-code'
  await handleAuthDeepLink(url, deps)
  await handleAuthDeepLink(url, deps)
  assert.equal(calls.codes.length, 2)
  assert.deepEqual(calls.completed, [
    { success: false, error: 'temporary error' },
    { success: true },
  ])
})

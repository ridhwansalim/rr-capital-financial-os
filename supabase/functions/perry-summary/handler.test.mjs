import { createPerrySummaryHandler } from './handler.ts'
import { isRrCapitalUrl } from './project.ts'
import { invokePersonalSummary } from './rpc.ts'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const ridhuId = '00000000-0000-4000-a000-000000000081'
const anotherUserId = '00000000-0000-4000-a000-000000000082'
const ridhuJwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJyaWRodSJ9.signature'
const anotherJwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJvdGhlciJ9.signature'
const allowed = {
  as_of: '2026-10-01T12:00:00Z',
  accounts: [{ name: 'Personal bank', type: 'bank', personal_balance: 100 }],
  ledger: {
    completed_personal_transaction_count: 1,
    completed_personal_income_total: 100,
    completed_personal_expense_total: 0,
    completed_personal_transfer_total: 0,
    first_completed_at: '2026-10-01T11:00:00Z',
    last_completed_at: '2026-10-01T11:00:00Z',
  },
}

function harness(overrides = {}) {
  const state = { queries: 0, verifiedTokens: [], queriedTokens: [] }
  const dependencies = {
    endpointReady: true,
    authenticateUser: async token => {
      state.verifiedTokens.push(token)
      if (token === ridhuJwt) return { id: ridhuId }
      if (token === anotherJwt) return { id: anotherUserId }
      return null
    },
    queryPersonalSummary: async accessToken => {
      state.queries++
      state.queriedTokens.push(accessToken)
      return { data: structuredClone(allowed), error: null }
    },
    ...overrides,
  }
  return { handler: createPerrySummaryHandler(dependencies), state }
}

function req({ method = 'POST', url = 'https://edge.example/functions/v1/perry-summary', headers = {}, body } = {}) {
  return new Request(url, { method, headers, ...(body === undefined ? {} : { body }) })
}
const validHeaders = { authorization: `Bearer ${ridhuJwt}` }

test('Ridhu token is verified with Supabase Auth and forwarded only to the fixed summary RPC', async () => {
  const { handler, state } = harness()
  const response = await handler(req({ headers: validHeaders }))
  const body = await response.json()
  assert.equal(response.status, 200)
  assert.deepEqual(state.verifiedTokens, [ridhuJwt])
  assert.deepEqual(state.queriedTokens, [ridhuJwt])
  assert.equal(state.queries, 1)
  assert.equal(response.headers.get('cache-control'), 'no-store, private')
  assert.deepEqual(body, allowed)
})

test('summary projection drops unapproved fields and validates shape', async () => {
  const { handler } = harness({ queryPersonalSummary: async () => ({ data: { ...structuredClone(allowed), profile: { email: 'secret' }, transactions: [{ id: 'secret' }] }, error: null }) })
  const response = await handler(req({ headers: validHeaders }))
  const body = await response.json()
  assert.equal(response.status, 200)
  assert.equal('profile' in body, false)
  assert.equal('transactions' in body, false)
})

test('anonymous, malformed, revoked, and invalid Supabase credentials fail closed', async (t) => {
  for (const [name, authorization] of [['anonymous', undefined], ['malformed', 'Bearer bad'], ['invalid token', `Bearer ${'x'.repeat(43)}`]]) {
    await t.test(name, async () => {
      const { handler, state } = harness()
      const response = await handler(req({ headers: authorization ? { authorization } : {} }))
      assert.equal(response.status, 401)
      assert.equal(state.queries, 0)
    })
  }
  const revoked = harness({ authenticateUser: async () => null })
  assert.equal((await revoked.handler(req({ headers: validHeaders }))).status, 401)
  assert.equal(revoked.state.queries, 0)
})

test('another valid signed-in user is denied by the database owner pin and receives no summary', async () => {
  const { handler, state } = harness({
    authenticateUser: async () => ({ id: anotherUserId }),
    queryPersonalSummary: async accessToken => {
      state.queries++
      state.queriedTokens.push(accessToken)
      return { data: null, error: { code: '42501' } }
    },
  })
  const response = await handler(req({ headers: { authorization: `Bearer ${anotherJwt}` } }))
  assert.equal(response.status, 403)
  assert.deepEqual(await response.json(), { error: 'Access denied' })
  assert.deepEqual(state.queriedTokens, [anotherJwt])
  assert.equal(state.queries, 1)
})

test('forged or supplied identities, query parameters, and write methods are rejected before auth/database access', async (t) => {
  const cases = [
    ['forged query ID', { url: `https://edge.example/functions/v1/perry-summary?user_id=${anotherUserId}` }, 400],
    ['forged request body', { body: JSON.stringify({ user_id: anotherUserId }) }, 400],
    ...['GET', 'PUT', 'PATCH', 'DELETE'].map(method => [`${method} denied`, { method }, 405]),
  ]
  for (const [name, options, expected] of cases) {
    await t.test(name, async () => {
      const { handler, state } = harness()
      const response = await handler(req({ ...options, headers: validHeaders }))
      assert.equal(response.status, expected)
      assert.equal(state.queries, 0)
      assert.equal(state.verifiedTokens.length, 0)
    })
  }
})

test('unknown browser origins are denied', async () => {
  const { handler } = harness()
  const response = await handler(req({ headers: { ...validHeaders, origin: 'https://attacker.example' } }))
  assert.equal(response.status, 403)
})

test('missing restricted configuration, auth outages, and database errors fail closed', async () => {
  const misconfigured = harness({ endpointReady: false })
  const unavailable = await misconfigured.handler(req({ headers: validHeaders }))
  assert.equal(unavailable.status, 503)
  assert.equal(misconfigured.state.queries, 0)
  const authUnavailable = harness({ authenticateUser: async () => { throw new Error('network unavailable') } })
  assert.equal((await authUnavailable.handler(req({ headers: validHeaders }))).status, 503)
  assert.equal(authUnavailable.state.queries, 0)
  const queryError = harness({ queryPersonalSummary: async () => ({ data: allowed, error: { code: '08006' } }) })
  const failed = await queryError.handler(req({ headers: validHeaders }))
  assert.equal(failed.status, 502)
  const failedBody = await failed.json()
  assert.deepEqual(failedBody, { error: 'Summary unavailable' })
  assert.equal(JSON.stringify(failedBody).includes(ridhuJwt), false)
})

test('Supabase project URL is pinned to RR Capital', async () => {
  assert.equal(isRrCapitalUrl('https://hnebvwfgsotrknxpgpmv.supabase.co'), true)
  assert.equal(isRrCapitalUrl('https://guvkfuxniprtqdsqlqtx.supabase.co'), false)
  assert.equal(isRrCapitalUrl('https://hnebvwfgsotrknxpgpmv.supabase.co.evil.example'), false)
  assert.equal(isRrCapitalUrl('not-a-url'), false)
})

test('summary RPC forwards only the user bearer token to one fixed read-only route', async () => {
  const calls = []
  const result = await invokePersonalSummary(
    'https://hnebvwfgsotrknxpgpmv.supabase.co',
    'sb_publishable_test_key',
    ridhuJwt,
    async (url, init) => {
      calls.push({ url: String(url), init })
      return Response.json(allowed)
    },
  )
  assert.deepEqual(result, { data: allowed, error: null })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://hnebvwfgsotrknxpgpmv.supabase.co/rest/v1/rpc/personal_summary')
  assert.equal(calls[0].init.method, 'POST')
  assert.equal(calls[0].init.headers.apikey, 'sb_publishable_test_key')
  assert.equal(calls[0].init.headers.authorization, `Bearer ${ridhuJwt}`)
  assert.equal(calls[0].init.body, '{}')
  assert.equal(new URL(calls[0].url).search, '')
  assert.equal(JSON.stringify(calls[0].init).includes(anotherUserId), false)
})

test('owner-pin RPC denial is returned as access denied without summary data', async () => {
  const { data, error } = await invokePersonalSummary(
    'https://hnebvwfgsotrknxpgpmv.supabase.co',
    'sb_publishable_test_key',
    anotherJwt,
    async () => Response.json({ code: '42501', message: 'permission denied' }, { status: 403 }),
  )
  assert.equal(data, null)
  assert.deepEqual(error, { code: '42501' })
})

test('endpoint has no service-role, direct database login, or static Perry token capability', async () => {
  const handlerSource = await readFile(new URL('./handler.ts', import.meta.url), 'utf8')
  const indexSource = await readFile(new URL('./index.ts', import.meta.url), 'utf8')
  const rpcSource = await readFile(new URL('./rpc.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(handlerSource + indexSource + rpcSource, /SUPABASE_SERVICE_ROLE_KEY|service_role|PERRY_READER_SIGNING_KEY|PERRY_ACCESS_TOKEN_SHA256|createReaderToken|PERRY_DATABASE_URL|@db\/postgres/i)
  assert.match(indexSource, /auth\/v1\/user/)
  assert.match(rpcSource, /rest\/v1\/rpc\/personal_summary/)
  assert.match(handlerSource, /queryPersonalSummary\(bearer\[1\]\)/)
  assert.equal((rpcSource.match(/\/rest\/v1\/rpc\//g) ?? []).length, 1, 'the edge broker targets exactly one RPC')
})

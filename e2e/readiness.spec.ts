import { expect, test, type Page, type Route } from '@playwright/test'

const backendOrigin = 'https://rr-capital-test.invalid'
const syntheticUserId = '00000000-0000-4000-a000-000000000099'
const syntheticUser = {
  id: syntheticUserId,
  aud: 'authenticated',
  role: 'authenticated',
  email: 'synthetic-owner@example.invalid',
  app_metadata: { provider: 'email', providers: ['email'] },
  user_metadata: { full_name: 'Synthetic Owner' },
  identities: [],
  created_at: '2026-01-01T00:00:00.000Z',
}
const syntheticAccountId = '10000000-0000-4000-a000-000000000099'
const syntheticCategoryId = '20000000-0000-4000-a000-000000000099'
const syntheticTransactions = [
  {
    id: '30000000-0000-4000-a000-000000000099',
    amount: 1250,
    fee_amount: 0,
    description: 'Synthetic groceries',
    created_at: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
    from_account_id: syntheticAccountId,
    to_account_id: null,
    tagged_profile_id: null,
    contact_id: null,
    category_id: syntheticCategoryId,
    status: 'COMPLETED',
    owner_id: syntheticUserId,
  },
  {
    id: '30000000-0000-4000-a000-000000000098',
    amount: 50000,
    fee_amount: 0,
    description: 'Synthetic salary',
    created_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    from_account_id: null,
    to_account_id: syntheticAccountId,
    tagged_profile_id: null,
    contact_id: null,
    category_id: null,
    status: 'COMPLETED',
    owner_id: syntheticUserId,
  },
]

function encodeJwtPayload(payload: Record<string, unknown>) {
  return Buffer.from(JSON.stringify(payload)).toString('base64url')
}

function syntheticSession() {
  const now = Math.floor(Date.now() / 1000)
  const accessToken = `e30.${encodeJwtPayload({
    sub: syntheticUserId,
    aud: 'authenticated',
    role: 'authenticated',
    exp: now + 3600,
    iat: now,
  })}.synthetic-signature`

  return {
    access_token: accessToken,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: now + 3600,
    refresh_token: 'synthetic-refresh-token',
    user: syntheticUser,
  }
}

const enabledFeatures = [
  'budgets',
  'calculators',
  'savings_goals',
  'shopping_lists',
  'financial_health_score',
  'account_health',
].map(feature_key => ({ feature_key, enabled: true }))

const syntheticProfile = {
  id: syntheticUserId,
  full_name: 'Synthetic Owner',
  username: 'synthetic-owner',
  theme_mode: 'dark',
  theme_accent: 'amber',
  ai_model: null,
  ai_persona: null,
  telegram_chat_id: null,
  is_biometric_enabled: false,
  registered_devices: [],
}

type MockEvidence = {
  unexpectedOrigins: string[]
  blockedBrowserExtensionOrigins: string[]
  tableMutations: string[]
  unexpectedRpcs: string[]
}

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'apikey,authorization,content-type,x-client-info,prefer,range,accept-profile,content-profile',
      'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
      'access-control-expose-headers': 'content-range,range,content-profile',
      'content-range': '0-0/0',
    },
    body: JSON.stringify(body),
  })
}

async function installSyntheticBackend(page: Page): Promise<MockEvidence> {
  const evidence: MockEvidence = { unexpectedOrigins: [], blockedBrowserExtensionOrigins: [], tableMutations: [], unexpectedRpcs: [] }

  await page.addInitScript(({ storageKey, session }) => {
    localStorage.setItem(storageKey, JSON.stringify(session))
  }, {
    storageKey: 'sb-rr-capital-test-auth-token',
    session: syntheticSession(),
  })

  await page.route('**/*', async route => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.origin === 'http://127.0.0.1:5191') {
      await route.continue()
      return
    }

    if (url.origin !== backendOrigin) {
      // Managed browsers may inject their security extension into pages. Keep
      // blocking its request and report it separately from application traffic.
      if (/\.kis\.v2\.scr\.kaspersky-labs\.com$/i.test(url.hostname)) {
        evidence.blockedBrowserExtensionOrigins.push(url.origin)
      } else {
        evidence.unexpectedOrigins.push(url.origin)
      }
      await route.abort('blockedbyclient')
      return
    }

    const method = request.method().toUpperCase()
    const path = url.pathname
    if (method === 'OPTIONS') {
      await fulfillJson(route, {}, 204)
      return
    }

    if (path === '/auth/v1/user' && method === 'GET') {
      await fulfillJson(route, syntheticUser)
      return
    }

    if (path === '/rest/v1/user_feature_flags' && method === 'GET') {
      await fulfillJson(route, enabledFeatures)
      return
    }

    if (path === '/rest/v1/profiles' && method === 'GET') {
      await fulfillJson(route, syntheticProfile)
      return
    }

    if (path === '/rest/v1/accounts' && method === 'GET') {
      await fulfillJson(route, [{ id: syntheticAccountId, owner_id: syntheticUserId, name: 'Synthetic primary bank', type: 'bank', credit_limit: null, opening_balance: 20_000, opening_date: '2026-01-01' }])
      return
    }

    if (path === '/rest/v1/account_balances' && method === 'GET') {
      await fulfillJson(route, [{ id: syntheticAccountId, balance: 68_750 }])
      return
    }

    if (path === '/rest/v1/transactions' && method === 'GET') {
      await fulfillJson(route, syntheticTransactions)
      return
    }

    if (path === '/rest/v1/transaction_categories' && method === 'GET') {
      await fulfillJson(route, [{ id: syntheticCategoryId, name: 'Synthetic household', color: '#34d399' }])
      return
    }

    if (path.startsWith('/rest/v1/rpc/')) {
      const rpcName = path.slice('/rest/v1/rpc/'.length)
      const readOnlyRpcs = new Set([
        'financial_health_excluded_transaction_ids',
        'list_installment_occurrences',
        'profile_labels',
      ])
      if (!readOnlyRpcs.has(rpcName)) evidence.unexpectedRpcs.push(`${method} ${rpcName}`)
      await fulfillJson(route, [])
      return
    }

    if (path === '/functions/v1/manage-gemini-key' && method === 'POST') {
      const requestBody = request.postDataJSON() as { action?: unknown } | null
      if (requestBody?.action !== 'status') evidence.tableMutations.push(`POST ${path} unexpected action`)
      await fulfillJson(route, { hasKey: false, configured: false })
      return
    }

    if (path.startsWith('/rest/v1/') && !path.startsWith('/rest/v1/rpc/')) {
      if (!['GET', 'HEAD'].includes(method)) evidence.tableMutations.push(`${method} ${path}`)
      await fulfillJson(route, [])
      return
    }

    evidence.tableMutations.push(`${method} ${path}`)
    await fulfillJson(route, { message: 'Unexpected synthetic backend route' }, 404)
  })

  return evidence
}

test('protected pages send anonymous visitors to the invitation-only sign-in page', async ({ page }) => {
  await page.goto('/accounts')
  await expect(page).toHaveURL(/\/auth$/)
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()
  await expect(page.getByText(/Access is invitation-only/i)).toBeVisible()
})

test('dated opening balance submission stays inside the synthetic backend', async ({ page }) => {
  const evidence = await installSyntheticBackend(page)
  const submittedAccounts: Array<Record<string, unknown>> = []
  const submittedAuthorization: string[] = []

  await page.route(`${backendOrigin}/rest/v1/accounts`, async route => {
    const request = route.request()
    if (request.method().toUpperCase() !== 'POST') {
      await fulfillJson(route, [{ id: syntheticAccountId, owner_id: syntheticUserId, name: 'Synthetic primary bank', type: 'bank', credit_limit: null, opening_balance: 20_000, opening_date: '2026-01-01' }])
      return
    }

    submittedAccounts.push(request.postDataJSON() as Record<string, unknown>)
    submittedAuthorization.push(request.headers()['authorization'] ?? '')
    await route.fulfill({
      status: 201,
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-headers': 'apikey,authorization,content-type,x-client-info,prefer,range,accept-profile,content-profile',
        'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
        'content-type': 'application/json',
      },
      body: JSON.stringify([{ id: '10000000-0000-4000-a000-000000000088' }]),
    })
  })

  await page.goto('/accounts')
  await page.getByRole('button', { name: /Add Account/ }).click()
  await page.getByPlaceholder('e.g., SBI Savings').fill('Synthetic dated account')
  await page.getByLabel('Starting balance').fill('1250.50')
  await page.getByLabel('Start tracking from').fill('2026-09-01')
  await page.getByRole('button', { name: 'Create Account' }).click()

  await expect.poll(() => submittedAccounts.length).toBe(1)
  expect(submittedAccounts[0]).toMatchObject({
    name: 'Synthetic dated account',
    type: 'bank',
    owner_id: syntheticUserId,
    opening_balance: 1250.5,
    opening_date: '2026-09-01',
  })
  expect(submittedAuthorization).toEqual([expect.stringMatching(/^Bearer e30\./)])
  expect(new URL(backendOrigin).hostname).toBe('rr-capital-test.invalid')
  expect(evidence.unexpectedOrigins).toEqual([])
  expect(evidence.blockedBrowserExtensionOrigins.every(origin => /\.kis\.v2\.scr\.kaspersky-labs\.com$/i.test(new URL(origin).hostname))).toBe(true)
  expect(evidence.unexpectedRpcs).toEqual([])
})

test('transaction before its account opening date is rejected before an outbox or network write', async ({ page }) => {
  const evidence = await installSyntheticBackend(page)

  await page.goto('/accounts')
  await page.getByRole('button', { name: 'Open add menu' }).click()
  await page.getByRole('button', { name: 'Transaction' }).click()

  await page.getByRole('combobox').selectOption(syntheticAccountId)
  await page.getByPlaceholder('0.00').fill('25')
  await page.getByLabel('Occurrence date').fill('2025-12-31')
  await page.getByPlaceholder('e.g., Rent Payment, Groceries').fill('Synthetic date boundary check')
  await page.getByRole('button', { name: 'Log Transaction' }).click()

  expect(evidence.unexpectedRpcs).toEqual([])
  expect(evidence.tableMutations).toEqual([])
  await expect(page.getByText('Choose an occurrence date on or after the account start date.')).toBeVisible()
  expect(evidence.unexpectedOrigins).toEqual([])
})

test('transaction occurrence date is sent unchanged as India-time noon to the ledger RPC', async ({ page }) => {
  await installSyntheticBackend(page)
  const ledgerCalls: Array<Record<string, unknown>> = []
  const ledgerAuthorization: string[] = []

  await page.route(`${backendOrigin}/rest/v1/rpc/post_ledger_transaction`, async route => {
    ledgerCalls.push(route.request().postDataJSON() as Record<string, unknown>)
    ledgerAuthorization.push(route.request().headers()['authorization'] ?? '')
    await fulfillJson(route, null)
  })

  await page.goto('/accounts')
  await page.getByRole('button', { name: 'Open add menu' }).click()
  await page.getByRole('button', { name: 'Transaction' }).click()
  await page.getByRole('combobox').selectOption(syntheticAccountId)
  await page.getByPlaceholder('0.00').fill('25.50')
  await page.getByLabel('Occurrence date').fill('2026-09-03')
  await page.getByPlaceholder('e.g., Rent Payment, Groceries').fill('Synthetic dated expense')
  await page.getByRole('button', { name: 'Log Transaction' }).click()

  await expect.poll(() => ledgerCalls.length).toBe(1)
  expect(ledgerCalls[0]).toMatchObject({
    p_from_account_id: syntheticAccountId,
    p_to_account_id: null,
    p_amount: 25.5,
    p_fee_amount: 0,
    p_description: 'Synthetic dated expense',
    p_created_at: '2026-09-03T06:30:00.000Z',
  })
  expect(ledgerAuthorization).toEqual([expect.stringMatching(/^Bearer e30\./)])
  expect(await page.getByRole('dialog').count()).toBe(0)
})

test('all application pages render from synthetic data on desktop and mobile without page-load writes', async ({ page }) => {
  test.setTimeout(120_000)
  const evidence = await installSyntheticBackend(page)
  const browserErrors: string[] = []
  page.on('pageerror', error => browserErrors.push(error.message))
  page.on('console', message => {
    if (message.type() === 'error' && !message.text().includes('net::ERR_BLOCKED_BY_CLIENT.Inspector')) {
      browserErrors.push(`${page.url()}: ${message.text()}`)
    }
  })
  page.on('requestfailed', request => {
    if (!/\.kis\.v2\.scr\.kaspersky-labs\.com$/i.test(new URL(request.url()).hostname)) {
      browserErrors.push(`Failed request: ${request.url()}`)
    }
  })

  const pages = [
    { path: '/', title: 'Financial overview' },
    { path: '/calendar', title: 'Calendar & EMIs' },
    { path: '/ledger', title: 'Transactions' },
    { path: '/reports', title: 'Reports' },
    { path: '/budgets', title: 'Budgets' },
    { path: '/calculators', title: 'Calculators' },
    { path: '/savings-goals', title: 'Savings goals' },
    { path: '/shopping-lists', title: 'Shopping lists' },
    { path: '/financial-health', title: 'Financial wellness' },
    { path: '/accounts', title: 'Accounts' },
    { path: '/debts', title: 'Debts & IOUs' },
    { path: '/contacts', title: 'Shadow Contacts' },
    { path: '/settings', title: 'Settings' },
    { path: '/offline', title: 'Offline transactions' },
    { path: '/chittis', title: 'Chitti / ROSCA' },
  ]

  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport)
    for (const item of pages) {
      await page.goto(item.path, { waitUntil: 'domcontentloaded' })
      await expect(page).toHaveURL(new RegExp(`${item.path.replaceAll('/', '\\/')}$`))
      await expect(page.locator('main').first()).toBeVisible()
      await expect(page.getByRole('heading', { name: item.title, exact: true }).first()).toBeVisible()
      if (item.path === '/accounts') await expect(page.getByText('Synthetic primary bank')).toBeVisible()
      if (item.path === '/ledger' || item.path === '/reports') await expect(page.getByText('Synthetic groceries')).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width)
    }
  }

  expect(evidence.unexpectedOrigins).toEqual([])
  expect(evidence.tableMutations).toEqual([])
  expect(evidence.unexpectedRpcs).toEqual([])
  expect(browserErrors).toEqual([])
})

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

function contrastRatio(foreground: string, background: string) {
  const luminance = (color: string) => {
    const channels = color.match(/[\d.]+/g)?.slice(0, 3).map(Number)
    if (!channels || channels.length !== 3) throw new Error(`Unexpected computed color: ${color}`)
    const [red, green, blue] = channels.map(value => {
      const normalized = value / 255
      return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue
  }
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a)
  return (values[0] + 0.05) / (values[1] + 0.05)
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

async function installSyntheticBackend(page: Page, themeMode: 'light' | 'dark' = 'dark'): Promise<MockEvidence> {
  const evidence: MockEvidence = { unexpectedOrigins: [], blockedBrowserExtensionOrigins: [], tableMutations: [], unexpectedRpcs: [] }
  let featureFlags = [...enabledFeatures]

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
      const requestedFeature = url.searchParams.get('feature_key')?.replace(/^eq\./, '')
      await fulfillJson(route, requestedFeature ? featureFlags.filter(flag => flag.feature_key === requestedFeature) : featureFlags)
      return
    }

    if (path === '/rest/v1/user_feature_flags' && ['POST', 'PATCH'].includes(method)) {
      const body = request.postDataJSON() as { feature_key?: string; enabled?: boolean } | Array<{ feature_key?: string; enabled?: boolean }> | null
      const requestedFeature = url.searchParams.get('feature_key')?.replace(/^eq\./, '')
      const updates = (Array.isArray(body) ? body : body ? [body] : []).map(update => ({ ...update, feature_key: update.feature_key ?? requestedFeature }))
      featureFlags = featureFlags.filter(flag => !updates.some(update => update.feature_key === flag.feature_key))
      featureFlags.push(...updates.filter((update): update is { feature_key: string; enabled: boolean } => typeof update.feature_key === 'string' && typeof update.enabled === 'boolean'))
      await fulfillJson(route, [], method === 'POST' ? 201 : 200)
      return
    }

    if (path === '/rest/v1/profiles' && method === 'GET') {
      await fulfillJson(route, { ...syntheticProfile, theme_mode: themeMode })
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

test('desktop navigation follows the page matrix and logo opens the creator profile', async ({ page }) => {
  await installSyntheticBackend(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')

  const primary = page.getByRole('navigation', { name: 'Primary navigation' })
  for (const label of ['Dashboard', 'Calendar', 'Ledger', 'Reports', 'Accounts']) {
    await expect(primary.getByRole('link', { name: label })).toBeVisible()
  }
  await primary.getByRole('button', { name: 'About RR Capital and its creator' }).click()
  const creator = page.getByRole('dialog', { name: 'Ridhwan S.' })
  await expect(creator).toBeVisible()
  const backdropFilter = await creator.evaluate(element => getComputedStyle(element).backdropFilter)
  expect(backdropFilter).toContain('creator-glass-bend')
  for (const label of ['GitHub', 'Instagram', 'LinkedIn', 'Portfolio']) await expect(creator.getByRole('link', { name: new RegExp(label) })).toBeVisible()
  await creator.getByRole('button', { name: 'Close creator profile' }).click()

  await primary.getByRole('button', { name: /More/ }).click()
  const menu = page.getByRole('menu')
  for (const label of ['Workspace', 'Optional modules', 'Preferences']) await expect(menu.getByRole('region', { name: label })).toBeVisible()
  for (const label of ['Chittis', 'Debts & IOUs', 'Contacts', 'Offline queue', 'Budgets', 'Calculators', 'Savings goals', 'Shopping lists', 'Financial wellness', 'Settings']) {
    await expect(menu.getByRole('link', { name: new RegExp(label) })).toBeVisible()
  }
  await expect(menu.getByRole('link', { name: 'Calendar' })).toHaveCount(0)
  const addButton = page.locator('button.app-desktop-fab')
  await expect(addButton).toBeVisible()
  await expect(addButton).toHaveClass(/app-desktop-fab/)
  await expect(addButton).toHaveClass(/rounded-full/)
  await addButton.click()
  const addActions = page.getByRole('button', { name: 'Transaction' })
  await expect(addActions).toBeVisible()
  await expect(page.getByRole('button', { name: 'Debt / IOU' })).toBeVisible()
  await expect(page.locator('nav[aria-label="Mobile navigation"]')).toBeHidden()
  await addButton.click()
  const dashboardHeading = page.getByRole('heading', { name: 'Financial overview' })
  await expect(dashboardHeading).toBeVisible()
  const headingGap = await dashboardHeading.evaluate(element => {
    const main = element.closest('main')
    if (!main) throw new Error('Dashboard heading is outside the app main region')
    return element.getBoundingClientRect().top - main.getBoundingClientRect().top
  })
  expect(headingGap).toBeLessThan(64)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1440)
})

test('liquid preference switches preserve native switch semantics and keyboard control', async ({ page }) => {
  const evidence = await installSyntheticBackend(page)
  await page.goto('/settings?section=modules')
  const budgets = page.getByRole('switch', { name: 'Budgets' })
  await expect(budgets).toBeVisible()
  await expect(budgets).toHaveClass(/liquid-switch/)
  await expect(budgets).toHaveAttribute('aria-checked', 'true')
  page.once('dialog', dialog => void dialog.accept())
  await budgets.click()
  await expect(budgets).toHaveAttribute('aria-checked', 'false')
  const guidedTips = page.getByRole('switch', { name: 'Guided page tips' })
  await expect(guidedTips).toHaveClass(/liquid-switch/)
  expect(evidence.unexpectedOrigins).toEqual([])
  expect(evidence.tableMutations).toEqual([])
})

test('native range keeps keyboard support and glass styling', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => {
    const label = document.createElement('label')
    label.htmlFor = 'glass-range'
    label.textContent = 'Glass range'
    const input = document.createElement('input')
    input.id = 'glass-range'
    input.className = 'liquid-range'
    input.type = 'range'
    input.min = '0'
    input.max = '100'
    input.value = '40'
    input.style.setProperty('--range-progress', '40%')
    document.body.append(label, input)
  })
  const slider = page.getByRole('slider', { name: 'Glass range' })
  await expect(slider).toHaveValue('40')
  const initialStyle = await slider.evaluate(element => ({
    className: element.className,
    progress: getComputedStyle(element).getPropertyValue('--range-progress').trim(),
    minHeight: getComputedStyle(element).minHeight,
  }))
  expect(initialStyle.className).toContain('liquid-range')
  expect(initialStyle.progress).toBe('40%')
  expect(initialStyle.minHeight).toBe('28px')
  await slider.focus()
  await page.keyboard.press('ArrowRight')
  await expect(slider).toHaveValue('41')
})

test('mobile navigation uses the five fixed slots and grouped More drawer', async ({ page }) => {
  await installSyntheticBackend(page, 'light')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')

  const mobile = page.getByRole('navigation', { name: 'Mobile navigation' })
  await expect(mobile.getByRole('link', { name: 'Dashboard' })).toBeVisible()
  await expect(mobile.getByRole('link', { name: 'Ledger' })).toBeVisible()
  await expect(mobile.getByRole('button', { name: 'Add transaction or debt' })).toBeVisible()
  const addButton = mobile.locator('button.app-mobile-fab')
  await expect(addButton).toHaveClass(/rounded-full/)
  await expect(addButton).toHaveClass(/-mt-7/)
  await addButton.click()
  const quickAdd = page.getByRole('group', { name: 'Quick add actions' })
  await expect(quickAdd.getByRole('button', { name: 'Transaction' })).toBeVisible()
  await expect(quickAdd.getByRole('button', { name: 'Add Debt / IOU' })).toBeVisible()
  await quickAdd.getByRole('button', { name: 'Transaction' }).click()
  await expect(page.getByRole('heading', { name: 'New Transaction' })).toBeVisible()
  const transactionPlaceholderColors = await page.locator('.app-financial-entry-modal input[placeholder]').evaluateAll(elements => elements.map(element => getComputedStyle(element, '::placeholder').color))
  expect(transactionPlaceholderColors.length).toBeGreaterThan(0)
  expect(transactionPlaceholderColors.every(color => color === 'rgb(89, 87, 79)')).toBe(true)
  await page.getByRole('button', { name: 'Close transaction' }).click()
  await expect(page.getByRole('heading', { name: 'New Transaction' })).toBeHidden()
  await addButton.click()
  await quickAdd.getByRole('button', { name: 'Add Debt / IOU' }).click()
  await expect(page.getByRole('heading', { name: 'Track P2P Debt' })).toBeVisible()
  const debtPlaceholderColors = await page.locator('.app-financial-entry-modal input[placeholder]').evaluateAll(elements => elements.map(element => getComputedStyle(element, '::placeholder').color))
  expect(debtPlaceholderColors.length).toBeGreaterThan(0)
  expect(debtPlaceholderColors.every(color => color === 'rgb(89, 87, 79)')).toBe(true)
  await page.getByRole('button', { name: 'Close debt form' }).click()
  await expect(page.getByRole('heading', { name: 'Track P2P Debt' })).toBeHidden()
  await addButton.click()
  await mobile.locator('button[aria-expanded="true"]').click()
  for (const viewport of [{ width: 320, height: 568 }, { width: 360, height: 640 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport)
    await addButton.click()
    const addActions = [page.getByRole('button', { name: 'Transaction' }), page.getByRole('button', { name: 'Add Debt \/ IOU' })]
    for (const action of addActions) {
      const bounds = await action.boundingBox()
      expect(bounds).not.toBeNull()
      expect(bounds!.x).toBeGreaterThanOrEqual(0)
      expect(bounds!.y).toBeGreaterThanOrEqual(0)
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width)
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height)
    }
    const fabBounds = await addButton.boundingBox()
    expect(fabBounds).not.toBeNull()
    expect(fabBounds!.x + fabBounds!.width / 2).toBeCloseTo(viewport.width / 2, 0)
    const firstActionBounds = await addActions[0].boundingBox()
    const secondActionBounds = await addActions[1].boundingBox()
    expect(firstActionBounds).not.toBeNull()
    expect(secondActionBounds).not.toBeNull()
    expect(firstActionBounds!.y + firstActionBounds!.height).toBeLessThanOrEqual(secondActionBounds!.y)
    expect(secondActionBounds!.y + secondActionBounds!.height).toBeLessThanOrEqual(fabBounds!.y)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width)
    await mobile.locator('button[aria-expanded="true"]').click()
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await addButton.click()
  await expect(page.getByRole('button', { name: 'Transaction' })).toBeVisible()
  const lightContrast = await page.evaluate(() => {
    const actionGroup = document.querySelector<HTMLElement>('[role="group"][aria-label="Quick add actions"]')
    const transaction = actionGroup?.querySelector<HTMLButtonElement>('button:first-child')
    const debt = actionGroup?.querySelector<HTMLButtonElement>('button:last-child')
    const fab = document.querySelector<HTMLButtonElement>('button.app-mobile-fab')
    if (!transaction || !debt || !fab) throw new Error('The floating Add controls are not rendered')
    const readPair = (foreground: HTMLElement, background: HTMLElement) => ({
      foreground: getComputedStyle(foreground).color,
      background: getComputedStyle(background).backgroundColor,
    })
    return {
      labels: [readPair(transaction, transaction), readPair(debt, debt)],
      icons: [transaction.lastElementChild, debt.lastElementChild].map(icon => {
        if (!(icon instanceof HTMLElement)) throw new Error('An Add action icon is missing')
        return readPair(icon, icon)
      }),
      fab: readPair(fab, fab),
    }
  })
  for (const pair of lightContrast.labels) expect(contrastRatio(pair.foreground, pair.background), JSON.stringify(pair)).toBeGreaterThanOrEqual(4.5)
  for (const pair of [...lightContrast.icons, lightContrast.fab]) expect(contrastRatio(pair.foreground, pair.background), JSON.stringify(pair)).toBeGreaterThanOrEqual(3)
  await mobile.locator('button[aria-expanded="true"]').click()
  await expect(mobile.getByRole('link', { name: 'Chittis' })).toBeVisible()
  await mobile.getByRole('button', { name: 'Open more pages' }).click()
  const drawer = page.getByRole('dialog', { name: 'More pages' })
  for (const label of ['Calendar', 'Reports', 'Accounts', 'Debts & IOUs', 'Contacts', 'Offline queue', 'Budgets', 'Calculators', 'Savings goals', 'Shopping lists', 'Financial wellness', 'Settings']) {
    await expect(drawer.getByRole('link', { name: new RegExp(label) })).toBeVisible()
  }
  await expect(page.locator('.app-mobile-context')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
})

test('disabled optional routes return to dashboard and unknown routes show a notice', async ({ page }) => {
  await installSyntheticBackend(page)
  await page.route('**/rest/v1/user_feature_flags**', route => fulfillJson(route, []))
  await page.goto('/calculators')
  await expect(page).toHaveURL(/\/$/)

  await page.goto('/not-a-real-page')
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('status').filter({ hasText: 'That page does not exist' })).toBeVisible()
})

test('settings presents release information and manual update check', async ({ page }) => {
  await installSyntheticBackend(page)
  await page.goto('/settings?section=updates')
  await expect(page.getByRole('heading', { name: 'App updates' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Check for updates' })).toBeVisible()
  await expect(page.getByText(/Latest release .*2026\.10\.03\.4/)).toBeVisible()
  await expect(page.getByText(/RR creator profile now has a refractive glass surface/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'View detailed summary' })).toBeVisible()
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

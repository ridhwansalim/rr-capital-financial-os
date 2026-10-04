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
  is_biometric_enabled: false,
  registered_devices: [],
  navbar_layout: { mobileSelectedUrls: ['/ledger', '/chittis'], desktopSelectedUrls: ['/ledger', '/calendar', '/chittis'] },
}

function contrastRatio(foreground: string, background: string) {
  const parseChannels = (color: string) => {
    const channels = color.match(/[\d.]+/g)?.slice(0, 3).map(Number)
    if (!channels || channels.length !== 3) throw new Error(`Unexpected computed color: ${color}`)
    return color.startsWith('color(srgb') ? channels : channels.map(value => value / 255)
  }
  const luminance = (color: string) => {
    const [red, green, blue] = parseChannels(color).map(channel => {
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue
  }
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a)
  return (values[0] + 0.05) / (values[1] + 0.05)
}

async function expectModalSwitcherEven(switcher: import('@playwright/test').Locator) {
  const layout = await switcher.evaluate(element => {
    const track = element.getBoundingClientRect()
    const items = Array.from(element.querySelectorAll<HTMLElement>('.liquid-switcher__item'))
    const widths = items.map(item => item.getBoundingClientRect().width)
    const active = items.find(item => item.classList.contains('is-active'))
    return {
      trackWidth: track.width,
      widths,
      capWidth: Number.parseFloat(getComputedStyle(element).getPropertyValue('--cap-w')),
      activeWidth: active?.offsetWidth ?? 0,
      capX: Number.parseFloat(getComputedStyle(element).getPropertyValue('--cap-x')),
      activeX: active?.offsetLeft ?? 0,
    }
  })
  expect(layout.trackWidth).toBeGreaterThan(0)
  expect(Math.max(...layout.widths) - Math.min(...layout.widths)).toBeLessThanOrEqual(1)
  expect(layout.widths.reduce((sum, width) => sum + width, 0)).toBeGreaterThan(layout.trackWidth * 0.75)
  const expectedCapWidth = Math.min(layout.activeWidth + 10, layout.trackWidth - 4)
  const expectedCapX = Math.min(
    layout.trackWidth - 2 - expectedCapWidth,
    Math.max(2, layout.activeX - 5)
  )
  expect(Math.abs(layout.capWidth - expectedCapWidth)).toBeLessThanOrEqual(1)
  expect(Math.abs(layout.capX - expectedCapX)).toBeLessThanOrEqual(1)
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

async function installSyntheticBackend(page: Page, themeMode: 'light' | 'dark' = 'dark', emptyFinanceData = false): Promise<MockEvidence> {
  const evidence: MockEvidence = { unexpectedOrigins: [], blockedBrowserExtensionOrigins: [], tableMutations: [], unexpectedRpcs: [] }
  let featureFlags = [...enabledFeatures]
  let navbarLayout = structuredClone(syntheticProfile.navbar_layout)

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
      await fulfillJson(route, { ...syntheticProfile, navbar_layout: navbarLayout, theme_mode: themeMode })
      return
    }

    if (path === '/rest/v1/profiles' && method === 'PATCH') {
      const body = request.postDataJSON() as { navbar_layout?: typeof navbarLayout }
      if (body.navbar_layout) navbarLayout = body.navbar_layout
      await fulfillJson(route, { ...syntheticProfile, navbar_layout: navbarLayout, theme_mode: themeMode })
      return
    }

    if (path === '/rest/v1/accounts' && method === 'GET') {
      await fulfillJson(route, emptyFinanceData ? [] : [{ id: syntheticAccountId, owner_id: syntheticUserId, name: 'Synthetic primary bank', type: 'bank', credit_limit: null, opening_balance: 20_000, opening_date: '2026-01-01' }])
      return
    }

    if (path === '/rest/v1/account_balances' && method === 'GET') {
      await fulfillJson(route, emptyFinanceData ? [] : [{ id: syntheticAccountId, balance: 68_750 }])
      return
    }

    if (path === '/rest/v1/transactions' && method === 'GET') {
      await fulfillJson(route, emptyFinanceData ? [] : syntheticTransactions)
      return
    }

    if (path === '/rest/v1/transaction_categories' && method === 'GET') {
      await fulfillJson(route, emptyFinanceData ? [] : [{ id: syntheticCategoryId, name: 'Synthetic household', color: '#34d399' }])
      return
    }

    if (path.startsWith('/rest/v1/rpc/')) {
      const rpcName = path.slice('/rest/v1/rpc/'.length)
      const readOnlyRpcs = new Set([
        'financial_health_excluded_transaction_ids',
        'get_telegram_link_status',
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

test('desktop navigation uses the Settings module hub and logo opens the creator profile', async ({ page }) => {
  await installSyntheticBackend(page)
  await page.setViewportSize({ width: 1366, height: 768 })
  await page.goto('/')
  await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toHaveJSProperty('offsetTop', 0)
  expect(await page.locator('.liquid-toggle-filters').evaluate(element => element.getBoundingClientRect().height)).toBe(0)

  const primary = page.locator('.app-desktop-nav-switcher')
  for (const label of ['Dashboard', 'Calendar', 'Ledger', 'Chittis', 'Settings']) {
    await expect(primary.getByRole('link', { name: label })).toBeVisible()
  }
  await expect(primary.getByRole('link', { name: 'Reports' })).toHaveCount(0)
  await expect(primary.getByRole('link', { name: 'Accounts' })).toHaveCount(0)
  await page.getByRole('button', { name: 'About RR Capital and its creator' }).click()
  const creator = page.getByRole('dialog', { name: 'Ridhwan S.' })
  await expect(creator).toBeVisible()
  await page.evaluate(() => {
    const surface = document.createElement('div')
    surface.id = 'creator-contrast-test-surface'
    Object.assign(surface.style, { position: 'fixed', inset: '0', zIndex: '79', background: 'rgb(24, 28, 34)' })
    document.body.append(surface)
  })
  await page.evaluate(() => window.dispatchEvent(new Event('scroll')))
  await expect(creator).toHaveAttribute('data-contrast', 'dark-ink')
  await page.locator('#creator-contrast-test-surface').evaluate(element => {
    const surface = element as HTMLElement
    surface.style.transition = 'none'
    surface.style.background = 'rgb(250, 250, 250)'
  })
  await page.evaluate(() => window.dispatchEvent(new Event('scroll')))
  await expect(creator).toHaveAttribute('data-contrast', 'light-ink')
  await page.locator('#creator-contrast-test-surface').evaluate(element => element.remove())
  const creatorBounds = await creator.boundingBox()
  expect(creatorBounds).not.toBeNull()
  expect(creatorBounds!.x).toBeGreaterThanOrEqual(0)
  expect(creatorBounds!.y).toBeGreaterThanOrEqual(0)
  expect(creatorBounds!.x + creatorBounds!.width).toBeLessThanOrEqual(1366)
  expect(creatorBounds!.y + creatorBounds!.height).toBeLessThanOrEqual(768)
  await expect(creator.getByRole('button', { name: 'Close creator profile' })).toBeInViewport()
  await expect(creator.getByRole('img', { name: 'Ridhwan S., creator of RR Capital' })).toHaveJSProperty('complete', true)
  await expect(creator.getByRole('img', { name: 'Ridhwan S., creator of RR Capital' })).not.toHaveJSProperty('naturalWidth', 0)
  await page.screenshot({ path: 'test-results/creator-modal-visual-check.png' })
  await expect(creator).toHaveClass(/glass-card/)
  const glassSurface = await creator.evaluate(element => ({
    backdropFilter: getComputedStyle(element).backdropFilter,
    backgroundColor: getComputedStyle(element).backgroundColor,
    boxShadow: getComputedStyle(element).boxShadow,
    topHighlight: getComputedStyle(element, '::before').backgroundImage,
    edgeHighlight: getComputedStyle(element, '::after').backgroundImage,
    adaptiveColor: getComputedStyle(element.querySelector('.creator-profile-adaptive-copy')!).color,
    adaptiveBlend: getComputedStyle(element.querySelector('.creator-profile-adaptive-copy')!).mixBlendMode,
    pointerHighlight: getComputedStyle(element, '::before').backgroundImage,
  }))
  expect(glassSurface.backdropFilter).toContain('blur(24px)')
  expect(glassSurface.backdropFilter).toContain('saturate(1.9)')
  expect(glassSurface.backgroundColor).toContain('oklab(')
  expect(glassSurface.backgroundColor).toContain(' / ')
  expect(glassSurface.boxShadow).toContain('inset')
  expect(glassSurface.topHighlight).toContain('linear-gradient')
  expect(glassSurface.edgeHighlight).toContain('linear-gradient')
  expect(glassSurface.adaptiveColor).toBe('rgb(255, 255, 255)')
  expect(glassSurface.adaptiveBlend).toBe('normal')
  expect(glassSurface.pointerHighlight).not.toContain('radial-gradient')
  await creator.hover({ position: { x: 80, y: 80 } })
  const tilt = await creator.evaluate(element => ({
    x: element.style.getPropertyValue('--glass-tilt-x'),
    y: element.style.getPropertyValue('--glass-tilt-y'),
  }))
  expect(tilt.x).not.toBe('0deg')
  expect(tilt.y).not.toBe('0deg')
  await page.mouse.move(0, 0)
  await expect.poll(() => creator.evaluate(element => element.style.getPropertyValue('--glass-tilt-x'))).toBe('0deg')
  await expect(creator.getByRole('button', { name: 'Close creator profile' })).toHaveCount(1)
  await expect(creator.getByRole('button', { name: 'Close profile' })).toHaveCount(0)
  for (const [label, expectedColor] of [['GitHub', 'rgb(240, 246, 252)'], ['Instagram', 'rgb(225, 48, 108)'], ['LinkedIn', 'rgb(10, 102, 194)'], ['Portfolio', 'rgb(182, 93, 63)']]) {
    const link = creator.getByRole('link', { name: new RegExp(label) })
    await expect(link).toBeVisible()
    await expect(link.locator('svg').first()).toHaveCSS('color', expectedColor)
  }
  await creator.getByRole('link', { name: /GitHub/ }).hover()
  await expect(creator.getByRole('link', { name: /GitHub/ })).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await creator.getByRole('button', { name: 'Close creator profile' }).click()

  await primary.getByRole('link', { name: 'Settings' }).click()
  await expect(page).toHaveURL(/\/settings$/)
  await expect(page.getByRole('heading', { name: 'Workspace & modules' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Analytics, Planning & Wellness' }).getByRole('link', { name: 'Reports' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Vaults, Directory & Sync' }).getByRole('link', { name: 'Accounts' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Customize Navbar Layout' })).toContainText('2/3 mobile slots')
  await page.getByRole('button', { name: 'Customize Navbar Layout' }).click()
  const layoutDialog = page.getByRole('dialog', { name: 'Customize Navbar Layout' })
  await expect(layoutDialog).toBeVisible()
  const viewportTabs = layoutDialog.getByRole('tablist', { name: 'Navbar viewport layout' })
  await expect(viewportTabs).toContainText('2 / 3')
  await expect(viewportTabs).toContainText('3 / 10')
  await expect(viewportTabs).toHaveClass(/is-ready/)
  await expect.poll(() => viewportTabs.evaluate(element => Number.parseFloat(getComputedStyle(element).getPropertyValue('--cap-w')))).toBeGreaterThan(0)
  await viewportTabs.getByRole('tab', { name: /Mobile/ }).click()
  await expect(viewportTabs.getByRole('tab', { name: /Mobile/ })).toHaveAttribute('aria-selected', 'true')
  const mobileCapX = await viewportTabs.evaluate(element => Number.parseFloat(getComputedStyle(element).getPropertyValue('--cap-x')))
  await viewportTabs.getByRole('tab', { name: /Desktop/ }).click()
  await expect(viewportTabs.getByRole('tab', { name: /Desktop/ })).toHaveAttribute('aria-selected', 'true')
  await expect.poll(() => viewportTabs.evaluate(element => Number.parseFloat(getComputedStyle(element).getPropertyValue('--cap-x')))).not.toBe(mobileCapX)
  const desktopTab = viewportTabs.getByRole('tab', { name: /Desktop/ })
  await expect(desktopTab.locator('.navbar-viewport-switcher__count')).toHaveText('3 / 10')
  await page.setViewportSize({ width: 1024, height: 900 })
  await expect(desktopTab.locator('.navbar-viewport-switcher__count')).toHaveText('3 / 5')
  await page.setViewportSize({ width: 1440, height: 900 })
  await expect(desktopTab.locator('.navbar-viewport-switcher__count')).toHaveText('3 / 10')
  await expect.poll(() => viewportTabs.evaluate(element => Number.parseFloat(getComputedStyle(element).getPropertyValue('--cap-w')))).toBeGreaterThan(0)
  await viewportTabs.getByRole('tab', { name: /Mobile/ }).click()
  await expect(viewportTabs.getByRole('tab', { name: /Mobile/ })).toHaveAttribute('aria-selected', 'true')
  await viewportTabs.getByRole('tab', { name: /Desktop/ }).click()
  await expect(viewportTabs.getByRole('tab', { name: /Desktop/ })).toHaveAttribute('aria-selected', 'true')
  const desktopAddFab = page.locator('button.app-desktop-fab')
  const desktopAddContainer = page.locator('.app-desktop-add')
  await expect(desktopAddContainer).toHaveCSS('position', 'fixed')
  expect(await desktopAddContainer.evaluate(element => element.parentElement === document.body)).toBe(true)
  const fabBounds = await desktopAddFab.boundingBox()
  const viewport = page.viewportSize()
  expect(fabBounds).not.toBeNull()
  expect(viewport).not.toBeNull()
  expect(fabBounds!.y).toBeGreaterThan(viewport!.height - 100)
  expect(fabBounds!.x + fabBounds!.width).toBeGreaterThan(viewport!.width - 100)
  expect(fabBounds!.x + fabBounds!.width).toBeCloseTo(viewport!.width - 32, 0)
  expect(fabBounds!.y + fabBounds!.height).toBeCloseTo(viewport!.height - 32, 0)
  const accountsSwitch = layoutDialog.getByRole('switch', { name: 'Show Accounts in desktop navbar' })
  await accountsSwitch.click()
  await expect(accountsSwitch).toHaveAttribute('aria-checked', 'true')
  for (let i = 0; i < 3; i += 1) await layoutDialog.getByRole('button', { name: 'Move Accounts up' }).click()
  const ledgerSwitch = layoutDialog.getByRole('switch', { name: 'Show Ledger in desktop navbar' })
  await ledgerSwitch.click()
  await expect(ledgerSwitch).toHaveAttribute('aria-checked', 'false')
  await layoutDialog.getByRole('button', { name: 'Close navbar customization' }).click()
  await expect.poll(() => page.evaluate(userId => {
    const layout = JSON.parse(localStorage.getItem(`rr-capital.workspace-layout.v1.${userId}`) || '{}')
    return layout.navbarLayout.desktopSelectedUrls
  }, syntheticUserId)).toEqual(['/accounts', '/calendar', '/chittis'])
  await expect(primary.getByRole('link', { name: 'Accounts' })).toBeVisible()
  await expect(primary.getByRole('link', { name: 'Ledger' })).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Core Operations & Daily Flow' }).getByRole('link', { name: 'Ledger' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Vaults, Directory & Sync' }).getByRole('link', { name: 'Accounts' })).toHaveCount(0)
  await page.getByRole('region', { name: 'Analytics, Planning & Wellness' }).getByRole('link', { name: 'Reports' }).click()
  await expect(page.getByRole('navigation', { name: 'Workspace breadcrumb' })).toContainText('Analytics, Planning & Wellness')
  await expect(page.getByRole('button', { name: /Move to Navbar/ })).toBeVisible()
  await page.getByRole('button', { name: /Move to Navbar/ }).click()
  await expect(primary.getByRole('link', { name: 'Reports' })).toBeVisible()
  await primary.getByRole('link', { name: 'Dashboard' }).click()
  await expect(primary.locator('[data-glass-key="/"]')).toHaveClass(/is-active/)
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
  for (const label of ['Quick date ranges', 'Account filters', 'Transaction filters']) {
    const switcher = page.locator(`.liquid-switcher[aria-label="${label}"]`)
    const sizing = await switcher.evaluate(element => {
      const track = element.getBoundingClientRect()
      const card = element.closest('section')!.getBoundingClientRect()
      const active = element.querySelector<HTMLElement>('.liquid-switcher__item.is-active')!
      return { trackWidth: track.width, cardWidth: card.width, activeWidth: active.offsetWidth, activeX: active.offsetLeft, capX: Number.parseFloat(getComputedStyle(element).getPropertyValue('--cap-x')), capWidth: Number.parseFloat(getComputedStyle(element).getPropertyValue('--cap-w')) }
    })
    expect(sizing.trackWidth).toBeLessThan(sizing.cardWidth * 0.8)
    const expectedCapWidth = Math.min(sizing.activeWidth + 10, sizing.trackWidth - 4)
    const expectedCapX = Math.min(sizing.trackWidth - 2 - expectedCapWidth, Math.max(2, sizing.activeX - 5))
    expect(Math.abs(sizing.capWidth - expectedCapWidth)).toBeLessThanOrEqual(1)
    expect(Math.abs(sizing.capX - expectedCapX)).toBeLessThanOrEqual(1)
  }
  const headingGap = await dashboardHeading.evaluate(element => {
    const main = element.closest('main')
    if (!main) throw new Error('Dashboard heading is outside the app main region')
    return element.getBoundingClientRect().top - main.getBoundingClientRect().top
  })
  expect(headingGap).toBeLessThan(100)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1440)
})

test('Global quick add exposes Split a Bill on desktop and mobile', async ({ page }) => {
  const evidence = await installSyntheticBackend(page)
  await page.setViewportSize({ width: 1366, height: 768 })
  await page.goto('/')

  const desktopFab = page.locator('button.app-desktop-fab')
  await expect(desktopFab).toBeVisible()
  await expect(page.getByRole('button', { name: 'Split a bill' })).toHaveCount(0)
  await desktopFab.click()
  await expect(desktopFab).toHaveAttribute('aria-expanded', 'true')
  const splitButton = page.getByRole('button', { name: 'Split a Bill' })
  await expect(splitButton).toBeVisible()
  await splitButton.click()

  const dialog = page.getByRole('dialog', { name: 'Split a Bill' })
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('input[aria-label="Total bill amount"]')).toBeVisible()
  await expect(dialog.locator('input[aria-label="Bill description"]')).toBeVisible()
  await expect(dialog.locator('select[aria-label="Account that paid for the bill"]')).toBeVisible()
  const desktopFit = await dialog.evaluate(element => {
    const box = element.getBoundingClientRect()
    const tabs = element.querySelector('[aria-label="Split calculation mode"]')!
    const tabItems = Array.from(tabs.querySelectorAll<HTMLElement>('[data-glass-key]'))
    return { top: box.top, bottom: box.bottom, height: box.height, viewport: window.innerHeight, widths: tabItems.map(item => item.getBoundingClientRect().width) }
  })
  expect(desktopFit.top).toBeGreaterThanOrEqual(0)
  expect(desktopFit.bottom).toBeLessThanOrEqual(desktopFit.viewport)
  expect(Math.max(...desktopFit.widths) - Math.min(...desktopFit.widths)).toBeLessThanOrEqual(1)
  await expect(dialog.getByRole('button', { name: 'Record Split' })).toBeDisabled()
  await dialog.getByRole('button', { name: 'Close split bill' }).click()

  await page.setViewportSize({ width: 375, height: 667 })
  await page.locator('button.app-mobile-fab').click()
  const mobileQuickAdd = page.getByRole('group', { name: 'Quick add actions' })
  const mobileSplitButton = mobileQuickAdd.getByRole('button', { name: 'Split a Bill' })
  await expect(mobileSplitButton).toBeVisible()
  await mobileSplitButton.click()
  await expect(dialog).toBeVisible()
  const mobileFit = await dialog.evaluate(element => {
    const box = element.getBoundingClientRect()
    return { top: box.top, bottom: box.bottom, width: box.width, viewportWidth: window.innerWidth, viewportHeight: window.innerHeight }
  })
  expect(mobileFit.top).toBeGreaterThanOrEqual(0)
  expect(mobileFit.bottom).toBeLessThanOrEqual(mobileFit.viewportHeight)
  expect(mobileFit.width).toBeLessThanOrEqual(mobileFit.viewportWidth)
  const modeTabs = dialog.getByRole('group', { name: 'Split calculation mode' })
  for (const mode of ['Exact', 'Percent', 'Equal']) {
    await modeTabs.getByRole('button', { name: mode }).click()
    const formFit = await dialog.locator('form').evaluate(form => ({ scrollHeight: form.scrollHeight, clientHeight: form.clientHeight, bottom: form.getBoundingClientRect().bottom }))
    expect(formFit.scrollHeight).toBeLessThanOrEqual(formFit.clientHeight + 1)
    expect(formFit.bottom).toBeLessThanOrEqual(mobileFit.viewportHeight)
  }
  expect(evidence.unexpectedOrigins).toEqual([])
  expect(evidence.tableMutations).toEqual([])
  expect(evidence.unexpectedRpcs).toEqual([])
})

test('creator profile remains usable on mobile', async ({ page }) => {
  await installSyntheticBackend(page)
  await page.goto('/')
  const openCreator = page.getByRole('button', { name: 'About RR Capital and its creator' })
  const creator = page.getByRole('dialog', { name: 'Ridhwan S.' })
  const assertPortraitFits = async () => {
    await expect(creator).toBeVisible()
    await expect(creator.getByRole('img', { name: 'Ridhwan S., creator of RR Capital' })).toBeVisible()
    const portraitGeometry = await creator.locator('.creator-profile-photo img').evaluate(image => {
    const bounds = image.getBoundingClientRect()
    const frame = image.parentElement!.getBoundingClientRect()
    const source = image as HTMLImageElement
    const coverScale = Math.max(frame.width / source.naturalWidth, frame.height / source.naturalHeight)
    const renderedWidth = source.naturalWidth * coverScale
    const renderedHeight = source.naturalHeight * coverScale
    const renderedLeft = frame.left + (frame.width - renderedWidth) / 2
    const renderedTop = frame.top + (frame.height - renderedHeight) * 0.28
    return {
      loaded: source.naturalWidth > 0,
      imageHeight: bounds.height,
      face: {
        left: renderedLeft + renderedWidth * 0.36,
        right: renderedLeft + renderedWidth * 0.66,
        top: renderedTop + renderedHeight * 0.31,
        bottom: renderedTop + renderedHeight * 0.52,
      },
      frame: { left: frame.left, right: frame.right, top: frame.top, bottom: frame.bottom },
    }
    })
    expect(portraitGeometry.loaded).toBeTruthy()
    expect(portraitGeometry.imageHeight).toBeGreaterThan(250)
    expect(portraitGeometry.face.left).toBeGreaterThan(portraitGeometry.frame.left)
    expect(portraitGeometry.face.right).toBeLessThan(portraitGeometry.frame.right)
    expect(portraitGeometry.face.top).toBeGreaterThan(portraitGeometry.frame.top)
    expect(portraitGeometry.face.bottom).toBeLessThan(portraitGeometry.frame.bottom)
  }

  for (const viewport of [{ width: 320, height: 568 }, { width: 360, height: 800 }, { width: 375, height: 667 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport)
    await openCreator.click()
    await assertPortraitFits()
    const dialogBounds = await creator.boundingBox()
    expect(dialogBounds).not.toBeNull()
    expect(dialogBounds!.x).toBeGreaterThanOrEqual(0)
    expect(dialogBounds!.y).toBeGreaterThanOrEqual(0)
    expect(dialogBounds!.x + dialogBounds!.width).toBeLessThanOrEqual(viewport.width)
    expect(dialogBounds!.y + dialogBounds!.height).toBeLessThanOrEqual(viewport.height)
    await expect(creator.getByRole('button', { name: 'Close creator profile' })).toBeInViewport()
  await creator.evaluate(element => { element.scrollTop = element.scrollHeight })
  const portraitStaysVisible = await creator.locator('.creator-profile-photo').evaluate(photo => {
    const bounds = photo.getBoundingClientRect()
    return bounds.top >= 0 && bounds.top < window.innerHeight && bounds.bottom <= window.innerHeight
  })
  expect(portraitStaysVisible).toBeTruthy()
    await creator.getByRole('button', { name: 'Close creator profile' }).click()
  }

  await page.setViewportSize({ width: 390, height: 844 })
  await openCreator.click()
  await assertPortraitFits()
  await page.screenshot({ path: 'test-results/creator-modal-mobile-face.png' })
  await page.waitForTimeout(80)
  await page.evaluate(() => {
    const dispatchOrientation = (beta: number, gamma: number) => {
      const event = new Event('deviceorientation')
      Object.defineProperties(event, { beta: { value: beta }, gamma: { value: gamma } })
      window.dispatchEvent(event)
    }
    dispatchOrientation(0, 0) // Calibrate to the phone's current hold angle.
    dispatchOrientation(8, -6)
  })
  await expect.poll(() => creator.evaluate(element => element.style.getPropertyValue('--tilt-x'))).not.toBe('0deg')
  await expect.poll(() => creator.evaluate(element => element.style.getPropertyValue('--glare-x'))).not.toBe('50%')
  await creator.locator('.creator-profile-photo').click()
  const photoViewer = page.getByRole('dialog', { name: 'Creator photo' })
  await expect(photoViewer).toBeVisible()
  await expect(photoViewer.getByRole('img', { name: 'Ridhwan S., creator of RR Capital' })).toBeVisible()
  await photoViewer.getByRole('button', { name: 'Close creator photo' }).click()
  await expect(photoViewer).toHaveCount(0)
  for (const label of ['GitHub', 'Instagram', 'LinkedIn', 'Portfolio']) {
    await expect(creator.getByRole('link', { name: new RegExp(label) })).toBeVisible()
  }
  await expect(creator.getByRole('button', { name: 'Close creator profile' })).toBeVisible()
  await expect(creator.getByRole('button', { name: 'Close profile' })).toHaveCount(0)
})

test('liquid preference switches preserve native switch semantics and keyboard control', async ({ page }) => {
  const evidence = await installSyntheticBackend(page)
  await page.goto('/settings?section=modules')
  const budgets = page.getByRole('switch', { name: 'Budgets' })
  await expect(budgets).toBeVisible()
  await expect(budgets).toHaveClass(/liquid-switch/)
  await expect(budgets).toHaveClass(/liquid-toggle/)
  await expect(budgets).toHaveAttribute('aria-checked', 'true')
  await expect(page.locator('#liquid-goo')).toHaveCount(1)
  await expect(page.locator('#liquid-remove-black')).toHaveCount(1)
  expect(await budgets.evaluate(element => element.getBoundingClientRect().width)).toBe(56)
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await budgets.evaluate(element => element.getBoundingClientRect().width)).toBe(52)
  await page.setViewportSize({ width: 320, height: 568 })
  expect(await budgets.evaluate(element => element.getBoundingClientRect().width)).toBe(48)
  await page.setViewportSize({ width: 1280, height: 900 })
  page.once('dialog', dialog => void dialog.accept())
  await budgets.click()
  await expect(budgets).toHaveAttribute('aria-checked', 'false')
  const guidedTips = page.getByRole('switch', { name: 'Guided page tips' })
  await expect(guidedTips).toHaveClass(/liquid-switch/)
  await guidedTips.focus()
  await guidedTips.press('Space')
  await expect(guidedTips).toHaveAttribute('aria-checked', 'false')
  await guidedTips.evaluate(element => (element as HTMLButtonElement).click())
  await expect(guidedTips).toHaveAttribute('aria-checked', 'true')
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

test('desktop navbar truncates only the visible tail on compact screens', async ({ page }) => {
  await installSyntheticBackend(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/settings')
  await page.getByRole('button', { name: 'Customize Navbar Layout' }).click()
  const dialog = page.getByRole('dialog', { name: 'Customize Navbar Layout' })
  const debtsSwitch = dialog.getByRole('switch', { name: 'Show Debts & IOUs in desktop navbar' })
  await debtsSwitch.click()
  await expect(debtsSwitch).toHaveAttribute('aria-checked', 'true')
  const accountsSwitch = dialog.getByRole('switch', { name: 'Show Accounts in desktop navbar' })
  await accountsSwitch.click()
  await expect(accountsSwitch).toHaveAttribute('aria-checked', 'true')
  await dialog.getByRole('button', { name: 'Close navbar customization' }).click()

  const primary = page.getByRole('navigation', { name: 'Primary navigation' })
  await expect(primary.getByRole('link', { name: 'Accounts' })).toBeVisible()
  await page.setViewportSize({ width: 900, height: 900 })
  await expect(primary.getByRole('link', { name: 'Debts & IOUs' })).toBeVisible()
  await expect(primary.getByRole('link', { name: 'Accounts' })).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Vaults, Directory & Sync' }).getByRole('link', { name: 'Accounts' })).toBeVisible()

  await page.setViewportSize({ width: 1440, height: 900 })
  await expect(primary.getByRole('link', { name: 'Accounts' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Vaults, Directory & Sync' }).getByRole('link', { name: 'Accounts' })).toHaveCount(0)
})

test('navbar viewport selector fits the narrow-phone customization modal', async ({ page }) => {
  await installSyntheticBackend(page)
  await page.setViewportSize({ width: 320, height: 720 })
  await page.goto('/settings')
  await page.getByRole('button', { name: 'Customize Navbar Layout' }).click()

  const dialog = page.getByRole('dialog', { name: 'Customize Navbar Layout' })
  const tabs = dialog.getByRole('tablist', { name: 'Navbar viewport layout' })
  await expect(tabs).toBeVisible()
  await expectModalSwitcherEven(tabs)
  const geometry = await tabs.evaluate(element => {
    const bounds = element.getBoundingClientRect()
    const dialogBounds = element.closest('[role="dialog"]')!.getBoundingClientRect()
    return { left: bounds.left, right: bounds.right, dialogLeft: dialogBounds.left, dialogRight: dialogBounds.right }
  })
  expect(geometry.left).toBeGreaterThan(geometry.dialogLeft)
  expect(geometry.right).toBeLessThan(geometry.dialogRight)

  await tabs.getByRole('tab', { name: /Desktop/ }).click()
  await expect(tabs.getByRole('tab', { name: /Desktop/ })).toHaveAttribute('aria-selected', 'true')
  await expect.poll(() => tabs.evaluate(element => Number.parseFloat(getComputedStyle(element).getPropertyValue('--cap-w')))).toBeGreaterThan(0)
})

test('recurring plan tabs fit the iPhone SE viewport without an inner scrollbar', async ({ page }) => {
  await installSyntheticBackend(page)
  await page.setViewportSize({ width: 375, height: 667 })
  await page.goto('/calendar')
  await page.getByRole('button', { name: /Add Recurring/ }).click()

  const dialog = page.locator('.app-recurring-plan-modal')
  await expect(dialog).toBeVisible()
  const modalBackdrop = dialog.locator('xpath=..')
  await expect(dialog.getByRole('button', { name: 'Close recurring plan' })).toBeVisible()
  await expect(modalBackdrop).toHaveCSS('z-index', '100')
  expect(Number(await page.locator('.app-mobile-nav').evaluate(element => getComputedStyle(element).zIndex))).toBeLessThan(Number(await modalBackdrop.evaluate(element => getComputedStyle(element).zIndex)))
  await expectModalSwitcherEven(dialog.getByRole('group', { name: 'Recurring plan type' }))
  for (const tabSelector of ['[data-glass-key="personal"]', '[data-glass-key="lent"]', '[data-glass-key="borrowed"]']) {
    await dialog.locator(tabSelector).click()
    await expect(dialog.getByRole('button', { name: /Save Personal EMI|Send EMI Request/ })).toBeVisible()
    const layout = await dialog.evaluate(element => {
      const card = element.getBoundingClientRect()
      const body = element.querySelector<HTMLElement>('.app-recurring-plan-body')!
      const submit = element.querySelector<HTMLButtonElement>('button[type="submit"]')!.getBoundingClientRect()
      const action = element.querySelector<HTMLElement>('.app-recurring-plan-actions')!.getBoundingClientRect()
      const submitHit = document.elementFromPoint(submit.left + submit.width / 2, submit.top + submit.height / 2)
      const actionStyle = getComputedStyle(element.querySelector<HTMLElement>('.app-recurring-plan-actions')!)
      return { left: card.left, right: card.right, top: card.top, bottom: card.bottom, submitBottom: submit.bottom, actionBottom: action.bottom, actionWidth: action.width, submitWidth: submit.width, actionBackground: actionStyle.backgroundColor, actionBorderTopWidth: actionStyle.borderTopWidth, bodyClientHeight: body.clientHeight, bodyScrollHeight: body.scrollHeight, submitHit: submitHit ? `${submitHit.tagName}.${(submitHit as HTMLElement).className}` : 'none', submitClickable: submitHit === element.querySelector('button[type="submit"]') || element.querySelector('button[type="submit"]')!.contains(submitHit) }
    })
    expect(layout.left).toBeGreaterThanOrEqual(0)
    expect(layout.right).toBeLessThanOrEqual(375)
    expect(layout.top).toBeGreaterThanOrEqual(0)
    expect(layout.bottom).toBeLessThanOrEqual(667)
    expect(layout.submitBottom).toBeLessThanOrEqual(layout.bottom)
    expect(layout.actionBottom).toBeLessThanOrEqual(layout.bottom)
    expect(layout.submitClickable, `submit layout: ${JSON.stringify(layout)}`).toBeTruthy()
    expect(layout.submitWidth).toBeGreaterThan(layout.actionWidth - 40)
    expect(layout.actionBackground).toBe('rgba(0, 0, 0, 0)')
    expect(layout.actionBorderTopWidth).toBe('0px')
    expect(layout.bodyScrollHeight).toBeLessThanOrEqual(layout.bodyClientHeight + 1)
  }
  page.once('dialog', alert => alert.accept())
  await dialog.getByRole('button', { name: 'Close recurring plan' }).click()
  await expect(dialog).toBeHidden()
})

test('mobile navigation keeps three custom slots and exposes Settings plus notifications in the header', async ({ page }) => {
  await installSyntheticBackend(page, 'light')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')

  const dashboardHeading = page.getByRole('heading', { name: 'Financial overview' })
  await expect(dashboardHeading).toBeVisible()
  const mobileHeaderGap = await page.locator('.app-page-header').evaluate(element => element.getBoundingClientRect().top - element.closest('main')!.getBoundingClientRect().top)
  expect(mobileHeaderGap).toBeLessThan(8)
  const mobileContextTop = await page.locator('.app-mobile-context').evaluate(element => element.getBoundingClientRect().top)
  const mobileContextHeight = await page.locator('.app-mobile-context').evaluate(element => element.getBoundingClientRect().height)
  const mobileMainTop = await page.locator('main.app-main').evaluate(element => element.getBoundingClientRect().top)
  expect(mobileContextTop).toBe(0)
  expect(mobileMainTop).toBe(mobileContextHeight)
  expect(await page.locator('.liquid-toggle-filters').evaluate(element => element.getBoundingClientRect().height)).toBe(0)

  const mobile = page.getByRole('navigation', { name: 'Mobile navigation' })
  await expect(page.locator('.app-mobile-context').getByRole('link', { name: 'Notifications and approvals' })).toBeVisible()
  await expect(page.locator('.app-mobile-context').getByRole('link', { name: 'Settings' })).toBeVisible()
  await expect(mobile.getByRole('link', { name: 'Settings' })).toHaveCount(0)
  const dockBounds = await mobile.boundingBox()
  expect(dockBounds).not.toBeNull()
  expect(dockBounds!.x + dockBounds!.width / 2).toBeCloseTo(195, 0)
  expect(844 - (dockBounds!.y + dockBounds!.height)).toBeCloseTo(16, 0)
  const dockPosition = await mobile.evaluate(element => getComputedStyle(element).position)
  expect(dockPosition).toBe('fixed')
  const mainPadding = await page.locator('main.app-main').evaluate(element => Number.parseFloat(getComputedStyle(element).paddingBottom))
  expect(mainPadding).toBeGreaterThanOrEqual(96)
  await expect(mobile.getByRole('link', { name: 'Dashboard' })).toBeVisible()
  await expect(mobile.getByRole('link', { name: 'Ledger' })).toBeVisible()
  await expect(mobile.getByRole('button', { name: 'Add transaction or debt' })).toBeVisible()
  await page.locator('.app-mobile-context').getByRole('link', { name: 'Notifications and approvals' }).click()
  await expect(page).toHaveURL(/\/notifications$/)
  await expect(page.getByRole('heading', { name: 'Notifications & approvals' })).toBeVisible()
  await expect(page.getByRole('tab', { name: /Pending Approvals/ })).toBeVisible()
  await page.getByRole('tab', { name: /Actionable Alerts/ }).click()
  await expect(page.getByText('No actionable alerts')).toBeVisible()
  await page.goto('/')
  await page.setViewportSize({ width: 375, height: 667 })
  const assertModalFitsPhone = async (dialog: import('@playwright/test').Locator, submitName: RegExp) => {
    const geometry = await dialog.evaluate(element => {
      const card = element.getBoundingClientRect()
      const submit = element.querySelector<HTMLButtonElement>('button[type="submit"]')?.getBoundingClientRect()
      return { left: card.left, right: card.right, top: card.top, bottom: card.bottom, submitBottom: submit?.bottom ?? Number.POSITIVE_INFINITY }
    })
    expect(geometry.left).toBeGreaterThanOrEqual(0)
    expect(geometry.right).toBeLessThanOrEqual(375)
    expect(geometry.top).toBeGreaterThanOrEqual(0)
    expect(geometry.bottom).toBeLessThanOrEqual(667)
    expect(geometry.submitBottom).toBeLessThanOrEqual(geometry.bottom)
    await expect(dialog.getByRole('button', { name: submitName })).toBeVisible()
  }
  const assertModalCloseAboveTabs = async (dialog: import('@playwright/test').Locator, closeName: string, tabsName: string) => {
    const close = await dialog.getByRole('button', { name: closeName }).boundingBox()
    const tabs = await dialog.getByRole('group', { name: tabsName }).boundingBox()
    expect(close).not.toBeNull()
    expect(tabs).not.toBeNull()
    expect(close!.y + close!.height).toBeLessThanOrEqual(tabs!.y)
  }
  const addButton = mobile.locator('button.app-mobile-fab')
  await expect(addButton).toHaveClass(/rounded-full/)
  await expect(addButton).toHaveClass(/h-12/)
  await addButton.click()
  const quickAdd = page.getByRole('group', { name: 'Quick add actions' })
  await expect(quickAdd.getByRole('button', { name: 'Transaction' })).toBeVisible()
  await expect(quickAdd.getByRole('button', { name: 'Add Debt / IOU' })).toBeVisible()
  await expect(addButton).toHaveAttribute('aria-label', 'Close add menu')
  await addButton.click()
  await expect(quickAdd.getByRole('button', { name: 'Transaction' })).toBeHidden()
  await addButton.click()
  await expect(quickAdd.getByRole('button', { name: 'Transaction' })).toBeVisible()
  await quickAdd.getByRole('button', { name: 'Transaction' }).click()
  await expect(page.getByRole('heading', { name: 'New Transaction' })).toBeVisible()
  const transactionDialog = page.locator('.app-transaction-modal')
  await expectModalSwitcherEven(transactionDialog.getByRole('group', { name: 'Transaction type' }))
  await assertModalCloseAboveTabs(transactionDialog, 'Close transaction', 'Transaction type')
  await assertModalFitsPhone(transactionDialog, /Log Transaction/)
  await transactionDialog.getByRole('button', { name: /transfer/i }).click()
  await assertModalFitsPhone(transactionDialog, /Log Transaction/)
  const transactionPlaceholderColors = await page.locator('.app-financial-entry-modal input[placeholder]').evaluateAll(elements => elements.map(element => getComputedStyle(element, '::placeholder').color))
  expect(transactionPlaceholderColors.length).toBeGreaterThan(0)
  expect(transactionPlaceholderColors.every(color => color === 'rgb(89, 87, 79)')).toBe(true)
  await page.getByRole('button', { name: 'Close transaction' }).click()
  await expect(page.getByRole('heading', { name: 'New Transaction' })).toBeHidden()
  await addButton.click()
  await quickAdd.getByRole('button', { name: 'Add Debt / IOU' }).click()
  await expect(page.getByRole('heading', { name: 'Track P2P Debt' })).toBeVisible()
  const debtDialog = page.locator('.app-debt-entry-modal')
  await assertModalFitsPhone(debtDialog, /Log Handshake Transfer/)
  await expectModalSwitcherEven(debtDialog.getByRole('group', { name: 'Debt direction' }))
  await assertModalCloseAboveTabs(debtDialog, 'Close debt form', 'Debt direction')
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
    const addActions = [page.getByRole('button', { name: 'Transaction' }), page.getByRole('button', { name: 'Add Debt / IOU' })]
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
  await page.locator('.app-mobile-context').getByRole('link', { name: 'Settings' }).click()
  await expect(page).toHaveURL(/\/settings$/)
  await expect(page.getByRole('heading', { name: 'Workspace & modules' })).toBeVisible()
  await page.getByRole('button', { name: 'Customize Navbar Layout' }).click()
  const mobileLayoutDialog = page.getByRole('dialog', { name: 'Customize Navbar Layout' })
  await expect(mobileLayoutDialog.getByText(/Current viewport.*Mobile/)).toBeVisible()
  await expect(mobileLayoutDialog.getByRole('switch', { name: 'Show Accounts in mobile navbar' })).toBeEnabled()
  await mobileLayoutDialog.getByRole('switch', { name: 'Show Accounts in mobile navbar' }).click()
  await expect(mobileLayoutDialog.getByRole('switch', { name: 'Show Debts & IOUs in mobile navbar' })).toBeDisabled()
  await mobileLayoutDialog.getByRole('button', { name: 'Move Chittis up' }).click()
  await mobileLayoutDialog.getByRole('button', { name: 'Close navbar customization' }).click()
  await expect.poll(() => page.evaluate(userId => {
    const layout = JSON.parse(localStorage.getItem(`rr-capital.workspace-layout.v1.${userId}`) || '{}')
    return layout.navbarLayout
  }, syntheticUserId)).toEqual({ mobileSelectedUrls: ['/chittis', '/ledger', '/accounts'], desktopSelectedUrls: ['/ledger', '/calendar', '/chittis'] })
  await expect(mobile.getByRole('link', { name: 'Dashboard' })).toBeVisible()
  await expect(mobile.getByRole('link', { name: 'Chittis' })).toBeVisible()
  await expect(mobile.getByRole('link', { name: 'Ledger' })).toBeVisible()
  await expect(mobile.getByRole('link', { name: 'Accounts' })).toBeVisible()
  await expect(page.locator('.app-mobile-context').getByRole('link', { name: 'Settings' })).toBeVisible()
  const analytics = page.getByRole('region', { name: 'Analytics, Planning & Wellness' })
  await expect(analytics.getByRole('link', { name: 'Reports' })).toBeVisible()
  await analytics.getByRole('link', { name: 'Reports' }).click()
  await expect(page).toHaveURL(/\/reports$/)
  await expect(page.getByRole('navigation', { name: 'Workspace breadcrumb' })).toContainText('Analytics, Planning & Wellness')
  await expect(page.locator('.app-mobile-context').getByRole('link', { name: 'Settings' })).toHaveClass(/is-active/)
  await page.goto('/')
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
  await expect(page.getByText(/Latest release .*2026\.10\.04\.1/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'View detailed summary' })).toBeVisible()
})

test('Telegram linking configures the synthetic webhook and confirms a consumed challenge', async ({ page }) => {
  const evidence = await installSyntheticBackend(page)
  const token = 'ab'.repeat(24)
  const configurationRequests: Array<{ body: unknown; authorization: string }> = []
  const challengeRequests: Array<{ body: unknown; authorization: string }> = []
  const profileSelections: string[] = []
  let telegramLinked = false

  await page.route(`${backendOrigin}/functions/v1/telegram-webhook`, async route => {
    const request = route.request()
    if (request.method() === 'OPTIONS') return fulfillJson(route, {}, 204)
    configurationRequests.push({
      body: request.postDataJSON(),
      authorization: request.headers().authorization ?? '',
    })
    await fulfillJson(route, { configured: true, webhookReady: true, pendingUpdates: 0, hasDeliveryError: false })
  })

  await page.route(`${backendOrigin}/rest/v1/rpc/issue_telegram_link_token`, async route => {
    const request = route.request()
    if (request.method() === 'OPTIONS') return fulfillJson(route, {}, 204)
    challengeRequests.push({
      body: request.postDataJSON(),
      authorization: request.headers().authorization ?? '',
    })
    await fulfillJson(route, token)
  })

  await page.route(`${backendOrigin}/rest/v1/rpc/get_telegram_link_status`, async route => {
    if (route.request().method() === 'OPTIONS') return fulfillJson(route, {}, 204)
    await fulfillJson(route, telegramLinked)
  })
  await page.route(`${backendOrigin}/rest/v1/profiles**`, async route => {
    profileSelections.push(new URL(route.request().url()).searchParams.get('select') ?? '')
    await route.fallback()
  })

  await page.goto('/settings')
  await page.getByRole('button', { name: 'Link Telegram' }).click()
  await expect(page.getByText('The bot webhook is verified.')).toBeVisible()
  await expect(page.locator('code')).toContainText(`/start ${token}`)
  const botLink = page.getByRole('link', { name: 'Open @ridhwans_fin_bot' })
  await expect(botLink).toHaveAttribute('href', `https://t.me/ridhwans_fin_bot?start=${token}`)
  await expect(botLink).toHaveAttribute('target', '_blank')
  expect(configurationRequests).toEqual([{
    body: { action: 'configure' },
    authorization: expect.stringMatching(/^Bearer e30\./),
  }])
  expect(challengeRequests).toEqual([{
    body: {},
    authorization: expect.stringMatching(/^Bearer e30\./),
  }])
  expect(profileSelections.length).toBeGreaterThan(0)
  expect(profileSelections.every(selection => !selection.includes('telegram_chat_id'))).toBe(true)

  // Model the webhook consuming the challenge, then let the settings page's
  // visibility check confirm the linked chat without sending an external message.
  telegramLinked = true
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await expect(page.getByText('Telegram chat linked. Use the bot to verify or change it.')).toBeVisible()
  await expect(page.getByText('987654321')).toHaveCount(0)
  await expect(page.locator('code')).toHaveCount(0)
  expect(evidence.unexpectedOrigins).toEqual([])
  expect(evidence.tableMutations).toEqual([])
  expect(evidence.unexpectedRpcs).toEqual([])
})

test('Settings still loads profile preferences while the Telegram status migration is pending', async ({ page }) => {
  const evidence = await installSyntheticBackend(page)

  await page.route(`${backendOrigin}/rest/v1/rpc/get_telegram_link_status`, async route => {
    if (route.request().method() === 'OPTIONS') return fulfillJson(route, {}, 204)
    await fulfillJson(route, {
      code: 'PGRST202',
      message: 'Could not find the function public.get_telegram_link_status.',
    }, 404)
  })

  await page.goto('/settings')
  await expect(page.getByRole('heading', { name: 'Profile & Identity' })).toBeVisible()
  await expect(page.getByText('Telegram link status is unavailable until the security update is applied.')).toBeVisible()
  await expect(page.getByText('Connect your private Telegram chat for alerts.')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Link Telegram' })).toBeVisible()
  expect(evidence.unexpectedRpcs).toEqual([])
  expect(evidence.unexpectedOrigins).toEqual([])
})

test('biometric lock uses the shared liquid switch and reveals device registration controls', async ({ page }) => {
  await installSyntheticBackend(page)
  await page.goto('/settings')

  const biometricSwitch = page.getByRole('switch', { name: 'Biometric / FaceID Lock' })
  await expect(biometricSwitch).toBeVisible()
  await expect(biometricSwitch).not.toBeChecked()
  await biometricSwitch.click()
  await expect(biometricSwitch).toBeChecked()
  await expect(page.getByText('Registered Devices')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Add Device' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Unsaved changes' })).toBeVisible()
})

test('Settings theme changes keep the floating unsaved dialog fixed without changing scroll position', async ({ page }) => {
  await installSyntheticBackend(page, 'dark')
  await page.goto('/settings')
  const appearance = page.getByRole('heading', { name: 'Appearance' })
  await expect(appearance).toBeVisible()
  await appearance.scrollIntoViewIfNeeded()
  await page.waitForTimeout(100)

  const scrollBefore = await page.evaluate(() => window.scrollY)
  const light = page.getByRole('radio', { name: 'Light' })
  const dark = page.getByRole('radio', { name: 'Dark' })

  await light.click()
  await expect(page.getByText('You have unsaved changes')).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(scrollBefore)
  const dirtyPill = page.getByRole('region', { name: 'Unsaved changes' })
  await expect(dirtyPill).toHaveCSS('position', 'fixed')
  await expect.poll(() => dirtyPill.locator('.liquid-unsaved-dialog__actions').evaluate((element) => {
    const actions = element as HTMLElement
    return actions.classList.contains('is-ready') && Number.parseFloat(actions.style.getPropertyValue('--cap-w')) > 0
  })).toBe(true)
  const initialCap = await dirtyPill.locator('.liquid-unsaved-dialog__actions').evaluate((element) => {
    const actions = element as HTMLElement
    const save = actions.querySelector<HTMLButtonElement>('.liquid-unsaved-dialog__btn--save')
    if (!save) throw new Error('Save action is missing from the unsaved dialog')
    return {
      capX: Number.parseFloat(actions.style.getPropertyValue('--cap-x')),
      capW: Number.parseFloat(actions.style.getPropertyValue('--cap-w')),
      expectedX: Math.min(actions.offsetWidth - 2 - Math.min(save.offsetWidth + 10, actions.offsetWidth - 4), Math.max(2, save.offsetLeft - 5)),
      expectedW: Math.min(save.offsetWidth + 10, actions.offsetWidth - 4),
      textFits: save.scrollWidth <= save.clientWidth,
      ready: actions.classList.contains('is-ready'),
      positioned: actions.dataset.capPositioned === 'true',
    }
  })
  expect(initialCap.ready).toBe(true)
  expect(initialCap.positioned).toBe(true)
  expect(initialCap.textFits).toBe(true)
  expect(initialCap.capW).toBeGreaterThan(0)
  expect(Math.abs(initialCap.capX - initialCap.expectedX)).toBeLessThanOrEqual(1)
  expect(Math.abs(initialCap.capW - initialCap.expectedW)).toBeLessThanOrEqual(1)
  const initialCapX = String(initialCap.capX)
  await dirtyPill.getByRole('button', { name: 'Discard' }).hover()
  await expect.poll(() => dirtyPill.locator('.liquid-unsaved-dialog__actions').evaluate((el) => (el as HTMLElement).style.getPropertyValue('--cap-x'))).not.toBe(initialCapX)
  await dirtyPill.getByRole('button', { name: 'Save All Changes' }).hover()

  await dark.click()
  await expect(page.getByText('You have unsaved changes')).toBeHidden()
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(scrollBefore)

  await light.click()
  await expect(page.getByText('You have unsaved changes')).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(scrollBefore)

  const lightBaselinePage = await page.context().newPage()
  await installSyntheticBackend(lightBaselinePage, 'light')
  await lightBaselinePage.goto('/settings')
  const lightBaselineAppearance = lightBaselinePage.getByRole('heading', { name: 'Appearance' })
  await expect(lightBaselineAppearance).toBeVisible()
  await lightBaselineAppearance.scrollIntoViewIfNeeded()
  const lightBaselineDark = lightBaselinePage.getByRole('radio', { name: 'Dark' })
  await lightBaselineDark.scrollIntoViewIfNeeded()
  // Let asynchronous settings sections finish laying out before capturing
  // the scroll baseline, so the assertion isolates the appearance change.
  await lightBaselinePage.waitForTimeout(350)
  const lightScrollBefore = await lightBaselinePage.evaluate(() => window.scrollY)
  await lightBaselineDark.click()
  await expect(lightBaselinePage.getByText('You have unsaved changes')).toBeVisible()
  await expect.poll(() => lightBaselinePage.evaluate(() => window.scrollY)).toBe(lightScrollBefore)
  await lightBaselinePage.getByRole('radio', { name: 'Light' }).click()
  await expect(lightBaselinePage.getByText('You have unsaved changes')).toBeHidden()
  await expect.poll(() => lightBaselinePage.evaluate(() => window.scrollY)).toBe(lightScrollBefore)
  await lightBaselinePage.close()
})

test('Telegram setup failure does not issue or display a link challenge', async ({ page }) => {
  const evidence = await installSyntheticBackend(page)
  const configurationRequests: Array<{ body: unknown; authorization: string }> = []
  let challengeRequestCount = 0

  await page.route(`${backendOrigin}/functions/v1/telegram-webhook`, async route => {
    const request = route.request()
    if (request.method() === 'OPTIONS') return fulfillJson(route, {}, 204)
    configurationRequests.push({
      body: request.postDataJSON(),
      authorization: request.headers().authorization ?? '',
    })
    await fulfillJson(route, { configured: false, error: 'Bot setup is temporarily unavailable.' }, 503)
  })

  await page.route(`${backendOrigin}/rest/v1/rpc/issue_telegram_link_token`, async route => {
    if (route.request().method() === 'OPTIONS') return fulfillJson(route, {}, 204)
    challengeRequestCount += 1
    await fulfillJson(route, 'unexpected-challenge-token')
  })

  await page.goto('/settings?search=telegram')
  await page.getByRole('textbox', { name: 'Search settings...' }).fill('telegram')
  await page.getByRole('button', { name: 'Link Telegram' }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'Could not create a link code. Try again.' })).toBeVisible()
  await expect(page.getByText(/The bot webhook is verified/)).toHaveCount(0)
  expect(configurationRequests).toEqual([{
    body: { action: 'configure' },
    authorization: expect.stringMatching(/^Bearer e30\./),
  }])
  expect(challengeRequestCount).toBe(0)
  expect(evidence.unexpectedOrigins).toEqual([])
  expect(evidence.tableMutations).toEqual([])
  expect(evidence.unexpectedRpcs).toEqual([])
})

test('dated opening balance submission stays inside the synthetic backend', async ({ page }) => {
  const evidence = await installSyntheticBackend(page)
  await page.setViewportSize({ width: 375, height: 667 })
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
  const accountDialog = page.getByRole('dialog', { name: 'Add New Account' })
  await expectModalSwitcherEven(accountDialog.getByRole('group', { name: 'Account family' }))
  const accountBounds = await accountDialog.boundingBox()
  expect(accountBounds).not.toBeNull()
  expect(accountBounds!.x).toBeGreaterThanOrEqual(0)
  expect(accountBounds!.y).toBeGreaterThanOrEqual(0)
  expect(accountBounds!.x + accountBounds!.width).toBeLessThanOrEqual(375)
  expect(accountBounds!.y + accountBounds!.height).toBeLessThanOrEqual(667)
  const accountClose = await accountDialog.getByRole('button', { name: 'Close account form' }).boundingBox()
  const accountTabs = await accountDialog.getByRole('group', { name: 'Account family' }).boundingBox()
  expect(accountClose).not.toBeNull()
  expect(accountTabs).not.toBeNull()
  expect(accountClose!.y + accountClose!.height).toBeLessThanOrEqual(accountTabs!.y)
  await expect(accountDialog.getByRole('button', { name: 'Create Account' })).toBeVisible()
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

test('light-theme account and recurring modals keep helper copy legible', async ({ page }) => {
  await installSyntheticBackend(page, 'light')
  await page.setViewportSize({ width: 1366, height: 768 })

  await page.goto('/accounts')
  await page.getByRole('button', { name: /Add Account/ }).click()
  const accountDialog = page.getByRole('dialog', { name: 'Add New Account' })
  const accountDescription = accountDialog.locator('.app-account-tab-detail').first()
  await expect(accountDescription).toHaveText('Money you hold')
  await expect(accountDescription).toHaveCSS('color', 'rgb(108, 106, 100)')
  await accountDialog.getByRole('button', { name: /Liquid/ }).click()
  await expect(accountDescription).toHaveCSS('color', 'rgb(108, 106, 100)')
  await page.goto('/calendar')
  await page.getByRole('button', { name: /Add Recurring/ }).click()
  const recurringDialog = page.locator('.app-recurring-plan-modal')
  const subtitle = recurringDialog.getByText('Set the payment, dates, and account')
  await expect(subtitle).toBeVisible()
  await expect(subtitle).toHaveCSS('color', 'rgb(108, 106, 100)')
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

test('offline queue upgrades legacy v6 records and redacts stored diagnostics', async ({ page }) => {
  await installSyntheticBackend(page)
  await page.route('http://127.0.0.1:5191/__idb_seed', route => route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: '<!doctype html><title>IndexedDB migration fixture</title>',
  }))
  await page.goto('/__idb_seed')
  await page.evaluate(() => {
    if (indexedDB.databases) return indexedDB.databases().then(databases => {
      const existing = databases.find(database => database.name === 'FinancialOS_OfflineDB')
      if (!existing) return
      return new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase('FinancialOS_OfflineDB')
        request.onsuccess = () => resolve()
        request.onerror = () => reject(request.error)
      })
    })
  })
  const legacyTransaction = {
    owner_id: syntheticUserId,
    from_account_id: syntheticAccountId,
    to_account_id: null,
    amount: 735,
    fee_amount: 0,
    description: 'Legacy queued expense',
    sync_status: 'failed',
    last_error: 'Postgres error: password=must-not-survive; private diagnostic',
    created_at: '2026-09-01T12:00:00.000Z',
  }
  await page.evaluate(async transaction => {
    await new Promise<void>((resolve, reject) => {
      // Dexie maps logical version 6 to native IndexedDB version 60.
      const request = indexedDB.open('FinancialOS_OfflineDB', 60)
      request.onupgradeneeded = () => {
        const database = request.result
        const outbox = database.createObjectStore('outbox', { keyPath: 'id', autoIncrement: true })
        outbox.createIndex('sync_status', 'sync_status')
        outbox.createIndex('created_at', 'created_at')
        database.createObjectStore('accountCache', { keyPath: 'owner_id' })
        database.createObjectStore('contactCache', { keyPath: 'owner_id' })
      }
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const database = request.result
        const write = database.transaction('outbox', 'readwrite')
        write.objectStore('outbox').add(transaction)
        write.oncomplete = () => {
          database.close()
          resolve()
        }
        write.onerror = () => reject(write.error)
      }
    })
  }, legacyTransaction)

  await page.goto('/offline')
  await expect(page.getByText('Legacy queued expense')).toBeVisible()
  await expect(page.getByRole('alert').filter({ hasText: 'The server rejected this entry.' })).toBeVisible()
  const migrated = await page.evaluate(async () => {
    const request = indexedDB.open('FinancialOS_OfflineDB')
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const transaction = database.transaction('outbox', 'readonly')
    const store = transaction.objectStore('outbox')
    const row = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const query = store.get(1)
      query.onsuccess = () => resolve(query.result)
      query.onerror = () => reject(query.error)
    })
    const indexes = Array.from(store.indexNames)
    database.close()
    return { version: database.version, row, indexes }
  })
  expect(migrated.version).toBe(80) // Dexie's logical v8 uses native version 80.
  expect(migrated.indexes).toContain('[owner_id+sync_status]')
  expect(migrated.row).toMatchObject({
    id: 1,
    owner_id: syntheticUserId,
    from_account_id: syntheticAccountId,
    amount: 735,
    description: 'Legacy queued expense',
    sync_status: 'failed',
    last_error: 'The server rejected this entry. Review it and enter it again if needed.',
  })
  expect(JSON.stringify(migrated.row)).not.toContain('must-not-survive')
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
    { path: '/notifications', title: 'Notifications & approvals' },
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
      if (item.path === '/') {
        const geometry = await page.evaluate(() => {
          const netWorth = document.querySelector('.ed-networth')!.getBoundingClientRect()
          const commitments = document.querySelector('.ed-commitments')!.getBoundingClientRect()
          const cashFlow = document.querySelector('.ed-chart')!.getBoundingClientRect()
          const accounts = document.querySelector('.dashboard-accounts-card')!.getBoundingClientRect()
          const list = document.querySelector('.dashboard-accounts-card .dashboard-card-scroll') as HTMLElement
          const row = list.querySelector('.ed-account')
          if (row) {
            for (let index = 0; index < 16; index += 1) list.append(row.cloneNode(true))
          }
          const populated = {
            cashFlowHeight: document.querySelector('.ed-chart')!.getBoundingClientRect().height,
            accountsHeight: document.querySelector('.dashboard-accounts-card')!.getBoundingClientRect().height,
            scrollHeight: list.scrollHeight,
            clientHeight: list.clientHeight,
          }
          list.querySelectorAll('.ed-account').forEach((account, index) => { if (index > 0) account.remove() })
          return {
            heroHeightDifference: Math.abs(netWorth.height - commitments.height),
            cashFlowHeight: cashFlow.height,
            accountsHeight: accounts.height,
            populated,
          }
        })
        if (viewport.width >= 768) {
          expect(geometry.heroHeightDifference).toBeLessThanOrEqual(1)
          expect(Math.abs(geometry.cashFlowHeight - geometry.accountsHeight)).toBeLessThanOrEqual(1)
          expect(Math.abs(geometry.populated.cashFlowHeight - geometry.populated.accountsHeight)).toBeLessThanOrEqual(1)
          expect(geometry.populated.scrollHeight).toBeGreaterThan(geometry.populated.clientHeight)
        } else {
          expect(geometry.accountsHeight).toBeLessThanOrEqual(342)
        }
      }
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

test('financial workspaces render safely for the reset owner with no finance rows', async ({ page }) => {
  const evidence = await installSyntheticBackend(page, 'dark', true)
  const browserErrors: string[] = []
  page.on('pageerror', error => browserErrors.push(error.message))
  const pages = [
    { path: '/', title: 'Financial overview' },
    { path: '/calendar', title: 'Calendar & EMIs' },
    { path: '/ledger', title: 'Transactions' },
    { path: '/reports', title: 'Reports' },
    { path: '/accounts', title: 'Accounts' },
    { path: '/debts', title: 'Debts & IOUs' },
    { path: '/contacts', title: 'Shadow Contacts' },
    { path: '/notifications', title: 'Notifications & approvals' },
    { path: '/chittis', title: 'Chitti / ROSCA' },
  ]

  for (const viewport of [{ width: 1366, height: 768 }, { width: 375, height: 667 }]) {
    await page.setViewportSize(viewport)
    for (const item of pages) {
      await page.goto(item.path, { waitUntil: 'domcontentloaded' })
      await expect(page).toHaveURL(new RegExp(`${item.path.replaceAll('/', '\\/')}$`))
      await expect(page.getByRole('heading', { name: item.title, exact: true }).first()).toBeVisible()
    }
  }

  expect(browserErrors).toEqual([])
  expect(evidence.tableMutations).toEqual([])
  expect(evidence.unexpectedRpcs).toEqual([])
})


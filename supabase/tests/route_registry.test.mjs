import test from 'node:test'
import assert from 'node:assert/strict'
import {
  AUTH_ROUTE,
  getDefaultPlacement,
  getEffectivePlacement,
  getGroupedSettingsRoutes,
  ROUTE_COMPONENT_LOADERS,
  ROUTE_REGISTRY,
  SETTINGS_GROUPS,
} from '../../src/lib/routeRegistry.ts'

test('the registry contains 15 protected pages and the standalone public auth page', () => {
  assert.equal(ROUTE_REGISTRY.length, 15)
  assert.equal(new Set(ROUTE_REGISTRY.map(route => route.path)).size, ROUTE_REGISTRY.length)
  assert.equal(AUTH_ROUTE.path, '/auth')
  assert.deepEqual(new Set(ROUTE_REGISTRY.map(route => route.settingsGroup)), new Set(SETTINGS_GROUPS))
})

test('calendar receives desktop navbar and mobile settings defaults', () => {
  const calendar = ROUTE_REGISTRY.find(route => route.path === '/calendar')
  assert.ok(calendar)
  assert.equal(getDefaultPlacement(calendar, false), 'navbar')
  assert.equal(getDefaultPlacement(calendar, true), 'settings')
})

test('promoting a settings module removes it from its group; demoting a navbar module auto-groups it', () => {
  const routes = getGroupedSettingsRoutes(
    { '/accounts': 'navbar', '/ledger': 'settings' },
    {},
    false,
  )
  const grouped = Object.fromEntries(routes.map(section => [section.group, section.routes.map(route => route.path)]))

  assert.equal(getEffectivePlacement(ROUTE_REGISTRY.find(route => route.path === '/ledger'), { '/ledger': 'settings' }, false), 'settings')
  assert.ok(grouped['Core Operations & Daily Flow'].includes('/ledger'))
  assert.ok(!grouped['Vaults, Directory & Sync'].includes('/accounts'))
  assert.deepEqual(grouped['Analytics, Planning & Wellness'], ['/reports'])
})

test('optional modules are hidden until enabled and appear in their canonical group', () => {
  const disabled = getGroupedSettingsRoutes({}, {}, false)
  assert.ok(disabled.every(section => section.routes.every(route => !route.optionalFeature)))

  const enabled = getGroupedSettingsRoutes({}, { budgets: true }, false)
  const analytics = enabled.find(section => section.group === 'Analytics, Planning & Wellness')
  assert.ok(analytics?.routes.some(route => route.path === '/budgets'))
})

test('dashboard and settings remain fixed anchors instead of movable settings modules', () => {
  const grouped = getGroupedSettingsRoutes({ '/': 'settings', '/settings': 'settings' }, {}, false)
  const paths = grouped.flatMap(section => section.routes.map(route => route.path))
  assert.ok(!paths.includes('/'))
  assert.ok(!paths.includes('/settings'))
})

test('the requested routes keep their canonical groups, defaults, and screen loaders', () => {
  const expected = {
    '/': ['Core Operations & Daily Flow', 'navbar'],
    '/ledger': ['Core Operations & Daily Flow', 'navbar'],
    '/calendar': ['Core Operations & Daily Flow', 'navbar'],
    '/chittis': ['Commitments, Credit & Chittis', 'navbar'],
    '/debts': ['Commitments, Credit & Chittis', 'settings'],
    '/accounts': ['Vaults, Directory & Sync', 'settings'],
    '/contacts': ['Vaults, Directory & Sync', 'settings'],
    '/offline': ['Vaults, Directory & Sync', 'settings'],
    '/reports': ['Analytics, Planning & Wellness', 'settings'],
    '/financial-health': ['Analytics, Planning & Wellness', 'settings'],
    '/budgets': ['Analytics, Planning & Wellness', 'settings'],
    '/savings-goals': ['Analytics, Planning & Wellness', 'settings'],
    '/calculators': ['Tools & Lifestyle Utilities', 'settings'],
    '/shopping-lists': ['Tools & Lifestyle Utilities', 'settings'],
    '/settings': ['Core Operations & Daily Flow', 'navbar'],
  }

  for (const [path, [group, placement]] of Object.entries(expected)) {
    const route = ROUTE_REGISTRY.find(item => item.path === path)
    assert.ok(route, `missing registry entry for ${path}`)
    assert.equal(route.settingsGroup, group, `wrong canonical group for ${path}`)
    assert.equal(route.defaultPlacement, placement, `wrong default placement for ${path}`)
    assert.equal(typeof ROUTE_COMPONENT_LOADERS[path], 'function', `missing screen loader for ${path}`)
  }

  assert.equal(ROUTE_REGISTRY.length, 15)
})

console.log('Passed 6 route registry and workspace grouping checks.')

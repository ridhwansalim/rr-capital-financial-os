import { useCallback, useEffect, useRef, useState } from 'react'
import type { FeatureFlags } from './optionalFeatures'
import { getDefaultPlacement, ROUTE_REGISTRY, SETTINGS_GROUPS, type RoutePlacement } from './routeRegistry'
import { supabase } from './supabase'

const MOBILE_QUERY = '(max-width: 767px)'
export const WORKSPACE_LAYOUT_STORAGE_PREFIX = 'rr-capital.workspace-layout.v1'
export interface NavbarLayoutPreferences {
  mobileSelectedUrls: string[]
  desktopSelectedUrls: string[]
}
interface StoredWorkspaceLayout extends NavbarLayoutPreferences {
  updatedAt: number
  writerId: string
}
export type NavbarLayoutUpdate = NavbarLayoutPreferences | ((current: NavbarLayoutPreferences) => NavbarLayoutPreferences)

const CUSTOM_ROUTES = ROUTE_REGISTRY.filter(route => route.path !== '/' && route.path !== '/settings' && !route.utility)
const DEFAULT_LAYOUT: NavbarLayoutPreferences = {
  mobileSelectedUrls: CUSTOM_ROUTES.filter(route => getDefaultPlacement(route, true) === 'navbar').slice(0, 3).map(route => route.path),
  desktopSelectedUrls: CUSTOM_ROUTES.filter(route => getDefaultPlacement(route, false) === 'navbar').slice(0, 10).map(route => route.path),
}

function cleanUrls(value: unknown, limit: number) {
  if (!Array.isArray(value)) return null
  const known = new Set(CUSTOM_ROUTES.map(route => route.path))
  return [...new Set(value.filter((path): path is string => typeof path === 'string' && known.has(path)))].slice(0, limit)
}

function normalizeLayout(value: unknown): NavbarLayoutPreferences | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Partial<NavbarLayoutPreferences>
  const mobile = cleanUrls(raw.mobileSelectedUrls, 3)
  const desktop = cleanUrls(raw.desktopSelectedUrls, 10)
  return mobile && desktop ? { mobileSelectedUrls: mobile, desktopSelectedUrls: desktop } : null
}

function normalizeStoredLayout(value: unknown): StoredWorkspaceLayout | null {
  const layout = normalizeLayout(value)
  if (!layout || !value || typeof value !== 'object') return null
  const raw = value as { updatedAt?: unknown; writerId?: unknown; _sync?: { updatedAt?: unknown; writerId?: unknown } }
  const sync = raw._sync && typeof raw._sync === 'object' ? raw._sync : raw
  return {
    ...layout,
    updatedAt: typeof sync.updatedAt === 'number' && Number.isFinite(sync.updatedAt) ? sync.updatedAt : 0,
    writerId: typeof sync.writerId === 'string' ? sync.writerId : '',
  }
}

function makeWriterId(storageKey: string | null) {
  if (!storageKey) return 'anonymous'
  const key = `${storageKey}.writer`
  try {
    const existing = localStorage.getItem(key)
    if (existing) return existing
    const created = crypto.randomUUID()
    localStorage.setItem(key, created)
    return created
  } catch {
    return 'local'
  }
}

function compareStoredLayouts(a: StoredWorkspaceLayout, b: StoredWorkspaceLayout) {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt - b.updatedAt
  return a.writerId.localeCompare(b.writerId)
}

function getUserStorageKey(userId: string | null) {
  return userId ? `${WORKSPACE_LAYOUT_STORAGE_PREFIX}.${userId}` : null
}

function isMobileViewport() {
  return typeof window !== 'undefined' && window.matchMedia(MOBILE_QUERY).matches
}

function readStoredWorkspace(storageKey: string | null) {
  if (!storageKey) return { placements: {} as Record<string, RoutePlacement>, optionalFlags: {} as FeatureFlags, navbarLayout: DEFAULT_LAYOUT, layoutSync: { updatedAt: 0, writerId: '' } }
  try {
    const raw = JSON.parse(localStorage.getItem(storageKey) || '{}') as { placements?: unknown; optionalFlags?: unknown; navbarLayout?: unknown }
    const placements = raw.placements && typeof raw.placements === 'object' && !Array.isArray(raw.placements)
      ? Object.fromEntries(Object.entries(raw.placements).filter(([path, value]) => ROUTE_REGISTRY.some(route => route.path === path && !route.utility && path !== '/' && path !== '/settings') && (value === 'navbar' || value === 'settings'))) as Record<string, RoutePlacement>
      : {}
    const optionalFlags = raw.optionalFlags && typeof raw.optionalFlags === 'object' && !Array.isArray(raw.optionalFlags)
      ? Object.fromEntries(Object.entries(raw.optionalFlags).filter(([, value]) => typeof value === 'boolean')) as FeatureFlags
      : {}
    // Migrate the previous single placement map into separate ordered layouts.
    const legacyLayout = {
      mobileSelectedUrls: CUSTOM_ROUTES.filter(route => (placements[route.path] || getDefaultPlacement(route, true)) === 'navbar').slice(0, 3).map(route => route.path),
      desktopSelectedUrls: CUSTOM_ROUTES.filter(route => (placements[route.path] || getDefaultPlacement(route, false)) === 'navbar').slice(0, 10).map(route => route.path),
    }
    const savedLayout = normalizeStoredLayout(raw.navbarLayout)
    return {
      placements,
      optionalFlags,
      navbarLayout: savedLayout
        ? { mobileSelectedUrls: savedLayout.mobileSelectedUrls, desktopSelectedUrls: savedLayout.desktopSelectedUrls }
        : legacyLayout,
      layoutSync: savedLayout ? { updatedAt: savedLayout.updatedAt, writerId: savedLayout.writerId } : { updatedAt: 0, writerId: '' },
    }
  } catch {
    return { placements: {} as Record<string, RoutePlacement>, optionalFlags: {} as FeatureFlags, navbarLayout: DEFAULT_LAYOUT, layoutSync: { updatedAt: 0, writerId: '' } }
  }
}

export function useWorkspaceLayout(userId: string | null, serverFlags: FeatureFlags) {
  const storageKey = getUserStorageKey(userId)
  const [isMobile, setIsMobile] = useState(isMobileViewport)
  const [desktopCapacity, setDesktopCapacity] = useState(4)
  const [profileReadyUserId, setProfileReadyUserId] = useState<string | null>(null)
  const [profileRetry, setProfileRetry] = useState(0)
  const [layoutState, setLayoutState] = useState(() => ({ storageKey, ...readStoredWorkspace(storageKey) }))
  const localEditRevisionRef = useRef(0)
  const stored = layoutState.storageKey === storageKey ? layoutState : { storageKey, ...readStoredWorkspace(storageKey) }
  const placements = stored.placements
  const navbarLayout = stored.navbarLayout

  useEffect(() => {
    const media = window.matchMedia(MOBILE_QUERY)
    const handleChange = () => setIsMobile(media.matches)
    handleChange()
    media.addEventListener('change', handleChange)
    return () => media.removeEventListener('change', handleChange)
  }, [])

  useEffect(() => {
    const updateCapacity = () => {
      const width = window.innerWidth
      // Mobile users can configure the complete desktop preference; capacity
      // truncation applies only when a desktop-sized viewport displays it.
      // Tiers keep the top bar legible while ResizeObserver tracks viewport changes.
      setDesktopCapacity(width < 768 ? 10 : width < 901 ? 4 : width < 1025 ? 5 : width < 1121 ? 6 : width < 1281 ? 8 : 10)
    }
    updateCapacity()
    const observer = new ResizeObserver(updateCapacity)
    observer.observe(document.documentElement)
    window.addEventListener('resize', updateCapacity)
    return () => { observer.disconnect(); window.removeEventListener('resize', updateCapacity) }
  }, [])

  const persist = useCallback((nextPlacements: Record<string, RoutePlacement>, nextLayout: NavbarLayoutPreferences, nextFlags: FeatureFlags = serverFlags, sync?: StoredWorkspaceLayout) => {
    if (!storageKey) return
    try {
      const current = readStoredWorkspace(storageKey)
      const writerId = makeWriterId(storageKey)
      const metadata = sync ?? { updatedAt: Math.max(Date.now(), current.layoutSync.updatedAt + 1), writerId }
      localStorage.setItem(storageKey, JSON.stringify({ version: 3, placements: nextPlacements, navbarLayout: { ...nextLayout, _sync: metadata }, optionalFlags: nextFlags }))
      window.dispatchEvent(new CustomEvent('rr:workspace-layout-changed', { detail: { storageKey } }))
    } catch {
      // Private browsing or a full storage quota must not block navigation.
    }
  }, [serverFlags, storageKey])

  // Profile storage is the cross-device source of truth; localStorage keeps the
  // same layout available immediately and while temporarily offline.
  useEffect(() => {
    if (!userId) { setProfileReadyUserId(null); return }
    let cancelled = false
    let retryTimer = 0
    let attempts = 0
    setProfileReadyUserId(null)
    const startingRevision = localEditRevisionRef.current
    const syncProfile = async () => {
      const { data, error } = await supabase.from('profiles').select('navbar_layout').eq('id', userId).maybeSingle()
      if (cancelled) return
      const remote = normalizeStoredLayout(data?.navbar_layout)
      const changedDuringRead = localEditRevisionRef.current !== startingRevision
      if (error) {
        // Keep local navigation usable, but never let a failed read authorize a write.
        if (attempts < 5) {
          attempts += 1
          retryTimer = window.setTimeout(syncProfile, Math.min(1000 * 2 ** attempts, 15000))
        }
        return
      }
      if (changedDuringRead) {
        if (!cancelled) setProfileReadyUserId(userId)
        return
      }

      const local = readStoredWorkspace(storageKey)
      const localVersion: StoredWorkspaceLayout = { ...local.navbarLayout, ...local.layoutSync }
      if (remote && compareStoredLayouts(remote, localVersion) > 0) {
        persist(local.placements, { mobileSelectedUrls: remote.mobileSelectedUrls, desktopSelectedUrls: remote.desktopSelectedUrls }, local.optionalFlags, remote)
        setLayoutState(current => ({
          storageKey,
          placements: current.storageKey === storageKey ? current.placements : local.placements,
          optionalFlags: current.storageKey === storageKey ? current.optionalFlags : local.optionalFlags,
          navbarLayout: { mobileSelectedUrls: remote.mobileSelectedUrls, desktopSelectedUrls: remote.desktopSelectedUrls },
          layoutSync: { updatedAt: remote.updatedAt, writerId: remote.writerId },
        }))
      } else {
        const versioned = { ...local.navbarLayout, _sync: localVersion.updatedAt ? local.layoutSync : { updatedAt: Date.now(), writerId: makeWriterId(storageKey) } }
        if (!remote || compareStoredLayouts(localVersion, remote) > 0) {
          const { data: written, error: writeError } = await supabase.from('profiles').update({ navbar_layout: versioned }).eq('id', userId).select('id').maybeSingle()
          if (writeError || !written) {
            if (attempts < 5) {
              attempts += 1
              retryTimer = window.setTimeout(syncProfile, Math.min(1000 * 2 ** attempts, 15000))
            }
            return
          }
        }
      }
      if (!cancelled) setProfileReadyUserId(userId)
    }
    void syncProfile()
    return () => { cancelled = true; window.clearTimeout(retryTimer) }
  }, [persist, profileRetry, storageKey, userId])

  useEffect(() => {
    if (!userId || profileReadyUserId !== userId) return
    const timer = window.setTimeout(() => {
      const local = readStoredWorkspace(storageKey)
      const versioned = { ...navbarLayout, _sync: local.layoutSync }
      void supabase.from('profiles').update({ navbar_layout: versioned }).eq('id', userId).select('id').maybeSingle().then(({ data, error }) => {
        if (error || !data) {
          setProfileReadyUserId(null)
          setProfileRetry(value => value + 1)
        }
      })
    }, 250)
    return () => window.clearTimeout(timer)
  }, [navbarLayout, profileReadyUserId, userId])

  useEffect(() => {
    if (!storageKey) return
    const syncAcrossTabs = (event: StorageEvent) => {
      if (event.key === storageKey) {
        const next = readStoredWorkspace(storageKey)
      setLayoutState(current => current.storageKey === storageKey && JSON.stringify(current.placements) === JSON.stringify(next.placements) && JSON.stringify(current.navbarLayout) === JSON.stringify(next.navbarLayout) ? current : { storageKey, ...next })
      }
    }
    const syncWithinTab = (event: Event) => {
      if ((event as CustomEvent<{ storageKey?: string }>).detail?.storageKey === storageKey) {
        const next = readStoredWorkspace(storageKey)
      setLayoutState(current => current.storageKey === storageKey && JSON.stringify(current.placements) === JSON.stringify(next.placements) && JSON.stringify(current.navbarLayout) === JSON.stringify(next.navbarLayout) ? current : { storageKey, ...next })
      }
    }
    window.addEventListener('storage', syncAcrossTabs)
    window.addEventListener('rr:workspace-layout-changed', syncWithinTab)
    return () => { window.removeEventListener('storage', syncAcrossTabs); window.removeEventListener('rr:workspace-layout-changed', syncWithinTab) }
  }, [storageKey])

  const setNavbarLayout = useCallback((update: NavbarLayoutUpdate) => {
    const active = layoutState.storageKey === storageKey ? layoutState : { storageKey, ...readStoredWorkspace(storageKey) }
    const next = typeof update === 'function' ? update(active.navbarLayout) : update
    const normalized = { mobileSelectedUrls: cleanUrls(next.mobileSelectedUrls, 3) || [], desktopSelectedUrls: cleanUrls(next.desktopSelectedUrls, 10) || [] }
    if (JSON.stringify(normalized) === JSON.stringify(active.navbarLayout)) return

    // User edits write through immediately. The hydration effect never writes
    // defaults, so a late auth/profile response cannot erase a saved layout.
    localEditRevisionRef.current += 1
    const nextState = { ...active, navbarLayout: normalized }
    setLayoutState(nextState)
    persist(nextState.placements, normalized, nextState.optionalFlags)
  }, [layoutState, persist, storageKey])

  const setPlacement = useCallback((path: string, placement: RoutePlacement) => {
    const route = ROUTE_REGISTRY.find(item => item.path === path)
    if (!route || path === '/' || path === '/settings') return
    const current = layoutState.storageKey === storageKey ? layoutState.navbarLayout : readStoredWorkspace(storageKey).navbarLayout
    const key = isMobile ? 'mobileSelectedUrls' : 'desktopSelectedUrls'
    const limit = isMobile ? 3 : 10
    const urls = current[key].filter(item => item !== path)
    if (placement === 'navbar' && urls.length < limit) urls.push(path)
    setNavbarLayout({ ...current, [key]: urls })
  }, [isMobile, layoutState, setNavbarLayout, storageKey])

  const getPlacement = useCallback((path: string) => {
    if (path === '/' || path === '/settings') return 'navbar'
    const key = isMobile ? 'mobileSelectedUrls' : 'desktopSelectedUrls'
    const current = layoutState.storageKey === storageKey ? layoutState.navbarLayout : readStoredWorkspace(storageKey).navbarLayout
    const visible = current[key].slice(0, isMobile ? 3 : desktopCapacity)
    return visible.includes(path) ? 'navbar' : 'settings'
  }, [desktopCapacity, isMobile, layoutState, storageKey])

  const selectedUrls = isMobile ? navbarLayout.mobileSelectedUrls : navbarLayout.desktopSelectedUrls
  const visibleNavbarUrls = selectedUrls.slice(0, isMobile ? 3 : desktopCapacity)
  const visibleSet = new Set(visibleNavbarUrls)
  const navbarRoutes = [
    ROUTE_REGISTRY.find(route => route.path === '/')!,
    ...visibleNavbarUrls.map(path => ROUTE_REGISTRY.find(route => route.path === path)).filter((route): route is NonNullable<typeof route> => Boolean(route) && (!route!.optionalFeature || Boolean(serverFlags[route!.optionalFeature]))),
  ]
  const settingsSections = SETTINGS_GROUPS.map(group => ({
    group,
    routes: CUSTOM_ROUTES.filter(route => route.settingsGroup === group && !visibleSet.has(route.path) && (!route.optionalFeature || Boolean(serverFlags[route.optionalFeature]))),
  })).filter(section => section.routes.length > 0)

  return { isMobile, desktopCapacity, placements, navbarLayout, selectedUrls, visibleNavbarUrls, navbarRoutes, settingsSections, setPlacement, setNavbarLayout, getPlacement }
}

export function resetWorkspacePlacement(path: string, isMobile: boolean) {
  const route = ROUTE_REGISTRY.find(item => item.path === path)
  return route ? getDefaultPlacement(route, isMobile) : 'settings'
}

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FeatureFlags } from './optionalFeatures'
import { getDefaultPlacement, getEffectivePlacement, getGroupedSettingsRoutes, ROUTE_REGISTRY, type FeatureKey, type RoutePlacement } from './routeRegistry'

const MOBILE_QUERY = '(max-width: 767px)'
export const WORKSPACE_LAYOUT_STORAGE_PREFIX = 'rr-capital.workspace-layout.v1'

function getUserStorageKey(userId: string | null) {
  return userId ? `${WORKSPACE_LAYOUT_STORAGE_PREFIX}.${userId}` : null
}

function isMobileViewport() {
  return typeof window !== 'undefined' && window.matchMedia(MOBILE_QUERY).matches
}

function readStoredWorkspace(storageKey: string | null) {
  if (!storageKey) return { placements: {} as Record<string, RoutePlacement>, optionalFlags: {} as FeatureFlags }
  try {
    const raw = JSON.parse(localStorage.getItem(storageKey) || '{}') as { placements?: unknown; optionalFlags?: unknown }
    const placements = raw.placements && typeof raw.placements === 'object' && !Array.isArray(raw.placements)
      ? Object.fromEntries(Object.entries(raw.placements).filter(([path, value]) => ROUTE_REGISTRY.some(route => route.path === path && path !== '/' && path !== '/settings') && (value === 'navbar' || value === 'settings'))) as Record<string, RoutePlacement>
      : {}
    const optionalFlags = raw.optionalFlags && typeof raw.optionalFlags === 'object' && !Array.isArray(raw.optionalFlags)
      ? Object.fromEntries(Object.entries(raw.optionalFlags).filter(([, value]) => typeof value === 'boolean')) as FeatureFlags
      : {}
    return { placements, optionalFlags }
  } catch {
    return { placements: {} as Record<string, RoutePlacement>, optionalFlags: {} as FeatureFlags }
  }
}

export function useWorkspaceLayout(userId: string | null, serverFlags: FeatureFlags) {
  const storageKey = getUserStorageKey(userId)
  const [isMobile, setIsMobile] = useState(isMobileViewport)
  const [placementState, setPlacementState] = useState(() => ({ storageKey, placements: readStoredWorkspace(storageKey).placements }))
  const placements = placementState.storageKey === storageKey ? placementState.placements : readStoredWorkspace(storageKey).placements

  useEffect(() => {
    const media = window.matchMedia(MOBILE_QUERY)
    const handleChange = () => setIsMobile(media.matches)
    handleChange()
    media.addEventListener('change', handleChange)
    return () => media.removeEventListener('change', handleChange)
  }, [])

  const persist = useCallback((nextPlacements: Record<string, RoutePlacement>, nextFlags: FeatureFlags = serverFlags) => {
    if (!storageKey) return
    try {
      localStorage.setItem(storageKey, JSON.stringify({ version: 1, placements: nextPlacements, optionalFlags: nextFlags }))
      window.dispatchEvent(new CustomEvent('rr:workspace-layout-changed', { detail: { storageKey } }))
    } catch {
      // Private browsing or a full storage quota must not block navigation.
    }
  }, [serverFlags, storageKey])

  useEffect(() => {
    if (userId) persist(placements, serverFlags)
  }, [placements, persist, serverFlags, userId])

  useEffect(() => {
    if (!storageKey) return
    const syncAcrossTabs = (event: StorageEvent) => {
      if (event.key === storageKey) {
        const next = readStoredWorkspace(storageKey).placements
        setPlacementState(current => {
          const active = current.storageKey === storageKey ? current.placements : readStoredWorkspace(storageKey).placements
          return JSON.stringify(active) === JSON.stringify(next) ? current : { storageKey, placements: next }
        })
      }
    }
    const syncWithinTab = (event: Event) => {
      if ((event as CustomEvent<{ storageKey?: string }>).detail?.storageKey === storageKey) {
        const next = readStoredWorkspace(storageKey).placements
        setPlacementState(current => {
          const active = current.storageKey === storageKey ? current.placements : readStoredWorkspace(storageKey).placements
          return JSON.stringify(active) === JSON.stringify(next) ? current : { storageKey, placements: next }
        })
      }
    }
    window.addEventListener('storage', syncAcrossTabs)
    window.addEventListener('rr:workspace-layout-changed', syncWithinTab)
    return () => { window.removeEventListener('storage', syncAcrossTabs); window.removeEventListener('rr:workspace-layout-changed', syncWithinTab) }
  }, [storageKey])

  const setPlacement = useCallback((path: string, placement: RoutePlacement) => {
    const route = ROUTE_REGISTRY.find(item => item.path === path)
    if (!route || path === '/' || path === '/settings') return
    setPlacementState(current => {
      const active = current.storageKey === storageKey ? current.placements : readStoredWorkspace(storageKey).placements
      return { storageKey, placements: { ...active, [path]: placement } }
    })
  }, [storageKey])

  const getPlacement = useCallback((path: string) => {
    const route = ROUTE_REGISTRY.find(item => item.path === path)
    return route ? getEffectivePlacement(route, placements, isMobile) : 'settings'
  }, [isMobile, placements])

  const navbarRoutes = useMemo(() => ROUTE_REGISTRY.filter(route => route.path !== '/settings' && getEffectivePlacement(route, placements, isMobile) === 'navbar' && (!route.optionalFeature || Boolean(serverFlags[route.optionalFeature]))), [isMobile, placements, serverFlags])
  const settingsSections = useMemo(() => getGroupedSettingsRoutes(placements, serverFlags as Partial<Record<FeatureKey, boolean>>, isMobile), [isMobile, placements, serverFlags])

  return { isMobile, placements, setPlacement, getPlacement, navbarRoutes, settingsSections }
}

export function resetWorkspacePlacement(path: string, isMobile: boolean) {
  const route = ROUTE_REGISTRY.find(item => item.path === path)
  return route ? getDefaultPlacement(route, isMobile) : 'settings'
}

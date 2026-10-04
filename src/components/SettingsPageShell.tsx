import type { ReactNode } from 'react'
import { ArrowLeftRight, ChevronLeft } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { RouteDefinition, RoutePlacement } from '../lib/routeRegistry'

export default function SettingsPageShell({ route, placement, onPlacementChange, children }: {
  route: RouteDefinition
  placement: RoutePlacement
  onPlacementChange: (placement: RoutePlacement) => void
  children: ReactNode
}) {
  if (route.utility || placement !== 'settings' || route.path === '/' || route.path === '/settings') return <>{children}</>
  return <>
    <div className="settings-page-context mx-auto flex w-full max-w-7xl flex-col gap-3 px-4 pt-3 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
      <nav aria-label="Workspace breadcrumb" className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-[var(--muted)]">
        <Link to="/settings" className="inline-flex items-center gap-1 rounded-lg py-1 font-semibold text-[var(--brand-primary-active)] hover:underline"><ChevronLeft className="h-3.5 w-3.5" />Back to Settings</Link>
        <span aria-hidden="true">/</span><span>{route.settingsGroup}</span><span aria-hidden="true">/</span><span className="font-semibold text-[var(--ink)]">{route.title}</span>
      </nav>
      <button type="button" onClick={() => onPlacementChange(placement === 'settings' ? 'navbar' : 'settings')} className="inline-flex min-h-9 shrink-0 items-center justify-center gap-2 self-start rounded-xl border border-[var(--line)] bg-[var(--surface-card)] px-3 text-xs font-semibold text-[var(--ink)] transition-colors hover:bg-[var(--surface-strong)] sm:self-auto">
        <ArrowLeftRight className="h-3.5 w-3.5" />Move to {placement === 'settings' ? 'Navbar' : `Settings (${route.settingsGroup})`}
      </button>
    </div>
    {children}
  </>
}

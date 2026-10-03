import type { ReactNode } from 'react'
import { ArrowLeftRight, ChevronLeft } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { RouteDefinition } from '../lib/routeRegistry'
import type { RoutePlacement } from '../lib/routeRegistry'

export default function SettingsPageShell({ route, placement, onPlacementChange, children }: {
  route: RouteDefinition
  placement: RoutePlacement
  onPlacementChange: (placement: RoutePlacement) => void
  children: ReactNode
}) {
  if (placement !== 'settings' || route.path === '/' || route.path === '/settings') return <>{children}</>
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
    <section className="settings-workspace-scaffold mx-auto w-full max-w-7xl px-4 pt-5 sm:px-6 lg:px-8" aria-label={`${route.title} workspace layout`}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3" aria-label={`${route.title} KPI summary placeholders`}>
        {['Primary indicator', 'Period summary', 'Status summary'].map((title, index) => <div key={title} className="rounded-2xl border border-[var(--line)] bg-[var(--surface-card)] px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-[.12em] text-[var(--muted)]">{title}</p>
          <p className="mt-1 text-sm font-semibold text-[var(--ink)]">{index === 0 ? route.title : index === 1 ? route.settingsGroup : 'Module overview'}</p>
          <p className="mt-1 text-xs text-[var(--muted)]">Live summary placeholder</p>
        </div>)}
      </div>
      <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-12" aria-label={`${route.title} workspace slots`}>
        {route.slots.map((slot, index) => <div key={slot} className={`min-w-0 rounded-2xl border border-dashed border-[var(--line)] bg-[var(--surface-soft)] p-4 ${route.slots.length === 1 ? 'xl:col-span-12' : route.slots.length === 2 ? 'xl:col-span-6' : index === 0 ? 'xl:col-span-8' : 'xl:col-span-4'}`}>
          <p className="text-[10px] font-semibold uppercase tracking-[.12em] text-[var(--brand-primary-active)]">Workspace slot {index + 1}</p>
          <h2 className="mt-1 text-sm font-semibold text-[var(--ink)]">{slot}</h2>
          <p className="mt-1 text-xs text-[var(--muted)]">Module workspace placeholder</p>
        </div>)}
      </div>
    </section>
    {children}
  </>
}

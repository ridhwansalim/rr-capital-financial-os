import { useState } from 'react'
import { Bell, CalendarClock, CloudUpload, ShieldAlert } from 'lucide-react'
import { Link } from 'react-router-dom'
import PageHeader from '../components/PageHeader'
import PendingRequests from '../components/PendingRequests'
import LiquidGlassSwitcher from '../components/ui/LiquidGlassSwitcher'
import { liquidGlassItemProps } from '../components/ui/liquidGlassSwitcherItem'
import { useNotificationSummaryContext } from '../lib/notificationSummary'

type TabKey = 'approvals' | 'alerts'

export default function Notifications() {
  const [tab, setTab] = useState<TabKey>('approvals')
  const summary = useNotificationSummaryContext()

  const approvalsCount = summary.approvalCount
  const alertIcon = (kind: string) => kind === 'offline' ? <CloudUpload className="h-4 w-4" /> : kind === 'commitment' ? <CalendarClock className="h-4 w-4" /> : <ShieldAlert className="h-4 w-4" />

  return (
    <div className="page-shell mx-auto w-full max-w-6xl animate-in fade-in duration-300 pb-32">
      <PageHeader title="Notifications & approvals" description="Requests and account activity that need your attention." icon={<Bell className="text-[var(--brand-primary-active)]" />} />
      <LiquidGlassSwitcher activeKey={tab} label="Notification views" role="tablist" className="app-modal-liquid-switcher mb-5 w-full">
        <button id="notifications-approvals-tab" type="button" role="tab" aria-selected={tab === 'approvals'} aria-controls="notifications-panel" {...liquidGlassItemProps('approvals', tab === 'approvals', 'min-h-11 flex-1 justify-center px-3 text-center text-sm font-semibold')} onClick={() => setTab('approvals')}>
          <span>Pending Approvals</span><span className="navbar-viewport-switcher__count">{approvalsCount}</span>
        </button>
        <button id="notifications-alerts-tab" type="button" role="tab" aria-selected={tab === 'alerts'} aria-controls="notifications-panel" {...liquidGlassItemProps('alerts', tab === 'alerts', 'min-h-11 flex-1 justify-center px-3 text-center text-sm font-semibold')} onClick={() => setTab('alerts')}>
          <span>Actionable Alerts</span><span className="navbar-viewport-switcher__count">{summary.alerts.length}</span>
        </button>
      </LiquidGlassSwitcher>

      <section id="notifications-panel" role="tabpanel" aria-labelledby={tab === 'approvals' ? 'notifications-approvals-tab' : 'notifications-alerts-tab'}>
        {tab === 'approvals' ? <div className="surface-panel rounded-3xl p-4 sm:p-6"><PendingRequests showEmpty /></div> : (
          <div className="space-y-3">
            {summary.loading && summary.alerts.length === 0 && <div role="status" className="surface-panel rounded-2xl p-5 text-sm text-[var(--muted)]">Checking your accounts and schedules…</div>}
            {summary.alerts.map(alert => <Link key={alert.id} to={alert.href} className="surface-panel flex items-center gap-3 rounded-2xl p-4 transition-colors hover:bg-[var(--surface-strong)]">
              <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${alert.kind === 'offline' ? 'bg-amber-500/12 text-amber-700' : alert.kind === 'commitment' ? 'bg-violet-500/12 text-violet-700' : 'bg-rose-500/12 text-rose-700'}`}>{alertIcon(alert.kind)}</span>
              <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-[var(--ink)]">{alert.title}</span><span className="mt-1 block truncate text-xs text-[var(--muted)]">{alert.detail}</span></span>
              <span className="shrink-0 text-xs font-semibold text-[var(--brand-primary-active)]">View</span>
            </Link>)}
            {!summary.loading && summary.alerts.length === 0 && <div className="surface-panel rounded-3xl px-5 py-12 text-center"><span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-[var(--brand-tint)] text-[var(--brand-primary-active)]"><Bell className="h-5 w-5" /></span><h2 className="mt-4 text-base font-semibold">No actionable alerts</h2><p className="mt-1 text-sm text-[var(--muted)]">Your offline queue, account thresholds, and upcoming installments look clear.</p></div>}
          </div>
        )}
      </section>
    </div>
  )
}

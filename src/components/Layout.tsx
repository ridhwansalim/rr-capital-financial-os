import React, { lazy, Suspense, useState, useEffect, useRef, useCallback } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Plus, CreditCard, Users, LayoutDashboard, Wallet, Receipt, Settings, ArrowRightLeft, CalendarDays, Landmark, Menu, X, CloudUpload, ChartNoAxesCombined, Calculator, PiggyBank, ShoppingBasket, HeartPulse, ChevronDown, type LucideIcon } from 'lucide-react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import type { TransactionDraft } from './TransactionModal'
import { useOptionalFeatures } from '../lib/optionalFeatures'
import PageGuidance from './PageGuidance'
import CreatorProfileDialog from './CreatorProfileDialog'
import { supabase } from '../lib/supabase'
import { localDB } from '../lib/db'

// Entry forms are used only after an explicit add action; keep their code out of
// every page's initial mobile bundle.
const TransactionModal = lazy(() => import('./TransactionModal'))
const AddDebtModal = lazy(() => import('./AddDebtModal'))

const routePrefetchers: Record<string, () => Promise<unknown>> = {
  '/': () => import('../screens/Dashboard'),
  '/calendar': () => import('../screens/Calendar'),
  '/ledger': () => import('../screens/Ledger'),
  '/reports': () => import('../screens/Reports'),
  '/offline': () => import('../screens/OfflineQueue'),
  '/chittis': () => import('../screens/Chittis'),
  '/accounts': () => import('../screens/Accounts'),
  '/debts': () => import('../screens/Debts'),
  '/contacts': () => import('../screens/Contacts'),
  '/settings': () => import('../screens/Settings'),
  '/budgets': () => import('../screens/Budgets'),
  '/calculators': () => import('../screens/Calculators'),
  '/savings-goals': () => import('../screens/SavingsGoals'),
  '/shopping-lists': () => import('../screens/ShoppingLists'),
  '/financial-health': () => import('../screens/FinancialHealthScore'),
}

function prefetchRoute(path: string) {
  const prefetch = routePrefetchers[path]
  if (prefetch) void prefetch().catch(() => {})
}

type NavigationItem = { name: string; path: string; icon: LucideIcon }

function NavigationSection({
  title,
  items,
  activePath,
  onNavigate,
  pendingCount,
  mobile = false,
}: {
  title: string
  items: NavigationItem[]
  activePath: string
  onNavigate?: () => void
  pendingCount: number
  mobile?: boolean
}) {
  if (!items.length) return null
  return (
    <section aria-label={title} className={mobile ? 'grid grid-cols-3 gap-x-2 gap-y-4' : 'space-y-1'}>
      <h3 className={mobile ? 'col-span-full px-1 text-[10px] font-semibold uppercase tracking-[0.15em] text-[var(--muted)]' : 'px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.15em] text-[var(--muted)]'}>{title}</h3>
      {items.map(item => {
        const isActive = activePath === item.path
        const count = item.path === '/offline' ? pendingCount : 0
        return (
          <Link
            key={item.name}
            to={item.path}
            onPointerEnter={() => prefetchRoute(item.path)}
            onFocus={() => prefetchRoute(item.path)}
            onClick={onNavigate}
            aria-current={isActive ? 'page' : undefined}
            className={mobile
              ? `flex min-h-[76px] flex-col items-center justify-center gap-1.5 rounded-xl px-1 py-2 text-center transition-colors ${isActive ? 'bg-[var(--brand-tint)] text-[var(--brand-primary-active)]' : 'text-[var(--muted)] hover:bg-[var(--surface-soft)] hover:text-[var(--ink)]'}`
              : `flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors ${isActive ? 'bg-[var(--brand-tint)] text-[var(--brand-primary-active)]' : 'text-[var(--muted)] hover:bg-[var(--surface-soft)] hover:text-[var(--ink)]'}`}
          >
            <span className={`relative grid shrink-0 place-items-center ${mobile ? 'h-10 w-10 rounded-xl bg-[var(--surface-soft)]' : 'h-8 w-8 rounded-lg'}`}>
              <item.icon className={mobile ? 'h-5 w-5' : 'h-4 w-4'} />
              {count > 0 && <span className="absolute -right-1.5 -top-1.5 grid min-h-5 min-w-5 place-items-center rounded-full bg-amber-500 px-1 text-[10px] font-bold leading-none text-slate-950" aria-label={`${count} pending offline transactions`}>{count > 99 ? '99+' : count}</span>}
            </span>
            <span className={mobile ? 'max-w-full truncate text-[10px] font-medium' : 'min-w-0 flex-1'}>{item.name}</span>
            {!mobile && count > 0 && <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-600">{count > 99 ? '99+' : count}</span>}
          </Link>
        )
      })}
    </section>
  )
}

const primaryNavItems: NavigationItem[] = [
  { name: 'Dashboard', path: '/', icon: LayoutDashboard },
  { name: 'Calendar', path: '/calendar', icon: CalendarDays },
  { name: 'Ledger', path: '/ledger', icon: ArrowRightLeft },
  { name: 'Reports', path: '/reports', icon: ChartNoAxesCombined },
  { name: 'Accounts', path: '/accounts', icon: Wallet },
]

const desktopWorkspaceItems: NavigationItem[] = [
  { name: 'Chittis', path: '/chittis', icon: Landmark },
  { name: 'Debts & IOUs', path: '/debts', icon: Receipt },
  { name: 'Contacts', path: '/contacts', icon: Users },
  { name: 'Offline queue', path: '/offline', icon: CloudUpload },
]

const mobileWorkspaceItems: NavigationItem[] = [
  { name: 'Calendar', path: '/calendar', icon: CalendarDays },
  { name: 'Reports', path: '/reports', icon: ChartNoAxesCombined },
  { name: 'Accounts', path: '/accounts', icon: Wallet },
  { name: 'Debts & IOUs', path: '/debts', icon: Receipt },
  { name: 'Contacts', path: '/contacts', icon: Users },
  { name: 'Offline queue', path: '/offline', icon: CloudUpload },
]

const optionalNavigationItems: Array<NavigationItem & { feature: 'budgets' | 'calculators' | 'savings_goals' | 'shopping_lists' | 'financial_health_score' }> = [
  { name: 'Budgets', path: '/budgets', icon: Wallet, feature: 'budgets' },
  { name: 'Calculators', path: '/calculators', icon: Calculator, feature: 'calculators' },
  { name: 'Savings goals', path: '/savings-goals', icon: PiggyBank, feature: 'savings_goals' },
  { name: 'Shopping lists', path: '/shopping-lists', icon: ShoppingBasket, feature: 'shopping_lists' },
  { name: 'Financial wellness', path: '/financial-health', icon: HeartPulse, feature: 'financial_health_score' },
]

const routeTitles: Record<string, string> = {
  '/': 'Dashboard', '/calendar': 'Calendar', '/ledger': 'Ledger', '/reports': 'Reports',
  '/accounts': 'Accounts', '/chittis': 'Chittis', '/debts': 'Debts & IOUs', '/contacts': 'Contacts',
  '/offline': 'Offline queue', '/settings': 'Settings', '/budgets': 'Budgets', '/calculators': 'Calculators',
  '/savings-goals': 'Savings goals', '/shopping-lists': 'Shopping lists', '/financial-health': 'Financial wellness',
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const [isFabOpen, setIsFabOpen] = useState(false)
  const [isTxModalOpen, setIsTxModalOpen] = useState(false)
  const [isDebtModalOpen, setIsDebtModalOpen] = useState(false)
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const [isDesktopMenuOpen, setIsDesktopMenuOpen] = useState(false)
  const [sharedFile, setSharedFile] = useState<File | null>(null)
  const [isAboutOpen, setIsAboutOpen] = useState(false)
  const [transactionDraft, setTransactionDraft] = useState<TransactionDraft | null>(null)
  const modalHistoryRef = React.useRef(false)
  const desktopMoreRef = useRef<HTMLDivElement>(null)
  const desktopAddRef = useRef<HTMLDivElement>(null)
  const mobileAddActionsRef = useRef<HTMLDivElement>(null)
  const [authenticatedUserId, setAuthenticatedUserId] = useState<string | null>(null)
  const location = useLocation()
  const navigate = useNavigate()
  const routeNotice = (location.state as { routeNotice?: string } | null)?.routeNotice || ''
  const { flags } = useOptionalFeatures()
  const pendingCount = useLiveQuery(async () => {
    if (!authenticatedUserId) return 0
    try {
      return await localDB.outbox.where('owner_id').equals(authenticatedUserId)
        .filter(item => item.sync_status !== 'synced').count()
    } catch {
      return 0
    }
  }, [authenticatedUserId], 0) || 0
  const enabledOptionalItems = optionalNavigationItems.filter(item => flags[item.feature])

  const activeTitle = routeTitles[location.pathname] || 'Dashboard'
  const closeAbout = useCallback(() => setIsAboutOpen(false), [])
  const openTransaction = () => { setIsTxModalOpen(true); setIsFabOpen(false) }
  const openDebt = () => { setIsDebtModalOpen(true); setIsFabOpen(false) }

  useEffect(() => {
    let active = true
    void supabase.auth.getSession().then(({ data }) => {
      if (active) setAuthenticatedUserId(data.session?.user.id || null)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthenticatedUserId(session?.user.id || null)
    })
    return () => { active = false; subscription.unsubscribe() }
  }, [])

  useEffect(() => {
    if (!routeNotice) return
    const timer = window.setTimeout(() => navigate(location.pathname, { replace: true, state: null }), 4200)
    return () => window.clearTimeout(timer)
  }, [location.pathname, navigate, routeNotice])

  useEffect(() => {
    if (!isDesktopMenuOpen && !isFabOpen) return
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node
      if (isDesktopMenuOpen && !desktopMoreRef.current?.contains(target)) setIsDesktopMenuOpen(false)
      if (isFabOpen && !desktopAddRef.current?.contains(target) && !mobileAddActionsRef.current?.contains(target)) setIsFabOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setIsDesktopMenuOpen(false); setIsFabOpen(false) }
    }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => { document.removeEventListener('pointerdown', closeOutside); document.removeEventListener('keydown', closeOnEscape) }
  }, [isDesktopMenuOpen, isFabOpen])

  useEffect(() => {
    const openDraft = (event: Event) => {
      const draft = (event as CustomEvent<TransactionDraft>).detail
      if (!draft || !['expense', 'income', 'transfer'].includes(draft.type)) return
      setTransactionDraft(draft)
      setIsTxModalOpen(true)
    }
    window.addEventListener('rr:transaction-draft', openDraft)
    return () => window.removeEventListener('rr:transaction-draft', openDraft)
  }, [])

  useEffect(() => {
    const modalOpen = isTxModalOpen || isDebtModalOpen
    if (modalOpen && !modalHistoryRef.current) {
      window.history.pushState({ ...(window.history.state || {}), rrModalOpen: true }, '', window.location.href)
      modalHistoryRef.current = true
    } else if (!modalOpen && modalHistoryRef.current) {
      modalHistoryRef.current = false
      if (window.history.state?.rrModalOpen) window.history.back()
    }
    const closeOnBack = () => {
      if (!modalHistoryRef.current) return
      modalHistoryRef.current = false
      const backEvent = new Event('rr:modal-back', { cancelable: true })
      window.dispatchEvent(backEvent)
      if (backEvent.defaultPrevented) {
        window.history.pushState({ ...(window.history.state || {}), rrModalOpen: true }, '', window.location.href)
        modalHistoryRef.current = true
      } else {
        setIsTxModalOpen(false); setIsDebtModalOpen(false); setSharedFile(null)
      }
    }
    window.addEventListener('popstate', closeOnBack)
    return () => window.removeEventListener('popstate', closeOnBack)
  }, [isTxModalOpen, isDebtModalOpen])

  useEffect(() => { setIsMobileMenuOpen(false); setIsDesktopMenuOpen(false); setIsFabOpen(false) }, [location.pathname])

  useEffect(() => {
    const checkSharedFiles = async () => {
      try {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open('FinOS-Share', 1)
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => reject(request.error)
        })
        if (!db.objectStoreNames.contains('shared-files')) return
        const tx = db.transaction('shared-files', 'readwrite')
        const store = tx.objectStore('shared-files')
        const getRequest = store.get('latest-image')
        getRequest.onsuccess = () => {
          const file = getRequest.result
          if (file) { setSharedFile(file); setIsTxModalOpen(true); store.delete('latest-image') }
        }
      } catch { console.log('No shared file is available to import') }
    }
    void checkSharedFiles()
  }, [])
  return (
    <div className="app-shell relative min-h-screen bg-transparent font-sans text-[var(--ink)]">
      <nav aria-label="Primary navigation" className="app-sidebar fixed inset-x-0 top-0 z-40 hidden h-16 items-center gap-1 border-b px-2 lg:gap-3 lg:px-7 md:flex">
        <button type="button" onClick={() => setIsAboutOpen(true)} className="flex shrink-0 items-center gap-2.5 text-left" aria-label="About RR Capital and its creator" title="RR Capital · About the creator">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#f8f9fa]"><img src="/rr-favicon.svg" alt="" className="h-7 w-7" /></span>
          <div className="hidden min-w-0 lg:block"><p className="font-semibold tracking-tight text-[var(--ink)]">RR Capital</p><p className="text-[10px] text-[var(--muted)]">Personal finance</p></div>
        </button>
        <div className="flex min-w-0 flex-1 items-center justify-center gap-0.5">
          {primaryNavItems.map(item => <Link key={item.name} to={item.path} onPointerEnter={() => prefetchRoute(item.path)} onFocus={() => prefetchRoute(item.path)} aria-label={item.name} title={item.name} aria-current={location.pathname === item.path ? 'page' : undefined} className={`app-nav-item flex shrink-0 items-center gap-1.5 px-2 py-2 transition-all lg:gap-2 lg:px-3 ${location.pathname === item.path ? 'is-active' : 'text-[var(--muted)] hover:text-[var(--ink)]'}`}><item.icon className="h-4 w-4" /><span className="hidden font-medium text-[13px] lg:inline">{item.name}</span></Link>)}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="relative" ref={desktopMoreRef}>
            <button type="button" onClick={() => setIsDesktopMenuOpen(value => !value)} aria-expanded={isDesktopMenuOpen} aria-haspopup="menu" className={`app-nav-item inline-flex items-center gap-2 px-3 py-2 text-sm ${isDesktopMenuOpen ? 'is-active' : 'text-[var(--muted)] hover:text-[var(--ink)]'}`}>More {pendingCount > 0 && <span className="grid min-h-5 min-w-5 place-items-center rounded-full bg-amber-500 px-1 text-[10px] font-bold text-slate-950">{pendingCount > 99 ? '99+' : pendingCount}</span>}<ChevronDown className={`h-3.5 w-3.5 transition-transform ${isDesktopMenuOpen ? 'rotate-180' : ''}`} /></button>
            {isDesktopMenuOpen && <div role="menu" className="app-desktop-menu absolute right-0 top-12 z-50 max-h-[calc(100vh-5rem)] w-64 overflow-y-auto rounded-2xl border p-2 shadow-xl"><NavigationSection title="Workspace" items={desktopWorkspaceItems} activePath={location.pathname} onNavigate={() => setIsDesktopMenuOpen(false)} pendingCount={pendingCount} /><NavigationSection title="Optional modules" items={enabledOptionalItems} activePath={location.pathname} onNavigate={() => setIsDesktopMenuOpen(false)} pendingCount={pendingCount} /><NavigationSection title="Preferences" items={[{ name: 'Settings', path: '/settings', icon: Settings }]} activePath={location.pathname} onNavigate={() => setIsDesktopMenuOpen(false)} pendingCount={pendingCount} /></div>}
          </div>
        </div>
      </nav>

      <div className="app-mobile-context fixed inset-x-0 top-0 z-30 flex h-14 items-center justify-between border-b px-4 md:hidden">
        <button type="button" onClick={() => setIsAboutOpen(true)} className="flex min-w-0 items-center gap-2 text-left" aria-label="About RR Capital and its creator"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#f8f9fa]"><img src="/rr-favicon.svg" alt="" className="h-6 w-6" /></span><span className="truncate text-sm font-semibold">RR Capital</span></button>
        <div className="flex items-center gap-2"><span className="max-w-[45vw] truncate text-xs font-medium text-[var(--muted)]">{activeTitle}</span>{pendingCount > 0 && <Link to="/offline" aria-label={`${pendingCount} pending offline transactions`} className="inline-flex min-h-8 items-center gap-1.5 rounded-full bg-amber-500/15 px-2.5 text-[10px] font-semibold text-amber-700"><CloudUpload className="h-3.5 w-3.5" />{pendingCount} pending</Link>}</div>
      </div>
      <CreatorProfileDialog isOpen={isAboutOpen} onClose={closeAbout} />
      {routeNotice && <div role="status" className="fixed left-1/2 top-[4.5rem] z-[70] -translate-x-1/2 rounded-full border border-[var(--line)] bg-[var(--app-panel-strong)] px-4 py-2 text-sm text-[var(--ink)] shadow-lg">{routeNotice}</div>}

      <main className="app-main relative z-0 min-h-screen pb-28 pt-14 md:pb-0 md:pt-16">
        <PageGuidance page={location.pathname} />
        {children}
      </main>

      <div aria-hidden={!isMobileMenuOpen} inert={!isMobileMenuOpen} className={`md:hidden fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity duration-300 ${isMobileMenuOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`} onMouseDown={event => { if (event.target === event.currentTarget) setIsMobileMenuOpen(false) }}>
        <div role="dialog" aria-modal="true" aria-label="More pages" className={`app-mobile-sheet absolute bottom-[calc(5.5rem+env(safe-area-inset-bottom))] left-3 right-3 max-h-[min(78vh,44rem)] overflow-y-auto rounded-3xl border p-5 shadow-2xl transition-transform duration-300 ${isMobileMenuOpen ? 'translate-y-0' : 'translate-y-5'}`}>
          <div className="mb-4 flex items-center justify-between border-b border-[var(--line)] pb-4"><div><h3 className="text-lg font-semibold">More pages</h3><p className="mt-0.5 text-xs text-[var(--muted)]">Your complete workspace</p></div><button type="button" aria-label="Close more pages" onClick={() => setIsMobileMenuOpen(false)} className="rounded-full p-2 text-[var(--muted)] hover:bg-[var(--surface-soft)]"><X className="h-5 w-5" /></button></div>
          <NavigationSection title="Workspace" items={mobileWorkspaceItems} activePath={location.pathname} onNavigate={() => setIsMobileMenuOpen(false)} pendingCount={pendingCount} mobile />
          <div className="mt-4"><NavigationSection title="Optional modules" items={enabledOptionalItems} activePath={location.pathname} onNavigate={() => setIsMobileMenuOpen(false)} pendingCount={pendingCount} mobile /></div>
          <div className="mt-4"><NavigationSection title="Preferences" items={[{ name: 'Settings', path: '/settings', icon: Settings }]} activePath={location.pathname} onNavigate={() => setIsMobileMenuOpen(false)} pendingCount={pendingCount} mobile /></div>
        </div>
      </div>

      <nav aria-label="Mobile navigation" style={{ height: 'calc(76px + env(safe-area-inset-bottom))' }} className="app-mobile-nav md:hidden fixed bottom-0 left-0 right-0 z-40 grid grid-cols-5 items-center border-t px-2 pb-[env(safe-area-inset-bottom)]">
        {primaryNavItems.slice(0, 1).concat(primaryNavItems[2]).map(item => <Link key={item.path} to={item.path} onClick={() => setIsFabOpen(false)} onPointerEnter={() => prefetchRoute(item.path)} onFocus={() => prefetchRoute(item.path)} aria-current={location.pathname === item.path ? 'page' : undefined} className={`relative z-50 flex flex-col items-center justify-center gap-1 py-2 ${location.pathname === item.path ? 'text-[var(--brand-primary-active)]' : 'text-[var(--muted)]'}`}><item.icon className="h-5 w-5" /><span className="text-[10px] font-medium">{item.name}</span></Link>)}
        <button type="button" aria-label={isFabOpen ? 'Close add menu' : 'Add transaction or debt'} aria-expanded={isFabOpen} onClick={() => setIsFabOpen(!isFabOpen)} className={`app-mobile-fab relative z-50 -mt-7 flex h-14 w-14 items-center justify-center justify-self-center rounded-full border-4 border-[var(--app-bg)] text-white shadow-[0_8px_24px_rgba(0,0,0,0.24)] transition-all duration-200 active:scale-95 ${isFabOpen ? 'rotate-45' : 'hover:-translate-y-0.5'}`}><Plus className="h-7 w-7" /></button>
        <Link to="/chittis" onClick={() => setIsFabOpen(false)} onPointerEnter={() => prefetchRoute('/chittis')} onFocus={() => prefetchRoute('/chittis')} aria-current={location.pathname === '/chittis' ? 'page' : undefined} className={`relative z-50 flex flex-col items-center justify-center gap-1 py-2 ${location.pathname === '/chittis' ? 'text-[var(--brand-primary-active)]' : 'text-[var(--muted)]'}`}><Landmark className="h-5 w-5" /><span className="text-[10px] font-medium">Chittis</span></Link>
        <button type="button" aria-label={isMobileMenuOpen ? 'Close more pages' : 'Open more pages'} aria-expanded={isMobileMenuOpen} onClick={() => { setIsFabOpen(false); setIsMobileMenuOpen(!isMobileMenuOpen) }} className={`relative z-50 flex flex-col items-center justify-center gap-1 py-2 ${isMobileMenuOpen ? 'text-[var(--brand-primary-active)]' : 'text-[var(--muted)]'}`}><Menu className="h-5 w-5" /><span className="text-[10px] font-medium">More</span></button>
      </nav>

      <div ref={desktopAddRef} className="fixed bottom-8 right-8 z-50 hidden flex-col items-end gap-3 md:flex">
        <div aria-hidden={!isFabOpen} className={`flex flex-col items-end gap-2 transition-all duration-200 ${isFabOpen ? 'translate-y-0 opacity-100 pointer-events-auto' : 'translate-y-2 opacity-0 pointer-events-none'}`}>
          <button type="button" tabIndex={isFabOpen ? 0 : -1} disabled={!isFabOpen} onClick={openTransaction} className="flex min-h-12 items-center gap-3 rounded-full border border-[var(--line)] bg-[var(--app-panel-strong)] px-4 text-sm font-medium text-[var(--ink)] shadow-xl"><span>Transaction</span><span className="rounded-full bg-[var(--brand-primary)] p-2 text-white"><CreditCard className="h-4 w-4" /></span></button>
          <button type="button" tabIndex={isFabOpen ? 0 : -1} disabled={!isFabOpen} onClick={openDebt} className="flex min-h-12 items-center gap-3 rounded-full border border-[var(--line)] bg-[var(--app-panel-strong)] px-4 text-sm font-medium text-[var(--ink)] shadow-xl"><span>Debt / IOU</span><span className="rounded-full bg-emerald-600 p-2 text-white"><Users className="h-4 w-4" /></span></button>
        </div>
        <button type="button" aria-label={isFabOpen ? 'Close add menu' : 'Open add menu'} aria-expanded={isFabOpen} onClick={() => setIsFabOpen(value => !value)} className={`app-desktop-fab liquid-action grid h-14 w-14 place-items-center rounded-full text-white transition duration-200 hover:-translate-y-0.5 active:scale-95 ${isFabOpen ? 'rotate-45' : ''}`}><Plus className="h-6 w-6" /></button>
      </div>

      <div ref={mobileAddActionsRef} role="group" aria-label="Quick add actions" aria-hidden={!isFabOpen} className={`md:hidden fixed bottom-[calc(100px+env(safe-area-inset-bottom))] left-1/2 z-40 flex -translate-x-1/2 flex-col items-center gap-3 transition-all duration-200 ${isFabOpen ? 'translate-y-0 opacity-100 pointer-events-auto' : 'translate-y-2 opacity-0 pointer-events-none'}`}>
        <button type="button" tabIndex={isFabOpen ? 0 : -1} disabled={!isFabOpen} onClick={openTransaction} className="flex items-center gap-3 rounded-full border border-[var(--line)] bg-[var(--app-panel-strong)] px-4 py-2 text-[var(--ink)] shadow-xl"><span className="text-sm font-medium">Transaction</span><span className="rounded-full bg-[var(--brand-primary)] p-2 text-[#fff]"><CreditCard className="h-4 w-4" /></span></button>
        <button type="button" tabIndex={isFabOpen ? 0 : -1} disabled={!isFabOpen} onClick={openDebt} className="flex items-center gap-3 rounded-full border border-[var(--line)] bg-[var(--app-panel-strong)] px-4 py-2 text-[var(--ink)] shadow-xl"><span className="text-sm font-medium">Add Debt / IOU</span><span className="rounded-full bg-emerald-600 p-2 text-[#fff]"><Users className="h-4 w-4" /></span></button>
      </div>

      <Suspense fallback={<div className="fixed inset-0 z-[70] grid place-items-center bg-black/55 p-4" role="status" aria-live="polite"><div className="surface-panel rounded-2xl px-5 py-4 text-sm text-[var(--muted)]">Opening form…</div></div>}>
        {isTxModalOpen && <TransactionModal isOpen onClose={() => { setIsTxModalOpen(false); setSharedFile(null); setTransactionDraft(null) }} initialFile={sharedFile} initialDraft={transactionDraft} />}
        {isDebtModalOpen && <AddDebtModal isOpen onClose={() => setIsDebtModalOpen(false)} />}
      </Suspense>
    </div>
  )
}

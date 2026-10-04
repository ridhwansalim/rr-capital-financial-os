import React, { lazy, Suspense, useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { Plus, CreditCard, Users, Settings, CloudUpload } from 'lucide-react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import type { TransactionDraft } from './TransactionModal'
import { useOptionalFeatures } from '../lib/optionalFeatures'
import PageGuidance from './PageGuidance'
import CreatorProfileDialog from './CreatorProfileDialog'
import { supabase } from '../lib/supabase'
import { localDB } from '../lib/db'
import LiquidGlassSwitcher from './ui/LiquidGlassSwitcher'
import { liquidGlassItemProps } from './ui/liquidGlassSwitcherItem'
import { findRoute } from '../lib/routeRegistry'
import { useWorkspaceLayout } from '../lib/workspaceLayout'
import { WorkspaceLayoutContext } from '../lib/workspaceLayoutContext'
import SettingsPageShell from './SettingsPageShell'

// Entry forms are used only after an explicit add action; keep their code out of
// every page's initial mobile bundle.
const TransactionModal = lazy(() => import('./TransactionModal'))
const AddDebtModal = lazy(() => import('./AddDebtModal'))

const routePrefetchers: Record<string, () => Promise<unknown>> = {
  '/': () => import('../screens/Dashboard'), '/ledger': () => import('../screens/Ledger'), '/calendar': () => import('../screens/Calendar'),
  '/chittis': () => import('../screens/Chittis'), '/debts': () => import('../screens/Debts'), '/accounts': () => import('../screens/Accounts'),
  '/contacts': () => import('../screens/Contacts'), '/offline': () => import('../screens/OfflineQueue'), '/reports': () => import('../screens/Reports'),
  '/financial-health': () => import('../screens/FinancialHealthScore'), '/budgets': () => import('../screens/Budgets'), '/savings-goals': () => import('../screens/SavingsGoals'),
  '/calculators': () => import('../screens/Calculators'), '/shopping-lists': () => import('../screens/ShoppingLists'), '/settings': () => import('../screens/Settings'),
}

function prefetchRoute(path: string) { void routePrefetchers[path]?.().catch(() => {}) }

export default function Layout({ children }: { children: React.ReactNode }) {
  const [isFabOpen, setIsFabOpen] = useState(false)
  const [isTxModalOpen, setIsTxModalOpen] = useState(false)
  const [isDebtModalOpen, setIsDebtModalOpen] = useState(false)
  const [sharedFile, setSharedFile] = useState<File | null>(null)
  const [isAboutOpen, setIsAboutOpen] = useState(false)
  const [transactionDraft, setTransactionDraft] = useState<TransactionDraft | null>(null)
  const modalHistoryRef = React.useRef(false)
  const desktopAddRef = useRef<HTMLDivElement>(null)
  const mobileFabRef = useRef<HTMLButtonElement>(null)
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
  const workspace = useWorkspaceLayout(authenticatedUserId, flags)
  const activeRoute = findRoute(location.pathname) || findRoute('/')!
  const { navbarRoutes, setPlacement, getPlacement } = workspace
  const activeNavigationKey = navbarRoutes.some(route => route.path === location.pathname) ? location.pathname : 'settings'
  const mobileDashboard = navbarRoutes[0]!
  const mobileCustomRoutes = workspace.visibleNavbarUrls.map(path => findRoute(path)).filter((route): route is NonNullable<typeof route> => Boolean(route))
  const MobileDashboardIcon = mobileDashboard.icon
  const MobileFirstIcon = mobileCustomRoutes[0]?.icon
  const MobileSecondIcon = mobileCustomRoutes[1]?.icon
  const activeTitle = activeRoute.title
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
    if (!isFabOpen) return
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node
      if (isFabOpen && !desktopAddRef.current?.contains(target) && !mobileFabRef.current?.contains(target) && !mobileAddActionsRef.current?.contains(target)) setIsFabOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsFabOpen(false)
    }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => { document.removeEventListener('pointerdown', closeOutside); document.removeEventListener('keydown', closeOnEscape) }
  }, [isFabOpen])

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

  useEffect(() => { setIsFabOpen(false) }, [location.pathname])

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
    <WorkspaceLayoutContext.Provider value={workspace}>
    <div className="app-shell relative min-h-screen bg-transparent font-sans text-[var(--ink)]">
      <nav aria-label="Primary navigation" className="app-sidebar sticky inset-x-0 top-0 z-40 hidden h-16 items-center gap-1 border-b px-2 lg:gap-3 lg:px-7 md:flex">
        <button type="button" onClick={() => setIsAboutOpen(true)} className="flex shrink-0 items-center gap-2.5 text-left" aria-label="About RR Capital and its creator" title="RR Capital · About the creator">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#f8f9fa]"><img src="/rr-favicon.svg" alt="" className="h-7 w-7" /></span>
          <div className="hidden min-w-0 lg:block"><p className="font-semibold tracking-tight text-[var(--ink)]">RR Capital</p><p className="text-[10px] text-[var(--muted)]">Personal finance</p></div>
        </button>
        <LiquidGlassSwitcher activeKey={activeNavigationKey} label="Primary navigation" className="app-desktop-nav-switcher mx-auto inline-flex w-fit shrink-0 items-center justify-center transition-all duration-300">
          {navbarRoutes.map(route => <Link key={route.path} to={route.path} onPointerEnter={() => prefetchRoute(route.path)} onFocus={() => prefetchRoute(route.path)} aria-label={route.title} title={route.title} aria-current={location.pathname === route.path ? 'page' : undefined} {...liquidGlassItemProps(route.path, location.pathname === route.path, 'gap-1.5 px-2 lg:gap-2 lg:px-3')}><route.icon className="h-4 w-4" /><span className="hidden font-medium text-[13px] lg:inline">{route.title}</span>{route.path === '/offline' && pendingCount > 0 && <span className="rounded-full bg-amber-500 px-1.5 text-[10px] font-bold text-slate-950">{pendingCount > 99 ? '99+' : pendingCount}</span>}</Link>)}
          <Link to="/settings" aria-current={location.pathname === '/settings' ? 'page' : undefined} {...liquidGlassItemProps('settings', activeNavigationKey === 'settings', 'gap-1.5 px-2 lg:gap-2 lg:px-3')}><Settings className="h-4 w-4" /><span className="hidden font-medium text-[13px] lg:inline">Settings</span></Link>
        </LiquidGlassSwitcher>
      </nav>

      {typeof document !== 'undefined' && createPortal(
        <div ref={desktopAddRef} className="app-desktop-add">
          <div aria-hidden={!isFabOpen} className={`absolute bottom-[calc(100%+0.65rem)] right-0 flex flex-col items-end gap-2 transition-all duration-200 ${isFabOpen ? 'translate-y-0 opacity-100 pointer-events-auto' : 'translate-y-2 opacity-0 pointer-events-none'}`}>
            <button type="button" tabIndex={isFabOpen ? 0 : -1} disabled={!isFabOpen} onClick={openTransaction} className="flex min-h-12 items-center gap-3 rounded-full border border-[var(--line)] bg-[var(--app-panel-strong)] px-4 text-sm font-medium text-[var(--ink)] shadow-xl"><span>Transaction</span><span className="rounded-full bg-[var(--brand-primary)] p-2 text-white"><CreditCard className="h-4 w-4" /></span></button>
            <button type="button" tabIndex={isFabOpen ? 0 : -1} disabled={!isFabOpen} onClick={openDebt} className="flex min-h-12 items-center gap-3 rounded-full border border-[var(--line)] bg-[var(--app-panel-strong)] px-4 text-sm font-medium text-[var(--ink)] shadow-xl"><span>Debt / IOU</span><span className="rounded-full bg-emerald-600 p-2 text-white"><Users className="h-4 w-4" /></span></button>
          </div>
          <button type="button" aria-label={isFabOpen ? 'Close add menu' : 'Open add menu'} aria-expanded={isFabOpen} onClick={() => setIsFabOpen(value => !value)} className={`app-desktop-fab app-glass-fab grid h-11 w-11 place-items-center rounded-full transition duration-200 hover:-translate-y-0.5 active:scale-95 ${isFabOpen ? 'rotate-45' : ''}`}><Plus className="relative z-[1] h-5 w-5" /></button>
        </div>,
        document.body
      )}

      <div className="app-mobile-context sticky inset-x-0 top-0 z-30 flex h-14 items-center justify-between border-b px-4 md:hidden">
        <button type="button" onClick={() => setIsAboutOpen(true)} className="flex min-w-0 items-center gap-2 text-left" aria-label="About RR Capital and its creator"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#f8f9fa]"><img src="/rr-favicon.svg" alt="" className="h-6 w-6" /></span><span className="truncate text-sm font-semibold">RR Capital</span></button>
        <div className="flex items-center gap-2"><span className="max-w-[45vw] truncate text-xs font-medium text-[var(--muted)]">{activeTitle}</span>{pendingCount > 0 && <Link to="/offline" aria-label={`${pendingCount} pending offline transactions`} className="inline-flex min-h-8 items-center gap-1.5 rounded-full bg-amber-500/15 px-2.5 text-[10px] font-semibold text-amber-700"><CloudUpload className="h-3.5 w-3.5" />{pendingCount} pending</Link>}</div>
      </div>
      <CreatorProfileDialog isOpen={isAboutOpen} onClose={closeAbout} />
      {routeNotice && <div role="status" className="fixed left-1/2 top-[4.5rem] z-[70] -translate-x-1/2 rounded-full border border-[var(--line)] bg-[var(--app-panel-strong)] px-4 py-2 text-sm text-[var(--ink)] shadow-lg">{routeNotice}</div>}

      <main className="app-main relative z-0 min-h-screen pb-[calc(96px+env(safe-area-inset-bottom,0px))] md:pb-0">
        {location.pathname !== '/' && location.pathname !== '/settings' && <PageGuidance page={location.pathname} />}
        <SettingsPageShell route={activeRoute} placement={getPlacement(location.pathname)} onPlacementChange={next => setPlacement(location.pathname, next)}>{children}</SettingsPageShell>
      </main>
      <LiquidGlassSwitcher as="nav" activeKey={activeNavigationKey} label="Mobile navigation" className="app-mobile-nav md:hidden">
        <div className="app-mobile-nav__group app-mobile-nav__group--left"><Link to="/" onClick={() => setIsFabOpen(false)} aria-current={location.pathname === '/' ? 'page' : undefined} {...liquidGlassItemProps('/', location.pathname === '/')}><MobileDashboardIcon className="h-5 w-5" /><span>Dashboard</span></Link>{mobileCustomRoutes[0] && MobileFirstIcon && <Link to={mobileCustomRoutes[0].path} onClick={() => setIsFabOpen(false)} onPointerEnter={() => prefetchRoute(mobileCustomRoutes[0].path)} onFocus={() => prefetchRoute(mobileCustomRoutes[0].path)} aria-current={location.pathname === mobileCustomRoutes[0].path ? 'page' : undefined} {...liquidGlassItemProps(mobileCustomRoutes[0].path, location.pathname === mobileCustomRoutes[0].path)}><MobileFirstIcon className="h-5 w-5" /><span>{mobileCustomRoutes[0].title}</span></Link>}</div>
        <button ref={mobileFabRef} type="button" aria-label={isFabOpen ? 'Close add menu' : 'Add transaction or debt'} aria-expanded={isFabOpen} onClick={() => setIsFabOpen(value => !value)} className={`app-mobile-fab app-glass-fab relative z-10 grid h-12 w-12 place-items-center justify-self-center rounded-full border text-white shadow-[0_8px_24px_rgba(0,0,0,0.24)] transition-all duration-200 active:scale-95 ${isFabOpen ? 'rotate-45' : ''}`}><Plus className="relative z-[1] h-6 w-6" /></button>
        <div className="app-mobile-nav__group app-mobile-nav__group--right">{mobileCustomRoutes[1] && MobileSecondIcon && <Link to={mobileCustomRoutes[1].path} onClick={() => setIsFabOpen(false)} onPointerEnter={() => prefetchRoute(mobileCustomRoutes[1].path)} onFocus={() => prefetchRoute(mobileCustomRoutes[1].path)} aria-current={location.pathname === mobileCustomRoutes[1].path ? 'page' : undefined} {...liquidGlassItemProps(mobileCustomRoutes[1].path, location.pathname === mobileCustomRoutes[1].path)}><MobileSecondIcon className="h-5 w-5" /><span>{mobileCustomRoutes[1].title}</span></Link>}<Link to="/settings" onClick={() => setIsFabOpen(false)} aria-current={location.pathname === '/settings' ? 'page' : undefined} {...liquidGlassItemProps('settings', activeNavigationKey === 'settings')}><Settings className="h-5 w-5" /><span>Settings</span></Link></div>
      </LiquidGlassSwitcher>

      <div ref={mobileAddActionsRef} role="group" aria-label="Quick add actions" aria-hidden={!isFabOpen} className={`md:hidden fixed bottom-[calc(100px+env(safe-area-inset-bottom))] left-1/2 z-40 flex -translate-x-1/2 flex-col items-center gap-3 transition-all duration-200 ${isFabOpen ? 'translate-y-0 opacity-100 pointer-events-auto' : 'translate-y-2 opacity-0 pointer-events-none'}`}>
        <button type="button" tabIndex={isFabOpen ? 0 : -1} disabled={!isFabOpen} onClick={openTransaction} className="flex items-center gap-3 rounded-full border border-[var(--line)] bg-[var(--app-panel-strong)] px-4 py-2 text-[var(--ink)] shadow-xl"><span className="text-sm font-medium">Transaction</span><span className="rounded-full bg-[var(--brand-primary)] p-2 text-[#fff]"><CreditCard className="h-4 w-4" /></span></button>
        <button type="button" tabIndex={isFabOpen ? 0 : -1} disabled={!isFabOpen} onClick={openDebt} className="flex items-center gap-3 rounded-full border border-[var(--line)] bg-[var(--app-panel-strong)] px-4 py-2 text-[var(--ink)] shadow-xl"><span className="text-sm font-medium">Add Debt / IOU</span><span className="rounded-full bg-emerald-600 p-2 text-[#fff]"><Users className="h-4 w-4" /></span></button>
      </div>

      <Suspense fallback={<div className="fixed inset-0 z-[70] grid place-items-center bg-black/55 p-4" role="status" aria-live="polite"><div className="surface-panel rounded-2xl px-5 py-4 text-sm text-[var(--muted)]">Opening form…</div></div>}>
        {isTxModalOpen && <TransactionModal isOpen onClose={() => { setIsTxModalOpen(false); setSharedFile(null); setTransactionDraft(null) }} initialFile={sharedFile} initialDraft={transactionDraft} />}
        {isDebtModalOpen && <AddDebtModal isOpen onClose={() => setIsDebtModalOpen(false)} />}
      </Suspense>
    </div>
    </WorkspaceLayoutContext.Provider>
  )
}

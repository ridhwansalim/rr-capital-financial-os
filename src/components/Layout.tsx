import React, { lazy, Suspense, useState, useEffect } from 'react'
import { Plus, CreditCard, Users, LayoutDashboard, Wallet, Receipt, Settings, ArrowRightLeft, CalendarDays, Landmark, Menu, X, CloudUpload, ChartNoAxesCombined, Calculator, PiggyBank, ShoppingBasket, HeartPulse } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import type { TransactionDraft } from './TransactionModal'
import { useOptionalFeatures } from '../lib/optionalFeatures'
import PageGuidance from './PageGuidance'

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
  
  const location = useLocation()
  const { flags } = useOptionalFeatures()

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
        setIsTxModalOpen(false)
        setIsDebtModalOpen(false)
        setSharedFile(null)
      }
    }
    window.addEventListener('popstate', closeOnBack)
    return () => window.removeEventListener('popstate', closeOnBack)
  }, [isTxModalOpen, isDebtModalOpen])

  // Desktop shows everything
  const desktopNavItems = [
    { name: 'Dashboard', path: '/', icon: LayoutDashboard },
    { name: 'Calendar', path: '/calendar', icon: CalendarDays },
    { name: 'Ledger', path: '/ledger', icon: ArrowRightLeft },
    { name: 'Reports', path: '/reports', icon: ChartNoAxesCombined },
    { name: 'Offline Queue', path: '/offline', icon: CloudUpload },
    { name: 'Chittis', path: '/chittis', icon: Landmark },
    { name: 'Accounts', path: '/accounts', icon: Wallet },
    { name: 'Debts', path: '/debts', icon: Receipt },
    { name: 'Contacts', path: '/contacts', icon: Users },
    ...(flags.budgets ? [{ name: 'Budgets', path: '/budgets', icon: Wallet }] : []),
    ...(flags.calculators ? [{ name: 'Calculators', path: '/calculators', icon: Calculator }] : []),
    ...(flags.savings_goals ? [{ name: 'Savings goals', path: '/savings-goals', icon: PiggyBank }] : []),
    ...(flags.shopping_lists ? [{ name: 'Shopping lists', path: '/shopping-lists', icon: ShoppingBasket }] : []),
    ...(flags.financial_health_score ? [{ name: 'Financial wellness', path: '/financial-health', icon: HeartPulse }] : []),
    { name: 'Settings', path: '/settings', icon: Settings },
  ]

  // Mobile Primary Bar
  const mobileNavItems = [
    { name: 'Dashboard', path: '/', icon: LayoutDashboard },
    { name: 'Ledger', path: '/ledger', icon: ArrowRightLeft },
    { name: 'Chittis', path: '/chittis', icon: Landmark },
  ]

  const mobileDrawerItems = [
    { name: 'Calendar', path: '/calendar', icon: CalendarDays },
    { name: 'Reports', path: '/reports', icon: ChartNoAxesCombined },
    { name: 'Accounts', path: '/accounts', icon: Wallet },
    { name: 'Debts', path: '/debts', icon: Receipt },
    { name: 'Contacts', path: '/contacts', icon: Users },
    { name: 'Offline Queue', path: '/offline', icon: CloudUpload },
    ...(flags.budgets ? [{ name: 'Budgets', path: '/budgets', icon: Wallet }] : []),
    ...(flags.calculators ? [{ name: 'Calculators', path: '/calculators', icon: Calculator }] : []),
    ...(flags.savings_goals ? [{ name: 'Savings goals', path: '/savings-goals', icon: PiggyBank }] : []),
    ...(flags.shopping_lists ? [{ name: 'Shopping lists', path: '/shopping-lists', icon: ShoppingBasket }] : []),
    ...(flags.financial_health_score ? [{ name: 'Financial wellness', path: '/financial-health', icon: HeartPulse }] : []),
    { name: 'Settings', path: '/settings', icon: Settings },
  ]

  useEffect(() => {
    setIsMobileMenuOpen(false)
  }, [location.pathname])

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
          if (file) {
            setSharedFile(file)
            setIsTxModalOpen(true)
            store.delete('latest-image')
          }
        }
      } catch {
        console.log('No shared file is available to import')
      }
    }
    checkSharedFiles()
  }, [])

  return (
      <div className="app-shell min-h-screen bg-transparent text-slate-50 relative font-sans">
      
      {/* Desktop Sidebar */}
      <nav className="app-sidebar hidden md:flex items-center gap-7 h-16 px-6 lg:px-10 border-b z-40">
        <button type="button" onClick={() => setIsAboutOpen(true)} className="flex shrink-0 items-center gap-3 text-left" aria-label="About RR Capital">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#f8f9fa]"><img src="/rr-favicon.svg" alt="" className="h-7 w-7" /></span>
          <div className="min-w-0">
            <p className="font-semibold tracking-tight text-slate-100">RR Capital</p>
            <p className="text-[10px] text-slate-500">Personal finance</p>
          </div>
        </button>
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto app-nav-scroll">
          {desktopNavItems.filter(item => ['Dashboard', 'Calendar', 'Ledger', 'Reports', 'Accounts'].includes(item.name)).map((item) => {
            const isActive = location.pathname === item.path
            return <Link key={item.name} to={item.path} onPointerEnter={() => prefetchRoute(item.path)} onFocus={() => prefetchRoute(item.path)} aria-current={isActive ? 'page' : undefined} className={`app-nav-item group flex shrink-0 items-center gap-2 px-3 py-2 transition-all ${isActive ? 'is-active' : 'text-slate-400 hover:text-white'}`}>
                <item.icon className="h-4 w-4" /><span className="font-medium text-[13px]">{item.name}</span>
              </Link>
          })}
        </div>
        <div className="relative shrink-0">
          <button type="button" onClick={() => setIsDesktopMenuOpen(v => !v)} aria-expanded={isDesktopMenuOpen} className="app-nav-item px-3 py-2 text-sm text-slate-400 hover:text-white">More</button>
          {isDesktopMenuOpen && <div className="app-desktop-menu absolute right-0 top-12 z-50 grid min-w-56 gap-1 rounded-xl border p-2 shadow-xl">
            {desktopNavItems.filter(item => !['Dashboard', 'Calendar', 'Ledger', 'Reports', 'Accounts'].includes(item.name)).map(item => <Link key={item.name} to={item.path} onPointerEnter={() => prefetchRoute(item.path)} onFocus={() => prefetchRoute(item.path)} onClick={() => setIsDesktopMenuOpen(false)} className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm ${location.pathname === item.path ? 'text-accent-400' : 'text-slate-400 hover:text-white'}`}><item.icon className="h-4 w-4" />{item.name}</Link>)}
          </div>}
        </div>
      </nav>

      {isAboutOpen && <div className="fixed inset-0 z-[80] grid place-items-center bg-black/55 p-4" onMouseDown={event => { if (event.target === event.currentTarget) setIsAboutOpen(false) }}>
        <section role="dialog" aria-modal="true" aria-labelledby="rr-about-title" className="surface-panel w-full max-w-sm rounded-2xl p-6 shadow-2xl">
          <div className="flex items-start justify-between gap-4"><div className="flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-xl bg-[#f8f9fa]"><img src="/rr-favicon.svg" alt="" className="h-8 w-8" /></span><div><h2 id="rr-about-title" className="font-semibold text-[var(--ink)]">RR Capital</h2><p className="text-xs text-[var(--muted)]">Personal Financial OS</p></div></div><button type="button" aria-label="Close about RR Capital" onClick={() => setIsAboutOpen(false)} className="rounded-full p-2 text-[var(--muted)] hover:bg-black/5"><X className="h-4 w-4" /></button></div>
          <div className="mt-5 border-t border-[var(--line)] pt-4"><p className="text-sm leading-6 text-[var(--muted)]">A personal finance workspace created by Ridhu for everyday use with family and friends.</p><p className="mt-3 text-[10px] uppercase tracking-[.14em] text-[var(--muted)]">RR Capital · Personal use</p></div>
          <button type="button" onClick={() => setIsAboutOpen(false)} className="mt-5 min-h-10 w-full rounded-lg bg-[var(--surface-soft)] text-sm font-medium text-[var(--ink)]">Close</button>
        </section>
      </div>}

      {/* Main Content */}
      <main className="app-main min-h-[calc(100vh-4rem)] relative z-0 pb-28 md:pb-0">
        <PageGuidance page={location.pathname} />
        {children}
      </main>

      {/* Mobile Bottom Sheet Drawer */}
      <div className={`md:hidden fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity duration-300 ${isMobileMenuOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}>
        <div className={`app-mobile-sheet absolute bottom-24 left-4 right-4 border border-white/10 rounded-3xl p-5 shadow-2xl transition-transform duration-300 ${isMobileMenuOpen ? 'translate-y-0 scale-100' : 'translate-y-10 scale-95'}`}>
          <div className="flex justify-between items-center mb-6 border-b border-white/10 pb-4">
            <h3 className="font-bold text-lg">More Tools</h3>
            <button type="button" aria-label="Close more tools menu" onClick={() => setIsMobileMenuOpen(false)} className="p-2 bg-white/5 rounded-full text-slate-400 hover:text-white">
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="grid grid-cols-3 gap-y-5">
            {mobileDrawerItems.map((item) => {
              const isActive = location.pathname === item.path
              return (
                <Link key={item.name} to={item.path} onPointerDown={() => prefetchRoute(item.path)} onFocus={() => prefetchRoute(item.path)} className={`flex flex-col items-center transition-all ${isActive ? 'text-accent-400' : 'text-slate-400 hover:text-white'}`}>
                  <div className={`p-3 rounded-2xl mb-2 ${isActive ? 'bg-accent-500/20' : 'bg-white/5'}`}>
                    <item.icon className="w-6 h-6" />
                  </div>
                  <span className="text-[10px] font-medium">{item.name}</span>
                </Link>
              )
            })}
          </div>
        </div>
      </div>

      {/* Mobile navigation: the central action is a real fifth navbar item. */}
      <nav style={{ height: 'calc(76px + env(safe-area-inset-bottom))' }} className="app-mobile-nav md:hidden fixed bottom-0 left-0 right-0 h-[76px] border-t z-40 grid grid-cols-5 items-center px-2 pb-[env(safe-area-inset-bottom)] pointer-events-auto">
        {mobileNavItems.slice(0, 2).map((item) => {
          const isActive = location.pathname === item.path
          return (
          <Link key={item.name} to={item.path} onPointerDown={() => prefetchRoute(item.path)} onFocus={() => prefetchRoute(item.path)} aria-current={isActive ? 'page' : undefined} className={`relative z-50 flex flex-col items-center justify-center gap-1 py-2 transition-colors ${isActive ? 'text-accent-400' : 'text-slate-400 hover:text-white'}`}>
              <item.icon className="w-5 h-5" />
              <span className="text-[10px] font-medium">{item.name}</span>
            </Link>
          )
        })}

        <button type="button" aria-label={isFabOpen ? 'Close add menu' : 'Add transaction or debt'} aria-expanded={isFabOpen} onClick={() => setIsFabOpen(!isFabOpen)} className={`app-mobile-fab relative z-50 justify-self-center flex items-center justify-center w-12 h-12 rounded-2xl text-white shadow-lg shadow-accent-500/25 transition-all duration-200 ${isFabOpen ? 'rotate-45 bg-accent-600' : 'hover:-translate-y-0.5'}`}>
          <Plus className="w-6 h-6" />
        </button>

        <Link to="/chittis" onPointerDown={() => prefetchRoute('/chittis')} onFocus={() => prefetchRoute('/chittis')} aria-current={location.pathname === '/chittis' ? 'page' : undefined} className={`relative z-50 flex flex-col items-center justify-center gap-1 py-2 transition-colors ${location.pathname === '/chittis' ? 'text-accent-400' : 'text-slate-400 hover:text-white'}`}>
          <Landmark className="w-5 h-5" />
          <span className="text-[10px] font-medium">Chittis</span>
        </Link>

        <button type="button" aria-label={isMobileMenuOpen ? 'Close more tools menu' : 'Open more tools menu'} aria-expanded={isMobileMenuOpen} onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)} className={`relative z-50 flex flex-col items-center justify-center gap-1 py-2 transition-colors ${isMobileMenuOpen ? 'text-accent-400' : 'text-slate-400 hover:text-white'}`}>
          <Menu className="w-5 h-5" />
          <span className="text-[10px] font-medium">More</span>
        </button>
      </nav>

      {/* The mobile add menu opens above the navbar's centered action. */}
      <div aria-hidden={!isFabOpen} className={`md:hidden fixed bottom-[88px] left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-3 transition-all duration-200 ${isFabOpen ? 'opacity-100 translate-y-0 pointer-events-auto' : 'opacity-0 translate-y-2 pointer-events-none'}`}>
        <button type="button" tabIndex={isFabOpen ? 0 : -1} disabled={!isFabOpen} onClick={() => { setIsTxModalOpen(true); setIsFabOpen(false) }} className="flex items-center gap-3 px-4 py-2 rounded-full bg-slate-900 border border-white/15 shadow-xl text-white">
          <span className="font-medium text-sm">Transaction</span><span className="p-2 bg-indigo-500 rounded-full"><CreditCard className="w-4 h-4" /></span>
        </button>
        <button type="button" tabIndex={isFabOpen ? 0 : -1} disabled={!isFabOpen} onClick={() => { setIsDebtModalOpen(true); setIsFabOpen(false) }} className="flex items-center gap-3 px-4 py-2 rounded-full bg-slate-900 border border-white/15 shadow-xl text-white">
          <span className="font-medium text-sm">Add Debt / IOU</span><span className="p-2 bg-emerald-500 rounded-full"><Users className="w-4 h-4" /></span>
        </button>
      </div>

      {/* Floating Action Button */}
      {/* FIX: Parent container set to pointer-events-none so it doesn't block underlying navbar links */}
      <div className="hidden md:flex fixed bottom-8 right-8 z-50 flex-col items-end space-y-4 pointer-events-none">
        
        <div aria-hidden={!isFabOpen} className={`flex flex-col items-center md:items-end space-y-3 transition-all duration-300 origin-bottom ${isFabOpen ? 'opacity-100 scale-100 translate-y-0 pointer-events-auto' : 'opacity-0 scale-90 translate-y-4 pointer-events-none'}`}>
          <button type="button" tabIndex={isFabOpen ? 0 : -1} disabled={!isFabOpen} onClick={() => { setIsTxModalOpen(true); setIsFabOpen(false) }} className="flex items-center space-x-3 px-4 py-2 rounded-full backdrop-blur-xl bg-white/10 border border-white/20 shadow-[0_8px_32px_0_rgba(0,0,0,0.3)] hover:bg-white/20 transition-all w-48 justify-center md:justify-end md:w-auto">
            <span className="font-medium text-sm tracking-wide">Transaction</span>
            <div className="p-2 bg-indigo-500 rounded-full shadow-lg ml-2"><CreditCard className="w-4 h-4 text-white" /></div>
          </button>
          
          <button type="button" tabIndex={isFabOpen ? 0 : -1} disabled={!isFabOpen} onClick={() => { setIsDebtModalOpen(true); setIsFabOpen(false) }} className="flex items-center space-x-3 px-4 py-2 rounded-full backdrop-blur-xl bg-white/10 border border-white/20 shadow-[0_8px_32px_0_rgba(0,0,0,0.3)] hover:bg-white/20 transition-all w-48 justify-center md:justify-end md:w-auto">
            <span className="font-medium text-sm tracking-wide">Add Debt / IOU</span>
            <div className="p-2 bg-emerald-500 rounded-full shadow-lg ml-2"><Users className="w-4 h-4 text-white" /></div>
          </button>
        </div>

        <button type="button" aria-label={isFabOpen ? 'Close add menu' : 'Open add menu'} aria-expanded={isFabOpen} onClick={() => setIsFabOpen(!isFabOpen)} className={`pointer-events-auto p-4 rounded-full backdrop-blur-xl border shadow-[0_8px_32px_0_rgba(0,0,0,0.5)] transition-all duration-300 z-50 ${isFabOpen ? 'bg-white/20 border-white/40 rotate-45' : 'bg-white/10 border-white/20 hover:bg-white/20 hover:scale-105'}`}>
          <Plus className="w-7 h-7 text-white" />
        </button>
      </div>

      <Suspense fallback={<div className="fixed inset-0 z-[70] grid place-items-center bg-black/55 p-4" role="status" aria-live="polite"><div className="surface-panel rounded-2xl px-5 py-4 text-sm text-slate-300">Opening form…</div></div>}>
        {isTxModalOpen && <TransactionModal isOpen onClose={() => { setIsTxModalOpen(false); setSharedFile(null); setTransactionDraft(null) }} initialFile={sharedFile} initialDraft={transactionDraft} />}
        {isDebtModalOpen && <AddDebtModal isOpen onClose={() => setIsDebtModalOpen(false)} />}
      </Suspense>
    </div>
  )
}

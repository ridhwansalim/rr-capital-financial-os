import React, { useState, useEffect } from 'react'
import { Plus, CreditCard, Users, LayoutDashboard, Wallet, Receipt, Settings, ArrowRightLeft, CalendarDays, Landmark, Menu, X, CloudUpload, ChartNoAxesCombined } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import TransactionModal from './TransactionModal'
import AddDebtModal from './AddDebtModal'

export default function Layout({ children }: { children: React.ReactNode }) {
  const [isFabOpen, setIsFabOpen] = useState(false)
  const [isTxModalOpen, setIsTxModalOpen] = useState(false)
  const [isDebtModalOpen, setIsDebtModalOpen] = useState(false)
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const [sharedFile, setSharedFile] = useState<File | null>(null)
  const modalHistoryRef = React.useRef(false)
  
  const location = useLocation()

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
      } catch (err) {
        console.log('No shared files found or DB error:', err)
      }
    }
    checkSharedFiles()
  }, [])

  return (
    <div className="min-h-screen bg-transparent text-slate-50 relative flex font-sans overflow-hidden">
      
      {/* Desktop Sidebar */}
      <nav className="hidden md:flex flex-col w-64 h-screen backdrop-blur-2xl bg-white/5 border-r border-white/10 p-6 z-40">
        <div className="flex items-center justify-center mb-10">
          <img src="/rr-logo.svg" alt="RR Capital" className="h-16 w-auto rounded-xl drop-shadow-lg" />
        </div>
        <div className="flex flex-col space-y-2 flex-1">
          {desktopNavItems.map((item) => {
            const isActive = location.pathname === item.path
            return (
              <Link key={item.name} to={item.path} className={`flex items-center space-x-3 px-4 py-3 rounded-xl transition-all ${isActive ? 'bg-white/10 text-white shadow-sm border border-white/10' : 'text-slate-400 hover:bg-white/5 hover:text-white'}`}>
                <item.icon className={`w-5 h-5 ${isActive ? 'text-accent-400' : ''}`} />
                <span className="font-medium">{item.name}</span>
              </Link>
            )
          })}
        </div>
      </nav>

      {/* Main Content */}
      <main className="flex-1 h-screen overflow-y-auto relative z-0 pb-28 md:pb-0">
        {children}
      </main>

      {/* Mobile Bottom Sheet Drawer */}
      <div className={`md:hidden fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity duration-300 ${isMobileMenuOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}>
        <div className={`absolute bottom-24 left-4 right-4 bg-slate-900 border border-white/10 rounded-3xl p-5 shadow-2xl transition-transform duration-300 ${isMobileMenuOpen ? 'translate-y-0 scale-100' : 'translate-y-10 scale-95'}`}>
          <div className="flex justify-between items-center mb-6 border-b border-white/10 pb-4">
            <h3 className="font-bold text-lg">More Tools</h3>
            <button onClick={() => setIsMobileMenuOpen(false)} className="p-2 bg-white/5 rounded-full text-slate-400 hover:text-white">
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="grid grid-cols-3 gap-y-5">
            {mobileDrawerItems.map((item) => {
              const isActive = location.pathname === item.path
              return (
                <Link key={item.name} to={item.path} className={`flex flex-col items-center transition-all ${isActive ? 'text-accent-400' : 'text-slate-400 hover:text-white'}`}>
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
      <nav style={{ height: 'calc(76px + env(safe-area-inset-bottom))' }} className="md:hidden fixed bottom-0 left-0 right-0 h-[76px] backdrop-blur-2xl bg-slate-950/90 border-t border-white/10 z-40 grid grid-cols-5 items-center px-2 pb-[env(safe-area-inset-bottom)] pointer-events-auto">
        {mobileNavItems.slice(0, 2).map((item) => {
          const isActive = location.pathname === item.path
          return (
            <Link key={item.name} to={item.path} aria-current={isActive ? 'page' : undefined} className={`relative z-50 flex flex-col items-center justify-center gap-1 py-2 transition-colors ${isActive ? 'text-accent-400' : 'text-slate-400 hover:text-white'}`}>
              <item.icon className="w-5 h-5" />
              <span className="text-[10px] font-medium">{item.name}</span>
            </Link>
          )
        })}

        <button type="button" aria-label={isFabOpen ? 'Close add menu' : 'Add transaction or debt'} aria-expanded={isFabOpen} onClick={() => setIsFabOpen(!isFabOpen)} className={`relative z-50 justify-self-center flex items-center justify-center w-12 h-12 rounded-2xl bg-accent-500 text-white shadow-lg shadow-accent-500/25 transition-all duration-200 ${isFabOpen ? 'rotate-45 bg-accent-600' : 'hover:-translate-y-0.5'}`}>
          <Plus className="w-6 h-6" />
        </button>

        <Link to="/chittis" aria-current={location.pathname === '/chittis' ? 'page' : undefined} className={`relative z-50 flex flex-col items-center justify-center gap-1 py-2 transition-colors ${location.pathname === '/chittis' ? 'text-accent-400' : 'text-slate-400 hover:text-white'}`}>
          <Landmark className="w-5 h-5" />
          <span className="text-[10px] font-medium">Chittis</span>
        </Link>

        <button type="button" aria-expanded={isMobileMenuOpen} onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)} className={`relative z-50 flex flex-col items-center justify-center gap-1 py-2 transition-colors ${isMobileMenuOpen ? 'text-accent-400' : 'text-slate-400 hover:text-white'}`}>
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

      <TransactionModal isOpen={isTxModalOpen} onClose={() => { setIsTxModalOpen(false); setSharedFile(null) }} initialFile={sharedFile} />
      <AddDebtModal isOpen={isDebtModalOpen} onClose={() => setIsDebtModalOpen(false)} />
    </div>
  )
}

import React, { useState, useEffect, useRef } from 'react'
import GridLayout from 'react-grid-layout'
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'
import { GripHorizontal, Settings2, Wallet, ArrowRightLeft, TrendingUp, IndianRupee, Check, User, CalendarDays, ShieldCheck, AlertTriangle } from 'lucide-react'
import { supabase } from '../lib/supabase'
import PendingRequests from '../components/PendingRequests'

const ReactGridLayout = GridLayout as any; 
const DEFAULT_WIDGETS = ['net_worth', 'forecast', 'accounts', 'recent_tx']

const DEFAULT_LAYOUT: any[] = [
  { i: 'net_worth', x: 0, y: 0, w: 6, h: 2, minW: 4, minH: 2 },
  { i: 'forecast', x: 6, y: 0, w: 6, h: 2, minW: 4, minH: 2 },
  { i: 'accounts', x: 0, y: 2, w: 6, h: 4, minW: 4, minH: 3 },
  { i: 'recent_tx', x: 6, y: 2, w: 6, h: 4, minW: 4, minH: 3 }
]

export default function Dashboard() {
  const containerRef = useRef<HTMLDivElement>(null)
  
  const [width, setWidth] = useState(1200)
  const [cols, setCols] = useState(12)

  const [activeWidgets, setActiveWidgets] = useState<string[]>(() => {
    const saved = localStorage.getItem('finos_widgets')
    const parsed = saved ? JSON.parse(saved) : DEFAULT_WIDGETS
    if (!parsed.includes('forecast')) parsed.push('forecast')
    return parsed
  })
  
  const [layout, setLayout] = useState<any[]>(() => {
    const saved = localStorage.getItem('finos_layout_v3')
    return saved ? JSON.parse(saved) : DEFAULT_LAYOUT
  })

  const [isEditMode, setIsEditMode] = useState(false)
  
  const [netWorth, setNetWorth] = useState(0)
  const [liquidCash, setLiquidCash] = useState(0)
  const [upcomingOutflow, setUpcomingOutflow] = useState(0)
  
  const [accounts, setAccounts] = useState<any[]>([])
  const [recentTx, setRecentTx] = useState<any[]>([])

  useEffect(() => {
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        const w = entry.contentRect.width
        setWidth(w)
        if (w >= 1200) setCols(12)
        else if (w >= 996) setCols(10)
        else if (w >= 768) setCols(6)
        else if (w >= 480) setCols(4)
        else setCols(2)
      }
    })
    if (containerRef.current) observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const fetchDashboardData = async () => {
      let balData: any[] = []
      try {
        const { data } = await supabase.from('account_balances').select('*')
        if (data) {
          balData = data
          const total = data.reduce((sum, acc) => sum + Number(acc.balance), 0)
          setNetWorth(total)
        }
      } catch (err) {
        console.warn('Could not fetch balances:', err)
      }

      let currentLiquid = 0
      try {
        const { data: accData } = await supabase.from('accounts').select('id, name, type')
        if (accData) {
          const merged = accData.map(acc => {
            const matched = balData.find(b => b.id === acc.id)
            const balance = matched ? Number(matched.balance) : 0
            
            if (['bank', 'cash', 'wallet'].includes(acc.type)) {
              currentLiquid += balance
            }
            return { ...acc, balance }
          })
          setAccounts(merged)
          setLiquidCash(currentLiquid)
        }
      } catch (err) {
        console.warn('Could not fetch accounts:', err)
      }

      // Unified Math Engine for EMIs and Chittis
      try {
        let totalOutflow = 0
        const today = new Date()
        const viewDate = new Date(today.getFullYear(), today.getMonth(), 1)

        // 1. Fetch Standard EMIs
        const { data: emiData } = await supabase.from('recurring_emis').select('amount, start_date, end_date')
        if (emiData) {
          totalOutflow += emiData.reduce((sum, emi) => {
            const startDate = new Date(emi.start_date)
            const emiStartMonth = new Date(startDate.getFullYear(), startDate.getMonth(), 1)
            if (viewDate < emiStartMonth) return sum
            
            if (emi.end_date) {
              const endDate = new Date(emi.end_date)
              const emiEndMonth = new Date(endDate.getFullYear(), endDate.getMonth(), 1)
              if (viewDate > emiEndMonth) return sum
            }
            return sum + Number(emi.amount)
          }, 0)
        }

        // 2. Fetch Active Chittis
        const { data: chittiData } = await supabase.from('chittis').select('monthly_installment, start_date, duration_months').eq('status', 'ACTIVE')
        if (chittiData) {
           chittiData.forEach(chitti => {
             const startDate = new Date(chitti.start_date)
             const emiStartMonth = new Date(startDate.getFullYear(), startDate.getMonth(), 1)
             const emiEndMonth = new Date(startDate.getFullYear(), startDate.getMonth() + chitti.duration_months, 1)

             if (viewDate >= emiStartMonth && viewDate <= emiEndMonth) {
                totalOutflow += Number(chitti.monthly_installment)
             }
           })
        }
        
        setUpcomingOutflow(totalOutflow)
      } catch (err) {
        console.warn('Could not fetch obligations for forecast:', err)
      }

      try {
        const { data: txData } = await supabase
          .from('transactions')
          .select('id, amount, description, created_at, from_account_id, to_account_id, tagged_profile_id, contact_id')
          .order('created_at', { ascending: false })
          .limit(5)

        if (txData) {
          const pIds = new Set<string>()
          const cIds = new Set<string>()
          txData.forEach(tx => {
            if (tx.tagged_profile_id) pIds.add(tx.tagged_profile_id)
            if (tx.contact_id) cIds.add(tx.contact_id)
          })

          const nameMap: Record<string, string> = {}
          if (pIds.size > 0) {
            const { data: profiles } = await supabase.from('profiles').select('id, full_name, username').in('id', Array.from(pIds))
            profiles?.forEach(p => nameMap[p.id] = p.full_name || p.username || 'User')
          }
          if (cIds.size > 0) {
            const { data: contacts } = await supabase.from('contacts').select('id, name').in('id', Array.from(cIds))
            contacts?.forEach(c => nameMap[c.id] = c.name)
          }

          const formattedTx = txData.map(tx => {
            let txType = 'transfer'
            if (!tx.from_account_id) txType = 'income'
            if (!tx.to_account_id) txType = 'expense'
            
            let taggedName = null
            if (tx.tagged_profile_id) taggedName = nameMap[tx.tagged_profile_id]
            else if (tx.contact_id) taggedName = nameMap[tx.contact_id]

            return { ...tx, type: txType, taggedName }
          })
          setRecentTx(formattedTx)
        }
      } catch (err) {
        console.error('Failed to fetch transactions:', err)
      }
    }
    fetchDashboardData()
  }, [])

  const handleLayoutChange = (newLayout: any) => {
    if (!isEditMode) return
    setLayout(newLayout)
    localStorage.setItem('finos_layout_v3', JSON.stringify(newLayout))
  }

  const toggleWidget = (id: string) => {
    setActiveWidgets(prev => {
      const next = prev.includes(id) ? prev.filter(w => w !== id) : [...prev, id]
      localStorage.setItem('finos_widgets', JSON.stringify(next))
      return next
    })
  }

  const safeToSpend = liquidCash - upcomingOutflow

  const activeLayout = layout.map(item => ({
    ...item,
    static: !isEditMode 
  }))

  return (
    <div ref={containerRef} className="p-6 w-full max-w-7xl mx-auto text-white animate-in fade-in duration-300 pb-32">
      
      <div className="flex justify-between items-end mb-8">
        <div>
          <h1 className="text-3xl font-bold flex items-center">
            <TrendingUp className="w-8 h-8 mr-3 text-emerald-400" />
            Command Center
          </h1>
          <p className="text-slate-400 mt-1">Your financial overview</p>
        </div>
        <button 
          onClick={() => setIsEditMode(!isEditMode)}
          className={`flex items-center px-4 py-2 rounded-xl font-bold transition-all ${
            isEditMode ? 'bg-emerald-500 text-white shadow-[0_0_15px_rgba(16,185,129,0.4)]' : 'bg-white/10 text-white hover:bg-white/20 border border-white/10'
          }`}
        >
          {isEditMode ? <Check className="w-4 h-4 mr-2" /> : <Settings2 className="w-4 h-4 mr-2" />}
          {isEditMode ? 'Done' : 'Edit Layout'}
        </button>
      </div>

      {/* P2P APPROVALS INBOX INJECTED HERE */}
      <PendingRequests />

      {isEditMode && (
        <div className="mb-8 p-6 bg-white/5 border border-white/10 rounded-2xl backdrop-blur-md animate-in slide-in-from-top-4">
          <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4">Toggle Widgets</h3>
          <div className="flex flex-wrap gap-4">
            {[
              { id: 'net_worth', label: 'Net Worth' },
              { id: 'forecast', label: 'Runway Forecast' },
              { id: 'accounts', label: 'Account Balances' },
              { id: 'recent_tx', label: 'Recent Transactions' }
            ].map(w => (
              <button
                key={w.id}
                onClick={() => toggleWidget(w.id)}
                className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all border ${
                  activeWidgets.includes(w.id) 
                    ? 'bg-indigo-500/20 border-indigo-500/50 text-indigo-300' 
                    : 'bg-black/20 border-white/5 text-slate-500 hover:text-slate-300'
                }`}
              >
                {w.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <ReactGridLayout
        className="layout"
        layout={activeLayout}
        cols={cols}
        width={width}
        rowHeight={60}
        onLayoutChange={handleLayoutChange}
        isDraggable={isEditMode}
        isResizable={isEditMode}
        draggableHandle=".drag-handle"
        margin={[16, 16]}
      >
        
        {activeWidgets.includes('net_worth') && (
          <div key="net_worth" className="bg-white/5 border border-white/10 backdrop-blur-md rounded-3xl overflow-hidden flex flex-col group relative">
            {isEditMode && (
              <div className="drag-handle absolute top-4 right-4 p-2 bg-black/40 rounded-lg cursor-grab active:cursor-grabbing z-10 hover:bg-black/60 transition-colors">
                <GripHorizontal className="w-4 h-4 text-slate-400" />
              </div>
            )}
            <div className="p-6 flex-1 flex flex-col justify-center">
              <h3 className="text-slate-400 font-medium mb-1">Total Net Worth</h3>
              <div className="flex items-center text-4xl md:text-5xl font-black">
                <IndianRupee className="w-8 h-8 md:w-10 md:h-10 text-emerald-400/70 mr-2" />
                <span className={netWorth < 0 ? 'text-rose-400' : 'text-white'}>
                  {netWorth.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
            </div>
          </div>
        )}

        {activeWidgets.includes('forecast') && (
          <div key="forecast" className="bg-indigo-500/10 border border-indigo-500/20 backdrop-blur-md rounded-3xl overflow-hidden flex flex-col group relative">
            {isEditMode && (
              <div className="drag-handle absolute top-4 right-4 p-2 bg-black/40 rounded-lg cursor-grab active:cursor-grabbing z-10 hover:bg-black/60 transition-colors">
                <GripHorizontal className="w-4 h-4 text-slate-400" />
              </div>
            )}
            <div className="p-6 flex-1 flex flex-col justify-center">
              <h3 className="text-indigo-400 font-bold mb-3 flex items-center text-sm uppercase tracking-wider">
                <CalendarDays className="w-4 h-4 mr-2" /> Runway Forecast
              </h3>
              
              <div className="flex justify-between items-end mb-2">
                <div>
                  <p className="text-xs text-slate-400 mb-0.5">Liquid Assets</p>
                  <p className="font-bold text-emerald-400">+₹{liquidCash.toLocaleString('en-IN')}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-slate-400 mb-0.5">Monthly EMIs & Chittis</p>
                  <p className="font-bold text-rose-400">-₹{upcomingOutflow.toLocaleString('en-IN')}</p>
                </div>
              </div>
              
              <div className="border-t border-indigo-500/30 pt-2 mt-1 flex justify-between items-center">
                <span className="text-sm font-medium text-slate-300">Safe to Spend</span>
                <div className={`flex items-center font-black text-lg ${safeToSpend >= 0 ? 'text-white' : 'text-rose-400'}`}>
                  {safeToSpend >= 0 ? (
                    <ShieldCheck className="w-4 h-4 mr-1.5 text-emerald-400" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 mr-1.5 text-rose-400" />
                  )}
                  ₹{safeToSpend.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </div>
              </div>
            </div>
          </div>
        )}

        {activeWidgets.includes('accounts') && (
          <div key="accounts" className="bg-white/5 border border-white/10 backdrop-blur-md rounded-3xl overflow-hidden flex flex-col group relative">
            <div className={`p-5 border-b border-white/5 flex items-center justify-between bg-black/10 ${isEditMode ? 'drag-handle cursor-grab active:cursor-grabbing' : ''}`}>
              <h3 className="font-bold flex items-center text-slate-200">
                <Wallet className="w-4 h-4 mr-2 text-indigo-400" /> Accounts
              </h3>
              {isEditMode && <GripHorizontal className="w-4 h-4 text-slate-500" />}
            </div>
            <div className="p-4 flex-1 overflow-y-auto space-y-2">
              {accounts.map(acc => (
                <div key={acc.id} className="flex justify-between items-center p-3 rounded-xl hover:bg-white/5 transition-colors">
                  <span className="text-sm font-medium text-slate-300">{acc.name}</span>
                  <span className={`text-sm font-bold ${Number(acc.balance) < 0 ? 'text-rose-400' : 'text-white'}`}>
                    ₹{Number(acc.balance).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </span>
                </div>
              ))}
              {accounts.length === 0 && <p className="text-sm text-slate-500 text-center py-4">No accounts found.</p>}
            </div>
          </div>
        )}

        {activeWidgets.includes('recent_tx') && (
          <div key="recent_tx" className="bg-white/5 border border-white/10 backdrop-blur-md rounded-3xl overflow-hidden flex flex-col group relative">
            <div className={`p-5 border-b border-white/5 flex items-center justify-between bg-black/10 ${isEditMode ? 'drag-handle cursor-grab active:cursor-grabbing' : ''}`}>
              <h3 className="font-bold flex items-center text-slate-200">
                <ArrowRightLeft className="w-4 h-4 mr-2 text-rose-400" /> Recent Activity
              </h3>
              {isEditMode && <GripHorizontal className="w-4 h-4 text-slate-500" />}
            </div>
            <div className="p-4 flex-1 overflow-y-auto space-y-2">
              {recentTx.map(tx => (
                <div key={tx.id} className="flex justify-between items-center p-3 rounded-xl hover:bg-white/5 transition-colors">
                  <div>
                    <p className="text-sm font-medium text-slate-200 line-clamp-1">{tx.description}</p>
                    <div className="flex items-center space-x-2 mt-1">
                      <p className="text-xs text-slate-500">{new Date(tx.created_at).toLocaleDateString()}</p>
                      {tx.taggedName && (
                        <span className="flex items-center text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                          <User className="w-3 h-3 mr-1" /> {tx.taggedName}
                        </span>
                      )}
                    </div>
                  </div>
                  <span className={`text-sm font-bold ${tx.type === 'income' ? 'text-emerald-400' : tx.type === 'expense' ? 'text-rose-400' : 'text-slate-300'}`}>
                    {tx.type === 'expense' ? '-' : tx.type === 'income' ? '+' : ''}₹{Number(tx.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </span>
                </div>
              ))}
              {recentTx.length === 0 && <p className="text-sm text-slate-500 text-center py-4">No transactions logged.</p>}
            </div>
          </div>
        )}

      </ReactGridLayout>
    </div>
  )
}
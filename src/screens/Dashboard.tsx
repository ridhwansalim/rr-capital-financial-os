import React, { useState, useEffect } from 'react'
import { Wallet, ArrowRightLeft, TrendingUp, IndianRupee, User, CalendarDays, ShieldCheck, AlertTriangle, Landmark } from 'lucide-react'
import { supabase } from '../lib/supabase'
import PendingRequests from '../components/PendingRequests'

export default function Dashboard() {
  const [netWorth, setNetWorth] = useState(0)
  const [liquidCash, setLiquidCash] = useState(0)
  const [upcomingOutflow, setUpcomingOutflow] = useState(0)
  const [monthIncome, setMonthIncome] = useState(0)
  const [monthExpenses, setMonthExpenses] = useState(0)
  
  const [accounts, setAccounts] = useState<any[]>([])
  const [recentTx, setRecentTx] = useState<any[]>([])

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
             const emiEndMonth = new Date(startDate.getFullYear(), startDate.getMonth() + chitti.duration_months - 1, 1)

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
        const now = new Date()
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
        const { data: monthTx } = await supabase
          .from('transactions')
          .select('amount, from_account_id, to_account_id')
          .gte('created_at', monthStart)
          .limit(1000)
        if (monthTx) {
          setMonthIncome(monthTx.reduce((sum, tx) => sum + (!tx.from_account_id ? Number(tx.amount) : 0), 0))
          setMonthExpenses(monthTx.reduce((sum, tx) => sum + (!tx.to_account_id ? Number(tx.amount) : 0), 0))
        }
      } catch (err) {
        console.warn('Could not fetch this month\'s cash flow:', err)
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
            const { data: profiles } = await supabase.from('profile_directory').select('id, full_name, username').in('id', Array.from(pIds))
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

  const safeToSpend = liquidCash - upcomingOutflow
  const monthNet = monthIncome - monthExpenses
  const currentMonth = new Date().toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })

  return (
    <div className="p-4 sm:p-6 w-full max-w-7xl mx-auto text-white animate-in fade-in duration-300 pb-32">
      
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-end mb-6 sm:mb-8 gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold flex items-center">
            <TrendingUp className="w-7 h-7 sm:w-8 sm:h-8 mr-2 sm:mr-3 text-emerald-400" />
            Command Center
          </h1>
          <p className="text-slate-400 mt-1">A clear view of your balances, commitments, and recent activity.</p>
        </div>
      </div>

      {/* P2P APPROVALS INBOX INJECTED HERE */}
      <PendingRequests />

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 sm:gap-6 items-stretch">
        
        <section className="bg-gradient-to-br from-emerald-500/15 via-white/5 to-white/5 border border-emerald-400/20 backdrop-blur-md rounded-3xl overflow-hidden flex flex-col min-h-40">
            <div className="p-5 sm:p-6 flex-1 flex flex-col justify-center">
              <h3 className="text-slate-300 font-medium mb-1">Total Net Worth</h3>
              <div className="flex items-center text-4xl md:text-5xl font-black">
                <IndianRupee className="w-8 h-8 md:w-10 md:h-10 text-emerald-400/70 mr-2" />
                <span className={netWorth < 0 ? 'text-rose-400' : 'text-white'}>
                  <span className="min-w-0 break-all">{netWorth.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </span>
              </div>
            </div>
        </section>

        <section className="bg-indigo-500/10 border border-indigo-500/20 backdrop-blur-md rounded-3xl overflow-hidden flex flex-col min-h-40">
            <div className="p-5 sm:p-6 flex-1 flex flex-col justify-center">
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
        </section>

        <section className="xl:col-span-2 bg-white/5 border border-white/10 backdrop-blur-md rounded-3xl p-5 sm:p-6">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <h3 className="font-bold text-slate-200">Monthly cash flow</h3>
              <p className="text-xs text-slate-500 mt-0.5">{currentMonth} · transfers excluded</p>
            </div>
            <span className={`text-sm sm:text-base font-bold ${monthNet >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              {monthNet >= 0 ? '+' : '-'}₹{Math.abs(monthNet).toLocaleString('en-IN', { maximumFractionDigits: 0 })} net
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="rounded-2xl bg-emerald-500/10 border border-emerald-500/15 p-3 sm:p-4">
              <p className="text-xs text-slate-400">Income</p>
              <p className="mt-1 font-bold text-emerald-400 break-all">+₹{monthIncome.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</p>
            </div>
            <div className="rounded-2xl bg-rose-500/10 border border-rose-500/15 p-3 sm:p-4">
              <p className="text-xs text-slate-400">Expenses</p>
              <p className="mt-1 font-bold text-rose-400 break-all">-₹{monthExpenses.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</p>
            </div>
            <div className="col-span-2 sm:col-span-1 rounded-2xl bg-white/5 border border-white/10 p-3 sm:p-4">
              <p className="text-xs text-slate-400">Savings rate</p>
              <p className={`mt-1 font-bold ${monthIncome > 0 && monthNet >= 0 ? 'text-emerald-400' : 'text-slate-200'}`}>
                {monthIncome > 0 ? `${Math.round((monthNet / monthIncome) * 100)}%` : '—'}
              </p>
            </div>
          </div>
        </section>

        <section className="bg-white/5 border border-white/10 backdrop-blur-md rounded-3xl overflow-hidden flex flex-col min-h-60">
            <div className="p-5 border-b border-white/5 flex items-center justify-between bg-black/10">
              <h3 className="font-bold flex items-center text-slate-200">
                <Landmark className="w-4 h-4 mr-2 text-indigo-400" /> Accounts <span className="ml-2 text-xs font-normal text-slate-500">{accounts.length}</span>
              </h3>
            </div>
            <div className="p-4 flex-1 overflow-y-auto space-y-2">
              {accounts.map(acc => (
                <div key={acc.id} className="flex justify-between items-center p-3 rounded-xl hover:bg-white/5 transition-colors">
                    <span className="text-sm font-medium text-slate-300 min-w-0 truncate">{acc.name}</span>
                  <span className={`text-sm font-bold shrink-0 ml-3 ${Number(acc.balance) < 0 ? 'text-rose-400' : 'text-white'}`}>
                    ₹{Number(acc.balance).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </span>
                </div>
              ))}
              {accounts.length === 0 && <p className="text-sm text-slate-500 text-center py-4">No accounts found.</p>}
            </div>
        </section>

        <section className="bg-white/5 border border-white/10 backdrop-blur-md rounded-3xl overflow-hidden flex flex-col min-h-60">
            <div className="p-5 border-b border-white/5 flex items-center justify-between bg-black/10">
              <h3 className="font-bold flex items-center text-slate-200">
                <ArrowRightLeft className="w-4 h-4 mr-2 text-rose-400" /> Recent Activity
              </h3>
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
              {recentTx.length === 0 && <p className="text-sm text-slate-500 text-center py-8">No transactions yet. Add your first transaction to see it here.</p>}
            </div>
        </section>

      </div>
    </div>
  )
}

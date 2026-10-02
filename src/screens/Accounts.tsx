import React, { useState, useEffect, useCallback } from 'react'
import { Wallet, Landmark, CreditCard, Plus, IndianRupee, Loader2, Pencil } from 'lucide-react'
import { supabase } from '../lib/supabase'
import AddAccountModal from '../components/AddAccountModal'
import EditAccountModal from '../components/EditAccountModal' // <-- New Import
import AccountHealthControls from '../components/AccountHealthControls'
import { useOptionalFeatures } from '../lib/optionalFeatures'
import type { AccountHealthSetting } from '../lib/accountHealth'
import PageHeader from '../components/PageHeader'

interface Account {
  id: string
  name: string
  type: 'bank' | 'cash' | 'credit_card' | 'pay_later' | string
  balance: number
  credit_limit: number
}

export default function Accounts() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [healthSettings, setHealthSettings] = useState<Record<string, AccountHealthSetting>>({})
  const [isLoading, setIsLoading] = useState(true)
  const { flags } = useOptionalFeatures()
  
  // Modals state
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [editingAccount, setEditingAccount] = useState<Account | null>(null)

  const fetchAccounts = useCallback(async () => {
    setIsLoading(true)
    try {
      // Fetch the account list, current balances and optional health settings in
      // parallel. Previously each extra summary waited for the preceding request.
      const [accountResult, balanceResult, healthResult] = await Promise.all([
        supabase.from('accounts').select('id, name, type, credit_limit').order('name'),
        supabase.from('account_balances').select('id, balance'),
        flags.account_health
          ? supabase.from('account_health_settings').select('account_id, minimum_balance, statement_day, due_day, show_notices')
          : Promise.resolve({ data: null, error: null }),
      ])

      const { data: accData, error: accError } = accountResult
      if (accError) throw accError
      if (!accData || accData.length === 0) {
        setAccounts([])
        setHealthSettings({})
        return
      }

      const balData = balanceResult.error ? [] : (balanceResult.data || [])
      if (balanceResult.error) console.warn('View error (balances skipped):', balanceResult.error)

      const merged = accData.map(acc => {
        const matchedBalance = balData.find(b => b.id === acc.id)
        return {
          ...acc,
          balance: matchedBalance ? Number(matchedBalance.balance) : 0,
          credit_limit: acc.credit_limit || 0
        }
      })
      
      setAccounts(merged)
      if (flags.account_health) {
        if (healthResult.error) throw healthResult.error
        const accountIds = new Set(merged.map(account => account.id))
        const settings = (healthResult.data || []).filter(row => accountIds.has(row.account_id))
        setHealthSettings(Object.fromEntries(settings.map(row => [row.account_id, row as AccountHealthSetting])))
      } else {
        setHealthSettings({})
      }
    } catch (error) {
      console.error('Error fetching accounts:', error)
    } finally {
      setIsLoading(false)
    }
  }, [flags.account_health])

  useEffect(() => {
    const timer = window.setTimeout(() => { void fetchAccounts() }, 0)
    return () => window.clearTimeout(timer)
  }, [fetchAccounts])

  const liquidAccounts = accounts.filter(a => a.type === 'bank' || a.type === 'cash' || a.type === 'wallet')
  const creditAccounts = accounts.filter(a => a.type === 'credit' || a.type === 'credit_card' || a.type === 'pay_later')

  const totalLiquid = liquidAccounts.reduce((sum, acc) => sum + Number(acc.balance), 0)
  const totalDebt = creditAccounts.reduce((sum, acc) => sum + Math.abs(Number(acc.balance)), 0)

  return (
    <div className="page-shell w-full max-w-5xl mx-auto animate-in fade-in duration-300 pb-32">
      
      <PageHeader title="Accounts" description="Manage your balances and credit limits" icon={<Wallet className="text-indigo-400" />} action={<button
          onClick={() => setIsAddModalOpen(true)}
          className="flex w-full items-center justify-center rounded-xl bg-indigo-500 px-4 py-3 font-bold text-white transition-all hover:bg-indigo-400 sm:w-auto sm:py-2"
        >
          <Plus className="w-4 h-4 mr-2" /> Add Account
        </button>} />

      {isLoading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
        </div>
      ) : (
        <div className="space-y-10">
          
          {/* LIQUID ASSETS */}
          <section>
            <div className="flex items-center justify-between mb-4 border-b border-white/10 pb-2">
              <h2 className="text-xl font-bold text-slate-200">Liquid Assets</h2>
              <span className="text-emerald-400 font-bold tracking-wider">
                ₹{totalLiquid.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </span>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {liquidAccounts.map(acc => (
                <div key={acc.id} className="surface-panel p-5 rounded-2xl transition-colors group">
                  <div className="flex items-center justify-between mb-4">
                    <div className="p-3 rounded-full bg-indigo-500/20">
                  {acc.type === 'bank' ? <Landmark className="w-5 h-5 text-indigo-400" /> : <Wallet className="w-5 h-5 text-emerald-400" />}
                    </div>
                    
                    <div className="flex items-center space-x-2">
                      <span className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider bg-black/40 text-slate-400 rounded-md">
                        {acc.type === 'cash' ? 'Cash in Hand' : acc.type === 'pay_later' ? 'Pay Later' : acc.type.replace('_', ' ')}
                      </span>
                      {/* NEW EDIT BUTTON */}
                      <button 
                        onClick={() => setEditingAccount(acc)}
                        aria-label={`Edit ${acc.name}`}
                        title={`Edit ${acc.name}`}
                        className="p-2 text-slate-500 hover:text-white hover:bg-white/10 rounded-md transition-all sm:opacity-0 sm:group-hover:opacity-100"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  
                  <h3 className="text-slate-300 font-medium mb-1">{acc.name}</h3>
                  <div className="flex items-center text-2xl font-black">
                    <IndianRupee className="w-5 h-5 text-white/50 mr-1" />
                    <span className={Number(acc.balance) < 0 ? 'text-rose-400' : 'text-emerald-400'}>
                      {Number(acc.balance).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                  {flags.account_health && <AccountHealthControls accountId={acc.id} accountType={acc.type} balance={Number(acc.balance)} setting={healthSettings[acc.id]} onSaved={() => void fetchAccounts()} />}
                </div>
              ))}
              {liquidAccounts.length === 0 && <p className="text-slate-500 text-sm">No liquid accounts found.</p>}
            </div>
          </section>

          {/* CREDIT CARDS */}
          <section>
            <div className="flex items-center justify-between mb-4 border-b border-white/10 pb-2">
              <h2 className="text-xl font-bold text-slate-200">Credit & Pay Later</h2>
              <span className="text-rose-400 font-bold tracking-wider">
                - ₹{totalDebt.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {creditAccounts.map(acc => {
                const limit = Number(acc.credit_limit) || 1
                const debt = Math.abs(Number(acc.balance))
                const available = Math.max(0, limit - debt)
                const utilization = Math.min(100, (debt / limit) * 100)
                
                let barColor = 'bg-emerald-500'
                if (utilization > 50) barColor = 'bg-amber-500'
                if (utilization > 85) barColor = 'bg-rose-500'

                return (
                  <div key={acc.id} className="surface-panel p-5 rounded-2xl relative overflow-hidden group">
                    <CreditCard className="absolute -right-6 -bottom-6 w-32 h-32 text-white/5 -rotate-12 pointer-events-none" />
                    
                    <div className="relative z-10">
                      <div className="flex items-center justify-between mb-6">
                        <div className="flex items-center space-x-3">
                          <div className="p-2 rounded-lg bg-rose-500/20 border border-rose-500/20">
                            <CreditCard className="w-5 h-5 text-rose-400" />
                          </div>
                          <h3 className="text-slate-200 font-bold text-lg">{acc.name}</h3>
                        </div>
                        {/* NEW EDIT BUTTON */}
                        <button 
                          onClick={() => setEditingAccount(acc)}
                          aria-label={`Edit ${acc.name}`}
                          title={`Edit ${acc.name}`}
                          className="p-2 text-slate-500 hover:text-white hover:bg-white/10 rounded-lg transition-all sm:opacity-0 sm:group-hover:opacity-100 z-20"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                      </div>

                      <div className="grid grid-cols-2 gap-4 mb-4">
                        <div>
                          <p className="text-xs text-slate-400 uppercase tracking-wider mb-1">Outstanding</p>
                          <p className="text-xl font-black text-rose-400">
                            ₹{debt.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs text-slate-400 uppercase tracking-wider mb-1">Available</p>
                          <p className="text-xl font-black text-emerald-400">
                            ₹{available.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                          </p>
                        </div>
                      </div>

                      <div className="space-y-1.5 mt-4">
                        <div className="flex justify-between text-xs text-slate-400 font-medium">
                          <span>Limit: ₹{limit.toLocaleString('en-IN')}</span>
                          <span>{utilization.toFixed(1)}% Utilized</span>
                        </div>
                        <div className="h-2 w-full bg-black/40 rounded-full overflow-hidden">
                          <div className={`h-full ${barColor} transition-all duration-1000 ease-out`} style={{ width: `${utilization}%` }} />
                        </div>
                      </div>
                      {flags.account_health && <AccountHealthControls accountId={acc.id} accountType={acc.type} balance={Number(acc.balance)} setting={healthSettings[acc.id]} onSaved={() => void fetchAccounts()} />}
                    </div>
                  </div>
                )
              })}
              {creditAccounts.length === 0 && <p className="text-slate-500 text-sm">No credit or Pay Later accounts logged.</p>}
            </div>
          </section>

        </div>
      )}

      {/* Modals */}
      <AddAccountModal 
        isOpen={isAddModalOpen} 
        onClose={() => setIsAddModalOpen(false)} 
        onSuccess={fetchAccounts} 
      />
      
      <EditAccountModal
        isOpen={!!editingAccount}
        onClose={() => setEditingAccount(null)}
        onSuccess={() => { setEditingAccount(null); fetchAccounts(); }}
        account={editingAccount}
      />
    </div>
  )
}

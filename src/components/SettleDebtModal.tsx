import React, { useState, useEffect } from 'react'
import { X, IndianRupee, Loader2, Wallet, ArrowUpRight } from 'lucide-react'
import { supabase } from '../lib/supabase'

interface SettleDebtModalProps {
  isOpen: boolean
  onClose: () => void
  obligation: any // The parent debt object
}

export default function SettleDebtModal({ isOpen, onClose, obligation }: SettleDebtModalProps) {
  const [amount, setAmount] = useState('')
  const [accounts, setAccounts] = useState<any[]>([])
  const [selectedAccount, setSelectedAccount] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (isOpen && obligation) {
      // Default to the remaining balance
      setAmount(obligation.amount?.toString() || '')
      fetchAccounts()
    }
  }, [isOpen, obligation])

  const fetchAccounts = async () => {
    const { data: accData } = await supabase.from('accounts').select('*').order('name')
    const { data: balData } = await supabase.from('account_balances').select('*')
    
    if (accData) {
      const merged = accData.map(acc => {
        const matched = balData?.find(b => b.id === acc.id)
        return { ...acc, balance: matched ? Number(matched.balance) : 0 }
      })
      setAccounts(merged)
      if (merged.length > 0) setSelectedAccount(merged[0].id)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedAccount) return alert("Please select an account to pay from.")
    setIsSubmitting(true)
    
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error("Authentication missing")
      
      // Figure out who the money is going to
      let counterpartyId = obligation.owner_id
      if (obligation.owner_id === user.id) {
        counterpartyId = obligation.type === 'lent' ? obligation.debtor_profile_id : obligation.creditor_profile_id
      }

      // Log to Escrow
      const { error } = await supabase.from('settlements').insert({
        obligation_id: obligation.id,
        initiator_id: user.id,
        counterparty_profile_id: counterpartyId,
        amount: parseFloat(amount),
        source_account_id: selectedAccount,
        status: 'PENDING_APPROVAL'
      })
      
      if (error) throw error
      
      alert("Payment request sent! Waiting for receiver to accept.")
      onClose()
    } catch (err: any) {
      alert(`Payment failed: ${err.message}`)
    } finally {
      setIsSubmitting(false)
    }
  }
  
  if (!isOpen || !obligation) return null
  
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-in fade-in duration-200">
      <div className="w-full max-w-sm p-6 rounded-3xl backdrop-blur-2xl bg-slate-900 border border-white/20 shadow-2xl relative animate-in zoom-in-95 text-white">
        <button onClick={onClose} className="absolute top-4 right-4 p-2 text-white/60 hover:text-white rounded-full hover:bg-white/10 transition-colors z-10"><X className="w-5 h-5" /></button>
        
        <div className="flex flex-col items-center mb-6">
          <div className="p-3 bg-emerald-500/20 rounded-full mb-3 border border-emerald-500/20"><ArrowUpRight className="w-6 h-6 text-emerald-400" /></div>
          <h2 className="text-xl font-bold">Send Payment</h2>
          <p className="text-xs text-slate-400 text-center mt-1">For: {obligation.description}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="flex flex-col items-center justify-center space-y-2 py-4 bg-black/40 rounded-2xl border border-white/5">
            <span className="text-white/50 text-xs font-bold uppercase tracking-wider">Amount to Pay</span>
            <div className="flex items-center justify-center text-4xl font-black">
              <IndianRupee className="w-8 h-8 text-white/50 mr-1" />
              <input type="number" step="0.01" max={obligation.amount} required value={amount} onChange={(e) => setAmount(e.target.value)} className="bg-transparent border-none outline-none text-center w-full max-w-[150px] placeholder:text-white/20 appearance-none text-emerald-400" disabled={isSubmitting} />
            </div>
            <p className="text-[10px] text-slate-500">Remaining Balance: ₹{obligation.amount}</p>
          </div>

          <div className="flex flex-col space-y-1">
            <label className="text-xs font-semibold tracking-wide text-white/50 uppercase">Pay From</label>
            <div className="relative mt-1">
              <Wallet className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <select required value={selectedAccount} onChange={(e) => setSelectedAccount(e.target.value)} className="w-full bg-black/40 border border-white/10 rounded-xl pl-10 pr-4 py-3 text-white outline-none focus:border-emerald-500/50 appearance-none" disabled={isSubmitting}>
                {accounts.map(acc => <option key={acc.id} value={acc.id} className="text-slate-900">{acc.name} (₹{acc.balance})</option>)}
              </select>
            </div>
          </div>

          <button type="submit" disabled={isSubmitting} className="w-full flex items-center justify-center py-3.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white font-bold text-lg transition-all shadow-[0_0_15px_rgba(16,185,129,0.3)] disabled:opacity-50">
            {isSubmitting ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Send to Escrow'}
          </button>
        </form>
      </div>
    </div>
  )
}
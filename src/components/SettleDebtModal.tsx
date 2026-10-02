import React, { useState, useEffect, useRef, useCallback } from 'react'
import { X, IndianRupee, Loader2, Wallet, ArrowUpRight } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { safeCaughtErrorMessage } from '../lib/safeErrorMessages'
import { useModalBack } from '../lib/useModalBack'
import { isDateBeforeOpeningDate, toIndiaDateInputValue } from '../lib/financeDate'

interface SettleDebtModalProps {
  isOpen: boolean
  onClose: () => void
  obligation: any // The parent debt object
}

export default function SettleDebtModal({ isOpen, onClose, obligation }: SettleDebtModalProps) {
  const [amount, setAmount] = useState('')
  const [accounts, setAccounts] = useState<any[]>([])
  const [selectedAccount, setSelectedAccount] = useState('')
  const [accountsLoading, setAccountsLoading] = useState(false)
  const [accountsError, setAccountsError] = useState('')
  const [formError, setFormError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [transactionDate, setTransactionDate] = useState(() => toIndiaDateInputValue())
  const requestId = useRef<string | null>(null)
  const today = toIndiaDateInputValue()
  const isDirty = Boolean((amount && obligation && amount !== String(obligation.amount)) || transactionDate !== today)
  useModalBack(isOpen, onClose, isDirty, 'Discard this settlement request?')
  const handleClose = () => {
    if (isDirty && !window.confirm('Discard this settlement request?')) return
    onClose()
  }

  const fetchAccounts = useCallback(async () => {
    setAccountsLoading(true)
    setAccountsError('')
    try {
      const [{ data: accData, error: accountError }, { data: balData, error: balanceError }] = await Promise.all([
        supabase.from('accounts').select('id, name, type, opening_date').order('name'),
        supabase.from('account_balances').select('id, balance'),
      ])
      if (accountError || balanceError) throw new Error('Account query failed')
      const balances = new Map((balData || []).map(balance => [balance.id, Number(balance.balance)]))
      const merged = (accData || []).map(account => ({ ...account, balance: balances.get(account.id) ?? 0 }))
      setAccounts(merged)
      setSelectedAccount(merged[0]?.id || '')
      if (!merged.length) setAccountsError('Add an account before requesting a settlement.')
    } catch {
      setAccounts([])
      setSelectedAccount('')
      setAccountsError('Accounts could not be loaded. Check your connection and try again.')
    } finally {
      setAccountsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!isOpen || !obligation) return
    requestId.current = crypto.randomUUID()
    setAmount(obligation.amount?.toString() || '')
    setTransactionDate(toIndiaDateInputValue())
    setFormError('')
    void fetchAccounts()
  }, [isOpen, obligation, fetchAccounts])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (accountsLoading || !accounts.length || !selectedAccount) return alert('Choose a loaded account before requesting settlement.')
    const account = accounts.find(item => item.id === selectedAccount)
    if (!account) return alert('Choose a valid payment account.')
    if (transactionDate > toIndiaDateInputValue()) {
      setFormError('Settlement date cannot be in the future.')
      return
    }
    if (isDateBeforeOpeningDate(transactionDate, account.opening_date)) {
      setFormError(`${account.name} started on ${account.opening_date}; choose that date or later.`)
      return
    }
    setIsSubmitting(true)
    setFormError('')
    
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error("Authentication missing")
      
      requestId.current ||= crypto.randomUUID()
      const { error } = await supabase.rpc('request_settlement', {
        p_request_id: requestId.current,
        p_obligation_id: obligation.id,
        p_source_account_id: selectedAccount,
        p_amount: parseFloat(amount),
        p_expected_month: null,
        p_transaction_date: transactionDate
      })
      
      if (error) throw error
      requestId.current = null
      
      alert("Payment request sent! Waiting for receiver to accept.")
      onClose()
    } catch (err: any) {
      setFormError(safeCaughtErrorMessage(err, 'Settlement request could not be sent. Refresh and try again.'))
    } finally {
      setIsSubmitting(false)
    }
  }
  
  if (!isOpen || !obligation) return null
  
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-in fade-in duration-200">
      <div className="w-full max-w-sm p-6 rounded-3xl backdrop-blur-2xl bg-slate-900 border border-white/20 shadow-2xl relative animate-in zoom-in-95 text-white">
        <button onClick={handleClose} className="absolute top-4 right-4 p-2 text-white/60 hover:text-white rounded-full hover:bg-white/10 transition-colors z-10"><X className="w-5 h-5" /></button>
        
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
              <input type="number" step="0.01" max={obligation.amount} required value={amount} onChange={(e) => { if (e.target.value !== amount) requestId.current = null; setAmount(e.target.value) }} className="bg-transparent border-none outline-none text-center w-full max-w-[150px] placeholder:text-white/20 appearance-none text-emerald-400" disabled={isSubmitting} />
            </div>
            <p className="text-[10px] text-slate-500">Remaining Balance: ₹{obligation.amount}</p>
          </div>

          <div className="flex flex-col space-y-1">
            <label htmlFor="settlement-occurrence-date" className="text-xs font-semibold tracking-wide text-white/50 uppercase">Occurred on</label>
            <input id="settlement-occurrence-date" type="date" max={today} required value={transactionDate} onChange={event => { if (event.target.value !== transactionDate) requestId.current = null; setTransactionDate(event.target.value); setFormError('') }} className="w-full color-scheme-dark bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-emerald-500/50" disabled={isSubmitting} />
            <p className="text-[10px] text-slate-500">The approved repayment is recorded on this date for both people.</p>
          </div>

          <div className="flex flex-col space-y-1">
            <label className="text-xs font-semibold tracking-wide text-white/50 uppercase">Pay From</label>
            <div className="relative mt-1">
              <Wallet className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <select required value={selectedAccount} onChange={(e) => { if (e.target.value !== selectedAccount) requestId.current = null; setSelectedAccount(e.target.value); setFormError('') }} className="w-full bg-black/40 border border-white/10 rounded-xl pl-10 pr-4 py-3 text-white outline-none focus:border-emerald-500/50 appearance-none" disabled={isSubmitting || accountsLoading || !accounts.length}>
                {accounts.map(acc => <option key={acc.id} value={acc.id} className="text-slate-900">{acc.name} (₹{acc.balance})</option>)}
                {!accounts.length && <option value="" className="text-slate-900">{accountsLoading ? 'Loading accounts…' : 'No accounts available'}</option>}
              </select>
            </div>
          </div>

          {formError && <p role="alert" className="text-xs text-rose-300">{formError}</p>}
          {accountsError && <p role="alert" className="text-xs text-amber-300">{accountsError}</p>}
          <button type="submit" disabled={isSubmitting || accountsLoading || !accounts.length || !selectedAccount} className="w-full flex items-center justify-center py-3.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white font-bold text-lg transition-all shadow-[0_0_15px_rgba(16,185,129,0.3)] disabled:opacity-50">
            {isSubmitting ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Send to Escrow'}
          </button>
        </form>
      </div>
    </div>
  )
}

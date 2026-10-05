import React, { useState } from 'react'
import { X, Wallet, CreditCard, IndianRupee, Loader2, ChevronDown } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useModalBack } from '../lib/useModalBack'
import { openingBalanceForAccountType, toIndiaDateInputValue } from '../lib/financeDate'
import { safeCaughtErrorMessage } from '../lib/safeErrorMessages'
import LiquidGlassSwitcher from './ui/LiquidGlassSwitcher'
import { liquidGlassItemProps } from './ui/liquidGlassSwitcherItem'

interface AddAccountModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
}

export default function AddAccountModal({ isOpen, onClose, onSuccess }: AddAccountModalProps) {
  const [name, setName] = useState('')
  // FIXED: The database expects exactly 'credit_card', not 'credit'
  const [type, setType] = useState<'bank' | 'cash' | 'credit_card' | 'pay_later'>('bank')
  const [accountGroup, setAccountGroup] = useState<'liquid' | 'credit'>('liquid')
  const [creditLimit, setCreditLimit] = useState('')
  const [openingBalance, setOpeningBalance] = useState('0')
  const [openingDate, setOpeningDate] = useState(() => toIndiaDateInputValue())
  const [isSubmitting, setIsSubmitting] = useState(false)
  const isDirty = Boolean(name || creditLimit || openingBalance !== '0' || openingDate !== toIndiaDateInputValue())

  const resetForm = () => {
    setName('')
    setType('bank')
    setAccountGroup('liquid')
    setCreditLimit('')
    setOpeningBalance('0')
    setOpeningDate(toIndiaDateInputValue())
  }

  useModalBack(isOpen, () => { resetForm(); onClose() }, isDirty, 'Discard this account and close the dialog?')

  const handleClose = (discard = false) => {
    if (!discard && isDirty && !window.confirm('Discard this account and close the dialog?')) return
    resetForm()
    onClose()
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')

      const payload: any = {
        name,
        type,
        owner_id: user.id,
        // Match the check for the new exact string
        credit_limit: type === 'credit_card' || type === 'pay_later' ? parseFloat(creditLimit || '0') : 0,
        opening_balance: openingBalanceForAccountType(openingBalance, type),
        opening_date: openingDate
      }

      const { error } = await supabase.from('accounts').insert(payload)
      if (error) throw error

      window.dispatchEvent(new Event('rr:financial-data-changed'))
      handleClose(true)
      onSuccess()
    } catch (error: any) {
      console.error('Account creation failed')
      alert(safeCaughtErrorMessage(error, 'Could not create this account. Check the details and try again.'))
    } finally {
      setIsSubmitting(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-3 bg-black/60 backdrop-blur-md animate-in fade-in duration-200 sm:p-4">
      <div role="dialog" aria-modal="true" aria-labelledby="add-account-title" className="app-account-entry-modal relative w-full max-w-[calc(100vw-1.5rem)] max-h-[calc(100dvh-1.5rem)] overflow-hidden p-3 rounded-3xl backdrop-blur-2xl bg-white/10 border border-white/20 shadow-2xl animate-in zoom-in-95 duration-200 text-white sm:max-w-md sm:p-6">
        
        <div className="mb-2.5 flex shrink-0 items-start justify-between gap-3">
          <h2 id="add-account-title" className="min-w-0 pt-1 text-left text-xl font-bold">Add New Account</h2>
          <button
            type="button"
            aria-label="Close account form"
            onClick={() => handleClose()}
            className="-mr-1 -mt-1 shrink-0 rounded-full p-2 text-white/60 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-primary)]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col space-y-2 sm:space-y-6">
          
          {/* Choose the account family first, then its specific kind. */}
          <div className="space-y-2 sm:space-y-3">
            <LiquidGlassSwitcher activeKey={accountGroup} label="Account family" className="app-modal-liquid-switcher w-full">
              {([
                { id: 'liquid', title: 'Liquid', detail: 'Money you hold', icon: Wallet },
                { id: 'credit', title: 'Credit Line', detail: 'Borrowed spending limit', icon: CreditCard },
              ] as const).map(({ id, title, detail, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    setAccountGroup(id)
                    setType(id === 'liquid' ? 'bank' : 'credit_card')
                  }}
                  aria-pressed={accountGroup === id}
                  {...liquidGlassItemProps(id, accountGroup === id, 'min-w-0 flex-1 gap-1.5 px-2 py-2 text-left text-xs sm:gap-3 sm:px-3 sm:py-3 sm:text-sm')}
                >
                  <Icon className={`h-5 w-5 shrink-0 ${accountGroup === id ? 'text-indigo-300' : ''}`} />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">{title}</span>
                    <span className="app-account-tab-detail block text-[11px] text-[var(--muted)]">{detail}</span>
                  </span>
                </button>
              ))}
            </LiquidGlassSwitcher>
            <label className="relative block">
              <span className="sr-only">Account type</span>
              <select
                value={type}
                onChange={event => setType(event.target.value as typeof type)}
                className="w-full appearance-none rounded-xl border border-white/10 bg-black/25 px-4 py-2.5 pr-10 text-sm text-white outline-none focus:border-indigo-400/60 sm:py-3"
              >
                {accountGroup === 'liquid' ? <>
                  <option value="bank" className="text-slate-900">Bank account</option>
                  <option value="cash" className="text-slate-900">Cash in Hand / Wallet</option>
                </> : <>
                  <option value="credit_card" className="text-slate-900">Credit card</option>
                  <option value="pay_later" className="text-slate-900">Pay Later</option>
                </>}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/50" />
            </label>
          </div>

          <div className="flex flex-col space-y-1">
            <label className="text-xs font-semibold tracking-wide text-white/50 uppercase">Account Name</label>
            <input 
              type="text"
              placeholder={type === 'credit_card' ? 'e.g., HDFC Millennia' : type === 'pay_later' ? 'e.g., Amazon Pay Later' : type === 'cash' ? 'e.g., Wallet Cash' : 'e.g., SBI Savings'}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-black/20 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder:text-white/20 outline-none focus:border-indigo-500/50 transition-colors sm:px-4 sm:py-3"
              required
              disabled={isSubmitting}
            />
          </div>

          <div className={type === 'credit_card' || type === 'pay_later' ? 'grid grid-cols-2 gap-2' : ''}>
            {(type === 'credit_card' || type === 'pay_later') && (
              <div className="flex min-w-0 flex-col space-y-1">
                <label className="text-[10px] font-semibold tracking-wide text-white/50 uppercase sm:text-xs">Credit Limit</label>
                <div className="relative">
                  <IndianRupee className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/40" />
                  <input type="number" placeholder="100000" value={creditLimit} onChange={event => setCreditLimit(event.target.value)} className="w-full bg-black/20 border border-white/10 rounded-xl pl-7 pr-2 py-2.5 text-white placeholder:text-white/20 outline-none focus:border-indigo-500/50 transition-colors appearance-none sm:py-3" required disabled={isSubmitting} />
                </div>
              </div>
            )}

            <div className="flex min-w-0 flex-col space-y-1">
              <label htmlFor="account-opening-balance" className="text-[10px] font-semibold tracking-wide text-white/50 uppercase sm:text-xs">{type === 'credit_card' || type === 'pay_later' ? 'Outstanding' : 'Starting balance'}</label>
              <div className="relative">
                <IndianRupee className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/40" />
                <input id="account-opening-balance" type="number" min="0" max="9999999999.99" step="0.01" value={openingBalance} onChange={event => setOpeningBalance(event.target.value)} className="w-full bg-black/20 border border-white/10 rounded-xl pl-7 pr-2 py-2.5 text-white outline-none focus:border-indigo-500/50 transition-colors appearance-none sm:py-3" required disabled={isSubmitting} />
              </div>
            </div>
          </div>

            <div className="flex flex-col space-y-1">
            <label htmlFor="account-opening-date" className="text-xs font-semibold tracking-wide text-white/50 uppercase">Start tracking from</label>
            <input id="account-opening-date" type="date" max={toIndiaDateInputValue()} value={openingDate} onChange={event => setOpeningDate(event.target.value)} className="w-full color-scheme-dark bg-black/20 border border-white/10 rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-indigo-500/50 sm:px-4 sm:py-3" required disabled={isSubmitting} />
          </div>

          <button 
            type="submit"
            disabled={isSubmitting}
            className="w-full flex items-center justify-center py-3 mt-1 rounded-xl bg-white text-slate-900 font-bold text-base hover:bg-slate-200 transition-all shadow-[0_0_20px_rgba(255,255,255,0.1)] hover:shadow-[0_0_25px_rgba(255,255,255,0.2)] disabled:opacity-50 sm:py-4 sm:text-lg"
          >
            {isSubmitting ? <Loader2 className="w-6 h-6 animate-spin" /> : 'Create Account'}
          </button>

        </form>
      </div>
    </div>
  )
}

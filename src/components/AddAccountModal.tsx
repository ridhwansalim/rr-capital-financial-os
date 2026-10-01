import React, { useState } from 'react'
import { X, Landmark, Wallet, CreditCard, IndianRupee, Loader2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useModalBack } from '../lib/useModalBack'

interface AddAccountModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
}

export default function AddAccountModal({ isOpen, onClose, onSuccess }: AddAccountModalProps) {
  const [name, setName] = useState('')
  // FIXED: The database expects exactly 'credit_card', not 'credit'
  const [type, setType] = useState<'bank' | 'cash' | 'credit_card'>('bank')
  const [creditLimit, setCreditLimit] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  useModalBack(isOpen, () => { setName(''); setType('bank'); setCreditLimit(''); onClose() }, Boolean(name || creditLimit), 'Discard this account and close the dialog?')

  const handleClose = (discard = false) => {
    if (!discard && (name || creditLimit) && !window.confirm('Discard this account and close the dialog?')) return
    setName('')
    setType('bank')
    setCreditLimit('')
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
        credit_limit: type === 'credit_card' ? parseFloat(creditLimit || '0') : 0
      }

      const { error } = await supabase.from('accounts').insert(payload)
      if (error) throw error

      handleClose(true)
      onSuccess()
    } catch (error: any) {
      console.error('Error creating account:', error.message)
      alert(`Failed to create account: ${error.message}`)
    } finally {
      setIsSubmitting(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-in fade-in duration-200">
      <div className="w-full max-w-md p-6 rounded-3xl backdrop-blur-2xl bg-white/10 border border-white/20 shadow-2xl relative animate-in zoom-in-95 duration-200 text-white">
        
        <button 
          onClick={() => handleClose()}
          className="absolute top-4 right-4 p-2 text-white/60 hover:text-white rounded-full hover:bg-white/10 transition-colors z-10"
        >
          <X className="w-5 h-5" />
        </button>

        <h2 className="text-xl font-bold mb-6 text-center">Add New Account</h2>

        <form onSubmit={handleSubmit} className="flex flex-col space-y-6">
          
          {/* Account Type Selector */}
          <div className="flex p-1 bg-black/20 rounded-xl backdrop-blur-sm border border-white/10">
            {(['bank', 'cash', 'credit_card'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setType(t)}
                className={`flex-1 py-2 flex items-center justify-center space-x-2 text-xs font-medium rounded-lg capitalize transition-all duration-200 ${
                  type === t 
                    ? 'bg-white/20 text-white shadow-sm' 
                    : 'text-white/50 hover:text-white/80'
                }`}
              >
                {t === 'bank' && <Landmark className={`w-4 h-4 ${type === t ? 'text-indigo-400' : ''}`} />}
                {t === 'cash' && <Wallet className={`w-4 h-4 ${type === t ? 'text-emerald-400' : ''}`} />}
                {t === 'credit_card' && <CreditCard className={`w-4 h-4 ${type === t ? 'text-rose-400' : ''}`} />}
                <span>{t === 'credit_card' ? 'Credit' : t}</span>
              </button>
            ))}
          </div>

          <div className="flex flex-col space-y-1">
            <label className="text-xs font-semibold tracking-wide text-white/50 uppercase">Account Name</label>
            <input 
              type="text"
              placeholder={type === 'credit_card' ? 'e.g., HDFC Millennia' : 'e.g., SBI Savings'}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-white/20 outline-none focus:border-indigo-500/50 transition-colors"
              required
              disabled={isSubmitting}
            />
          </div>

          {type === 'credit_card' && (
            <div className="flex flex-col space-y-1">
              <label className="text-xs font-semibold tracking-wide text-white/50 uppercase">Total Credit Limit</label>
              <div className="relative">
                <IndianRupee className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
                <input 
                  type="number"
                  placeholder="100000"
                  value={creditLimit}
                  onChange={(e) => setCreditLimit(e.target.value)}
                  className="w-full bg-black/20 border border-white/10 rounded-xl pl-9 pr-4 py-3 text-white placeholder:text-white/20 outline-none focus:border-indigo-500/50 transition-colors appearance-none"
                  required
                  disabled={isSubmitting}
                />
              </div>
            </div>
          )}

          <button 
            type="submit"
            disabled={isSubmitting}
            className="w-full flex items-center justify-center py-4 mt-2 rounded-xl bg-white text-slate-900 font-bold text-lg hover:bg-slate-200 transition-all shadow-[0_0_20px_rgba(255,255,255,0.1)] hover:shadow-[0_0_25px_rgba(255,255,255,0.2)] disabled:opacity-50"
          >
            {isSubmitting ? <Loader2 className="w-6 h-6 animate-spin" /> : 'Create Account'}
          </button>

        </form>
      </div>
    </div>
  )
}

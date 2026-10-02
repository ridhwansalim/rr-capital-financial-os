import React, { useState, useEffect } from 'react'
import { X, IndianRupee, Loader2, Trash2, AlertTriangle, Pencil } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useModalBack } from '../lib/useModalBack'
import { safeCaughtErrorMessage } from '../lib/safeErrorMessages'

interface Account {
  id: string
  name: string
  type: string
  credit_limit: number
}

interface EditAccountModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
  account: Account | null
}

export default function EditAccountModal({ isOpen, onClose, onSuccess, account }: EditAccountModalProps) {
  const [name, setName] = useState('')
  const [creditLimit, setCreditLimit] = useState('')
  
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false)
  const isDirty = Boolean(account && (name !== account.name || creditLimit !== (account.credit_limit ? account.credit_limit.toString() : '')))
  useModalBack(isOpen, onClose, isDirty, 'Discard your account changes and close the dialog?')

  // Pre-fill the form when the modal opens with a specific account
  useEffect(() => {
    if (account && isOpen) {
      setName(account.name)
      setCreditLimit(account.credit_limit ? account.credit_limit.toString() : '')
      setIsConfirmingDelete(false)
    }
  }, [account, isOpen])

  const handleClose = (discard = false) => {
    if (!discard && isDirty && !window.confirm('Discard your account changes and close the dialog?')) return
    setIsConfirmingDelete(false)
    onClose()
  }

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!account) return
    setIsSubmitting(true)

    try {
      const payload: any = { name }
      if (account.type === 'credit_card' || account.type === 'credit' || account.type === 'pay_later') {
        payload.credit_limit = parseFloat(creditLimit || '0')
      }

      const { error } = await supabase
        .from('accounts')
        .update(payload)
        .eq('id', account.id)

      if (error) throw error

      handleClose(true)
      onSuccess()
    } catch (error: any) {
      console.error('Account update failed')
      alert(safeCaughtErrorMessage(error, 'Could not update this account. Check the details and try again.'))
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDelete = async () => {
    if (!account) return
    setIsSubmitting(true)

    try {
      // NOTE: If this account has transactions tied to it, Supabase might reject the delete 
      // due to foreign key constraints. This is a safety feature to prevent broken ledgers!
      const { error } = await supabase
        .from('accounts')
        .delete()
        .eq('id', account.id)

      if (error) {
        if (error.code === '23503') {
          throw new Error("Cannot delete this account because it has existing transactions. Please delete or reassign its transactions first.")
        }
        throw error
      }

      handleClose(true)
      onSuccess()
    } catch (error: any) {
      console.error('Account deletion failed')
      alert(safeCaughtErrorMessage(error, 'Could not delete this account. Linked financial history is preserved.'))
      setIsConfirmingDelete(false)
    } finally {
      setIsSubmitting(false)
    }
  }

  if (!isOpen || !account) return null

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-in fade-in duration-200">
      <div className="w-full max-w-md p-6 rounded-3xl backdrop-blur-2xl bg-white/10 border border-white/20 shadow-2xl relative animate-in zoom-in-95 duration-200 text-white">
        
        <button 
          onClick={() => handleClose()}
          className="absolute top-4 right-4 p-2 text-white/60 hover:text-white rounded-full hover:bg-white/10 transition-colors z-10"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center justify-center mb-6">
          <div className="p-3 bg-indigo-500/20 rounded-full mr-3 border border-indigo-500/20">
            <Pencil className="w-5 h-5 text-indigo-400" />
          </div>
          <h2 className="text-xl font-bold">Edit Account</h2>
        </div>

        {isConfirmingDelete ? (
          <div className="flex flex-col items-center justify-center space-y-4 py-4 animate-in fade-in">
            <div className="w-16 h-16 rounded-full bg-rose-500/20 flex items-center justify-center border border-rose-500/50">
              <AlertTriangle className="w-8 h-8 text-rose-500" />
            </div>
            <h3 className="text-lg font-bold text-center">Are you absolutely sure?</h3>
            <p className="text-sm text-white/60 text-center px-4">
              This action cannot be undone. You can only delete accounts that have no transactions logged against them.
            </p>
            <div className="flex w-full gap-3 mt-4">
              <button 
                onClick={() => setIsConfirmingDelete(false)}
                className="flex-1 py-3 bg-white/10 hover:bg-white/20 rounded-xl font-semibold transition-colors"
                disabled={isSubmitting}
              >
                Cancel
              </button>
              <button 
                onClick={handleDelete}
                className="flex-1 py-3 bg-rose-500 hover:bg-rose-600 rounded-xl font-semibold transition-colors shadow-[0_0_15px_rgba(244,63,94,0.3)] flex items-center justify-center"
                disabled={isSubmitting}
              >
                {isSubmitting ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Yes, Delete it'}
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleUpdate} className="flex flex-col space-y-5">
            <div className="flex flex-col space-y-1">
              <label className="text-xs font-semibold tracking-wide text-white/50 uppercase">Account Name</label>
              <input 
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-indigo-500/50 transition-colors"
                required
                disabled={isSubmitting}
              />
            </div>

            {(account.type === 'credit_card' || account.type === 'credit' || account.type === 'pay_later') && (
              <div className="flex flex-col space-y-1">
                <label className="text-xs font-semibold tracking-wide text-white/50 uppercase">Total Credit Limit</label>
                <div className="relative">
                  <IndianRupee className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
                  <input 
                    type="number"
                    value={creditLimit}
                    onChange={(e) => setCreditLimit(e.target.value)}
                    className="w-full bg-black/20 border border-white/10 rounded-xl pl-9 pr-4 py-3 text-white outline-none focus:border-indigo-500/50 transition-colors appearance-none"
                    required
                    disabled={isSubmitting}
                  />
                </div>
              </div>
            )}

            <button 
              type="submit"
              disabled={isSubmitting}
              className="w-full flex items-center justify-center py-3.5 mt-2 rounded-xl bg-white text-slate-900 font-bold text-lg hover:bg-slate-200 transition-all shadow-[0_0_20px_rgba(255,255,255,0.1)] disabled:opacity-50"
            >
              {isSubmitting ? <Loader2 className="w-6 h-6 animate-spin" /> : 'Save Changes'}
            </button>
            
            <button 
              type="button"
              onClick={() => setIsConfirmingDelete(true)}
              className="w-full flex items-center justify-center py-3 rounded-xl bg-rose-500/10 text-rose-400 font-semibold hover:bg-rose-500/20 transition-all mt-2 border border-rose-500/20"
              disabled={isSubmitting}
            >
              <Trash2 className="w-4 h-4 mr-2" /> Delete Account
            </button>
          </form>
        )}
      </div>
    </div>
  )
}

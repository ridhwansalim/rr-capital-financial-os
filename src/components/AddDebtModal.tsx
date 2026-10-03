import React, { useState, useEffect, useRef } from 'react'
import { X, Search, UserPlus, IndianRupee, User, Users, Loader2, Wallet } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { indiaDateInputToIso, isDateBeforeOpeningDate, toIndiaDateInputValue } from '../lib/financeDate'
import { safeCaughtErrorMessage } from '../lib/safeErrorMessages'

interface AddDebtModalProps {
  isOpen: boolean
  onClose: () => void
}

interface SearchEntity {
  id: string
  name: string
  subtitle: string
  type: 'profile' | 'contact'
}

interface Account {
  id: string
  name: string
  balance: number
  opening_date?: string
}

export default function AddDebtModal({ isOpen, onClose }: AddDebtModalProps) {
  const [type, setType] = useState<'lent' | 'borrowed'>('lent')
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [transactionDate, setTransactionDate] = useState(() => toIndiaDateInputValue())
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  
  const [searchQuery, setSearchQuery] = useState('')
  const [isSearching, setIsSearching] = useState(false)
  const [isFocused, setIsFocused] = useState(false)
  const [searchResults, setSearchResults] = useState<SearchEntity[]>([])
  const [myContacts, setMyContacts] = useState<SearchEntity[]>([])
  const [selectedEntity, setSelectedEntity] = useState<SearchEntity | null>(null)
  const [newShadowName, setNewShadowName] = useState('')
  
  const [accounts, setAccounts] = useState<Account[]>([])
  const [selectedAccount, setSelectedAccount] = useState('') 
  const [isSubmitting, setIsSubmitting] = useState(false)
  const requestId = useRef<string | null>(null)
  const requestFingerprint = useRef<string | null>(null)

  useEffect(() => {
    if (isOpen) {
      setTransactionDate(toIndiaDateInputValue())
      fetchInitialData()
    }
  }, [isOpen])

  const fetchInitialData = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const user = session?.user
      if (!user) return
      setCurrentUserId(user.id)

      const [contactResult, accountResult, balanceResult] = await Promise.all([
        supabase.from('contacts').select('id, name').eq('owner_id', user.id).order('name').limit(10),
        supabase.from('accounts').select('id, name, opening_date').eq('owner_id', user.id).order('name'),
        supabase.from('account_balances').select('id, balance'),
      ])

      const { data: contacts } = contactResult
      if (contacts) setMyContacts(contacts.map(c => ({ id: c.id, name: c.name, subtitle: 'Shadow Contact', type: 'contact' })))

      const accData = accountResult.data
      const balData = balanceResult.data
      if (accData) {
        const balancesById = new Map((balData || []).map(balance => [balance.id, Number(balance.balance)]))
        const merged = accData.map(acc => {
          return { ...acc, balance: balancesById.get(acc.id) ?? 0 }
        })
        setAccounts(merged)
      }
    } catch {
      console.error('Could not load debt form choices')
    }
  }

  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([])
      return
    }
    if (selectedEntity || newShadowName === searchQuery) return

    const delayDebounceFn = setTimeout(async () => {
      setIsSearching(true)
      try {
        const profileQuery = supabase.rpc('search_users', { search_term: searchQuery })
        const contactQuery = supabase.from('contacts').select('id, name').eq('owner_id', currentUserId).ilike('name', `%${searchQuery}%`).limit(3)

        const [profileRes, contactRes] = await Promise.all([profileQuery, contactQuery])
        const combined: SearchEntity[] = []
        
        if (contactRes.data) contactRes.data.forEach(c => combined.push({ id: c.id, name: c.name, subtitle: 'Shadow Contact', type: 'contact' }))
        if (profileRes.data) {
          profileRes.data.forEach((p: any) => {
            if (p.id !== currentUserId) {
              const displayName = p.full_name || p.username || 'Registered user'
              const usernameLabel = p.username ? '@' + p.username : 'Registered user'
              combined.push({ id: p.id, name: displayName, subtitle: 'Registered user ' + usernameLabel, type: 'profile' })
            }
          })
        }
        setSearchResults(combined)
      } catch {
        console.error('Debt counterparty search failed')
      } finally {
        setIsSearching(false)
      }
    }, 500)

    return () => clearTimeout(delayDebounceFn)
  }, [searchQuery, selectedEntity, newShadowName, currentUserId])

  const handleClose = (discard = false) => {
    if (!discard && (amount || description || searchQuery || newShadowName || transactionDate !== toIndiaDateInputValue()) &&
        !window.confirm('You have unsaved debt details. Discard them and close?')) return
    setType('lent')
    setAmount('')
    setDescription('')
    setTransactionDate(toIndiaDateInputValue())
    setSearchQuery('')
    setSearchResults([])
    setSelectedEntity(null)
    setNewShadowName('')
    setSelectedAccount('')
    requestId.current = null
    requestFingerprint.current = null
    onClose()
  }

  useEffect(() => {
    if (!isOpen) return
    const closeOnBack = (event: Event) => {
      if (amount || description || searchQuery || newShadowName || transactionDate !== toIndiaDateInputValue()) {
        if (!window.confirm('You have unsaved debt details. Discard them and close?')) {
          event.preventDefault()
          return
        }
      }
      handleClose(true)
    }
    window.addEventListener('rr:modal-back', closeOnBack)
    return () => window.removeEventListener('rr:modal-back', closeOnBack)
  }, [isOpen, amount, description, searchQuery, newShadowName, transactionDate])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')

      const parsedAmount = parseFloat(amount)
      const account = accounts.find(item => item.id === selectedAccount)
      if (!account) throw new Error('Choose an account before saving this debt.')
      if (isDateBeforeOpeningDate(transactionDate, account.opening_date)) {
        throw new Error(account.name + ' started on ' + account.opening_date + '; choose that date or later.')
      }
      let finalProfileId = null
      let finalShadowContactId = null

      if (selectedEntity) {
        if (selectedEntity.type === 'profile') finalProfileId = selectedEntity.id
        if (selectedEntity.type === 'contact') finalShadowContactId = selectedEntity.id
      }

      const requestPayload = {
        p_owner_id: user.id,
        p_counterparty_profile_id: finalProfileId,
        p_shadow_contact_id: finalShadowContactId,
        p_account_id: selectedAccount,
        p_amount: parsedAmount,
        p_description: description,
        p_is_emi: false,
        p_type: type,
        p_transaction_date: indiaDateInputToIso(transactionDate),
        p_new_shadow_contact_name: newShadowName.trim() || null
      }
      const fingerprint = JSON.stringify(requestPayload)
      if (!requestId.current || requestFingerprint.current !== fingerprint) {
        requestId.current = crypto.randomUUID()
        requestFingerprint.current = fingerprint
      }
      const { error: rpcError } = await supabase.rpc('process_p2p_transaction', {
        p_request_id: requestId.current,
        ...requestPayload
      })
      
      if (rpcError) throw rpcError

      handleClose(true)
      if (window.location.pathname === '/debts') window.location.reload()
    } catch (error: any) {
      console.error('Debt or IOU submission failed')
      alert(safeCaughtErrorMessage(error, 'Could not save this debt or IOU. Check the details and try again.'))
    } finally {
      setIsSubmitting(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-in fade-in duration-200">
      <div className="app-financial-entry-modal w-full max-w-md p-6 rounded-3xl backdrop-blur-2xl bg-white/10 border border-white/20 shadow-2xl relative animate-in zoom-in-95 duration-200 text-white max-h-[90vh] overflow-y-auto">
        
        <button type="button" aria-label="Close debt form" onClick={() => handleClose()} className="absolute top-4 right-4 p-2 text-white/60 hover:text-white rounded-full hover:bg-white/10 transition-colors z-10">
          <X className="w-5 h-5" />
        </button>

        <h2 className="text-xl font-bold mb-6 text-center flex justify-center items-center">
          <Users className="w-5 h-5 mr-2 text-emerald-400" /> Track P2P Debt
        </h2>

        <form onSubmit={handleSubmit} className="flex flex-col space-y-4">
          
          <div className="flex p-1 bg-black/20 rounded-xl backdrop-blur-sm border border-white/10">
            {(['lent', 'borrowed'] as const).map((t) => (
              <button
                key={t} type="button" onClick={() => setType(t)}
                className={`flex-1 py-2 text-sm font-bold rounded-lg capitalize transition-all duration-200 ${
                  type === t ? 'bg-emerald-500 text-white shadow-sm' : 'text-white/50 hover:text-white/80'
                }`}
              >
                I {t}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 min-[360px]:grid-cols-[minmax(0,1fr)_minmax(132px,0.85fr)] gap-3 items-stretch">
            <div className="flex min-w-0 flex-col items-center justify-center space-y-1 py-3 bg-black/20 rounded-2xl border border-white/5">
              <label htmlFor="debt-amount" className="text-white/50 text-xs font-medium uppercase tracking-wider">Amount</label>
              <div className="flex min-w-0 items-center justify-center text-4xl font-black">
                <IndianRupee className="w-7 h-7 shrink-0 text-white/50 mr-1" />
                <input id="debt-amount" type="number" step="0.01" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} className="min-w-0 bg-transparent border-none outline-none text-center w-full max-w-[200px] placeholder:text-white/20 appearance-none text-emerald-400" required disabled={isSubmitting} />
              </div>
            </div>
            <div className="flex min-w-0 flex-col justify-center space-y-1 rounded-2xl border border-white/5 bg-black/20 px-3 py-2">
              <label htmlFor="debt-occurrence-date" className="text-[10px] font-semibold tracking-wide text-white/50 uppercase">Occurred on</label>
              <input id="debt-occurrence-date" aria-describedby="debt-occurrence-help" type="date" required value={transactionDate} max={toIndiaDateInputValue()} onChange={event => setTransactionDate(event.target.value)} disabled={isSubmitting} className="min-w-0 w-full color-scheme-dark bg-transparent text-sm text-white outline-none" />
              <span id="debt-occurrence-help" className="sr-only">The day the money was lent or borrowed.</span>
            </div>
          </div>

          <div className="flex flex-col space-y-2 relative">
            <label className="text-xs font-semibold tracking-wide text-white/50 uppercase">
              {type === 'lent' ? 'Who borrowed it?' : 'Who lent it to you?'}
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Search className="h-4 w-4 text-white/40" />
              </div>
              <input type="text" placeholder="Search user or add shadow contact..." value={selectedEntity ? selectedEntity.name : (newShadowName || searchQuery)} onChange={(e) => { setSelectedEntity(null); setNewShadowName(''); setSearchQuery(e.target.value) }} onFocus={() => setIsFocused(true)} onBlur={() => setTimeout(() => setIsFocused(false), 200)} className="w-full bg-black/40 border border-white/10 rounded-xl pl-10 pr-10 py-3 text-white placeholder:text-white/20 outline-none focus:border-emerald-500/50 transition-colors" required disabled={isSubmitting} />
              
              {(selectedEntity || newShadowName) && (
                <button type="button" onClick={() => { setSelectedEntity(null); setNewShadowName(''); setSearchQuery(''); }} className="absolute inset-y-0 right-0 pr-3 flex items-center text-white/40 hover:text-white transition-colors">
                  <X className="h-4 w-4" />
                </button>
              )}
              {isSearching && <div className="absolute inset-y-0 right-0 pr-3 flex items-center"><Loader2 className="h-4 w-4 text-white/40 animate-spin" /></div>}
            </div>

            {isFocused && !searchQuery && !selectedEntity && !newShadowName && myContacts.length > 0 && (
              <div className="absolute top-[105%] left-0 right-0 bg-slate-900 border border-white/10 rounded-xl overflow-hidden shadow-2xl z-50 animate-in fade-in max-h-60 overflow-y-auto">
                <div className="px-4 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wider bg-black/40 border-b border-white/5">Your Contacts</div>
                {myContacts.map(contact => (
                  <button key={contact.id} type="button" onClick={() => { setSelectedEntity(contact); setIsFocused(false); }} className="w-full flex items-center px-4 py-3 hover:bg-white/10 transition-colors border-b border-white/5">
                    <div className="bg-emerald-500/20 p-2 rounded-full mr-3"><Users className="w-4 h-4 text-emerald-400" /></div>
                    <div className="text-left flex-1"><p className="text-sm font-medium text-white">{contact.name}</p><p className="text-xs text-emerald-400/70">{contact.subtitle}</p></div>
                  </button>
                ))}
              </div>
            )}

            {searchQuery && !selectedEntity && !newShadowName && (
              <div className="absolute top-[105%] left-0 right-0 bg-slate-900 border border-white/10 rounded-xl overflow-hidden shadow-2xl z-50 animate-in fade-in max-h-60 overflow-y-auto">
                {searchResults.map(entity => (
                  <button key={entity.id} type="button" onClick={() => { setSelectedEntity(entity); setSearchQuery(''); setIsFocused(false); }} className="w-full flex items-center px-4 py-3 hover:bg-white/10 transition-colors border-b border-white/5">
                    <div className={`p-2 rounded-full mr-3 ${entity.type === 'contact' ? 'bg-emerald-500/20' : 'bg-indigo-500/20'}`}>
                      {entity.type === 'contact' ? <Users className="w-4 h-4 text-emerald-400" /> : <User className="w-4 h-4 text-indigo-400" />}
                    </div>
                    <div className="text-left flex-1"><p className="text-sm font-medium text-white">{entity.name}</p><p className={`text-xs ${entity.type === 'contact' ? 'text-emerald-400/70' : 'text-indigo-400/70'}`}>{entity.subtitle}</p></div>
                  </button>
                ))}
                {!searchResults.find(r => r.name.toLowerCase() === searchQuery.toLowerCase()) && (
                  <button type="button" onClick={() => { setNewShadowName(searchQuery); setSearchQuery(''); setSearchResults([]); setIsFocused(false); }} className="w-full flex items-center px-4 py-3 hover:bg-white/10 transition-colors">
                    <div className="bg-white/10 p-2 rounded-full mr-3"><UserPlus className="w-4 h-4 text-white/60" /></div>
                    <div className="text-left flex-1"><p className="text-sm font-medium text-white">Create Shadow Contact</p><p className="text-xs text-white/50">"{searchQuery}" (Local tracking only)</p></div>
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="flex flex-col space-y-1">
            <label className="text-xs font-semibold tracking-wide text-white/50 uppercase">For What?</label>
            <input type="text" placeholder="e.g., iPhone 15, Dinner" value={description} onChange={(e) => setDescription(e.target.value)} className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-white/20 outline-none focus:border-emerald-500/50 transition-colors" required disabled={isSubmitting} />
          </div>

          <div className="space-y-3 p-4 bg-white/5 border border-white/10 rounded-xl">
            <div className="flex flex-col space-y-1">
              <label className="text-xs font-semibold tracking-wide text-emerald-400 uppercase">
                {type === 'lent' ? 'Paid From (Compulsory)' : 'Deposited To (Compulsory)'}
              </label>
              <div className="relative mt-1">
                <Wallet className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <select required value={selectedAccount} onChange={(e) => setSelectedAccount(e.target.value)} className="w-full bg-black/40 border border-white/10 rounded-xl pl-10 pr-4 py-3 text-white outline-none focus:border-emerald-500/50 appearance-none" disabled={isSubmitting}>
                  <option value="" disabled className="font-bold text-slate-400">Select an account...</option>
                  {accounts.map(acc => (
                    <option key={acc.id} value={acc.id} className="text-slate-900">{acc.name} (₹{acc.balance.toLocaleString('en-IN')})</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <button type="submit" disabled={isSubmitting} className="w-full flex items-center justify-center py-4 rounded-xl bg-emerald-500 text-white font-bold text-lg hover:bg-emerald-400 transition-colors shadow-[0_0_20px_rgba(16,185,129,0.2)] disabled:opacity-50">
            {isSubmitting ? <Loader2 className="w-6 h-6 animate-spin" /> : 'Log Handshake Transfer'}
          </button>
        </form>
      </div>
    </div>
  )
}

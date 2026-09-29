import React, { useState, useEffect } from 'react'
import { X, Search, UserPlus, IndianRupee, User, Users, Loader2, Wallet } from 'lucide-react'
import { supabase } from '../lib/supabase'

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
}

export default function AddDebtModal({ isOpen, onClose }: AddDebtModalProps) {
  const [type, setType] = useState<'lent' | 'borrowed'>('lent')
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
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

  useEffect(() => {
    if (isOpen) fetchInitialData()
  }, [isOpen])

  const fetchInitialData = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      setCurrentUserId(user.id)

      const { data: contacts } = await supabase.from('contacts').select('id, name').eq('owner_id', user.id).order('name').limit(10)
      if (contacts) setMyContacts(contacts.map(c => ({ id: c.id, name: c.name, subtitle: 'Shadow Contact', type: 'contact' })))

      const { data: accData } = await supabase.from('accounts').select('*').order('name')
      const { data: balData } = await supabase.from('account_balances').select('*')
      
      if (accData) {
        const merged = accData.map(acc => {
          const matched = balData?.find(b => b.id === acc.id)
          return { ...acc, balance: matched ? Number(matched.balance) : 0 }
        })
        setAccounts(merged)
      }
    } catch (err) {
      console.error(err)
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
              const displayName = p.full_name || p.username || p.email
              combined.push({ id: p.id, name: displayName, subtitle: `Registered User • ${p.email}`, type: 'profile' })
            }
          })
        }
        setSearchResults(combined)
      } catch (err) {
        console.error('Search error:', err)
      } finally {
        setIsSearching(false)
      }
    }, 500)

    return () => clearTimeout(delayDebounceFn)
  }, [searchQuery, selectedEntity, newShadowName, currentUserId])

  const handleClose = () => {
    setType('lent')
    setAmount('')
    setDescription('')
    setSearchQuery('')
    setSearchResults([])
    setSelectedEntity(null)
    setNewShadowName('')
    setSelectedAccount('')
    onClose()
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')

      const parsedAmount = parseFloat(amount)
      let finalShadowContactId = null
      let finalProfileId = null

      if (selectedEntity) {
        if (selectedEntity.type === 'profile') finalProfileId = selectedEntity.id
        if (selectedEntity.type === 'contact') finalShadowContactId = selectedEntity.id
      } else if (newShadowName) {
        const { data: newContact, error: insertError } = await supabase
          .from('contacts').insert({ owner_id: user.id, name: newShadowName }).select('id').single()
        if (insertError) throw insertError
        finalShadowContactId = newContact.id
      }

      const { error: rpcError } = await supabase.rpc('process_p2p_transaction', {
        p_owner_id: user.id,
        p_counterparty_profile_id: finalProfileId,
        p_shadow_contact_id: finalShadowContactId,
        p_account_id: selectedAccount,
        p_amount: parsedAmount,
        p_description: description,
        p_is_emi: false, // <-- REVERTED: Hardcoded to false for this modal
        p_type: type,
        p_transaction_date: new Date().toISOString()
      })
      
      if (rpcError) throw rpcError

      handleClose()
      if (window.location.pathname === '/debts') window.location.reload()
    } catch (error: any) {
      console.error('Error saving obligation:', error)
      alert(`Failed to save obligation: ${error.message}`)
    } finally {
      setIsSubmitting(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-in fade-in duration-200">
      <div className="w-full max-w-md p-6 rounded-3xl backdrop-blur-2xl bg-white/10 border border-white/20 shadow-2xl relative animate-in zoom-in-95 duration-200 text-white max-h-[90vh] overflow-y-auto">
        
        <button onClick={handleClose} className="absolute top-4 right-4 p-2 text-white/60 hover:text-white rounded-full hover:bg-white/10 transition-colors z-10">
          <X className="w-5 h-5" />
        </button>

        <h2 className="text-xl font-bold mb-6 text-center flex justify-center items-center">
          <Users className="w-5 h-5 mr-2 text-emerald-400" /> Track P2P Debt
        </h2>

        <form onSubmit={handleSubmit} className="flex flex-col space-y-6">
          
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

          <div className="flex flex-col items-center justify-center space-y-2 py-4 bg-black/20 rounded-2xl border border-white/5">
            <span className="text-white/50 text-sm font-medium uppercase tracking-wider">Amount</span>
            <div className="flex items-center justify-center text-5xl font-black">
              <IndianRupee className="w-10 h-10 text-white/50 mr-1" />
              <input type="number" step="0.01" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} className="bg-transparent border-none outline-none text-center w-full max-w-[200px] placeholder:text-white/20 appearance-none text-emerald-400" required disabled={isSubmitting} />
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
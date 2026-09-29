import React, { useState, useEffect, useRef } from 'react'
import { X, ArrowDownRight, ArrowUpRight, ArrowRightLeft, Loader2, IndianRupee, Sparkles, Camera, Search, User, Users, UserPlus, AlertCircle } from 'lucide-react'
import { supabase } from '../lib/supabase'

interface TransactionModalProps {
  isOpen: boolean
  onClose: () => void
  initialFile?: File | null
}

interface Account {
  id: string
  name: string
  type: string
  balance: number // NEW: Added for overdraft protection
}

interface SearchEntity {
  id: string
  name: string
  subtitle: string
  type: 'profile' | 'contact'
}

export default function TransactionModal({ isOpen, onClose, initialFile }: TransactionModalProps) {
  const [type, setType] = useState<'expense' | 'income' | 'transfer'>('expense')
  const [amount, setAmount] = useState('')
  const [feeAmount, setFeeAmount] = useState('')
  const [description, setDescription] = useState('')
  const [accounts, setAccounts] = useState<Account[]>([])
  const [selectedAccount, setSelectedAccount] = useState('')
  const [targetAccount, setTargetAccount] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  
  // AI State
  const [isAiScanning, setIsAiScanning] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Unified Contact Search State
  const [searchQuery, setSearchQuery] = useState('')
  const [isSearching, setIsSearching] = useState(false)
  const [isFocused, setIsFocused] = useState(false)
  const [searchResults, setSearchResults] = useState<SearchEntity[]>([])
  const [myContacts, setMyContacts] = useState<SearchEntity[]>([])
  const [selectedEntity, setSelectedEntity] = useState<SearchEntity | null>(null)
  const [newShadowName, setNewShadowName] = useState('')

  // Inline Account Creation State
  const [isCreatingAccount, setIsCreatingAccount] = useState(false)
  const [newAccName, setNewAccName] = useState('')
  const [newAccType, setNewAccType] = useState('bank')

  useEffect(() => {
    if (isOpen) {
      fetchAccounts()
      setError(null)
      setIsCreatingAccount(false)
      supabase.auth.getUser().then(({ data: { user } }) => {
        if (user) {
          setCurrentUserId(user.id)
          supabase.from('contacts').select('id, name').eq('owner_id', user.id).order('name').limit(10)
            .then(({ data }) => {
              if (data) {
                setMyContacts(data.map(c => ({ id: c.id, name: c.name, subtitle: 'Shadow Contact', type: 'contact' })))
              }
            })
        }
      })
    }
  }, [isOpen])

  useEffect(() => {
    if (isOpen && initialFile) processFile(initialFile)
  }, [isOpen, initialFile])

  // FIX: Using RPC for Profiles to bypass RLS, merged with local Shadow Contacts
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
        const contactQuery = supabase.from('contacts').select('id, name')
          .eq('owner_id', currentUserId).ilike('name', `%${searchQuery}%`).limit(3)

        const [profileRes, contactRes] = await Promise.all([profileQuery, contactQuery])
        const combined: SearchEntity[] = []
        
        if (contactRes.data) contactRes.data.forEach(c => combined.push({ id: c.id, name: c.name, subtitle: 'Shadow Contact', type: 'contact' }))
        if (profileRes.data) {
          profileRes.data.forEach((p: any) => {
            if (p.id !== currentUserId) {
              combined.push({ id: p.id, name: p.full_name || p.username || 'Registered user', subtitle: p.username ? '@' + p.username : 'Registered user', type: 'profile' })
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

  // FIX: Fetch balances alongside accounts for Overdraft protection
  const fetchAccounts = async () => {
    try {
      const { data: accData, error: accError } = await supabase.from('accounts').select('id, name, type').order('name')
      const { data: balData } = await supabase.from('account_balances').select('*')
      
      if (accError) throw accError
      if (accData) {
        const merged = accData.map(acc => {
          const matched = balData?.find(b => b.id === acc.id)
          return { ...acc, balance: matched ? Number(matched.balance) : 0 }
        })
        setAccounts(merged)
        if (merged.length > 0 && !selectedAccount) {
          setSelectedAccount(merged[0].id)
          setTargetAccount(merged.length > 1 ? merged[1].id : merged[0].id)
        }
      }
    } catch (err) {
      console.error('Error fetching accounts:', err)
    }
  }

  const handleClose = () => {
    setType('expense')
    setAmount('')
    setFeeAmount('')
    setDescription('')
    setSearchQuery('')
    setSearchResults([])
    setSelectedEntity(null)
    setNewShadowName('')
    setError(null)
    setIsCreatingAccount(false)
    onClose()
  }

  const processFile = async (file: File) => {
    const apiKey = localStorage.getItem('financial_os_ai_key')
    if (!apiKey) {
      alert('Please add your Gemini API Key in the Settings page first!')
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }
    setIsAiScanning(true)
    try {
      const reader = new FileReader()
      reader.readAsDataURL(file)
      reader.onload = async () => {
        const base64Data = (reader.result as string).split(',')[1]
        const prompt = `You are a financial data extractor. Analyze this receipt or invoice. Return ONLY a raw JSON object (no markdown formatting, no backticks) with these exact keys: "amount" (the total number only, no currency symbols), "description" (a brief 2-4 word summary of the purchase/vendor), and "type" (must be strictly "expense" or "income").`

        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: file.type, data: base64Data } }] }] })
        })

        const data = await response.json()
        if (data.error) throw new Error(data.error.message)

        const rawText = data.candidates[0].content.parts[0].text
        const cleanJson = rawText.replace(/```json/gi, '').replace(/```/g, '').trim()
        const result = JSON.parse(cleanJson)

        if (result.amount) setAmount(result.amount.toString())
        if (result.description) setDescription(result.description)
        if (result.type === 'expense' || result.type === 'income') setType(result.type)
        
        setIsAiScanning(false)
      }
    } catch (error: any) {
      alert(`AI Scan failed: ${error.message}.`)
      setIsAiScanning(false)
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleAiScan = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) processFile(file)
  }

  const handleInlineAccountCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    setError(null)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error("Authentication error")

      const { data, error: insertError } = await supabase.from('accounts').insert([{
        owner_id: user.id,
        name: newAccName,
        type: newAccType
      }]).select().single()

      if (insertError) throw insertError
      
      await fetchAccounts()
      
      if (type === 'expense' || type === 'transfer') setSelectedAccount(data.id)
      if (type === 'income') setSelectedAccount(data.id)
      
      setIsCreatingAccount(false)
      setNewAccName('')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    setError(null)

    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser()
      if (authError || !user) throw new Error('Not authenticated')

      const parsedAmount = parseFloat(amount)

      // FIX: OVERDRAFT PREVENTION LOGIC
      const sourceAcc = accounts.find(a => a.id === selectedAccount)
      if ((type === 'expense' || type === 'transfer') && sourceAcc) {
        if (sourceAcc.type !== 'credit_card' && sourceAcc.type !== 'credit' && parsedAmount > sourceAcc.balance) {
          throw new Error(`OVERDRAFT BLOCKED: ${sourceAcc.name} only has ₹${sourceAcc.balance.toLocaleString('en-IN')}.`)
        }
      }

      let finalContactId = null
      let finalProfileId = null

      if (selectedEntity) {
        if (selectedEntity.type === 'profile') finalProfileId = selectedEntity.id
        if (selectedEntity.type === 'contact') finalContactId = selectedEntity.id
      } else if (newShadowName) {
        const { data: newContact, error: insertError } = await supabase
          .from('contacts')
          .insert({ owner_id: user.id, name: newShadowName })
          .select('id').single()
        if (insertError) throw insertError
        finalContactId = newContact.id
      }

      const isCreditCardSource = sourceAcc?.type === 'credit_card' || sourceAcc?.type === 'credit'
      const appliedFee = (type === 'transfer' && isCreditCardSource) ? parseFloat(feeAmount || '0') : 0

      const payload: any = {
        owner_id: user.id,
        initiator_profile_id: user.id,
        amount: parsedAmount,
        fee_amount: appliedFee,
        description,
        status: 'COMPLETED',
        tagged_profile_id: finalProfileId,
        contact_id: finalContactId
      }

      if (type === 'expense') payload.from_account_id = selectedAccount
      if (type === 'income') payload.to_account_id = selectedAccount
      if (type === 'transfer') {
        payload.from_account_id = selectedAccount
        payload.to_account_id = targetAccount
      }

      const { error: txError } = await supabase.from('transactions').insert(payload)
      if (txError) throw txError

      handleClose()
      if (window.location.pathname === '/') window.location.reload()

    } catch (err: any) {
      setError(err.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  if (!isOpen) return null

  const selectedAccountObj = accounts.find(a => a.id === selectedAccount)
  const isCreditCardSource = selectedAccountObj?.type === 'credit_card' || selectedAccountObj?.type === 'credit'
  const showFeeInput = type === 'transfer' && isCreditCardSource

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-in fade-in duration-200">
      <div className="w-full max-w-md p-6 rounded-3xl backdrop-blur-2xl bg-white/10 border border-white/20 shadow-2xl relative animate-in zoom-in-95 duration-200 text-white max-h-[90vh] overflow-y-auto">
        
        <button onClick={handleClose} className="absolute top-4 right-4 p-2 text-white/60 hover:text-white rounded-full hover:bg-white/10 transition-colors z-10">
          <X className="w-5 h-5" />
        </button>

        <h2 className="text-xl font-bold mb-6 text-center">
          {isCreatingAccount ? 'Create New Account' : 'New Transaction'}
        </h2>

        {error && (
          <div className="mb-6 p-4 bg-rose-500/10 border border-rose-500/20 rounded-xl flex items-start text-sm text-rose-400">
            <AlertCircle className="w-5 h-5 mr-3 flex-shrink-0" />
            <span className="font-bold">{error}</span>
          </div>
        )}

        {isCreatingAccount ? (
          /* INLINE ACCOUNT CREATION FORM */
          <form onSubmit={handleInlineAccountCreate} className="space-y-4 animate-in slide-in-from-right-4">
            <div>
              <label className="text-xs font-semibold text-slate-400 uppercase">Account Name</label>
              <input type="text" required value={newAccName} onChange={e => setNewAccName(e.target.value)} placeholder="e.g., HDFC Salary" className="w-full mt-1 bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-indigo-500/50" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-400 uppercase">Account Type</label>
              <select value={newAccType} onChange={e => setNewAccType(e.target.value)} className="w-full mt-1 bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-indigo-500/50 appearance-none">
                <option value="bank" className="text-slate-900">Bank Account</option>
                <option value="wallet" className="text-slate-900">Digital Wallet</option>
                <option value="cash" className="text-slate-900">Physical Cash</option>
                <option value="credit" className="text-slate-900">Credit Card</option>
              </select>
            </div>
            <div className="flex gap-3 mt-6">
              <button type="button" onClick={() => {
                setIsCreatingAccount(false)
                setSelectedAccount(accounts[0]?.id || '')
              }} className="flex-1 py-3 bg-white/5 hover:bg-white/10 text-white rounded-xl font-bold transition-colors">Back</button>
              <button type="submit" disabled={isSubmitting} className="flex-1 flex justify-center py-3 bg-indigo-500 hover:bg-indigo-600 text-white rounded-xl font-bold transition-all shadow-[0_0_15px_rgba(99,102,241,0.3)] disabled:opacity-50">
                {isSubmitting ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Save Account'}
              </button>
            </div>
          </form>
        ) : (
          /* MAIN TRANSACTION FORM */
          <>
            <div className="mb-6 flex justify-center">
              <input type="file" accept="image/*" capture="environment" className="hidden" ref={fileInputRef} onChange={handleAiScan} />
              <button type="button" onClick={() => fileInputRef.current?.click()} disabled={isAiScanning} className="flex items-center px-4 py-2 bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 rounded-xl text-sm font-bold hover:bg-indigo-500/30 transition-all disabled:opacity-50">
                {isAiScanning ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Analyzing...</> : <><Camera className="w-4 h-4 mr-2" /> Auto-fill with AI <Sparkles className="w-4 h-4 ml-2 text-indigo-400" /></>}
              </button>
            </div>

            <form onSubmit={handleSubmit} className="flex flex-col space-y-5">
              
              <div className="flex p-1 bg-black/20 rounded-xl backdrop-blur-sm border border-white/10">
                {(['expense', 'income', 'transfer'] as const).map((t) => (
                  <button
                    key={t} type="button" onClick={() => setType(t)}
                    className={`flex-1 py-2 flex items-center justify-center space-x-1 text-sm font-medium rounded-lg capitalize transition-all duration-200 ${type === t ? 'bg-white/20 text-white shadow-sm' : 'text-white/50 hover:text-white/80'}`}
                  >
                    {t === 'expense' && <ArrowDownRight className={`w-4 h-4 ${type === t ? 'text-rose-400' : ''}`} />}
                    {t === 'income' && <ArrowUpRight className={`w-4 h-4 ${type === t ? 'text-emerald-400' : ''}`} />}
                    {t === 'transfer' && <ArrowRightLeft className={`w-4 h-4 ${type === t ? 'text-indigo-400' : ''}`} />}
                    <span>{t}</span>
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-1 gap-4">
                <div className="flex flex-col items-center justify-center space-y-1 py-2 bg-black/10 rounded-2xl border border-white/5">
                  <span className="text-white/50 text-sm font-medium uppercase tracking-wider">Amount</span>
                  <div className="flex items-center justify-center text-4xl md:text-5xl font-black">
                    <IndianRupee className="w-8 h-8 md:w-10 md:h-10 text-white/50 mr-1" />
                    <input type="number" step="0.01" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} className={`bg-transparent border-none outline-none text-center w-full max-w-[200px] placeholder:text-white/20 appearance-none ${type === 'income' ? 'text-emerald-400' : type === 'expense' ? 'text-rose-400' : 'text-white'}`} required disabled={isSubmitting} />
                  </div>
                </div>

                {showFeeInput && (
                  <div className="flex flex-col items-center justify-center space-y-1 py-3 bg-rose-500/10 rounded-2xl border border-rose-500/20 animate-in slide-in-from-top-2">
                    <span className="text-rose-400/80 text-xs font-semibold uppercase tracking-wider">Gateway Processing Fee (₹)</span>
                    <div className="flex items-center justify-center text-2xl font-black">
                      <input type="number" step="0.01" placeholder="0.00" value={feeAmount} onChange={(e) => setFeeAmount(e.target.value)} className="bg-transparent border-none outline-none text-center w-full max-w-[150px] text-rose-400 placeholder:text-rose-400/30 appearance-none" disabled={isSubmitting} />
                    </div>
                  </div>
                )}
              </div>

              <div className="flex flex-col space-y-1">
                <label className="text-xs font-semibold tracking-wide text-white/50 uppercase">Description</label>
                <input type="text" placeholder="e.g., Rent Payment, Groceries" value={description} onChange={(e) => setDescription(e.target.value)} className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-white/20 outline-none focus:border-indigo-500/50 transition-colors" required disabled={isSubmitting} />
              </div>

              <div className="flex space-x-3">
                <div className="flex-1 flex flex-col space-y-1">
                  <label className="text-xs font-semibold tracking-wide text-white/50 uppercase">{type === 'income' ? 'To Account' : 'From Account'}</label>
                  <select value={selectedAccount} onChange={(e) => {
                    if (e.target.value === 'NEW') setIsCreatingAccount(true)
                    else setSelectedAccount(e.target.value)
                  }} className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-indigo-500/50 transition-colors appearance-none" required disabled={isSubmitting}>
                    {accounts.map(acc => <option key={acc.id} value={acc.id} className="text-slate-900">{acc.name} (₹{acc.balance.toLocaleString('en-IN')})</option>)}
                    <option value="NEW" className="font-bold text-indigo-400">+ Create New Account</option>
                  </select>
                </div>
                {type === 'transfer' && (
                  <div className="flex-1 flex flex-col space-y-1">
                    <label className="text-xs font-semibold tracking-wide text-white/50 uppercase">To Account</label>
                    <select value={targetAccount} onChange={(e) => {
                      if (e.target.value === 'NEW') setIsCreatingAccount(true)
                      else setTargetAccount(e.target.value)
                    }} className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-indigo-500/50 transition-colors appearance-none" required disabled={isSubmitting}>
                      {accounts.map(acc => <option key={acc.id} value={acc.id} className="text-slate-900">{acc.name} (₹{acc.balance.toLocaleString('en-IN')})</option>)}
                      <option value="NEW" className="font-bold text-indigo-400">+ Create New Account</option>
                    </select>
                  </div>
                )}
              </div>

              <div className="flex flex-col space-y-1 relative">
                <label className="text-xs font-semibold tracking-wide text-white/50 uppercase">Tag Contact (Optional)</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Search className="h-4 w-4 text-white/40" />
                  </div>
                  <input
                    type="text"
                    placeholder="Search or add contact..."
                    value={selectedEntity ? selectedEntity.name : (newShadowName || searchQuery)}
                    onChange={(e) => {
                      setSelectedEntity(null)
                      setNewShadowName('')
                      setSearchQuery(e.target.value)
                    }}
                    onFocus={() => setIsFocused(true)}
                    onBlur={() => setTimeout(() => setIsFocused(false), 200)}
                    className="w-full bg-black/20 border border-white/10 rounded-xl pl-10 pr-10 py-3 text-white placeholder:text-white/20 outline-none focus:border-indigo-500/50 focus:bg-black/40 transition-colors"
                    disabled={isSubmitting}
                  />
                  {(selectedEntity || newShadowName) && (
                    <button type="button" onClick={() => { setSelectedEntity(null); setNewShadowName(''); setSearchQuery(''); }} className="absolute inset-y-0 right-0 pr-3 flex items-center text-white/40 hover:text-white transition-colors">
                      <X className="h-4 w-4" />
                    </button>
                  )}
                  {isSearching && <div className="absolute inset-y-0 right-0 pr-3 flex items-center"><Loader2 className="h-4 w-4 text-white/40 animate-spin" /></div>}
                </div>

                {isFocused && !searchQuery && !selectedEntity && !newShadowName && myContacts.length > 0 && (
                  <div className="absolute top-[105%] left-0 right-0 bg-slate-900 border border-white/10 rounded-xl overflow-hidden shadow-2xl z-50 animate-in fade-in slide-in-from-top-2 max-h-48 overflow-y-auto">
                    <div className="px-4 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wider bg-black/40 border-b border-white/5">Your Contacts</div>
                    {myContacts.map(contact => (
                      <button key={contact.id} type="button" onClick={() => { setSelectedEntity(contact); setIsFocused(false); }} className="w-full flex items-center px-4 py-3 hover:bg-white/10 transition-colors border-b border-white/5 last:border-0">
                        <div className="bg-emerald-500/20 p-2 rounded-full mr-3"><Users className="w-4 h-4 text-emerald-400" /></div>
                        <div className="text-left flex-1">
                          <p className="text-sm font-medium text-white">{contact.name}</p>
                          <p className="text-xs text-emerald-400/70">{contact.subtitle}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                {searchQuery && !selectedEntity && !newShadowName && (
                  <div className="absolute top-[105%] left-0 right-0 bg-slate-900 border border-white/10 rounded-xl overflow-hidden shadow-2xl z-50 animate-in fade-in slide-in-from-top-2 max-h-48 overflow-y-auto">
                    {searchResults.map(entity => (
                      <button key={entity.id} type="button" onClick={() => { setSelectedEntity(entity); setSearchQuery(''); setIsFocused(false); }} className="w-full flex items-center px-4 py-3 hover:bg-white/10 transition-colors border-b border-white/5 last:border-0">
                        <div className={`p-2 rounded-full mr-3 ${entity.type === 'contact' ? 'bg-emerald-500/20' : 'bg-indigo-500/20'}`}>
                          {entity.type === 'contact' ? <Users className="w-4 h-4 text-emerald-400" /> : <User className="w-4 h-4 text-indigo-400" />}
                        </div>
                        <div className="text-left flex-1">
                          <p className="text-sm font-medium text-white">{entity.name}</p>
                          <p className={`text-xs ${entity.type === 'contact' ? 'text-emerald-400/70' : 'text-indigo-400/70'}`}>{entity.subtitle}</p>
                        </div>
                      </button>
                    ))}
                    {!searchResults.find(r => r.name.toLowerCase() === searchQuery.toLowerCase()) && (
                      <button type="button" onClick={() => { setNewShadowName(searchQuery); setSearchQuery(''); setSearchResults([]); setIsFocused(false); }} className="w-full flex items-center px-4 py-3 hover:bg-white/10 transition-colors">
                        <div className="bg-white/10 p-2 rounded-full mr-3"><UserPlus className="w-4 h-4 text-white/60" /></div>
                        <div className="text-left flex-1">
                          <p className="text-sm font-medium text-white">Create Shadow Contact</p>
                          <p className="text-xs text-white/50">"{searchQuery}" (Local tracking only)</p>
                        </div>
                      </button>
                    )}
                  </div>
                )}
              </div>

              <button type="submit" disabled={isSubmitting} className="w-full flex items-center justify-center py-4 mt-2 rounded-xl bg-white text-slate-900 font-bold text-lg hover:bg-slate-200 transition-all shadow-[0_0_20px_rgba(255,255,255,0.1)] hover:shadow-[0_0_25px_rgba(255,255,255,0.2)] disabled:opacity-50">
                {isSubmitting ? <Loader2 className="w-6 h-6 animate-spin" /> : 'Log Transaction'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}

import React, { useState, useEffect, useRef } from 'react'
import { X, ArrowDownRight, ArrowUpRight, ArrowRightLeft, Loader2, IndianRupee, Camera, Search, User, Users, UserPlus, AlertCircle } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { localDB, type CachedAccount, type LocalTransaction } from '../lib/db'
import { postQueuedTransaction } from '../lib/sync'
import { indiaDateInputToIso, isDateBeforeOpeningDate, openingBalanceForAccountType, toIndiaDateInputValue } from '../lib/financeDate'

interface TransactionModalProps {
  isOpen: boolean
  onClose: () => void
  initialFile?: File | null
}

type Account = CachedAccount

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
  const [transactionDate, setTransactionDate] = useState(() => toIndiaDateInputValue())
  const [accounts, setAccounts] = useState<Account[]>([])
  const [selectedAccount, setSelectedAccount] = useState('')
  const [targetAccount, setTargetAccount] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isAiScanning, setIsAiScanning] = useState(false)
  const [geminiKeyConfigured, setGeminiKeyConfigured] = useState<boolean | null>(null)
  const [showGeminiKeyPrompt, setShowGeminiKeyPrompt] = useState(false)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  
  // AI State

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
  const [newAccOpeningBalance, setNewAccOpeningBalance] = useState('0')
  const [newAccOpeningDate, setNewAccOpeningDate] = useState(() => toIndiaDateInputValue())

  useEffect(() => {
    if (isOpen) {
      setAccounts([])
      setSelectedAccount('')
      setTargetAccount('')
      setTransactionDate(toIndiaDateInputValue())
      setNewAccName('')
      setNewAccType('bank')
      setNewAccOpeningBalance('0')
      setNewAccOpeningDate(toIndiaDateInputValue())
      setMyContacts([])
      setCurrentUserId(null)
      fetchAccounts()
      void supabase.functions.invoke('manage-gemini-key', { body: { action: 'status' } })
        .then(({ data, error }) => setGeminiKeyConfigured(!error && data?.configured === true))
        .catch(() => setGeminiKeyConfigured(false))
      setError(null)
      setIsCreatingAccount(false)
      void loadContacts()
    }
  }, [isOpen])

  const loadContacts = async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user) return
    const ownerId = session.user.id
    setCurrentUserId(ownerId)
    try {
      if (!navigator.onLine) throw new Error('Offline')
      const { data, error } = await supabase.from('contacts').select('id, name')
        .eq('owner_id', ownerId).order('name')
      if (error) throw error
      const contacts = data || []
      await localDB.contactCache.put({ owner_id: ownerId, contacts })
      setMyContacts(contacts.slice(0, 10).map(c => ({ id: c.id, name: c.name, subtitle: 'Shadow Contact', type: 'contact' })))
    } catch {
      const cached = await localDB.contactCache.get(ownerId)
      setMyContacts((cached?.contacts || []).slice(0, 10).map(c => ({ id: c.id, name: c.name, subtitle: 'Shadow Contact', type: 'contact' })))
    }
  }

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
        if (!navigator.onLine) {
          const cached = currentUserId ? await localDB.contactCache.get(currentUserId) : null
          setSearchResults((cached?.contacts || [])
            .filter(c => c.name.toLocaleLowerCase().includes(searchQuery.toLocaleLowerCase()))
            .slice(0, 3)
            .map(c => ({ id: c.id, name: c.name, subtitle: 'Shadow Contact', type: 'contact' })))
          return
        }
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

  // Load owner-scoped accounts and current balances for display.
  const fetchAccounts = async () => {
    const { data: { session } } = await supabase.auth.getSession()
    const ownerId = session?.user.id
    if (!ownerId) return
    try {
      if (!navigator.onLine) throw new Error('Offline')
      const [accResult, balResult] = await Promise.all([
        supabase.from('accounts').select('id, name, type, opening_date').eq('owner_id', ownerId).order('name'),
        supabase.from('account_balances').select('id, balance')
      ])
      if (accResult.error) throw accResult.error
      if (balResult.error) throw balResult.error
      const merged: Account[] = (accResult.data || []).map(acc => {
        const matched = balResult.data?.find(b => b.id === acc.id)
        return { ...acc, balance: matched ? Number(matched.balance) : 0 }
      })
      await localDB.accountCache.put({ owner_id: ownerId, accounts: merged })
      setAccounts(merged)
      if (merged.length > 0 && !merged.some(a => a.id === selectedAccount)) {
        setSelectedAccount(merged[0].id)
        setTargetAccount(merged.length > 1 ? merged[1].id : merged[0].id)
      }
    } catch {
      const cached = await localDB.accountCache.get(ownerId)
      if (!cached) {
        setError('Account choices are unavailable offline. Connect once to save them on this device.')
        return
      }
      setAccounts(cached.accounts)
      if (cached.accounts.length > 0 && !cached.accounts.some(a => a.id === selectedAccount)) {
        setSelectedAccount(cached.accounts[0].id)
        setTargetAccount(cached.accounts.length > 1 ? cached.accounts[1].id : cached.accounts[0].id)
      }
    }
  }

  const handleClose = (discard = false) => {
    if (!discard && (amount || feeAmount || description || searchQuery || isCreatingAccount || newAccName || newAccOpeningBalance !== '0' || newAccOpeningDate !== toIndiaDateInputValue() || transactionDate !== toIndiaDateInputValue()) &&
        !window.confirm('You have unsaved transaction details. Discard them and close?')) return
    setType('expense')
    setAmount('')
    setFeeAmount('')
    setDescription('')
    setTransactionDate(toIndiaDateInputValue())
    setNewAccName('')
    setNewAccType('bank')
    setNewAccOpeningBalance('0')
    setNewAccOpeningDate(toIndiaDateInputValue())
    setSearchQuery('')
    setSearchResults([])
    setSelectedEntity(null)
    setNewShadowName('')
    setError(null)
    setIsCreatingAccount(false)
    onClose()
  }

  const processFile = async (file: File) => {
    setError(null)
    if (!navigator.onLine) {
      setError('Connect to the internet to scan a receipt.')
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }

    const supportedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
    if (!supportedTypes.includes(file.type)) {
      setError('Choose a JPEG, PNG, WebP, HEIC, or HEIF receipt image.')
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }
    if (file.size === 0 || file.size > 8 * 1024 * 1024) {
      setError('Choose a receipt image smaller than 8 MB.')
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }

    setIsAiScanning(true)
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      let binary = ''
      for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
      }
      const { data, error: scanError } = await supabase.functions.invoke('scan-receipt', {
        body: { mimeType: file.type, imageBase64: btoa(binary) },
      })
      if (scanError) {
        let message = 'Receipt scanning failed. Please try again.'
        try {
          const response = scanError.context as Response
          const body = await response?.json()
          if (typeof body?.error === 'string') message = body.error
        } catch {
          // Keep the generic message if the function returned no readable error body.
        }
        throw new Error(message)
      }
      if (!data || typeof data.amount !== 'number' || !Number.isFinite(data.amount) || data.amount <= 0 ||
          typeof data.description !== 'string' || !['expense', 'income'].includes(data.type)) {
        throw new Error('The receipt total could not be read. Enter it manually or try a clearer image.')
      }

      setAmount(String(Math.round(data.amount * 100) / 100))
      setDescription(data.description)
      setType(data.type)
    } catch (scanError: any) {
      setError(scanError?.message || 'Receipt scanning failed. Please try again.')
    } finally {
      setIsAiScanning(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  useEffect(() => {
    if (!isOpen || !(amount || feeAmount || description || searchQuery || isCreatingAccount || newAccName || newAccOpeningBalance !== '0' || newAccOpeningDate !== toIndiaDateInputValue() || transactionDate !== toIndiaDateInputValue())) return
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warnBeforeUnload)
    return () => window.removeEventListener('beforeunload', warnBeforeUnload)
  }, [isOpen, amount, feeAmount, description, searchQuery, isCreatingAccount, newAccName, newAccOpeningBalance, newAccOpeningDate, transactionDate])

  useEffect(() => {
    if (!isOpen) return
    const closeOnBack = (event: Event) => {
      if (amount || feeAmount || description || searchQuery || isCreatingAccount || transactionDate !== toIndiaDateInputValue()) {
        if (!window.confirm('You have unsaved transaction details. Discard them and close?')) {
          event.preventDefault()
          return
        }
      }
      handleClose(true)
    }
    window.addEventListener('rr:modal-back', closeOnBack)
    return () => window.removeEventListener('rr:modal-back', closeOnBack)
  }, [isOpen, amount, feeAmount, description, searchQuery, isCreatingAccount, newAccName, newAccOpeningBalance, newAccOpeningDate, transactionDate])

  const openReceiptScanner = () => {
    if (geminiKeyConfigured !== true) {
      setShowGeminiKeyPrompt(true)
      return
    }
    fileInputRef.current?.click()
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
        type: newAccType,
        opening_balance: openingBalanceForAccountType(newAccOpeningBalance, newAccType),
        opening_date: newAccOpeningDate
      }]).select().single()

      if (insertError) throw insertError
      
      await fetchAccounts()
      
      if (type === 'expense' || type === 'transfer') setSelectedAccount(data.id)
      if (type === 'income') setSelectedAccount(data.id)
      
      setIsCreatingAccount(false)
      setNewAccName('')
      setNewAccType('bank')
      setNewAccOpeningBalance('0')
      setNewAccOpeningDate(toIndiaDateInputValue())
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
      const { data: { session }, error: authError } = await supabase.auth.getSession()
      if (authError || !session?.user) throw new Error('Not authenticated')

      const parsedAmount = parseFloat(amount)
      if (!Number.isFinite(parsedAmount) || parsedAmount <= 0 ||
          parsedAmount !== Math.round(parsedAmount * 100) / 100) {
        throw new Error('Enter a positive amount with at most two decimal places.')
      }

      const sourceAcc = accounts.find(a => a.id === selectedAccount)

      let finalContactId: string | null = null
      let finalProfileId: string | null = null

      if (selectedEntity) {
        if (selectedEntity.type === 'profile') finalProfileId = selectedEntity.id
        if (selectedEntity.type === 'contact') finalContactId = selectedEntity.id
      }

      const isCreditCardSource = sourceAcc?.type === 'credit_card' || sourceAcc?.type === 'credit'
      const appliedFee = (type === 'transfer' && isCreditCardSource) ? parseFloat(feeAmount || '0') : 0
      if (!Number.isFinite(appliedFee) || appliedFee < 0 ||
          appliedFee !== Math.round(appliedFee * 100) / 100) {
        throw new Error('Enter a valid fee with at most two decimal places.')
      }
      if (!sourceAcc) throw new Error('Choose an account before posting.')
      if (isDateBeforeOpeningDate(transactionDate, sourceAcc.opening_date)) {
        throw new Error(sourceAcc.name + ' started on ' + sourceAcc.opening_date + '; choose that date or later.')
      }
      if (type === 'transfer') {
        const destinationAccount = accounts.find(account => account.id === targetAccount)
        if (!destinationAccount) throw new Error('Choose a destination account before posting.')
        if (isDateBeforeOpeningDate(transactionDate, destinationAccount.opening_date)) {
          throw new Error(destinationAccount.name + ' started on ' + destinationAccount.opening_date + '; choose that date or later.')
        }
      }
      if (type === 'transfer' && selectedAccount === targetAccount) {
        throw new Error('Choose two different accounts for a transfer.')
      }

      const queued: LocalTransaction = {
        request_id: crypto.randomUUID(),
        owner_id: session.user.id,
        from_account_id: type === 'income' ? null : selectedAccount,
        to_account_id: type === 'expense' ? null : (type === 'income' ? selectedAccount : targetAccount),
        amount: parsedAmount,
        fee_amount: appliedFee,
        description,
        sync_status: 'pending',
        created_at: indiaDateInputToIso(transactionDate),
        tagged_profile_id: finalProfileId,
        contact_id: finalContactId,
        new_contact_name: newShadowName.trim() || null
      }
      const localId = await localDB.outbox.add(queued)
      if (navigator.onLine) {
        let rpcResult: Awaited<ReturnType<typeof postQueuedTransaction>>
        try {
          rpcResult = await postQueuedTransaction(queued)
        } catch {
          alert('Transaction saved on this device. It will retry when the connection is available.')
          handleClose(true)
          return
        }
        if (rpcResult.error) {
          // A database rejection cannot have committed. Keep the form open
          // for correction; ambiguous network failures remain in the outbox.
          if (/^(22|23|42501|PGRST2)/.test(rpcResult.error.code || '')) {
            await localDB.outbox.delete(localId)
            throw new Error(rpcResult.error.message)
          }
          alert('Transaction saved on this device. It will retry when the connection is available.')
          handleClose(true)
          return
        }
        await localDB.outbox.delete(localId)
      } else {
        alert('Transaction saved on this device. It will sync when you reconnect.')
      }

      handleClose(true)
      if (navigator.onLine && window.location.pathname === '/') window.location.reload()

    } catch (err: any) {
      const message = typeof err?.message === 'string' ? err.message : 'Could not save this transaction.'
      setError(message.includes('Transaction would make liquid account history negative')
        ? 'This transaction would take the account below zero on that date. Check the opening balance and earlier entries.'
        : message)
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
        
        <button onClick={() => handleClose()} className="absolute top-4 right-4 p-2 text-white/60 hover:text-white rounded-full hover:bg-white/10 transition-colors z-10">
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
            <div>
              <label className="text-xs font-semibold text-slate-400 uppercase">{newAccType === 'credit' ? 'Outstanding balance' : 'Starting balance'}</label>
              <input type="number" min="0" max="9999999999.99" step="0.01" required value={newAccOpeningBalance} onChange={event => setNewAccOpeningBalance(event.target.value)} className="w-full mt-1 bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-indigo-500/50" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-400 uppercase">Start tracking from</label>
              <input type="date" max={toIndiaDateInputValue()} required value={newAccOpeningDate} onChange={event => setNewAccOpeningDate(event.target.value)} className="w-full mt-1 color-scheme-dark bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-indigo-500/50" />
              <p className="mt-1 text-[11px] text-slate-500">Earlier ledger entries will be blocked for this account.</p>
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
            <form onSubmit={handleSubmit} className="flex flex-col space-y-4">
              
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
              </div>

              <div className="flex flex-col space-y-1">
                <label htmlFor="transaction-occurrence-date" className="text-xs font-semibold tracking-wide text-white/50 uppercase">Occurrence date</label>
                <input id="transaction-occurrence-date" type="date" value={transactionDate} onChange={event => setTransactionDate(event.target.value)} required disabled={isSubmitting} className="w-full color-scheme-dark bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-indigo-500/50" />
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

              <details className="rounded-xl border border-white/10 bg-black/10 p-3">
                <summary className="cursor-pointer select-none text-sm font-semibold text-indigo-300">Advanced options</summary>
                <div className="mt-4 space-y-4">
                  <div className="flex flex-col items-center gap-2">
                    <input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" capture="environment" className="hidden" ref={fileInputRef} onChange={e => { const file = e.target.files?.[0]; if (file) void processFile(file) }} />
                    <button type="button" onClick={openReceiptScanner} disabled={isAiScanning || isSubmitting || geminiKeyConfigured === null} className="flex items-center px-4 py-2 bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 rounded-xl text-sm font-bold hover:bg-indigo-500/30 transition-all disabled:opacity-50">
                      {isAiScanning ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Scanning receipt...</> : <><Camera className="w-4 h-4 mr-2" /> Scan receipt</>}
                    </button>
                    {showGeminiKeyPrompt && <div role="dialog" aria-modal="true" className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-5"><div className="max-w-sm rounded-2xl border border-white/15 bg-slate-900 p-5 text-white shadow-2xl"><h3 className="text-lg font-bold">Add your Gemini API key</h3><p className="mt-2 text-sm text-slate-300">Receipt scanning uses your personal Gemini key. Add it in Settings before selecting a receipt; your image is sent only when you start a scan.</p><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setShowGeminiKeyPrompt(false)} className="rounded-xl px-4 py-2 text-sm text-slate-300 hover:bg-white/10">Later</button><button type="button" onClick={() => { setShowGeminiKeyPrompt(false); handleClose(true); window.location.assign('/settings') }} className="rounded-xl bg-indigo-500 px-4 py-2 text-sm font-semibold">Open Settings</button></div></div></div>}
                    <p className="text-xs text-white/45 text-center">Receipt images are sent to Google Gemini. Review the fields before saving.</p>
                  </div>
                  {showFeeInput && (
                    <div className="flex flex-col items-center justify-center space-y-1 py-3 bg-rose-500/10 rounded-2xl border border-rose-500/20">
                      <label htmlFor="transaction-fee" className="text-rose-400/80 text-xs font-semibold uppercase tracking-wider">Gateway processing fee (₹)</label>
                      <div className="flex items-center justify-center text-2xl font-black">
                        <input id="transaction-fee" type="number" min="0" step="0.01" placeholder="0.00" value={feeAmount} onChange={(e) => setFeeAmount(e.target.value)} className="bg-transparent border-none outline-none text-center w-full max-w-[150px] text-rose-400 placeholder:text-rose-400/30 appearance-none" disabled={isSubmitting} />
                      </div>
                    </div>
                  )}
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

                </div>
              </details>

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

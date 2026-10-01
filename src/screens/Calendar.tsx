import React, { useState, useEffect, useRef } from 'react'
import { Calendar as CalendarIcon, Plus, ChevronLeft, ChevronRight, IndianRupee, Loader2, CalendarDays, X, Wallet, Trash2, Search, Users, User, UserPlus, ArrowUpRight, ArrowRightLeft, History } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useModalBack } from '../lib/useModalBack'
import { format, differenceInMonths } from 'date-fns'
import { DayPicker } from 'react-day-picker'
import 'react-day-picker/dist/style.css'

interface EMI {
  id: string
  name: string
  amount: number
  start_date: string
  end_date: string | null
  account_id: string | null
  initiator_account_id: string | null
  status: string
  type: string
  owner_id: string
  counterparty_profile_id: string | null
  related_obligation_id: string | null
  owner_months_paid: number
  counterparty_months_paid: number
}

interface SearchEntity {
  id: string
  name: string
  subtitle: string
  type: 'profile' | 'contact'
}

export default function Calendar() {
  const [emis, setEmis] = useState<EMI[]>([])
  const [accounts, setAccounts] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  
  const [currentDate, setCurrentDate] = useState(new Date())
  const [selectedDay, setSelectedDay] = useState(() => new Date().getDate())
  
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [payEmiData, setPayEmiData] = useState<{emi: EMI, role: 'p2p' | 'bank', currentMonth: number} | null>(null)
  const bankPaymentRequestId = useRef<string | null>(null)
  const peerPaymentRequestId = useRef<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  
  const [emiType, setEmiType] = useState<'personal' | 'lent' | 'borrowed'>('personal')
  const [newEmi, setNewEmi] = useState({ name: '', amount: '', account_id: '' })
  const [principal, setPrincipal] = useState('')
  const [processingFee, setProcessingFee] = useState('')
  const [startDate, setStartDate] = useState<Date | undefined>(new Date())
  const [endDate, setEndDate] = useState<Date | undefined>()
  const [payAccountId, setPayAccountId] = useState('')
  const [payDate, setPayDate] = useState(new Date().toISOString().split('T')[0])

  const [searchQuery, setSearchQuery] = useState('')
  const [isSearching, setIsSearching] = useState(false)
  const [isFocused, setIsFocused] = useState(false)
  const [searchResults, setSearchResults] = useState<SearchEntity[]>([])
  const [myContacts, setMyContacts] = useState<SearchEntity[]>([])
  const [selectedEntity, setSelectedEntity] = useState<SearchEntity | null>(null)
  const [newShadowName, setNewShadowName] = useState('')
  
  const [isStartPopoverOpen, setIsStartPopoverOpen] = useState(false)
  const [isEndPopoverOpen, setIsEndPopoverOpen] = useState(false)
  const popoverRef = useRef<HTMLDivElement>(null)
  const emiFormDirty = Boolean(newEmi.name || newEmi.amount || principal || processingFee || selectedEntity || newShadowName)
  useModalBack(isAddModalOpen, () => setIsAddModalOpen(false), emiFormDirty, 'Discard this recurring payment form?')
  useModalBack(!!payEmiData, () => setPayEmiData(null), Boolean(payAccountId || payDate !== new Date().toISOString().split('T')[0]), 'Discard this payment form?')

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        setIsStartPopoverOpen(false)
        setIsEndPopoverOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  const fetchEngineData = async () => {
    setIsLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      setCurrentUserId(user.id)

      const { data: accData } = await supabase.from('accounts').select('id, name').order('name')
      if (accData) {
        setAccounts(accData)
        if (accData.length > 0 && !newEmi.account_id) setNewEmi(prev => ({ ...prev, account_id: accData[0].id }))
      }

      const { data: contacts } = await supabase.from('contacts').select('id, name').eq('owner_id', user.id).order('name').limit(10)
      if (contacts) setMyContacts(contacts.map(c => ({ id: c.id, name: c.name, subtitle: 'Shadow Contact', type: 'contact' })))

      const { data: emiData, error: emiError } = await supabase
        .from('recurring_emis')
        .select('*')
        .or(`owner_id.eq.${user.id},counterparty_profile_id.eq.${user.id}`)
        .order('start_date')

      if (emiError) throw emiError
      if (emiData) setEmis(emiData)
    } catch (error) { console.error(error) } finally { setIsLoading(false) }
  }

  useEffect(() => { fetchEngineData() }, [])

  useEffect(() => {
    if (!searchQuery.trim()) { setSearchResults([]); return }
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
      } catch (err) { console.error(err) } finally { setIsSearching(false) }
    }, 500)
    return () => clearTimeout(delayDebounceFn)
  }, [searchQuery, selectedEntity, newShadowName, currentUserId])

  const handleAddEMI = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!startDate) return alert("Start date is required.")
    if (!endDate) return alert("End date is strictly required to generate the EMI progress tracker.")
    setIsSubmitting(true)

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error("Not authenticated")

      if (emiType === 'personal') {
        const payload = {
          owner_id: user.id, type: 'personal', name: newEmi.name,
          amount: parseFloat(newEmi.amount), start_date: format(startDate, 'yyyy-MM-dd'), end_date: format(endDate, 'yyyy-MM-dd'),
          initiator_account_id: newEmi.account_id || null, status: 'ACTIVE', owner_months_paid: 0, counterparty_months_paid: 0
        }
        const { error } = await supabase.from('recurring_emis').insert(payload)
        if (error) throw error
      } else {
        let finalShadowContactId = null
        let finalProfileId = null

        if (selectedEntity) {
          if (selectedEntity.type === 'profile') finalProfileId = selectedEntity.id
          if (selectedEntity.type === 'contact') finalShadowContactId = selectedEntity.id
        } else if (newShadowName) {
          const { data: newContact } = await supabase.from('contacts').insert({ owner_id: user.id, name: newShadowName }).select('id').single()
          finalShadowContactId = newContact?.id
        }

        const { error: rpcError } = await supabase.rpc('propose_p2p_emi', {
          p_owner_id: user.id, p_counterparty_profile_id: finalProfileId, p_shadow_contact_id: finalShadowContactId,
          p_account_id: newEmi.account_id, p_type: emiType, p_name: newEmi.name,
          p_total_principal: parseFloat(principal || '0'), p_processing_fee: parseFloat(processingFee || '0'),
          p_monthly_amount: parseFloat(newEmi.amount), p_start_date: format(startDate, 'yyyy-MM-dd'), p_end_date: format(endDate, 'yyyy-MM-dd')
        })
        if (rpcError) throw rpcError
      }

      setIsAddModalOpen(false)
      setNewEmi({ name: '', amount: '', account_id: accounts[0]?.id || '' })
      setPrincipal(''); setProcessingFee(''); setStartDate(new Date()); setEndDate(undefined); setSelectedEntity(null); setNewShadowName(''); setSearchQuery('')
      fetchEngineData()
    } catch (error: any) { alert(error.message) } finally { setIsSubmitting(false) }
  }

  const handlePayInstallment = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!payEmiData || !payAccountId) return
    setIsSubmitting(true)

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error("Not authenticated")

      const secureDate = new Date(`${payDate}T12:00:00`).toISOString()
      const { emi, role, currentMonth } = payEmiData

      if (role === 'p2p' && emi.related_obligation_id) {
        peerPaymentRequestId.current ||= crypto.randomUUID()
        const { error: escrowError } = await supabase.rpc('request_settlement', {
          p_request_id: peerPaymentRequestId.current,
          p_obligation_id: emi.related_obligation_id,
          p_source_account_id: payAccountId,
          p_amount: Number(emi.amount),
          p_expected_month: currentMonth
        })
        if (escrowError) throw escrowError
        peerPaymentRequestId.current = null
        alert("Payment request sent to Escrow! Waiting for receiver to approve.")
      } else if (role === 'bank') {
        bankPaymentRequestId.current ||= crypto.randomUUID()
        const { error } = await supabase.rpc('pay_bank_emi', {
          p_request_id: bankPaymentRequestId.current,
          p_emi_id: emi.id,
          p_account_id: payAccountId,
          p_expected_month: currentMonth,
          p_created_at: secureDate
        })
        if (error) throw error
        bankPaymentRequestId.current = null
      } else {
        throw new Error('This peer payment has no linked debt. Refresh the EMI and check its setup before paying.')
      }

      setPayEmiData(null); setPayAccountId(''); setPayDate(new Date().toISOString().split('T')[0])
      fetchEngineData()
    } catch (err: any) { alert(err.message) } finally { setIsSubmitting(false) }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Cancel this recurring payment?')) return
    try {
      const { error } = await supabase.rpc('cancel_owned_emi', { p_emi_id: id })
      if (error) throw error
      fetchEngineData()
    } catch (err: any) {
      alert(`Unable to cancel this recurring payment: ${err.message}`)
    }
  }

  const daysInMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0).getDate()
  const firstDayOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1).getDay()
  const monthName = currentDate.toLocaleString('default', { month: 'long' })
  const year = currentDate.getFullYear()

  const prevMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1))
    setSelectedDay(1)
  }
  const nextMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1))
    setSelectedDay(1)
  }

  const getEmisOnDay = (day: number) => {
    const targetDate = new Date(year, currentDate.getMonth(), day)
    return emis.filter(emi => {
      if (emi.status !== 'ACTIVE') return false
      const dbStartDate = new Date(emi.start_date)
      if (dbStartDate.getDate() !== day) return false
      if (targetDate < new Date(dbStartDate.getFullYear(), dbStartDate.getMonth(), dbStartDate.getDate())) return false
      if (emi.end_date && targetDate > new Date(new Date(emi.end_date).getFullYear(), new Date(emi.end_date).getMonth(), new Date(emi.end_date).getDate())) return false
      return true
    })
  }

  const totalMonthlyObligation = emis.reduce((sum, emi) => {
    if (emi.status !== 'ACTIVE') return sum
    const viewDate = new Date(year, currentDate.getMonth(), 1)
    const emiStartMonth = new Date(new Date(emi.start_date).getFullYear(), new Date(emi.start_date).getMonth(), 1)
    if (viewDate < emiStartMonth) return sum
    if (emi.end_date && viewDate > new Date(new Date(emi.end_date).getFullYear(), new Date(emi.end_date).getMonth(), 1)) return sum
    return sum + Number(emi.amount)
  }, 0)

  return (
    <div className="p-4 sm:p-6 w-full max-w-6xl mx-auto text-white animate-in fade-in duration-300 pb-32 relative">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-8 gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold flex items-center">
            <CalendarIcon className="w-7 h-7 sm:w-8 sm:h-8 mr-2 sm:mr-3 text-indigo-400" /> Calendar & EMIs
          </h1>
          <p className="text-slate-400 mt-1">Track your recurring payments and P2P obligations</p>
        </div>
        <button onClick={() => setIsAddModalOpen(true)} className="flex items-center px-4 py-2 bg-indigo-500 hover:bg-indigo-400 text-white rounded-xl font-bold transition-all shadow-[0_0_15px_rgba(99,102,241,0.4)]">
          <Plus className="w-4 h-4 mr-2" /> Add Recurring
        </button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 text-indigo-500 animate-spin" /></div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          <div className="lg:col-span-2 bg-white/5 border border-white/10 rounded-2xl sm:rounded-3xl p-3 sm:p-6 backdrop-blur-md">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg sm:text-2xl font-bold text-slate-200">{monthName} {year}</h2>
              <div className="flex space-x-2">
                <button type="button" aria-label="Previous month" onClick={prevMonth} className="p-1.5 sm:p-2 bg-white/5 hover:bg-white/10 rounded-xl transition-colors border border-white/10"><ChevronLeft className="w-4 h-4 sm:w-5 sm:h-5" /></button>
                <button type="button" aria-label="Next month" onClick={nextMonth} className="p-1.5 sm:p-2 bg-white/5 hover:bg-white/10 rounded-xl transition-colors border border-white/10"><ChevronRight className="w-4 h-4 sm:w-5 sm:h-5" /></button>
              </div>
            </div>

            <p className="sm:hidden text-xs text-slate-500 mb-2">Tap a date to see its scheduled payments.</p>
            <div className="grid grid-cols-7 gap-1 sm:gap-2">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => <div key={day} className="text-center text-[9px] sm:text-xs font-bold text-slate-500 uppercase tracking-wider mb-1 sm:mb-2">{day}</div>)}
              {Array.from({ length: firstDayOfMonth }, (_, i) => i).map(pad => <div key={`pad-${pad}`} className="h-10 sm:h-24 rounded-lg sm:rounded-2xl bg-white/2 border border-white/5 opacity-50" />)}
              {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(day => {
                const dayEmis = getEmisOnDay(day)
                const isToday = day === new Date().getDate() && currentDate.getMonth() === new Date().getMonth() && currentDate.getFullYear() === new Date().getFullYear()
                const isSelected = selectedDay === day
                return (
                  <button key={day} type="button" aria-pressed={isSelected} aria-label={`${monthName} ${day}${dayEmis.length ? `, ${dayEmis.length} scheduled ${dayEmis.length === 1 ? 'payment' : 'payments'}` : ''}`} onClick={() => setSelectedDay(day)} className={`h-10 sm:h-24 min-w-0 rounded-lg sm:rounded-2xl p-1 sm:p-2 flex flex-col text-left transition-all border ${isSelected ? 'bg-indigo-500/20 border-indigo-400 ring-1 ring-indigo-400/50' : isToday ? 'bg-indigo-500/10 border-indigo-500/40' : 'bg-black/20 border-white/5 hover:bg-white/5'}`}>
                    <span className={`text-xs sm:text-sm font-bold ${isToday || isSelected ? 'text-indigo-400' : 'text-slate-400'} self-center sm:self-start`}>{day}</span>
                    {dayEmis.length > 0 && <span className="sm:hidden mt-0.5 mx-auto text-[8px] leading-3 font-bold text-rose-400">{dayEmis.length} due</span>}
                    <div className="hidden sm:flex flex-1 overflow-y-auto space-y-1 flex-col hide-scrollbar">
                      {dayEmis.map(emi => (
                        <div key={emi.id} className="text-[10px] leading-tight font-semibold bg-rose-500/20 text-rose-300 p-1 rounded-md border border-rose-500/30 truncate" title={`${emi.name}: ₹${emi.amount}`}>
                          {emi.name}
                        </div>
                      ))}
                    </div>
                  </button>
                )
              })}
            </div>
            <div className="sm:hidden mt-4 border-t border-white/10 pt-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-sm">{monthName} {selectedDay}</h3>
                <span className="text-xs text-slate-500">{getEmisOnDay(selectedDay).length} due</span>
              </div>
              {getEmisOnDay(selectedDay).length ? <div className="space-y-2">{getEmisOnDay(selectedDay).map(emi => (
                <div key={emi.id} className="flex items-center justify-between gap-3 rounded-xl bg-rose-500/10 border border-rose-500/20 px-3 py-2.5">
                  <span className="min-w-0 truncate text-sm font-medium">{emi.name}</span>
                  <span className="shrink-0 flex items-center text-sm font-bold text-rose-400"><IndianRupee className="w-3.5 h-3.5" />{Number(emi.amount).toLocaleString('en-IN')}</span>
                </div>
              ))}</div> : <p className="text-sm text-slate-500">No scheduled payments on this date.</p>}
            </div>
          </div>

          <div className="flex flex-col space-y-6">
            <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-3xl p-6 backdrop-blur-md">
              <h3 className="text-sm font-bold text-indigo-400 uppercase tracking-wider mb-1">Total {monthName} Outflow</h3>
              <div className="flex items-center text-3xl font-black text-white">
                <IndianRupee className="w-6 h-6 text-white/50 mr-1" />
                {totalMonthlyObligation.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </div>
            </div>

            <div className="bg-white/5 border border-white/10 rounded-3xl p-6 backdrop-blur-md flex-1">
              <div className="flex items-center mb-6 border-b border-white/10 pb-4">
                <div className="w-8 h-8 rounded-full bg-rose-500/20 flex items-center justify-center mr-3 border border-rose-500/20"><CalendarDays className="w-4 h-4 text-rose-400" /></div>
                <h2 className="text-lg font-bold text-slate-200">Active EMIs</h2>
              </div>
              
              <div className="space-y-4">
                {emis.filter(e => e.status === 'ACTIVE').map(emi => {
                  const day = new Date(emi.start_date).getDate()
                  const totalMonths = emi.end_date ? differenceInMonths(new Date(emi.end_date), new Date(emi.start_date)) + 1 : 1

                  // SMART PROGRESS LOGIC DECOUPLED
                  const isOwner = currentUserId === emi.owner_id
                  let myProgress = 0, theirProgress = 0, myRole: 'bank' | 'p2p' = 'bank', theirRole = ''
                  
                  if (emi.type === 'personal') {
                    myProgress = emi.owner_months_paid || 0
                  } else if (emi.type === 'lent') {
                    if (isOwner) { myProgress = emi.owner_months_paid || 0; theirProgress = emi.counterparty_months_paid || 0; myRole = 'bank'; theirRole = 'p2p' } 
                    else { myProgress = emi.counterparty_months_paid || 0; theirProgress = emi.owner_months_paid || 0; myRole = 'p2p'; theirRole = 'bank' }
                  } else if (emi.type === 'borrowed') {
                    if (isOwner) { myProgress = emi.owner_months_paid || 0; theirProgress = emi.counterparty_months_paid || 0; myRole = 'p2p'; theirRole = 'bank' } 
                    else { myProgress = emi.counterparty_months_paid || 0; theirProgress = emi.owner_months_paid || 0; myRole = 'bank'; theirRole = 'p2p' }
                  }

                  // THE FIX: Decoupled Completion States
                  const isMyTaskCompleted = myProgress >= totalMonths
                  const isFullyCompleted = emi.type === 'personal' ? isMyTaskCompleted : (myProgress >= totalMonths && theirProgress >= totalMonths)

                  return (
                    <div key={emi.id} className={`p-4 bg-black/40 border border-white/10 rounded-2xl group relative overflow-hidden transition-all hover:bg-white/5 ${isFullyCompleted ? 'opacity-50' : ''}`}>
                      <div className="flex justify-between items-start mb-2">
                        <h3 className="font-bold text-slate-200 text-sm truncate pr-2">{emi.name}</h3>
                        <span className="text-rose-400 font-bold text-sm">₹{Number(emi.amount).toLocaleString('en-IN')}</span>
                      </div>
                      
                      <div className="text-xs font-medium text-slate-500 mb-3 bg-white/5 px-2 py-0.5 rounded-md inline-block">
                        Hits on {day}{[1,21,31].includes(day) ? 'st' : [2,22].includes(day) ? 'nd' : [3,23].includes(day) ? 'rd' : 'th'}
                      </div>

                      <div className="space-y-3 mb-3">
                        <div className="w-full">
                          <div className="flex justify-between text-[10px] uppercase font-bold text-slate-400 mb-1.5">
                            <span>{myRole === 'bank' ? 'Bank Payments (You)' : 'P2P Payments (You to Peer)'}</span>
                            <span className="flex items-center text-amber-400"><History className="w-3 h-3 mr-1" /> {myProgress} / {totalMonths} Paid</span>
                          </div>
                          <div className="w-full h-1.5 bg-black/40 rounded-full overflow-hidden">
                            <div className="h-full bg-indigo-400 transition-all duration-500" style={{ width: `${(myProgress / totalMonths) * 100}%` }} />
                          </div>
                        </div>

                        {emi.type !== 'personal' && (
                          <div className="w-full">
                            <div className="flex justify-between text-[10px] uppercase font-bold text-slate-500 mb-1.5">
                              <span>{theirRole === 'bank' ? "Peer's Bank Progress" : "Peer's P2P Progress"}</span>
                              <span className="flex items-center text-amber-400/50"><History className="w-3 h-3 mr-1" /> {theirProgress} / {totalMonths} Paid</span>
                            </div>
                            <div className="w-full h-1.5 bg-black/40 rounded-full overflow-hidden">
                              <div className="h-full bg-slate-600 transition-all duration-500" style={{ width: `${(theirProgress / totalMonths) * 100}%` }} />
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="flex gap-2 pt-3 border-t border-white/10">
                        {/* THE FIX: Button relies only on your personal task progress */}
                        {!isMyTaskCompleted ? (
                          <button onClick={() => { bankPaymentRequestId.current = crypto.randomUUID(); peerPaymentRequestId.current = crypto.randomUUID(); setPayEmiData({emi, role: myRole, currentMonth: myProgress + 1}) }} className="flex-1 flex items-center justify-center py-2 bg-white/5 hover:bg-white/10 text-white rounded-lg text-xs font-bold transition-all border border-white/10">
                            {myRole === 'bank' ? <ArrowUpRight className="w-3 h-3 mr-1.5 text-rose-400" /> : <ArrowRightLeft className="w-3 h-3 mr-1.5 text-amber-400" />}
                            {myRole === 'bank' ? 'Pay Bank' : 'Pay Peer'}
                          </button>
                        ) : (
                           <div className="flex-1 text-center py-2 text-xs font-bold text-emerald-500/70 border border-transparent">
                             {myRole === 'bank' ? 'Bank Paid Off' : 'Peer Paid Off'}
                           </div>
                        )}
                        <button onClick={() => handleDelete(emi.id)} className="p-2 bg-white/5 hover:bg-rose-500/20 hover:text-rose-400 rounded-lg text-slate-500 transition-colors">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  )
                })}
                {emis.filter(e => e.status === 'ACTIVE').length === 0 && <p className="text-sm text-slate-500 text-center py-4">No active EMIs.</p>}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ADD EMI MODAL */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-in fade-in duration-200">
          <div className="w-full max-w-md p-6 rounded-3xl backdrop-blur-2xl bg-slate-900 border border-white/20 shadow-2xl relative animate-in zoom-in-95 text-white max-h-[90vh] overflow-y-auto" ref={popoverRef}>
            <button onClick={() => { if (!emiFormDirty || window.confirm('Discard this recurring payment form?')) setIsAddModalOpen(false) }} className="absolute top-4 right-4 p-2 text-white/60 hover:text-white rounded-full hover:bg-white/10 transition-colors z-10"><X className="w-5 h-5" /></button>
            
            <div className="flex items-center justify-center mb-6">
              <div className="p-3 bg-indigo-500/20 rounded-full mr-3 border border-indigo-500/20"><CalendarDays className="w-5 h-5 text-indigo-400" /></div>
              <h2 className="text-xl font-bold">New EMI Schedule</h2>
            </div>

            <form onSubmit={handleAddEMI} className="space-y-4">
              <div className="flex p-1 bg-black/20 rounded-xl backdrop-blur-sm border border-white/10 mb-2">
                {(['personal', 'lent', 'borrowed'] as const).map((t) => (
                  <button key={t} type="button" onClick={() => setEmiType(t)} className={`flex-1 py-2 text-xs md:text-sm font-bold rounded-lg capitalize transition-all duration-200 ${emiType === t ? 'bg-indigo-500 text-white shadow-sm' : 'text-white/50 hover:text-white/80'}`}>
                    {t === 'personal' ? 'Personal EMI' : t === 'lent' ? 'Proxy (I Pay)' : 'Proxy (They Pay)'}
                  </button>
                ))}
              </div>

              <div className="flex flex-col space-y-1">
                <label className="text-xs font-semibold tracking-wide text-white/50 uppercase">Name / Item</label>
                <input type="text" required placeholder="e.g., iPhone 15 Pro" value={newEmi.name} onChange={(e) => setNewEmi({...newEmi, name: e.target.value})} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-indigo-500/50" disabled={isSubmitting} />
              </div>

              {emiType !== 'personal' && (
                <>
                  <div className="flex flex-col space-y-1 relative">
                    <label className="text-xs font-semibold tracking-wide text-white/50 uppercase">Who is this for?</label>
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40" />
                      <input type="text" placeholder="Search user or add contact..." value={selectedEntity ? selectedEntity.name : (newShadowName || searchQuery)} onChange={(e) => { setSelectedEntity(null); setNewShadowName(''); setSearchQuery(e.target.value) }} onFocus={() => setIsFocused(true)} onBlur={() => setTimeout(() => setIsFocused(false), 200)} className="w-full bg-black/40 border border-white/10 rounded-xl pl-10 pr-10 py-3 text-white outline-none focus:border-indigo-500/50" required disabled={isSubmitting} />
                      {(selectedEntity || newShadowName) && <button type="button" onClick={() => { setSelectedEntity(null); setNewShadowName(''); setSearchQuery(''); }} className="absolute inset-y-0 right-0 pr-3 flex items-center text-white/40 hover:text-white"><X className="h-4 w-4" /></button>}
                    </div>

                    {isFocused && !searchQuery && !selectedEntity && !newShadowName && myContacts.length > 0 && (
                      <div className="absolute top-[105%] left-0 right-0 bg-slate-900 border border-white/10 rounded-xl overflow-hidden shadow-2xl z-50 animate-in fade-in max-h-48 overflow-y-auto">
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
                      <div className="absolute top-[105%] left-0 right-0 bg-slate-900 border border-white/10 rounded-xl overflow-hidden shadow-2xl z-50 animate-in fade-in max-h-48 overflow-y-auto">
                        {searchResults.map(entity => (
                          <button key={entity.id} type="button" onClick={() => { setSelectedEntity(entity); setSearchQuery(''); setIsFocused(false); }} className="w-full flex items-center px-4 py-3 hover:bg-white/10 transition-colors border-b border-white/5">
                            <div className={`p-2 rounded-full mr-3 ${entity.type === 'contact' ? 'bg-emerald-500/20' : 'bg-indigo-500/20'}`}>
                              {entity.type === 'contact' ? <Users className="w-4 h-4 text-emerald-400" /> : <User className="w-4 h-4 text-indigo-400" />}
                            </div>
                            <div className="text-left flex-1"><p className="text-sm font-medium text-white">{entity.name}</p><p className={`text-xs ${entity.type === 'contact' ? 'text-emerald-400/70' : 'text-indigo-400/70'}`}>{entity.subtitle}</p></div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex flex-col space-y-1">
                      <label className="text-xs font-semibold tracking-wide text-white/50 uppercase">Principal (₹)</label>
                      <input type="number" step="0.01" required placeholder="60000" value={principal} onChange={(e) => setPrincipal(e.target.value)} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-indigo-500/50" disabled={isSubmitting} />
                    </div>
                    <div className="flex flex-col space-y-1">
                      <label className="text-xs font-semibold tracking-wide text-white/50 uppercase">Fee (₹)</label>
                      <input type="number" step="0.01" required placeholder="1500" value={processingFee} onChange={(e) => setProcessingFee(e.target.value)} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-indigo-500/50" disabled={isSubmitting} />
                    </div>
                  </div>
                </>
              )}

              <div className="flex flex-col space-y-1">
                <label className="text-xs font-semibold tracking-wide text-indigo-400 uppercase">Monthly EMI (₹)</label>
                <input type="number" step="0.01" required placeholder="5000" value={newEmi.amount} onChange={(e) => setNewEmi({...newEmi, amount: e.target.value})} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-rose-400 font-bold outline-none focus:border-indigo-500/50" disabled={isSubmitting} />
              </div>

              <div className="grid grid-cols-2 gap-3 relative">
                <div className="flex flex-col space-y-1">
                  <label className="text-xs font-semibold tracking-wide text-white/50 uppercase">Start Date</label>
                  <button type="button" onClick={() => { setIsStartPopoverOpen(!isStartPopoverOpen); setIsEndPopoverOpen(false); }} className="w-full flex items-center justify-between bg-black/40 border border-white/10 rounded-xl px-3 py-3 text-sm text-white outline-none focus:border-indigo-500/50 text-left" disabled={isSubmitting}>
                    {startDate ? format(startDate, "MMM d, yyyy") : <span>Pick a date</span>} <CalendarIcon className="w-4 h-4 text-white/50" />
                  </button>
                  {isStartPopoverOpen && (
                    <div className="absolute top-[105%] left-0 z-50 bg-slate-900 border border-slate-700 rounded-xl p-2 shadow-2xl">
                      <DayPicker mode="single" selected={startDate} onSelect={(date) => { setStartDate(date); setIsStartPopoverOpen(false); }} className="text-white" showOutsideDays />
                    </div>
                  )}
                </div>

                <div className="flex flex-col space-y-1">
                  <label className="text-xs font-semibold tracking-wide text-rose-400 uppercase">End Date *</label>
                  <button type="button" onClick={() => { setIsEndPopoverOpen(!isEndPopoverOpen); setIsStartPopoverOpen(false); }} className="w-full flex items-center justify-between bg-black/40 border border-white/10 rounded-xl px-3 py-3 text-sm text-white outline-none focus:border-rose-500/50 text-left" disabled={isSubmitting}>
                    {endDate ? format(endDate, "MMM d, yyyy") : <span className="text-white/50">Required</span>} <CalendarIcon className="w-4 h-4 text-white/50" />
                  </button>
                  {isEndPopoverOpen && (
                    <div className="absolute top-[105%] right-0 z-50 bg-slate-900 border border-slate-700 rounded-xl p-2 shadow-2xl">
                      <DayPicker mode="single" selected={endDate} onSelect={(date) => { setEndDate(date); setIsEndPopoverOpen(false); }} className="text-white" showOutsideDays disabled={[(date) => (startDate ? date < startDate : false)]} />
                    </div>
                  )}
                </div>
              </div>

              <div className="flex flex-col space-y-1 pt-2">
                <label className="text-xs font-semibold tracking-wide text-white/50 uppercase">Deducted From</label>
                <select value={newEmi.account_id} onChange={(e) => setNewEmi({...newEmi, account_id: e.target.value})} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-indigo-500/50 appearance-none" required disabled={isSubmitting}>
                  {accounts.map(acc => <option key={acc.id} value={acc.id} className="text-slate-900">{acc.name}</option>)}
                </select>
              </div>

              <button type="submit" disabled={isSubmitting} className="w-full flex items-center justify-center py-3.5 mt-4 rounded-xl bg-indigo-500 hover:bg-indigo-600 text-white font-bold text-lg transition-all shadow-[0_0_15px_rgba(99,102,241,0.4)] disabled:opacity-50">
                {isSubmitting ? <Loader2 className="w-6 h-6 animate-spin" /> : emiType === 'personal' ? 'Save Personal EMI' : 'Send EMI Request'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* SMART PAY INSTALLMENT MODAL */}
      {payEmiData && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
          <div className="bg-slate-900 border border-white/10 p-6 rounded-3xl w-full max-w-md shadow-2xl">
            <h2 className="text-xl font-bold mb-2 text-white flex items-center">
              {payEmiData.role === 'bank' ? <ArrowUpRight className="w-5 h-5 mr-2 text-rose-400" /> : <ArrowRightLeft className="w-5 h-5 mr-2 text-amber-400" />}
              {payEmiData.role === 'bank' ? 'Log Bank Payment' : 'Send Payment to Peer'}
            </h2>
            <p className="text-sm text-slate-400 mb-6">Logging monthly payment of <strong className="text-white">₹{Number(payEmiData.emi.amount).toLocaleString('en-IN')}</strong> for {payEmiData.emi.name}.</p>
            
            <form onSubmit={handlePayInstallment} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-slate-400 uppercase">Payment Date</label>
                  <input type="date" required value={payDate} onChange={e => setPayDate(e.target.value)} className="w-full mt-1 bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-indigo-500/50" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-400 uppercase">Pay From</label>
                  <div className="relative mt-1">
                    <Wallet className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <select required value={payAccountId} onChange={e => setPayAccountId(e.target.value)} className="w-full bg-black/40 border border-white/10 rounded-xl pl-10 pr-4 py-3 text-white outline-none focus:border-indigo-500/50 appearance-none">
                      <option value="" disabled>Select source...</option>
                      {accounts.map(acc => <option key={acc.id} value={acc.id}>{acc.name}</option>)}
                    </select>
                  </div>
                </div>
              </div>

              <div className="p-4 mt-2 bg-indigo-500/10 border border-indigo-500/20 rounded-xl">
                <div className="flex justify-between items-end mb-2">
                  <p className="text-sm text-indigo-200">You are paying for:</p>
                  <p className="text-xl font-black text-indigo-400">Month {payEmiData.currentMonth}</p>
                </div>
              </div>

              <div className="flex gap-3 mt-6">
                <button type="button" onClick={() => { if (payAccountId || payDate !== new Date().toISOString().split('T')[0]) { if (!window.confirm('Discard this payment form?')) return } bankPaymentRequestId.current = null; peerPaymentRequestId.current = null; setPayEmiData(null) }} className="flex-1 py-3 bg-white/5 hover:bg-white/10 text-white rounded-xl font-bold transition-colors">Cancel</button>
                <button type="submit" disabled={isSubmitting} className="flex-1 flex justify-center py-3 bg-indigo-500 hover:bg-indigo-600 text-white rounded-xl font-bold transition-all shadow-[0_0_15px_rgba(99,102,241,0.3)] disabled:opacity-50">
                  {isSubmitting ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Log Payment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

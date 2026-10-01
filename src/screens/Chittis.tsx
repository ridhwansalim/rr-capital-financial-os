import React, { useState, useEffect, useRef } from 'react'
import { Landmark, Plus, IndianRupee, Calendar, Trophy, ArrowUpRight, ArrowDownRight, Wallet, Loader2, CheckCircle2, History, Pencil, Trash2 } from 'lucide-react'
import { supabase } from '../lib/supabase'

interface Account {
  id: string
  name: string
  type: string
}

interface Chitti {
  id: string
  name: string
  total_pot: number
  duration_months: number
  monthly_installment: number
  start_date: string
  status: string
  received_month_number: number | null
  fee_deducted: number
  payout_received: number
  months_paid: number
}

export default function Chittis() {
  const [chittis, setChittis] = useState<Chitti[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [isLoading, setIsLoading] = useState(true)

  // Modals
  const [isNewModalOpen, setIsNewModalOpen] = useState(false)
  const [editingChitti, setEditingChitti] = useState<Chitti | null>(null)
  const [claimModalData, setClaimModalData] = useState<Chitti | null>(null)
  const [payModalData, setPayModalData] = useState<Chitti | null>(null)
  const claimRequestId = useRef<string | null>(null)
  const payRequestId = useRef<string | null>(null)

  // New/Edit Chitti Form
  const [newName, setNewName] = useState('')
  const [newPot, setNewPot] = useState('')
  const [newDuration, setNewDuration] = useState('')
  const [newStartDate, setNewStartDate] = useState(new Date().toISOString().split('T')[0])
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Claim Pot Form
  const [claimMonth, setClaimMonth] = useState('')
  const [claimFee, setClaimFee] = useState('')
  const [claimAccountId, setClaimAccountId] = useState('')

  // Pay Installment Form
  const [payAccountId, setPayAccountId] = useState('')
  const [payDate, setPayDate] = useState(new Date().toISOString().split('T')[0]) // NEW: Date selector

  useEffect(() => {
    fetchData()
  }, [])

  useEffect(() => {
    if (editingChitti) {
      setNewName(editingChitti.name)
      setNewPot(editingChitti.total_pot.toString())
      setNewDuration(editingChitti.duration_months.toString())
      setNewStartDate(editingChitti.start_date.split('T')[0])
    }
  }, [editingChitti])

  const fetchData = async () => {
    setIsLoading(true)
    try {
      const [chittiRes, accRes] = await Promise.all([
        supabase.from('chittis').select('*').order('created_at', { ascending: false }),
        supabase.from('accounts').select('*')
      ])

      if (chittiRes.data) setChittis(chittiRes.data)
      if (accRes.data) setAccounts(accRes.data)
    } catch (error) {
      console.error('Error fetching chittis:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleCloseModal = () => {
    setIsNewModalOpen(false)
    setEditingChitti(null)
    setNewName('')
    setNewPot('')
    setNewDuration('')
    setNewStartDate(new Date().toISOString().split('T')[0])
  }

  // --- ACTIONS ---

  const handleCreateChitti = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error("Not authenticated")

      const totalPot = parseFloat(newPot)
      const duration = parseInt(newDuration)
      const monthly = totalPot / duration

      if (editingChitti) {
        const { error } = await supabase.from('chittis')
          .update({
            name: newName,
            total_pot: totalPot,
            duration_months: duration,
            monthly_installment: monthly,
            start_date: newStartDate,
          })
          .eq('id', editingChitti.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('chittis').insert([{
          owner_id: user.id,
          name: newName,
          total_pot: totalPot,
          duration_months: duration,
          monthly_installment: monthly,
          start_date: newStartDate,
          months_paid: 0,
          status: 'ACTIVE'
        }])
        if (error) throw error
      }

      handleCloseModal()
      fetchData()
    } catch (err) {
      alert("Failed to save Chitti plan.")
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleClaimPot = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!claimModalData || !claimAccountId) return
    setIsSubmitting(true)

    try {
      const fee = parseFloat(claimFee || '0')
      claimRequestId.current ||= crypto.randomUUID()
      const { error } = await supabase.rpc('claim_chitti_pot', {
        p_request_id: claimRequestId.current,
        p_chitti_id: claimModalData.id,
        p_account_id: claimAccountId,
        p_month_number: Number(claimMonth),
        p_fee_amount: fee
      })
      if (error) throw error

      claimRequestId.current = null
      setClaimModalData(null)
      setClaimMonth('')
      setClaimFee('')
      setClaimAccountId('')
      fetchData()
    } catch (err) {
      alert("Failed to claim pot.")
    } finally {
      setIsSubmitting(false)
    }
  }

  const handlePayInstallment = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!payModalData || !payAccountId) return
    setIsSubmitting(true)

    try {
      // Ensure timezone safety by forcing midday
      const secureDate = new Date(`${payDate}T12:00:00`).toISOString()
      const currentMonthPaying = (payModalData.months_paid || 0) + 1
      payRequestId.current ||= crypto.randomUUID()
      const { error } = await supabase.rpc('pay_chitti_installment', {
        p_request_id: payRequestId.current,
        p_chitti_id: payModalData.id,
        p_account_id: payAccountId,
        p_expected_month: currentMonthPaying,
        p_created_at: secureDate
      })
      if (error) throw error

      payRequestId.current = null
      setPayModalData(null)
      setPayAccountId('')
      setPayDate(new Date().toISOString().split('T')[0])
      fetchData()
    } catch (err: any) {
      console.error(err)
      alert("Failed to log installment. Please ensure an account is selected.")
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDeleteChitti = async (id: string) => {
    if (!confirm("Are you sure you want to delete this Chitti plan? This will NOT delete associated transactions.")) return

    try {
      const { error } = await supabase.from('chittis').delete().eq('id', id)
      if (error) throw error
      fetchData()
    } catch (err) {
      alert("Failed to delete Chitti plan.")
    }
  }

  // --- DERIVED METRICS ---
  const activeChittis = chittis.filter(c => c.status === 'ACTIVE' && (c.months_paid || 0) < c.duration_months)
  const totalCommitment = activeChittis.reduce((sum, c) => sum + Number(c.monthly_installment), 0)
  const totalPotValue = activeChittis.reduce((sum, c) => sum + Number(c.total_pot), 0)

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-40">
        <Loader2 className="w-10 h-10 animate-spin text-emerald-500 mb-4" />
        <p className="text-slate-400">Loading Chitti engines...</p>
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6 w-full max-w-7xl mx-auto text-white animate-in fade-in duration-300 pb-32">
      
      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:justify-between md:items-end mb-8 gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold flex items-center">
            <Landmark className="w-7 h-7 sm:w-8 sm:h-8 mr-3 text-accent-400" />
            Chitti / ROSCA
          </h1>
          <p className="text-slate-400 mt-1">Manage rotating savings and credit associations.</p>
        </div>
        <button 
          onClick={() => setIsNewModalOpen(true)}
          className="flex w-full md:w-auto items-center justify-center px-6 py-3 bg-accent-500 hover:bg-accent-600 text-white rounded-xl font-bold transition-all shadow-[0_0_15px_rgba(var(--accent-500),0.3)]"
        >
          <Plus className="w-5 h-5 mr-2" /> New Plan
        </button>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        <div className="bg-white/5 border border-white/10 rounded-3xl p-6 backdrop-blur-sm">
          <p className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-2">Total Active Pots</p>
          <div className="text-3xl font-black text-white flex items-center">
            <IndianRupee className="w-6 h-6 mr-1 text-accent-400" />
            {totalPotValue.toLocaleString('en-IN')}
          </div>
        </div>
        <div className="bg-white/5 border border-white/10 rounded-3xl p-6 backdrop-blur-sm">
          <p className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-2">Monthly Commitment</p>
          <div className="text-3xl font-black text-white flex items-center">
            <IndianRupee className="w-6 h-6 mr-1 text-rose-400" />
            {totalCommitment.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
          </div>
        </div>
      </div>

      {/* Chitti Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
        {chittis.map(chitti => {
          const monthsPaid = chitti.months_paid || 0
          const isCompleted = monthsPaid >= chitti.duration_months

          return (
            <div key={chitti.id} className={`bg-white/5 border border-white/10 rounded-3xl p-6 backdrop-blur-sm relative overflow-hidden group ${isCompleted ? 'opacity-70' : ''}`}>
              
              {/* Top Actions & Status */}
              <div className="absolute top-6 right-6 flex items-center gap-2">
                <button 
                  onClick={() => setEditingChitti(chitti)}
                  className="p-2 bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white rounded-lg transition-all border border-white/5"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button 
                  onClick={() => handleDeleteChitti(chitti.id)}
                  className="p-2 bg-white/5 hover:bg-rose-500/10 text-slate-400 hover:text-rose-400 rounded-lg transition-all border border-white/5"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>

                {chitti.received_month_number ? (
                  <span className="flex items-center text-xs font-bold px-2 py-1 bg-emerald-500/20 text-emerald-400 rounded-lg border border-emerald-500/30">
                    <CheckCircle2 className="w-3 h-3 mr-1" /> Claimed
                  </span>
                ) : (
                  <span className="flex items-center text-xs font-bold px-2 py-1 bg-indigo-500/20 text-indigo-400 rounded-lg border border-indigo-500/30">
                    Active
                  </span>
                )}
              </div>

              <h3 className="text-xl font-bold mb-4 pr-32">{chitti.name}</h3>
              
              <div className="grid grid-cols-2 gap-4 mb-6">
                <div>
                  <p className="text-xs text-slate-400 mb-1">Total Pot</p>
                  <p className="font-bold flex items-center text-lg">
                    <IndianRupee className="w-4 h-4 text-emerald-400" />
                    {Number(chitti.total_pot).toLocaleString('en-IN')}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-400 mb-1">Monthly</p>
                  <p className="font-bold flex items-center text-lg">
                    <IndianRupee className="w-4 h-4 text-rose-400" />
                    {Number(chitti.monthly_installment).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-400 mb-1">Progress</p>
                  <p className="font-bold flex items-center text-sm text-amber-400">
                    <History className="w-4 h-4 mr-1" />
                    {monthsPaid} / {chitti.duration_months} Paid
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-400 mb-1">Start Date</p>
                  <p className="font-bold flex items-center text-sm">
                    {new Date(chitti.start_date).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}
                  </p>
                </div>
              </div>

              {/* Progress Bar Visual */}
              <div className="w-full h-1.5 bg-black/40 rounded-full mb-4 overflow-hidden">
                <div 
                  className="h-full bg-amber-400 transition-all duration-500"
                  style={{ width: `${(monthsPaid / chitti.duration_months) * 100}%` }}
                />
              </div>

              {/* Actions */}
              <div className="flex gap-3 pt-4 border-t border-white/10">
                {!isCompleted ? (
                  <button 
                    onClick={() => { payRequestId.current = crypto.randomUUID(); setPayModalData(chitti) }}
                    className="flex-1 flex items-center justify-center py-2.5 bg-white/5 hover:bg-white/10 text-white rounded-xl text-sm font-bold transition-all border border-white/10"
                  >
                    <ArrowUpRight className="w-4 h-4 mr-1.5 text-rose-400" /> Pay
                  </button>
                ) : (
                  <div className="flex-1 text-center py-2.5 text-sm font-bold text-slate-500 border border-transparent">
                    All Installments Paid
                  </div>
                )}
                
                {!chitti.received_month_number && (
                  <button 
                    onClick={() => { claimRequestId.current = crypto.randomUUID(); setClaimModalData(chitti) }}
                    className="flex-1 flex items-center justify-center py-2.5 bg-accent-500/20 hover:bg-accent-500/30 text-accent-300 rounded-xl text-sm font-bold transition-all border border-accent-500/30"
                  >
                    <Trophy className="w-4 h-4 mr-1.5" /> Claim Pot
                  </button>
                )}
              </div>

              {/* Claimed Details (if claimed) */}
              {chitti.received_month_number && (
                <div className="mt-4 p-3 bg-black/40 rounded-xl border border-white/5">
                  <p className="text-xs text-slate-400 mb-1 text-center">Payout Received in Month {chitti.received_month_number}</p>
                  <div className="flex justify-between items-center px-2">
                    <span className="text-sm font-bold text-emerald-400">+₹{Number(chitti.payout_received).toLocaleString('en-IN')}</span>
                    <span className="text-xs text-rose-400">Fee: ₹{Number(chitti.fee_deducted).toLocaleString('en-IN')}</span>
                  </div>
                </div>
              )}
            </div>
          )
        })}
        {chittis.length === 0 && (
          <div className="col-span-full py-20 text-center border-2 border-dashed border-white/10 rounded-3xl">
            <Landmark className="w-12 h-12 text-slate-600 mx-auto mb-4" />
            <h3 className="text-xl font-bold text-slate-400 mb-2">No Active Plans</h3>
            <p className="text-slate-500">Create your first Chitti to start tracking.</p>
          </div>
        )}
      </div>

      {/* --- MODALS --- */}
      
      {/* 1. New/Edit Chitti Modal */}
      {(isNewModalOpen || editingChitti) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
          <div className="bg-slate-900 border border-white/10 p-6 rounded-3xl w-full max-w-md shadow-2xl">
            <h2 className="text-xl font-bold mb-6 text-white flex items-center">
              <Landmark className="w-5 h-5 mr-2 text-accent-400" /> {editingChitti ? 'Edit Chitti Plan' : 'Create New Chitti'}
            </h2>
            <form onSubmit={handleCreateChitti} className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-slate-400 uppercase">Plan Name / Organizer</label>
                <input type="text" required value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g., KSFE Golden Plan" className="w-full mt-1 bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-accent-500/50" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-slate-400 uppercase">Total Pot (₹)</label>
                  <input type="number" required min="1" value={newPot} onChange={e => setNewPot(e.target.value)} placeholder="100000" className="w-full mt-1 bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-accent-500/50" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-400 uppercase">Duration (Months)</label>
                  <input type="number" required min="1" value={newDuration} onChange={e => setNewDuration(e.target.value)} placeholder="10" className="w-full mt-1 bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-accent-500/50" />
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-400 uppercase">Start Date</label>
                <input type="date" required value={newStartDate} onChange={e => setNewStartDate(e.target.value)} className="w-full mt-1 bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-accent-500/50" />
              </div>

              {/* Live Preview */}
              {newPot && newDuration && (
                <div className="p-3 bg-indigo-500/10 border border-indigo-500/20 rounded-xl text-center">
                  <p className="text-xs text-indigo-300 uppercase font-bold mb-1">Monthly Installment</p>
                  <p className="text-xl font-black text-white">₹{(Number(newPot) / Number(newDuration)).toLocaleString('en-IN', { maximumFractionDigits: 0 })} / month</p>
                </div>
              )}

              <div className="flex gap-3 mt-6">
                <button type="button" onClick={handleCloseModal} className="flex-1 py-3 bg-white/5 hover:bg-white/10 text-white rounded-xl font-bold transition-colors">Cancel</button>
                <button type="submit" disabled={isSubmitting} className="flex-1 flex justify-center py-3 bg-accent-500 hover:bg-accent-600 text-white rounded-xl font-bold transition-all shadow-[0_0_15px_rgba(var(--accent-500),0.3)] disabled:opacity-50">
                  {isSubmitting ? <Loader2 className="w-5 h-5 animate-spin" /> : editingChitti ? 'Update Plan' : 'Create Plan'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 2. Claim Pot Modal */}
      {claimModalData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
          <div className="bg-slate-900 border border-white/10 p-6 rounded-3xl w-full max-w-md shadow-2xl">
            <h2 className="text-xl font-bold mb-2 text-white flex items-center">
              <Trophy className="w-5 h-5 mr-2 text-emerald-400" /> Claim Pot
            </h2>
            <p className="text-sm text-slate-400 mb-6">You are auctioning/claiming the <strong className="text-white">₹{Number(claimModalData.total_pot).toLocaleString('en-IN')}</strong> pot for {claimModalData.name}.</p>
            
            <form onSubmit={handleClaimPot} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-slate-400 uppercase">Win Month #</label>
                  <input type="number" required min="1" max={claimModalData.duration_months} value={claimMonth} onChange={e => setClaimMonth(e.target.value)} placeholder="e.g., 4" className="w-full mt-1 bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-emerald-500/50" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-400 uppercase">Auction Fee (₹)</label>
                  <input type="number" required min="0" value={claimFee} onChange={e => setClaimFee(e.target.value)} placeholder="2000" className="w-full mt-1 bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-emerald-500/50" />
                </div>
              </div>
              
              <div>
                <label className="text-xs font-semibold text-slate-400 uppercase">Deposit To Account</label>
                <div className="relative mt-1">
                  <Wallet className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <select required value={claimAccountId} onChange={e => setClaimAccountId(e.target.value)} className="w-full bg-black/40 border border-white/10 rounded-xl pl-10 pr-4 py-3 text-white outline-none focus:border-emerald-500/50 appearance-none">
                    <option value="" disabled>Select receiving account...</option>
                    {accounts.map(acc => <option key={acc.id} value={acc.id}>{acc.name}</option>)}
                  </select>
                </div>
              </div>

              {/* Calculation Preview */}
              {claimFee && (
                <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-center flex justify-between items-center">
                  <span className="text-sm font-medium text-emerald-300">Final Payout Received:</span>
                  <span className="text-xl font-black text-emerald-400">₹{(claimModalData.total_pot - Number(claimFee)).toLocaleString('en-IN')}</span>
                </div>
              )}

              <div className="flex gap-3 mt-6">
                <button type="button" onClick={() => { claimRequestId.current = null; setClaimModalData(null) }} className="flex-1 py-3 bg-white/5 hover:bg-white/10 text-white rounded-xl font-bold transition-colors">Cancel</button>
                <button type="submit" disabled={isSubmitting} className="flex-1 flex justify-center py-3 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl font-bold transition-all shadow-[0_0_15px_rgba(16,185,129,0.3)] disabled:opacity-50">
                  {isSubmitting ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Log Payout'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 3. Pay Installment Modal */}
      {payModalData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
          <div className="bg-slate-900 border border-white/10 p-6 rounded-3xl w-full max-w-md shadow-2xl">
            <h2 className="text-xl font-bold mb-2 text-white flex items-center">
              <ArrowUpRight className="w-5 h-5 mr-2 text-rose-400" /> Pay Installment
            </h2>
            <p className="text-sm text-slate-400 mb-6">Logging monthly payment of <strong className="text-white">₹{Number(payModalData.monthly_installment).toLocaleString('en-IN')}</strong> for {payModalData.name}.</p>
            
            <form onSubmit={handlePayInstallment} className="space-y-4">
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-slate-400 uppercase">Payment Date</label>
                  <input 
                    type="date" required 
                    value={payDate} 
                    onChange={e => setPayDate(e.target.value)} 
                    className="w-full mt-1 bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-rose-500/50" 
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-400 uppercase">Pay From Account</label>
                  <div className="relative mt-1">
                    <Wallet className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <select required value={payAccountId} onChange={e => setPayAccountId(e.target.value)} className="w-full bg-black/40 border border-white/10 rounded-xl pl-10 pr-4 py-3 text-white outline-none focus:border-rose-500/50 appearance-none">
                      <option value="" disabled>Select source...</option>
                      {accounts.map(acc => <option key={acc.id} value={acc.id}>{acc.name}</option>)}
                    </select>
                  </div>
                </div>
              </div>

              {/* Progress Summary Box */}
              <div className="p-4 mt-2 bg-amber-500/10 border border-amber-500/20 rounded-xl">
                <div className="flex justify-between items-end mb-2">
                  <p className="text-sm text-amber-200">You are paying for:</p>
                  <p className="text-xl font-black text-amber-400">Month {(payModalData.months_paid || 0) + 1}</p>
                </div>
                <div className="border-t border-amber-500/20 pt-2 flex justify-between items-center text-xs">
                  <span className="text-slate-400">Remaining after this payment:</span>
                  <span className="font-bold text-white">
                    {payModalData.duration_months - ((payModalData.months_paid || 0) + 1)} Months 
                    (₹{((payModalData.duration_months - ((payModalData.months_paid || 0) + 1)) * payModalData.monthly_installment).toLocaleString('en-IN', { maximumFractionDigits: 0 })})
                  </span>
                </div>
              </div>

              <div className="flex gap-3 mt-6">
                <button type="button" onClick={() => { payRequestId.current = null; setPayModalData(null) }} className="flex-1 py-3 bg-white/5 hover:bg-white/10 text-white rounded-xl font-bold transition-colors">Cancel</button>
                <button type="submit" disabled={isSubmitting} className="flex-1 flex justify-center py-3 bg-rose-500 hover:bg-rose-600 text-white rounded-xl font-bold transition-all shadow-[0_0_15px_rgba(244,63,94,0.3)] disabled:opacity-50">
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

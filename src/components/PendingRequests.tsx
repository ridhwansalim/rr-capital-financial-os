import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { Check, X, Loader2, Wallet, AlertCircle, Trash2, CalendarDays, ArrowDownLeft } from 'lucide-react'

export default function PendingRequests() {
  const [requests, setRequests] = useState<any[]>([])
  const [declinedAlerts, setDeclinedAlerts] = useState<any[]>([])
  const [accounts, setAccounts] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [processingId, setProcessingId] = useState<string | null>(null)
  const [acceptingId, setAcceptingId] = useState<string | null>(null)
  const [selectedAccountId, setSelectedAccountId] = useState<string>('')

  useEffect(() => { fetchInboxData() }, [])

  const fetchInboxData = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data: accData } = await supabase.from('accounts').select('*').order('name')
      if (accData) {
        setAccounts(accData)
        if (accData.length > 0) setSelectedAccountId(accData[0].id)
      }

      // 1. Fetch Debts & EMIs
      const { data: incDebts } = await supabase.from('obligations').select('*').eq('status', 'PENDING_APPROVAL').neq('owner_id', user.id).or(`creditor_profile_id.eq.${user.id},debtor_profile_id.eq.${user.id}`)
      const { data: incEmis } = await supabase.from('recurring_emis').select('*').eq('status', 'PENDING_APPROVAL').eq('counterparty_profile_id', user.id)
      
      // 2. Fetch SETTLEMENTS (Repayments arriving TO you)
      const { data: incSettlements } = await supabase.from('settlements').select('*, obligations(description)').eq('status', 'PENDING_APPROVAL').eq('counterparty_profile_id', user.id)

      const { data: decDebts } = await supabase.from('obligations').select('*').eq('status', 'DECLINED').eq('owner_id', user.id)
      const { data: decEmis } = await supabase.from('recurring_emis').select('*').eq('status', 'DECLINED').eq('owner_id', user.id)
      const { data: decSettlements } = await supabase.from('settlements').select('*').eq('status', 'DECLINED').eq('initiator_id', user.id).is('initiator_dismissed_at', null)

      const taggedIncDebts = (incDebts || []).map(d => ({ ...d, req_category: 'debt' }))
      const taggedIncEmis = (incEmis || []).map(e => ({ ...e, req_category: 'emi' }))
      const taggedIncSettlements = (incSettlements || []).map(s => ({ ...s, req_category: 'settlement', owner_id: s.initiator_id })) // Map initiator_id so display_name logic works
      
      const taggedDecDebts = (decDebts || []).map(d => ({ ...d, req_category: 'debt' }))
      const taggedDecEmis = (decEmis || []).map(e => ({ ...e, req_category: 'emi' }))
      const taggedDecSettlements = (decSettlements || []).map(s => ({ ...s, req_category: 'settlement', owner_id: s.counterparty_profile_id }))

      const allIncoming = [...taggedIncDebts, ...taggedIncEmis, ...taggedIncSettlements]
      const allDeclined = [...taggedDecDebts, ...taggedDecEmis, ...taggedDecSettlements]

      const profileIds = new Set<string>()
      allIncoming.forEach(r => profileIds.add(r.owner_id))
      allDeclined.forEach(r => {
        if (r.req_category === 'emi') profileIds.add(r.counterparty_profile_id)
        else if (r.req_category === 'settlement') profileIds.add(r.owner_id)
        else {
          if (r.creditor_profile_id && r.creditor_profile_id !== user.id) profileIds.add(r.creditor_profile_id)
          if (r.debtor_profile_id && r.debtor_profile_id !== user.id) profileIds.add(r.debtor_profile_id)
        }
      })

      const { data: profiles } = await supabase.from('profile_directory').select('id, full_name, username').in('id', Array.from(profileIds))

      const enrich = (data: any[]) => data.map(req => {
        let targetId = req.owner_id
        if (req.status === 'DECLINED') {
            if (req.req_category === 'emi') targetId = req.counterparty_profile_id
            else if (req.req_category === 'debt') targetId = req.creditor_profile_id === user.id ? req.debtor_profile_id : req.creditor_profile_id
        }
        const p = profiles?.find(prof => prof.id === targetId)
        return { ...req, display_name: p?.full_name || p?.username || 'Someone' }
      })

      setRequests(enrich(allIncoming))
      setDeclinedAlerts(enrich(allDeclined))

    } catch (error) { console.error("Inbox Error:", error) } finally { setIsLoading(false) }
  }

  const handleDecline = async (id: string, category: 'debt' | 'emi' | 'settlement') => {
    const reason = window.prompt("Why are you declining this transaction?")
    if (reason === null) return 

    setProcessingId(id)
    try {
      if (category === 'settlement') {
        const { error } = await supabase.rpc('decline_settlement', { p_settlement_id: id, p_reason: reason })
        if (error) throw error
      } else {
        const table = category === 'debt' ? 'obligations' : 'recurring_emis'
        const { error } = await supabase.from(table).update({ status: 'DECLINED', decline_reason: reason }).eq('id', id)
        if (error) throw error
      }
      setRequests(requests.filter(req => !(req.id === id && req.req_category === category)))
    } catch (error: any) { alert(error.message) } finally { setProcessingId(null) }
  }

  const confirmAccept = async (id: string, category: 'debt' | 'emi' | 'settlement') => {
    setProcessingId(id)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error("Auth missing")

      if (category === 'debt' || category === 'settlement') {
        if (!selectedAccountId) throw new Error("Please select an account.")
        const rpcName = category === 'debt' ? 'accept_p2p_request' : 'accept_settlement'
        const payload = category === 'debt' 
          ? { p_obligation_id: id, p_receiver_user_id: user.id, p_receiver_account_id: selectedAccountId }
          : { p_settlement_id: id, p_receiver_user_id: user.id, p_destination_account_id: selectedAccountId }
          
        const { error } = await supabase.rpc(rpcName, payload)
        if (error) throw error
      } else {
        const { error } = await supabase.rpc('accept_p2p_emi', { p_emi_id: id, p_receiver_user_id: user.id })
        if (error) throw error
      }
      
      setRequests(requests.filter(req => !(req.id === id && req.req_category === category)))
      setAcceptingId(null)
      window.location.reload()
    } catch (error: any) {
      alert(`Failed to process: ${error.message}`)
    } finally {
      setProcessingId(null)
    }
  }

  const handleDismissDeclined = async (id: string, category: 'debt' | 'emi' | 'settlement') => {
    setProcessingId(id)
    try {
      if (category === 'settlement') {
        const { error } = await supabase.rpc('dismiss_declined_settlement', { p_settlement_id: id })
        if (error) throw error
      } else {
        const table = category === 'debt' ? 'obligations' : 'recurring_emis'
        const { error } = await supabase.from(table).update({ status: 'CANCELED' }).eq('id', id)
        if (error) throw error
      }
      setDeclinedAlerts(declinedAlerts.filter(req => !(req.id === id && req.req_category === category)))
    } catch (error) { console.error(error) } finally { setProcessingId(null) }
  }

  if (isLoading || (requests.length === 0 && declinedAlerts.length === 0)) return null

  return (
    <div className="mb-6 space-y-3 animate-in fade-in slide-in-from-top-4">
      {requests.length > 0 && <h3 className="text-sm font-bold text-amber-500 uppercase tracking-wider">Pending Approvals</h3>}
      {requests.map(req => {
        const isEmi = req.req_category === 'emi'
        const isSettlement = req.req_category === 'settlement'
        const isAccepting = acceptingId === req.id

        return (
          <div key={`${req.id}-${req.req_category}`} className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-4 flex flex-col gap-4 overflow-hidden relative">
            <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
              
              <div className="flex items-start">
                {isEmi ? <CalendarDays className="w-5 h-5 text-amber-500 mr-3 mt-1 flex-shrink-0" /> 
                : isSettlement ? <ArrowDownLeft className="w-5 h-5 text-emerald-500 mr-3 mt-1 flex-shrink-0" />
                : <Wallet className="w-5 h-5 text-amber-500 mr-3 mt-1 flex-shrink-0" />}
                
                <div>
                  <p className="text-sm text-slate-300">
                    <span className="font-bold text-white">{req.display_name}</span> 
                    {isEmi ? ' wants to set up a Proxy EMI for you.' 
                    : isSettlement ? ' sent a repayment to you.' 
                    : ' wants to log a Transfer.'}
                  </p>
                  
                  {isEmi ? (
                    <div className="mt-2 space-y-1">
                      <p className="text-sm font-bold text-white">{req.name}</p>
                      <p className="text-xs text-slate-400">Master Debt: <span className="font-bold text-rose-400">₹{Number(req.total_principal) + Number(req.processing_fee)}</span></p>
                    </div>
                  ) : isSettlement ? (
                    <div className="mt-2 space-y-1">
                      <p className="text-sm text-slate-300">Amount: <span className="font-black text-emerald-400 ml-1">₹{req.amount}</span></p>
                      <p className="text-xs text-amber-400/70 font-medium">For: "{req.obligations?.description}"</p>
                    </div>
                  ) : (
                    <div className="mt-2 space-y-1">
                      <p className="text-sm text-slate-300">Amount: <span className="font-black text-white ml-1">₹{req.amount}</span></p>
                      <p className="text-xs text-amber-400/70 font-medium">"{req.description}"</p>
                    </div>
                  )}
                </div>
              </div>
              
              {!isAccepting && (
                <div className="flex gap-2">
                  <button onClick={() => isEmi ? confirmAccept(req.id, 'emi') : setAcceptingId(req.id)} className="flex-1 md:flex-none flex justify-center items-center px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-bold rounded-xl transition-colors shadow-lg shadow-emerald-500/20">
                    {processingId === req.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Check className="w-4 h-4 mr-1" /> Accept</>}
                  </button>
                  <button onClick={() => handleDecline(req.id, req.req_category)} disabled={processingId === req.id} className="flex-1 md:flex-none flex justify-center items-center px-4 py-2 bg-rose-500/20 text-rose-400 hover:bg-rose-500/30 text-sm font-bold rounded-xl transition-colors">
                    {processingId === req.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <><X className="w-4 h-4 mr-1" /> Decline</>}
                  </button>
                </div>
              )}
            </div>

            {/* DEPOSIT ACCOUNT SELECTION UI */}
            {isAccepting && !isEmi && (
              <div className="mt-2 pt-4 border-t border-amber-500/20 animate-in slide-in-from-top-2">
                <label className="text-xs font-bold text-amber-500 uppercase tracking-wider mb-2 block">
                  Select where to deposit this money:
                </label>
                <div className="flex flex-col md:flex-row gap-3">
                  <div className="relative flex-1">
                    <Wallet className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <select value={selectedAccountId} onChange={(e) => setSelectedAccountId(e.target.value)} className="w-full bg-black/40 border border-amber-500/30 rounded-xl pl-10 pr-4 py-3 text-white outline-none focus:border-amber-500 appearance-none">
                      {accounts.map(acc => (
                        <option key={acc.id} value={acc.id} className="text-slate-900">{acc.name} (₹{acc.balance})</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => confirmAccept(req.id, req.req_category)} disabled={processingId === req.id} className="flex-1 md:flex-none flex justify-center items-center px-6 py-3 bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-bold rounded-xl transition-colors shadow-lg shadow-emerald-500/20">
                      {processingId === req.id ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Confirm Transfer'}
                    </button>
                    <button onClick={() => setAcceptingId(null)} className="p-3 bg-white/5 hover:bg-white/10 rounded-xl text-slate-300 transition-colors">
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

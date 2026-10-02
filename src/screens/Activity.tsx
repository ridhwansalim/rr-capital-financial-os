import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"
import { safeCaughtErrorMessage } from "@/lib/safeErrorMessages"
import { CheckCircle2, XCircle, Clock, Landmark } from "lucide-react"

type Transaction = {
  id: string
  amount: number
  description: string
  created_at: string
  status: string
}

type Account = {
  id: string
  name: string
  type: string
}

export default function Activity() {
  const [pendingTxns, setPendingTxns] = useState<Transaction[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  
  // UI State for the inline Accept form
  const [acceptingId, setAcceptingId] = useState<string | null>(null)
  const [selectedAccountId, setSelectedAccountId] = useState("")

  useEffect(() => {
    async function loadActivity() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      // 1. Fetch pending handshakes where YOU are the receiver
      const { data: txns } = await supabase
        .from('transactions')
        .select('id, amount, description, created_at, status')
        .eq('receiver_profile_id', user.id)
        .eq('status', 'PENDING')
        .order('created_at', { ascending: false })
      
      if (txns) setPendingTxns(txns)

      // 2. Fetch your real-world accounts to populate the deposit dropdown
      const { data: accs } = await supabase
        .from('accounts')
        .select('id, name, type')
        .eq('owner_id', user.id)
      
      if (accs) setAccounts(accs)
      setLoading(false)
    }
    loadActivity()
  }, [])

  const handleAccept = async (txnId: string) => {
    if (!selectedAccountId) return alert("Please select an account to receive these funds.")
    
    // Update the transaction: Link the account and flip status to COMPLETED
    const { error } = await supabase
      .from('transactions')
      .update({ 
        status: 'COMPLETED',
        to_account_id: selectedAccountId 
      })
      .eq('id', txnId)
      
    if (error) {
      alert(safeCaughtErrorMessage(error, 'Could not accept this request. Refresh and try again.'))
    } else {
      setPendingTxns(prev => prev.filter(t => t.id !== txnId))
      setAcceptingId(null)
      setSelectedAccountId("")
      // Trigger a local event so other parts of the app (like auto-lock) know there was activity
      window.dispatchEvent(new Event('settings-updated'))
    }
  }

  const handleReject = async (txnId: string) => {
    const { error } = await supabase
      .from('transactions')
      .update({ status: 'REJECTED' })
      .eq('id', txnId)
      
    if (error) {
      alert(safeCaughtErrorMessage(error, 'Could not reject this request. Refresh and try again.'))
    } else {
      setPendingTxns(prev => prev.filter(t => t.id !== txnId))
    }
  }

  return (
    <div className="space-y-6 p-4">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">Activity</h1>
        <p className="text-slate-500 text-sm">Action required on pending handshakes</p>
      </header>

      {loading ? (
        <div className="text-center text-slate-500 mt-10 text-sm">Decrypting ledger...</div>
      ) : pendingTxns.length === 0 ? (
        <div className="bg-white p-8 rounded-2xl border border-slate-200 shadow-sm text-center">
          <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto mb-3" />
          <h3 className="font-bold text-slate-900">You're all caught up!</h3>
          <p className="text-sm text-slate-500 mt-1">No pending handshakes waiting for your approval.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {pendingTxns.map(txn => {
            const isAccepting = acceptingId === txn.id

            return (
              <div key={txn.id} className="bg-white rounded-2xl border border-blue-100 shadow-md overflow-hidden relative transition-all">
                {/* Visual Indicator */}
                <div className="absolute top-0 left-0 w-1.5 h-full bg-blue-500"></div>
                
                <div className="p-5">
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <div className="flex items-center gap-1.5 text-blue-600 text-[10px] font-bold uppercase tracking-wider mb-1">
                        <Clock className="w-3.5 h-3.5" /> Incoming Handshake
                      </div>
                      <h3 className="font-bold text-slate-900">{txn.description}</h3>
                    </div>
                    <span className="text-lg font-extrabold text-emerald-600">+₹{txn.amount.toFixed(2)}</span>
                  </div>

                  {!isAccepting ? (
                    <div className="flex gap-2 mt-5">
                      <button 
                        onClick={() => setAcceptingId(txn.id)}
                        className="flex-1 bg-slate-900 text-white text-sm font-bold py-2.5 rounded-xl hover:bg-slate-800 transition-colors flex items-center justify-center gap-1.5"
                      >
                        <CheckCircle2 className="w-4 h-4" /> Accept
                      </button>
                      <button 
                        onClick={() => handleReject(txn.id)}
                        className="flex-1 bg-red-50 text-red-600 text-sm font-bold py-2.5 rounded-xl border border-red-100 hover:bg-red-100 transition-colors flex items-center justify-center gap-1.5"
                      >
                        <XCircle className="w-4 h-4" /> Reject
                      </button>
                    </div>
                  ) : (
                    <div className="mt-4 bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3 animate-in fade-in slide-in-from-top-2">
                      <p className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                        <Landmark className="w-4 h-4" /> Deposit into which account?
                      </p>
                      
                      <select 
                        value={selectedAccountId} 
                        onChange={e => setSelectedAccountId(e.target.value)}
                        className="w-full bg-white border border-slate-300 rounded-lg p-2.5 text-sm text-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-400"
                      >
                        <option value="" disabled>Select receiving account...</option>
                        {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                      </select>

                      <div className="flex gap-2 pt-1">
                        <button 
                          onClick={() => handleAccept(txn.id)}
                          className="w-2/3 bg-emerald-500 text-white text-sm font-bold py-2.5 rounded-lg hover:bg-emerald-600 transition-colors"
                        >
                          Confirm Deposit
                        </button>
                        <button 
                          onClick={() => { setAcceptingId(null); setSelectedAccountId(""); }}
                          className="w-1/3 text-slate-500 text-sm font-bold py-2.5 rounded-lg hover:bg-slate-200 transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

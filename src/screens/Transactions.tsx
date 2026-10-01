import { useEffect, useState } from "react"
import { supabase } from "@/lib/supabase"
import { localDB } from "@/lib/db"
import { syncOutbox } from "@/lib/sync"
import { Button } from "@/components/ui/button"

type Account = { id: string, name: string, type: string }

export default function Transactions() {
  const [accounts, setAccounts] = useState<Account[]>([])
  
  // Form State
  const [fromAccount, setFromAccount] = useState("")
  const [toAccount, setToAccount] = useState("")
  const [amount, setAmount] = useState("")
  const [fee, setFee] = useState("0")
  const [description, setDescription] = useState("")

  // Fetch accounts to populate dropdowns
  useEffect(() => {
    async function loadAccounts() {
      // FIX: Removed the invalid 'AS' keyword. Just fetching 'id' directly.
      const { data, error } = await supabase.from('accounts').select('id, name, type')
      if (error) console.error("Error fetching accounts:", error)
      if (data) setAccounts(data)
    }
    loadAccounts()
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    const { data: { session }, error: sessionError } = await supabase.auth.getSession()
    if (sessionError || !session?.user) {
      alert('Sign in before queuing a transaction.')
      return
    }

    // 1. Save locally to Dexie (Offline First)
    await localDB.outbox.add({
      request_id: crypto.randomUUID(),
      owner_id: session.user.id,
      from_account_id: fromAccount || null,
      to_account_id: toAccount || null,
      amount: parseFloat(amount),
      fee_amount: parseFloat(fee) || 0,
      description: description,
      sync_status: 'pending',
      created_at: new Date().toISOString()
    })

    // 2. Clear form
    setAmount("")
    setFee("0")
    setDescription("")

    // 3. Fire the sync engine in the background
    syncOutbox()
    
    alert("Transaction saved! Balances will update instantly upon sync.")
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">Log Transfer</h1>
        <p className="text-slate-500 text-sm">Move money between accounts</p>
      </header>

      <form onSubmit={handleSubmit} className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
        
        {/* FROM Account */}
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-semibold text-slate-700">From (Source)</label>
          <select 
            required 
            value={fromAccount} 
            onChange={(e) => setFromAccount(e.target.value)}
            className="w-full bg-slate-50 border border-slate-200 rounded-lg p-3 text-slate-900 focus:outline-none focus:border-slate-400 focus:ring-1 focus:ring-slate-400"
          >
            <option value="" disabled>Select Source Account...</option>
            {accounts.map(a => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>

        {/* TO Account */}
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-semibold text-slate-700">To (Destination)</label>
          <select 
            required 
            value={toAccount} 
            onChange={(e) => setToAccount(e.target.value)}
            className="w-full bg-slate-50 border border-slate-200 rounded-lg p-3 text-slate-900 focus:outline-none focus:border-slate-400 focus:ring-1 focus:ring-slate-400"
          >
            <option value="" disabled>Select Destination Account...</option>
            {accounts.map(a => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>

        {/* AMOUNT & FEE */}
        <div className="flex gap-4">
          <div className="flex flex-col gap-1.5 w-2/3">
            <label className="text-sm font-semibold text-slate-700">Amount (₹)</label>
            <input 
              type="number" step="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-lg p-3 text-slate-900 focus:outline-none focus:border-slate-400 focus:ring-1 focus:ring-slate-400"
              placeholder="0.00"
            />
          </div>
          <div className="flex flex-col gap-1.5 w-1/3">
            <label className="text-sm font-semibold text-slate-700">Fee (₹)</label>
            <input 
              type="number" step="0.01" value={fee} onChange={(e) => setFee(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-lg p-3 text-slate-900 focus:outline-none focus:border-slate-400 focus:ring-1 focus:ring-slate-400"
            />
          </div>
        </div>

        {/* DESCRIPTION */}
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-semibold text-slate-700">Description</label>
          <input 
            type="text" required value={description} onChange={(e) => setDescription(e.target.value)}
            className="w-full bg-slate-50 border border-slate-200 rounded-lg p-3 text-slate-900 focus:outline-none focus:border-slate-400 focus:ring-1 focus:ring-slate-400"
            placeholder="e.g. Credit Card Liquidity Rolling"
          />
        </div>

        <Button type="submit" className="w-full mt-2 h-12 text-md">
          Execute Transfer
        </Button>
      </form>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { RefreshCw, WifiOff } from 'lucide-react'
import { localDB, type LocalTransaction } from '../lib/db'
import { retryOutboxItem, retryOutboxItems } from '../lib/sync'
import { supabase } from '../lib/supabase'
import { formatIndiaDateTime } from '../lib/financeDate'
import { cacheForOwner, visibleOfflineItems } from '../lib/offlineOwnership'
import PageHeader from '../components/PageHeader'

export default function OfflineQueue() {
  const [ownerId, setOwnerId] = useState<string | null>(null)
  const [online, setOnline] = useState(navigator.onLine)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  useEffect(() => {
    let mounted = true
    let authRevision = 0
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      authRevision += 1
      if (mounted) setOwnerId(session?.user.id || null)
    })
    const initialRevision = authRevision
    void supabase.auth.getUser().then(({ data, error }) => {
      // A slower initial lookup must not overwrite a newer sign-in/sign-out event.
      if (mounted && authRevision === initialRevision) setOwnerId(error ? null : data.user?.id || null)
    })
    const updateOnline = () => setOnline(navigator.onLine)
    window.addEventListener('online', updateOnline)
    window.addEventListener('offline', updateOnline)
    return () => {
      mounted = false
      subscription.unsubscribe()
      window.removeEventListener('online', updateOnline)
      window.removeEventListener('offline', updateOnline)
    }
  }, [])
  const items = useLiveQuery(async () => ownerId
    ? (await localDB.outbox.toArray()).filter(item => item.owner_id === ownerId && item.sync_status !== 'synced').sort((a, b) => a.created_at.localeCompare(b.created_at))
    : [], [ownerId], [] as LocalTransaction[])
  const cache = useLiveQuery(() => ownerId ? localDB.accountCache.get(ownerId) : undefined, [ownerId])
  const visibleItems = visibleOfflineItems(items, ownerId)
  const ownedAccounts = cacheForOwner(cache, ownerId)?.accounts || []
  const accountName = (id: string | null) => id ? ownedAccounts.find(a => a.id === id)?.name || 'Account' : 'External'
  const retry = async (id?: number) => {
    if (!ownerId || !online) return
    setBusy(true)
    setMessage('')
    try {
      const { data, error } = await supabase.auth.getUser()
      if (error || data.user?.id !== ownerId) {
        setOwnerId(data.user?.id || null)
        return
      }
      if (id !== undefined) await retryOutboxItem(id, ownerId)
      else {
        const ids = visibleItems.flatMap(item => item.id === undefined ? [] : [item.id])
        await retryOutboxItems(ids, ownerId)
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Retry could not start')
    } finally { setBusy(false) }
  }

  return <div className="p-4 sm:p-6 w-full max-w-4xl mx-auto text-white pb-32">
    <PageHeader title="Offline transactions" description="Transactions saved on this device until the server confirms them." action={<button onClick={() => void retry()} disabled={!online || busy || !visibleItems.length} className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 font-semibold hover:bg-emerald-500 disabled:opacity-40 sm:w-auto sm:py-2"><RefreshCw className={`w-4 h-4 ${busy ? 'animate-spin' : ''}`} />Retry all</button>} />
    {!online && <div className="flex items-center gap-2 p-4 mb-5 rounded-xl bg-amber-500/10 text-amber-300 border border-amber-500/20"><WifiOff className="w-5 h-5" />You are offline. Retry is available when your connection returns.</div>}
    {message && <p role="alert" className="text-rose-300 mb-4">{message}</p>}
    <p className="text-sm text-slate-400 mb-4">{visibleItems.length} awaiting confirmation{visibleItems.length ? ` · ${visibleItems.filter(item => item.sync_status === 'failed').length} need attention` : ''}</p>
    {!visibleItems.length && <div className="rounded-2xl bg-white/5 border border-white/10 p-8 text-center text-slate-400">No transactions are waiting on this device.</div>}
    <div className="space-y-3">{visibleItems.map(item => <div key={item.id} className="rounded-2xl bg-white/5 border border-white/10 p-5 flex flex-col sm:flex-row gap-4 sm:items-center sm:justify-between">
      <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{item.description || 'Transaction'}</span><span className={`text-xs px-2 py-1 rounded-full ${item.sync_status === 'failed' ? 'bg-rose-500/20 text-rose-300' : 'bg-amber-500/20 text-amber-300'}`}>{item.sync_status === 'failed' ? 'Needs retry' : 'Pending'}</span></div>
        <p className="text-sm text-slate-400 mt-1">{accountName(item.from_account_id)} → {accountName(item.to_account_id)} · {formatIndiaDateTime(item.created_at)}</p>
        {item.last_error && <p className="text-sm text-rose-300 mt-2 break-words" role="alert">{item.last_error}</p>}
      </div>
      <div className="flex items-center gap-3 shrink-0"><span className="font-semibold">₹{Number(item.amount).toLocaleString('en-IN')}</span><button onClick={() => item.id !== undefined && void retry(item.id)} disabled={!online || busy} className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 disabled:opacity-40">Retry</button></div>
    </div>)}</div>
    <p className="text-xs text-slate-500 mt-6">Keep this browser's site data until every transaction is confirmed. Retrying uses the same request ID to avoid duplicate ledger entries.</p>
  </div>
}

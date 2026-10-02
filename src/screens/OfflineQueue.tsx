import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { CheckCircle2, Clock3, RefreshCw, Trash2, WifiOff } from 'lucide-react'
import { localDB, type LocalTransaction } from '../lib/db'
import { discardFailedOutboxItem, retryOutboxItem, retryOutboxItems } from '../lib/sync'
import { supabase } from '../lib/supabase'
import { formatIndiaDateTime } from '../lib/financeDate'
import { safePersistedOfflineMessage } from '../lib/offlineErrorMessages'
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
    ? (await localDB.outbox.where('owner_id').equals(ownerId).filter(item => item.sync_status !== 'synced').toArray()).sort((a, b) => a.created_at.localeCompare(b.created_at))
    : [], [ownerId], [] as LocalTransaction[])
  const cache = useLiveQuery(() => ownerId ? localDB.accountCache.get(ownerId) : undefined, [ownerId])
  const visibleItems = visibleOfflineItems(items, ownerId)
  const failedCount = visibleItems.filter(item => item.sync_status === 'failed').length
  const pendingCount = visibleItems.length - failedCount
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
    } catch {
      setMessage('Retry could not start. Check your connection and sign-in, then try again.')
    } finally { setBusy(false) }
  }
  const discard = async (item: LocalTransaction) => {
    if (!ownerId || item.id === undefined || item.sync_status !== 'failed' || busy) return
    const confirmed = window.confirm(
      `Discard “${item.description || 'Transaction'}” (₹${Number(item.amount).toLocaleString('en-IN')}) from this device? The server rejected this entry. Pending network retries cannot be discarded here.`
    )
    if (!confirmed) return
    setBusy(true)
    setMessage('')
    try {
      const removed = await discardFailedOutboxItem(item.id, ownerId)
      setMessage(removed ? 'Failed entry discarded from this device.' : 'This entry changed state, so it was not discarded.')
    } catch {
      setMessage('The failed entry could not be discarded from this device. Refresh the queue and try again.')
    } finally { setBusy(false) }
  }

  return <div className="page-shell w-full max-w-4xl mx-auto pb-32">
    <PageHeader title="Offline transactions" description="Saved on this device until the server confirms them." action={<button onClick={() => void retry()} disabled={!online || busy || !visibleItems.length} className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 font-semibold hover:bg-emerald-500 disabled:opacity-40 sm:w-auto sm:py-2"><RefreshCw className={`w-4 h-4 ${busy ? 'animate-spin' : ''}`} />Retry all</button>} />
    <section className="surface-panel mb-5 flex flex-wrap items-center gap-3 p-4" aria-live="polite">
      <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${online ? 'bg-emerald-500/10 text-emerald-500' : 'bg-amber-500/10 text-amber-500'}`}>{online ? <CheckCircle2 className="h-5 w-5" /> : <WifiOff className="h-5 w-5" />}</span>
      <div className="min-w-0 flex-1"><p className="font-semibold">{online ? 'Connection available' : 'You are offline'}</p><p className="text-sm text-slate-400">{online ? 'Queued entries can sync when you retry.' : 'Reconnect to send queued entries safely.'}</p></div>
      <div className="flex gap-2 text-xs"><span className="rounded-full bg-amber-500/10 px-3 py-1.5 text-amber-500">{pendingCount} pending</span>{failedCount > 0 && <span className="rounded-full bg-rose-500/10 px-3 py-1.5 text-rose-500">{failedCount} need retry</span>}</div>
    </section>
    {message && <p role="alert" className="text-rose-300 mb-4">{message}</p>}
    {!visibleItems.length && <div className="surface-panel p-8 text-center"><span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-500"><CheckCircle2 className="h-6 w-6" /></span><p className="font-semibold">All caught up</p><p className="mt-1 text-sm text-slate-400">No transactions are waiting on this device.</p></div>}
    <div className="space-y-3">{visibleItems.map(item => <div key={item.id} className="surface-panel flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
      <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{item.description || 'Transaction'}</span><span className={`text-xs px-2 py-1 rounded-full ${item.sync_status === 'failed' ? 'bg-rose-500/20 text-rose-300' : 'bg-amber-500/20 text-amber-300'}`}>{item.sync_status === 'failed' ? 'Needs retry' : 'Pending'}</span></div>
        <p className="text-sm text-slate-400 mt-1">{accountName(item.from_account_id)} → {accountName(item.to_account_id)} · {formatIndiaDateTime(item.created_at)}</p>
        {item.last_attempt_at && <p className="mt-1 flex items-center gap-1 text-xs text-slate-500"><Clock3 className="h-3 w-3" />Last tried {formatIndiaDateTime(item.last_attempt_at)}</p>}
        {safePersistedOfflineMessage(item.sync_status, item.last_error) && <p className="text-sm text-rose-300 mt-2 break-words" role="alert">{safePersistedOfflineMessage(item.sync_status, item.last_error)}</p>}
      </div>
      <div className="flex items-center justify-between gap-3 shrink-0 sm:justify-end"><span className="font-semibold">₹{Number(item.amount).toLocaleString('en-IN')}</span><div className="flex items-center gap-2"><button onClick={() => item.id !== undefined && void retry(item.id)} disabled={!online || busy} aria-label={`Retry ${item.description || 'transaction'}`} className="flex items-center gap-2 rounded-xl bg-[var(--accent-soft)] px-4 py-2 font-medium text-[var(--accent)] hover:brightness-110 disabled:opacity-40"><RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} />Retry</button>{item.sync_status === 'failed' && <button type="button" onClick={() => void discard(item)} disabled={busy} aria-label={`Discard failed ${item.description || 'transaction'}`} className="flex items-center gap-2 rounded-xl border border-rose-500/30 px-3 py-2 text-sm font-medium text-rose-400 hover:bg-rose-500/10 disabled:opacity-40"><Trash2 className="h-4 w-4" />Discard</button>}</div></div>
    </div>)}</div>
    <p className="text-xs text-slate-500 mt-6">Keep this browser's site data until every transaction is confirmed. Retrying uses the same request ID to avoid duplicates. Only entries with a definite server rejection can be discarded; pending network retries are kept because the server may already have received them.</p>
  </div>
}

import { useCallback, useEffect, useRef, useState } from 'react'
import { App } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import { MessageSquareText, Loader2, ArrowDownRight, ArrowUpRight, X } from 'lucide-react'
import LiquidSwitch from './ui/LiquidSwitch'
import { MessagingIntake, type ParsedMessageCandidate } from '../lib/messagingIntake'

export default function NativeMessagingIntake() {
  const [smsAllowed, setSmsAllowed] = useState(false)
  const [smsEnabled, setSmsEnabled] = useState(false)
  const [notificationsAllowed, setNotificationsAllowed] = useState(false)
  const [notificationsEnabled, setNotificationsEnabled] = useState(false)
  const [reviewNotificationsAllowed, setReviewNotificationsAllowed] = useState(false)
  const [reviewNotificationsEnabled, setReviewNotificationsEnabled] = useState(false)
  const [candidates, setCandidates] = useState<ParsedMessageCandidate[]>([])
  const [busy, setBusy] = useState(false)
  const sectionRef = useRef<HTMLElement>(null)
  const native = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'

  const refresh = useCallback(async () => {
    if (!native) return
    try {
      const [sms, notifications, reviewNotifications, inbox] = await Promise.all([
        MessagingIntake.checkSmsPermissions(),
        MessagingIntake.checkNotificationAccess(),
        MessagingIntake.checkNotificationPermission(),
        MessagingIntake.getCandidates(),
      ])
      setSmsAllowed(sms.granted)
      setSmsEnabled(sms.enabled)
      setNotificationsAllowed(notifications.granted)
      setNotificationsEnabled(notifications.enabled)
      setReviewNotificationsAllowed(reviewNotifications.granted)
      setReviewNotificationsEnabled(reviewNotifications.enabled)
      setCandidates(Array.isArray(inbox.candidates) ? inbox.candidates : [])
    } catch { /* Native bridge may not be available until the next installed APK. */ }
  }, [native])

  useEffect(() => {
    const refreshTimer = window.setTimeout(() => void refresh(), 0)
    const listener = App.addListener('appStateChange', ({ isActive }) => { if (isActive) void refresh() })
    return () => {
      window.clearTimeout(refreshTimer)
      void listener.then(handle => handle.remove())
    }
  }, [refresh])

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('review') !== 'pending') return
    const timer = window.setTimeout(() => {
      sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      sectionRef.current?.focus({ preventScroll: true })
    }, 300)
    return () => window.clearTimeout(timer)
  }, [])

  const setSmsCapture = async (enabled: boolean) => {
    setBusy(true)
    try {
      if (!enabled) { await MessagingIntake.setSmsCaptureEnabled({ enabled: false }); setSmsEnabled(false); return }
      const result = smsAllowed ? { granted: true } : await MessagingIntake.requestSmsPermissions()
      setSmsAllowed(result.granted)
      if (result.granted) { await MessagingIntake.setSmsCaptureEnabled({ enabled: true }); setSmsEnabled(true) }
    }
    finally { setBusy(false) }
  }

  const setNotificationCapture = async (enabled: boolean) => {
    await MessagingIntake.setNotificationCaptureEnabled({ enabled })
    setNotificationsEnabled(enabled)
    if (enabled && !notificationsAllowed) window.setTimeout(() => void refresh(), 800)
  }

  const setReviewNotificationOptIn = async (enabled: boolean) => {
    if (!enabled) {
      await MessagingIntake.setReviewNotificationsEnabled({ enabled: false })
      setReviewNotificationsEnabled(false)
      return
    }
    const result = reviewNotificationsAllowed
      ? { granted: true }
      : await MessagingIntake.requestNotificationPermission()
    setReviewNotificationsAllowed(result.granted)
    if (result.granted) {
      await MessagingIntake.setReviewNotificationsEnabled({ enabled: true })
      setReviewNotificationsEnabled(true)
      await MessagingIntake.getCandidates()
    }
  }

  const dismiss = async (item: ParsedMessageCandidate) => {
    await MessagingIntake.dismissCandidate({ id: item.id })
    setCandidates(items => items.filter(candidate => candidate.id !== item.id))
  }

  const review = (item: ParsedMessageCandidate) => {
    window.dispatchEvent(new CustomEvent('rr:transaction-draft', { detail: {
      type: item.direction,
      amount: item.amount.toFixed(2),
      feeAmount: '0',
      description: item.bank ? `${item.description} · ${item.bank}${item.accountSuffix ? ` ••${item.accountSuffix}` : ''}` : item.description,
      selectedAccount: '',
      targetAccount: '',
    } }))
  }

  if (!native) return null
  return (
    <section ref={sectionRef} id="pending-transaction-review" tabIndex={-1} className="surface-panel scroll-mt-24 rounded-3xl p-6 md:p-8" aria-labelledby="native-message-intake-title">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[var(--brand-tint)] text-[var(--brand-primary-active)]"><MessageSquareText className="h-5 w-5" /></span>
        <div><h2 id="native-message-intake-title" className="text-xl font-bold">On-device transaction suggestions</h2><p className="mt-1 text-sm text-[var(--muted)]">Optional Android tools parse bank SMS or notifications on this device. Raw message text is not retained or uploaded.</p></div>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-2">
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--line)] bg-[var(--surface-soft)] p-4">
          <div><h3 className="text-sm font-semibold text-[var(--ink)]">Bank SMS parsing</h3><p className="mt-1 text-xs text-[var(--muted)]">Android asks for SMS access only when enabled.</p></div>
          {busy ? <Loader2 className="h-5 w-5 animate-spin text-[var(--muted)]" /> : <LiquidSwitch size="sm" label="Bank SMS parsing" checked={smsAllowed && smsEnabled} onCheckedChange={enabled => void setSmsCapture(enabled)} />}
        </div>
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--line)] bg-[var(--surface-soft)] p-4">
          <div><h3 className="text-sm font-semibold text-[var(--ink)]">Transaction notifications</h3><p className="mt-1 text-xs text-[var(--muted)]">Android opens its notification-access settings; you choose whether to enable it.</p></div>
          <div className="flex items-center gap-2"><span className="text-[10px] text-[var(--muted)]">{notificationsAllowed ? 'System access on' : 'System access needed'}</span><LiquidSwitch size="sm" label="Transaction notification parsing" checked={notificationsAllowed && notificationsEnabled} onCheckedChange={enabled => void setNotificationCapture(enabled)} /></div>
        </div>
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--line)] bg-[var(--surface-soft)] p-4">
          <div><h3 className="text-sm font-semibold text-[var(--ink)]">Ongoing transaction review notification</h3><p className="mt-1 text-xs text-[var(--muted)]">Android 13+ asks for notification permission. Tapping it opens this pending-review list.</p></div>
          <div className="flex items-center gap-2"><span className="text-[10px] text-[var(--muted)]">{reviewNotificationsAllowed ? 'Permission on' : 'Permission needed'}</span><LiquidSwitch size="sm" label="Ongoing transaction review notification" checked={reviewNotificationsAllowed && reviewNotificationsEnabled} onCheckedChange={enabled => void setReviewNotificationOptIn(enabled)} /></div>
        </div>
      </div>

      <div className="mt-5">
        <div className="flex items-center justify-between"><h3 className="text-sm font-semibold text-[var(--ink)]">Locally parsed suggestions</h3><span className="rounded-full bg-[var(--surface-soft)] px-2.5 py-1 text-xs text-[var(--muted)]">{candidates.length}</span></div>
        {candidates.length === 0 ? <p className="mt-2 text-xs text-[var(--muted)]">No transaction suggestions yet. Recognized messages appear here for review; they never post automatically.</p> :
          <ul className="mt-2 max-h-56 space-y-2 overflow-y-auto pr-1">
            {candidates.map(item => <li key={item.id} className="flex items-center gap-3 rounded-2xl border border-[var(--line)] bg-[var(--surface-soft)] p-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--brand-tint)] text-[var(--brand-primary-active)]">{item.direction === 'expense' ? <ArrowDownRight className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}</span>
              <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-[var(--ink)]">{item.description}</p><p className="text-xs text-[var(--muted)]">{[item.bank, item.accountSuffix ? `••${item.accountSuffix}` : '', item.source === 'sms' ? 'SMS' : 'Notification'].filter(Boolean).join(' · ')} · {new Date(item.receivedAt).toLocaleString()}</p></div>
              <p className="text-sm font-semibold text-[var(--ink)]">₹{item.amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</p>
              <button type="button" onClick={() => review(item)} className="rounded-lg bg-[var(--brand-primary)] px-3 py-2 text-xs font-semibold text-white">Review</button>
              <button type="button" aria-label="Dismiss parsed message" onClick={() => void dismiss(item)} className="rounded-lg p-2 text-[var(--muted)] hover:bg-[var(--surface-strong)]"><X className="h-4 w-4" /></button>
            </li>)}
          </ul>}
      </div>
    </section>
  )
}

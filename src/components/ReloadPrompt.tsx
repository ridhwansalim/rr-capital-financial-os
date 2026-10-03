import { useEffect, useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { ArrowDownToLine, X } from 'lucide-react'

const UPDATE_AVAILABLE_KEY = 'rr-capital-update-available'

export default function ReloadPrompt() {
  const [available, setAvailable] = useState(() => localStorage.getItem(UPDATE_AVAILABLE_KEY) === 'true')
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegistered(registration) {
      if (!registration) return
      const checkOnFocus = () => {
        if (document.visibilityState === 'visible') void registration.update()
      }
      document.addEventListener('visibilitychange', checkOnFocus)
      window.setInterval(() => void registration.update(), 60 * 60 * 1000)
    },
    onRegisterError() {
      console.error('Service worker registration failed')
    },
  })

  useEffect(() => {
    if (needRefresh) {
      localStorage.setItem(UPDATE_AVAILABLE_KEY, 'true')
      window.dispatchEvent(new Event('rr:update-found'))
      return
    }
    return
  }, [needRefresh])

  useEffect(() => {
    const requestCheck = () => {
      void navigator.serviceWorker?.getRegistration().then(registration => registration?.update())
    }
    const requestInstall = () => {
      localStorage.removeItem(UPDATE_AVAILABLE_KEY)
      setAvailable(false)
      void updateServiceWorker(true)
    }
    window.addEventListener('rr:check-app-update', requestCheck)
    window.addEventListener('rr:install-app-update', requestInstall)
    return () => {
      window.removeEventListener('rr:check-app-update', requestCheck)
      window.removeEventListener('rr:install-app-update', requestInstall)
    }
  }, [updateServiceWorker])

  const openSettings = () => {
    window.location.assign('/settings?section=updates')
  }

  const dismiss = () => {
    setNeedRefresh(false)
    setAvailable(false)
    localStorage.removeItem(UPDATE_AVAILABLE_KEY)
  }

  if (!needRefresh && !available) return null

  return (
    <div className="fixed bottom-28 left-1/2 z-[100] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 rounded-2xl border border-[var(--line)] bg-[var(--app-panel-strong)] p-4 shadow-2xl">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[var(--brand-tint)] text-[var(--brand-primary-active)]"><ArrowDownToLine className="h-5 w-5" /></span>
          <div><h3 className="text-sm font-semibold text-[var(--ink)]">RR Capital has an update</h3><p className="mt-0.5 text-xs text-[var(--muted)]">Review what changed in Settings when you’re ready.</p></div>
        </div>
        <button type="button" aria-label="Dismiss update notice" onClick={dismiss} className="rounded-full p-1.5 text-[var(--muted)] hover:bg-[var(--surface-soft)]"><X className="h-4 w-4" /></button>
      </div>
      <button type="button" onClick={openSettings} className="mt-3 min-h-10 w-full rounded-xl bg-[var(--surface-soft)] px-4 text-sm font-semibold text-[var(--ink)] hover:bg-[var(--surface-strong)]">View update in Settings</button>
    </div>
  )
}

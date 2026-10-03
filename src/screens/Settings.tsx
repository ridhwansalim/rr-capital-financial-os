import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Settings as SettingsIcon, Search, User, Key, Lock, RotateCcw, Save, Trash2, Loader2, Palette, Bot, Info, Fingerprint, Plus, Laptop, Smartphone, LogOut, Sun, Moon, RefreshCw, Download } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { formatIndiaDate } from '../lib/financeDate'
import { normalizeThemeMode, useTheme } from '../components/ThemeProvider'
import { useModalBack } from '../lib/useModalBack'
import { hasAppPinConfigured, migrateLegacyAppPin, removeAppPin, storeAppPin } from '../lib/appPin'
import { setOptionalFeature, useOptionalFeatures } from '../lib/optionalFeatures'
import { safeCaughtErrorMessage } from '../lib/safeErrorMessages'
import { isGuidedHelpEnabled, replayGuidance, setGuidedHelpEnabled } from '../lib/guidedHelp'
import PageHeader from '../components/PageHeader'
import { currentRelease, type ReleaseNotes } from '../lib/releaseNotes'
import LiquidSwitch from '../components/ui/LiquidSwitch'

// WebAuthn Helper to encode hardware keys
const arrayBufferToBase64 = (buffer: ArrayBuffer) => {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
}

export default function Settings() {
  const navigate = useNavigate()
  const telegramBotUsername = (import.meta.env.VITE_TELEGRAM_BOT_USERNAME || 'ridhwans_fin_bot').replace(/^@/, '')
  const { themeMode, setTheme } = useTheme()
  const { flags: featureFlags } = useOptionalFeatures()
  const [checkingAppUpdate, setCheckingAppUpdate] = useState(false)
  const [appUpdateStatus, setAppUpdateStatus] = useState('')
  const [lastAppUpdateCheck, setLastAppUpdateCheck] = useState('')
  const [appUpdateAvailable, setAppUpdateAvailable] = useState(() => localStorage.getItem('rr-capital-update-available') === 'true')
  const [showReleaseDetails, setShowReleaseDetails] = useState(false)
  const [releaseInfo, setReleaseInfo] = useState<ReleaseNotes>(currentRelease)

  const loadReleaseInfo = async () => {
    try {
      const response = await fetch('/release-notes.json', { cache: 'no-store' })
      if (!response.ok) return
      const value = await response.json() as Partial<ReleaseNotes>
      if (typeof value.version !== 'string' || typeof value.releasedAt !== 'string' || !Number.isFinite(Date.parse(value.releasedAt)) || typeof value.brief !== 'string' || !Array.isArray(value.details)) return
      setReleaseInfo({
        version: value.version.slice(0, 40),
        releasedAt: value.releasedAt,
        brief: value.brief.slice(0, 600),
        details: value.details.filter((detail): detail is string => typeof detail === 'string').slice(0, 30).map(detail => detail.slice(0, 600)),
      })
    } catch {
      // Keep the bundled release notes available while offline.
    }
  }

  useEffect(() => {
    const markAvailable = () => setAppUpdateAvailable(true)
    window.addEventListener('rr:update-found', markAvailable)
    const releaseNotesTimer = window.setTimeout(() => { void loadReleaseInfo() }, 0)
    if (new URLSearchParams(window.location.search).get('section') === 'updates') {
      window.setTimeout(() => document.getElementById('app-updates')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 250)
    }
    return () => { window.clearTimeout(releaseNotesTimer); window.removeEventListener('rr:update-found', markAvailable) }
  }, [])

  const checkForAppUpdate = async () => {
    setCheckingAppUpdate(true)
    setAppUpdateStatus('Checking for an update…')
    setLastAppUpdateCheck(new Date().toISOString())
    try {
      await loadReleaseInfo()
      const registration = await navigator.serviceWorker?.getRegistration()
      if (!registration) {
        setAppUpdateStatus('Update checks are unavailable until the app has finished installing on this device.')
        return
      }
      await registration.update()
      const waiting = registration.waiting || (registration.installing?.state === 'installed' ? registration.installing : null)
      if (waiting) {
        localStorage.setItem('rr-capital-update-available', 'true')
        setAppUpdateAvailable(true)
        setAppUpdateStatus('A new version is ready to install.')
      } else {
        setAppUpdateStatus('You’re using the latest version available to this device.')
      }
    } catch {
      setAppUpdateStatus('Could not check right now. Check your connection and try again.')
    } finally {
      setCheckingAppUpdate(false)
    }
  }

  const installAppUpdate = () => window.dispatchEvent(new Event('rr:install-app-update'))
  const [featureBusy, setFeatureBusy] = useState(false)
  const [featureError, setFeatureError] = useState('')
  const [isSigningOut, setIsSigningOut] = useState(false)
  const [signOutError, setSignOutError] = useState('')
  const [guidedHelpEnabled, setGuidedHelpState] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSavingProfile, setIsSavingProfile] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  const [telegramToken, setTelegramToken] = useState('')
  const [telegramLinkError, setTelegramLinkError] = useState('')
  const [telegramWebhookWarning, setTelegramWebhookWarning] = useState('')
  const [telegramBusy, setTelegramBusy] = useState(false)
  const [telegramExpiresAt, setTelegramExpiresAt] = useState(0)
  const [geminiKeyDraft, setGeminiKeyDraft] = useState('')
  const [geminiKeyConfigured, setGeminiKeyConfigured] = useState(false)
  const [geminiStatusLoading, setGeminiStatusLoading] = useState(true)
  const [geminiKeyBusy, setGeminiKeyBusy] = useState(false)
  const [geminiKeyMessage, setGeminiKeyMessage] = useState('')

  const [defaultProfile] = useState(() => ({
    full_name: '',
    username: '',
    theme_mode: themeMode,
    theme_accent: 'coral',
    ai_model: 'gemini-1.5-flash',
    ai_persona: 'Analyst',
    telegram_chat_id: '',
    is_biometric_enabled: false,
    registered_devices: [] as any[]
  }))
  const [originalProfile, setOriginalProfile] = useState(defaultProfile)
  const [draftProfile, setDraftProfile] = useState(defaultProfile)

  // Local Security State
  const [autoLock, setAutoLock] = useState(false)
  const [lockTime, setLockTime] = useState('3')
  const [savedPin, setSavedPin] = useState('')
  const [hasPinConfigured, setHasPinConfigured] = useState(false)
  const [isPinSaving, setIsPinSaving] = useState(false)

  useEffect(() => {
    setTheme(normalizeThemeMode(draftProfile.theme_mode))
  }, [draftProfile.theme_mode, setTheme])

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        // getSession reads the already established local session. ProtectedRoute has
        // verified access; RLS remains the authority for every query below.
        const { data: { session } } = await supabase.auth.getSession()
        const user = session?.user
        if (user) {
          setUserId(user.id)
          setGuidedHelpState(isGuidedHelpEnabled(user.id))
          // Profile data gates the page. Gemini status does not, so let it resolve in
          // the background instead of adding another mobile-network round trip.
          void supabase.functions.invoke('manage-gemini-key', { body: { action: 'status' } })
            .then(({ data: keyStatus, error }) => {
              if (error) throw error
              setGeminiKeyConfigured(keyStatus?.configured === true)
            })
            .catch(() => console.warn('Could not check Gemini key status'))
            .finally(() => setGeminiStatusLoading(false))

          const { data } = await supabase.from('profiles').select('full_name, username, theme_mode, theme_accent, ai_model, ai_persona, telegram_chat_id, is_biometric_enabled, registered_devices').eq('id', user.id).single()
          if (data) {
            const themeMode = normalizeThemeMode(data.theme_mode)
            const uniqueDevices = Array.from(new Map((data.registered_devices || []).map((device: any) => [device.id, device])).values())
            const loadedProfile = { ...defaultProfile, ...data, theme_mode: themeMode, registered_devices: uniqueDevices }
            setOriginalProfile(loadedProfile)
            setDraftProfile(loadedProfile)
            
            // Keep device preferences locally; Gemini credentials are managed server-side in Vault.
            localStorage.setItem('financial_os_devices', JSON.stringify(loadedProfile.registered_devices))
            localStorage.setItem('financial_os_bio_enabled', loadedProfile.is_biometric_enabled ? 'true' : 'false')
          }
        }

        setAutoLock(localStorage.getItem('financial_os_autolock') === 'true')
        setLockTime(localStorage.getItem('financial_os_lock_time') || '3')
        // PBKDF2 migration is local-only and can take noticeable time on phones.
        // Keep the settings page responsive while it runs.
        setHasPinConfigured(hasAppPinConfigured())
        void migrateLegacyAppPin().then(() => setHasPinConfigured(hasAppPinConfigured()))
          .catch(() => console.warn('Could not migrate the local app PIN'))
        setSavedPin('')

      } catch {
        console.error('Could not load settings')
      } finally {
        setIsLoading(false)
      }
    }
    fetchSettings()
  }, [defaultProfile])

  const isProfileModified = JSON.stringify({ ...originalProfile, telegram_chat_id: '' }) !== JSON.stringify({ ...draftProfile, telegram_chat_id: '' })

  const signOut = async () => {
    if (isSigningOut) return
    if (isProfileModified && !window.confirm('You have unsaved settings. Sign out and discard them?')) return
    setIsSigningOut(true)
    setSignOutError('')
    try {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession()
      if (sessionError) throw sessionError

      let pendingCount: number | null = 0
      if (session?.user.id) {
        try {
          const { localDB } = await import('../lib/db')
          pendingCount = await localDB.outbox.where('owner_id').equals(session.user.id)
            .filter(item => item.sync_status !== 'synced').count()
        } catch {
          pendingCount = null
        }
      }
      if (pendingCount === null) {
        if (!window.confirm('I could not check this browser for saved offline transactions. They may remain on this device after sign-out. Continue?')) return
      } else if (pendingCount > 0) {
        const noun = pendingCount === 1 ? 'transaction' : 'transactions'
        if (!window.confirm(`${pendingCount} offline ${noun} will remain saved on this browser after sign-out. You can review them under Offline transactions when you sign in again. Continue?`)) return
      }

      const { error } = await supabase.auth.signOut()
      if (error) throw error
      window.location.replace('/auth')
    } catch {
      setSignOutError('Sign-out could not be confirmed. Check your connection and try again.')
    } finally {
      setIsSigningOut(false)
    }
  }

  useModalBack(isProfileModified, () => navigate(-1), true, 'You have unsaved settings. Leave and discard them?')

  useEffect(() => {
    if (!isProfileModified) return
    const guardInternalNavigation = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return
      const anchor = event.target.closest('a[href]') as HTMLAnchorElement | null
      if (!anchor || anchor.target || anchor.hasAttribute('download')) return
      const target = new URL(anchor.href, window.location.href)
      if (target.origin !== window.location.origin) return
      if (!window.confirm('You have unsaved settings. Leave and discard them?')) {
        event.preventDefault()
        event.stopImmediatePropagation()
        return
      }
      event.preventDefault()
      event.stopImmediatePropagation()
      navigate(`${target.pathname}${target.search}${target.hash}`)
    }
    document.addEventListener('click', guardInternalNavigation, true)
    return () => document.removeEventListener('click', guardInternalNavigation, true)
  }, [isProfileModified, navigate])

  useEffect(() => {
    if (!isProfileModified) return
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warnBeforeUnload)
    return () => window.removeEventListener('beforeunload', warnBeforeUnload)
  }, [isProfileModified])

  const handleSaveProfile = async () => {
    setIsSavingProfile(true)
    try {
      if (!userId) throw new Error('No user found')
      const profileUpdate = {
        full_name: draftProfile.full_name,
        username: draftProfile.username,
        theme_mode: draftProfile.theme_mode,
        theme_accent: draftProfile.theme_accent,
        ai_model: draftProfile.ai_model,
        ai_persona: draftProfile.ai_persona,
        is_biometric_enabled: draftProfile.is_biometric_enabled,
        registered_devices: draftProfile.registered_devices
      }
      const { error } = await supabase.from('profiles').update(profileUpdate).eq('id', userId)
      if (error) throw error
      
      setOriginalProfile(draftProfile)
      localStorage.setItem('financial_os_devices', JSON.stringify(draftProfile.registered_devices))
      localStorage.setItem('financial_os_bio_enabled', draftProfile.is_biometric_enabled ? 'true' : 'false')
    } catch {
      alert('Failed to save settings.')
    } finally {
      setIsSavingProfile(false)
    }
  }

  const saveGeminiKey = async () => {
    setGeminiKeyBusy(true)
    setGeminiKeyMessage('')
    try {
      const { data, error } = await supabase.functions.invoke('manage-gemini-key', {
        body: { action: 'save', apiKey: geminiKeyDraft.trim() },
      })
      if (error) throw error
      if (data?.configured !== true) throw new Error(data?.error || 'Could not save your Gemini key.')
      setGeminiKeyConfigured(true)
      setGeminiKeyDraft('')
      setGeminiKeyMessage('Your key is encrypted in Supabase Vault and ready for receipt scans.')
    } catch (error) {
      setGeminiKeyMessage(safeCaughtErrorMessage(error, 'Could not save your Gemini key. Check the key and try again.'))
    } finally {
      setGeminiKeyBusy(false)
    }
  }

  const removeGeminiKey = async () => {
    setGeminiKeyBusy(true)
    setGeminiKeyMessage('')
    try {
      const { data, error } = await supabase.functions.invoke('manage-gemini-key', { body: { action: 'delete' } })
      if (error) throw error
      if (data?.configured !== false) throw new Error(data?.error || 'Could not remove your Gemini key.')
      setGeminiKeyConfigured(false)
      setGeminiKeyDraft('')
      setGeminiKeyMessage('Your Gemini key has been removed.')
    } catch (error) {
      setGeminiKeyMessage(safeCaughtErrorMessage(error, 'Could not remove your Gemini key. Try again.'))
    } finally {
      setGeminiKeyBusy(false)
    }
  }

  const toggleBudgets = async () => {
    const enabled = !featureFlags.budgets
    if (enabled && !window.confirm('Enable budgets? This stores private budget envelopes and compares them with your categorized completed expenses. It will not create entries, move money, or block transactions.')) return
    if (!enabled && !window.confirm('Turn budgets off? Your budget data will be kept and will return if you enable budgets again.')) return
    setFeatureBusy(true); setFeatureError('')
    try { await setOptionalFeature('budgets', enabled) }
    catch (error) { setFeatureError(safeCaughtErrorMessage(error, 'Could not update this feature setting. Try again.')) }
    finally { setFeatureBusy(false) }
  }

  const toggleCalculators = async () => {
    const enabled = !featureFlags.calculators
    if (enabled && !window.confirm('Enable read-only calculators? They use values you enter, save no scenarios, and never create or change financial records.')) return
    setFeatureBusy(true); setFeatureError('')
    try { await setOptionalFeature('calculators', enabled) }
    catch (error) { setFeatureError(safeCaughtErrorMessage(error, 'Could not update this feature setting. Try again.')) }
    finally { setFeatureBusy(false) }
  }

  const toggleSavingsGoals = async () => {
    const enabled = !featureFlags.savings_goals
    if (enabled && !window.confirm('Enable savings goals? Goals and contributions are private planning records only. They will not link to transactions, affect account balances, or move money.')) return
    if (!enabled && !window.confirm('Turn savings goals off? Your goals and contributions will be kept and return if you enable this module again.')) return
    setFeatureBusy(true); setFeatureError('')
    try { await setOptionalFeature('savings_goals', enabled) }
    catch (error) { setFeatureError(safeCaughtErrorMessage(error, 'Could not update this feature setting. Try again.')) }
    finally { setFeatureBusy(false) }
  }

  const toggleShoppingLists = async () => {
    const enabled = !featureFlags.shopping_lists
    if (enabled && !window.confirm('Enable shopping lists? Items and expected costs are private planning records. Marking an item purchased will not create a transaction or update an account.')) return
    if (!enabled && !window.confirm('Turn shopping lists off? Your lists and items will be kept and return if you enable this module again.')) return
    setFeatureBusy(true); setFeatureError('')
    try { await setOptionalFeature('shopping_lists', enabled) }
    catch (error) { setFeatureError(safeCaughtErrorMessage(error, 'Could not update this feature setting. Try again.')) }
    finally { setFeatureBusy(false) }
  }

  const toggleAccountHealth = async () => {
    const enabled = !featureFlags.account_health
    if (enabled && !window.confirm('Enable account health context? You can set your own minimum balances and statement/due days. RR Capital will show only rule-based warnings on Accounts; it will not change balances, fetch bank data, or calculate amounts due.')) return
    if (!enabled && !window.confirm('Turn account health off? Your thresholds and due-day settings will be kept and return if you enable the module again.')) return
    setFeatureBusy(true); setFeatureError('')
    try { await setOptionalFeature('account_health', enabled) }
    catch (error) { setFeatureError(safeCaughtErrorMessage(error, 'Could not update this feature setting. Try again.')) }
    finally { setFeatureBusy(false) }
  }

  const toggleFinancialHealthScore = async () => {
    const enabled = !featureFlags.financial_health_score
    if (enabled && !window.confirm('Enable the private wellness indicator? It is read-only, uses only eligible personal records, and is not a credit score or financial advice.')) return
    if (!enabled && !window.confirm('Turn the wellness indicator off? No score data is stored, and your financial records will be unchanged.')) return
    setFeatureBusy(true); setFeatureError('')
    try { await setOptionalFeature('financial_health_score', enabled) }
    catch (error) { setFeatureError(safeCaughtErrorMessage(error, 'Could not update this feature setting. Try again.')) }
    finally { setFeatureBusy(false) }
  }

  const toggleGuidedHelp = () => {
    if (!userId) return
    const enabled = !guidedHelpEnabled
    setGuidedHelpState(enabled)
    setGuidedHelpEnabled(userId, enabled)
  }

  const requestTelegramLink = async () => {
    setTelegramBusy(true)
    setTelegramLinkError('')
    setTelegramWebhookWarning('')
    try {
      const { data: setup, error: setupError } = await supabase.functions.invoke('telegram-webhook', { body: { action: 'configure' } })
      if (setupError) {
        let message = 'Could not configure the Telegram bot. Please retry.'
        try {
          const response = setupError.context as Response
          const body = await response?.json()
          if (typeof body?.error === 'string') message = body.error
        } catch { /* Keep the actionable fallback when no response body is available. */ }
        throw new Error(message)
      }
      if (setup?.configured !== true) throw new Error(setup?.error || 'Could not configure the Telegram bot.')
      if (setup?.webhookReady !== true) throw new Error('Telegram accepted the setup, but its webhook could not be verified. Please retry.')
      if (setup.hasDeliveryError) {
        setTelegramWebhookWarning('Telegram reports an earlier delivery error. Try the fresh link below; if the bot still does not reply, contact support.')
      } else if (setup.pendingUpdates > 0) {
        setTelegramWebhookWarning(`Telegram has ${setup.pendingUpdates} queued update${setup.pendingUpdates === 1 ? '' : 's'} to deliver.`)
      }
      const { data, error } = await supabase.rpc('issue_telegram_link_token')
      if (error) throw error
      if (typeof data !== 'string') throw new Error('Could not issue a link code')
      setTelegramToken(data)
      setTelegramExpiresAt(Date.now() + 10 * 60 * 1000)
    } catch (error) {
      setTelegramLinkError(safeCaughtErrorMessage(error, 'Could not create a link code. Try again.'))
    } finally { setTelegramBusy(false) }
  }

  useEffect(() => {
    if (!userId || !telegramToken) return
    const checkLink = async () => {
      if (Date.now() >= telegramExpiresAt) {
        setTelegramToken('')
        setTelegramLinkError('That Telegram link code expired. Tap Link Telegram to create a fresh one.')
        return
      }
      const { data } = await supabase.from('profiles').select('telegram_chat_id').eq('id', userId).single()
      if (data?.telegram_chat_id && data.telegram_chat_id !== originalProfile.telegram_chat_id) {
        setOriginalProfile(prev => ({ ...prev, telegram_chat_id: data.telegram_chat_id }))
        setDraftProfile(prev => ({ ...prev, telegram_chat_id: data.telegram_chat_id }))
        setTelegramToken('')
      }
    }
    // Linking remains automatic while Settings is open, without waking the radio
    // every three seconds or polling in a background tab.
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void checkLink()
    }, 8000)
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void checkLink()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [userId, telegramToken, telegramExpiresAt, originalProfile.telegram_chat_id])

  // --- HARDWARE WEBAUTHN REGISTRATION ---
  const registerNewDevice = async () => {
    try {
      if (!window.PublicKeyCredential) {
        alert("This browser does not support device screen-lock authentication.")
        return
      }

      const challenge = window.crypto.getRandomValues(new Uint8Array(32))
      const cred = await navigator.credentials.create({
        publicKey: {
          challenge,
          rp: { name: "RR Capital" },
          user: {
            id: window.crypto.getRandomValues(new Uint8Array(16)),
            name: draftProfile.username || "user",
            displayName: draftProfile.full_name || "User"
          },
          pubKeyCredParams: [{ alg: -7, type: "public-key" }, { alg: -257, type: "public-key" }],
          authenticatorSelection: { userVerification: "required", authenticatorAttachment: "platform" },
          timeout: 60000,
          attestation: "none"
        }
      }) as PublicKeyCredential

      if (cred) {
        const rawId = arrayBufferToBase64(cred.rawId)
        const deviceName = prompt("Name this device (e.g., iPhone 15, Macbook Pro):") || "Unknown Device"
        
        const existingDevices = draftProfile.registered_devices || []
        if (existingDevices.some((device: { id: string }) => device.id === rawId)) {
          alert('This device is already registered.')
          return
        }
        const newDevice = { id: rawId, name: deviceName, added_at: new Date().toISOString() }
        const updatedDevices = [...existingDevices, newDevice]
        
        setDraftProfile({ ...draftProfile, registered_devices: updatedDevices })
      }
    } catch {
      alert('Biometric registration failed. Check your device settings and try again.')
    }
  }

  const removeDevice = (deviceId: string) => {
    const updatedDevices = (draftProfile.registered_devices || []).filter(d => d.id !== deviceId)
    setDraftProfile({ ...draftProfile, registered_devices: updatedDevices })
  }

  const toggleAutoLock = () => {
    const newVal = !autoLock
    const savedDevices = JSON.parse(localStorage.getItem('financial_os_devices') || '[]')
    const hasSavedBiometric = localStorage.getItem('financial_os_bio_enabled') === 'true' && savedDevices.length > 0
    if (newVal && !hasPinConfigured && !hasSavedBiometric) {
      alert('Set a four-digit app PIN, or save Biometric / FaceID Lock with a registered device first.')
      return
    }
    setAutoLock(newVal)
    localStorage.setItem('financial_os_autolock', String(newVal))
  }

  const updatePinDraft = (value: string) => {
    const pin = value.replace(/\D/g, '').substring(0, 4)
    setSavedPin(pin)
    if (pin.length === 4) {
      setIsPinSaving(true)
      void storeAppPin(pin).then(() => {
        setHasPinConfigured(true)
        setSavedPin('')
      }).catch(() => alert('Could not securely save the app PIN in this browser.')).finally(() => setIsPinSaving(false))
    }
  }

  const clearAppPin = async () => {
    const savedDevices = JSON.parse(localStorage.getItem('financial_os_devices') || '[]')
    const hasSavedBiometric = localStorage.getItem('financial_os_bio_enabled') === 'true' && savedDevices.length > 0
    if (autoLock && !hasSavedBiometric) {
      alert('Disable Auto-Lock or enable a registered device screen lock before removing the PIN.')
      return
    }
    await removeAppPin()
    setHasPinConfigured(false)
    setSavedPin('')
  }

  const renderUndo = (key: keyof typeof defaultProfile) => {
    if (JSON.stringify(originalProfile[key]) === JSON.stringify(draftProfile[key])) return null
    return (
      <span className="text-amber-400 font-bold flex items-center gap-1">
        Modified 
        <button onClick={() => setDraftProfile(prev => ({...prev, [key]: originalProfile[key]}))} className="hover:text-amber-300 ml-1 transition-colors">
          <RotateCcw className="w-3 h-3" />
        </button>
      </span>
    )
  }

  const query = searchQuery.toLowerCase()
  const showProfile = 'profile name username identity'.includes(query) || query === ''
  const showAppearance = 'theme appearance color dark light'.includes(query) || query === ''
  const showIntegration = 'ai key openai gemini claude chatgpt integration telegram bot'.includes(query) || query === ''
  const showSecurity = 'security lock auto password biometric danger delete pin time faceid touchid'.includes(query) || query === ''
  const showModules = 'optional features modules budgets envelopes planning calculators guided help tips savings goals shopping lists account health minimum balance due date credit financial wellness score'.includes(query) || query === ''

  if (isLoading) {
    return (
      <div className="p-4 sm:p-6 w-full max-w-4xl mx-auto pb-32 animate-pulse" aria-label="Loading settings">
        <div className="mb-8 space-y-3"><div className="h-8 w-40 rounded-lg bg-white/10"/><div className="h-4 w-80 max-w-full rounded bg-white/5"/></div>
        <div className="mb-6 h-12 rounded-2xl border border-white/10 bg-white/5"/>
        <div className="space-y-4">{[0,1,2,3,4].map(i => <div key={i} className="h-24 rounded-2xl border border-white/10 bg-white/5 p-5"><div className="h-4 w-36 rounded bg-white/10"/><div className="mt-4 h-3 w-2/3 rounded bg-white/5"/></div>)}</div>
      </div>
    )
  }

  return (
    <div className="page-shell w-full max-w-4xl mx-auto animate-in fade-in duration-300 pb-32">
      
      <PageHeader title="Settings" description="Manage your identity, integrations, and security." icon={<SettingsIcon className="text-emerald-400" />} action={<div className="relative w-full md:w-72">
          <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input 
            type="text" 
            placeholder="Search settings..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-slate-900 border border-slate-700 rounded-xl pl-10 pr-4 py-3 text-sm outline-none focus:border-emerald-500/50 transition-colors placeholder:text-slate-500"
          />
        </div>} actionClassName="md:w-72" />

      {isProfileModified && (
        <div className="sticky top-4 z-50 mb-8 p-4 bg-indigo-500/10 border border-indigo-500/30 backdrop-blur-xl rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-4 shadow-2xl animate-in slide-in-from-top-4">
          <div className="flex items-center text-indigo-300 font-medium">
            <Save className="w-5 h-5 mr-2" /> You have unsaved changes
          </div>
          <div className="flex gap-3 w-full sm:w-auto">
            <button 
              onClick={() => setDraftProfile(originalProfile)}
              className="flex-1 sm:flex-none px-6 py-2 bg-white/5 hover:bg-white/10 text-white rounded-xl font-bold transition-all border border-white/10"
            >
              Discard
            </button>
            <button 
              onClick={handleSaveProfile}
              disabled={isSavingProfile}
              className="flex-1 sm:flex-none flex items-center justify-center px-6 py-2 bg-indigo-500 hover:bg-indigo-600 text-white rounded-xl font-bold transition-all disabled:opacity-50"
            >
              {isSavingProfile ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Save All Changes
            </button>
          </div>
        </div>
      )}

      <div className="space-y-6">

        <section id="app-updates" className="surface-panel scroll-mt-20 rounded-3xl p-6 md:p-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[var(--brand-tint)] text-[var(--brand-primary-active)]"><Download className="h-5 w-5" /></span><div><h2 className="text-xl font-bold">App updates</h2><p className="mt-1 text-sm text-[var(--muted)]">Check for the latest RR Capital version and review its release notes.</p></div></div>
            <button type="button" onClick={() => void checkForAppUpdate()} disabled={checkingAppUpdate} className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--surface-soft)] px-4 text-sm font-semibold text-[var(--ink)] hover:bg-[var(--surface-strong)] disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${checkingAppUpdate ? 'animate-spin' : ''}`} />{checkingAppUpdate ? 'Checking…' : 'Check for updates'}</button>
          </div>
          {appUpdateStatus && <p role="status" className="mt-3 text-sm text-[var(--muted)]">{appUpdateStatus}</p>}
          {lastAppUpdateCheck && <p className="mt-1 text-xs text-[var(--muted-soft)]">Last checked {new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(lastAppUpdateCheck))}</p>}
          {appUpdateAvailable && <div className="mt-5 rounded-2xl border border-[var(--brand-primary)]/30 bg-[var(--brand-tint)] p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--brand-primary-active)]">New version available · {releaseInfo.version}</p><p className="mt-1 text-xs text-[var(--muted)]">Released {new Intl.DateTimeFormat('en-IN', { dateStyle: 'long', timeStyle: 'short' }).format(new Date(releaseInfo.releasedAt))}</p></div><button type="button" onClick={installAppUpdate} className="min-h-10 rounded-xl bg-[var(--brand-primary)] px-4 text-sm font-semibold text-white hover:bg-[var(--brand-primary-active)]">Install update</button></div></div>}
          <div className="mt-5 border-t border-[var(--line)] pt-4"><p className="text-sm font-semibold">Latest release · {releaseInfo.version}</p><p className="mt-1 text-sm leading-6 text-[var(--muted)]">{releaseInfo.brief}</p><button type="button" aria-expanded={showReleaseDetails} onClick={() => setShowReleaseDetails(value => !value)} className="mt-3 text-sm font-semibold text-[var(--brand-primary-active)] hover:underline">{showReleaseDetails ? 'Hide detailed summary' : 'View detailed summary'}</button>{showReleaseDetails && <ul className="mt-3 space-y-2 pl-5 text-sm leading-6 text-[var(--muted)]">{releaseInfo.details.map(detail => <li key={detail} className="list-disc">{detail}</li>)}</ul>}</div>
        </section>

        {showModules && <section className="surface-panel rounded-3xl p-6 md:p-8">
          <div className="flex items-center justify-between gap-4">
            <div><h2 className="text-xl font-bold">Optional features</h2><p className="text-sm text-slate-400 mt-1">Turn planning tools on only when you want them.</p></div>
            <span className="text-[10px] uppercase tracking-wider text-emerald-300 border border-emerald-400/20 rounded-full px-3 py-1">Personal</span>
          </div>
          <div className="mt-5 flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-black/10 p-4">
            <div><h3 className="font-semibold">Budgets and envelopes</h3><p className="text-xs text-slate-400 mt-1 max-w-xl">Compare categorized personal expenses with monthly plans. Turning this off hides the page and keeps your saved envelopes.</p></div>
            <LiquidSwitch label="Budgets" checked={Boolean(featureFlags.budgets)} disabled={featureBusy} onCheckedChange={() => void toggleBudgets()} />
          </div>
          <div className="mt-3 flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-black/10 p-4">
            <div><h3 className="font-semibold">Account health context</h3><p className="text-xs text-slate-400 mt-1 max-w-xl">Set your own liquid-account minimums and credit statement/due days. Optional warnings appear on Accounts; balances and bills are never changed or inferred.</p></div>
            <LiquidSwitch label="Account health context" checked={Boolean(featureFlags.account_health)} disabled={featureBusy} onCheckedChange={() => void toggleAccountHealth()} />
          </div>
          <div className="mt-3 flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-black/10 p-4">
            <div><h3 className="font-semibold">Calculators</h3><p className="text-xs text-slate-400 mt-1 max-w-xl">Estimate loan payments, compare extra-payoff scenarios, and model savings growth. Inputs are not saved and results do not change your records.</p></div>
            <LiquidSwitch label="Calculators" checked={Boolean(featureFlags.calculators)} disabled={featureBusy} onCheckedChange={() => void toggleCalculators()} />
          </div>
          <div className="mt-3 flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-black/10 p-4">
            <div><h3 className="font-semibold">Savings goals</h3><p className="text-xs text-slate-400 mt-1 max-w-xl">Track private targets with explicit contributions. They are planning values only and never link to accounts or transactions.</p></div>
            <LiquidSwitch label="Savings goals" checked={Boolean(featureFlags.savings_goals)} disabled={featureBusy} onCheckedChange={() => void toggleSavingsGoals()} />
          </div>
          <div className="mt-3 flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-black/10 p-4">
            <div><h3 className="font-semibold">Shopping lists</h3><p className="text-xs text-slate-400 mt-1 max-w-xl">Plan items and expected costs. Purchased state stays inside the list and does not post to the ledger.</p></div>
            <LiquidSwitch label="Shopping lists" checked={Boolean(featureFlags.shopping_lists)} disabled={featureBusy} onCheckedChange={() => void toggleShoppingLists()} />
          </div>
          <div className="mt-3 flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-black/10 p-4">
            <div><h3 className="font-semibold">Financial wellness indicator</h3><p className="text-xs text-slate-400 mt-1 max-w-xl">A private, read-only score based on eligible personal balances and activity. No score is stored; this is not a credit score or financial advice.</p></div>
            <LiquidSwitch label="Financial wellness indicator" checked={Boolean(featureFlags.financial_health_score)} disabled={featureBusy} onCheckedChange={() => void toggleFinancialHealthScore()} />
          </div>
          <div className="mt-3 flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-black/10 p-4">
            <div><h3 className="font-semibold">Guided page tips</h3><p className="text-xs text-slate-400 mt-1 max-w-xl">Show a short dismissible hint the first time you visit each page on this device.</p></div>
            <LiquidSwitch label="Guided page tips" checked={guidedHelpEnabled} onCheckedChange={toggleGuidedHelp} />
          </div>
          <div className="flex justify-end"><button type="button" disabled={!guidedHelpEnabled || !userId} onClick={() => userId && replayGuidance(userId)} className="rounded-xl border border-white/10 px-3 py-2 text-xs text-slate-300 hover:bg-white/5 disabled:opacity-40">Replay page tips</button></div>
          {featureBusy && <p className="mt-3 text-xs text-slate-400">Saving feature setting…</p>}
          {featureError && <p role="alert" className="mt-3 text-xs text-rose-300">{featureError}</p>}
        </section>}
        
        {/* Profile Section */}
        {showProfile && (
          <section className="surface-panel rounded-3xl p-6 md:p-8 backdrop-blur-sm">
            <div className="flex items-center mb-6">
              <div className="w-10 h-10 rounded-xl bg-indigo-500/20 flex items-center justify-center mr-4 border border-indigo-500/20">
                <User className="w-5 h-5 text-indigo-400" />
              </div>
              <div>
                <h2 className="text-xl font-bold">Profile & Identity</h2>
                <p className="text-sm text-slate-400">How you appear to counterparties.</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-3xl">
              <div className="flex flex-col space-y-1">
                <label className="text-xs font-semibold tracking-wide text-white/50 uppercase flex justify-between">
                  <span>Full Name</span> {renderUndo('full_name')}
                </label>
                <input 
                  type="text" value={draftProfile.full_name}
                  onChange={(e) => setDraftProfile({...draftProfile, full_name: e.target.value})}
                  className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-indigo-500/50 transition-colors"
                />
              </div>
              <div className="flex flex-col space-y-1">
                <label className="text-xs font-semibold tracking-wide text-white/50 uppercase flex justify-between">
                  <span>Username</span> {renderUndo('username')}
                </label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 font-bold">@</span>
                  <input 
                    type="text" value={draftProfile.username}
                    onChange={(e) => setDraftProfile({...draftProfile, username: e.target.value})}
                    className="w-full bg-black/20 border border-white/10 rounded-xl pl-10 pr-4 py-3 text-white outline-none focus:border-indigo-500/50 transition-colors"
                  />
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Appearance Section */}
        {showAppearance && (
          <section className="surface-panel rounded-3xl p-6 md:p-8 backdrop-blur-sm">
            <div className="flex items-center mb-6">
              <div className="w-10 h-10 rounded-xl bg-amber-500/20 flex items-center justify-center mr-4 border border-amber-500/20">
                <Palette className="w-5 h-5 text-amber-400" />
              </div>
              <div>
                <h2 className="text-xl font-bold">Appearance</h2>
                <p className="text-sm text-slate-400">Customize the look and feel of your OS.</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-3xl">
              <div className="flex flex-col space-y-1">
                <label className="text-xs font-semibold tracking-wide text-white/50 uppercase flex justify-between">
                  <span>Theme</span> {renderUndo('theme_mode')}
                </label>
                <div role="radiogroup" aria-label="Color theme" className="grid grid-cols-2 gap-3">
                  {(['light', 'dark'] as const).map(mode => {
                    const selected = draftProfile.theme_mode === mode
                    const Icon = mode === 'light' ? Sun : Moon
                    return <button key={mode} type="button" role="radio" aria-checked={selected} onClick={() => setDraftProfile({ ...draftProfile, theme_mode: mode, theme_accent: 'coral' })} className={`flex min-h-24 flex-col items-start justify-between rounded-xl border p-4 text-left transition-colors ${selected ? 'border-[var(--brand-primary)] bg-[var(--brand-tint)]' : 'border-[var(--line)] bg-[var(--surface-card)]'}`}>
                      <Icon className="h-5 w-5 text-[var(--brand-primary)]" />
                      <span className="font-medium">{mode === 'light' ? 'Light' : 'Dark'}</span>
                    </button>
                  })}
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Integrations (AI & Telegram) */}
        {showIntegration && (
          <section className="surface-panel rounded-3xl p-6 md:p-8 backdrop-blur-sm">
            <div className="flex items-center mb-6">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center mr-4 border border-emerald-500/20">
                <Bot className="w-5 h-5 text-emerald-400" />
              </div>
              <div>
                <h2 className="text-xl font-bold">AI & Integrations</h2>
                <p className="text-sm text-slate-400">Configure your external connections.</p>
              </div>
            </div>

            <div className="space-y-6 max-w-3xl">
              <div className="flex flex-col space-y-1">
                <label className="text-xs font-semibold tracking-wide text-white/50 uppercase flex justify-between items-center">
                  <span className="flex items-center"><Key className="w-3 h-3 mr-1" /> Your Gemini API Key (BYOK)</span>
                  <span className={geminiStatusLoading ? 'text-slate-500 normal-case' : geminiKeyConfigured ? 'text-emerald-400 normal-case' : 'text-slate-500 normal-case'}>{geminiStatusLoading ? 'Checking key…' : geminiKeyConfigured ? 'Key saved securely' : 'No key saved'}</span>
                </label>
                <input 
                  type="password" autoComplete="new-password" placeholder="Google Gemini API key" value={geminiKeyDraft}
                  onChange={(e) => setGeminiKeyDraft(e.target.value)}
                  className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-emerald-500/50 transition-colors font-mono"
                />
                <div className="flex flex-wrap items-center gap-3 pt-2">
                  <button type="button" onClick={saveGeminiKey} disabled={geminiStatusLoading || geminiKeyBusy || geminiKeyDraft.trim().length < 20} className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-bold">
                    {geminiKeyBusy ? 'Saving...' : geminiKeyConfigured ? 'Replace key' : 'Save key'}
                  </button>
                  {geminiKeyConfigured && <button type="button" onClick={removeGeminiKey} disabled={geminiStatusLoading || geminiKeyBusy} className="px-4 py-2 rounded-xl border border-white/10 hover:bg-white/5 disabled:opacity-50 text-sm">Remove key</button>}
                  {geminiKeyMessage && <span role="status" className="text-xs text-slate-400">{geminiKeyMessage}</span>}
                </div>
                <p className="text-xs leading-relaxed text-slate-500">Your key is stored encrypted in Supabase Vault. The server uses it only for your scans and never returns it to the browser.</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="flex flex-col space-y-1">
                  <label className="text-xs font-semibold tracking-wide text-white/50 uppercase flex justify-between">
                    <span>LLM Model</span> {renderUndo('ai_model')}
                  </label>
                  <select 
                    value={draftProfile.ai_model}
                    onChange={(e) => setDraftProfile({...draftProfile, ai_model: e.target.value})}
                    className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-emerald-500/50 transition-colors appearance-none"
                  >
                    <optgroup label="Google (Gemini)" className="text-slate-900 font-bold bg-slate-200">
                      <option value="gemini-1.5-flash" className="text-slate-900 font-normal">Gemini 1.5 Flash (Fast)</option>
                      <option value="gemini-1.5-pro" className="text-slate-900 font-normal">Gemini 1.5 Pro (Smart)</option>
                    </optgroup>
                    <optgroup label="OpenAI (ChatGPT)" className="text-slate-900 font-bold bg-slate-200">
                      <option value="gpt-4o" className="text-slate-900 font-normal">GPT-4o (Omni)</option>
                      <option value="gpt-4o-mini" className="text-slate-900 font-normal">GPT-4o Mini</option>
                    </optgroup>
                    <optgroup label="Anthropic (Claude)" className="text-slate-900 font-bold bg-slate-200">
                      <option value="claude-3-5-sonnet-20240620" className="text-slate-900 font-normal">Claude 3.5 Sonnet</option>
                    </optgroup>
                    <optgroup label="xAI" className="text-slate-900 font-bold bg-slate-200">
                      <option value="grok-2" className="text-slate-900 font-normal">Grok 2</option>
                    </optgroup>
                  </select>
                </div>
                
                <div className="flex flex-col space-y-1">
                  <label className="text-xs font-semibold tracking-wide text-white/50 uppercase flex justify-between">
                    <span>Persona</span>
                    {renderUndo('ai_persona')}
                  </label>
                  <select 
                    value={draftProfile.ai_persona}
                    onChange={(e) => setDraftProfile({...draftProfile, ai_persona: e.target.value})}
                    className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-emerald-500/50 transition-colors appearance-none"
                  >
                    <option value="Analyst" className="text-slate-900">Analyst</option>
                    <option value="Auditor" className="text-slate-900">Strict Auditor</option>
                    <option value="Coach" className="text-slate-900">Wealth Coach</option>
                  </select>
                  <details className="group text-xs text-slate-500">
                    <summary className="inline-flex cursor-pointer list-none items-center gap-1 py-1 hover:text-slate-300"><Info className="w-3.5 h-3.5" />Persona guide</summary>
                    <p className="mt-2 rounded-xl border border-white/10 bg-white/5 p-3 leading-relaxed">Analyst is data-driven and concise. Strict Auditor is critical of spending. Wealth Coach is encouraging and positive.</p>
                  </details>
                </div>
              </div>

              <hr className="border-white/10 my-2" />

              <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4 space-y-3">
                <div className="flex items-center justify-between gap-3"><div><p className="font-semibold">Link Telegram</p><p className="text-sm text-slate-400">{originalProfile.telegram_chat_id ? 'Chat ID on file. Use the bot to verify or change it.' : 'Connect your private Telegram chat for alerts.'}</p></div><button type="button" onClick={() => void requestTelegramLink()} disabled={telegramBusy} className="shrink-0 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50">{telegramBusy ? 'Working…' : 'Link Telegram'}</button></div>
                {telegramToken && <div className="text-sm text-slate-300 space-y-2"><p>The bot webhook is verified. Open the bot and tap <strong>Start</strong> within 10 minutes (or send this command):</p><code className="block p-3 rounded-xl bg-black/30 break-all select-all">/start {telegramToken}</code><a className="inline-block text-emerald-300 underline" target="_blank" rel="noopener noreferrer" href={`https://t.me/${telegramBotUsername}?start=${encodeURIComponent(telegramToken)}`}>Open @{telegramBotUsername}</a><p>Keep this page open; it will confirm the link automatically. If Telegram only shows a Start button, tap it once in the private chat.</p></div>}
                {telegramWebhookWarning && <p role="status" className="text-sm text-amber-300">{telegramWebhookWarning}</p>}
                {telegramLinkError && <p role="alert" className="text-sm text-rose-300">{telegramLinkError}</p>}
              </div>

              <p className="text-xs leading-relaxed text-slate-500">Linking or changing the destination requires opening the bot from this signed-in account. This verifies that you control both the RR Capital account and the Telegram chat.</p>
            </div>
          </section>
        )}

        {/* Security & Toggles */}
        {showSecurity && (
          <section className="surface-panel rounded-3xl p-6 md:p-8 backdrop-blur-sm">
            <div className="flex items-center mb-6">
              <div className="w-10 h-10 rounded-xl bg-amber-500/20 flex items-center justify-center mr-4 border border-amber-500/20">
                <Lock className="w-5 h-5 text-amber-400" />
              </div>
              <div>
                <h2 className="text-xl font-bold">Security Preferences</h2>
                <p className="text-sm text-slate-400">Manage locking and authentication.</p>
              </div>
            </div>

            <div className="max-w-3xl space-y-4">
              
              {/* Auto Lock Control Block */}
              <div className="flex flex-col p-4 bg-black/20 border border-white/5 rounded-2xl transition-all">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-bold text-white flex items-center">
                      <Lock className="w-4 h-4 mr-2 text-slate-400" /> Auto-Lock Interface
                    </h3>
                    <p className="text-sm text-slate-400 mt-1">Local convenience lock only. Use an app PIN or a registered device screen lock (biometric or device passcode).</p>
                  </div>
                  <LiquidSwitch label="Auto-Lock Interface" checked={autoLock} onCheckedChange={toggleAutoLock} />
                </div>

                {autoLock && (
                  <div className="mt-4 pt-4 border-t border-white/10 grid grid-cols-1 md:grid-cols-2 gap-4 animate-in fade-in">
                    <div className="flex flex-col space-y-1">
                      <label className="text-xs font-semibold tracking-wide text-white/50 uppercase">Timeout Duration</label>
                      <select 
                        value={lockTime}
                        onChange={(e) => {
                          setLockTime(e.target.value)
                          localStorage.setItem('financial_os_lock_time', e.target.value)
                        }}
                        className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white outline-none focus:border-amber-500/50 transition-colors appearance-none"
                      >
                        <option value="1" className="text-slate-900">1 Minute</option>
                        <option value="3" className="text-slate-900">3 Minutes</option>
                        <option value="5" className="text-slate-900">5 Minutes</option>
                        <option value="10" className="text-slate-900">10 Minutes</option>
                      </select>
                    </div>
                    
                    <div className="flex flex-col space-y-1">
                      <label className="text-xs font-semibold tracking-wide text-white/50 uppercase">Optional 4-Digit App PIN</label>
                      <input
                        type="password" inputMode="numeric" autoComplete="new-password" pattern="[0-9]*" maxLength={4} value={savedPin} disabled={isPinSaving}
                        onChange={(e) => updatePinDraft(e.target.value)}
                        placeholder={hasPinConfigured ? 'Enter to replace' : 'Set 4-digit PIN'}
                        className="w-full text-center tracking-[0.5em] font-black bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-white outline-none focus:border-amber-500/50 transition-colors"
                      />
                      <p className="text-[11px] text-white/45">{hasPinConfigured ? 'A PIN is set. Enter four digits to replace it.' : 'Stored as a salted verifier on this device.'}</p>
                      {hasPinConfigured && <button type="button" onClick={() => void clearAppPin()} className="self-start text-xs text-rose-300 hover:text-rose-200">Remove app PIN</button>}
                    </div>
                  </div>
                )}
              </div>

              {/* WebAuthn / Biometrics Engine */}
              <div className="flex flex-col p-4 bg-black/20 border border-white/5 rounded-2xl transition-all">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-bold text-white flex items-center justify-between">
                      <span className="flex items-center"><Fingerprint className="w-4 h-4 mr-2 text-slate-400" /> Biometric / FaceID Lock</span>
                      <span className="ml-4">{renderUndo('is_biometric_enabled')}</span>
                    </h3>
                    <p className="text-sm text-slate-400 mt-1">Register devices to unlock the app with FaceID or TouchID.</p>
                  </div>
                  <button 
                    onClick={() => setDraftProfile({...draftProfile, is_biometric_enabled: !draftProfile.is_biometric_enabled})}
                    className={`w-14 h-8 rounded-full transition-colors relative flex-shrink-0 ${draftProfile.is_biometric_enabled ? 'bg-amber-500' : 'bg-slate-700'}`}
                  >
                    <div className={`w-6 h-6 bg-white rounded-full absolute top-1 transition-transform ${draftProfile.is_biometric_enabled ? 'translate-x-7' : 'translate-x-1'}`}></div>
                  </button>
                </div>

                {draftProfile.is_biometric_enabled && (
                  <div className="mt-4 pt-4 border-t border-white/10 animate-in fade-in">
                    <div className="flex justify-between items-center mb-3">
                      <label className="text-xs font-semibold tracking-wide text-white/50 uppercase">Registered Devices</label>
                      <button 
                        onClick={registerNewDevice}
                        className="flex items-center text-xs font-bold text-emerald-400 hover:text-emerald-300 transition-colors bg-emerald-500/10 px-2 py-1 rounded-lg"
                      >
                        <Plus className="w-3 h-3 mr-1" /> Add Device
                      </button>
                    </div>

                    <div className="space-y-2">
                      {draftProfile.registered_devices.map(device => (
                        <div key={device.id} className="flex items-center justify-between p-3 bg-black/40 border border-white/5 rounded-xl">
                          <div className="flex items-center">
                            {device.name.toLowerCase().includes('phone') ? <Smartphone className="w-4 h-4 text-slate-400 mr-3" /> : <Laptop className="w-4 h-4 text-slate-400 mr-3" />}
                            <div>
                              <p className="text-sm font-semibold text-white">{device.name}</p>
                              <p className="text-[10px] text-slate-500">Added {formatIndiaDate(device.added_at)}</p>
                            </div>
                          </div>
                          <button onClick={() => removeDevice(device.id)} aria-label={`Remove device ${device.name || device.id}`} title="Remove device" className="p-2 text-rose-500 hover:bg-rose-500/10 rounded-lg transition-colors">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                      {draftProfile.registered_devices.length === 0 && (
                        <div className="p-4 text-center border border-dashed border-white/10 rounded-xl">
                          <p className="text-sm text-slate-500">No devices registered. Add this device to use its biometrics or device passcode for Auto-Lock.</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </section>
        )}
      </div>

      {/* NEW: Sign Out Button */}
      <section className="mt-8 pt-4 border-t border-white/10">
        <button
          type="button"
          onClick={() => void signOut()}
          disabled={isSigningOut}
          className="w-full flex items-center justify-center p-4 bg-white/5 hover:bg-rose-500/10 border border-white/10 hover:border-rose-500/20 rounded-2xl text-slate-300 hover:text-rose-400 transition-colors disabled:cursor-wait disabled:opacity-60"
        >
          {isSigningOut ? <Loader2 className="w-5 h-5 mr-3 animate-spin" /> : <LogOut className="w-5 h-5 mr-3" />}
          <span className="font-bold">{isSigningOut ? 'Signing out…' : 'Sign Out of RR Capital'}</span>
        </button>
        {signOutError && <p role="alert" className="mt-3 text-center text-sm text-rose-400">{signOutError}</p>}
        <p className="mt-3 text-center text-xs text-slate-500">Saved offline transactions stay on this browser until they sync or you discard them.</p>
      </section>

    </div>
  )
}

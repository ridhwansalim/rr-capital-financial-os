import React, { useState, useEffect } from 'react'
import { Settings as SettingsIcon, Search, User, Key, Lock, ShieldAlert, RotateCcw, Save, ChevronDown, ChevronUp, Trash2, Loader2, Palette, Bot, Bell, Shield, MessageSquare, Info, Fingerprint, Plus, Laptop, Smartphone, LogOut } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useTheme } from '../components/ThemeProvider'

// WebAuthn Helper to encode hardware keys
const arrayBufferToBase64 = (buffer: ArrayBuffer) => {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
}

export default function Settings() {
  const { setTheme } = useTheme()
  const [searchQuery, setSearchQuery] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSavingProfile, setIsSavingProfile] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)

  const defaultProfile = {
    full_name: '',
    username: '',
    theme_mode: 'dark',
    theme_accent: 'emerald',
    ai_api_key: '',
    ai_model: 'gemini-1.5-flash',
    ai_persona: 'Analyst',
    telegram_chat_id: '',
    is_biometric_enabled: false,
    registered_devices: [] as any[]
  }
  const [originalProfile, setOriginalProfile] = useState(defaultProfile)
  const [draftProfile, setDraftProfile] = useState(defaultProfile)

  // Local Security State
  const [autoLock, setAutoLock] = useState(false)
  const [lockTime, setLockTime] = useState('3')
  const [savedPin, setSavedPin] = useState('')
  const [deleteConfirmText, setDeleteConfirmText] = useState('')

  useEffect(() => {
    if (draftProfile.theme_mode && draftProfile.theme_accent) {
      setTheme(draftProfile.theme_mode, draftProfile.theme_accent)
    }
  }, [draftProfile.theme_mode, draftProfile.theme_accent, setTheme])

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
          setUserId(user.id)
          const { data } = await supabase.from('profiles').select('*').eq('id', user.id).single()
          if (data) {
            const loadedProfile = { ...defaultProfile, ...data, registered_devices: data.registered_devices || [] }
            setOriginalProfile(loadedProfile)
            setDraftProfile(loadedProfile)
            
            // Sync AI Key and Biometric Devices to Local Storage for Lock Screen / Scanners
            if (loadedProfile.ai_api_key) localStorage.setItem('financial_os_ai_key', loadedProfile.ai_api_key)
            localStorage.setItem('financial_os_devices', JSON.stringify(loadedProfile.registered_devices))
            localStorage.setItem('financial_os_bio_enabled', loadedProfile.is_biometric_enabled ? 'true' : 'false')
          }
        }

        setAutoLock(localStorage.getItem('financial_os_autolock') === 'true')
        setLockTime(localStorage.getItem('financial_os_lock_time') || '3')
        setSavedPin(localStorage.getItem('financial_os_pin') || '')

      } catch (error) {
        console.error('Error fetching settings:', error)
      } finally {
        setIsLoading(false)
      }
    }
    fetchSettings()
  }, [])

  const isProfileModified = JSON.stringify(originalProfile) !== JSON.stringify(draftProfile)

  const handleSaveProfile = async () => {
    setIsSavingProfile(true)
    try {
      if (!userId) throw new Error('No user found')
      const { error } = await supabase.from('profiles').update(draftProfile).eq('id', userId)
      if (error) throw error
      
      setOriginalProfile(draftProfile)
      localStorage.setItem('financial_os_ai_key', draftProfile.ai_api_key)
      localStorage.setItem('financial_os_devices', JSON.stringify(draftProfile.registered_devices))
      localStorage.setItem('financial_os_bio_enabled', draftProfile.is_biometric_enabled ? 'true' : 'false')
    } catch (error) {
      alert('Failed to save settings.')
    } finally {
      setIsSavingProfile(false)
    }
  }

  // --- HARDWARE WEBAUTHN REGISTRATION ---
  const registerNewDevice = async () => {
    try {
      if (!window.PublicKeyCredential) {
        alert("Your browser or device does not support Biometric WebAuthn.")
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
        
        const newDevice = { id: rawId, name: deviceName, added_at: new Date().toISOString() }
        const updatedDevices = [...draftProfile.registered_devices, newDevice]
        
        setDraftProfile({ ...draftProfile, registered_devices: updatedDevices })
      }
    } catch (err: any) {
      alert("Biometric registration failed: " + err.message)
    }
  }

  const removeDevice = (deviceId: string) => {
    const updatedDevices = draftProfile.registered_devices.filter(d => d.id !== deviceId)
    setDraftProfile({ ...draftProfile, registered_devices: updatedDevices })
  }

  const toggleAutoLock = () => {
    const newVal = !autoLock
    setAutoLock(newVal)
    localStorage.setItem('financial_os_autolock', String(newVal))
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

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-40">
        <Loader2 className="w-10 h-10 animate-spin text-emerald-500 mb-4" />
        <p className="text-slate-400 font-medium">Loading preferences...</p>
      </div>
    )
  }

  return (
    <div className="p-6 w-full max-w-4xl mx-auto text-white animate-in fade-in duration-300 pb-32">
      
      <div className="flex flex-col md:flex-row md:justify-between md:items-end mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-bold flex items-center">
            <SettingsIcon className="w-8 h-8 mr-3 text-emerald-400" />
            Settings
          </h1>
          <p className="text-slate-400 mt-1">Manage your identity, integrations, and security.</p>
        </div>
        <div className="relative w-full md:w-72">
          <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input 
            type="text" 
            placeholder="Search settings..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-slate-900 border border-slate-700 rounded-xl pl-10 pr-4 py-3 text-sm outline-none focus:border-emerald-500/50 transition-colors placeholder:text-slate-500"
          />
        </div>
      </div>

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
        
        {/* Profile Section */}
        {showProfile && (
          <section className="bg-white/5 border border-white/10 rounded-3xl p-6 md:p-8 backdrop-blur-sm">
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
          <section className="bg-white/5 border border-white/10 rounded-3xl p-6 md:p-8 backdrop-blur-sm">
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
                  <span>Base Mode</span> {renderUndo('theme_mode')}
                </label>
                <select 
                  value={draftProfile.theme_mode}
                  onChange={(e) => setDraftProfile({...draftProfile, theme_mode: e.target.value})}
                  className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-amber-500/50 transition-colors appearance-none"
                >
                  <option value="dark" className="text-slate-900">Dark Glass (Default)</option>
                  <option value="amoled" className="text-slate-900">Pitch Black (OLED)</option>
                  <option value="light" className="text-slate-900">Light Glass</option>
                  <option value="auto" className="text-slate-900">System Auto</option>
                </select>
              </div>
              <div className="flex flex-col space-y-1">
                <label className="text-xs font-semibold tracking-wide text-white/50 uppercase flex justify-between">
                  <span>Accent Color</span> {renderUndo('theme_accent')}
                </label>
                <select 
                  value={draftProfile.theme_accent}
                  onChange={(e) => setDraftProfile({...draftProfile, theme_accent: e.target.value})}
                  className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-amber-500/50 transition-colors appearance-none"
                >
                  <option value="emerald" className="text-slate-900">Emerald Green</option>
                  <option value="blue" className="text-slate-900">Ocean Blue</option>
                  <option value="orange" className="text-slate-900">Sunset Orange</option>
                  <option value="yellow" className="text-slate-900">Gold</option>
                  <option value="brown" className="text-slate-900">Leather Brown</option>
                </select>
              </div>
            </div>
          </section>
        )}

        {/* Integrations (AI & Telegram) */}
        {showIntegration && (
          <section className="bg-white/5 border border-white/10 rounded-3xl p-6 md:p-8 backdrop-blur-sm">
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
                  <span className="flex items-center"><Key className="w-3 h-3 mr-1" /> Provider API Key (BYOK)</span>
                  {renderUndo('ai_api_key')}
                </label>
                <input 
                  type="password" placeholder="sk-proj... or AIzaSy..." value={draftProfile.ai_api_key}
                  onChange={(e) => setDraftProfile({...draftProfile, ai_api_key: e.target.value})}
                  className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-emerald-500/50 transition-colors font-mono"
                />
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
                  <label className="text-xs font-semibold tracking-wide text-white/50 uppercase flex justify-between group relative z-10">
                    <span className="flex items-center">
                      Persona
                      <div className="ml-1.5 relative flex items-center justify-center">
                        <Info className="w-3.5 h-3.5 text-white/40 cursor-help hover:text-emerald-400 transition-colors" />
                        <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 w-64 p-4 bg-slate-800 border border-slate-600 rounded-xl shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all pointer-events-none">
                          <p className="text-xs text-slate-300 leading-relaxed">
                            <strong className="text-white block mb-0.5">Analyst:</strong> Data-driven and concise.<br/>
                            <strong className="text-white block mb-0.5">Strict Auditor:</strong> Highly critical of spending.<br/>
                            <strong className="text-white block mb-0.5">Wealth Coach:</strong> Encouraging and positive.
                          </p>
                        </div>
                      </div>
                    </span> 
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
                </div>
              </div>

              <hr className="border-white/10 my-2" />

              <div className="flex flex-col space-y-1">
                <label className="text-xs font-semibold tracking-wide text-white/50 uppercase flex justify-between items-center">
                  <span className="flex items-center"><MessageSquare className="w-3 h-3 mr-1" /> Telegram Chat ID</span>
                  {renderUndo('telegram_chat_id')}
                </label>
                <input 
                  type="text" placeholder="Enter Chat ID..." value={draftProfile.telegram_chat_id}
                  onChange={(e) => setDraftProfile({...draftProfile, telegram_chat_id: e.target.value})}
                  className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-emerald-500/50 transition-colors"
                />
              </div>
            </div>
          </section>
        )}

        {/* Security & Toggles */}
        {showSecurity && (
          <section className="bg-white/5 border border-white/10 rounded-3xl p-6 md:p-8 backdrop-blur-sm">
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
                    <p className="text-sm text-slate-400 mt-1">Require a PIN after inactivity.</p>
                  </div>
                  <button 
                    onClick={toggleAutoLock}
                    className={`w-14 h-8 rounded-full transition-colors relative flex-shrink-0 ${autoLock ? 'bg-amber-500' : 'bg-slate-700'}`}
                  >
                    <div className={`w-6 h-6 bg-white rounded-full absolute top-1 transition-transform ${autoLock ? 'translate-x-7' : 'translate-x-1'}`}></div>
                  </button>
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
                      <label className="text-xs font-semibold tracking-wide text-white/50 uppercase">4-Digit PIN</label>
                      <input 
                        type="password" maxLength={4} value={savedPin}
                        onChange={(e) => {
                          const val = e.target.value.replace(/\D/g, '').substring(0, 4)
                          setSavedPin(val)
                          localStorage.setItem('financial_os_pin', val)
                        }}
                        placeholder="0000"
                        className="w-full text-center tracking-[0.5em] font-black bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-white outline-none focus:border-amber-500/50 transition-colors"
                      />
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
                              <p className="text-[10px] text-slate-500">Added {new Date(device.added_at).toLocaleDateString()}</p>
                            </div>
                          </div>
                          <button onClick={() => removeDevice(device.id)} className="p-2 text-rose-500 hover:bg-rose-500/10 rounded-lg transition-colors">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                      {draftProfile.registered_devices.length === 0 && (
                        <div className="p-4 text-center border border-dashed border-white/10 rounded-xl">
                          <p className="text-sm text-slate-500">No devices registered. Add this device to enable Biometrics.</p>
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
          onClick={async () => {
            await supabase.auth.signOut()
            window.location.href = '/auth'
          }}
          className="w-full flex items-center justify-center p-4 bg-white/5 hover:bg-rose-500/10 border border-white/10 hover:border-rose-500/20 rounded-2xl text-slate-300 hover:text-rose-400 transition-colors"
        >
          <LogOut className="w-5 h-5 mr-3" />
          <span className="font-bold">Sign Out of RR Capital</span>
        </button>
      </section>

    </div>
  )
}
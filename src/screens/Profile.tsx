import { useState, useEffect } from 'react'
import { Settings as SettingsIcon, Search, User, Key, Lock, ShieldAlert, RotateCcw, Save, ChevronDown, ChevronUp, Trash2, CheckCircle2, Loader2 } from 'lucide-react'
import { supabase } from '../lib/supabase'

export default function Settings() {
  const [searchQuery, setSearchQuery] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSavingProfile, setIsSavingProfile] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)

  // 1. Identity Data (Requires Explicit Save)
  const [originalProfile, setOriginalProfile] = useState({ full_name: '', username: '' })
  const [draftProfile, setDraftProfile] = useState({ full_name: '', username: '' })

  // 2. AI BYOK Data (Requires Explicit Save, stored locally)
  const [originalAiKey, setOriginalAiKey] = useState('')
  const [draftAiKey, setDraftAiKey] = useState('')
  const [isAiSaved, setIsAiSaved] = useState(false)

  // 3. Toggles (Instant Save)
  const [autoLock, setAutoLock] = useState(false)

  // 4. Danger Zone
  const [deleteConfirmText, setDeleteConfirmText] = useState('')

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        // Fetch Profile from Supabase
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
          const { data } = await supabase.from('profiles').select('full_name, username').eq('id', user.id).single()
          if (data) {
            setOriginalProfile({ full_name: data.full_name || '', username: data.username || '' })
            setDraftProfile({ full_name: data.full_name || '', username: data.username || '' })
          }
        }

        // Fetch AI Key & Preferences from localStorage (BYOK)
        const savedKey = localStorage.getItem('financial_os_ai_key') || ''
        setOriginalAiKey(savedKey)
        setDraftAiKey(savedKey)

        const savedAutoLock = localStorage.getItem('financial_os_autolock') === 'true'
        setAutoLock(savedAutoLock)

      } catch (error) {
        console.error('Error fetching settings:', error)
      } finally {
        setIsLoading(false)
      }
    }
    fetchSettings()
  }, [])

  // Check if sections have unsaved modifications
  const isProfileModified = JSON.stringify(originalProfile) !== JSON.stringify(draftProfile)
  const isAiModified = originalAiKey !== draftAiKey

  // Explicit Save Handlers
  const handleSaveProfile = async () => {
    setIsSavingProfile(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('No user found')

      const { error } = await supabase
        .from('profiles')
        .update({ full_name: draftProfile.full_name, username: draftProfile.username })
        .eq('id', user.id)

      if (error) throw error
      setOriginalProfile(draftProfile)
    } catch (error) {
      console.error('Error saving profile:', error)
    } finally {
      setIsSavingProfile(false)
    }
  }

  const handleSaveAiKey = () => {
    localStorage.setItem('financial_os_ai_key', draftAiKey)
    setOriginalAiKey(draftAiKey)
    setIsAiSaved(true)
    setTimeout(() => setIsAiSaved(false), 3000)
  }

  // Instant Save Handlers
  const toggleAutoLock = () => {
    const newVal = !autoLock
    setAutoLock(newVal)
    localStorage.setItem('financial_os_autolock', String(newVal))
  }

  // Search Filtering Logic
  const query = searchQuery.toLowerCase()
  const showProfile = 'profile name username identity'.includes(query) || query === ''
  const showIntegration = 'ai key openai gemini integration'.includes(query) || query === ''
  const showSecurity = 'security lock auto password'.includes(query) || query === ''

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
      
      {/* Header & Search */}
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

      <div className="space-y-8">
        
        {/* Profile Section (Explicit Save) */}
        {showProfile && (
          <section className="bg-white/5 border border-white/10 rounded-3xl p-6 md:p-8 backdrop-blur-sm relative">
            <div className="flex items-center mb-6">
              <div className="w-10 h-10 rounded-xl bg-indigo-500/20 flex items-center justify-center mr-4 border border-indigo-500/20">
                <User className="w-5 h-5 text-indigo-400" />
              </div>
              <div>
                <h2 className="text-xl font-bold">Profile & Identity</h2>
                <p className="text-sm text-slate-400">How you appear to counterparties.</p>
              </div>
            </div>

            <div className="space-y-4 max-w-xl">
              {/* Full Name Field */}
              <div className="flex flex-col space-y-1 relative">
                <label className="text-xs font-semibold tracking-wide text-white/50 uppercase flex justify-between">
                  <span>Full Name</span>
                  {originalProfile.full_name !== draftProfile.full_name && (
                    <span className="text-amber-400 font-bold flex items-center gap-1">
                      Modified 
                      <button onClick={() => setDraftProfile(prev => ({...prev, full_name: originalProfile.full_name}))} className="hover:text-amber-300 ml-1">
                        <RotateCcw className="w-3 h-3" />
                      </button>
                    </span>
                  )}
                </label>
                <input 
                  type="text"
                  value={draftProfile.full_name}
                  onChange={(e) => setDraftProfile({...draftProfile, full_name: e.target.value})}
                  className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-indigo-500/50 transition-colors"
                />
              </div>

              {/* Username Field */}
              <div className="flex flex-col space-y-1 relative">
                <label className="text-xs font-semibold tracking-wide text-white/50 uppercase flex justify-between">
                  <span>Username</span>
                  {originalProfile.username !== draftProfile.username && (
                    <span className="text-amber-400 font-bold flex items-center gap-1">
                      Modified 
                      <button onClick={() => setDraftProfile(prev => ({...prev, username: originalProfile.username}))} className="hover:text-amber-300 ml-1">
                        <RotateCcw className="w-3 h-3" />
                      </button>
                    </span>
                  )}
                </label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 font-bold">@</span>
                  <input 
                    type="text"
                    value={draftProfile.username}
                    onChange={(e) => setDraftProfile({...draftProfile, username: e.target.value})}
                    className="w-full bg-black/20 border border-white/10 rounded-xl pl-10 pr-4 py-3 text-white outline-none focus:border-indigo-500/50 transition-colors"
                  />
                </div>
              </div>

              {/* Explicit Save Action */}
              {isProfileModified && (
                <div className="pt-4 flex gap-3 animate-in fade-in slide-in-from-top-2">
                  <button 
                    onClick={handleSaveProfile}
                    disabled={isSavingProfile}
                    className="flex items-center px-6 py-2.5 bg-indigo-500 hover:bg-indigo-600 text-white rounded-xl font-bold transition-all disabled:opacity-50"
                  >
                    {isSavingProfile ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
                    Save Changes
                  </button>
                  <button 
                    onClick={() => setDraftProfile(originalProfile)}
                    className="px-6 py-2.5 bg-white/5 hover:bg-white/10 text-white rounded-xl font-bold transition-all border border-white/10"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          </section>
        )}

        {/* AI Integration Section (Explicit Save) */}
        {showIntegration && (
          <section className="bg-white/5 border border-white/10 rounded-3xl p-6 md:p-8 backdrop-blur-sm relative">
            <div className="flex items-center mb-6">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center mr-4 border border-emerald-500/20">
                <Key className="w-5 h-5 text-emerald-400" />
              </div>
              <div>
                <h2 className="text-xl font-bold">AI Integrations (BYOK)</h2>
                <p className="text-sm text-slate-400">Keys are stored securely in your local browser storage.</p>
              </div>
            </div>

            <div className="max-w-xl">
              <div className="flex flex-col space-y-1 relative">
                <label className="text-xs font-semibold tracking-wide text-white/50 uppercase flex justify-between">
                  <span>OpenAI / Gemini API Key</span>
                  {isAiModified && (
                    <span className="text-amber-400 font-bold flex items-center gap-1">
                      Modified 
                      <button onClick={() => setDraftAiKey(originalAiKey)} className="hover:text-amber-300 ml-1">
                        <RotateCcw className="w-3 h-3" />
                      </button>
                    </span>
                  )}
                </label>
                <input 
                  type="password"
                  placeholder="sk-..."
                  value={draftAiKey}
                  onChange={(e) => setDraftAiKey(e.target.value)}
                  className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-emerald-500/50 transition-colors font-mono"
                />
              </div>

              {isAiModified && (
                <div className="pt-5 flex gap-3 animate-in fade-in slide-in-from-top-2">
                  <button 
                    onClick={handleSaveAiKey}
                    className="flex items-center px-6 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl font-bold transition-all"
                  >
                    <Save className="w-4 h-4 mr-2" />
                    Save Key Locally
                  </button>
                </div>
              )}
              {isAiSaved && !isAiModified && (
                <div className="pt-3 flex items-center text-emerald-400 text-sm font-bold animate-in fade-in">
                  <CheckCircle2 className="w-4 h-4 mr-1.5" /> Key secured to device
                </div>
              )}
            </div>
          </section>
        )}

        {/* Security & Toggles (Instant Save) */}
        {showSecurity && (
          <section className="bg-white/5 border border-white/10 rounded-3xl p-6 md:p-8 backdrop-blur-sm">
            <div className="flex items-center mb-6">
              <div className="w-10 h-10 rounded-xl bg-amber-500/20 flex items-center justify-center mr-4 border border-amber-500/20">
                <Lock className="w-5 h-5 text-amber-400" />
              </div>
              <div>
                <h2 className="text-xl font-bold">Security Preferences</h2>
                <p className="text-sm text-slate-400">Settings apply instantly to your current session.</p>
              </div>
            </div>

            <div className="max-w-xl">
              <div className="flex items-center justify-between p-4 bg-black/20 border border-white/5 rounded-2xl">
                <div>
                  <h3 className="font-bold text-white">Auto-Lock Interface</h3>
                  <p className="text-sm text-slate-400">Blur screen after 3 minutes of inactivity.</p>
                </div>
                <button 
                  onClick={toggleAutoLock}
                  className={`w-14 h-8 rounded-full transition-colors relative ${autoLock ? 'bg-amber-500' : 'bg-slate-700'}`}
                >
                  <div className={`w-6 h-6 bg-white rounded-full absolute top-1 transition-transform ${autoLock ? 'translate-x-7' : 'translate-x-1'}`}></div>
                </button>
              </div>
            </div>
          </section>
        )}

        {/* Collapsible Advanced Options */}
        {showSecurity && (
          <section className="bg-transparent border border-white/10 rounded-3xl overflow-hidden backdrop-blur-sm transition-all duration-300">
            <button 
              onClick={() => setAdvancedOpen(!advancedOpen)}
              className="w-full flex items-center justify-between p-6 md:p-8 hover:bg-white/5 transition-colors"
            >
              <div className="flex items-center">
                <ShieldAlert className="w-6 h-6 text-slate-400 mr-4" />
                <h2 className="text-xl font-bold text-slate-200">Advanced Settings</h2>
              </div>
              {advancedOpen ? <ChevronUp className="w-5 h-5 text-slate-400" /> : <ChevronDown className="w-5 h-5 text-slate-400" />}
            </button>

            {advancedOpen && (
              <div className="p-6 md:p-8 pt-0 border-t border-white/10 animate-in slide-in-from-top-4">
                
                {/* Visual Wall for Destructive Action */}
                <div className="p-6 border border-rose-500/30 bg-rose-500/5 rounded-2xl mt-4">
                  <h3 className="text-rose-400 font-bold mb-2 flex items-center">
                    <Trash2 className="w-4 h-4 mr-2" /> Danger Zone
                  </h3>
                  <p className="text-sm text-slate-400 mb-6">
                    Deleting your account is irreversible. All transactions, accounts, and obligations will be wiped from the database permanently.
                  </p>
                  
                  <div className="flex flex-col space-y-1 max-w-md">
                    <label className="text-xs font-semibold tracking-wide text-rose-400/70 uppercase">
                      Type "DELETE" to confirm
                    </label>
                    <input 
                      type="text"
                      value={deleteConfirmText}
                      onChange={(e) => setDeleteConfirmText(e.target.value)}
                      placeholder="DELETE"
                      className="w-full bg-black/20 border border-rose-500/30 rounded-xl px-4 py-3 text-white outline-none focus:border-rose-500 transition-colors"
                    />
                  </div>

                  <button 
                    disabled={deleteConfirmText !== 'DELETE'}
                    className="mt-4 px-6 py-2.5 bg-rose-600 hover:bg-rose-500 text-white rounded-xl font-bold transition-all disabled:opacity-30 disabled:hover:bg-rose-600"
                  >
                    Permanently Delete Data
                  </button>
                </div>

              </div>
            )}
          </section>
        )}
      </div>
    </div>
  )
}
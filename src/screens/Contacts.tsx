import React, { useState, useEffect } from 'react'
import PageHeader from '../components/PageHeader'
import { Users, User, Pencil, Loader2, Check, X, Link2, Trash2, Search, UserCheck } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { safeCaughtErrorMessage } from '../lib/safeErrorMessages'
import { formatIndiaDate } from '../lib/financeDate'

interface ShadowContact {
  id: string
  name: string
  created_at: string
}

interface ProfileSearchResult {
  id: string
  full_name: string
  username: string
}

export default function Contacts() {
  const [contacts, setContacts] = useState<ShadowContact[]>([])
  const [isLoading, setIsLoading] = useState(true)
  
  // Existing Edit State
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')

  // New Merging State
  const [mergingContact, setMergingContact] = useState<ShadowContact | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [isSearching, setIsSearching] = useState(false)
  const [searchResults, setSearchResults] = useState<ProfileSearchResult[]>([])
  const [isProcessing, setIsProcessing] = useState(false)

  const fetchContacts = async () => {
    setIsLoading(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const user = session?.user
      if (!user) return

      const { data, error } = await supabase
        .from('contacts')
        .select('id, name, created_at')
        .eq('owner_id', user.id)
        .order('name', { ascending: true })

      if (error) throw error
      if (data) setContacts(data)
    } catch {
      console.error('Could not load contacts')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchContacts()
  }, [])

  // 1. Existing Inline Edit Logic
  const startEditing = (contact: ShadowContact) => {
    setEditingId(contact.id)
    setEditName(contact.name)
    setMergingContact(null) // Close merge UI if open
  }

  const handleUpdate = async (id: string) => {
    if (!editName.trim()) {
      setEditingId(null)
      return
    }
    try {
      const { error } = await supabase
        .from('contacts')
        .update({ name: editName.trim() })
        .eq('id', id)
      
      if (error) throw error
      
      setContacts(contacts.map(c => c.id === id ? { ...c, name: editName.trim() } : c))
      setEditingId(null)
    } catch (error: any) {
      alert(safeCaughtErrorMessage(error, 'Could not update this contact. Try again.'))
    }
  }

  // 2. New Delete Logic
  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure? This cannot be undone, and any transactions linked to this contact will lose their tag.')) return
    try {
      const { error } = await supabase.from('contacts').delete().eq('id', id)
      if (error) throw error
      fetchContacts()
    } catch (error: any) {
      alert(safeCaughtErrorMessage(error, 'Could not delete this contact. Linked history is preserved.'))
    }
  }

  // 3. New Global Profile Search (Debounced)
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([])
      return
    }
    const delayDebounceFn = setTimeout(async () => {
      setIsSearching(true)
      try {
        const { data, error } = await supabase.rpc('search_users', { search_term: searchQuery.trim() })
        if (error) throw error
        if (data) setSearchResults(data.slice(0, 5))
      } catch {
        console.error('Contact counterparty search failed')
      } finally {
        setIsSearching(false)
      }
    }, 500)
    return () => clearTimeout(delayDebounceFn)
  }, [searchQuery])

  // 4. New Mapping/Merge Logic
  const handleMerge = async (profileId: string) => {
    if (!mergingContact) return
    setIsProcessing(true)

    try {
      const { error } = await supabase.rpc('merge_shadow_contact', {
        p_contact_id: mergingContact.id,
        p_profile_id: profileId
      })
      if (error) throw error

      alert('Contact mapped and history merged successfully!')
      setMergingContact(null)
      setSearchQuery('')
      fetchContacts()
      
    } catch (error: any) {
      alert(safeCaughtErrorMessage(error, 'Could not link this contact. Refresh and try again.'))
    } finally {
      setIsProcessing(false)
    }
  }

  return (
    <div className="page-shell w-full max-w-4xl mx-auto animate-in fade-in duration-300 pb-32">
      <PageHeader title="Shadow Contacts" description="Manage your offline network and map them to real accounts" icon={<Users className="text-emerald-400" />} />

      {isLoading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
        </div>
      ) : contacts.length === 0 ? (
        <div className="p-8 border border-dashed border-white/10 rounded-3xl bg-white/5 flex flex-col items-center justify-center text-center">
          <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mb-4">
            <Users className="w-8 h-8 text-slate-500" />
          </div>
          <h3 className="text-lg font-semibold text-slate-300">No Shadow Contacts</h3>
          <p className="text-sm text-slate-500 max-w-sm mt-2">
            When you log a debt with someone who doesn't have an account, they will appear here.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {contacts.map((contact) => (
            <div key={contact.id} className="surface-panel p-5 rounded-2xl transition-colors flex flex-col group">
              
              <div className="flex items-start justify-between">
                <div className="flex items-center space-x-4 flex-1">
                  <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center border border-emerald-500/20 flex-shrink-0">
                    <User className="w-5 h-5 text-emerald-400" />
                  </div>
                  
                  {/* EDIT MODE */}
                  {editingId === contact.id ? (
                    <div className="flex-1 flex items-center space-x-2 pr-2">
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleUpdate(contact.id)}
                        className="w-full bg-black/40 border border-emerald-500/50 rounded-lg px-3 py-1.5 text-white outline-none focus:ring-2 focus:ring-emerald-500/50 text-sm"
                        autoFocus
                      />
                      <button onClick={() => handleUpdate(contact.id)} className="p-1.5 bg-emerald-500/20 hover:bg-emerald-500/40 text-emerald-400 rounded-lg transition-colors">
                        <Check className="w-4 h-4" />
                      </button>
                      <button onClick={() => setEditingId(null)} className="p-1.5 bg-rose-500/20 hover:bg-rose-500/40 text-rose-400 rounded-lg transition-colors">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    /* VIEW MODE */
                    <div className="flex-1 flex justify-between items-center">
                      <div>
                        <h3 className="font-semibold text-slate-200">{contact.name}</h3>
                        <p className="text-xs text-slate-500">Added {formatIndiaDate(contact.created_at)}</p>
                      </div>
                      <div className="opacity-100 sm:opacity-0 sm:group-hover:opacity-100 flex space-x-1 transition-all">
                        <button 
                          onClick={() => startEditing(contact)}
                          aria-label={`Edit ${contact.name}`}
                          title="Edit contact"
                          className="p-2 hover:bg-white/10 rounded-lg text-slate-400 hover:text-white transition-colors"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button 
                          onClick={() => handleDelete(contact.id)}
                          aria-label={`Delete ${contact.name}`}
                          title="Delete contact"
                          className="p-2 hover:bg-rose-500/10 rounded-lg text-slate-400 hover:text-rose-400 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* MERGING UI */}
              {mergingContact?.id === contact.id ? (
                <div className="mt-4 pt-4 border-t border-white/10 animate-in fade-in slide-in-from-top-2">
                  <div className="flex justify-between items-center mb-2">
                    <label className="text-xs font-semibold text-emerald-400 uppercase tracking-wider flex items-center">
                      <Link2 className="w-3 h-3 mr-1" /> Map to App User
                    </label>
                    <button onClick={() => setMergingContact(null)} className="text-xs text-slate-400 hover:text-white transition-colors">Cancel</button>
                  </div>
                  
                  <div className="relative mb-2">
                    <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input 
                      type="text" 
                      placeholder="Search by username or name..." 
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full bg-black/40 border border-white/10 rounded-xl pl-9 pr-4 py-2.5 text-sm text-white outline-none focus:border-emerald-500/50 transition-colors"
                    />
                    {isSearching && <Loader2 className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-emerald-500 animate-spin" />}
                  </div>

                  {searchResults.length > 0 && (
                    <div className="bg-black/60 border border-white/10 rounded-xl overflow-hidden mt-2">
                      {searchResults.map(profile => (
                        <button 
                          key={profile.id}
                          onClick={() => handleMerge(profile.id)}
                          disabled={isProcessing}
                          className="w-full flex items-center justify-between p-3 hover:bg-emerald-500/20 transition-colors border-b border-white/5 last:border-0 text-left disabled:opacity-50"
                        >
                          <div>
                            <p className="text-sm font-bold text-slate-200">{profile.full_name || 'User'}</p>
                            <p className="text-xs text-emerald-400/70">@{profile.username}</p>
                          </div>
                          {isProcessing ? <Loader2 className="w-4 h-4 text-emerald-500 animate-spin" /> : <UserCheck className="w-4 h-4 text-emerald-500" />}
                        </button>
                      ))}
                    </div>
                  )}
                  {searchQuery && !isSearching && searchResults.length === 0 && (
                    <p className="text-xs text-slate-500 mt-2 text-center">No users found.</p>
                  )}
                </div>
              ) : (
                <button 
                  onClick={() => {
                    setMergingContact(contact)
                    setSearchQuery('')
                    setSearchResults([])
                    setEditingId(null)
                  }}
                  className="mt-4 w-full flex items-center justify-center py-2 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/20 rounded-xl text-sm font-semibold transition-colors"
                >
                  <Link2 className="w-4 h-4 mr-2" /> Map to App User
                </button>
              )}
              
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

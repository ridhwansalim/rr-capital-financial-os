import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { Archive, Check, Loader2, Plus, ShoppingBasket, Trash2, Undo2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useOptionalFeatures } from '../lib/optionalFeatures'
import PageHeader from '../components/PageHeader'

type ShoppingList = { id: string; name: string; archived_at: string | null; created_at: string }
type ShoppingItem = { id: string; list_id: string; name: string; quantity: number; expected_cost: number | null; purchased: boolean }
const inputClass = 'mt-1 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2.5 text-sm text-white outline-none focus:border-emerald-400/50'
const money = (value: number) => `₹${value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export default function ShoppingLists() {
  const { flags, loading: flagsLoading } = useOptionalFeatures()
  const [lists, setLists] = useState<ShoppingList[]>([])
  const [items, setItems] = useState<ShoppingItem[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [newListName, setNewListName] = useState('')
  const [drafts, setDrafts] = useState<Record<string, { name: string; quantity: string; cost: string }>>({})
  const [editing, setEditing] = useState<ShoppingItem | null>(null)

  const load = useCallback(async () => {
    const [listResult, itemResult] = await Promise.all([
      supabase.from('shopping_lists').select('id,name,archived_at,created_at').order('archived_at', { ascending: true, nullsFirst: true }).order('created_at', { ascending: false }),
      supabase.from('shopping_list_items').select('id,list_id,name,quantity,expected_cost,purchased').order('created_at'),
    ])
    if (listResult.error || itemResult.error) setError(listResult.error?.message || itemResult.error?.message || 'Could not load shopping lists.')
    else { setError(''); setLists((listResult.data || []) as ShoppingList[]); setItems((itemResult.data || []) as ShoppingItem[]) }
    setLoading(false)
  }, [])

  useEffect(() => {
    if (flagsLoading || !flags.shopping_lists) return
    let active = true
    queueMicrotask(() => { if (active) void load() })
    return () => { active = false }
  }, [flagsLoading, flags.shopping_lists, load])

  if (!flagsLoading && !flags.shopping_lists) return <Navigate to="/" replace />
  if (flagsLoading || loading) return <div className="p-6 min-h-[50vh] grid place-items-center text-slate-400"><Loader2 className="animate-spin" aria-label="Loading shopping lists" /></div>

  const createList = async (event: FormEvent) => {
    event.preventDefault()
    if (!newListName.trim()) return
    setSaving(true); setError('')
    const { error: saveError } = await supabase.from('shopping_lists').insert({ name: newListName.trim() })
    if (saveError) setError(saveError.message)
    else { setNewListName(''); await load() }
    setSaving(false)
  }

  const addItem = async (listId: string) => {
    const draft = drafts[listId] || { name: '', quantity: '1', cost: '' }
    const quantity = Number(draft.quantity)
    const cost = draft.cost.trim() ? Number(draft.cost) : null
    if (!draft.name.trim() || !Number.isFinite(quantity) || quantity <= 0 ||
        (cost !== null && (!Number.isFinite(cost) || cost <= 0 || Math.round(cost * 100) !== cost * 100))) {
      setError('Enter an item name, positive quantity, and an optional positive expected cost.')
      return
    }
    setSaving(true); setError('')
    const { error: saveError } = await supabase.from('shopping_list_items').insert({ list_id: listId, name: draft.name.trim(), quantity, expected_cost: cost })
    if (saveError) setError(saveError.message)
    else { setDrafts(current => ({ ...current, [listId]: { name: '', quantity: '1', cost: '' } })); await load() }
    setSaving(false)
  }

  const togglePurchased = async (item: ShoppingItem) => {
    const { error: saveError } = await supabase.from('shopping_list_items').update({ purchased: !item.purchased }).eq('id', item.id)
    if (saveError) setError(saveError.message); else await load()
  }

  const saveEdit = async (event: FormEvent) => {
    event.preventDefault()
    if (!editing) return
    const quantity = Number(editing.quantity)
    const cost = editing.expected_cost
    if (!editing.name.trim() || !Number.isFinite(quantity) || quantity <= 0 ||
        (cost !== null && (!Number.isFinite(cost) || cost <= 0 || Math.round(cost * 100) !== cost * 100))) {
      setError('Enter a valid item name, quantity, and expected cost.')
      return
    }
    const { error: saveError } = await supabase.from('shopping_list_items').update({ name: editing.name.trim(), quantity, expected_cost: cost }).eq('id', editing.id)
    if (saveError) setError(saveError.message); else { setEditing(null); await load() }
  }

  const deleteItem = async (item: ShoppingItem) => {
    if (!window.confirm(`Delete “${item.name}” from this list?`)) return
    const { error: deleteError } = await supabase.from('shopping_list_items').delete().eq('id', item.id)
    if (deleteError) setError(deleteError.message); else await load()
  }

  const archiveList = async (list: ShoppingList) => {
    const archivedAt = list.archived_at ? null : new Date().toISOString()
    const { error: updateError } = await supabase.from('shopping_lists').update({ archived_at: archivedAt }).eq('id', list.id)
    if (updateError) setError(updateError.message); else await load()
  }

  const deleteList = async (list: ShoppingList) => {
    if (!window.confirm(`Delete “${list.name}” and its items? This only affects shopping-list data and never creates or changes transactions.`)) return
    const { error: deleteError } = await supabase.from('shopping_lists').delete().eq('id', list.id)
    if (deleteError) setError(deleteError.message); else await load()
  }

  const activeLists = lists.filter(list => !list.archived_at)
  const archivedLists = lists.filter(list => list.archived_at)
  const renderList = (list: ShoppingList) => {
    const rows = items.filter(item => item.list_id === list.id)
    const draft = drafts[list.id] || { name: '', quantity: '1', cost: '' }
    const updateDraft = (patch: Partial<typeof draft>) => setDrafts(current => ({ ...current, [list.id]: { ...draft, ...patch } }))
    return <article key={list.id} className="rounded-3xl border border-white/10 bg-white/5 p-5">
      <div className="flex items-start justify-between gap-3"><div><h2 className="text-lg font-semibold">{list.name}</h2><p className="mt-1 text-xs text-slate-500">{rows.filter(item => !item.purchased).length} remaining · {rows.filter(item => item.purchased).length} checked</p></div><div className="flex gap-1"><button type="button" onClick={() => void archiveList(list)} aria-label={list.archived_at ? 'Restore list' : 'Archive list'} className="rounded-lg p-2 text-slate-400 hover:text-white">{list.archived_at ? <Undo2 className="h-4 w-4" /> : <Archive className="h-4 w-4" />}</button><button type="button" onClick={() => void deleteList(list)} aria-label={`Delete ${list.name}`} className="rounded-lg p-2 text-slate-500 hover:text-rose-300"><Trash2 className="h-4 w-4" /></button></div></div>
      {rows.length > 0 && <ul className="mt-4 divide-y divide-white/5">{rows.map(item => <li key={item.id} className="flex items-center gap-3 py-3">
        <button type="button" aria-pressed={item.purchased} aria-label={`${item.purchased ? 'Uncheck' : 'Mark purchased'} ${item.name}`} onClick={() => void togglePurchased(item)} className={`grid h-6 w-6 shrink-0 place-items-center rounded-lg border ${item.purchased ? 'border-emerald-400 bg-emerald-400 text-slate-950' : 'border-white/20 text-transparent hover:border-emerald-300'}`}><Check className="h-4 w-4" /></button>
        {editing?.id === item.id ? <form onSubmit={event => void saveEdit(event)} className="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-4"><input autoFocus value={editing.name} onChange={event => setEditing({ ...editing, name: event.target.value })} className={inputClass} aria-label="Edit item name" /><input type="number" min="0.01" step="0.01" value={editing.quantity} onChange={event => setEditing({ ...editing, quantity: Number(event.target.value) })} className={inputClass} aria-label="Edit quantity" /><input type="number" min="0.01" step="0.01" value={editing.expected_cost ?? ''} onChange={event => setEditing({ ...editing, expected_cost: event.target.value ? Number(event.target.value) : null })} className={inputClass} aria-label="Edit expected cost" placeholder="No estimate" /><div className="flex gap-2"><button type="submit" className="rounded-lg bg-emerald-400 px-3 text-xs font-semibold text-slate-950">Save</button><button type="button" onClick={() => setEditing(null)} className="rounded-lg border border-white/10 px-3 text-xs">Cancel</button></div></form> : <>
          <div className={`min-w-0 flex-1 ${item.purchased ? 'text-slate-500 line-through' : 'text-slate-200'}`}><span className="font-medium">{item.name}</span><span className="ml-2 text-xs text-slate-500">× {Number(item.quantity).toLocaleString('en-IN')}</span></div>{item.expected_cost !== null && <span className="text-xs text-slate-400">{money(Number(item.expected_cost))}</span>}<button type="button" onClick={() => setEditing(item)} className="rounded-lg border border-white/10 px-2 py-1 text-[11px] text-slate-400 hover:text-white">Edit</button><button type="button" onClick={() => void deleteItem(item)} aria-label={`Delete ${item.name}`} className="p-1 text-slate-500 hover:text-rose-300"><Trash2 className="h-4 w-4" /></button>
        </>}
      </li>)}</ul>}
      {!list.archived_at && <div className="mt-4 rounded-2xl border border-dashed border-white/10 p-3"><div className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_100px_130px_auto] items-end"><label className="col-span-2 text-[11px] text-slate-400 sm:col-span-1">Item<input maxLength={120} value={draft.name} onChange={event => updateDraft({ name: event.target.value })} placeholder="Add an item" className={inputClass} /></label><label className="text-[11px] text-slate-400">Quantity<input type="number" min="0.01" step="0.01" value={draft.quantity} onChange={event => updateDraft({ quantity: event.target.value })} className={inputClass} /></label><label className="text-[11px] text-slate-400">Expected cost (optional)<input inputMode="decimal" value={draft.cost} onChange={event => updateDraft({ cost: event.target.value })} placeholder="₹" className={inputClass} /></label><button type="button" disabled={saving || !draft.name.trim()} onClick={() => void addItem(list.id)} aria-label={`Add item to ${list.name}`} className="inline-flex h-10 items-center justify-center gap-1 rounded-xl bg-emerald-400/15 px-3 text-xs font-semibold text-emerald-200 disabled:opacity-40"><Plus className="h-4 w-4" />Add</button></div></div>}
      {list.archived_at && <p className="mt-4 text-xs text-slate-500">Archived list · its items are preserved.</p>}
    </article>
  }

  return <main className="p-4 sm:p-6 w-full max-w-5xl mx-auto text-white pb-32 animate-in fade-in duration-300">
    <PageHeader eyebrow="Planning tools" title="Shopping lists" description="Plan items and expected costs. Checking an item only changes this list; it never posts a transaction or says which account paid." icon={<ShoppingBasket className="text-amber-300" />} action={<Link to="/settings" className="inline-flex w-full justify-center rounded-xl border border-white/10 px-4 py-3 text-sm text-slate-300 hover:bg-white/5 sm:w-auto sm:py-2">Manage optional features</Link>} />
    {error && <p role="alert" className="mb-4 rounded-xl border border-rose-400/30 bg-rose-500/10 p-3 text-sm text-rose-200">{error}</p>}
    <form onSubmit={event => void createList(event)} className="mb-6 flex gap-2 rounded-3xl border border-white/10 bg-white/5 p-4"><input maxLength={80} value={newListName} onChange={event => setNewListName(event.target.value)} placeholder="New list name" className="min-w-0 flex-1 rounded-xl border border-white/10 bg-slate-900 px-3 py-3 text-sm text-white" /><button type="submit" disabled={saving || !newListName.trim()} className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-amber-300 px-4 py-2 text-sm font-bold text-slate-950 disabled:opacity-40"><Plus className="h-4 w-4" />Create list</button></form>
    <section className="space-y-4">{activeLists.map(renderList)}{!activeLists.length && <div className="rounded-3xl border border-dashed border-white/15 p-8 text-center text-slate-400">Create a list to start planning purchases.</div>}</section>
    {archivedLists.length > 0 && <details className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-4"><summary className="cursor-pointer text-sm font-semibold text-slate-400">Archived lists ({archivedLists.length})</summary><div className="mt-4 space-y-3">{archivedLists.map(renderList)}</div></details>}
  </main>
}

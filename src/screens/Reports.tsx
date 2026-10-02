import { useEffect, useEffectEvent, useRef, useState, type FormEvent } from 'react'
import { Copy, Download, FileSpreadsheet, FileText, Loader2, Share2 } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { formatIndiaDate, formatIndiaDateInputValue, indiaDateExclusiveEndToIso, indiaDateInputToIso, indiaDateStartToIso, toIndiaDateInputValue } from '../lib/financeDate'
import { parseReportFocus } from '../lib/reportNavigation'
import { safeBackendErrorMessage } from '../lib/safeErrorMessages'
import PageHeader from '../components/PageHeader'

type Tx = { id: string; amount: number; fee_amount: number; description: string | null; created_at: string; from_account_id: string | null; to_account_id: string | null; category_id: string | null }
type Category = { id: string; name: string; color: string }
type ReportTx = Tx & { category: string; color: string; kind: 'income' | 'expense' | 'transfer'; running: number }
type EntryView = 'expenses' | 'income' | 'all'
const COLORS = ['#34d399', '#fb7185', '#818cf8', '#fbbf24', '#38bdf8', '#c084fc', '#fb923c', '#a3e635']
const money = (value: number) => `₹${value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

function Donut({ data, total, selectedCategory, onSelect }: { data: { id: string; name: string; amount: number; color: string }[]; total: number; selectedCategory?: string; onSelect: (categoryId: string) => void }) {
  const parts = data.map((item, index) => {
    const offset = data.slice(0, index).reduce((sum, previous) => sum + (total > 0 ? previous.amount / total : 0) * 264, 0)
    const part = total > 0 ? item.amount / total : 0
    return <g key={item.id} role="button" tabIndex={0} aria-label={`Show expense entries for ${item.name}`} aria-pressed={selectedCategory === item.id} onClick={() => onSelect(item.id)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(item.id) } }} className="cursor-pointer focus-visible:outline-none"><circle cx="60" cy="60" r="42" fill="none" stroke={item.color} strokeWidth={selectedCategory === item.id ? 20 : 16} strokeDasharray={`${part * 264} ${264 - part * 264}`} strokeDashoffset={-offset} transform="rotate(-90 60 60)" className="transition-all hover:opacity-75 focus-visible:opacity-75" /></g>
  })
  return <svg viewBox="0 0 120 120" className="w-40 h-40 shrink-0" role="group" aria-label="Expense categories; select a segment to filter entries"><circle cx="60" cy="60" r="42" fill="none" stroke="currentColor" className="text-white/10" strokeWidth="16" />{parts}<text x="60" y="57" textAnchor="middle" className="fill-slate-100 text-[9px]">Expenses</text><text x="60" y="71" textAnchor="middle" className="fill-slate-300 text-[7px]">{money(total)}</text></svg>
}

async function exportFile(file: File) {
  if (navigator.share && navigator.canShare?.({ files: [file] })) {
    await navigator.share({ title: 'RR Capital report', files: [file] })
    return
  }
  const url = URL.createObjectURL(file)
  const link = document.createElement('a')
  link.href = url
  link.download = file.name
  link.click()
  URL.revokeObjectURL(url)
}

export default function Reports() {
  const today = toIndiaDateInputValue()
  const [searchParams, setSearchParams] = useSearchParams()
  const focus = parseReportFocus(searchParams.toString(), `${today.slice(0, 7)}-01`, today)
  const from = focus.from
  const to = focus.to
  const entryFilter: EntryView = focus.kind === 'income' ? 'income' : focus.kind === 'all' ? 'all' : 'expenses'
  const categoryFilter = focus.category
  const [transactions, setTransactions] = useState<ReportTx[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const rangeKey = `${from}:${to}`
  const [loadedRange, setLoadedRange] = useState('')
  const loading = loadedRange !== rangeKey
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<ReportTx | null>(null)
  const [refreshVersion, setRefreshVersion] = useState(0)
  const requestVersion = useRef(0)
  const updateReportFocus = (patch: { from?: string; to?: string; entryFilter?: EntryView; category?: string }) => {
    const nextFrom = patch.from ?? from
    const nextTo = patch.to ?? to
    const nextView = patch.entryFilter ?? entryFilter
    const nextCategory = Object.prototype.hasOwnProperty.call(patch, 'category') ? patch.category : categoryFilter
    const next = new URLSearchParams()
    next.set('from', nextFrom)
    next.set('to', nextTo)
    next.set('kind', nextView === 'expenses' ? 'expense' : nextView)
    if (nextCategory) next.set('category', nextCategory)
    setSearchParams(next, { replace: true })
  }

  const load = useEffectEvent(async () => {
    const request = ++requestVersion.current
    try {
      const [{ data: categoryRows, error: categoryError }, { data: first, error: firstError }] = await Promise.all([
        supabase.from('transaction_categories').select('id, name, color').order('name'),
        supabase.from('transactions').select('id, amount, fee_amount, description, created_at, from_account_id, to_account_id, category_id').eq('status', 'COMPLETED').gte('created_at', indiaDateStartToIso(from)).lt('created_at', indiaDateExclusiveEndToIso(to)).order('created_at', { ascending: true }).order('id', { ascending: true }).range(0, 999),
      ])
      if (request !== requestVersion.current) return
      if (categoryError) throw categoryError
      if (firstError) throw firstError
      const raw: Tx[] = [...(first || [])] as Tx[]
      for (let start = 1000; (first || []).length === 1000; start += 1000) {
        const { data, error: pageError } = await supabase.from('transactions').select('id, amount, fee_amount, description, created_at, from_account_id, to_account_id, category_id').eq('status', 'COMPLETED').gte('created_at', indiaDateStartToIso(from)).lt('created_at', indiaDateExclusiveEndToIso(to)).order('created_at', { ascending: true }).order('id', { ascending: true }).range(start, start + 999)
        if (request !== requestVersion.current) return
        if (pageError) throw pageError
        raw.push(...(data || []) as Tx[])
        if ((data || []).length < 1000) break
      }
      const cats = (categoryRows || []) as Category[]
      setCategories(cats)
      const catMap = new Map(cats.map(category => [category.id, category]))
      let running = 0
      setTransactions(raw.map(tx => {
        const kind = !tx.from_account_id ? 'income' : !tx.to_account_id ? 'expense' : 'transfer'
        if (kind === 'income') running += Number(tx.amount)
        if (kind === 'expense') running -= Number(tx.amount) + Number(tx.fee_amount || 0)
        if (kind === 'transfer') running -= Number(tx.fee_amount || 0)
        const category = tx.category_id ? catMap.get(tx.category_id) : undefined
        return { ...tx, amount: Number(tx.amount), fee_amount: Number(tx.fee_amount || 0), kind, category: category?.name || 'Uncategorized', color: category?.color || '#64748b', running }
      }))
      setError('')
    } catch {
      if (request !== requestVersion.current) return
      console.error('Could not load report data')
      setError('Reports could not be loaded. Please check your connection and try again.')
    } finally { if (request === requestVersion.current) setLoadedRange(rangeKey) }
  })

  useEffect(() => {
    void load()
    return () => { requestVersion.current += 1 }
  }, [rangeKey, refreshVersion])

  const expenses = transactions.filter(tx => tx.kind === 'expense' || (tx.kind === 'transfer' && tx.fee_amount > 0))
  const visibleEntries = transactions.filter(tx => {
    const categoryMatches = !categoryFilter || (categoryFilter === 'uncategorized' ? !tx.category_id : tx.category_id === categoryFilter)
    const typeMatches = entryFilter === 'all' || (entryFilter === 'income' ? tx.kind === 'income' : tx.kind === 'expense' || (tx.kind === 'transfer' && tx.fee_amount > 0))
    return categoryMatches && typeMatches
  })
  const visibleIncome = visibleEntries.filter(tx => tx.kind === 'income').reduce((sum, tx) => sum + tx.amount, 0)
  const visibleExpenseTotal = visibleEntries.reduce((sum, tx) => sum + (tx.kind === 'expense' ? tx.amount : 0) + tx.fee_amount, 0)
  const income = transactions.filter(tx => tx.kind === 'income').reduce((sum, tx) => sum + tx.amount, 0)
  const expenseTotal = expenses.reduce((sum, tx) => sum + (tx.kind === 'expense' ? tx.amount : 0) + tx.fee_amount, 0)
  const map = new Map<string, { id: string; name: string; amount: number; color: string }>()
  transactions.filter(tx => tx.kind === 'expense' || (tx.kind === 'transfer' && tx.fee_amount > 0)).forEach(tx => {
    const id = tx.category_id || 'uncategorized'
    const previous = map.get(id)
    const amount = (tx.kind === 'expense' ? tx.amount : 0) + tx.fee_amount
    map.set(id, previous
      ? { ...previous, amount: previous.amount + amount }
      : { id, name: tx.category, amount, color: tx.color })
  })
  const grouped = [...map.values()].sort((a, b) => b.amount - a.amount)

  const setRange = (days: number | 'month' | 'year') => {
    const end = toIndiaDateInputValue()
    const [year, month, day] = end.split('-').map(Number)
    const start = days === 'month' ? `${end.slice(0, 7)}-01`
      : days === 'year' ? `${year}-01-01`
        : new Date(Date.UTC(year, month - 1, day - days + 1)).toISOString().slice(0, 10)
    updateReportFocus({ from: start, to: end })
  }

  const assignCategory = async (tx: ReportTx, categoryId: string) => {
    const { error: saveError } = await supabase.rpc('set_transaction_category', { p_transaction_id: tx.id, p_category_id: categoryId || null })
    if (saveError) { setError('Could not save category. Please retry.'); return }
    setTransactions(current => current.map(item => item.id === tx.id ? { ...item, category_id: categoryId || null, category: categories.find(c => c.id === categoryId)?.name || 'Uncategorized', color: categories.find(c => c.id === categoryId)?.color || '#64748b' } : item))
  }

  const voidEntry = async (tx: ReportTx) => {
    if (!window.confirm('Mark this entry as entered in error? It will remain in the audit history and stop affecting balances.')) return
    const reason = window.prompt('Reason for voiding this entry:', 'Entered in error')
    if (!reason?.trim()) return
    const { error: voidError } = await supabase.rpc('void_ledger_transaction', { p_transaction_id: tx.id, p_reason: reason.trim() })
    if (voidError) setError(safeBackendErrorMessage(voidError, 'This entry could not be voided. It may already be linked to another financial workflow.'))
    else setRefreshVersion(version => version + 1)
  }

  const duplicateEntry = (tx: ReportTx) => {
    window.dispatchEvent(new CustomEvent('rr:transaction-draft', { detail: {
      type: tx.kind,
      amount: String(tx.amount),
      feeAmount: tx.kind === 'transfer' ? String(tx.fee_amount || 0) : '',
      description: tx.description || '',
      selectedAccount: tx.kind === 'income' ? tx.to_account_id || '' : tx.from_account_id || '',
      targetAccount: tx.to_account_id || '',
    } }))
  }

  const runExport = async (kind: 'csv' | 'xlsx' | 'pdf') => {
    setBusy(true)
    try {
      const rows = visibleEntries.map(tx => ({ Date: formatIndiaDate(tx.created_at), Type: tx.kind, Description: tx.description || '', Category: tx.category, Amount: tx.kind === 'expense' ? -tx.amount : tx.kind === 'income' ? tx.amount : 0, Fee: tx.fee_amount, 'Period running net': tx.running }))
      const stem = `rr-capital-report-${from}-to-${to}`
      if (kind === 'csv') {
        const keys = Object.keys(rows[0] || { Date: '', Type: '', Description: '', Category: '', Amount: 0, Fee: 0, 'Period running net': 0 })
        const quote = (value: unknown) => {
          const raw = String(value ?? '')
          // Spreadsheet applications may evaluate untrusted labels/descriptions
          // as formulas even when they are quoted as CSV fields.
          let firstSignificant = 0
          while (firstSignificant < raw.length) {
            const code = raw.charCodeAt(firstSignificant)
            if (code <= 0x20 || code === 0xa0 || code === 0xfeff) firstSignificant += 1
            else break
          }
          const first = raw.charAt(firstSignificant)
          const safe = typeof value === 'string' && (first === '=' || first === '+' || first === '-' || first === '@') ? `'${raw}` : raw
          return `"${safe.replace(/"/g, '""')}"`
        }
        const csv = [keys.map(quote).join(','), ...rows.map(row => keys.map(key => quote(row[key as keyof typeof row])).join(','))].join('\r\n')
        await exportFile(new File([csv], `${stem}.csv`, { type: 'text/csv;charset=utf-8' }))
      } else if (kind === 'xlsx') {
        const binary = await makeXlsx(rows)
        await exportFile(new File([binary], `${stem}.xlsx`, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
      } else {
        const { jsPDF } = await import('jspdf')
        const pdf = new jsPDF({ orientation: 'landscape' }); pdf.setFontSize(16); pdf.text('RR Capital · Financial report', 14, 16)
        const focusLabel = categoryFilter ? ` · Category: ${categoryFilter === 'uncategorized' ? 'Uncategorized' : categories.find(category => category.id === categoryFilter)?.name || 'Selected category'}` : ''
        pdf.setFontSize(10); pdf.text(`${from} to ${to} | Income ${money(visibleIncome)} | Expenses ${money(visibleExpenseTotal)}${focusLabel}`, 14, 24)
        let y = 34; pdf.text('Date             Type        Description                                  Category             Amount       Period running net', 14, y); y += 7
        rows.forEach(row => { if (y > 190) { pdf.addPage(); y = 18 } const line = `${row.Date}   ${row.Type}   ${(row.Description || '').slice(0, 34)}   ${row.Category.slice(0, 18)}   ${money(row.Amount)}   ${money(row['Period running net'])}`; pdf.text(line, 14, y); y += 6 })
        await exportFile(new File([pdf.output('blob')], `${stem}.pdf`, { type: 'application/pdf' }))
      }
    } catch (cause) { if ((cause as DOMException)?.name !== 'AbortError') setError('Export could not be created or shared on this device.') }
    finally { setBusy(false) }
  }

  return <div className="page-shell w-full max-w-7xl mx-auto pb-32 space-y-5">
    <PageHeader eyebrow="Analysis" title="Reports" description="Review cash flow and export your selected period." action={visibleEntries.length > 0 && <button type="button" onClick={() => duplicateEntry(visibleEntries[visibleEntries.length - 1])} className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-xs font-semibold hover:bg-white/10 sm:w-auto sm:py-2"><Copy className="h-4 w-4" />Repeat latest</button>} />
    <section className="rounded-3xl border border-white/10 bg-white/5 p-4 sm:p-5 space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">{[['7 days', 7], ['30 days', 30], ['This month', 'month'], ['This year', 'year']].map(([label, value]) => <button key={label} onClick={() => setRange(value as number | 'month' | 'year')} className="rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 px-3 py-2 text-sm">{label}</button>)}</div>
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] gap-3 items-end"><label className="text-xs text-slate-400">From<input type="date" value={from} max={to} onChange={e => updateReportFocus({ from: e.target.value })} className="mt-1 block w-full rounded-xl bg-slate-900 border border-white/10 px-3 py-2 text-white" /></label><span className="hidden sm:block text-slate-500 pb-2">through</span><label className="text-xs text-slate-400">To<input type="date" value={to} min={from} max={toIndiaDateInputValue()} onChange={e => updateReportFocus({ to: e.target.value })} className="mt-1 block w-full rounded-xl bg-slate-900 border border-white/10 px-3 py-2 text-white" /></label></div>
      <div className="flex flex-wrap gap-2">{(['csv', 'xlsx', 'pdf'] as const).map(kind => <button disabled={busy || loading} key={kind} onClick={() => void runExport(kind)} className="inline-flex items-center gap-2 rounded-xl bg-indigo-500/15 border border-indigo-400/20 px-3 py-2 text-sm text-indigo-200 disabled:opacity-40">{kind === 'csv' ? <Download className="w-4 h-4" /> : kind === 'xlsx' ? <FileSpreadsheet className="w-4 h-4" /> : <FileText className="w-4 h-4" />}{kind.toUpperCase()}<Share2 className="w-3 h-3 opacity-60" /></button>)}</div>
    </section>
    {error && <p role="alert" className="rounded-xl border border-rose-400/20 bg-rose-500/10 p-3 text-sm text-rose-200">{error}</p>}
    {loading ? <div className="grid place-items-center py-20"><Loader2 className="animate-spin text-indigo-300" /></div> : <>
      <section className="space-y-2"><p className="text-xs text-slate-500">Period totals for all entries · the selected filters below only narrow the entry list and exports.</p><div className="grid grid-cols-1 sm:grid-cols-3 gap-3"><Metric title="Income" amount={income} color="text-emerald-300" /><Metric title="Expenses incl. fees" amount={expenseTotal} color="text-rose-300" /><Metric title="Net cash flow" amount={income - expenseTotal} color={income >= expenseTotal ? 'text-emerald-300' : 'text-rose-300'} /></div></section>
      <section className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="surface-panel rounded-3xl p-5"><h2 className="font-semibold">Expenses by category</h2><p className="text-xs text-slate-500 mt-1">Select a chart segment or category to filter the entry list.</p><div className="mt-3 flex flex-col sm:flex-row items-center gap-4"><Donut data={grouped} total={expenseTotal} selectedCategory={categoryFilter} onSelect={id => updateReportFocus({ category: categoryFilter === id ? undefined : id, entryFilter: 'expenses' })} /><div className="flex-1 w-full space-y-2">{grouped.length ? grouped.map(item => <button type="button" key={item.id} aria-pressed={categoryFilter === item.id} onClick={() => updateReportFocus({ category: categoryFilter === item.id ? undefined : item.id, entryFilter: 'expenses' })} className={`w-full flex justify-between items-center gap-3 text-sm rounded-lg px-2 py-1.5 text-left ${categoryFilter === item.id ? 'bg-white/10' : 'hover:bg-white/5'}`}><span className="flex items-center gap-2 min-w-0"><i className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: item.color }} /> <span className="truncate">{item.name}</span></span><span>{money(item.amount)}</span></button>) : <p className="text-sm text-slate-500">No expenses in this date range.</p>}</div></div></div>
        <div className="surface-panel rounded-3xl p-5"><h2 className="font-semibold">Running cash flow</h2><p className="text-xs text-slate-500 mt-1">Income minus expenses; transfers are excluded.</p><RunningChart rows={transactions} /></div>
      </section>
      <section className="rounded-3xl border border-white/10 bg-white/5 overflow-hidden"><div className="p-5 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3"><div><h2 className="font-semibold">{entryFilter === 'expenses' ? 'Expense list' : entryFilter === 'income' ? 'Income list' : 'All transactions'}</h2><p className="text-xs text-slate-500 mt-1">Showing {visibleEntries.length} entries for this date range{categoryFilter ? ` · ${categoryFilter === 'uncategorized' ? 'Uncategorized' : categories.find(category => category.id === categoryFilter)?.name || 'Selected category'}` : ''} · debt/EMI-linked entries must be changed in their original workflow</p></div><div className="flex flex-wrap items-center gap-2"><div className="grid grid-cols-3 rounded-xl border border-white/10 bg-black/10 p-1"><button onClick={() => updateReportFocus({ entryFilter: 'expenses' })} className={`rounded-lg px-3 py-1.5 text-xs ${entryFilter === 'expenses' ? 'bg-indigo-500/20 text-indigo-200' : 'text-slate-400'}`}>Expenses</button><button onClick={() => updateReportFocus({ entryFilter: 'income' })} className={`rounded-lg px-3 py-1.5 text-xs ${entryFilter === 'income' ? 'bg-indigo-500/20 text-indigo-200' : 'text-slate-400'}`}>Income</button><button onClick={() => updateReportFocus({ entryFilter: 'all', category: undefined })} className={`rounded-lg px-3 py-1.5 text-xs ${entryFilter === 'all' && !categoryFilter ? 'bg-indigo-500/20 text-indigo-200' : 'text-slate-400'}`}>All</button></div>{categoryFilter && <button onClick={() => updateReportFocus({ category: undefined, entryFilter: 'all' })} className="rounded-xl border border-white/10 px-3 py-2 text-xs text-slate-300">Clear filters</button>}</div></div><div className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-xs text-slate-500 border-y border-white/10"><tr>{['Date', 'Description', 'Category', 'Amount', 'Period running', 'Actions'].map(h => <th key={h} className="text-left font-medium p-3">{h}</th>)}</tr></thead><tbody>{visibleEntries.map(tx => <tr key={tx.id} className="border-b border-white/5"><td className="p-3 whitespace-nowrap">{formatIndiaDate(tx.created_at)}</td><td className="p-3 min-w-48"><span className="capitalize text-slate-500 text-xs">{tx.kind}</span><br />{tx.description || (tx.kind === 'transfer' ? 'Transfer' : tx.kind)}</td><td className="p-3"><select aria-label={`Category for ${tx.description || tx.kind}`} value={tx.category_id || ''} onChange={e => void assignCategory(tx, e.target.value)} className="max-w-40 rounded-lg bg-slate-900 border border-white/10 px-2 py-1"><option value="">Uncategorized</option>{categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select></td><td className={`p-3 whitespace-nowrap ${tx.kind === 'income' ? 'text-emerald-300' : tx.kind === 'expense' ? 'text-rose-300' : 'text-slate-300'}`}>{tx.kind === 'expense' ? '-' : tx.kind === 'income' ? '+' : ''}{money(tx.amount)}{tx.fee_amount > 0 && <span className="block text-[10px] text-slate-500">+ {money(tx.fee_amount)} fee</span>}</td><td className="p-3 whitespace-nowrap">{money(tx.running)}</td><td className="p-3"><div className="flex gap-2"><button onClick={() => setEditing(tx)} className="rounded-lg px-2.5 py-1.5 border border-white/10 text-xs hover:bg-white/10">Edit</button><button onClick={() => void voidEntry(tx)} className="rounded-lg px-2.5 py-1.5 border border-rose-400/20 text-xs text-rose-300 hover:bg-rose-500/10">Void</button></div></td></tr>)}</tbody></table></div>{!visibleEntries.length && <div className="text-center py-12 text-slate-500">No matching entries in this date range.</div>}</section>
      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"><h2 className="font-semibold text-sm">Manage categories</h2><CategoryManager categories={categories} onSaved={() => setRefreshVersion(version => version + 1)} /></section>
    </>}
    {editing && <CorrectionDialog transaction={editing} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); setRefreshVersion(version => version + 1) }} />}
  </div>
}

async function makeXlsx(rows: Record<string, string | number>[]) {
  const { strToU8, zipSync } = await import('fflate')
  const keys = Object.keys(rows[0] || { Date: '', Type: '', Description: '', Category: '', Amount: 0, Fee: 0, 'Period running net': 0 })
  const xml = (value: unknown) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
  const columnName = (index: number) => { let name = ''; for (let n = index + 1; n; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name; return name }
  const records = [keys, ...rows.map(row => keys.map(key => row[key as keyof typeof row] ?? ''))]
  const sheetRows = records.map((row, rowIndex) => `<row r="${rowIndex + 1}">${row.map((value, columnIndex) => {
    const ref = `${columnName(columnIndex)}${rowIndex + 1}`
    if (typeof value === 'number' && Number.isFinite(value)) return `<c r="${ref}" t="n"><v>${value}</v></c>`
    return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`
  }).join('')}</row>`).join('')
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'),
    '_rels/.rels': strToU8('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'),
    'xl/workbook.xml': strToU8('<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Transactions" sheetId="1" r:id="rId1"/></sheets></workbook>'),
    'xl/_rels/workbook.xml.rels': strToU8('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'),
    'xl/worksheets/sheet1.xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`),
  }
  return zipSync(files, { level: 6 })
}

function Metric({ title, amount, color }: { title: string; amount: number; color: string }) { return <div className="surface-panel rounded-2xl p-4"><p className="text-xs text-slate-400">{title}</p><p className={`mt-1 text-xl font-bold break-all ${color}`}>{money(amount)}</p></div> }
function RunningChart({ rows }: { rows: ReportTx[] }) {
  const relevant = rows.filter(row => row.kind !== 'transfer')
  if (!relevant.length) return <div className="grid place-items-center h-48 text-sm text-slate-500">No cash flow in this date range.</div>
  const min = Math.min(0, ...relevant.map(r => r.running)); const max = Math.max(0, ...relevant.map(r => r.running)); const span = max - min || 1
  const points = relevant.map((r, i) => `${12 + (relevant.length === 1 ? 0 : i * 276 / (relevant.length - 1))},${180 - ((r.running - min) / span) * 150}`).join(' ')
  return <svg viewBox="0 0 300 200" className="w-full h-48 mt-2" role="img" aria-label="Running net cash flow chart"><path d="M12 180 H288" stroke="currentColor" className="text-white/10" /><polyline points={points} fill="none" stroke="#818cf8" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />{relevant.map((r, i) => <circle key={r.id} cx={12 + (relevant.length === 1 ? 0 : i * 276 / (relevant.length - 1))} cy={180 - ((r.running - min) / span) * 150} r="3" fill="#c7d2fe" />)}</svg>
}
function CategoryManager({ categories, onSaved }: { categories: Category[]; onSaved: () => void }) {
  const [name, setName] = useState(''); const [color, setColor] = useState(COLORS[2]); const [editingId, setEditingId] = useState<string | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  const save = async () => { const clean = name.trim(); if (!clean) return; setBusy(true); setError(''); const { data: { session } } = await supabase.auth.getSession(); if (!session?.user) { setError('Sign in before managing categories.'); setBusy(false); return } const query = editingId ? supabase.from('transaction_categories').update({ name: clean, color }).eq('id', editingId) : supabase.from('transaction_categories').insert({ name: clean, color }); const { error: saveError } = await query; if (saveError) setError(saveError.code === '23505' ? 'That category already exists.' : 'Could not save category.'); else { setName(''); setEditingId(null); onSaved() }; setBusy(false) }
  const remove = async (category: Category) => { if (!window.confirm(`Delete “${category.name}”? Existing transactions will become uncategorized.`)) return; const { error: removeError } = await supabase.from('transaction_categories').delete().eq('id', category.id); if (removeError) setError('Could not delete this category.'); else onSaved() }
  return <div className="mt-3 space-y-3"><div className="flex flex-wrap items-center gap-2">{categories.map(category => <div key={category.id} className="inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-1.5 text-xs"><i className="w-2 h-2 rounded-full" style={{ backgroundColor: category.color }} />{category.name}<button onClick={() => { setEditingId(category.id); setName(category.name); setColor(category.color) }} aria-label={`Edit ${category.name}`} className="text-slate-400 hover:text-white">Edit</button><button onClick={() => void remove(category)} aria-label={`Delete ${category.name}`} className="text-slate-500 hover:text-rose-300">×</button></div>)}</div><div className="flex flex-col sm:flex-row gap-2"><input value={name} maxLength={48} onChange={e => setName(e.target.value)} placeholder="New category" className="flex-1 rounded-xl bg-slate-900 border border-white/10 px-3 py-2 text-sm" /><input aria-label="Category color" type="color" value={color} onChange={e => setColor(e.target.value)} className="h-10 w-14 rounded-lg bg-slate-900 border border-white/10 p-1" /><button disabled={busy || !name.trim()} onClick={() => void save()} className="rounded-xl bg-indigo-500 px-4 py-2 text-sm font-semibold disabled:opacity-40">{editingId ? 'Save category' : 'Add category'}</button>{editingId && <button onClick={() => { setEditingId(null); setName('') }} className="rounded-xl border border-white/10 px-3 py-2 text-sm">Cancel</button>}</div>{error && <p className="text-xs text-rose-300">{error}</p>}</div>
}

function CorrectionDialog({ transaction, onCancel, onSaved }: { transaction: ReportTx; onCancel: () => void; onSaved: () => void }) {
  const [amount, setAmount] = useState(String(transaction.amount))
  const [description, setDescription] = useState(transaction.description || '')
  const [date, setDate] = useState(() => formatIndiaDateInputValue(transaction.created_at))
  const [reason, setReason] = useState('Corrected data entry')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const save = async (event: FormEvent) => {
    event.preventDefault()
    const value = Number(amount)
    if (!Number.isFinite(value) || value <= 0 || !description.trim() || !reason.trim()) { setError('Enter a valid positive amount, description, and reason.'); return }
    setSaving(true); setError('')
    const { error: correctionError } = await supabase.rpc('correct_ledger_transaction', {
      p_request_id: crypto.randomUUID(), p_transaction_id: transaction.id,
      p_amount: value, p_description: description.trim(), p_created_at: indiaDateInputToIso(date), p_reason: reason.trim(),
    })
    if (correctionError) { setError(safeBackendErrorMessage(correctionError, 'This entry could not be corrected. It may already be linked to another financial workflow or the correction would violate balance rules.')); setSaving(false); return }
    onSaved()
  }
  return <div className="fixed inset-0 z-[70] bg-black/70 backdrop-blur-sm grid place-items-center p-4" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onCancel() }}><form onSubmit={save} className="w-full max-w-lg rounded-3xl border border-white/10 bg-slate-950 p-5 shadow-2xl space-y-4" role="dialog" aria-modal="true" aria-labelledby="correct-entry-title"><div><p className="text-xs uppercase tracking-widest text-indigo-300">Audit-safe correction</p><h2 id="correct-entry-title" className="text-xl font-bold mt-1">Edit entry</h2><p className="text-xs text-slate-400 mt-1">The old row is preserved as voided and a corrected entry is posted.</p></div><label className="block text-sm text-slate-300">Description<input autoFocus maxLength={500} value={description} onChange={event => setDescription(event.target.value)} className="mt-1 w-full rounded-xl bg-white/5 border border-white/10 px-3 py-2" /></label><div className="grid grid-cols-2 gap-3"><label className="block text-sm text-slate-300">Amount<input type="number" min="0.01" step="0.01" value={amount} onChange={event => setAmount(event.target.value)} className="mt-1 w-full rounded-xl bg-white/5 border border-white/10 px-3 py-2" /></label><label className="block text-sm text-slate-300">Occurrence date<input type="date" required value={date} onChange={event => setDate(event.target.value)} className="mt-1 w-full rounded-xl bg-white/5 border border-white/10 px-3 py-2" /></label></div><label className="block text-sm text-slate-300">Correction reason<input required maxLength={200} value={reason} onChange={event => setReason(event.target.value)} className="mt-1 w-full rounded-xl bg-white/5 border border-white/10 px-3 py-2" /></label>{error && <p role="alert" className="text-sm text-rose-300">{error}</p>}<div className="flex justify-end gap-2"><button type="button" onClick={onCancel} className="rounded-xl border border-white/10 px-4 py-2 text-sm">Cancel</button><button disabled={saving} className="rounded-xl bg-indigo-500 px-4 py-2 text-sm font-semibold disabled:opacity-50">{saving ? 'Saving…' : 'Save correction'}</button></div></form></div>
}

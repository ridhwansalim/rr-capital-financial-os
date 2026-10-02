import { useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { Calculator as CalculatorIcon, Loader2 } from 'lucide-react'
import { useOptionalFeatures } from '../lib/optionalFeatures'
import { calculateEmi, calculateSavingsGrowth, compareLoanPayoff } from '../lib/calculatorMath'
import PageHeader from '../components/PageHeader'

const inputClass = 'mt-1 w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-3 text-sm text-white outline-none focus:border-indigo-400/50'
const money = (amount: number) => `₹${amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

function NumberField({ label, value, onChange, min = '0', step = 'any' }: { label: string; value: string; onChange: (value: string) => void; min?: string; step?: string }) {
  return <label className="text-xs text-slate-400">{label}<input type="number" min={min} step={step} value={value} onChange={event => onChange(event.target.value)} className={inputClass} /></label>
}

function ResultLine({ label, value, emphasis = false }: { label: string; value: string; emphasis?: boolean }) {
  return <div className="flex justify-between gap-3 border-b border-white/5 py-2 last:border-0"><span className="text-sm text-slate-400">{label}</span><strong className={emphasis ? 'text-emerald-300' : 'text-white'}>{value}</strong></div>
}

export default function Calculators() {
  const { flags, loading } = useOptionalFeatures()
  const [loan, setLoan] = useState({ principal: '100000', rate: '12', months: '12' })
  const [payoffInput, setPayoffInput] = useState({ balance: '100000', rate: '12', payment: '9000', extra: '1000' })
  const [savings, setSavings] = useState({ initial: '0', monthly: '5000', rate: '6', months: '60' })

  if (!loading && !flags.calculators) return <Navigate to="/" replace />
  if (loading) return <div className="p-6 min-h-[50vh] grid place-items-center text-slate-400"><Loader2 className="animate-spin" aria-label="Loading calculators" /></div>

  let emi: ReturnType<typeof calculateEmi> | null = null
  let emiError = ''
  try { emi = calculateEmi(Number(loan.principal), Number(loan.rate), Number(loan.months)) } catch (error) { emiError = error instanceof Error ? error.message : 'Check the inputs.' }

  let payoff: ReturnType<typeof compareLoanPayoff> | null = null
  let payoffError = ''
  try { payoff = compareLoanPayoff(Number(payoffInput.balance), Number(payoffInput.rate), Number(payoffInput.payment), Number(payoffInput.extra)) } catch (error) { payoffError = error instanceof Error ? error.message : 'Check the inputs.' }

  let growth: ReturnType<typeof calculateSavingsGrowth> | null = null
  let growthError = ''
  try { growth = calculateSavingsGrowth(Number(savings.initial), Number(savings.monthly), Number(savings.rate), Number(savings.months)) } catch (error) { growthError = error instanceof Error ? error.message : 'Check the inputs.' }

  return <main className="page-shell w-full max-w-6xl mx-auto pb-32 animate-in fade-in duration-300">
    <PageHeader eyebrow="Planning tools" title="Calculators" description="Explore estimates with assumptions you enter. Results are approximate, are not advice, and never create or change financial records." icon={<CalculatorIcon className="text-indigo-300" />} action={<Link to="/settings" className="inline-flex w-full justify-center rounded-xl border border-white/10 px-4 py-3 text-sm text-slate-300 hover:bg-white/5 sm:w-auto sm:py-2">Manage optional features</Link>} />

    <div className="grid gap-4 xl:grid-cols-2">
      <section className="surface-panel rounded-3xl p-5 sm:p-6"><h2 className="text-lg font-semibold">Loan / EMI estimate</h2><p className="mt-1 text-xs text-slate-400">Fixed monthly rate, equal month-end payments, no fees or rate changes.</p><div className="mt-4 grid grid-cols-2 gap-3"><NumberField label="Loan amount (₹)" value={loan.principal} onChange={principal => setLoan(v => ({ ...v, principal }))} min="0.01" /><NumberField label="Annual interest (%)" value={loan.rate} onChange={rate => setLoan(v => ({ ...v, rate }))} /><NumberField label="Term (months)" value={loan.months} onChange={months => setLoan(v => ({ ...v, months }))} step="1" min="1" /></div>{emiError ? <p role="alert" className="mt-4 text-sm text-rose-300">{emiError}</p> : emi && <div className="mt-4"><ResultLine label="Estimated monthly payment" value={money(emi.monthlyPayment)} emphasis /><ResultLine label="Total paid" value={money(emi.totalPayment)} /><ResultLine label="Total interest" value={money(emi.totalInterest)} /></div>}<p className="mt-3 text-[11px] text-slate-500">Formula: payment = principal × r(1+r)ⁿ ÷ ((1+r)ⁿ−1), where r is monthly rate.</p></section>

      <section className="surface-panel rounded-3xl p-5 sm:p-6"><h2 className="text-lg font-semibold">Extra-payment comparison</h2><p className="mt-1 text-xs text-slate-400">Compares the same rate and regular payment with an additional amount each month.</p><div className="mt-4 grid grid-cols-2 gap-3"><NumberField label="Outstanding balance (₹)" value={payoffInput.balance} onChange={balance => setPayoffInput(v => ({ ...v, balance }))} min="0.01" /><NumberField label="Annual interest (%)" value={payoffInput.rate} onChange={rate => setPayoffInput(v => ({ ...v, rate }))} /><NumberField label="Current monthly payment (₹)" value={payoffInput.payment} onChange={payment => setPayoffInput(v => ({ ...v, payment }))} min="0.01" /><NumberField label="Extra per month (₹)" value={payoffInput.extra} onChange={extra => setPayoffInput(v => ({ ...v, extra }))} /></div>{payoffError ? <p role="alert" className="mt-4 text-sm text-rose-300">{payoffError}</p> : payoff && <div className="mt-4"><ResultLine label="Current payoff" value={`${payoff.standard.months} months · ${money(payoff.standard.totalInterest)} interest`} /><ResultLine label="With extra payment" value={`${payoff.accelerated.months} months · ${money(payoff.accelerated.totalInterest)} interest`} emphasis /><ResultLine label="Estimated interest saved" value={money(payoff.interestSaved)} /></div>}<p className="mt-3 text-[11px] text-slate-500">Monthly interest is applied before each payment. No taxes, fees, prepayment rules, or rate changes are included.</p></section>

      <section className="surface-panel rounded-3xl p-5 sm:p-6 xl:col-span-2"><h2 className="text-lg font-semibold">Savings growth estimate</h2><p className="mt-1 text-xs text-slate-400">Assumes a constant annual rate divided into monthly periods and contributions at each month end.</p><div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3"><NumberField label="Starting amount (₹)" value={savings.initial} onChange={initial => setSavings(v => ({ ...v, initial }))} /><NumberField label="Monthly contribution (₹)" value={savings.monthly} onChange={monthly => setSavings(v => ({ ...v, monthly }))} /><NumberField label="Annual growth rate (%)" value={savings.rate} onChange={rate => setSavings(v => ({ ...v, rate }))} /><NumberField label="Term (months)" value={savings.months} onChange={months => setSavings(v => ({ ...v, months }))} step="1" min="1" /></div>{growthError ? <p role="alert" className="mt-4 text-sm text-rose-300">{growthError}</p> : growth && <div className="mt-4 grid gap-x-8 sm:grid-cols-3"><ResultLine label="Estimated value" value={money(growth.futureValue)} emphasis /><ResultLine label="Amount contributed" value={money(growth.contributed)} /><ResultLine label="Estimated growth" value={money(growth.growth)} /></div>}<p className="mt-3 text-[11px] text-slate-500">Formula: starting amount grows monthly, plus each month-end contribution compounded through the remaining periods. Actual returns may vary.</p></section>
    </div>
  </main>
}
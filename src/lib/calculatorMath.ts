export type EmiResult = { monthlyPayment: number; totalPayment: number; totalInterest: number }
export type PayoffResult = { months: number; totalPaid: number; totalInterest: number }
const MAX_AMOUNT = 999_999_999_999.99
const MAX_TERM_MONTHS = 600

function requireFinitePositive(value: number, label: string) {
  if (!Number.isFinite(value) || value <= 0 || value > MAX_AMOUNT) throw new Error(`${label} must be greater than zero and no more than ₹${MAX_AMOUNT.toLocaleString('en-IN')}.`)
}

function validateRate(ratePercent: number) {
  if (!Number.isFinite(ratePercent) || ratePercent < 0 || ratePercent > 100) throw new Error('Annual rate must be between 0% and 100%.')
}

export function calculateEmi(principal: number, annualRatePercent: number, months: number): EmiResult {
  requireFinitePositive(principal, 'Loan amount')
  validateRate(annualRatePercent)
  if (!Number.isInteger(months) || months < 1 || months > MAX_TERM_MONTHS) throw new Error(`Term must be from 1 to ${MAX_TERM_MONTHS} months.`)
  const monthlyRate = annualRatePercent / 1200
  const monthlyPayment = monthlyRate === 0
    ? principal / months
    : principal * monthlyRate * (1 + monthlyRate) ** months / ((1 + monthlyRate) ** months - 1)
  const totalPayment = monthlyPayment * months
  return { monthlyPayment, totalPayment, totalInterest: totalPayment - principal }
}

function payoff(principal: number, monthlyRate: number, payment: number): PayoffResult {
  let balance = principal
  let totalPaid = 0
  let totalInterest = 0
  let months = 0
  while (balance > 0.005 && months < 1200) {
    const interest = balance * monthlyRate
    if (payment <= interest) throw new Error('Payment must exceed the monthly interest or the balance will not reduce.')
    const paid = Math.min(payment, balance + interest)
    totalInterest += interest
    totalPaid += paid
    balance = Math.max(0, balance + interest - paid)
    months += 1
  }
  if (balance > 0.005) throw new Error('This payment schedule exceeds 1,200 months.')
  return { months, totalPaid, totalInterest }
}

export function compareLoanPayoff(principal: number, annualRatePercent: number, currentPayment: number, extraMonthlyPayment = 0) {
  requireFinitePositive(principal, 'Outstanding balance')
  requireFinitePositive(currentPayment, 'Monthly payment')
  validateRate(annualRatePercent)
  if (!Number.isFinite(extraMonthlyPayment) || extraMonthlyPayment < 0 || extraMonthlyPayment > MAX_AMOUNT) throw new Error('Extra payment must be between zero and the supported amount limit.')
  const rate = annualRatePercent / 1200
  const standard = payoff(principal, rate, currentPayment)
  const accelerated = extraMonthlyPayment > 0 ? payoff(principal, rate, currentPayment + extraMonthlyPayment) : standard
  return {
    standard,
    accelerated,
    monthsSaved: standard.months - accelerated.months,
    interestSaved: standard.totalInterest - accelerated.totalInterest,
  }
}

export function calculateSavingsGrowth(initialAmount: number, monthlyContribution: number, annualRatePercent: number, months: number) {
  if (!Number.isFinite(initialAmount) || initialAmount < 0 || initialAmount > MAX_AMOUNT) throw new Error('Starting amount must be non-negative and within the supported amount limit.')
  if (!Number.isFinite(monthlyContribution) || monthlyContribution < 0 || monthlyContribution > MAX_AMOUNT) throw new Error('Monthly contribution must be non-negative and within the supported amount limit.')
  validateRate(annualRatePercent)
  if (!Number.isInteger(months) || months < 1 || months > MAX_TERM_MONTHS) throw new Error(`Term must be from 1 to ${MAX_TERM_MONTHS} months.`)
  const monthlyRate = annualRatePercent / 1200
  const factor = (1 + monthlyRate) ** months
  const futureValue = monthlyRate === 0
    ? initialAmount + monthlyContribution * months
    : initialAmount * factor + monthlyContribution * (factor - 1) / monthlyRate
  const contributed = initialAmount + monthlyContribution * months
  return { futureValue, contributed, growth: futureValue - contributed }
}

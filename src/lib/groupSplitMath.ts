export type SplitMode = 'equal' | 'exact' | 'percentage'

export interface SplitParticipantInput {
  key: string
  amount?: string | number
  percentage?: string | number
}

export interface SplitAllocation {
  participantKey: string
  amountCents: number
}

export interface SplitCalculation {
  allocations: SplitAllocation[]
  ownerShareCents: number
  totalCents: number
  valid: boolean
  error: string | null
}

export function toCents(value: string | number): number | null {
  if (typeof value === 'string' && !/^\d+(?:\.\d{1,2})?$/.test(value.trim())) return null
  const parsed = typeof value === 'number' ? value : Number(value.trim())
  if (!Number.isFinite(parsed) || parsed < 0) return null
  return Math.round((parsed + Number.EPSILON) * 100)
}

function distributeCents(totalCents: number, count: number): number[] {
  const base = Math.floor(totalCents / count)
  const remainder = totalCents % count
  return Array.from({ length: count }, (_, index) => base + (index < remainder ? 1 : 0))
}

export function calculateGroupSplit(
  total: string | number,
  participants: SplitParticipantInput[],
  includeSelf: boolean,
  mode: SplitMode,
  ownerShareInput: string | number = ''
): SplitCalculation {
  const totalCents = toCents(total)
  const invalid = (error: string): SplitCalculation => ({
    allocations: [], ownerShareCents: 0, totalCents: totalCents ?? 0, valid: false, error,
  })

  if (totalCents === null || totalCents <= 0) return invalid('Enter a bill amount greater than zero.')
  if (!participants.length) return invalid('Add at least one participant.')
  const shareCount = participants.length + (includeSelf ? 1 : 0)
  if (shareCount < 1) return invalid('Choose at least one share.')

  let amounts: number[]
  let ownerShareCents = 0

  if (mode === 'equal') {
    const distributed = distributeCents(totalCents, shareCount)
    amounts = distributed.slice(0, participants.length)
    ownerShareCents = includeSelf ? distributed[distributed.length - 1] : 0
  } else if (mode === 'exact') {
    const entered = participants.map(participant => toCents(participant.amount ?? ''))
    if (entered.some(value => value === null)) return invalid('Enter a valid amount for every participant.')
    amounts = entered as number[]
    ownerShareCents = includeSelf ? (toCents(ownerShareInput) ?? -1) : 0
    if (ownerShareCents < 0) return invalid('Enter your personal share amount.')
    const sum = amounts.reduce((acc, value) => acc + value, ownerShareCents)
    if (sum !== totalCents) return invalid('Participant and personal shares must add up to the bill total.')
  } else {
    const entered = participants.map(participant => Number(participant.percentage))
    if (entered.some(value => !Number.isFinite(value) || value < 0)) return invalid('Enter a valid percentage for every participant.')
    const ownerPercentage = includeSelf ? Number(ownerShareInput) : 0
    if (includeSelf && (!Number.isFinite(ownerPercentage) || ownerPercentage < 0)) return invalid('Enter your personal percentage.')
    const percentTotal = entered.reduce((acc, value) => acc + value, ownerPercentage)
    if (Math.abs(percentTotal - 100) > 0.0001) return invalid('Participant and personal percentages must add up to 100%.')
    const raw = [...entered, ...(includeSelf ? [ownerPercentage] : [])]
    const baseCents = raw.map(value => Math.floor(totalCents * value / 100))
    let remainder = totalCents - baseCents.reduce((acc, value) => acc + value, 0)
    const order = raw.map((value, index) => ({ index, fraction: totalCents * value / 100 - baseCents[index] }))
      .sort((a, b) => b.fraction - a.fraction)
    for (let index = 0; remainder > 0; index += 1, remainder -= 1) baseCents[order[index % order.length].index] += 1
    amounts = baseCents.slice(0, participants.length)
    ownerShareCents = includeSelf ? baseCents[baseCents.length - 1] : 0
  }

  if (amounts.some(amount => amount <= 0)) return invalid('Each participant needs a share greater than ₹0.00.')

  return {
    allocations: participants.map((participant, index) => ({ participantKey: participant.key, amountCents: amounts[index] })),
    ownerShareCents,
    totalCents,
    valid: true,
    error: null,
  }
}

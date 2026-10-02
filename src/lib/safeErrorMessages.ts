type ErrorShape = {
  code?: unknown
  status?: unknown
  details?: unknown
  hint?: unknown
  message?: unknown
}

function errorShape(error: unknown): ErrorShape | null {
  return error && typeof error === 'object' ? error as ErrorShape : null
}

/** Turn backend diagnostics into bounded copy without reflecting submitted data. */
export function safeBackendErrorMessage(error: unknown, fallback: string): string {
  const value = errorShape(error)
  const code = typeof value?.code === 'string' ? value.code : ''
  const status = typeof value?.status === 'number' ? value.status : 0

  if (code === '23505') return 'A record with those details already exists. Check the entry and try again.'
  if (code === '23503') return 'A linked account or record is unavailable. Refresh and try again.'
  if (code === '55000') return 'This entry is linked to another financial workflow. Correct it there to preserve its history.'
  if (code === '42501' || status === 401 || status === 403) return 'You do not have permission to complete this action. Sign in again and retry.'
  if (code.startsWith('22')) return 'Some entered values are invalid. Check the amount and date, then try again.'
  if (code.startsWith('23')) return 'This change conflicts with a financial rule or linked record. Check the details and try again.'
  if (code.startsWith('PGRST')) return 'The app could not complete this request. Refresh RR Capital and try again.'
  if (status === 429) return 'Too many requests. Wait a moment and try again.'
  return fallback
}

/** Preserve app-authored validation errors, but never display backend diagnostics. */
export function safeCaughtErrorMessage(error: unknown, fallback: string): string {
  const value = errorShape(error)
  if (value && (typeof value.code === 'string' || typeof value.status === 'number'
    || typeof value.details === 'string' || typeof value.hint === 'string')) {
    return safeBackendErrorMessage(error, fallback)
  }

  if (error instanceof Error && error.name === 'Error') {
    const message = error.message
    const isLocalValidation = /^(Choose |Enter |Select |This |The server rejected this entry|Passwords do not match|Not authenticated|Authentication error|Authentication missing|The selected |Cannot delete this account|Transaction would make liquid account history negative)/.test(message)
    if (isLocalValidation && message.length <= 240) return message
  }
  return fallback
}

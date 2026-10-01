const PIN_HASH_KEY = 'financial_os_pin_hash'
const LEGACY_PIN_KEY = 'financial_os_pin'
const PIN_FAILURES_KEY = 'financial_os_pin_failures'
const PIN_LOCKED_UNTIL_KEY = 'financial_os_pin_locked_until'
const PIN_HASH_ITERATIONS = 310_000

function encodeBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function decodeBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), char => char.charCodeAt(0))
}

async function derivePinHash(pin: string, salt: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pin),
    'PBKDF2',
    false,
    ['deriveBits']
  )
  const saltBuffer = new Uint8Array(salt.length)
  saltBuffer.set(salt)
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: saltBuffer.buffer, iterations: PIN_HASH_ITERATIONS },
    key,
    256
  )
  return new Uint8Array(bits)
}

function matchesHash(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index]
  return difference === 0
}

function readPinRecord(): { salt: Uint8Array; hash: Uint8Array } | null {
  const record = localStorage.getItem(PIN_HASH_KEY)
  if (!record) return null
  const parts = record.split('$')
  if (parts.length !== 4 || parts[0] !== 'pbkdf2-sha256' || parts[1] !== String(PIN_HASH_ITERATIONS)) return null
  try {
    const salt = decodeBase64(parts[2])
    const hash = decodeBase64(parts[3])
    return salt.length === 16 && hash.length === 32 ? { salt, hash } : null
  } catch {
    return null
  }
}

export function hasAppPinConfigured(): boolean {
  return Boolean(readPinRecord() || /^\d{4}$/.test(localStorage.getItem(LEGACY_PIN_KEY) || ''))
}

export async function storeAppPin(pin: string): Promise<void> {
  if (!/^\d{4}$/.test(pin)) throw new Error('The app PIN must contain four digits.')
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const hash = await derivePinHash(pin, salt)
  localStorage.setItem(PIN_HASH_KEY, `pbkdf2-sha256$${PIN_HASH_ITERATIONS}$${encodeBase64(salt)}$${encodeBase64(hash)}`)
  localStorage.removeItem(LEGACY_PIN_KEY)
}

export async function removeAppPin(): Promise<void> {
  localStorage.removeItem(PIN_HASH_KEY)
  localStorage.removeItem(LEGACY_PIN_KEY)
}

export async function verifyAppPin(pin: string): Promise<boolean> {
  if (!/^\d{4}$/.test(pin)) return false
  const lockedUntil = Number(localStorage.getItem(PIN_LOCKED_UNTIL_KEY) || 0)
  if (Number.isFinite(lockedUntil) && lockedUntil > Date.now()) return false

  const stored = readPinRecord()
  if (stored) {
    try {
      const actual = await derivePinHash(pin, stored.salt)
      if (matchesHash(actual, stored.hash)) {
        localStorage.removeItem(PIN_FAILURES_KEY)
        localStorage.removeItem(PIN_LOCKED_UNTIL_KEY)
        return true
      }
      recordPinFailure()
      return false
    } catch {
      return false
    }
  }

  // Upgrade old installs the first time the user successfully unlocks.
  const legacyPin = localStorage.getItem(LEGACY_PIN_KEY) || ''
  if (/^\d{4}$/.test(legacyPin) && pin === legacyPin) {
    await storeAppPin(legacyPin)
    localStorage.removeItem(PIN_FAILURES_KEY)
    localStorage.removeItem(PIN_LOCKED_UNTIL_KEY)
    return true
  }
  if (/^\d{4}$/.test(legacyPin)) recordPinFailure()
  return false
}

function recordPinFailure(): void {
  const previous = Number(localStorage.getItem(PIN_FAILURES_KEY) || 0)
  const failures = (Number.isFinite(previous) && previous > 0 ? previous : 0) + 1
  localStorage.setItem(PIN_FAILURES_KEY, String(failures))
  if (failures >= 5) {
    const delayMs = Math.min(15 * 60_000, 30_000 * (2 ** Math.min(failures - 5, 5)))
    localStorage.setItem(PIN_LOCKED_UNTIL_KEY, String(Date.now() + delayMs))
  }
}

export async function migrateLegacyAppPin(): Promise<void> {
  const legacyPin = localStorage.getItem(LEGACY_PIN_KEY) || ''
  if (readPinRecord() || !/^\d{4}$/.test(legacyPin)) return
  await storeAppPin(legacyPin)
}

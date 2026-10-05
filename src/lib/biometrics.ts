import { Capacitor } from '@capacitor/core'
import { registerPlugin } from '@capacitor/core'
import { AndroidBiometryStrength, BiometricAuth, type CheckBiometryResult } from '@aparajita/capacitor-biometric-auth'

const NativeBiometricPreference = registerPlugin<{
  setEnabled(options: { ownerId: string; enabled: boolean }): Promise<void>
  isEnabled(options: { ownerId: string }): Promise<{ enabled: boolean }>
}>('BiometricPreference')

export interface BiometricAvailability {
  isAvailable: boolean
  biometryType: CheckBiometryResult['biometryType'] | 'none'
  isEnrolled: boolean
  reason?: string
}

export async function checkBiometricAvailability(): Promise<BiometricAvailability> {
  if (!Capacitor.isNativePlatform()) {
    return { isAvailable: false, biometryType: 'none', isEnrolled: false, reason: 'Native biometric authentication is available in the installed app.' }
  }

  const result = await BiometricAuth.checkBiometry()
  const hardwareAvailable = result.biometryTypes.length > 0
  return {
    isAvailable: hardwareAvailable,
    biometryType: result.biometryType,
    isEnrolled: result.isAvailable,
    reason: result.reason || (hardwareAvailable && !result.isAvailable ? 'No fingerprint or face is enrolled on this device.' : undefined),
  }
}

export async function authenticateWithBiometrics(reason: string): Promise<void> {
  await BiometricAuth.authenticate({
    reason,
    cancelTitle: 'Use PIN / Password',
    allowDeviceCredential: true,
    androidTitle: 'RR Capital',
    androidSubtitle: reason,
    androidConfirmationRequired: false,
    androidBiometryStrength: AndroidBiometryStrength.weak,
  })
}

/**
 * Persists only the owner-scoped opt-in flag. Biometric templates and the
 * cryptographic authentication remain managed by Android's BiometricPrompt;
 * RR Capital never stores biometric material in web storage.
 */
export async function enableBiometricForOwner(ownerId: string): Promise<void> {
  if (!ownerId || !Capacitor.isNativePlatform()) throw new Error('Native biometric storage is unavailable.')
  await NativeBiometricPreference.setEnabled({ ownerId, enabled: true })
}

export async function disableBiometricForOwner(ownerId: string): Promise<void> {
  if (!ownerId || !Capacitor.isNativePlatform()) return
  await NativeBiometricPreference.setEnabled({ ownerId, enabled: false })
}

export async function isBiometricEnabledForOwner(ownerId: string): Promise<boolean> {
  if (!ownerId || !Capacitor.isNativePlatform()) return false
  const result = await NativeBiometricPreference.isEnabled({ ownerId })
  return result.enabled === true
}

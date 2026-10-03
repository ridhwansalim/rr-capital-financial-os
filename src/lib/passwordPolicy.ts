export const PASSWORD_MIN_LENGTH = 12

/** Keep password-setting forms aligned with supabase/config.toml. */
export function getPasswordPolicyError(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) return `Use at least ${PASSWORD_MIN_LENGTH} characters.`
  if (!/[a-z]/.test(password)) return 'Include at least one lowercase letter.'
  if (!/[A-Z]/.test(password)) return 'Include at least one uppercase letter.'
  if (!/\d/.test(password)) return 'Include at least one number.'
  if (!/[^A-Za-z0-9]/.test(password)) return 'Include at least one symbol.'
  return null
}

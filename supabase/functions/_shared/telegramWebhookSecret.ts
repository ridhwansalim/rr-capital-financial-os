/** Telegram setWebhook permits only URL-safe ASCII in secret_token. */
export function isValidTelegramWebhookSecret(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{32,256}$/.test(value)
}

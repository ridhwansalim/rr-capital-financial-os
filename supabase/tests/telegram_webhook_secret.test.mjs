import test from 'node:test'
import assert from 'node:assert/strict'
import { isValidTelegramWebhookSecret } from '../functions/_shared/telegramWebhookSecret.ts'

test('accepts strong URL-safe secrets that Telegram accepts', () => {
  assert.equal(isValidTelegramWebhookSecret('A'.repeat(32)), true)
  assert.equal(isValidTelegramWebhookSecret(`aZ09_${'-'.repeat(27)}`), true)
  assert.equal(isValidTelegramWebhookSecret('A'.repeat(256)), true)
})

test('rejects missing, weak, oversized, or Telegram-forbidden secret values', () => {
  for (const value of [undefined, null, '', 'too-short', 'A'.repeat(31), 'A'.repeat(257), 'A'.repeat(31) + '+', 'A'.repeat(31) + '/', 'A'.repeat(31) + '=', 'A'.repeat(31) + ' ']) {
    assert.equal(isValidTelegramWebhookSecret(value), false, `expected invalid secret: ${String(value).slice(0, 40)}`)
  }
})

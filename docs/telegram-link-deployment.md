# Telegram linking deployment

The old webhook accepted `/start <profile UUID>` and could attach an arbitrary
Telegram chat to that profile. The replacement accepts a short-lived, single-use
link token issued to an authenticated RR Capital user.

## Deployed state (2026-10-01)

- The `telegram_link_challenge` database migration is applied to RR Capital.
- `TELEGRAM_BOT_TOKEN` was rotated by the owner and stored as a Supabase Edge
  Function secret.
- A cryptographically random `TELEGRAM_WEBHOOK_SECRET` is stored as a Supabase
  Edge Function secret.
- The `telegram-webhook` function is deployed with JWT verification disabled.
  It rejects requests without Telegram's secret header and only accepts
  one-time tokens in private chats.
- Telegram's `setWebhook` registration has not yet been completed. Until it is,
  the bot cannot deliver link confirmations to the function.

## Finish registration and verify

1. Register `https://hnebvwfgsotrknxpgpmv.supabase.co/functions/v1/telegram-webhook`
   with Telegram's `setWebhook`, using the rotated token for `@ridhwans_fin_bot`
   and the matching `TELEGRAM_WEBHOOK_SECRET` value as `secret_token`. Enter the
   bot token only in a local secure prompt. Never put credentials in Git or chat.
2. Test requests with a missing or wrong secret, `/start <profile UUID>`, a
   group chat, an expired token, and a replayed token. Each must leave profile
   links unchanged.
3. Issue a link token while signed in, open the bot deep link from Settings,
   and verify only the issuing user's profile receives the private chat ID.
   Verify issuing a second token invalidates the first.
4. Verify alert delivery separately. The `send-alert` function is deployed
   with a separate header secret, but the database transaction event hook is
   not configured yet. A successful Telegram link alone does not establish
   transaction notifications.

The Settings screen labels manual Chat ID entry as an advanced option, separate
from verified linking. No bot token, webhook secret, or service-role key belongs
in this document or the repository.

# Telegram linking deployment

The old webhook accepted `/start <profile UUID>` and could attach an arbitrary
Telegram chat to that profile. The replacement accepts a short-lived, single-use
link token issued to an authenticated RR Capital user.

## Deployed state (verified 2026-10-03)

- The `telegram_link_challenge` database migration is applied to RR Capital.
- The owner rotated `TELEGRAM_BOT_TOKEN`; the credential is stored as a
  Supabase Edge Function secret and is not returned to the browser.
- A cryptographically random `TELEGRAM_WEBHOOK_SECRET` is stored as a Supabase
  Edge Function secret.
- Supabase reports `telegram-webhook` ACTIVE at version 8 and `send-alert`
  ACTIVE at version 4. The current production webhook source uses the
  authenticated setup and private-chat one-time-token flow described here.
- The version 8 webhook logs a fixed message for unexpected webhook exceptions;
  it does not log raw exception text that could include a bot-token URL.
- A production anonymous `POST {"action":"configure"}` returned HTTP 401
  (`Sign in required`); no credentials were supplied, Telegram setup was not
  invoked, and no database change occurred.
- The webhook function rejects requests without Telegram's secret header and
  accepts link tokens only in private chats.
- The `send-alert` function sends a generic notification after a new peer
  obligation, EMI, or settlement request. Its database trigger reads the
  endpoint and verification secret from Supabase Vault and includes no amount
  or user-entered description in the Telegram payload.
- The authenticated Settings flow calls Telegram `setWebhook`, then checks
  `getWebhookInfo` and verifies the registered URL before it issues a link code.
- An aggregate-only profile check on 2026-10-03 found no linked Telegram chat.
  RR Capital has one preserved owner login, so no new signup is required.
  Function status and SQL tests do not prove that a real link completed.

## Finish and verify the owner link

1. Sign in to the preserved RR Capital owner account, open Settings, and tap
   **Link Telegram**. The Edge Function registers the webhook with Telegram and
   verifies its URL before returning a short-lived token; credentials stay
   server-side.
2. Open the bot deep link for `@ridhwans_fin_bot` and tap **Start** in the
   private chat within ten minutes. Settings should detect the linked profile,
   and the bot should confirm success. A malformed, expired, or replayed `/start`
   receives an instruction to create a fresh link.
3. The synthetic SQL test verifies that a second token invalidates the first,
   invalid and expired tokens fail, anonymous token issuance is denied, browser
   callers cannot consume tokens or read challenge rows, and successful
   consumption links only the issuing user. Before relying on the bot, verify
   delivery on the owner's device and confirm Settings displays the linked
   state.
4. Verify alert delivery separately using a newly-created test request. The
   trigger sends a generic notice without financial details. A successful
   Telegram link alone does not establish request-notification delivery.

Settings has no manual Chat ID entry; chat IDs can only be set by consuming a
valid, single-use link token from a private Telegram chat. No bot token, webhook
secret, or service-role key belongs in this document or the repository.

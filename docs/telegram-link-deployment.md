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
- The `send-alert` function sends a generic notification after a new peer
  obligation, EMI, or settlement request. Its database trigger reads the
  endpoint and verification secret from Supabase Vault and includes no amount
  or user-entered description in the Telegram payload.
- The authenticated Settings flow calls Telegram `setWebhook`, then checks
  `getWebhookInfo` and verifies the registered URL before it issues a link code.
- Recent Edge request logs contain three successful POSTs, one unauthorized
  setup call, one GET rejected with 405, and one OPTIONS success. These counts
  do not establish that a real link completed. The reset currently leaves no
  auth user, so the authenticated setup path must be exercised after the owner
  signs up again.

## Finish registration and verify

1. Sign up again at the public RR Capital login page, then open Settings and tap
   **Link Telegram**. The Edge Function registers the webhook with Telegram and
   verifies its URL before returning a short-lived token; credentials stay
   server-side.
2. Open the bot deep link for `@ridhwans_fin_bot` and tap **Start** in the
   private chat within ten minutes. Settings should detect the linked profile,
   and the bot should confirm success. A malformed, expired, or replayed `/start`
   now receives an instruction to create a fresh link instead of failing silently.
3. Verify a second token invalidates the first, and that an invalid token,
   group chat, and request without the Telegram secret header cannot change any
   profile. Only the issuing user's private chat may be linked.
4. Verify alert delivery separately using a newly-created test request. The
   trigger sends a generic notice without financial details. A successful
   Telegram link alone does not establish request notification delivery.

The Settings screen labels manual Chat ID entry as an advanced option, separate
from verified linking. No bot token, webhook secret, or service-role key belongs
in this document or the repository.

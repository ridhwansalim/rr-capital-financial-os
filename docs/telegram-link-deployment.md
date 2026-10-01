# Telegram linking deployment gate

The old webhook accepted `/start <profile UUID>` and could attach an arbitrary
Telegram chat to that profile. The replacement accepts only a short-lived,
single-use link token issued to an authenticated RR Capital user. Keep the
replacement webhook undeployed until all items below can be completed together.

1. Apply `20260930183000_telegram_link_challenge.sql` to the intended Supabase
   project. Run `supabase/tests/telegram_link_challenge.test.sql` against an
   isolated copy first. The token table must remain in the unexposed `private`
   schema; only `service_role` may consume tokens.
2. Configure `TELEGRAM_WEBHOOK_SECRET` as a random 32–256 character value using
   Telegram's allowed `A-Z`, `a-z`, `0-9`, `_`, `-` alphabet. Configure the
   same value as `secret_token` when calling Telegram `setWebhook`. Keep it in
   the Supabase Edge Function secrets, never in Vite variables or source code.
   The function returns 503 if this secret is missing.
3. Deploy `telegram-webhook` with JWT verification disabled, because Telegram
   does not send a Supabase JWT. The verified secret header and single-use
   challenge are the webhook's authentication boundaries. Register its exact
   HTTPS URL with Telegram using `setWebhook` and the configured secret token.
4. Settings calls `issue_telegram_link_token()` and opens the
   `@ridhwans_fin_bot` deep link. The token is valid for ten minutes, and
   issuing another token invalidates the previous one.
5. Verify rejected requests with no or wrong secret, public UUID `/start`
   messages, group chats, expired tokens, replayed tokens, and concurrent
   issuance. Verify a valid private-chat link updates only the issuing user's
   profile and that an alert reaches that chat. Confirm the bot's webhook
   secret configuration after deployment; a successful Edge Function deploy
   alone does not set Telegram's webhook.

The existing manual Chat ID field still lets a user point their own alerts to
an entered chat ID. It should be replaced or clearly separated from verified
linking when the Settings UI is reviewed. No bot token, webhook secret, or
service-role key belongs in this document or the repository.

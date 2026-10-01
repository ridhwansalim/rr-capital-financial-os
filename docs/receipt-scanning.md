# Receipt scanning

Receipt scanning keeps the original transaction autofill flow: select or take a
receipt photo, then review the extracted amount, description, and income/expense
type before saving the transaction.

The browser sends the image to the authenticated `scan-receipt` Supabase Edge
Function. That function validates the user's Supabase session, reads that
account's Gemini BYOK value from encrypted Supabase Vault storage through a
service-role-only database function, accepts only
JPEG, PNG, WebP, HEIC, and HEIF images up to 8 MB, applies a per-user limit of
10 scans per minute, and sends the image to Google Gemini 3.8 Flash. The image
bytes are not saved to RR Capital's database or storage by this function. The
user-facing scan control discloses that the selected image is sent to Gemini.
Extracted values are suggestions; the user must review them before saving.

## Add a personal key

1. Each user creates their own Gemini API key in Google AI Studio.
2. In RR Capital Settings, enter that key in **Your Gemini API Key (BYOK)**.
   The key is encrypted in Supabase Vault, outside the client-readable profile
   table. An authenticated Edge Function associates it with its owner, uses it
   only for that account's request, and never sends it back to the browser or
   logs it. Never put a personal key in Vercel variables, `.env`, a public
   issue, or chat.
3. Verify an authenticated scan with that user's key succeeds, an unauthenticated request gets
   `401`, an unapproved web origin gets `403`, and repeated scans are limited.

Receipt scanning is unavailable for an account until its owner adds a personal
Gemini key. No real receipt should be used in testing without that user's
consent; use a synthetic sample receipt for verification.

# RR Capital / Financial OS

A personal and household finance PWA built around real accounts, shared obligations, and the way money moves between people. It supports ordinary transactions alongside lending, borrowing, bank EMIs, and Chitti commitments.

## What it does

- Tracks accounts, income, expenses, transfers, contacts, and a searchable ledger.
- Records peer-to-peer requests and settlements, including approval by the other person.
- Tracks recurring bank EMIs and Chitti installments and payouts.
- Queues offline transactions locally and provides a pending/retry view when a sync fails.
- Supports Telegram alert linking through a short-lived, single-use challenge.
- Scans receipt images through an authenticated Supabase Edge Function and returns an amount, description, and transaction type for the user to review.
- Uses Supabase Auth, PostgreSQL row-level security, and database functions for ownership checks and atomic financial actions.

The app uses React, TypeScript, Vite, Tailwind CSS, Supabase, Dexie, and a service worker. The database migrations and SQL checks live in [`supabase/`](supabase/). The migration and restore workflow is documented in [`docs/database-recovery.md`](docs/database-recovery.md).

## Run locally

1. Install Node.js 20 or newer and run `npm ci`.
2. Copy `.env.example` to `.env.local` and set your own Supabase URL and publishable/anon key. Keep service-role keys and bot tokens out of browser variables.
3. Run `npm run dev` for development or `npm run build` to check a production build.

Use a Supabase project you control. Review the migrations before applying them to an existing database; the first migration captures this project's schema baseline.

Receipt scanning sends the selected image to Google Gemini for extraction using each person's own Gemini API key from Settings. Keys are encrypted in Supabase Vault and excluded from the readable profile table. The image is not written to RR Capital storage by the scanner. The endpoint accepts images up to 8 MB and limits each account to ten scans per minute. Users should review extracted values before saving. See [`docs/receipt-scanning.md`](docs/receipt-scanning.md).

## Current rollout status

The RR Capital production database has the hardening migrations applied. Generic Telegram alerts now have a database event hook; Telegram `setWebhook` registration remains outstanding, so verified bot linking is not live yet. Receipt scanning is deployed and requires each user to add their own Gemini key in Settings. The production Vercel URL is public so users can reach Supabase sign-in; preview deployments remain Vercel-protected. The public repository is a source showcase; live-service configuration and credentials are intentionally excluded.

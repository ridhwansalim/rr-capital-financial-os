# RR Capital / Financial OS

A personal and household finance PWA built around real accounts, shared obligations, and the way money moves between people. It supports ordinary transactions alongside lending, borrowing, bank EMIs, and Chitti commitments.

## What it does

- Tracks accounts, income, expenses, transfers, contacts, and a searchable ledger.
- Records peer-to-peer requests and settlements, including approval by the other person.
- Tracks recurring bank EMIs and Chitti installments and payouts.
- Queues offline transactions locally and provides a pending/retry view when a sync fails.
- Supports Telegram alert linking through a short-lived, single-use challenge.
- Uses Supabase Auth, PostgreSQL row-level security, and database functions for ownership checks and atomic financial actions.

The app uses React, TypeScript, Vite, Tailwind CSS, Supabase, Dexie, and a service worker. The database migrations and SQL checks live in [`supabase/`](supabase/). The migration and restore workflow is documented in [`docs/database-recovery.md`](docs/database-recovery.md).

## Run locally

1. Install Node.js 20 or newer and run `npm ci`.
2. Copy `.env.example` to `.env.local` and set your own Supabase URL and publishable/anon key. Keep service-role keys and bot tokens out of browser variables.
3. Run `npm run dev` for development or `npm run build` to check a production build.

Use a Supabase project you control. Review the migrations before applying them to an existing database; the first migration captures this project's schema baseline.

## Current rollout status

The RR Capital production database has the hardening migrations applied, and the Telegram link webhook is deployed. The alert notification function and Telegram `setWebhook` registration remain to be completed. Receipt scanning is paused while its external image/key flow is reviewed. The public repository is a source showcase; live-service configuration and credentials are intentionally excluded.

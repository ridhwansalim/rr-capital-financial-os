# Financial OS (Personal & Household Ledger)

A cross-platform, multi-entity Progressive Web App (PWA) designed to track personal finances, joint household budgets, proxy purchases, credit card rolling fees, and regional financial schemes (Chit Funds).

## 🚀 The Architecture
This is not a standard expense tracker. It is built on a strict double-entry ledger system using PostgreSQL, separating real-world accounts from virtual obligations (IOUs).

* **Frontend:** React.js, Vite, Tailwind CSS, `shadcn/ui`
* **Backend:** Supabase (PostgreSQL, Auth, RLS, Storage)
* **Offline Sync:** Dexie.js (IndexedDB) via the **Outbox Pattern**
* **UI/UX:** Liquid Glassmorphism (`@samasante/liquid-glass`), Draggable Dashboards (`react-grid-layout`), Auto/Dark/AMOLED themes.

## ✨ Core Features
* **The "Yours, Mine, Ours" Engine:** Strict data isolation via Row Level Security (RLS). Track personal net worth while maintaining shared household budgets.
* **Shadow Contacts & 2-Way Handshakes:** Lend money to unregistered friends (Shadow Contacts), or send funds to registered users who must "Accept/Reject" the transaction.
* **Credit Card Liquidity Rolling:** Track exact withdrawal processing fees against actual liquidity.
* **Chit Fund (Chitti) Engine:** Track monthly ROSCA installments, auction/processing fees, and lump-sum payouts.
* **AI Bring-Your-Own-Key (BYOK):** Local storage of Gemini API keys for AI receipt scanning, auto-categorization, and monthly burn-rate forecasting.
* **Maximum Security:** Google OAuth, Passkeys (WebAuthn), Email Confirmation, and a 3-minute glassmorphism Auto-Lock screen.

## 🛠️ Local Setup
1. Clone the repository.
2. Run `npm install`.
3. Rename `.env.example` to `.env.local` and add your Supabase credentials:
VITE_SUPABASE_URL=your_project_url
VITE_SUPABASE_ANON_KEY=your_anon_key
4. Run `npm run dev` to start the local development server.

## 🗄️ Database Philosophy
We **never** store static computed balances. All account balances, net worths, and active debt totals are calculated in real-time using PostgreSQL `CREATE VIEW` statements ensuring 100% mathematical accuracy.
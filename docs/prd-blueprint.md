# PART 1: Product Vision & Version Evolution

## 1. Core Concept & Target Audience
The "Ultimate Money Management App" (Financial OS) is designed as a definitive financial workspace and household operating system. Moving beyond simple expense tracking, it acts as a comprehensive liquidity and obligation manager built on a strict double-entry ledger system. It solves the fragmentation between personal liquid cash, complex recurring obligations (like EMIs and informal lending), and regional financial schemes (Chit Funds) by unifying them into a single, highly secure Progressive Web App (PWA).

**Target Personas:**
* **The Primary Architect:** The core user managing high-level financial flows, balancing personal income with investments into independent e-commerce/business ventures, and overseeing the overarching tech stack.
* **The Collaborative Partner:** A spouse or business partner requiring seamless, real-time access to shared expense ledgers without needing a separate authentication domain. *(Note: Full joint-pocket isolation is currently parked for future development).*
* **Shadow Contacts (Implicit Users):** External entities (friends, family, offline borrowers/lenders) who do not actively use the app but exist within the database to maintain accurate P2P (Peer-to-Peer) ledger handshakes and escrow tracking.

## 2. The V1 to V2 to V3 Evolution
The transition from V1 to V3 marked the shift from a passive tracking tool to a proactive, offline-capable, cross-device financial engine.

* **Financial App V1 (The Foundation):** Established the core architecture focusing entirely on building the React frontend and the Supabase PostgreSQL backend to support a robust double-entry accounting system. 
* **Financial App V2 (The Expansion & PWA Pivot):** Transformed the app into an OS-agnostic PWA. V2 introduced web share targets to bypass native OS constraints, allowing instant cross-device data entry, and expanded the feature set to include Credit Card Liquidity tracking and P2P debt tracking via Shadow Contacts.
* **Financial App V3 (Offline-First & Regional Finance):** The current architecture. Implements Dexie.js (IndexedDB) via an Outbox Pattern for true offline capability. V3 introduces the `chittis` (ROSCA) engine, granular `recurring_emis` tracking, and a dynamic Tailwind CSS theming engine.

---

# PART 2: The Exhaustive Feature Matrix

## 3. Consolidated Feature List (Categorized)

### Module A: The Double-Entry Ledger Core
* **Universal Double-Entry Routing (V1):** Every transaction requires a source (`from_account_id`) and a destination (`to_account_id`). No "orphan" expenses exist.
* **Multi-Account Liquidity Balances (V1):** Real-time summation of liquid cash across multiple physical bank accounts and digital wallets (computed dynamically via the `account_balances` view).
* **Offline-First Sync (V3):** Transactions are logged locally into Dexie.js IndexedDB and synced to Supabase when a network connection is detected via the Outbox Pattern.

### Module B: Joint Household Budgeting [UNDER CONSTRUCTION / FUTURE PLAN]
* **Shared Pockets:** Dedicated virtual accounts accessible by the Collaborative Partner for household expenses. *(Currently deferred. The database architecture primarily supports single-owner multi-account flows).*
* **Proportional Contribution Tracking:** Algorithms to calculate who funded what percentage of the joint pocket and automatic deficit flagging. *(Deferred).*

### Module C: Credit & Liquidity Engine
* **Credit Card Liquidity Tracking (V2):** Distinguishes between "available cash" and "available credit" by tracking account `credit_limit`.
* **Runway Forecast Dashboard (V3):** An integrated widget that projects how long liquid cash will last against known recurring EMIs and scheduled obligations.

### Module D: P2P, Escrow & Shadow Contacts
* **Shadow Contact Profiles (V2):** Localized profiles (`contacts` table) for external individuals to track P2P ledgers.
* **Obligation & Settlement Engine (V3):** A phased transaction state for loans. When money is lent or borrowed, it is tracked in `obligations` and resolved via the `settlements` table.

### Module E: EMI & Chitti (ROSCA) Calendar
* **Dedicated EMI Engine (V3):** Tracked via the `recurring_emis` table, monitoring total principal, processing fees, and exact months paid by both owner and counterparty.
* **Chitti / ROSCA Hub (V3):** A dedicated module for tracking informal rotating savings and credit associations (`chittis` table). Tracks total pool size, duration, monthly installments, payout statuses, and auction fees.

### Module F: AI & PWA Utilities
* **PWA Web Share Target Hacks (V2):** Allows users to "Share" an image or text snippet from other apps directly into the Financial App via the native mobile sharing menu.
* **AI Bring-Your-Own-Key (BYOK) (V3):** Local storage of Gemini API keys directly in the `profiles` table to power AI-assisted categorization and burn-rate forecasting without routing through a middleman server.
* **Biometric Security (V3):** WebAuthn (FaceID/TouchID) gateway to unlock the PWA state (`is_biometric_enabled`).

---

# PART 3: Data Architecture & Tech Stack

## 4. Database Schemas & Data Models (Supabase/PostgreSQL)

*(Note: Reconciled against the active Supabase public schema)*

### **Table: `profiles`** (Extended User Data)
* **`id`** (UUID, Primary Key): Links to Supabase `auth.users`.
* **`full_name`**, **`username`** (Text).
* **`theme_mode`**, **`theme_accent`** (Text): UI customization.
* **`ai_api_key`**, **`ai_model`**, **`ai_persona`** (Text): BYOK AI configuration.
* **`telegram_chat_id`** (Text): Webhook/Notification routing.
* **`is_biometric_enabled`** (Boolean): Local-auth gate flag.

### **Table: `accounts`** (Chart of Accounts)
* **`id`** (UUID, Primary Key).
* **`owner_id`** (UUID, Foreign Key -> profiles.id).
* **`name`** (Text).
* **`type`** (Text): e.g., 'bank', 'credit_card', 'wallet'.
* **`credit_limit`** (Numeric).

### **View: `account_balances`**
* **`id`** (UUID).
* **`balance`** (Numeric): Dynamically computed to prevent static balance drift.

### **Table: `contacts`** & **`parties`** (Shadow Profiles)
* **`id`** (UUID, Primary Key).
* **`owner_id`** (UUID, Foreign Key -> profiles.id).
* **`name`** (Text).

### **Table: `transactions`** (The Core Ledger)
* **`id`** (UUID, Primary Key).
* **`owner_id`** (UUID, Foreign Key -> profiles.id).
* **`initiator_profile_id`** (UUID, Foreign Key).
* **`from_account_id`** (UUID, Foreign Key -> accounts.id, Nullable).
* **`to_account_id`** (UUID, Foreign Key -> accounts.id, Nullable).
* **`amount`** (Numeric).
* **`fee_amount`** (Numeric).
* **`description`** (Text).
* **`status`** (Text): e.g., 'COMPLETED'.
* **`contact_id`** (UUID, Foreign Key -> contacts.id, Nullable).

### **Table: `obligations`** & **`recurring_emis`**
* **`id`** (UUID, Primary Key).
* **`owner_id`** (UUID).
* **`amount`** / **`total_principal`** (Numeric).
* **`status`** (Text).
* **`initiator_account_id`** (UUID).
* **`shadow_contact_id`** (UUID).
* **`owner_months_paid`**, **`counterparty_months_paid`** (Integer): Specific to `recurring_emis`.

### **Table: `settlements`** & **`obligation_payments`**
* Link transactions directly to specific obligations to draw down debt balances dynamically.

### **Table: `chittis`** (ROSCA Engine)
* **`id`** (UUID, Primary Key).
* **`total_pot`**, **`monthly_installment`** (Numeric).
* **`duration_months`**, **`months_paid`**, **`received_month_number`** (Integer).
* **`fee_deducted`**, **`payout_received`** (Numeric).
* **`status`** (Text).

## 5. Tech Stack & Integrations
* **Frontend Framework:** React 19 + Vite (with strict TypeScript).
* **Styling:** Tailwind CSS V4 + `shadcn/ui` + Liquid Glassmorphism (`@samasante/liquid-glass`).
* **Backend & Auth:** Supabase (PostgreSQL, Supabase Auth, Row Level Security).
* **Offline Engine:** Dexie.js (IndexedDB) with `dexie-react-hooks`.
* **PWA & Caching:** `vite-plugin-pwa` with Workbox precaching and Service Workers.
* **Hosting/Deployment:** Vercel (CI/CD pipeline).

---

# PART 4: User Experience & Flow

## 6. Screen-by-Screen Breakdown
* **Auth (`Auth.tsx`):** Supabase email login and WebAuthn Biometric lock screen (`AutoLock.tsx`).
* **Dashboard (`Dashboard.tsx`):** Net worth calculations, runway forecasting, and recent activity feed.
* **Accounts (`Accounts.tsx`):** Grid layout of physical banks, credit cards, and digital wallets.
* **Ledger / Transactions (`Ledger.tsx`, `Transactions.tsx`, `Activity.tsx`):** The double-entry filtering view.
* **Debts & Contacts (`Debts.tsx`, `Contacts.tsx`):** Shadow contact management and obligation settlement interfaces.
* **Calendar (`Calendar.tsx`):** EMI and subscription pre-authorization timeline.
* **Chittis (`Chittis.tsx`):** ROSCA tracking hub for installments and pot claims.
* **Settings & Profile (`Settings.tsx`, `Profile.tsx`):** BYOK AI configuration and dynamic theme toggling.

---

# PART 5: Project Management & Roadmap

## 7. Milestones, Checkpoints & Planning

**Phase 1 & 2: Foundation & PWA Pivot (Completed)**
* Supabase PostgreSQL schemas established with RLS policies.
* Web Share Target API implemented.
* Double-entry manual logging functional.

**Phase 3: Hardening & V3 Deployment (Active Focus)**
* **TypeScript Strictness:** Resolving build errors (`tsconfig.app.json` overrides) to unblock the live Vercel deployment.
* **Offline Sync:** Maturing the `src/lib/sync.ts` logic to ensure Dexie `outbox` records reliably push to Supabase.
* **Chitti Engine:** Wire up the UI for the newly minted `chittis` database table.

## 8. Unresolved Questions & Parked Ideas
* **Module B (Joint Budgeting):** Re-architecting database schemas to securely support shared pockets without leaking private individual data between spouses.
* **Categorization Engine:** The `categories` table was dropped in favor of raw descriptions and AI-tagging. Need to determine if a hardcoded taxonomy is required for reliable analytics.
-- Sanitized pre-hardening RR Capital schema baseline. Requires Supabase auth and extension schemas.



SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE OR REPLACE FUNCTION "public"."accept_p2p_emi"("p_emi_id" "uuid", "p_receiver_user_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
    v_emi recurring_emis%ROWTYPE;
    v_creditor_id UUID;
    v_debtor_id UUID;
    v_obligation_id UUID;
    v_total_debt NUMERIC;
BEGIN
    SELECT * INTO v_emi FROM recurring_emis WHERE id = p_emi_id AND status = 'PENDING_APPROVAL';
    IF NOT FOUND THEN RAISE EXCEPTION 'EMI request not found or already active'; END IF;

    -- Map Creditor vs Debtor
    IF v_emi.type = 'lent' THEN
        v_creditor_id := v_emi.owner_id;
        v_debtor_id := p_receiver_user_id;
    ELSE
        v_creditor_id := p_receiver_user_id;
        v_debtor_id := v_emi.owner_id;
    END IF;

    v_total_debt := v_emi.total_principal + v_emi.processing_fee;

    -- A: Log the Processing Fee Expense on the Credit Card instantly (if applicable)
    IF v_emi.processing_fee > 0 AND v_emi.initiator_account_id IS NOT NULL THEN
        INSERT INTO transactions (
            owner_id, initiator_profile_id, from_account_id, amount, description, status, created_at
        ) VALUES (
            v_emi.owner_id, v_emi.owner_id, v_emi.initiator_account_id, v_emi.processing_fee,
            'Bank Processing Fee: ' || v_emi.name, 'COMPLETED', NOW()
        );
    END IF;

    -- B: Create the Master Obligation (Total Debt Owed)
    INSERT INTO obligations (
        owner_id, creditor_profile_id, debtor_profile_id, shadow_contact_id,
        amount, total_amount, description, reason, status, is_emi, type, created_at
    ) VALUES (
        v_emi.owner_id, v_creditor_id, v_debtor_id, v_emi.shadow_contact_id,
        v_total_debt, v_total_debt, 'EMI Master Debt: ' || v_emi.name, 'EMI Master Debt: ' || v_emi.name,
        'PENDING', true, v_emi.type, NOW()
    ) RETURNING id INTO v_obligation_id;

    -- C: Activate the EMI schedule in the Calendar
    UPDATE recurring_emis
    SET status = 'ACTIVE', related_obligation_id = v_obligation_id
    WHERE id = p_emi_id;
END;
$$;


ALTER FUNCTION "public"."accept_p2p_emi"("p_emi_id" "uuid", "p_receiver_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."accept_p2p_request"("p_obligation_id" "uuid", "p_receiver_user_id" "uuid", "p_receiver_account_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
    v_ob obligations%ROWTYPE;
    v_initiator_tx UUID;
    v_receiver_tx UUID;
BEGIN
    SELECT * INTO v_ob FROM obligations WHERE id = p_obligation_id AND status = 'PENDING_APPROVAL';
    IF NOT FOUND THEN RAISE EXCEPTION 'Request not found or already processed'; END IF;

    -- Create Ridhwan's Transaction (e.g., Money leaves HDFC)
    INSERT INTO transactions (
        owner_id, initiator_profile_id, from_account_id, to_account_id, amount, description, status, tagged_profile_id, created_at
    ) VALUES (
        v_ob.owner_id, v_ob.owner_id,
        CASE WHEN v_ob.type = 'lent' THEN v_ob.initiator_account_id ELSE NULL END,
        CASE WHEN v_ob.type = 'borrowed' THEN v_ob.initiator_account_id ELSE NULL END,
        v_ob.amount, 'P2P: ' || v_ob.description, 'COMPLETED', p_receiver_user_id, NOW()
    ) RETURNING id INTO v_initiator_tx;

    -- Create Ruksana's Transaction (e.g., Money enters SBI)
    INSERT INTO transactions (
        owner_id, initiator_profile_id, from_account_id, to_account_id, amount, description, status, tagged_profile_id, created_at
    ) VALUES (
        p_receiver_user_id, p_receiver_user_id,
        CASE WHEN v_ob.type = 'lent' THEN NULL ELSE p_receiver_account_id END,
        CASE WHEN v_ob.type = 'lent' THEN p_receiver_account_id ELSE NULL END,
        v_ob.amount, 'P2P: ' || v_ob.description, 'COMPLETED', v_ob.owner_id, NOW()
    ) RETURNING id INTO v_receiver_tx;

    -- Lock the Obligation to Accepted and save Ruksana's account choice
    UPDATE obligations
    SET status = 'ACCEPTED',
        related_transaction_id = v_initiator_tx,
        receiver_account_id = p_receiver_account_id
    WHERE id = p_obligation_id;
END;
$$;


ALTER FUNCTION "public"."accept_p2p_request"("p_obligation_id" "uuid", "p_receiver_user_id" "uuid", "p_receiver_account_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."accept_settlement"("p_settlement_id" "uuid", "p_destination_account_id" "uuid", "p_receiver_user_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
    v_settlement settlements%ROWTYPE;
    v_ob obligations%ROWTYPE;
    v_emi recurring_emis%ROWTYPE;
BEGIN
    SELECT * INTO v_settlement FROM settlements WHERE id = p_settlement_id AND status = 'PENDING_APPROVAL';
    IF NOT FOUND THEN RAISE EXCEPTION 'Settlement not found or already processed'; END IF;

    SELECT * INTO v_ob FROM obligations WHERE id = v_settlement.obligation_id;

    -- 1. Deduct money from Payer
    INSERT INTO transactions (
        owner_id, initiator_profile_id, from_account_id, amount, description, status, tagged_profile_id, created_at
    ) VALUES (
        v_settlement.initiator_id, v_settlement.initiator_id, v_settlement.source_account_id,
        v_settlement.amount, 'Repayment Sent: ' || v_ob.description, 'COMPLETED', p_receiver_user_id, NOW()
    );

    -- 2. Add money to Receiver
    INSERT INTO transactions (
        owner_id, initiator_profile_id, to_account_id, amount, description, status, tagged_profile_id, created_at
    ) VALUES (
        p_receiver_user_id, p_receiver_user_id, p_destination_account_id,
        v_settlement.amount, 'Repayment Received: ' || v_ob.description, 'COMPLETED', v_settlement.initiator_id, NOW()
    );

    -- 3. Reduce Master Debt Balance
    UPDATE obligations
    SET amount = amount - v_settlement.amount,
        status = CASE WHEN (amount - v_settlement.amount) <= 0 THEN 'SETTLED' ELSE 'PENDING' END
    WHERE id = v_settlement.obligation_id;

    -- 4. Mark Settlement as Completed
    UPDATE settlements
    SET status = 'COMPLETED', destination_account_id = p_destination_account_id
    WHERE id = p_settlement_id;

    -- 5. THE FIX: Atomic Dual-Progress Sync
    SELECT * INTO v_emi FROM recurring_emis WHERE related_obligation_id = v_ob.id;
    IF FOUND THEN
        IF v_emi.type = 'lent' THEN
            UPDATE recurring_emis
            SET counterparty_months_paid = COALESCE(counterparty_months_paid, 0) + 1,
                owner_months_paid = CASE WHEN p_destination_account_id = initiator_account_id THEN COALESCE(owner_months_paid, 0) + 1 ELSE owner_months_paid END
            WHERE id = v_emi.id;
        ELSIF v_emi.type = 'borrowed' THEN
            UPDATE recurring_emis
            SET owner_months_paid = COALESCE(owner_months_paid, 0) + 1,
                counterparty_months_paid = CASE WHEN p_destination_account_id = initiator_account_id THEN COALESCE(counterparty_months_paid, 0) + 1 ELSE counterparty_months_paid END
            WHERE id = v_emi.id;
        END IF;
    END IF;
END;
$$;


ALTER FUNCTION "public"."accept_settlement"("p_settlement_id" "uuid", "p_destination_account_id" "uuid", "p_receiver_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, username)
  VALUES (new.id, new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'username')
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_proxy_debt"("p_owner_id" "uuid", "p_borrower_profile_id" "uuid", "p_shadow_contact_id" "uuid", "p_account_id" "uuid", "p_amount" numeric, "p_description" "text", "p_is_emi" boolean, "p_transaction_date" timestamp with time zone) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
    v_transaction_id UUID;
BEGIN
    INSERT INTO transactions (
        owner_id, initiator_profile_id, from_account_id, amount, description, status, tagged_profile_id, contact_id, created_at
    ) VALUES (
        p_owner_id, p_owner_id, p_account_id, p_amount, 'Proxy Purchase: ' || p_description, 'COMPLETED', p_borrower_profile_id, p_shadow_contact_id, p_transaction_date
    ) RETURNING id INTO v_transaction_id;

    INSERT INTO obligations (
        owner_id, creditor_profile_id, debtor_profile_id, shadow_contact_id, amount, total_amount, description, status, is_emi, related_transaction_id, created_at, type
    ) VALUES (
        p_owner_id, p_owner_id, p_borrower_profile_id, p_shadow_contact_id, p_amount, p_amount, p_description, 'PENDING', p_is_emi, v_transaction_id, p_transaction_date, 'lent'
    );
END;
$$;


ALTER FUNCTION "public"."log_proxy_debt"("p_owner_id" "uuid", "p_borrower_profile_id" "uuid", "p_shadow_contact_id" "uuid", "p_account_id" "uuid", "p_amount" numeric, "p_description" "text", "p_is_emi" boolean, "p_transaction_date" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."notify_telegram_on_transaction"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$ BEGIN RETURN NEW; END; $$;

ALTER FUNCTION "public"."notify_telegram_on_transaction"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."process_p2p_transaction"("p_owner_id" "uuid", "p_counterparty_profile_id" "uuid", "p_shadow_contact_id" "uuid", "p_account_id" "uuid", "p_amount" numeric, "p_description" "text", "p_is_emi" boolean, "p_type" "text", "p_transaction_date" timestamp with time zone) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
    v_transaction_id UUID;
    v_creditor_id UUID;
    v_debtor_id UUID;
BEGIN
    IF p_type = 'lent' THEN
        v_creditor_id := p_owner_id;
        v_debtor_id := p_counterparty_profile_id;
    ELSE
        v_creditor_id := p_counterparty_profile_id;
        v_debtor_id := p_owner_id;
    END IF;

    IF p_counterparty_profile_id IS NOT NULL THEN
        -- REGISTERED USER: Do NOT move money yet. Just create the PENDING proposal.
        INSERT INTO obligations (
            owner_id, creditor_profile_id, debtor_profile_id, amount, total_amount,
            description, reason, status, is_emi, type, created_at, initiator_account_id
        ) VALUES (
            p_owner_id, v_creditor_id, v_debtor_id, p_amount, p_amount,
            p_description, p_description, 'PENDING_APPROVAL', p_is_emi, p_type, p_transaction_date, p_account_id
        );
    ELSE
        -- OFFLINE SHADOW CONTACT: Execute instantly because there is no 2nd user to accept it
        INSERT INTO transactions (
            owner_id, initiator_profile_id, from_account_id, to_account_id, amount, description, status, contact_id, created_at
        ) VALUES (
            p_owner_id, p_owner_id, CASE WHEN p_type = 'lent' THEN p_account_id ELSE NULL END, CASE WHEN p_type = 'borrowed' THEN p_account_id ELSE NULL END, p_amount, p_description, 'COMPLETED', p_shadow_contact_id, p_transaction_date
        ) RETURNING id INTO v_transaction_id;

        INSERT INTO obligations (
            owner_id, creditor_profile_id, debtor_profile_id, shadow_contact_id, amount, total_amount, description, reason, status, is_emi, related_transaction_id, type, created_at, initiator_account_id
        ) VALUES (
            p_owner_id, v_creditor_id, v_debtor_id, p_shadow_contact_id, p_amount, p_amount, p_description, p_description, 'ACCEPTED', p_is_emi, v_transaction_id, p_type, p_transaction_date, p_account_id
        );
    END IF;
END;
$$;


ALTER FUNCTION "public"."process_p2p_transaction"("p_owner_id" "uuid", "p_counterparty_profile_id" "uuid", "p_shadow_contact_id" "uuid", "p_account_id" "uuid", "p_amount" numeric, "p_description" "text", "p_is_emi" boolean, "p_type" "text", "p_transaction_date" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."propose_p2p_emi"("p_owner_id" "uuid", "p_counterparty_profile_id" "uuid", "p_shadow_contact_id" "uuid", "p_account_id" "uuid", "p_type" "text", "p_name" "text", "p_total_principal" numeric, "p_processing_fee" numeric, "p_monthly_amount" numeric, "p_start_date" "date", "p_end_date" "date") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
    v_emi_id UUID;
BEGIN
    INSERT INTO recurring_emis (
        owner_id, type, counterparty_profile_id, shadow_contact_id, status,
        name, total_principal, processing_fee, amount, start_date, end_date, initiator_account_id
    ) VALUES (
        p_owner_id, p_type, p_counterparty_profile_id, p_shadow_contact_id, 'PENDING_APPROVAL',
        p_name, p_total_principal, p_processing_fee, p_monthly_amount, p_start_date, p_end_date, p_account_id
    ) RETURNING id INTO v_emi_id;

    -- If this is an offline shadow contact, auto-accept it immediately on behalf of the owner
    IF p_counterparty_profile_id IS NULL THEN
        PERFORM accept_p2p_emi(v_emi_id, p_owner_id);
    END IF;
END;
$$;


ALTER FUNCTION "public"."propose_p2p_emi"("p_owner_id" "uuid", "p_counterparty_profile_id" "uuid", "p_shadow_contact_id" "uuid", "p_account_id" "uuid", "p_type" "text", "p_name" "text", "p_total_principal" numeric, "p_processing_fee" numeric, "p_monthly_amount" numeric, "p_start_date" "date", "p_end_date" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."search_users"("search_term" "text") RETURNS TABLE("id" "uuid", "username" "text", "full_name" "text", "email" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    u.id,
    COALESCE(p.username, ''),
    COALESCE(p.full_name, ''),
    u.email::text
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.id = u.id
  WHERE u.email ILIKE '%' || search_term || '%'
     OR p.username ILIKE '%' || search_term || '%'
     OR p.full_name ILIKE '%' || search_term || '%'
  LIMIT 10;
END;
$$;


ALTER FUNCTION "public"."search_users"("search_term" "text") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."accounts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "type" "text" DEFAULT 'bank'::"text",
    "credit_limit" numeric DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."accounts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."transactions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "initiator_profile_id" "uuid",
    "from_account_id" "uuid",
    "to_account_id" "uuid",
    "amount" numeric NOT NULL,
    "fee_amount" numeric DEFAULT 0,
    "description" "text",
    "status" "text" DEFAULT 'COMPLETED'::"text",
    "tagged_profile_id" "uuid",
    "contact_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."transactions" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."account_balances" WITH ("security_invoker"='true') AS
 SELECT "id",
    (COALESCE(( SELECT "sum"("transactions"."amount") AS "sum"
           FROM "public"."transactions"
          WHERE (("transactions"."to_account_id" = "a"."id") AND ("transactions"."status" = 'COMPLETED'::"text"))), (0)::numeric) - COALESCE(( SELECT "sum"(("transactions"."amount" + COALESCE("transactions"."fee_amount", (0)::numeric))) AS "sum"
           FROM "public"."transactions"
          WHERE (("transactions"."from_account_id" = "a"."id") AND ("transactions"."status" = 'COMPLETED'::"text"))), (0)::numeric)) AS "balance"
   FROM "public"."accounts" "a";


ALTER VIEW "public"."account_balances" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."chittis" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "total_pot" numeric NOT NULL,
    "duration_months" integer NOT NULL,
    "monthly_installment" numeric NOT NULL,
    "start_date" "date" NOT NULL,
    "status" "text" DEFAULT 'ACTIVE'::"text",
    "received_month_number" integer,
    "fee_deducted" numeric DEFAULT 0,
    "payout_received" numeric DEFAULT 0,
    "months_paid" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "chittis_status_check" CHECK (("status" = ANY (ARRAY['ACTIVE'::"text", 'COMPLETED'::"text", 'CANCELLED'::"text"])))
);


ALTER TABLE "public"."chittis" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."contacts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."contacts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."obligation_payments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "obligation_id" "uuid" NOT NULL,
    "transaction_id" "uuid" NOT NULL,
    "amount" numeric(12,2) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "obligation_payments_amount_check" CHECK (("amount" > (0)::numeric))
);


ALTER TABLE "public"."obligation_payments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."obligations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "profile_id" "uuid",
    "contact_id" "uuid",
    "type" "text" NOT NULL,
    "amount" numeric NOT NULL,
    "description" "text",
    "status" "text" DEFAULT 'PENDING'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "creditor_profile_id" "uuid",
    "debtor_profile_id" "uuid",
    "shadow_contact_id" "uuid",
    "is_emi" boolean DEFAULT false,
    "related_transaction_id" "uuid",
    "total_amount" numeric DEFAULT 0,
    "reason" "text",
    "decline_reason" "text",
    "initiator_account_id" "uuid",
    "receiver_account_id" "uuid"
);


ALTER TABLE "public"."obligations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."parties" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "type" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "parties_type_check" CHECK (("type" = ANY (ARRAY['self'::"text", 'partner'::"text", 'relative'::"text", 'friend'::"text", 'institution'::"text"])))
);


ALTER TABLE "public"."parties" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "full_name" "text",
    "username" "text",
    "theme_mode" "text" DEFAULT 'dark'::"text",
    "theme_accent" "text" DEFAULT 'emerald'::"text",
    "ai_api_key" "text",
    "ai_model" "text" DEFAULT 'gemini-1.5-flash'::"text",
    "ai_persona" "text" DEFAULT 'Analyst'::"text",
    "telegram_chat_id" "text",
    "is_biometric_enabled" boolean DEFAULT false,
    "registered_devices" "jsonb" DEFAULT '[]'::"jsonb",
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."recurring_emis" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "amount" numeric NOT NULL,
    "start_date" "date" NOT NULL,
    "end_date" "date",
    "account_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "type" "text" DEFAULT 'personal'::"text",
    "counterparty_profile_id" "uuid",
    "shadow_contact_id" "uuid",
    "status" "text" DEFAULT 'ACTIVE'::"text",
    "decline_reason" "text",
    "total_principal" numeric DEFAULT 0,
    "processing_fee" numeric DEFAULT 0,
    "initiator_account_id" "uuid",
    "related_obligation_id" "uuid",
    "owner_months_paid" integer DEFAULT 0,
    "counterparty_months_paid" integer DEFAULT 0
);


ALTER TABLE "public"."recurring_emis" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."settlements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "obligation_id" "uuid",
    "initiator_id" "uuid",
    "counterparty_profile_id" "uuid",
    "amount" numeric NOT NULL,
    "source_account_id" "uuid",
    "destination_account_id" "uuid",
    "status" "text" DEFAULT 'PENDING_APPROVAL'::"text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."settlements" OWNER TO "postgres";


ALTER TABLE ONLY "public"."accounts"
    ADD CONSTRAINT "accounts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."chittis"
    ADD CONSTRAINT "chittis_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."contacts"
    ADD CONSTRAINT "contacts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."obligation_payments"
    ADD CONSTRAINT "obligation_payments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."obligations"
    ADD CONSTRAINT "obligations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."parties"
    ADD CONSTRAINT "parties_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_username_key" UNIQUE ("username");



ALTER TABLE ONLY "public"."recurring_emis"
    ADD CONSTRAINT "recurring_emis_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."settlements"
    ADD CONSTRAINT "settlements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."transactions"
    ADD CONSTRAINT "transactions_pkey" PRIMARY KEY ("id");



CREATE INDEX "idx_obl_pay_obl" ON "public"."obligation_payments" USING "btree" ("obligation_id");



ALTER TABLE ONLY "public"."accounts"
    ADD CONSTRAINT "accounts_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."chittis"
    ADD CONSTRAINT "chittis_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."contacts"
    ADD CONSTRAINT "contacts_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."obligations"
    ADD CONSTRAINT "obligations_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."obligations"
    ADD CONSTRAINT "obligations_creditor_profile_id_fkey" FOREIGN KEY ("creditor_profile_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."obligations"
    ADD CONSTRAINT "obligations_debtor_profile_id_fkey" FOREIGN KEY ("debtor_profile_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."obligations"
    ADD CONSTRAINT "obligations_initiator_account_id_fkey" FOREIGN KEY ("initiator_account_id") REFERENCES "public"."accounts"("id");



ALTER TABLE ONLY "public"."obligations"
    ADD CONSTRAINT "obligations_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."obligations"
    ADD CONSTRAINT "obligations_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."obligations"
    ADD CONSTRAINT "obligations_receiver_account_id_fkey" FOREIGN KEY ("receiver_account_id") REFERENCES "public"."accounts"("id");



ALTER TABLE ONLY "public"."obligations"
    ADD CONSTRAINT "obligations_related_transaction_id_fkey" FOREIGN KEY ("related_transaction_id") REFERENCES "public"."transactions"("id");



ALTER TABLE ONLY "public"."obligations"
    ADD CONSTRAINT "obligations_shadow_contact_id_fkey" FOREIGN KEY ("shadow_contact_id") REFERENCES "public"."contacts"("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."recurring_emis"
    ADD CONSTRAINT "recurring_emis_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."recurring_emis"
    ADD CONSTRAINT "recurring_emis_counterparty_profile_id_fkey" FOREIGN KEY ("counterparty_profile_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."recurring_emis"
    ADD CONSTRAINT "recurring_emis_initiator_account_id_fkey" FOREIGN KEY ("initiator_account_id") REFERENCES "public"."accounts"("id");



ALTER TABLE ONLY "public"."recurring_emis"
    ADD CONSTRAINT "recurring_emis_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."recurring_emis"
    ADD CONSTRAINT "recurring_emis_related_obligation_id_fkey" FOREIGN KEY ("related_obligation_id") REFERENCES "public"."obligations"("id");



ALTER TABLE ONLY "public"."recurring_emis"
    ADD CONSTRAINT "recurring_emis_shadow_contact_id_fkey" FOREIGN KEY ("shadow_contact_id") REFERENCES "public"."contacts"("id");



ALTER TABLE ONLY "public"."settlements"
    ADD CONSTRAINT "settlements_counterparty_profile_id_fkey" FOREIGN KEY ("counterparty_profile_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."settlements"
    ADD CONSTRAINT "settlements_destination_account_id_fkey" FOREIGN KEY ("destination_account_id") REFERENCES "public"."accounts"("id");



ALTER TABLE ONLY "public"."settlements"
    ADD CONSTRAINT "settlements_initiator_id_fkey" FOREIGN KEY ("initiator_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."settlements"
    ADD CONSTRAINT "settlements_obligation_id_fkey" FOREIGN KEY ("obligation_id") REFERENCES "public"."obligations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."settlements"
    ADD CONSTRAINT "settlements_source_account_id_fkey" FOREIGN KEY ("source_account_id") REFERENCES "public"."accounts"("id");



ALTER TABLE ONLY "public"."transactions"
    ADD CONSTRAINT "transactions_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."transactions"
    ADD CONSTRAINT "transactions_from_account_id_fkey" FOREIGN KEY ("from_account_id") REFERENCES "public"."accounts"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."transactions"
    ADD CONSTRAINT "transactions_initiator_profile_id_fkey" FOREIGN KEY ("initiator_profile_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."transactions"
    ADD CONSTRAINT "transactions_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."transactions"
    ADD CONSTRAINT "transactions_tagged_profile_id_fkey" FOREIGN KEY ("tagged_profile_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."transactions"
    ADD CONSTRAINT "transactions_to_account_id_fkey" FOREIGN KEY ("to_account_id") REFERENCES "public"."accounts"("id") ON DELETE SET NULL;



CREATE POLICY "Accounts owner" ON "public"."accounts" USING (("owner_id" = "auth"."uid"())) WITH CHECK (("owner_id" = "auth"."uid"()));



CREATE POLICY "Contacts owner" ON "public"."contacts" USING (("owner_id" = "auth"."uid"())) WITH CHECK (("owner_id" = "auth"."uid"()));



CREATE POLICY "Enable all for EMI owner" ON "public"."recurring_emis" USING (("owner_id" = "auth"."uid"())) WITH CHECK (("owner_id" = "auth"."uid"()));



CREATE POLICY "Obligations owner" ON "public"."obligations" USING (("owner_id" = "auth"."uid"())) WITH CHECK (("owner_id" = "auth"."uid"()));



CREATE POLICY "Transactions owner" ON "public"."transactions" USING (("owner_id" = "auth"."uid"())) WITH CHECK (("owner_id" = "auth"."uid"()));



CREATE POLICY "Users can delete own chittis" ON "public"."chittis" FOR DELETE USING (("auth"."uid"() = "owner_id"));



CREATE POLICY "Users can insert own chittis" ON "public"."chittis" FOR INSERT WITH CHECK (("auth"."uid"() = "owner_id"));



CREATE POLICY "Users can insert own profile" ON "public"."profiles" FOR INSERT WITH CHECK (("auth"."uid"() = "id"));



CREATE POLICY "Users can insert settlements" ON "public"."settlements" FOR INSERT WITH CHECK (("auth"."uid"() = "initiator_id"));



CREATE POLICY "Users can update own chittis" ON "public"."chittis" FOR UPDATE USING (("auth"."uid"() = "owner_id"));



CREATE POLICY "Users can update own profile" ON "public"."profiles" FOR UPDATE USING (("auth"."uid"() = "id"));



CREATE POLICY "Users can update shared emis" ON "public"."recurring_emis" FOR UPDATE USING ((("auth"."uid"() = "owner_id") OR ("auth"."uid"() = "counterparty_profile_id")));



CREATE POLICY "Users can update shared obligations" ON "public"."obligations" FOR UPDATE USING ((("auth"."uid"() = "owner_id") OR ("auth"."uid"() = "creditor_profile_id") OR ("auth"."uid"() = "debtor_profile_id")));



CREATE POLICY "Users can update shared settlements" ON "public"."settlements" FOR UPDATE USING ((("auth"."uid"() = "initiator_id") OR ("auth"."uid"() = "counterparty_profile_id")));



CREATE POLICY "Users can view all profiles" ON "public"."profiles" FOR SELECT USING (true);



CREATE POLICY "Users can view own chittis" ON "public"."chittis" FOR SELECT USING (("auth"."uid"() = "owner_id"));



CREATE POLICY "Users can view shared emis" ON "public"."recurring_emis" FOR SELECT USING ((("auth"."uid"() = "owner_id") OR ("auth"."uid"() = "counterparty_profile_id")));



CREATE POLICY "Users can view shared obligations" ON "public"."obligations" FOR SELECT USING ((("auth"."uid"() = "owner_id") OR ("auth"."uid"() = "creditor_profile_id") OR ("auth"."uid"() = "debtor_profile_id")));



CREATE POLICY "Users can view shared settlements" ON "public"."settlements" FOR SELECT USING ((("auth"."uid"() = "initiator_id") OR ("auth"."uid"() = "counterparty_profile_id")));



ALTER TABLE "public"."accounts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."chittis" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."contacts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."obligations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."recurring_emis" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."settlements" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."transactions" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."accept_p2p_emi"("p_emi_id" "uuid", "p_receiver_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."accept_p2p_emi"("p_emi_id" "uuid", "p_receiver_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."accept_p2p_emi"("p_emi_id" "uuid", "p_receiver_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."accept_p2p_request"("p_obligation_id" "uuid", "p_receiver_user_id" "uuid", "p_receiver_account_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."accept_p2p_request"("p_obligation_id" "uuid", "p_receiver_user_id" "uuid", "p_receiver_account_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."accept_p2p_request"("p_obligation_id" "uuid", "p_receiver_user_id" "uuid", "p_receiver_account_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."accept_settlement"("p_settlement_id" "uuid", "p_destination_account_id" "uuid", "p_receiver_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."accept_settlement"("p_settlement_id" "uuid", "p_destination_account_id" "uuid", "p_receiver_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."accept_settlement"("p_settlement_id" "uuid", "p_destination_account_id" "uuid", "p_receiver_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."log_proxy_debt"("p_owner_id" "uuid", "p_borrower_profile_id" "uuid", "p_shadow_contact_id" "uuid", "p_account_id" "uuid", "p_amount" numeric, "p_description" "text", "p_is_emi" boolean, "p_transaction_date" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."log_proxy_debt"("p_owner_id" "uuid", "p_borrower_profile_id" "uuid", "p_shadow_contact_id" "uuid", "p_account_id" "uuid", "p_amount" numeric, "p_description" "text", "p_is_emi" boolean, "p_transaction_date" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."log_proxy_debt"("p_owner_id" "uuid", "p_borrower_profile_id" "uuid", "p_shadow_contact_id" "uuid", "p_account_id" "uuid", "p_amount" numeric, "p_description" "text", "p_is_emi" boolean, "p_transaction_date" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."notify_telegram_on_transaction"() TO "anon";
GRANT ALL ON FUNCTION "public"."notify_telegram_on_transaction"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."notify_telegram_on_transaction"() TO "service_role";



GRANT ALL ON FUNCTION "public"."process_p2p_transaction"("p_owner_id" "uuid", "p_counterparty_profile_id" "uuid", "p_shadow_contact_id" "uuid", "p_account_id" "uuid", "p_amount" numeric, "p_description" "text", "p_is_emi" boolean, "p_type" "text", "p_transaction_date" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."process_p2p_transaction"("p_owner_id" "uuid", "p_counterparty_profile_id" "uuid", "p_shadow_contact_id" "uuid", "p_account_id" "uuid", "p_amount" numeric, "p_description" "text", "p_is_emi" boolean, "p_type" "text", "p_transaction_date" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."process_p2p_transaction"("p_owner_id" "uuid", "p_counterparty_profile_id" "uuid", "p_shadow_contact_id" "uuid", "p_account_id" "uuid", "p_amount" numeric, "p_description" "text", "p_is_emi" boolean, "p_type" "text", "p_transaction_date" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."propose_p2p_emi"("p_owner_id" "uuid", "p_counterparty_profile_id" "uuid", "p_shadow_contact_id" "uuid", "p_account_id" "uuid", "p_type" "text", "p_name" "text", "p_total_principal" numeric, "p_processing_fee" numeric, "p_monthly_amount" numeric, "p_start_date" "date", "p_end_date" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."propose_p2p_emi"("p_owner_id" "uuid", "p_counterparty_profile_id" "uuid", "p_shadow_contact_id" "uuid", "p_account_id" "uuid", "p_type" "text", "p_name" "text", "p_total_principal" numeric, "p_processing_fee" numeric, "p_monthly_amount" numeric, "p_start_date" "date", "p_end_date" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."propose_p2p_emi"("p_owner_id" "uuid", "p_counterparty_profile_id" "uuid", "p_shadow_contact_id" "uuid", "p_account_id" "uuid", "p_type" "text", "p_name" "text", "p_total_principal" numeric, "p_processing_fee" numeric, "p_monthly_amount" numeric, "p_start_date" "date", "p_end_date" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."search_users"("search_term" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."search_users"("search_term" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."search_users"("search_term" "text") TO "service_role";



GRANT ALL ON TABLE "public"."accounts" TO "anon";
GRANT ALL ON TABLE "public"."accounts" TO "authenticated";
GRANT ALL ON TABLE "public"."accounts" TO "service_role";



GRANT ALL ON TABLE "public"."transactions" TO "anon";
GRANT ALL ON TABLE "public"."transactions" TO "authenticated";
GRANT ALL ON TABLE "public"."transactions" TO "service_role";



GRANT ALL ON TABLE "public"."account_balances" TO "anon";
GRANT ALL ON TABLE "public"."account_balances" TO "authenticated";
GRANT ALL ON TABLE "public"."account_balances" TO "service_role";



GRANT ALL ON TABLE "public"."chittis" TO "anon";
GRANT ALL ON TABLE "public"."chittis" TO "authenticated";
GRANT ALL ON TABLE "public"."chittis" TO "service_role";



GRANT ALL ON TABLE "public"."contacts" TO "anon";
GRANT ALL ON TABLE "public"."contacts" TO "authenticated";
GRANT ALL ON TABLE "public"."contacts" TO "service_role";



GRANT ALL ON TABLE "public"."obligation_payments" TO "anon";
GRANT ALL ON TABLE "public"."obligation_payments" TO "authenticated";
GRANT ALL ON TABLE "public"."obligation_payments" TO "service_role";



GRANT ALL ON TABLE "public"."obligations" TO "anon";
GRANT ALL ON TABLE "public"."obligations" TO "authenticated";
GRANT ALL ON TABLE "public"."obligations" TO "service_role";



GRANT ALL ON TABLE "public"."parties" TO "anon";
GRANT ALL ON TABLE "public"."parties" TO "authenticated";
GRANT ALL ON TABLE "public"."parties" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."recurring_emis" TO "anon";
GRANT ALL ON TABLE "public"."recurring_emis" TO "authenticated";
GRANT ALL ON TABLE "public"."recurring_emis" TO "service_role";



GRANT ALL ON TABLE "public"."settlements" TO "anon";
GRANT ALL ON TABLE "public"."settlements" TO "authenticated";
GRANT ALL ON TABLE "public"."settlements" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";

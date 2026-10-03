-- Minimal catalog fixture for independently validating the v2 containment
-- migration. Run only in a disposable database after local_test_support.bootstrap.sql.
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY,
  full_name text,
  username text,
  phone text,
  theme_preference text,
  dp_url text,
  telegram_chat_id text,
  created_at timestamptz,
  theme_mode text,
  theme_accent text,
  ai_api_key text,
  ai_model text,
  ai_persona text,
  is_biometric_enabled boolean,
  registered_devices jsonb
);
CREATE TABLE public.obligation_payments (id uuid PRIMARY KEY);
CREATE TABLE public.parties (id uuid PRIMARY KEY);
CREATE TABLE public.transactions (
  id uuid PRIMARY KEY,
  owner_id uuid,
  initiator_profile_id uuid,
  receiver_profile_id uuid
);
CREATE TABLE public.obligations (
  id uuid PRIMARY KEY,
  creditor_profile_id uuid,
  debtor_profile_id uuid
);
CREATE POLICY profiles_read_any ON public.profiles FOR SELECT USING (true);
CREATE POLICY profiles_update_any ON public.profiles FOR UPDATE USING (true);
CREATE POLICY "Enable all for transaction owner" ON public.transactions
  FOR ALL USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE POLICY "Users can insert own transactions" ON public.transactions
  FOR INSERT WITH CHECK (initiator_profile_id = auth.uid());
CREATE POLICY "Users can update involved transactions" ON public.transactions
  FOR UPDATE USING (initiator_profile_id = auth.uid() OR receiver_profile_id = auth.uid());
CREATE POLICY "Users can view involved transactions" ON public.transactions
  FOR SELECT USING (initiator_profile_id = auth.uid() OR receiver_profile_id = auth.uid());
CREATE POLICY "Users can manage their own obligations" ON public.obligations
  FOR ALL USING (creditor_profile_id = auth.uid() OR debtor_profile_id = auth.uid())
  WITH CHECK (creditor_profile_id = auth.uid() OR debtor_profile_id = auth.uid());
CREATE FUNCTION public.notify_telegram_on_transaction() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
CREATE FUNCTION public.trigger_telegram_alert() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
GRANT ALL ON public.profiles, public.obligation_payments, public.parties,
  public.transactions, public.obligations TO anon, authenticated;

DO $$
BEGIN
  IF NOT has_table_privilege('authenticated', 'public.obligation_payments', 'SELECT') THEN
    RAISE EXCEPTION 'fixture setup failed: expected broad authenticated payment access';
  END IF;
END $$;

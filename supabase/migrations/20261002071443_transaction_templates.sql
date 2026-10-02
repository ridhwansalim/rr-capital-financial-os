-- Repeat-entry templates contain draft fields only. They never store contact,
-- counterparty, transaction status, transaction IDs, or request IDs.
CREATE TABLE public.transaction_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 48),
  transaction_type text NOT NULL CHECK (transaction_type IN ('expense', 'income', 'transfer')),
  amount numeric(14,2) CHECK (amount IS NULL OR amount > 0),
  fee_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (fee_amount >= 0),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 240),
  from_account_id uuid,
  to_account_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX transaction_templates_owner_updated_idx
  ON public.transaction_templates(owner_id, updated_at DESC);
ALTER TABLE public.transaction_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY transaction_templates_select_own ON public.transaction_templates
  FOR SELECT TO authenticated USING (owner_id = (SELECT auth.uid()));
CREATE POLICY transaction_templates_insert_own ON public.transaction_templates
  FOR INSERT TO authenticated WITH CHECK (owner_id = (SELECT auth.uid()));
CREATE POLICY transaction_templates_update_own ON public.transaction_templates
  FOR UPDATE TO authenticated USING (owner_id = (SELECT auth.uid()))
  WITH CHECK (owner_id = (SELECT auth.uid()));
CREATE POLICY transaction_templates_delete_own ON public.transaction_templates
  FOR DELETE TO authenticated USING (owner_id = (SELECT auth.uid()));
CREATE TRIGGER transaction_templates_touch_updated_at
  BEFORE UPDATE ON public.transaction_templates
  FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();
REVOKE ALL ON public.transaction_templates FROM authenticated, anon;
GRANT SELECT, DELETE ON public.transaction_templates TO authenticated;
GRANT INSERT (name, transaction_type, amount, fee_amount, description, from_account_id, to_account_id),
      UPDATE (name, transaction_type, amount, fee_amount, description, from_account_id, to_account_id)
  ON public.transaction_templates TO authenticated;

NOTIFY pgrst, 'reload schema';

-- Internal workflow/audit tables are accessed through narrowly scoped
-- SECURITY DEFINER functions. Enable RLS as defense in depth so a future
-- accidental table grant still cannot expose rows to API roles. Do not FORCE
-- RLS: function owners must retain access to these implementation tables.
ALTER TABLE private.telegram_link_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.chitti_action_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.emi_bank_action_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.transaction_corrections ENABLE ROW LEVEL SECURITY;

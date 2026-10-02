-- Cover the private action request's new optional credit-line destination FK.
CREATE INDEX IF NOT EXISTS emi_bank_action_requests_credit_account_id_idx
  ON private.emi_bank_action_requests(credit_account_id)
  WHERE credit_account_id IS NOT NULL;

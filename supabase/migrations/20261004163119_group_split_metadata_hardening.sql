-- Keep the private split idempotency table explicitly deny-only for API roles
-- and index its deletion-sensitive foreign keys.

CREATE POLICY group_split_request_metadata_api_deny
  ON private.group_split_request_metadata
  AS RESTRICTIVE
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

CREATE INDEX group_split_request_metadata_transaction_id_idx
  ON private.group_split_request_metadata(transaction_id);

CREATE INDEX split_group_members_profile_id_idx
  ON public.split_group_members(profile_id)
  WHERE profile_id IS NOT NULL;

CREATE INDEX split_group_members_shadow_contact_id_idx
  ON public.split_group_members(shadow_contact_id)
  WHERE shadow_contact_id IS NOT NULL;

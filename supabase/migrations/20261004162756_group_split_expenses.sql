-- Group split expenses are posted once to the payer's ledger. Participant
-- obligations refer to that shared transaction; accepting a share never posts
-- a mirrored transaction to the participant's account.

ALTER TABLE public.obligations
  ADD COLUMN is_split_share boolean NOT NULL DEFAULT false,
  ADD COLUMN total_bill_amount numeric(12,2),
  ADD COLUMN split_group_id uuid;

CREATE TABLE public.split_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, name)
);

CREATE TABLE public.split_group_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.split_groups(id) ON DELETE CASCADE,
  profile_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  shadow_contact_id uuid REFERENCES public.contacts(id) ON DELETE CASCADE,
  CHECK ((profile_id IS NOT NULL)::integer + (shadow_contact_id IS NOT NULL)::integer = 1)
);

CREATE UNIQUE INDEX split_group_members_profile_key
  ON public.split_group_members(group_id, profile_id) WHERE profile_id IS NOT NULL;
CREATE UNIQUE INDEX split_group_members_contact_key
  ON public.split_group_members(group_id, shadow_contact_id) WHERE shadow_contact_id IS NOT NULL;
CREATE INDEX obligations_split_group_id_idx
  ON public.obligations(split_group_id) WHERE split_group_id IS NOT NULL;

ALTER TABLE public.obligations
  ADD CONSTRAINT obligations_split_group_id_fkey
  FOREIGN KEY (split_group_id) REFERENCES public.split_groups(id) ON DELETE SET NULL;
ALTER TABLE public.obligations
  ADD CONSTRAINT obligations_split_bill_amount_check
  CHECK (NOT is_split_share OR (total_bill_amount IS NOT NULL AND total_bill_amount > 0));

ALTER TABLE public.split_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.split_group_members ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.split_groups, public.split_group_members FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.split_groups, public.split_group_members TO authenticated;

CREATE POLICY split_groups_select_owner ON public.split_groups
  FOR SELECT TO authenticated USING (owner_id = (SELECT auth.uid()));
CREATE POLICY split_group_members_select_owner ON public.split_group_members
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.split_groups AS g
     WHERE g.id = split_group_members.group_id AND g.owner_id = (SELECT auth.uid())
  ));

CREATE TABLE private.group_split_request_metadata (
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  request_payload jsonb NOT NULL,
  transaction_id uuid NOT NULL REFERENCES public.transactions(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, request_id)
);
ALTER TABLE private.group_split_request_metadata ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.group_split_request_metadata FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.save_split_group(
  p_name text,
  p_members jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_owner uuid := private.require_user();
  v_name text := NULLIF(btrim(p_name), '');
  v_group_id uuid;
  v_member jsonb;
  v_profile_id uuid;
  v_contact_id uuid;
  v_profile_count integer := 0;
  v_contact_count integer := 0;
BEGIN
  IF v_name IS NULL OR length(v_name) > 80
     OR jsonb_typeof(p_members) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_members) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Choose a group name and at least one member' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.split_groups(owner_id, name)
  VALUES (v_owner, v_name)
  RETURNING id INTO v_group_id;

  FOR v_member IN SELECT value FROM jsonb_array_elements(p_members) AS entries(value) LOOP
    v_profile_id := NULLIF(v_member ->> 'profile_id', '')::uuid;
    v_contact_id := NULLIF(v_member ->> 'shadow_contact_id', '')::uuid;
    IF (v_profile_id IS NOT NULL)::integer + (v_contact_id IS NOT NULL)::integer <> 1
       OR v_profile_id = v_owner THEN
      RAISE EXCEPTION 'Group member must be another registered user or one of your contacts' USING ERRCODE = '22023';
    END IF;
    IF v_profile_id IS NOT NULL THEN
      PERFORM private.require_counterparty(v_owner, v_profile_id, NULL);
      v_profile_count := v_profile_count + 1;
      INSERT INTO public.split_group_members(group_id, profile_id)
      VALUES (v_group_id, v_profile_id);
    ELSE
      PERFORM private.require_counterparty(v_owner, NULL, v_contact_id);
      v_contact_count := v_contact_count + 1;
      INSERT INTO public.split_group_members(group_id, shadow_contact_id)
      VALUES (v_group_id, v_contact_id);
    END IF;
  END LOOP;

  IF v_profile_count + v_contact_count <> jsonb_array_length(p_members) THEN
    RAISE EXCEPTION 'Group members could not be saved' USING ERRCODE = '22023';
  END IF;
  RETURN v_group_id;
END;
$$;
REVOKE ALL ON FUNCTION private.save_split_group(text, jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.save_split_group(text, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.save_split_group(p_name text, p_members jsonb)
RETURNS uuid
LANGUAGE sql SECURITY INVOKER
SET search_path = pg_catalog, public, private, pg_temp
AS $$ SELECT private.save_split_group(p_name, p_members); $$;
REVOKE ALL ON FUNCTION public.save_split_group(text, jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.save_split_group(text, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION private.process_group_split(
  p_owner_id uuid,
  p_account_id uuid,
  p_total_bill numeric,
  p_description text,
  p_group_id uuid,
  p_splits jsonb,
  p_transaction_date timestamptz,
  p_request_id uuid
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_owner uuid := private.require_user();
  v_payload jsonb;
  v_existing private.group_split_request_metadata%ROWTYPE;
  v_transaction_id uuid;
  v_account_opening_date date;
  v_member jsonb;
  v_profile_id uuid;
  v_contact_id uuid;
  v_new_contact_name text;
  v_amount numeric;
  v_share_total numeric := 0;
  v_owner_share numeric(12,2);
  v_seen text[] := ARRAY[]::text[];
  v_member_key text;
  v_group_member_count integer;
  v_matching_group_member_count integer;
BEGIN
  IF p_owner_id IS DISTINCT FROM v_owner THEN
    RAISE EXCEPTION 'Caller cannot act for another user' USING ERRCODE = '42501';
  END IF;
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'Request ID is required' USING ERRCODE = '22023';
  END IF;
  IF p_description IS NULL OR length(btrim(p_description)) NOT BETWEEN 1 AND 240
     OR jsonb_typeof(p_splits) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_splits) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Enter a description and at least one participant' USING ERRCODE = '22023';
  END IF;
  PERFORM private.require_amount(p_total_bill);
  v_payload := jsonb_build_object(
    'account_id', p_account_id,
    'total_bill', p_total_bill,
    'description', btrim(p_description),
    'group_id', p_group_id,
    'splits', p_splits,
    'transaction_date', p_transaction_date
  );
  PERFORM pg_advisory_xact_lock(hashtextextended(v_owner::text || p_request_id::text, 0));
  SELECT * INTO v_existing FROM private.group_split_request_metadata
   WHERE owner_id = v_owner AND request_id = p_request_id;
  IF FOUND THEN
    IF v_existing.request_payload IS DISTINCT FROM v_payload THEN
      RAISE EXCEPTION 'Request ID was already used for different split data' USING ERRCODE = '23505';
    END IF;
    RETURN v_existing.transaction_id;
  END IF;

  PERFORM private.require_account(v_owner, p_account_id);
  SELECT opening_date INTO v_account_opening_date
    FROM public.accounts WHERE id = p_account_id AND owner_id = v_owner FOR UPDATE;
  IF p_transaction_date IS NULL
     OR p_transaction_date > statement_timestamp() + interval '1 day'
     OR p_transaction_date < statement_timestamp() - interval '5 years' THEN
    RAISE EXCEPTION 'Invalid split expense date' USING ERRCODE = '22023';
  END IF;
  IF (p_transaction_date AT TIME ZONE 'Asia/Kolkata')::date < v_account_opening_date THEN
    RAISE EXCEPTION 'Split expense date precedes the account opening date (%)', v_account_opening_date
      USING ERRCODE = '22023';
  END IF;
  IF p_group_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.split_groups WHERE id = p_group_id AND owner_id = v_owner
  ) THEN
    RAISE EXCEPTION 'Split group is unavailable' USING ERRCODE = '42501';
  END IF;

  FOR v_member IN SELECT value FROM jsonb_array_elements(p_splits) AS entries(value) LOOP
    v_profile_id := NULLIF(v_member ->> 'profile_id', '')::uuid;
    v_contact_id := NULLIF(v_member ->> 'shadow_contact_id', '')::uuid;
    v_new_contact_name := NULLIF(btrim(v_member ->> 'new_shadow_contact_name'), '');
    IF (v_profile_id IS NOT NULL)::integer + (v_contact_id IS NOT NULL)::integer
       + (v_new_contact_name IS NOT NULL)::integer <> 1 THEN
      RAISE EXCEPTION 'Each split participant must be exactly one user or contact' USING ERRCODE = '22023';
    END IF;
    IF v_profile_id = v_owner THEN
      RAISE EXCEPTION 'You cannot add yourself as a split participant' USING ERRCODE = '22023';
    END IF;
    IF v_new_contact_name IS NOT NULL AND length(v_new_contact_name) > 120 THEN
      RAISE EXCEPTION 'Contact name is too long' USING ERRCODE = '22023';
    END IF;
    v_amount := (v_member ->> 'amount')::numeric;
    PERFORM private.require_amount(v_amount);
    v_share_total := v_share_total + v_amount;
    v_member_key := CASE WHEN v_profile_id IS NOT NULL THEN 'p:' || v_profile_id::text
      WHEN v_contact_id IS NOT NULL THEN 'c:' || v_contact_id::text
      ELSE 'n:' || lower(v_new_contact_name) END;
    IF v_member_key = ANY(v_seen) THEN
      RAISE EXCEPTION 'A participant can only appear once in a split' USING ERRCODE = '22023';
    END IF;
    v_seen := array_append(v_seen, v_member_key);
    IF v_profile_id IS NOT NULL THEN
      PERFORM private.require_counterparty(v_owner, v_profile_id, NULL);
    ELSIF v_contact_id IS NOT NULL THEN
      PERFORM private.require_counterparty(v_owner, NULL, v_contact_id);
    END IF;
  END LOOP;

  v_owner_share := p_total_bill - v_share_total;
  IF v_owner_share < 0 OR v_owner_share + v_share_total <> p_total_bill THEN
    RAISE EXCEPTION 'Participant shares and your share must equal the total bill' USING ERRCODE = '22023';
  END IF;

  IF p_group_id IS NOT NULL THEN
    SELECT count(*) INTO v_group_member_count FROM public.split_group_members WHERE group_id = p_group_id;
    SELECT count(*) INTO v_matching_group_member_count
      FROM jsonb_array_elements(p_splits) AS entries(value)
     WHERE (NULLIF(value ->> 'profile_id', '') IS NOT NULL AND EXISTS (
              SELECT 1 FROM public.split_group_members m WHERE m.group_id = p_group_id
                AND m.profile_id = (value ->> 'profile_id')::uuid))
        OR (NULLIF(value ->> 'shadow_contact_id', '') IS NOT NULL AND EXISTS (
              SELECT 1 FROM public.split_group_members m WHERE m.group_id = p_group_id
                AND m.shadow_contact_id = (value ->> 'shadow_contact_id')::uuid));
    IF v_group_member_count <> jsonb_array_length(p_splits)
       OR v_matching_group_member_count <> v_group_member_count THEN
      RAISE EXCEPTION 'Participants do not match the selected saved group' USING ERRCODE = '22023';
    END IF;
  END IF;

  INSERT INTO public.transactions (
    owner_id, initiator_profile_id, from_account_id, to_account_id,
    amount, fee_amount, description, status, created_at, client_request_id
  ) VALUES (
    v_owner, v_owner, p_account_id, NULL,
    p_total_bill, 0, btrim(p_description), 'COMPLETED', p_transaction_date, p_request_id
  ) RETURNING id INTO v_transaction_id;

  FOR v_member IN SELECT value FROM jsonb_array_elements(p_splits) AS entries(value) LOOP
    v_profile_id := NULLIF(v_member ->> 'profile_id', '')::uuid;
    v_contact_id := NULLIF(v_member ->> 'shadow_contact_id', '')::uuid;
    v_new_contact_name := NULLIF(btrim(v_member ->> 'new_shadow_contact_name'), '');
    v_amount := (v_member ->> 'amount')::numeric;
    IF v_new_contact_name IS NOT NULL THEN
      INSERT INTO public.contacts(owner_id, name) VALUES (v_owner, v_new_contact_name)
      RETURNING id INTO v_contact_id;
    END IF;
    PERFORM private.require_counterparty(v_owner, v_profile_id, v_contact_id);
    INSERT INTO public.obligations (
      owner_id, creditor_profile_id, debtor_profile_id, shadow_contact_id,
      amount, total_amount, description, reason, status, is_emi, related_transaction_id,
      type, created_at, initiator_account_id, is_split_share, total_bill_amount, split_group_id
    ) VALUES (
      v_owner, v_owner, v_profile_id, v_contact_id,
      v_amount, v_amount, btrim(p_description), btrim(p_description),
      CASE WHEN v_profile_id IS NULL THEN 'ACCEPTED' ELSE 'PENDING_APPROVAL' END,
      false, v_transaction_id, 'lent', p_transaction_date, p_account_id,
      true, p_total_bill, p_group_id
    );
  END LOOP;

  INSERT INTO private.group_split_request_metadata(owner_id, request_id, request_payload, transaction_id)
  VALUES (v_owner, p_request_id, v_payload, v_transaction_id);
  RETURN v_transaction_id;
END;
$$;
REVOKE ALL ON FUNCTION private.process_group_split(uuid, uuid, numeric, text, uuid, jsonb, timestamptz, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.process_group_split(uuid, uuid, numeric, text, uuid, jsonb, timestamptz, uuid)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.process_group_split(
  p_owner_id uuid,
  p_account_id uuid,
  p_total_bill numeric,
  p_description text,
  p_group_id uuid,
  p_splits jsonb,
  p_transaction_date timestamptz,
  p_request_id uuid
) RETURNS uuid
LANGUAGE sql SECURITY INVOKER
SET search_path = pg_catalog, public, private, pg_temp
AS $$
  SELECT private.process_group_split(
    p_owner_id, p_account_id, p_total_bill, p_description, p_group_id,
    p_splits, p_transaction_date, p_request_id
  );
$$;
REVOKE ALL ON FUNCTION public.process_group_split(uuid, uuid, numeric, text, uuid, jsonb, timestamptz, uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.process_group_split(uuid, uuid, numeric, text, uuid, jsonb, timestamptz, uuid)
  TO authenticated;

CREATE OR REPLACE FUNCTION private.accept_split_share(
  p_obligation_id uuid,
  p_receiver_user_id uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user uuid := private.require_user();
  v_obligation public.obligations%ROWTYPE;
BEGIN
  IF p_receiver_user_id IS DISTINCT FROM v_user THEN
    RAISE EXCEPTION 'Caller cannot act for another user' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_obligation FROM public.obligations
   WHERE id = p_obligation_id AND owner_id <> v_user
     AND is_split_share = true AND debtor_profile_id = v_user
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Split share is unavailable' USING ERRCODE = '42501';
  END IF;
  IF v_obligation.status = 'ACCEPTED' THEN RETURN; END IF;
  IF v_obligation.status IS DISTINCT FROM 'PENDING_APPROVAL' THEN
    RAISE EXCEPTION 'Split share is not pending' USING ERRCODE = '42501';
  END IF;
  UPDATE public.obligations SET status = 'ACCEPTED' WHERE id = p_obligation_id;
END;
$$;
REVOKE ALL ON FUNCTION private.accept_split_share(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.accept_split_share(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.accept_split_share(
  p_obligation_id uuid,
  p_receiver_user_id uuid
) RETURNS void
LANGUAGE sql SECURITY INVOKER
SET search_path = pg_catalog, public, private, pg_temp
AS $$ SELECT private.accept_split_share(p_obligation_id, p_receiver_user_id); $$;
REVOKE ALL ON FUNCTION public.accept_split_share(uuid, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.accept_split_share(uuid, uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

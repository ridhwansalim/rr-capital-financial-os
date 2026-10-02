BEGIN;
INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
('00000000-0000-4000-a000-000000000091','p2p-owner@example.invalid','{"full_name":"P2P Owner","username":"p2p_owner"}');
INSERT INTO public.accounts(id,owner_id,name,type,opening_balance,opening_date) VALUES
('10000000-0000-4000-a000-000000000091','00000000-0000-4000-a000-000000000091','P2P bank','bank',500,(now() AT TIME ZONE 'Asia/Kolkata')::date);
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-a000-000000000091',true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  v_first uuid;
  v_retry uuid;
  v_count integer;
  v_linked integer;
BEGIN
  v_first := public.process_p2p_transaction(
    '30000000-0000-4000-a000-000000000091',
    '00000000-0000-4000-a000-000000000091',NULL,NULL,
    '10000000-0000-4000-a000-000000000091',50,'Lunch loan',false,'lent',
    ((now() AT TIME ZONE 'Asia/Kolkata')::date + time '12:00') AT TIME ZONE 'Asia/Kolkata',
    'Offline friend'
  );
  v_retry := public.process_p2p_transaction(
    '30000000-0000-4000-a000-000000000091',
    '00000000-0000-4000-a000-000000000091',NULL,NULL,
    '10000000-0000-4000-a000-000000000091',50,'Lunch loan',false,'lent',
    ((now() AT TIME ZONE 'Asia/Kolkata')::date + time '12:00') AT TIME ZONE 'Asia/Kolkata',
    'Offline friend'
  );
  IF v_first IS DISTINCT FROM v_retry THEN
    RAISE EXCEPTION 'Retry returned a different obligation ID';
  END IF;
  SELECT count(*) INTO v_count FROM public.contacts
    WHERE owner_id='00000000-0000-4000-a000-000000000091' AND name='Offline friend';
  IF v_count <> 1 THEN RAISE EXCEPTION 'Retry duplicated the new contact'; END IF;
  SELECT count(*) INTO v_count FROM public.obligations
    WHERE owner_id='00000000-0000-4000-a000-000000000091';
  IF v_count <> 1 THEN RAISE EXCEPTION 'Retry duplicated the obligation'; END IF;
  SELECT count(*) INTO v_count FROM public.transactions
    WHERE owner_id='00000000-0000-4000-a000-000000000091';
  IF v_count <> 1 THEN RAISE EXCEPTION 'Retry duplicated the ledger entry'; END IF;
  SELECT count(*) INTO v_linked FROM public.obligations o
    JOIN public.transactions t ON t.id=o.related_transaction_id
   WHERE o.id=v_first AND t.owner_id=o.owner_id AND t.contact_id=o.shadow_contact_id;
  IF v_linked <> 1 THEN RAISE EXCEPTION 'Obligation is not linked to its exact ledger entry'; END IF;

  BEGIN
    PERFORM public.process_p2p_transaction(
      '30000000-0000-4000-a000-000000000091',
      '00000000-0000-4000-a000-000000000091',NULL,NULL,
      '10000000-0000-4000-a000-000000000091',51,'Lunch loan',false,'lent',
      ((now() AT TIME ZONE 'Asia/Kolkata')::date + time '12:00') AT TIME ZONE 'Asia/Kolkata',
      'Offline friend'
    );
    RAISE EXCEPTION 'Mismatched replay payload was accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  BEGIN
    PERFORM public.process_p2p_transaction(
      '30000000-0000-4000-a000-000000000092',
      '00000000-0000-4000-a000-000000000091',NULL,NULL,
      '10000000-0000-4000-a000-000000000091',10,'Invalid direction',false,'other',
      ((now() AT TIME ZONE 'Asia/Kolkata')::date + time '12:00') AT TIME ZONE 'Asia/Kolkata',
      'Must roll back'
    );
    RAISE EXCEPTION 'Invalid direction was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.process_p2p_transaction(
      '30000000-0000-4000-a000-000000000093',
      '00000000-0000-4000-a000-000000000091',NULL,NULL,
      '10000000-0000-4000-a000-000000000091',10,'Future date',false,'lent',
      statement_timestamp() + interval '2 days',
      'Must roll back'
    );
    RAISE EXCEPTION 'Future debt date was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.process_p2p_transaction(
      '30000000-0000-4000-a000-000000000094',
      '00000000-0000-4000-a000-000000000091',NULL,NULL,
      '10000000-0000-4000-a000-000000000091',10,'Old date',false,'lent',
      statement_timestamp() - interval '6 years',
      'Must roll back'
    );
    RAISE EXCEPTION 'Debt date outside supported history was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.process_p2p_transaction(
      '30000000-0000-4000-a000-000000000095',
      '00000000-0000-4000-a000-000000000091',NULL,NULL,
      '10000000-0000-4000-a000-000000000091',10,'Before account opened',false,'lent',
      (((statement_timestamp() AT TIME ZONE 'Asia/Kolkata')::date - 1) + time '12:00') AT TIME ZONE 'Asia/Kolkata',
      'Must roll back'
    );
    RAISE EXCEPTION 'Debt before the source account opening date was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  SELECT count(*) INTO v_count FROM public.contacts
    WHERE owner_id='00000000-0000-4000-a000-000000000091';
  IF v_count <> 1 THEN RAISE EXCEPTION 'Failed request left an orphan contact'; END IF;
END $$;
RESET ROLE;
ROLLBACK;
SELECT plan(4);
SELECT pass('same P2P request retry returns same obligation and creates one contact, obligation and ledger row');
SELECT pass('obligation references the exact transaction created atomically');
SELECT pass('reusing request ID with changed financial data is rejected');
SELECT pass('invalid payloads and dates leave no orphan contact or partial transaction');
SELECT * FROM finish();

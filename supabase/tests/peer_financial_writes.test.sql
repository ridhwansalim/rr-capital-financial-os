-- Run against the isolated local Supabase database after all migrations.
BEGIN;
INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
  ('00000000-0000-4000-a000-000000000081','owner@example.invalid','{"full_name":"Owner","username":"owner81"}'),
  ('00000000-0000-4000-a000-000000000082','peer@example.invalid','{"full_name":"Peer","username":"peer82"}');
INSERT INTO public.accounts(id,owner_id,name,type) VALUES
  ('10000000-0000-4000-a000-000000000081','00000000-0000-4000-a000-000000000081','Owner bank','bank'),
  ('10000000-0000-4000-a000-000000000082','00000000-0000-4000-a000-000000000082','Peer bank','bank');
INSERT INTO public.contacts(id,owner_id,name) VALUES
  ('20000000-0000-4000-a000-000000000081','00000000-0000-4000-a000-000000000081','Shadow peer');
INSERT INTO public.transactions(id,owner_id,initiator_profile_id,to_account_id,amount,
  description,status,contact_id)
VALUES ('30000000-0000-4000-a000-000000000081',
  '00000000-0000-4000-a000-000000000081','00000000-0000-4000-a000-000000000081',
  '10000000-0000-4000-a000-000000000081',25,'Shadow receipt','COMPLETED',
  '20000000-0000-4000-a000-000000000081');
INSERT INTO public.obligations(id,owner_id,profile_id,contact_id,shadow_contact_id,
  type,amount,total_amount,description,status,debtor_profile_id)
VALUES ('40000000-0000-4000-a000-000000000081',
  '00000000-0000-4000-a000-000000000081',NULL,'20000000-0000-4000-a000-000000000081',
  '20000000-0000-4000-a000-000000000081','lent',25,25,'Shadow loan','ACCEPTED',NULL),
  ('40000000-0000-4000-a000-000000000082',
  '00000000-0000-4000-a000-000000000081',NULL,NULL,NULL,'lent',10,10,
  'Pending loan','PENDING_APPROVAL','00000000-0000-4000-a000-000000000082');
INSERT INTO public.recurring_emis(id,owner_id,name,amount,start_date,end_date,
  type,counterparty_profile_id,shadow_contact_id,status)
VALUES ('50000000-0000-4000-a000-000000000081',
  '00000000-0000-4000-a000-000000000081','Pending EMI',5,current_date,
  current_date + 30,'lent','00000000-0000-4000-a000-000000000082',NULL,
  'PENDING_APPROVAL'),
  ('50000000-0000-4000-a000-000000000082',
  '00000000-0000-4000-a000-000000000081','Shadow EMI',5,current_date,
  current_date + 30,'lent',NULL,'20000000-0000-4000-a000-000000000081',
  'ACTIVE');

SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-a000-000000000082',true);
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  BEGIN
    UPDATE public.obligations SET amount=1
     WHERE id='40000000-0000-4000-a000-000000000082';
    RAISE EXCEPTION 'Direct shared-obligation mutation succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.settlements(obligation_id,initiator_id,counterparty_profile_id,amount)
    VALUES ('40000000-0000-4000-a000-000000000082',
      '00000000-0000-4000-a000-000000000082',
      '00000000-0000-4000-a000-000000000081',1);
    RAISE EXCEPTION 'Direct settlement insertion succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE public.recurring_emis SET amount=1
     WHERE id='50000000-0000-4000-a000-000000000081';
    RAISE EXCEPTION 'Direct peer-EMI mutation succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    DELETE FROM public.recurring_emis
     WHERE id='50000000-0000-4000-a000-000000000081';
    RAISE EXCEPTION 'Direct peer-EMI deletion succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM public.decline_p2p_obligation(
    '40000000-0000-4000-a000-000000000082','Not my record');
  PERFORM public.decline_p2p_emi(
    '50000000-0000-4000-a000-000000000081','Not agreed');
END $$;
RESET ROLE;

SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-a000-000000000081',true);
SET LOCAL ROLE authenticated;
INSERT INTO public.recurring_emis(id,owner_id,name,amount,start_date,end_date,
  initiator_account_id,type,status)
VALUES ('50000000-0000-4000-a000-000000000083',
  '00000000-0000-4000-a000-000000000081','Personal EMI',5,current_date,
  current_date + 30,'10000000-0000-4000-a000-000000000081','personal','ACTIVE');
DO $$
BEGIN
  BEGIN
    INSERT INTO public.recurring_emis(owner_id,name,amount,start_date,end_date,
      type,counterparty_profile_id,status)
    VALUES ('00000000-0000-4000-a000-000000000081','Forged peer EMI',5,
      current_date,current_date + 30,'lent',
      '00000000-0000-4000-a000-000000000082','PENDING_APPROVAL');
    RAISE EXCEPTION 'Direct peer-EMI insertion succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.transactions(owner_id,initiator_profile_id,to_account_id,
      amount,description,status)
    VALUES ('00000000-0000-4000-a000-000000000081',
      '00000000-0000-4000-a000-000000000081',
      '10000000-0000-4000-a000-000000000081',1,'Non-idempotent write','COMPLETED');
    RAISE EXCEPTION 'Direct ledger transaction insertion succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE public.transactions SET description='Forged history'
     WHERE id='30000000-0000-4000-a000-000000000081';
    RAISE EXCEPTION 'Direct ledger transaction update succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    DELETE FROM public.transactions
     WHERE id='30000000-0000-4000-a000-000000000081';
    RAISE EXCEPTION 'Direct ledger transaction deletion succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM public.dismiss_declined_obligation(
    '40000000-0000-4000-a000-000000000082');
  PERFORM public.dismiss_declined_emi(
    '50000000-0000-4000-a000-000000000081');
  PERFORM public.merge_shadow_contact(
    '20000000-0000-4000-a000-000000000081',
    '00000000-0000-4000-a000-000000000082');
  PERFORM public.cancel_owned_emi('50000000-0000-4000-a000-000000000082');
  PERFORM public.cancel_owned_emi('50000000-0000-4000-a000-000000000083');
  IF EXISTS (SELECT 1 FROM public.contacts
              WHERE id='20000000-0000-4000-a000-000000000081')
     OR NOT EXISTS (SELECT 1 FROM public.transactions
              WHERE id='30000000-0000-4000-a000-000000000081'
                AND tagged_profile_id='00000000-0000-4000-a000-000000000082'
                AND contact_id IS NULL)
     OR NOT EXISTS (SELECT 1 FROM public.obligations
              WHERE id='40000000-0000-4000-a000-000000000081'
                AND profile_id='00000000-0000-4000-a000-000000000082'
                AND contact_id IS NULL AND shadow_contact_id IS NULL)
     OR NOT EXISTS (SELECT 1 FROM public.recurring_emis
              WHERE id='50000000-0000-4000-a000-000000000082'
                AND counterparty_profile_id='00000000-0000-4000-a000-000000000082'
                AND shadow_contact_id IS NULL AND status='CANCELED')
     OR NOT EXISTS (SELECT 1 FROM public.obligations
              WHERE id='40000000-0000-4000-a000-000000000082' AND status='CANCELED')
     OR NOT EXISTS (SELECT 1 FROM public.recurring_emis
              WHERE id='50000000-0000-4000-a000-000000000083' AND status='CANCELED')
     OR NOT EXISTS (SELECT 1 FROM public.recurring_emis
              WHERE id='50000000-0000-4000-a000-000000000081' AND status='CANCELED') THEN
    RAISE EXCEPTION 'Validated peer write did not persist expected state';
  END IF;
  BEGIN
    PERFORM public.dismiss_declined_obligation(
      '40000000-0000-4000-a000-000000000081');
    RAISE EXCEPTION 'Owner dismissed another participant’s unrelated obligation';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;
ROLLBACK;
SELECT 'PASS: peer writes are RPC-only, participant checks hold, merges and cancellations preserve linked history' AS result;

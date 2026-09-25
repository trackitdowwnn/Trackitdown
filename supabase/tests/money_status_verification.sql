-- =============================================================================
-- Money status verification — the reads behind "where's my money"
-- (20260925110000). NOT a migration — do not place in migrations/.
--
-- SELF-ASSERTING: every check RAISES EXCEPTION on failure. Every check runs in
-- begin…rollback on its own fixtures (posts e0e0e0e0-…), so nothing leaks into
-- the suites that sort after it.
--
-- The properties:
--   * an owner sees every state their listing's money can be in — and only
--     their own listing's;
--   * a pending and a rejected payout review look IDENTICAL to both sides, and
--     no review reason ever leaves the database;
--   * a spotter sees every reward they earned, with the right state, and
--     nobody else's;
--   * the dispute door closes after its window in BOTH gates, and a filed
--     dispute stays readable after it.
--
-- Fixtures: owner 22222222-…, spotters 33333333-… and 44444444-… (seed.sql).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- CHECK 1 — A LIVE LISTING READS `held`, TO ITS OWNER ONLY. Another user, and
-- anon, get nothing — not an error that would confirm the listing exists.
-- -----------------------------------------------------------------------------
begin;
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate)
values ('e0e0e0e0-0000-0000-0000-000000000001',
        '22222222-2222-2222-2222-222222222222', 'active', 40000, 'MS01 HLD');
insert into public.payments
  (post_id, stripe_payment_intent_id, status, amount_pence, kind, pricing, reward_pence, service_fee_pence)
values ('e0e0e0e0-0000-0000-0000-000000000001', 'pi_ms1', 'held', 42000, 'bounty_escrow',
        'fee_on_top', 40000, 2000);

do $$
declare
  v_money jsonb;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
  set local role authenticated;
  v_money := public.get_post_money('e0e0e0e0-0000-0000-0000-000000000001');
  reset role;

  if v_money ->> 'state' is distinct from 'held'
     or (v_money ->> 'rewardPence')::int <> 40000
     or (v_money ->> 'serviceFeePence')::int <> 2000
     or (v_money ->> 'chargedPence')::int <> 42000
     or (v_money ->> 'headlinePence')::int <> 40000
     or (v_money ->> 'hasCreditedSighting')::boolean then
    raise exception 'CHECK 1 FAILED: owner read %', v_money;
  end if;

  perform set_config('request.jwt.claims',
    '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
  set local role authenticated;
  v_money := public.get_post_money('e0e0e0e0-0000-0000-0000-000000000001');
  reset role;
  if v_money is not null then
    raise exception 'CHECK 1 FAILED: a non-owner read another owner''s money: %', v_money;
  end if;

  if has_function_privilege('anon', 'public.get_post_money(uuid)', 'EXECUTE') then
    raise exception 'CHECK 1 FAILED: anon can call get_post_money';
  end if;
  raise notice 'CHECK 1 passed: a live listing reads held, to its owner only';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 2 — THE CREDITED STATES, AND THE REVIEW ORACLE THAT MUST NOT EXIST.
-- awaiting_payee → (payable) sending → (review pending) being_checked →
-- (review rejected) STILL being_checked → (approved) sending. The owner can
-- never tell a rejected review from a pending one, and never sees a reason.
-- -----------------------------------------------------------------------------
begin;
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate)
values ('e0e0e0e0-0000-0000-0000-000000000002',
        '22222222-2222-2222-2222-222222222222', 'recovery_claimed', 40000, 'MS02 CRD');
insert into public.payments
  (post_id, stripe_payment_intent_id, status, amount_pence, kind, pricing, reward_pence, service_fee_pence)
values ('e0e0e0e0-0000-0000-0000-000000000002', 'pi_ms2', 'held', 42000, 'bounty_escrow',
        'fee_on_top', 40000, 2000);
insert into public.sightings (id, post_id, spotter_id, status, area_label, location_unavailable)
values ('e0e0e0e0-1111-0000-0000-000000000002', 'e0e0e0e0-0000-0000-0000-000000000002',
        '33333333-3333-3333-3333-333333333333', 'credited', 'Camden', true);
-- Not payable. RESET rather than deleted: an earlier suite may have left a
-- released payment pointing at this account (payee_account_id is ON DELETE
-- RESTRICT), and a delete would fail on it. Rolled back either way.
update public.stripe_connected_accounts
   set payouts_enabled = false, details_submitted_at = null
 where profile_id = '33333333-3333-3333-3333-333333333333';

do $$
declare
  v_state text;
  v_doc   jsonb;
begin
  v_doc := public.post_money_state('e0e0e0e0-0000-0000-0000-000000000002');
  if v_doc ->> 'state' <> 'awaiting_payee' or not (v_doc ->> 'hasCreditedSighting')::boolean then
    raise exception 'CHECK 2 FAILED: an unpayable spotter read %, expected awaiting_payee', v_doc;
  end if;

  insert into public.stripe_connected_accounts (profile_id, stripe_account_id, onboarding_complete, payouts_enabled)
  values ('33333333-3333-3333-3333-333333333333', 'acct_ms2', true, true)
  on conflict (profile_id) do update set payouts_enabled = true;
  v_state := public.post_money_state('e0e0e0e0-0000-0000-0000-000000000002') ->> 'state';
  if v_state <> 'sending' then
    raise exception 'CHECK 2 FAILED: a payable spotter read %, expected sending', v_state;
  end if;

  insert into public.payout_reviews (post_id, owner_id, spotter_id, reasons)
  values ('e0e0e0e0-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
          '33333333-3333-3333-3333-333333333333', array['shared_device']);
  v_doc := public.post_money_state('e0e0e0e0-0000-0000-0000-000000000002');
  if v_doc ->> 'state' <> 'being_checked' then
    raise exception 'CHECK 2 FAILED: a pending review read %, expected being_checked', v_doc ->> 'state';
  end if;
  if v_doc::text like '%shared_device%' then
    raise exception 'CHECK 2 FAILED: a review reason reached the owner: %', v_doc;
  end if;

  update public.payout_reviews set resolution = 'rejected', resolved_at = now()
   where post_id = 'e0e0e0e0-0000-0000-0000-000000000002';
  v_state := public.post_money_state('e0e0e0e0-0000-0000-0000-000000000002') ->> 'state';
  if v_state <> 'being_checked' then
    raise exception 'CHECK 2 FAILED: a REJECTED review read % — it must be indistinguishable from pending', v_state;
  end if;

  update public.payout_reviews set resolution = 'approved'
   where post_id = 'e0e0e0e0-0000-0000-0000-000000000002';
  v_state := public.post_money_state('e0e0e0e0-0000-0000-0000-000000000002') ->> 'state';
  if v_state <> 'sending' then
    raise exception 'CHECK 2 FAILED: an approved review read %, expected sending', v_state;
  end if;
  raise notice 'CHECK 2 passed: awaiting_payee → sending → being_checked (pending = rejected) → sending';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 3 — PAID, REFUNDED AND THE £5 FEE. Each carries the figure that moved
-- and when; a refund names the card fee withheld.
-- -----------------------------------------------------------------------------
begin;
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate)
values ('e0e0e0e0-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222', 'recovered', 40000, 'MS03 PAI'),
       ('e0e0e0e0-0000-0000-0000-000000000004', '22222222-2222-2222-2222-222222222222', 'cancelled', 40000, 'MS04 REF'),
       ('e0e0e0e0-0000-0000-0000-000000000005', '22222222-2222-2222-2222-222222222222', 'active',    null,  'MS05 FEE');
insert into public.payments
  (post_id, stripe_payment_intent_id, status, amount_pence, kind, pricing, reward_pence, service_fee_pence)
values ('e0e0e0e0-0000-0000-0000-000000000003', 'pi_ms3', 'held', 42000, 'bounty_escrow', 'fee_on_top', 40000, 2000),
       ('e0e0e0e0-0000-0000-0000-000000000004', 'pi_ms4', 'held', 42000, 'bounty_escrow', 'fee_on_top', 40000, 2000),
       ('e0e0e0e0-0000-0000-0000-000000000005', 'pi_ms5', 'collected', 500, 'listing_fee', 'flat_fee', null, 500);
update public.payments set status = 'released', transfer_amount_pence = 40000, platform_fee_pence = 2000
 where stripe_payment_intent_id = 'pi_ms3';
update public.payments set status = 'refunded', refunded_amount_pence = 41350
 where stripe_payment_intent_id = 'pi_ms4';

do $$
declare
  v_doc jsonb;
begin
  v_doc := public.post_money_state('e0e0e0e0-0000-0000-0000-000000000003');
  if v_doc ->> 'state' <> 'paid' or (v_doc -> 'paid' ->> 'pence')::int <> 40000
     or v_doc -> 'paid' ->> 'at' is null then
    raise exception 'CHECK 3 FAILED: a released payment read %', v_doc;
  end if;

  v_doc := public.post_money_state('e0e0e0e0-0000-0000-0000-000000000004');
  if v_doc ->> 'state' <> 'refunded'
     or (v_doc -> 'refund' ->> 'pence')::int <> 41350
     or (v_doc -> 'refund' ->> 'cardFeePence')::int <> 650
     or (v_doc ->> 'headlinePence')::int <> 41350 then
    raise exception 'CHECK 3 FAILED: a refund read %', v_doc;
  end if;

  v_doc := public.post_money_state('e0e0e0e0-0000-0000-0000-000000000005');
  if v_doc ->> 'state' <> 'fee_paid' or (v_doc ->> 'headlinePence')::int <> 500 then
    raise exception 'CHECK 3 FAILED: a £5 listing read %', v_doc;
  end if;
  raise notice 'CHECK 3 passed: paid, refunded (with the card fee named) and fee_paid';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 4 — THE REFUND HOLD: on hold (with its date) → paused by a dispute →
-- refunding once the window has passed undisputed. A closed listing with no
-- hold whose refund has not landed is refunding too.
-- -----------------------------------------------------------------------------
begin;
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate)
values ('e0e0e0e0-0000-0000-0000-000000000006', '22222222-2222-2222-2222-222222222222', 'cancelled', 40000, 'MS06 HLD'),
       ('e0e0e0e0-0000-0000-0000-000000000007', '22222222-2222-2222-2222-222222222222', 'cancelled', 40000, 'MS07 FLY');
insert into public.payments
  (post_id, stripe_payment_intent_id, status, amount_pence, kind, pricing, reward_pence, service_fee_pence)
values ('e0e0e0e0-0000-0000-0000-000000000006', 'pi_ms6', 'held', 42000, 'bounty_escrow', 'fee_on_top', 40000, 2000),
       ('e0e0e0e0-0000-0000-0000-000000000007', 'pi_ms7', 'held', 42000, 'bounty_escrow', 'fee_on_top', 40000, 2000);
insert into public.sightings (id, post_id, spotter_id, status, area_label, location_unavailable)
values ('e0e0e0e0-1111-0000-0000-000000000006', 'e0e0e0e0-0000-0000-0000-000000000006',
        '33333333-3333-3333-3333-333333333333', 'unverified', 'Camden', true);
insert into public.refund_holds (post_id, owner_id, exit_path, sighting_ids, expires_at)
values ('e0e0e0e0-0000-0000-0000-000000000006', '22222222-2222-2222-2222-222222222222', 'deactivate',
        array['e0e0e0e0-1111-0000-0000-000000000006'::uuid], now() + interval '48 hours');

do $$
declare
  v_doc jsonb;
begin
  v_doc := public.post_money_state('e0e0e0e0-0000-0000-0000-000000000006');
  if v_doc ->> 'state' <> 'refund_on_hold' or v_doc -> 'refundHold' ->> 'expiresAt' is null
     or (v_doc ->> 'headlinePence')::int <> 42000 then
    raise exception 'CHECK 4 FAILED: a hold read %', v_doc;
  end if;

  insert into public.refund_disputes (post_id, sighting_id, spotter_id)
  values ('e0e0e0e0-0000-0000-0000-000000000006', 'e0e0e0e0-1111-0000-0000-000000000006',
          '33333333-3333-3333-3333-333333333333');
  v_doc := public.post_money_state('e0e0e0e0-0000-0000-0000-000000000006');
  if v_doc ->> 'state' <> 'refund_paused' or not (v_doc -> 'refundHold' ->> 'paused')::boolean then
    raise exception 'CHECK 4 FAILED: a disputed hold read %', v_doc;
  end if;
  if v_doc::text like '%33333333%' then
    raise exception 'CHECK 4 FAILED: the disputing spotter reached the owner: %', v_doc;
  end if;

  delete from public.refund_disputes where post_id = 'e0e0e0e0-0000-0000-0000-000000000006';
  update public.refund_holds set expires_at = now() - interval '1 hour'
   where post_id = 'e0e0e0e0-0000-0000-0000-000000000006';
  if public.post_money_state('e0e0e0e0-0000-0000-0000-000000000006') ->> 'state' <> 'refunding' then
    raise exception 'CHECK 4 FAILED: an expired, undisputed hold is not refunding';
  end if;

  if public.post_money_state('e0e0e0e0-0000-0000-0000-000000000007') ->> 'state' <> 'refunding' then
    raise exception 'CHECK 4 FAILED: a cancelled listing with held money and no hold is not refunding';
  end if;
  raise notice 'CHECK 4 passed: refund_on_hold → refund_paused → refunding';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 4b — "FOUND IT ANOTHER WAY", INTERRUPTED. claim_recovery's no-spotter
-- answer left the post recovery_claimed, but refund-recovery never ran: no
-- credited sighting, no hold, the money still held. That must read
-- refund_owed — not `held`, which told the owner their reward was waiting to
-- be paid out after they had said nobody found it (review 2026-09-25).
-- -----------------------------------------------------------------------------
begin;
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate)
values ('e0e0e0e0-0000-0000-0000-000000000012', '22222222-2222-2222-2222-222222222222',
        'recovery_claimed', 40000, 'MS12 OWE');
insert into public.payments
  (post_id, stripe_payment_intent_id, status, amount_pence, kind, pricing, reward_pence, service_fee_pence)
values ('e0e0e0e0-0000-0000-0000-000000000012', 'pi_ms12', 'held', 42000, 'bounty_escrow',
        'fee_on_top', 40000, 2000);

do $$
declare
  v_doc jsonb;
begin
  v_doc := public.post_money_state('e0e0e0e0-0000-0000-0000-000000000012');
  if v_doc ->> 'state' is distinct from 'refund_owed'
     or (v_doc ->> 'hasCreditedSighting')::boolean
     or (v_doc ->> 'headlinePence')::int <> 42000 then
    raise exception 'CHECK 4b FAILED: an interrupted no-spotter recovery read %', v_doc;
  end if;
  raise notice 'CHECK 4b passed: an interrupted "found it another way" reads refund_owed, not held';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 5 — MY LISTINGS CARRIES THE SAME STATE IN BRIEF, and a draft (nothing
-- captured) carries none.
-- -----------------------------------------------------------------------------
begin;
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate)
values ('e0e0e0e0-0000-0000-0000-000000000008', '22222222-2222-2222-2222-222222222222', 'active', 40000, 'MS08 LST'),
       ('e0e0e0e0-0000-0000-0000-000000000009', '22222222-2222-2222-2222-222222222222', 'draft',  40000, 'MS09 DRF');
insert into public.payments
  (post_id, stripe_payment_intent_id, status, amount_pence, kind, pricing, reward_pence, service_fee_pence)
values ('e0e0e0e0-0000-0000-0000-000000000008', 'pi_ms8', 'held', 42000, 'bounty_escrow', 'fee_on_top', 40000, 2000);

do $$
declare
  v_list  jsonb;
  v_live  jsonb;
  v_draft jsonb;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
  set local role authenticated;
  v_list := public.list_my_posts();
  reset role;

  select e -> 'money' into v_live  from jsonb_array_elements(v_list) e
   where e ->> 'id' = 'e0e0e0e0-0000-0000-0000-000000000008';
  select e -> 'money' into v_draft from jsonb_array_elements(v_list) e
   where e ->> 'id' = 'e0e0e0e0-0000-0000-0000-000000000009';

  if v_live ->> 'state' is distinct from 'held' or (v_live ->> 'amountPence')::int <> 40000 then
    raise exception 'CHECK 5 FAILED: the live card''s money read %', v_live;
  end if;
  if v_draft is not null and v_draft <> 'null'::jsonb then
    raise exception 'CHECK 5 FAILED: a draft with nothing captured showed money %', v_draft;
  end if;
  raise notice 'CHECK 5 passed: list_my_posts carries each listing''s money in brief';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 6 — EARNINGS: every state a spotter's reward can be in, the totals,
-- and nobody else's rewards. A £5-listing credit carries no money.
-- -----------------------------------------------------------------------------
begin;
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate)
values ('e0e0e0e0-0000-0000-0000-00000000000a', '22222222-2222-2222-2222-222222222222', 'recovered',        40000, 'MS0A ERN'),
       ('e0e0e0e0-0000-0000-0000-00000000000b', '22222222-2222-2222-2222-222222222222', 'recovery_claimed', 30000, 'MS0B ERN'),
       ('e0e0e0e0-0000-0000-0000-00000000000c', '22222222-2222-2222-2222-222222222222', 'recovered',        null,  'MS0C FEE'),
       ('e0e0e0e0-0000-0000-0000-00000000000d', '22222222-2222-2222-2222-222222222222', 'recovery_claimed', 50000, 'MS0D OTH');
insert into public.payments
  (post_id, stripe_payment_intent_id, status, amount_pence, kind, pricing, reward_pence, service_fee_pence)
values ('e0e0e0e0-0000-0000-0000-00000000000a', 'pi_ms_a', 'held', 42000, 'bounty_escrow', 'fee_on_top', 40000, 2000),
       ('e0e0e0e0-0000-0000-0000-00000000000b', 'pi_ms_b', 'held', 31500, 'bounty_escrow', 'fee_on_top', 30000, 1500),
       ('e0e0e0e0-0000-0000-0000-00000000000c', 'pi_ms_c', 'collected', 500, 'listing_fee', 'flat_fee', null, 500),
       ('e0e0e0e0-0000-0000-0000-00000000000d', 'pi_ms_d', 'held', 52500, 'bounty_escrow', 'fee_on_top', 50000, 2500);
update public.payments set status = 'released', transfer_amount_pence = 40000, platform_fee_pence = 2000
 where stripe_payment_intent_id = 'pi_ms_a';
insert into public.sightings (id, post_id, spotter_id, status, area_label, location_unavailable)
values ('e0e0e0e0-1111-0000-0000-00000000000a', 'e0e0e0e0-0000-0000-0000-00000000000a', '33333333-3333-3333-3333-333333333333', 'credited', 'Camden', true),
       ('e0e0e0e0-1111-0000-0000-00000000000b', 'e0e0e0e0-0000-0000-0000-00000000000b', '33333333-3333-3333-3333-333333333333', 'credited', 'Camden', true),
       ('e0e0e0e0-1111-0000-0000-00000000000c', 'e0e0e0e0-0000-0000-0000-00000000000c', '33333333-3333-3333-3333-333333333333', 'credited', 'Camden', true),
       -- Another spotter's reward: must never appear in the caller's earnings.
       ('e0e0e0e0-1111-0000-0000-00000000000d', 'e0e0e0e0-0000-0000-0000-00000000000d', '44444444-4444-4444-4444-444444444444', 'credited', 'Hackney', true);
-- Start with no usable payout account (reset, not deleted — see CHECK 2).
update public.stripe_connected_accounts
   set payouts_enabled = false, details_submitted_at = null
 where profile_id = '33333333-3333-3333-3333-333333333333';

do $$
declare
  v_earn  jsonb;
  v_state text;
  v_count int;
  v_step  text;
begin
  -- One read per payout-setup stage, for the still-held £300 reward.
  foreach v_step in array array['add_details', 'verifying', 'on_its_way', 'being_checked'] loop
    if v_step = 'verifying' then
      insert into public.stripe_connected_accounts
        (profile_id, stripe_account_id, onboarding_complete, payouts_enabled, details_submitted_at)
      values ('33333333-3333-3333-3333-333333333333', 'acct_ms6', false, false, now())
      on conflict (profile_id) do update set details_submitted_at = now(), payouts_enabled = false;
    elsif v_step = 'on_its_way' then
      update public.stripe_connected_accounts set payouts_enabled = true
       where profile_id = '33333333-3333-3333-3333-333333333333';
    elsif v_step = 'being_checked' then
      insert into public.payout_reviews (post_id, owner_id, spotter_id, reasons)
      values ('e0e0e0e0-0000-0000-0000-00000000000b', '22222222-2222-2222-2222-222222222222',
              '33333333-3333-3333-3333-333333333333', array['shared_card']);
    end if;

    perform set_config('request.jwt.claims',
      '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
    set local role authenticated;
    v_earn := public.my_earnings();
    reset role;

    select i ->> 'state' into v_state from jsonb_array_elements(v_earn -> 'items') i
     where i ->> 'sightingId' = 'e0e0e0e0-1111-0000-0000-00000000000b';
    if v_state is distinct from v_step then
      raise exception 'CHECK 6 FAILED: the held reward read % at stage %', v_state, v_step;
    end if;
  end loop;

  if v_earn::text like '%shared_card%' then
    raise exception 'CHECK 6 FAILED: a review reason reached the spotter';
  end if;

  -- Exactly the caller's two rewards: the paid £400 and the held £300.
  select count(*) into v_count from jsonb_array_elements(v_earn -> 'items');
  if v_count <> 2 then
    raise exception 'CHECK 6 FAILED: % earnings items, expected 2 (no £5 credit, nobody else''s): %', v_count, v_earn;
  end if;
  if exists (select 1 from jsonb_array_elements(v_earn -> 'items') i
              where i ->> 'sightingId' = 'e0e0e0e0-1111-0000-0000-00000000000a'
                and (i ->> 'state' <> 'paid' or (i ->> 'paidPence')::int <> 40000 or i ->> 'paidAt' is null)) then
    raise exception 'CHECK 6 FAILED: the paid reward read wrong: %', v_earn;
  end if;
  if (v_earn -> 'totals' ->> 'paidPence')::int <> 40000
     or (v_earn -> 'totals' ->> 'pendingPence')::int <> 30000 then
    raise exception 'CHECK 6 FAILED: totals %', v_earn -> 'totals';
  end if;
  if v_earn::text like '%e0e0e0e0-0000-0000-0000-00000000000%' or v_earn::text like '%post_id%' then
    raise exception 'CHECK 6 FAILED: a post id reached a spotter''s earnings: %', v_earn;
  end if;

  if has_function_privilege('anon', 'public.my_earnings()', 'EXECUTE') then
    raise exception 'CHECK 6 FAILED: anon can call my_earnings';
  end if;
  raise notice 'CHECK 6 passed: earnings read every stage, total correctly, and hold only the caller''s rewards';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 7 — MY REPORTS: a credited row carries its own money; others carry
-- none.
-- -----------------------------------------------------------------------------
begin;
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate)
values ('e0e0e0e0-0000-0000-0000-00000000000e', '22222222-2222-2222-2222-222222222222', 'recovery_claimed', 40000, 'MS0E REP'),
       ('e0e0e0e0-0000-0000-0000-00000000000f', '22222222-2222-2222-2222-222222222222', 'active',           40000, 'MS0F REP');
insert into public.payments
  (post_id, stripe_payment_intent_id, status, amount_pence, kind, pricing, reward_pence, service_fee_pence)
values ('e0e0e0e0-0000-0000-0000-00000000000e', 'pi_ms_e', 'held', 42000, 'bounty_escrow', 'fee_on_top', 40000, 2000),
       ('e0e0e0e0-0000-0000-0000-00000000000f', 'pi_ms_f', 'held', 42000, 'bounty_escrow', 'fee_on_top', 40000, 2000);
insert into public.sightings (id, post_id, spotter_id, status, area_label, location_unavailable)
values ('e0e0e0e0-1111-0000-0000-00000000000e', 'e0e0e0e0-0000-0000-0000-00000000000e', '33333333-3333-3333-3333-333333333333', 'credited',   'Camden', true),
       ('e0e0e0e0-1111-0000-0000-00000000000f', 'e0e0e0e0-0000-0000-0000-00000000000f', '33333333-3333-3333-3333-333333333333', 'unverified', 'Camden', true);

do $$
declare
  v_rec      jsonb;
  v_credited jsonb;
  v_other    jsonb;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
  set local role authenticated;
  v_rec := public.my_sighting_record();
  reset role;

  select e -> 'money' into v_credited from jsonb_array_elements(v_rec -> 'sightings') e
   where e ->> 'id' = 'e0e0e0e0-1111-0000-0000-00000000000e';
  select e -> 'money' into v_other from jsonb_array_elements(v_rec -> 'sightings') e
   where e ->> 'id' = 'e0e0e0e0-1111-0000-0000-00000000000f';

  if (v_credited ->> 'rewardPence')::int is distinct from 40000 or v_credited ->> 'state' is null then
    raise exception 'CHECK 7 FAILED: the credited report''s money read %', v_credited;
  end if;
  if v_other is not null and v_other <> 'null'::jsonb then
    raise exception 'CHECK 7 FAILED: an uncredited report carried money %', v_other;
  end if;
  raise notice 'CHECK 7 passed: only a credited report carries money, and it is the caller''s own reward';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 8 — THE DOOR CLOSES WITH ITS WINDOW, IN BOTH GATES, AND A FILED
-- DISPUTE STAYS READABLE AFTER IT. my_sighting_record's `available` and
-- my_dispute_context must agree in every case, or the card offers a door the
-- screen then refuses.
-- -----------------------------------------------------------------------------
begin;
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate)
values ('e0e0e0e0-0000-0000-0000-000000000010', '22222222-2222-2222-2222-222222222222', 'cancelled', 40000, 'MS10 DOR');
insert into public.payments
  (post_id, stripe_payment_intent_id, status, amount_pence, kind, pricing, reward_pence, service_fee_pence)
values ('e0e0e0e0-0000-0000-0000-000000000010', 'pi_ms10', 'held', 42000, 'bounty_escrow', 'fee_on_top', 40000, 2000);
insert into public.sightings (id, post_id, spotter_id, status, area_label, location_unavailable)
values ('e0e0e0e0-1111-0000-0000-000000000010', 'e0e0e0e0-0000-0000-0000-000000000010', '33333333-3333-3333-3333-333333333333', 'unverified', 'Camden', true),
       ('e0e0e0e0-1111-0000-0000-000000000011', 'e0e0e0e0-0000-0000-0000-000000000010', '44444444-4444-4444-4444-444444444444', 'unverified', 'Hackney', true);
insert into public.refund_holds (post_id, owner_id, exit_path, sighting_ids, expires_at)
values ('e0e0e0e0-0000-0000-0000-000000000010', '22222222-2222-2222-2222-222222222222', 'deactivate',
        array['e0e0e0e0-1111-0000-0000-000000000010'::uuid, 'e0e0e0e0-1111-0000-0000-000000000011'::uuid],
        now() + interval '24 hours');

-- A function for "what each gate says about this sighting, for this spotter".
create function pg_temp.door(p_sighting uuid, p_spotter uuid)
returns table (card_available boolean, card_can_file boolean, context_available boolean)
language plpgsql as $f$
declare
  v_rec jsonb;
begin
  perform set_config('request.jwt.claims',
    format('{"sub":"%s","role":"authenticated"}', p_spotter), true);
  set local role authenticated;
  v_rec := public.my_sighting_record();
  select (e -> 'dispute' ->> 'available')::boolean, (e -> 'dispute' ->> 'can_file')::boolean
    into card_available, card_can_file
    from jsonb_array_elements(v_rec -> 'sightings') e
   where e ->> 'id' = p_sighting::text;
  begin
    perform public.my_dispute_context(p_sighting);
    context_available := true;
  exception when others then
    if sqlerrm not like '%DISPUTE_NOT_AVAILABLE%' then raise; end if;
    context_available := false;
  end;
  reset role;
  return next;
end $f$;

do $$
declare
  v_mine  record;
  v_other record;
begin
  -- Inside the window: both gates open, fileable.
  select * into v_mine from pg_temp.door('e0e0e0e0-1111-0000-0000-000000000010', '33333333-3333-3333-3333-333333333333');
  if not (v_mine.card_available and v_mine.card_can_file and v_mine.context_available) then
    raise exception 'CHECK 8 FAILED: inside the window the door read %', v_mine;
  end if;

  -- Spotter 3333 files; spotter 4444 does not. Then the window closes.
  insert into public.refund_disputes (post_id, sighting_id, spotter_id)
  values ('e0e0e0e0-0000-0000-0000-000000000010', 'e0e0e0e0-1111-0000-0000-000000000010',
          '33333333-3333-3333-3333-333333333333');
  update public.refund_holds set expires_at = now() - interval '1 hour'
   where post_id = 'e0e0e0e0-0000-0000-0000-000000000010';

  -- Filed: the outcome stays readable, but nothing more can be filed.
  select * into v_mine from pg_temp.door('e0e0e0e0-1111-0000-0000-000000000010', '33333333-3333-3333-3333-333333333333');
  if not (v_mine.card_available and not v_mine.card_can_file and v_mine.context_available) then
    raise exception 'CHECK 8 FAILED: a filed dispute after the window read %', v_mine;
  end if;

  -- Unfiled after the window: closed, in BOTH gates.
  select * into v_other from pg_temp.door('e0e0e0e0-1111-0000-0000-000000000011', '44444444-4444-4444-4444-444444444444');
  if v_other.card_available or v_other.card_can_file or v_other.context_available then
    raise exception 'CHECK 8 FAILED: an unfiled sighting after the window read % — the card would open onto DISPUTE_NOT_AVAILABLE', v_other;
  end if;
  raise notice 'CHECK 8 passed: the door closes with its window in both gates; a filed dispute stays readable';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 9 — THE HELPERS ARE NOT CALLABLE BY CLIENTS. They make no ownership
-- check of their own; only the reads that wrap them do.
-- -----------------------------------------------------------------------------
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.post_money_state(uuid)',
    'public.credit_money_state(uuid)'
  ] loop
    if has_function_privilege('anon', fn, 'EXECUTE')
       or has_function_privilege('authenticated', fn, 'EXECUTE') then
      raise exception 'CHECK 9 FAILED: a client role can EXECUTE %', fn;
    end if;
  end loop;
  raise notice 'CHECK 9 passed: the money-state helpers are closed to clients';
end $$;

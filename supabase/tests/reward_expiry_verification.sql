-- =============================================================================
-- WHAT:  Verification for the reward expiry (20261006130000_a_reward_expires.sql):
--        holds are one per payment; claim_reward_expiries claims exactly the
--        rewards it should (and skips every claim, change and closed listing);
--        the system hold waits 72 hours only when a recent sighting might have
--        found the car; a legacy reward comes back in full; the refund record
--        keeps the listing up as "Reward ended" — even when the webhook lands
--        first; an owner exit mid-window upgrades the hold and keeps the
--        spotters' window; a spotter can dispute, and an upheld dispute on a
--        live listing goes to the payout rails; a stale "found it another way"
--        is finished as its refund; the push copy is exact and plate-free.
-- WHY:   This is the one timer that moves money without a person asking
--        (ADR-0020). Every rule here is a promise in the Terms.
-- HOW:   Self-asserting, begin…rollback per check, RAISE on failure (CI's db
--        job). Owner 11111111-…, spotters 33333333-… / 44444444-… are seed
--        profiles. Every claim reads every payment, so each claim check first
--        marks pre-existing rows as already claimed.
-- LINKS: supabase/migrations/20261006130000_a_reward_expires.sql;
--        supabase/functions/release-held-refunds/index.ts (Phase 1-pre).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- CHECK 1 — card_fee_pence is the fixed 1.5% + 20p (ADR-0021), half-up, and
-- agrees with the app/server examples.
-- -----------------------------------------------------------------------------
do $$
begin
  if public.card_fee_pence(20000) <> 320 or public.card_fee_pence(1000) <> 35
     or public.card_fee_pence(50000) <> 770 or public.card_fee_pence(500000) <> 7520
     or public.card_fee_pence(1100) <> 37 then
    raise exception 'CHECK 1 FAILED: card_fee_pence disagrees with ADR-0021 (got %, %, %, %, %)',
      public.card_fee_pence(20000), public.card_fee_pence(1000), public.card_fee_pence(50000),
      public.card_fee_pence(500000), public.card_fee_pence(1100);
  end if;
  raise notice 'CHECK 1 passed: card_fee_pence is 1.5%% + 20p, half-up';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 2 — holds are ONE PER PAYMENT: a hold without a payment_id links to
-- the held reward; one payment cannot have two; a post can (two rewards).
-- -----------------------------------------------------------------------------
begin;
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate)
values ('e5e50000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'active', 20000, 'EX02 AAA');
insert into public.payments (id, post_id, stripe_payment_intent_id, status, amount_pence)
values ('e5e50002-0000-0000-0000-00000000000a', 'e5e50000-0000-0000-0000-000000000002', 'pi_ex2_old', 'refunded', 20000),
       ('e5e50002-0000-0000-0000-00000000000b', 'e5e50000-0000-0000-0000-000000000002', 'pi_ex2_held', 'held', 20000);
insert into public.sightings (id, post_id, spotter_id, status, area_label, location_unavailable)
values ('e5e50002-1111-0000-0000-000000000001', 'e5e50000-0000-0000-0000-000000000002',
        '33333333-3333-3333-3333-333333333333', 'unverified', 'Camden', true);

do $$
declare
  v_err text;
begin
  insert into public.refund_holds (post_id, owner_id, exit_path, sighting_ids, expires_at)
  values ('e5e50000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'deactivate',
          array['e5e50002-1111-0000-0000-000000000001'::uuid], now() + interval '72 hours');
  if (select payment_id from public.refund_holds where post_id = 'e5e50000-0000-0000-0000-000000000002')
     <> 'e5e50002-0000-0000-0000-00000000000b' then
    raise exception 'CHECK 2 FAILED: a hold with no payment_id did not link to the HELD reward';
  end if;

  begin
    insert into public.refund_holds (post_id, payment_id, owner_id, exit_path, sighting_ids, expires_at)
    values ('e5e50000-0000-0000-0000-000000000002', 'e5e50002-0000-0000-0000-00000000000b',
            '11111111-1111-1111-1111-111111111111', 'recovery',
            array['e5e50002-1111-0000-0000-000000000001'::uuid], now());
    v_err := 'none';
  exception when unique_violation then v_err := 'unique'; end;
  if v_err <> 'unique' then
    raise exception 'CHECK 2 FAILED: one payment took two holds';
  end if;

  -- A second hold on the SAME post, for an earlier reward: allowed now.
  insert into public.refund_holds (post_id, payment_id, owner_id, exit_path, sighting_ids, expires_at)
  values ('e5e50000-0000-0000-0000-000000000002', 'e5e50002-0000-0000-0000-00000000000a',
          '11111111-1111-1111-1111-111111111111', 'deactivate',
          array['e5e50002-1111-0000-0000-000000000001'::uuid], now() - interval '30 days');

  begin
    insert into public.refund_holds (post_id, payment_id, owner_id, exit_path, sighting_ids, expires_at)
    values ('e5e50000-0000-0000-0000-000000000002', 'e5e50002-0000-0000-0000-00000000000a',
            '11111111-1111-1111-1111-111111111111', 'reward_end', '{}', now());
    v_err := 'none';
  exception when check_violation then v_err := 'check'; when unique_violation then v_err := 'check'; end;
  if v_err <> 'check' then
    raise exception 'CHECK 2 FAILED: an owner (non-system) reward_end hold was accepted';
  end if;
  raise notice 'CHECK 2 passed: one hold per payment, linked to the held reward; only the system ends a reward';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 3 — the claim, no recent sightings: due NOW, owner told the exact
-- figure, refunds_due names it reward_end; a replay claims nothing.
-- -----------------------------------------------------------------------------
begin;
update public.payments set expiry_claimed_at = now() where status = 'held' and expiry_claimed_at is null;
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate, make, colour)
values ('e5e50000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'active', 20000, 'EX03 AAA', 'BMW', 'Blue');
insert into public.payments (id, post_id, stripe_payment_intent_id, status, amount_pence, captured_at, term_ends_at)
values ('e5e50003-0000-0000-0000-00000000000a', 'e5e50000-0000-0000-0000-000000000003', 'pi_ex3', 'held', 20000,
        now() - interval '61 days', now() - interval '1 hour');

do $$
declare
  v_out  jsonb;
  v_item jsonb;
  v_hold record;
  v_due  record;
begin
  v_out := public.claim_reward_expiries(50);
  select e into v_item from jsonb_array_elements(v_out) e where e ->> 'post_id' = 'e5e50000-0000-0000-0000-000000000003';
  if v_item is null or v_item ->> 'path' <> 'reward_end' then
    raise exception 'CHECK 3 FAILED: the expired reward was not claimed as reward_end: %', v_out;
  end if;
  if v_item -> 'owner' ->> 'title' <> 'Your reward has ended'
     or v_item -> 'owner' ->> 'body' <> '£196.80 is going back to your card. Your listing stays up — you can add a new reward any time.' then
    raise exception 'CHECK 3 FAILED: the owner push is %', v_item -> 'owner';
  end if;
  if (v_item -> 'owner')::text like '%EX03%' then
    raise exception 'CHECK 3 FAILED: the push carries the plate';
  end if;
  if jsonb_array_length(v_item -> 'spotters') <> 0 then
    raise exception 'CHECK 3 FAILED: spotters were pushed with no sightings';
  end if;

  select exit_path, system_initiated, attested_at, expires_at, cardinality(sighting_ids) as n into v_hold
    from public.refund_holds where payment_id = 'e5e50003-0000-0000-0000-00000000000a';
  if v_hold.exit_path <> 'reward_end' or not v_hold.system_initiated or v_hold.attested_at is not null
     or v_hold.expires_at > now() or v_hold.n <> 0 then
    raise exception 'CHECK 3 FAILED: the system hold is wrong: %', v_hold;
  end if;
  if (select expiry_claimed_at from public.payments where id = 'e5e50003-0000-0000-0000-00000000000a') is null then
    raise exception 'CHECK 3 FAILED: expiry_claimed_at not stamped';
  end if;

  -- Due at once (expires_at = now(); refunds_due wants < now(), so step past it).
  update public.refund_holds set expires_at = now() - interval '1 second'
   where payment_id = 'e5e50003-0000-0000-0000-00000000000a';
  select * into v_due from public.refunds_due(50, 'e5e50000-0000-0000-0000-000000000003');
  if v_due.reason is distinct from 'reward_end' or v_due.payment_intent_id <> 'pi_ex3' then
    raise exception 'CHECK 3 FAILED: refunds_due gave %', v_due;
  end if;

  if jsonb_array_length(public.claim_reward_expiries(50)) <> 0 then
    raise exception 'CHECK 3 FAILED: a replay claimed again';
  end if;
  raise notice 'CHECK 3 passed: due now, exact owner copy, refunds_due reward_end, no replay';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 4 — a recent sighting: a 72-hour window, the spotter told (reward
-- wording), the owner told the date; not due yet. A legacy reward: in full.
-- -----------------------------------------------------------------------------
begin;
update public.payments set expiry_claimed_at = now() where status = 'held' and expiry_claimed_at is null;
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate)
values ('e5e50000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'active', 20000, 'EX04 AAA');
insert into public.payments (id, post_id, stripe_payment_intent_id, status, amount_pence, captured_at, term_ends_at, legacy_term)
values ('e5e50004-0000-0000-0000-00000000000a', 'e5e50000-0000-0000-0000-000000000004', 'pi_ex4', 'held', 20000,
        now() - interval '79 days', now() - interval '1 hour', true);
insert into public.sightings (id, post_id, spotter_id, status, area_label, location_unavailable)
values ('e5e50004-1111-0000-0000-000000000001', 'e5e50000-0000-0000-0000-000000000004',
        '33333333-3333-3333-3333-333333333333', 'unverified', 'Camden', true);

do $$
declare
  v_item jsonb;
  v_hold record;
begin
  select e into v_item from jsonb_array_elements(public.claim_reward_expiries(50)) e
   where e ->> 'post_id' = 'e5e50000-0000-0000-0000-000000000004';
  select expires_at, sighting_ids into v_hold
    from public.refund_holds where payment_id = 'e5e50004-0000-0000-0000-00000000000a';
  if v_hold.expires_at < now() + interval '71 hours' or v_hold.expires_at > now() + interval '73 hours'
     or not ('e5e50004-1111-0000-0000-000000000001'::uuid = any (v_hold.sighting_ids)) then
    raise exception 'CHECK 4 FAILED: the window is wrong: %', v_hold;
  end if;
  if jsonb_array_length(v_item -> 'spotters') <> 1
     or v_item -> 'spotters' -> 0 ->> 'body' <> 'The reward on a car you sighted is ending. If your sighting led to it being found, you have 72 hours to tell us.' then
    raise exception 'CHECK 4 FAILED: the spotter push is %', v_item -> 'spotters';
  end if;
  -- Legacy: the full £200, and the date the refund waits for.
  if v_item -> 'owner' ->> 'body' not like '£200 is going back to your card after %, unless a spotter shows their sighting found your car. Your listing stays up — you can add a new reward any time.' then
    raise exception 'CHECK 4 FAILED: the legacy owner push is %', v_item -> 'owner' ->> 'body';
  end if;
  if not (select refund_fee_absorbed from public.payments where id = 'e5e50004-0000-0000-0000-00000000000a') then
    raise exception 'CHECK 4 FAILED: a legacy reward''s refund basis was not set to in full';
  end if;
  if exists (select 1 from public.refunds_due(50, 'e5e50000-0000-0000-0000-000000000004')) then
    raise exception 'CHECK 4 FAILED: refunded inside the spotters'' window';
  end if;
  raise notice 'CHECK 4 passed: a 72-hour window, the spotter told, the owner told the date; legacy in full';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 5 — what the expiry must NOT touch: a term not yet over; a renewal in
-- flight; a credited sighting; an open dispute; an owner's pending hold; a
-- closed listing.
-- -----------------------------------------------------------------------------
begin;
update public.payments set expiry_claimed_at = now() where status = 'held' and expiry_claimed_at is null;
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate)
values ('e5e50000-0000-0000-0000-000000000051', '11111111-1111-1111-1111-111111111111', 'active',    20000, 'EX05 NOT'),
       ('e5e50000-0000-0000-0000-000000000052', '11111111-1111-1111-1111-111111111111', 'active',    20000, 'EX05 RNW'),
       ('e5e50000-0000-0000-0000-000000000053', '11111111-1111-1111-1111-111111111111', 'recovery_claimed', 20000, 'EX05 CRD'),
       ('e5e50000-0000-0000-0000-000000000054', '11111111-1111-1111-1111-111111111111', 'active',    20000, 'EX05 DSP'),
       ('e5e50000-0000-0000-0000-000000000055', '11111111-1111-1111-1111-111111111111', 'cancelled', 20000, 'EX05 HLD'),
       ('e5e50000-0000-0000-0000-000000000056', '11111111-1111-1111-1111-111111111111', 'recovered', 20000, 'EX05 DON');
insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence, captured_at, term_ends_at)
values ('e5e50000-0000-0000-0000-000000000051', 'pi_ex5_notyet', 'held', 20000, now() - interval '10 days', now() + interval '50 days'),
       ('e5e50000-0000-0000-0000-000000000052', 'pi_ex5_renew',  'held', 20000, now() - interval '61 days', now() - interval '1 hour'),
       ('e5e50000-0000-0000-0000-000000000053', 'pi_ex5_cred',   'held', 20000, now() - interval '61 days', now() - interval '1 hour'),
       ('e5e50000-0000-0000-0000-000000000054', 'pi_ex5_disp',   'held', 20000, now() - interval '61 days', now() - interval '1 hour'),
       ('e5e50000-0000-0000-0000-000000000055', 'pi_ex5_hold',   'held', 20000, now() - interval '61 days', now() - interval '1 hour'),
       ('e5e50000-0000-0000-0000-000000000056', 'pi_ex5_done',   'held', 20000, now() - interval '61 days', now() - interval '1 hour');
-- A renewal the owner is paying for right now.
insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence, renewal_attempt_id)
values ('e5e50000-0000-0000-0000-000000000052', 'pi_ex5_renew_new', 'requires_payment', 20000, gen_random_uuid());
insert into public.sightings (id, post_id, spotter_id, status, area_label, location_unavailable)
values ('e5e50005-1111-0000-0000-000000000003', 'e5e50000-0000-0000-0000-000000000053', '33333333-3333-3333-3333-333333333333', 'credited',   'Camden', true),
       ('e5e50005-1111-0000-0000-000000000004', 'e5e50000-0000-0000-0000-000000000054', '33333333-3333-3333-3333-333333333333', 'unverified', 'Camden', true),
       ('e5e50005-1111-0000-0000-000000000005', 'e5e50000-0000-0000-0000-000000000055', '33333333-3333-3333-3333-333333333333', 'unverified', 'Camden', true);
insert into public.refund_disputes (post_id, sighting_id, spotter_id)
values ('e5e50000-0000-0000-0000-000000000054', 'e5e50005-1111-0000-0000-000000000004', '33333333-3333-3333-3333-333333333333');
insert into public.refund_holds (post_id, owner_id, exit_path, sighting_ids, expires_at)
values ('e5e50000-0000-0000-0000-000000000055', '11111111-1111-1111-1111-111111111111', 'deactivate',
        array['e5e50005-1111-0000-0000-000000000005'::uuid], now() + interval '72 hours');

do $$
declare
  v_out jsonb;
begin
  v_out := public.claim_reward_expiries(50);
  if jsonb_array_length(v_out) <> 0 then
    raise exception 'CHECK 5 FAILED: the expiry claimed what it must not: %', v_out;
  end if;
  if exists (select 1 from public.payments where stripe_payment_intent_id like 'pi_ex5_%' and expiry_claimed_at is not null) then
    raise exception 'CHECK 5 FAILED: a skipped reward was stamped claimed';
  end if;
  raise notice 'CHECK 5 passed: no claim on a running term, a renewal in flight, a credit, a dispute, an owner hold or a closed listing';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 6 — the refund record keeps the listing UP as "Reward ended", the
-- claim is lifted (a reward can be added again), and the reader says so.
-- -----------------------------------------------------------------------------
begin;
update public.payments set expiry_claimed_at = now() where status = 'held' and expiry_claimed_at is null;
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate)
values ('e5e50000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'active', 20000, 'EX06 AAA');
insert into public.payments (id, post_id, stripe_payment_intent_id, status, amount_pence, captured_at, term_ends_at)
values ('e5e50006-0000-0000-0000-00000000000a', 'e5e50000-0000-0000-0000-000000000006', 'pi_ex6', 'held', 20000,
        now() - interval '61 days', now() - interval '1 hour');

do $$
declare
  v_post record;
  v_pay  record;
begin
  perform public.claim_reward_expiries(50);
  perform public.mark_reward_ended_refunded('pi_ex6', 're_ex6', 19680);

  select status, bounty_amount_pence, reward_ended_at, ended_reward_pence into v_post
    from public.posts where id = 'e5e50000-0000-0000-0000-000000000006';
  select status, refunded_amount_pence, stripe_refund_id into v_pay
    from public.payments where id = 'e5e50006-0000-0000-0000-00000000000a';
  if v_post.status <> 'active' or v_post.bounty_amount_pence is not null
     or v_post.reward_ended_at is null or v_post.ended_reward_pence <> 20000 then
    raise exception 'CHECK 6 FAILED: the listing after a lapse is %', v_post;
  end if;
  if v_pay.status <> 'refunded' or v_pay.refunded_amount_pence <> 19680 or v_pay.stripe_refund_id <> 're_ex6' then
    raise exception 'CHECK 6 FAILED: the payment after a lapse is %', v_pay;
  end if;
  if public.reward_has_claim('e5e50000-0000-0000-0000-000000000006') then
    raise exception 'CHECK 6 FAILED: a settled reward_end hold still blocks adding a reward';
  end if;
  if (select public.home_feed_post_json(p, null) -> 'reward_ended' from public.posts p
       where p.id = 'e5e50000-0000-0000-0000-000000000006') is distinct from 'true'::jsonb then
    raise exception 'CHECK 6 FAILED: readers do not see "Reward ended"';
  end if;

  -- A duplicate record is a no-op (never regresses, never re-stamps).
  perform public.mark_reward_ended_refunded('pi_ex6', 're_other', 1);
  if (select refunded_amount_pence from public.payments where id = 'e5e50006-0000-0000-0000-00000000000a') <> 19680 then
    raise exception 'CHECK 6 FAILED: a duplicate record regressed the payment';
  end if;
  raise notice 'CHECK 6 passed: the listing stays up as "Reward ended", the claim lifts, a duplicate is a no-op';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 7 — the webhook landing FIRST never cancels a lapsing listing.
-- -----------------------------------------------------------------------------
begin;
update public.payments set expiry_claimed_at = now() where status = 'held' and expiry_claimed_at is null;
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate)
values ('e5e50000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'active', 20000, 'EX07 AAA');
insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence, captured_at, term_ends_at)
values ('e5e50000-0000-0000-0000-000000000007', 'pi_ex7', 'held', 20000, now() - interval '61 days', now() - interval '1 hour');

do $$
declare
  v_result text;
begin
  perform public.claim_reward_expiries(50);
  v_result := public.reconcile_payment_refund('pi_ex7', 're_ex7', 19680);
  if v_result <> 'reward_ended'
     or (select status from public.posts where id = 'e5e50000-0000-0000-0000-000000000007') <> 'active'
     or (select reward_ended_at from public.posts where id = 'e5e50000-0000-0000-0000-000000000007') is null then
    raise exception 'CHECK 7 FAILED: the webhook gave % and the listing is %', v_result,
      (select status from public.posts where id = 'e5e50000-0000-0000-0000-000000000007');
  end if;
  raise notice 'CHECK 7 passed: a webhook landing first records "Reward ended", the listing stays up';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 8 — an owner exit DURING the window: the pre-flight still asks (even
-- for a sighting now past 14 days), the deactivate UPGRADES the system hold,
-- delists, and keeps the spotters' window.
-- -----------------------------------------------------------------------------
begin;
update public.payments set expiry_claimed_at = now() where status = 'held' and expiry_claimed_at is null;
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate)
values ('e5e50000-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111', 'active', 20000, 'EX08 AAA');
insert into public.payments (id, post_id, stripe_payment_intent_id, status, amount_pence, captured_at, term_ends_at)
values ('e5e50008-0000-0000-0000-00000000000a', 'e5e50000-0000-0000-0000-000000000008', 'pi_ex8', 'held', 20000,
        now() - interval '61 days', now() - interval '1 hour');
insert into public.sightings (id, post_id, spotter_id, status, area_label, location_unavailable)
values ('e5e50008-1111-0000-0000-000000000001', 'e5e50000-0000-0000-0000-000000000008',
        '33333333-3333-3333-3333-333333333333', 'unverified', 'Camden', true);

do $$
declare
  v_window timestamptz;
  v_check  jsonb;
  v_res    jsonb;
  v_hold   record;
begin
  perform public.claim_reward_expiries(50);
  select expires_at into v_window from public.refund_holds where payment_id = 'e5e50008-0000-0000-0000-00000000000a';

  -- The sighting ages past 14 days mid-window: it still counts.
  update public.sightings set created_at = now() - interval '15 days'
   where id = 'e5e50008-1111-0000-0000-000000000001';
  v_check := public.exit_check_for('e5e50000-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111');
  if (v_check ->> 'requiresAttestation')::boolean is not true then
    raise exception 'CHECK 8 FAILED: an exit mid-window would refund now: %', v_check;
  end if;

  v_res := public.create_refund_hold('e5e50000-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111',
                                     'deactivate', array['e5e50008-1111-0000-0000-000000000001'::uuid]);
  select exit_path, system_initiated, attested_at, expires_at into v_hold
    from public.refund_holds where payment_id = 'e5e50008-0000-0000-0000-00000000000a';
  if v_hold.exit_path <> 'deactivate' or v_hold.system_initiated or v_hold.attested_at is null
     or v_hold.expires_at <> v_window then
    raise exception 'CHECK 8 FAILED: the upgraded hold is %', v_hold;
  end if;
  if (select status from public.posts where id = 'e5e50000-0000-0000-0000-000000000008') <> 'cancelled' then
    raise exception 'CHECK 8 FAILED: the deactivate did not delist';
  end if;
  if jsonb_array_length(v_res -> 'notify') <> 0 then
    raise exception 'CHECK 8 FAILED: the spotter was told twice';
  end if;
  if (select count(*) from public.refund_holds where post_id = 'e5e50000-0000-0000-0000-000000000008') <> 1 then
    raise exception 'CHECK 8 FAILED: the exit made a second hold';
  end if;
  raise notice 'CHECK 8 passed: an owner exit mid-window upgrades the hold, delists, keeps the window';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 9 — a spotter disputes a reward_end hold; upheld on the LIVE listing
-- it goes to the payout rails; and the refund is blocked meanwhile.
-- -----------------------------------------------------------------------------
begin;
update public.payments set expiry_claimed_at = now() where status = 'held' and expiry_claimed_at is null;
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate)
values ('e5e50000-0000-0000-0000-000000000009', '11111111-1111-1111-1111-111111111111', 'active', 20000, 'EX09 AAA');
insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence, captured_at, term_ends_at)
values ('e5e50000-0000-0000-0000-000000000009', 'pi_ex9', 'held', 20000, now() - interval '61 days', now() - interval '1 hour');
insert into public.sightings (id, post_id, spotter_id, status, area_label, location_unavailable)
values ('e5e50009-1111-0000-0000-000000000001', 'e5e50000-0000-0000-0000-000000000009',
        '33333333-3333-3333-3333-333333333333', 'unverified', 'Camden', true);

do $$
declare
  v_ctx     jsonb;
  v_dispute jsonb;
  v_res     jsonb;
begin
  perform public.claim_reward_expiries(50);

  perform set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
  set local role authenticated;
  v_ctx := public.my_dispute_context('e5e50009-1111-0000-0000-000000000001');
  v_dispute := public.open_dispute('e5e50009-1111-0000-0000-000000000001', 'I saw it parked on Elm St.');
  reset role;

  if v_ctx ->> 'reason' <> 'reward_end' then
    raise exception 'CHECK 9 FAILED: the dispute screen is not told the reward is ending: %', v_ctx;
  end if;

  update public.refund_holds set expires_at = now() - interval '1 second'
   where post_id = 'e5e50000-0000-0000-0000-000000000009';
  if exists (select 1 from public.refunds_due(50, 'e5e50000-0000-0000-0000-000000000009')) then
    raise exception 'CHECK 9 FAILED: refunded over an open dispute';
  end if;

  v_res := public.resolve_sighting_dispute((v_dispute ->> 'disputeId')::uuid, true);
  if (select status from public.posts where id = 'e5e50000-0000-0000-0000-000000000009') <> 'recovery_claimed'
     or (select status from public.sightings where id = 'e5e50009-1111-0000-0000-000000000001') <> 'credited' then
    raise exception 'CHECK 9 FAILED: an upheld reward_end dispute did not credit and go to the payout rails';
  end if;
  raise notice 'CHECK 9 passed: a reward_end hold is disputable; upheld on a live listing, the spotter is credited';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 10 — a stale "found it another way" (recovery_claimed, nothing
-- credited, no hold) is finished at the end of the term as that recovery
-- refund — with no owner push.
-- -----------------------------------------------------------------------------
begin;
update public.payments set expiry_claimed_at = now() where status = 'held' and expiry_claimed_at is null;
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate)
values ('e5e50000-0000-0000-0000-000000000010', '11111111-1111-1111-1111-111111111111', 'recovery_claimed', 20000, 'EX10 AAA');
insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence, captured_at, term_ends_at)
values ('e5e50000-0000-0000-0000-000000000010', 'pi_ex10', 'held', 20000, now() - interval '61 days', now() - interval '1 hour');

do $$
declare
  v_item jsonb;
  v_due  record;
begin
  select e into v_item from jsonb_array_elements(public.claim_reward_expiries(50)) e
   where e ->> 'post_id' = 'e5e50000-0000-0000-0000-000000000010';
  if v_item ->> 'path' <> 'recovery' or v_item -> 'owner' <> 'null'::jsonb then
    raise exception 'CHECK 10 FAILED: the stale recovery claim is %', v_item;
  end if;
  update public.refund_holds set expires_at = now() - interval '1 second'
   where post_id = 'e5e50000-0000-0000-0000-000000000010';
  select * into v_due from public.refunds_due(50, 'e5e50000-0000-0000-0000-000000000010');
  if v_due.reason is distinct from 'recovery' then
    raise exception 'CHECK 10 FAILED: refunds_due gave %', v_due;
  end if;
  raise notice 'CHECK 10 passed: a stale recovery is finished as its recovery refund';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 11 — a lapsed listing can take a reward again: the ADD path captures
-- (the settled hold is history, not a claim).
-- -----------------------------------------------------------------------------
begin;
update public.payments set expiry_claimed_at = now() where status = 'held' and expiry_claimed_at is null;
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate)
values ('e5e50000-0000-0000-0000-000000000011', '11111111-1111-1111-1111-111111111111', 'active', 20000, 'EX11 AAA');
insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence, captured_at, term_ends_at)
values ('e5e50000-0000-0000-0000-000000000011', 'pi_ex11_old', 'held', 20000, now() - interval '61 days', now() - interval '1 hour');

do $$
declare
  v_attempt uuid := gen_random_uuid();
begin
  perform public.claim_reward_expiries(50);
  perform public.mark_reward_ended_refunded('pi_ex11_old', 're_ex11', 19680);

  update public.posts set renewal_amount_pence = 30000, renewal_attempt_id = v_attempt
   where id = 'e5e50000-0000-0000-0000-000000000011';
  insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence, renewal_attempt_id)
  values ('e5e50000-0000-0000-0000-000000000011', 'pi_ex11_new', 'requires_payment', 30000, v_attempt);
  perform public.mark_post_payment_held('pi_ex11_new');

  if (select status from public.payments where stripe_payment_intent_id = 'pi_ex11_new') <> 'held'
     or (select bounty_amount_pence from public.posts where id = 'e5e50000-0000-0000-0000-000000000011') <> 30000 then
    raise exception 'CHECK 11 FAILED: a lapsed listing could not take a reward again';
  end if;
  if (select public.home_feed_post_json(p, null) -> 'reward_ended' from public.posts p
       where p.id = 'e5e50000-0000-0000-0000-000000000011') is distinct from 'false'::jsonb then
    raise exception 'CHECK 11 FAILED: a reward added again still reads "Reward ended"';
  end if;
  raise notice 'CHECK 11 passed: a lapsed listing takes a reward again, and stops reading "Reward ended"';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 12 — the expiry, the record and the webhook are service-role only.
-- -----------------------------------------------------------------------------
do $$
begin
  if has_function_privilege('authenticated', 'public.claim_reward_expiries(integer)', 'execute')
     or has_function_privilege('anon', 'public.claim_reward_expiries(integer)', 'execute')
     or has_function_privilege('authenticated', 'public.mark_reward_ended_refunded(text, text, integer)', 'execute')
     or not has_function_privilege('service_role', 'public.claim_reward_expiries(integer)', 'execute') then
    raise exception 'CHECK 12 FAILED: the expiry functions'' grants are wrong';
  end if;
  raise notice 'CHECK 12 passed: the expiry is service-role only';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 13 (security review C1) — a spotter CREDITED during a reward_end
-- window keeps the money: the timer never refunds it, and the record refuses.
-- -----------------------------------------------------------------------------
begin;
update public.payments set expiry_claimed_at = now() where status = 'held' and expiry_claimed_at is null;
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate)
values ('e5e50000-0000-0000-0000-000000000013', '11111111-1111-1111-1111-111111111111', 'active', 20000, 'EX13 AAA');
insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence, captured_at, term_ends_at)
values ('e5e50000-0000-0000-0000-000000000013', 'pi_ex13', 'held', 20000, now() - interval '61 days', now() - interval '1 hour');
insert into public.sightings (id, post_id, spotter_id, status, area_label, location_unavailable)
values ('e5e50013-1111-0000-0000-000000000001', 'e5e50000-0000-0000-0000-000000000013',
        '33333333-3333-3333-3333-333333333333', 'unverified', 'Camden', true);

do $$
declare
  v_err text;
begin
  perform public.claim_reward_expiries(50);
  -- Inside the window the owner credits the finder (claim_recovery's effect).
  update public.sightings set status = 'credited' where id = 'e5e50013-1111-0000-0000-000000000001';
  update public.posts set status = 'recovery_claimed', recovered_at = now()
   where id = 'e5e50000-0000-0000-0000-000000000013';
  update public.refund_holds set expires_at = now() - interval '1 second'
   where post_id = 'e5e50000-0000-0000-0000-000000000013';

  if exists (select 1 from public.refunds_due(50, 'e5e50000-0000-0000-0000-000000000013')) then
    raise exception 'CHECK 13 FAILED: the timer would refund a credited spotter''s money';
  end if;
  begin
    perform public.mark_reward_ended_refunded('pi_ex13', 're_ex13', 19680);
    v_err := 'none';
  exception when others then v_err := sqlerrm; end;
  if v_err <> 'RECOVERY_HAS_CREDITED_SIGHTING' then
    raise exception 'CHECK 13 FAILED: the lapse record took a credited spotter''s money (%)', v_err;
  end if;
  raise notice 'CHECK 13 passed: a credit inside the window wins; the timer never refunds it';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 14 (security review C2) — waiting out the window (and the 14 days)
-- does not let an owner deactivate past an OPEN dispute.
-- -----------------------------------------------------------------------------
begin;
update public.payments set expiry_claimed_at = now() where status = 'held' and expiry_claimed_at is null;
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate)
values ('e5e50000-0000-0000-0000-000000000014', '11111111-1111-1111-1111-111111111111', 'active', 20000, 'EX14 AAA');
insert into public.payments (id, post_id, stripe_payment_intent_id, status, amount_pence, captured_at, term_ends_at)
values ('e5e50014-0000-0000-0000-00000000000a', 'e5e50000-0000-0000-0000-000000000014', 'pi_ex14', 'held', 20000,
        now() - interval '61 days', now() - interval '1 hour');
insert into public.sightings (id, post_id, spotter_id, status, area_label, location_unavailable)
values ('e5e50014-1111-0000-0000-000000000001', 'e5e50000-0000-0000-0000-000000000014',
        '33333333-3333-3333-3333-333333333333', 'unverified', 'Camden', true);

do $$
declare
  v_check jsonb;
begin
  perform public.claim_reward_expiries(50);
  perform set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
  set local role authenticated;
  perform public.open_dispute('e5e50014-1111-0000-0000-000000000001', null);
  reset role;

  -- The window closes, the dispute stays open, and the sighting ages out.
  update public.refund_holds set expires_at = now() - interval '1 day'
   where payment_id = 'e5e50014-0000-0000-0000-00000000000a';
  update public.sightings set created_at = now() - interval '20 days'
   where id = 'e5e50014-1111-0000-0000-000000000001';

  v_check := public.exit_check_for('e5e50000-0000-0000-0000-000000000014', '11111111-1111-1111-1111-111111111111');
  if (v_check ->> 'requiresAttestation')::boolean is not true then
    raise exception 'CHECK 14 FAILED: after the window an exit would refund now, past an open dispute: %', v_check;
  end if;
  perform public.create_refund_hold('e5e50000-0000-0000-0000-000000000014', '11111111-1111-1111-1111-111111111111',
                                    'deactivate', array['e5e50014-1111-0000-0000-000000000001'::uuid]);
  if exists (select 1 from public.refunds_due(50, 'e5e50000-0000-0000-0000-000000000014')) then
    raise exception 'CHECK 14 FAILED: the deactivate refunded over the open dispute';
  end if;
  raise notice 'CHECK 14 passed: an owner cannot wait out the window to refund past an open dispute';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 15 (security review M1) — the races between a lapse and an owner exit
-- never strand a listing: "found it another way" mid-window finishes as that
-- recovery; a deactivate recorded after the lapse still delists.
-- -----------------------------------------------------------------------------
begin;
update public.payments set expiry_claimed_at = now() where status = 'held' and expiry_claimed_at is null;
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate)
values ('e5e50000-0000-0000-0000-000000000151', '11111111-1111-1111-1111-111111111111', 'active', 20000, 'EX15 REC'),
       ('e5e50000-0000-0000-0000-000000000152', '11111111-1111-1111-1111-111111111111', 'active', 20000, 'EX15 DEA');
insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence, captured_at, term_ends_at)
values ('e5e50000-0000-0000-0000-000000000151', 'pi_ex15_rec', 'held', 20000, now() - interval '61 days', now() - interval '1 hour'),
       ('e5e50000-0000-0000-0000-000000000152', 'pi_ex15_dea', 'held', 20000, now() - interval '61 days', now() - interval '1 hour');

do $$
begin
  perform public.claim_reward_expiries(50);

  -- (a) The owner says "found it another way"; the lapse refund lands first.
  update public.posts set status = 'recovery_claimed', recovered_at = now()
   where id = 'e5e50000-0000-0000-0000-000000000151';
  perform public.mark_reward_ended_refunded('pi_ex15_rec', 're_ex15a', 19680);
  if (select status from public.posts where id = 'e5e50000-0000-0000-0000-000000000151') <> 'recovered_no_spotter' then
    raise exception 'CHECK 15 FAILED: a recovery mid-window was left %',
      (select status from public.posts where id = 'e5e50000-0000-0000-0000-000000000151');
  end if;

  -- (b) The lapse is recorded, then the owner's deactivate record arrives.
  perform public.mark_reward_ended_refunded('pi_ex15_dea', 're_ex15b', 19680);
  perform public.mark_post_payment_refunded('pi_ex15_dea', 're_ex15b', 19680);
  if (select status from public.posts where id = 'e5e50000-0000-0000-0000-000000000152') <> 'cancelled' then
    raise exception 'CHECK 15 FAILED: a deactivate recorded after the lapse left the listing live';
  end if;
  raise notice 'CHECK 15 passed: no race between a lapse and an owner exit strands a listing';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 16 (security review M2) — a spotter told about an EARLIER hold is told
-- again about this one: the push is their only door.
-- -----------------------------------------------------------------------------
begin;
update public.payments set expiry_claimed_at = now() where status = 'held' and expiry_claimed_at is null;
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate)
values ('e5e50000-0000-0000-0000-000000000016', '11111111-1111-1111-1111-111111111111', 'active', 20000, 'EX16 AAA');
insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence, captured_at, term_ends_at)
values ('e5e50000-0000-0000-0000-000000000016', 'pi_ex16', 'held', 20000, now() - interval '61 days', now() - interval '1 hour');
insert into public.sightings (id, post_id, spotter_id, status, area_label, location_unavailable, closed_notified_at)
values ('e5e50016-1111-0000-0000-000000000001', 'e5e50000-0000-0000-0000-000000000016',
        '33333333-3333-3333-3333-333333333333', 'unverified', 'Camden', true, now() - interval '5 days');

do $$
declare
  v_item jsonb;
begin
  select e into v_item from jsonb_array_elements(public.claim_reward_expiries(50)) e
   where e ->> 'post_id' = 'e5e50000-0000-0000-0000-000000000016';
  if jsonb_array_length(v_item -> 'spotters') <> 1 then
    raise exception 'CHECK 16 FAILED: a spotter told about an earlier hold was not told about this one';
  end if;
  raise notice 'CHECK 16 passed: the notice is per hold, not once forever';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 17 (security review M5) — a sighting reported DURING the window is
-- taken in: named, told, and given its own 72 hours.
-- -----------------------------------------------------------------------------
begin;
update public.payments set expiry_claimed_at = now() where status = 'held' and expiry_claimed_at is null;
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate)
values ('e5e50000-0000-0000-0000-000000000017', '11111111-1111-1111-1111-111111111111', 'active', 20000, 'EX17 AAA');
insert into public.payments (id, post_id, stripe_payment_intent_id, status, amount_pence, captured_at, term_ends_at)
values ('e5e50017-0000-0000-0000-00000000000a', 'e5e50000-0000-0000-0000-000000000017', 'pi_ex17', 'held', 20000,
        now() - interval '61 days', now() - interval '1 hour');
insert into public.sightings (id, post_id, spotter_id, status, area_label, location_unavailable)
values ('e5e50017-1111-0000-0000-000000000001', 'e5e50000-0000-0000-0000-000000000017',
        '33333333-3333-3333-3333-333333333333', 'unverified', 'Camden', true);

do $$
declare
  v_item jsonb;
  v_hold record;
begin
  perform public.claim_reward_expiries(50);
  update public.refund_holds set expires_at = now() + interval '10 hours'
   where payment_id = 'e5e50017-0000-0000-0000-00000000000a';

  insert into public.sightings (id, post_id, spotter_id, status, area_label, location_unavailable)
  values ('e5e50017-1111-0000-0000-000000000002', 'e5e50000-0000-0000-0000-000000000017',
          '44444444-4444-4444-4444-444444444444', 'unverified', 'Hackney', true);

  select e into v_item from jsonb_array_elements(public.claim_reward_expiries(50)) e
   where e ->> 'post_id' = 'e5e50000-0000-0000-0000-000000000017';
  select sighting_ids, expires_at into v_hold
    from public.refund_holds where payment_id = 'e5e50017-0000-0000-0000-00000000000a';
  if v_item ->> 'path' <> 'extended' or jsonb_array_length(v_item -> 'spotters') <> 1
     or v_item -> 'spotters' -> 0 ->> 'user_id' <> '44444444-4444-4444-4444-444444444444' then
    raise exception 'CHECK 17 FAILED: the new spotter was not told: %', v_item;
  end if;
  if not ('e5e50017-1111-0000-0000-000000000002'::uuid = any (v_hold.sighting_ids))
     or v_hold.expires_at < now() + interval '71 hours' then
    raise exception 'CHECK 17 FAILED: the hold did not take the new sighting in: %', v_hold;
  end if;
  raise notice 'CHECK 17 passed: a sighting inside the window gets its own 72 hours';
end $$;
rollback;

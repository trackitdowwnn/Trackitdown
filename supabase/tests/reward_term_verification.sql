-- =============================================================================
-- WHAT:  Verification for the 60-day reward term
--        (20261005140000_a_reward_has_a_term.sql): every new reward is dated,
--        strays are not; older rewards get one notice with the right date
--        (14 days' notice, never past capture + 80) and absorb the card fee;
--        the 10- and 3-day reminders fire once each; the copy names the car
--        and the date and never the plate or the amount; the new kinds are
--        valid and unmutable; the claims are service-role only.
-- WHY:   ADR-0020 — these dates are what the Terms promise and what the expiry
--        (PR5) will act on. A wrong date here is a refund on the wrong day.
-- HOW:   Self-asserting, begin…rollback per check, RAISE on failure (CI's db
--        job). Owner 11111111-…, spotter 33333333-… are seed profiles. Every
--        claim reads every payment, so each claim check first marks every
--        pre-existing row as already handled.
-- LINKS: supabase/migrations/20261005140000_a_reward_has_a_term.sql;
--        supabase/functions/release-held-refunds/index.ts (Phase 1c).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- CHECK 1 — every new reward is dated capture + 60 days; a stray is not.
-- -----------------------------------------------------------------------------
begin;
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate)
values ('99990000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'draft',     20000, 'RT01 AAA'),
       ('99990000-0000-0000-0000-000000000011', '11111111-1111-1111-1111-111111111111', 'cancelled', 20000, 'RT01 CAN');
insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence)
values ('99990000-0000-0000-0000-000000000001', 'pi_rt1_first', 'requires_payment', 20000),
       ('99990000-0000-0000-0000-000000000011', 'pi_rt1_stray', 'requires_payment', 20000);

do $$
declare
  v_first record;
  v_stray record;
begin
  perform public.mark_post_payment_held('pi_rt1_first');
  perform public.mark_post_payment_held('pi_rt1_stray');
  select status, term_ends_at, term_notice_at into v_first from public.payments where stripe_payment_intent_id = 'pi_rt1_first';
  select status, term_ends_at into v_stray from public.payments where stripe_payment_intent_id = 'pi_rt1_stray';

  if v_first.status <> 'held'
     or v_first.term_ends_at <> public.reward_term_end(now() + interval '60 days')
     or v_first.term_notice_at <> now() then
    raise exception 'CHECK 1 FAILED: a first reward is % ends % noticed %, expected held, the end of the London day 60 days on, now',
      v_first.status, v_first.term_ends_at, v_first.term_notice_at;
  end if;
  if v_stray.status <> 'superseded' or v_stray.term_ends_at is not null then
    raise exception 'CHECK 1 FAILED: a stray got a term (%)', v_stray.term_ends_at;
  end if;
  if public.reward_term_end(now()) <= now()
     or public.reward_term_end(now()) > now() + interval '1 day' then
    raise exception 'CHECK 1 FAILED: reward_term_end(now()) is %, expected later today (London midnight)', public.reward_term_end(now());
  end if;
  raise notice 'CHECK 1 passed: a new reward ends at the end of the London day 60 days after capture; a stray has no term';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 2 — a RENEWAL starts a fresh 60-day term (the old payment keeps its own).
-- -----------------------------------------------------------------------------
begin;
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate, renewal_amount_pence, renewal_attempt_id)
values ('99990000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'active', 20000, 'RT02 AAA',
        20000, '99990002-0000-0000-0000-0000000000cc');
insert into public.payments (id, post_id, stripe_payment_intent_id, status, amount_pence, captured_at, term_ends_at)
values ('99990002-0000-0000-0000-00000000000a', '99990000-0000-0000-0000-000000000002', 'pi_rt2_old', 'held', 20000,
        now() - interval '55 days', now() + interval '5 days');
insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence, replaces_payment_id, renewal_attempt_id)
values ('99990000-0000-0000-0000-000000000002', 'pi_rt2_new', 'requires_payment', 20000,
        '99990002-0000-0000-0000-00000000000a', '99990002-0000-0000-0000-0000000000cc');

do $$
begin
  perform public.mark_post_payment_held('pi_rt2_new');
  if (select term_ends_at from public.payments where stripe_payment_intent_id = 'pi_rt2_new') <> public.reward_term_end(now() + interval '60 days')
     or (select status from public.payments where stripe_payment_intent_id = 'pi_rt2_old') <> 'superseded' then
    raise exception 'CHECK 2 FAILED: a renewal did not start a fresh 60-day term';
  end if;
  raise notice 'CHECK 2 passed: renewing at the same amount starts a fresh 60-day term';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 3 — the legacy notice: a reward held before the term gets ONE date —
-- at least 14 days away, never under capture + 60, never past capture + 80 —
-- absorbs the card fee, and its owner is told the car and the date only.
-- A reward on a closed listing is not noticed.
-- -----------------------------------------------------------------------------
begin;
update public.payments set term_ends_at = now() + interval '1 year'
 where status = 'held' and kind = 'bounty_escrow' and term_ends_at is null;
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate, colour, make, model)
values ('99990000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'active',    20000, 'RT03 YNG', 'Blue',  'Ford',  'Fiesta'),
       ('99990000-0000-0000-0000-000000000013', '11111111-1111-1111-1111-111111111111', 'active',    20000, 'RT03 MID', 'Red',   'Honda', 'Jazz'),
       ('99990000-0000-0000-0000-000000000023', '11111111-1111-1111-1111-111111111111', 'active',    20000, 'RT03 OLD', 'Grey',  'Audi',  'A4'),
       ('99990000-0000-0000-0000-000000000033', '11111111-1111-1111-1111-111111111111', 'cancelled', 20000, 'RT03 CAN', 'Black', 'Kia',   'Ceed'),
       ('99990000-0000-0000-0000-000000000043', '11111111-1111-1111-1111-111111111111', 'active',    20000, 'RT03 LTE', 'White', 'Seat',  'Ibiza'),
       ('99990000-0000-0000-0000-000000000053', '11111111-1111-1111-1111-111111111111', 'recovery_claimed', 20000, 'RT03 REC', 'Green', 'Mini', 'Cooper');
insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence, captured_at)
values ('99990000-0000-0000-0000-000000000003', 'pi_rt3_young', 'held', 20000, now() - interval '10 days'),
       ('99990000-0000-0000-0000-000000000013', 'pi_rt3_mid',   'held', 20000, now() - interval '50 days'),
       ('99990000-0000-0000-0000-000000000023', 'pi_rt3_old',   'held', 20000, now() - interval '70 days'),
       ('99990000-0000-0000-0000-000000000033', 'pi_rt3_closed','held', 20000, now() - interval '70 days'),
       -- 83 days old: a late deploy. 14 days' notice is impossible; the
       -- 3-day floor would pass capture + 85, so the hard line wins.
       ('99990000-0000-0000-0000-000000000043', 'pi_rt3_late',  'held', 20000, now() - interval '83 days'),
       ('99990000-0000-0000-0000-000000000053', 'pi_rt3_rec',   'held', 20000, now() - interval '70 days');

do $$
declare
  v_rows   jsonb;
  v_again  jsonb;
  v_young  record;
  v_mid    record;
  v_old    record;
  v_late   record;
begin
  v_rows  := public.claim_reward_term_notices(200);
  v_again := public.claim_reward_term_notices(200);

  select term_ends_at, legacy_term, refund_fee_absorbed into v_young from public.payments where stripe_payment_intent_id = 'pi_rt3_young';
  select term_ends_at, legacy_term, refund_fee_absorbed into v_mid   from public.payments where stripe_payment_intent_id = 'pi_rt3_mid';
  select term_ends_at, legacy_term, refund_fee_absorbed into v_old   from public.payments where stripe_payment_intent_id = 'pi_rt3_old';
  select term_ends_at, legacy_term, refund_fee_absorbed into v_late  from public.payments where stripe_payment_intent_id = 'pi_rt3_late';

  if jsonb_array_length(v_rows) <> 4 or jsonb_array_length(v_again) <> 0 then
    raise exception 'CHECK 3 FAILED: noticed % then %, expected the four live rewards once', v_rows, v_again;
  end if;
  -- 10 days old: capture + 60 (50 days away) beats now + 14.
  if v_young.term_ends_at <> public.reward_term_end(now() - interval '10 days' + interval '60 days') then
    raise exception 'CHECK 3 FAILED: the young reward ends %', v_young.term_ends_at;
  end if;
  -- 50 days old: capture + 60 is 10 days away, so the 14-day notice wins.
  if v_mid.term_ends_at <> public.reward_term_end(now() + interval '14 days') then
    raise exception 'CHECK 3 FAILED: the 50-day-old reward ends %, expected the end of the London day 14 days on', v_mid.term_ends_at;
  end if;
  -- 70 days old: 14 days' notice would pass capture + 80 — the cap wins.
  if v_old.term_ends_at <> public.reward_term_end(now() - interval '70 days' + interval '80 days') then
    raise exception 'CHECK 3 FAILED: the 70-day-old reward ends %, expected the end of its capture + 80 day', v_old.term_ends_at;
  end if;
  -- 83 days old (a late deploy): never a date already gone, never past + 85.
  if v_late.term_ends_at <> now() - interval '83 days' + interval '85 days' or v_late.term_ends_at <= now() then
    raise exception 'CHECK 3 FAILED: the 83-day-old reward ends %, expected capture + 85 days (still ahead)', v_late.term_ends_at;
  end if;
  -- ⚠️ The legacy MARKER, not the fee flag: only the expiry reads it, so no
  -- other refund of these payments changes.
  if not (v_young.legacy_term and v_mid.legacy_term and v_old.legacy_term and v_late.legacy_term)
     or v_young.refund_fee_absorbed or v_mid.refund_fee_absorbed or v_old.refund_fee_absorbed then
    raise exception 'CHECK 3 FAILED: legacy rewards must be marked legacy_term with refund_fee_absorbed untouched';
  end if;
  if (select term_ends_at from public.payments where stripe_payment_intent_id = 'pi_rt3_closed') is not null
     or (select term_ends_at from public.payments where stripe_payment_intent_id = 'pi_rt3_rec') is not null then
    raise exception 'CHECK 3 FAILED: a reward on a cancelled or recovery_claimed listing was noticed';
  end if;
  -- Copy only (the ids are random and could contain any digits).
  if exists (select 1 from jsonb_array_elements(v_rows) e
              where (e ->> 'title') || (e ->> 'body') ~ '(RT03|£|20000|200\.00)') then
    raise exception 'CHECK 3 FAILED: the notice copy carries a plate or an amount: %', v_rows;
  end if;
  if not exists (select 1 from jsonb_array_elements(v_rows) e
                  where e ->> 'body' like '%Blue Ford Fiesta listing now ends on %'
                    and e ->> 'user_id' = '11111111-1111-1111-1111-111111111111') then
    raise exception 'CHECK 3 FAILED: the notice does not name the car and the date: %', v_rows;
  end if;
  raise notice 'CHECK 3 passed: older rewards get one dated notice (14 days, capped at + 80, floored at 3 days, never past + 85), marked legacy, car and date only';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 4 — the reminders: 10 days out once; 3 days out once (and the 10-day
-- rung is burned with it, never sent after); nothing far off, nothing within
-- a day of the notice.
-- -----------------------------------------------------------------------------
begin;
update public.payments set reminded_10d_at = now(), reminded_3d_at = now()
 where status = 'held' and kind = 'bounty_escrow';
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate, colour, make, model)
values ('99990000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'active', 20000, 'RT04 TEN', 'Blue',  'Ford',  'Fiesta'),
       ('99990000-0000-0000-0000-000000000014', '11111111-1111-1111-1111-111111111111', 'active', 20000, 'RT04 TRE', 'Red',   'Honda', 'Jazz'),
       ('99990000-0000-0000-0000-000000000024', '11111111-1111-1111-1111-111111111111', 'active', 20000, 'RT04 FAR', 'Grey',  'Audi',  'A4'),
       ('99990000-0000-0000-0000-000000000034', '11111111-1111-1111-1111-111111111111', 'active', 20000, 'RT04 NEW', 'Black', 'Kia',   'Ceed'),
       ('99990000-0000-0000-0000-000000000044', '11111111-1111-1111-1111-111111111111', 'recovery_claimed', 20000, 'RT04 REC', 'Green', 'Mini', 'Cooper');
insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence, term_ends_at, term_notice_at)
values ('99990000-0000-0000-0000-000000000004', 'pi_rt4_ten',   'held', 20000, now() + interval '8 days',  now() - interval '52 days'),
       ('99990000-0000-0000-0000-000000000014', 'pi_rt4_three', 'held', 20000, now() + interval '2 days',  now() - interval '30 days'),
       ('99990000-0000-0000-0000-000000000024', 'pi_rt4_far',   'held', 20000, now() + interval '30 days', now() - interval '30 days'),
       ('99990000-0000-0000-0000-000000000034', 'pi_rt4_new',   'held', 20000, now() + interval '5 days',  now() - interval '2 hours'),
       ('99990000-0000-0000-0000-000000000044', 'pi_rt4_rec',   'held', 20000, now() + interval '2 days',  now() - interval '30 days');

do $$
declare
  v_first  jsonb;
  v_second jsonb;
  v_ids    text[];
  v_three  record;
begin
  v_first  := public.claim_reward_reminders(200);
  v_second := public.claim_reward_reminders(200);

  select array_agg(e ->> 'post_id' order by e ->> 'post_id') into v_ids from jsonb_array_elements(v_first) e;
  if v_ids is distinct from array['99990000-0000-0000-0000-000000000004', '99990000-0000-0000-0000-000000000014'] then
    raise exception 'CHECK 4 FAILED: reminded %, expected the 8-day and the 2-day rewards only', v_ids;
  end if;
  if jsonb_array_length(v_second) <> 0 then
    raise exception 'CHECK 4 FAILED: a second run reminded again: %', v_second;
  end if;
  select reminded_10d_at, reminded_3d_at into v_three from public.payments where stripe_payment_intent_id = 'pi_rt4_three';
  if v_three.reminded_3d_at is null or v_three.reminded_10d_at is null then
    raise exception 'CHECK 4 FAILED: the 3-day reminder did not burn the 10-day rung (% / %)', v_three.reminded_10d_at, v_three.reminded_3d_at;
  end if;
  if exists (select 1 from jsonb_array_elements(v_first) e
              where (e ->> 'title') || (e ->> 'body') ~ '(RT04|£|20000)') then
    raise exception 'CHECK 4 FAILED: reminder copy carries a plate or an amount: %', v_first;
  end if;
  if not exists (select 1 from jsonb_array_elements(v_first) e
                  where e ->> 'title' like 'Your Blue Ford Fiesta reward ends on %') then
    raise exception 'CHECK 4 FAILED: the reminder does not name the car and the date: %', v_first;
  end if;
  raise notice 'CHECK 4 passed: 10-day and 3-day reminders fire once each, with the car and the date only';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 5 — the 10-day reward, once inside 3 days, gets its 3-day reminder.
-- -----------------------------------------------------------------------------
begin;
update public.payments set reminded_10d_at = now(), reminded_3d_at = now()
 where status = 'held' and kind = 'bounty_escrow';
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate)
values ('99990000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'active', 20000, 'RT05 AAA');
insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence, term_ends_at, term_notice_at, reminded_10d_at)
values ('99990000-0000-0000-0000-000000000005', 'pi_rt5', 'held', 20000, now() + interval '2 days',
        now() - interval '58 days', now() - interval '7 days');

do $$
declare
  v_rows jsonb;
begin
  -- Claim FIRST, check after: a subquery in the same statement as the claim
  -- reads the statement's starting snapshot and would never see its update.
  v_rows := public.claim_reward_reminders(200);
  if jsonb_array_length(v_rows) <> 1
     or (select reminded_3d_at from public.payments where stripe_payment_intent_id = 'pi_rt5') is null then
    raise exception 'CHECK 5 FAILED: a reward reminded at 10 days was not reminded again at 3';
  end if;
  raise notice 'CHECK 5 passed: the 3-day reminder follows the 10-day one';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 6 — the owner's status read carries the term.
-- -----------------------------------------------------------------------------
begin;
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate)
values ('99990000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'active', 20000, 'RT06 AAA');
insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence, term_ends_at, legacy_term)
values ('99990000-0000-0000-0000-000000000006', 'pi_rt6', 'held', 20000, '2026-12-12T12:00:00Z', true);

do $$
declare
  v_doc jsonb;
begin
  perform set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
  set local role authenticated;
  v_doc := public.get_my_reward_status('99990000-0000-0000-0000-000000000006');
  reset role;
  if (v_doc ->> 'termEndsAt')::timestamptz <> '2026-12-12T12:00:00Z'::timestamptz
     or (v_doc ->> 'legacyTerm')::boolean is distinct from true then
    raise exception 'CHECK 6 FAILED: the owner''s status carries term %', v_doc ->> 'termEndsAt';
  end if;
  raise notice 'CHECK 6 passed: the owner''s reward status carries the term';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 7 — the new kinds are valid in both tables and unmutable; the claims
-- are service-role only.
-- -----------------------------------------------------------------------------
begin;
do $$
declare
  f text;
begin
  insert into public.notifications (user_id, kind, title, body, payload)
  values ('11111111-1111-1111-1111-111111111111', 'reward_ending', 't', 'b', '{}'::jsonb),
         ('11111111-1111-1111-1111-111111111111', 'reward_ended',  't', 'b', '{}'::jsonb);
  if public.notification_category('reward_ending') is not null or public.notification_category('reward_ended') is not null then
    raise exception 'CHECK 7 FAILED: a reward-term kind is mutable';
  end if;
  foreach f in array array['public.claim_reward_term_notices(integer)', 'public.claim_reward_reminders(integer)'] loop
    if has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute')
       or not has_function_privilege('service_role', f, 'execute') then
      raise exception 'CHECK 7 FAILED: % has the wrong grants', f;
    end if;
  end loop;
  raise notice 'CHECK 7 passed: reward_ending / reward_ended are valid and unmutable; the claims are service-role only';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 8 — adding a reward to a £5 fee listing dates it like any other.
-- -----------------------------------------------------------------------------
begin;
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate, renewal_amount_pence, renewal_attempt_id)
values ('99990000-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111', 'active', null, 'RT08 AAA',
        15000, '99990008-0000-0000-0000-0000000000cc');
insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence, renewal_attempt_id)
values ('99990000-0000-0000-0000-000000000008', 'pi_rt8_add', 'requires_payment', 15000, '99990008-0000-0000-0000-0000000000cc');

do $$
begin
  perform public.mark_post_payment_held('pi_rt8_add');
  if (select status from public.payments where stripe_payment_intent_id = 'pi_rt8_add') <> 'held'
     or (select term_ends_at from public.payments where stripe_payment_intent_id = 'pi_rt8_add')
          <> public.reward_term_end(now() + interval '60 days') then
    raise exception 'CHECK 8 FAILED: an added reward was not dated';
  end if;
  raise notice 'CHECK 8 passed: an added reward gets the same 60-day term';
end $$;
rollback;

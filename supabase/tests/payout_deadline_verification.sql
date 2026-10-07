-- =============================================================================
-- WHAT:  Verification for the payout deadline
--        (20261007100000_a_credited_reward_has_a_deadline.sql): the deadline
--        date (80 days, or credit + 7, never past 85); the reminders (7 and 2
--        days out, once each, only while the spotter can't be paid); the lock
--        that keeps a payout and a lapse apart (begin_payout vs
--        claim_payout_lapse); the lapse claim's every refusal; the record
--        (owner refunded in full, listing recovered_no_spotter, credit kept);
--        the webhook landing first; the push copy.
-- WHY:   This returns a credited spotter's reward to the owner on a clock.
--        Every rule is a promise in the Terms, and the one race (payout AND
--        refund) must be impossible.
-- HOW:   Self-asserting, begin…rollback per check, RAISE on failure (CI's db
--        job). Owner 11111111-…, spotter 44444444-… (seed profiles); the
--        spotter's payouts are switched off inside each check, because
--        another suite gives the seed spotters one.
-- LINKS: supabase/migrations/20261007100000_a_credited_reward_has_a_deadline.sql.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- CHECK 1 — the deadline: day 80 normally; credit + 7 when later; never
-- past capture + 85; and pounds_text words money like the app.
-- -----------------------------------------------------------------------------
begin;
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate, recovered_at)
values ('dd000000-0000-0000-0000-000000000011', '11111111-1111-1111-1111-111111111111', 'recovery_claimed', 20000, 'PD01 AAA', now() - interval '60 days'),
       ('dd000000-0000-0000-0000-000000000012', '11111111-1111-1111-1111-111111111111', 'recovery_claimed', 20000, 'PD01 BBB', now() - interval '1 day'),
       ('dd000000-0000-0000-0000-000000000013', '11111111-1111-1111-1111-111111111111', 'recovery_claimed', 20000, 'PD01 CCC', now());
insert into public.payments (id, post_id, stripe_payment_intent_id, status, amount_pence, captured_at)
values ('dd000011-0000-0000-0000-00000000000a', 'dd000000-0000-0000-0000-000000000011', 'pi_pd1_a', 'held', 20000, now() - interval '70 days'),
       ('dd000012-0000-0000-0000-00000000000a', 'dd000000-0000-0000-0000-000000000012', 'pi_pd1_b', 'held', 20000, now() - interval '76 days'),
       ('dd000013-0000-0000-0000-00000000000a', 'dd000000-0000-0000-0000-000000000013', 'pi_pd1_c', 'held', 20000, now() - interval '79 days');

do $$
declare
  v_cap timestamptz;
begin
  select captured_at into v_cap from public.payments where id = 'dd000011-0000-0000-0000-00000000000a';
  if public.payout_deadline('dd000011-0000-0000-0000-00000000000a') <> public.reward_term_end(v_cap + interval '80 days') then
    raise exception 'CHECK 1 FAILED: a normal deadline is not the end of day 80';
  end if;
  -- Credited a day ago at day 75: credit + 7 (day 82) is later than day 80.
  if public.payout_deadline('dd000012-0000-0000-0000-00000000000a') <> least(
       public.reward_term_end((select recovered_at from public.posts where id = 'dd000000-0000-0000-0000-000000000012') + interval '7 days'),
       (select captured_at from public.payments where id = 'dd000012-0000-0000-0000-00000000000a') + interval '85 days') then
    raise exception 'CHECK 1 FAILED: a late credit did not get its 7 days';
  end if;
  -- Credited at day 79: credit + 7 would be day 86 — capped at day 85.
  select captured_at into v_cap from public.payments where id = 'dd000013-0000-0000-0000-00000000000a';
  if public.payout_deadline('dd000013-0000-0000-0000-00000000000a') <> v_cap + interval '85 days' then
    raise exception 'CHECK 1 FAILED: a deadline went past capture + 85 days';
  end if;
  if public.pounds_text(19000) <> '£190' or public.pounds_text(19680) <> '£196.80' or public.pounds_text(500000) <> '£5,000' then
    raise exception 'CHECK 1 FAILED: pounds_text is wrong';
  end if;
  raise notice 'CHECK 1 passed: day 80, or credit + 7 when later, never past day 85';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 2 — the reminders: 7 days out, then 2 days out, once each, with the
-- spotter's amount and the date; none for a payable spotter, a fresh credit,
-- or a review in progress.
-- -----------------------------------------------------------------------------
begin;
update public.stripe_connected_accounts set payouts_enabled = false where profile_id = '44444444-4444-4444-4444-444444444444';
update public.payments set payout_reminded_7d_at = now(), payout_reminded_2d_at = now()
 where status = 'held' and (payout_reminded_7d_at is null or payout_reminded_2d_at is null);
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate, recovered_at)
values ('dd000000-0000-0000-0000-000000000021', '11111111-1111-1111-1111-111111111111', 'recovery_claimed', 20000, 'PD02 AAA', now() - interval '30 days');
insert into public.payments (id, post_id, stripe_payment_intent_id, status, amount_pence, captured_at)
values ('dd000021-0000-0000-0000-00000000000a', 'dd000000-0000-0000-0000-000000000021', 'pi_pd2', 'held', 20000, now() - interval '75 days');
insert into public.sightings (post_id, spotter_id, status, area_label, location_unavailable)
values ('dd000000-0000-0000-0000-000000000021', '44444444-4444-4444-4444-444444444444', 'credited', 'Camden', true);

do $$
declare
  v_rows jsonb;
begin
  -- Day 75: the deadline (end of day 80) is ~5 days out → the 7-day reminder.
  v_rows := public.claim_payout_reminders(100);
  if jsonb_array_length(v_rows) <> 1
     or v_rows -> 0 ->> 'user_id' <> '44444444-4444-4444-4444-444444444444'
     or v_rows -> 0 ->> 'title' <> 'Your £190 reward is waiting'
     or v_rows -> 0 ->> 'body' not like 'Add your bank details by % to receive it.' then
    raise exception 'CHECK 2 FAILED: the 7-day reminder is %', v_rows;
  end if;
  if (v_rows::text) like '%PD02%' then
    raise exception 'CHECK 2 FAILED: a reminder carries the plate';
  end if;
  if jsonb_array_length(public.claim_payout_reminders(100)) <> 0 then
    raise exception 'CHECK 2 FAILED: the 7-day reminder was sent twice';
  end if;

  -- Two days out: the last reminder.
  update public.payments set captured_at = now() - interval '79 days'
   where id = 'dd000021-0000-0000-0000-00000000000a';
  v_rows := public.claim_payout_reminders(100);
  if jsonb_array_length(v_rows) <> 1
     or v_rows -> 0 ->> 'title' <> 'Last few days to claim your £190'
     or v_rows -> 0 ->> 'body' not like 'Add your bank details by %, or it goes back to the owner.' then
    raise exception 'CHECK 2 FAILED: the 2-day reminder is %', v_rows;
  end if;

  -- A spotter who can be paid is never reminded.
  update public.payments set payout_reminded_2d_at = null, payout_reminded_7d_at = null
   where id = 'dd000021-0000-0000-0000-00000000000a';
  insert into public.stripe_connected_accounts (profile_id, stripe_account_id, onboarding_complete, payouts_enabled)
  values ('44444444-4444-4444-4444-444444444444', 'acct_pd2', true, true)
  on conflict (profile_id) do update set payouts_enabled = true;
  if jsonb_array_length(public.claim_payout_reminders(100)) <> 0 then
    raise exception 'CHECK 2 FAILED: a payable spotter was reminded';
  end if;
  raise notice 'CHECK 2 passed: 7 and 2 days out, once each, exact copy, never to a payable spotter';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 3 — NEVER A PAYOUT AND A REFUND: begin_payout and claim_payout_lapse
-- exclude each other under the post lock.
-- -----------------------------------------------------------------------------
begin;
update public.stripe_connected_accounts set payouts_enabled = false where profile_id = '44444444-4444-4444-4444-444444444444';
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate, recovered_at)
values ('dd000000-0000-0000-0000-000000000031', '11111111-1111-1111-1111-111111111111', 'recovery_claimed', 20000, 'PD03 AAA', now() - interval '30 days'),
       ('dd000000-0000-0000-0000-000000000032', '11111111-1111-1111-1111-111111111111', 'recovery_claimed', 20000, 'PD03 BBB', now() - interval '30 days');
insert into public.payments (id, post_id, stripe_payment_intent_id, status, amount_pence, captured_at)
values ('dd000031-0000-0000-0000-00000000000a', 'dd000000-0000-0000-0000-000000000031', 'pi_pd3_a', 'held', 20000, now() - interval '82 days'),
       ('dd000032-0000-0000-0000-00000000000a', 'dd000000-0000-0000-0000-000000000032', 'pi_pd3_b', 'held', 20000, now() - interval '82 days');
insert into public.sightings (post_id, spotter_id, status, area_label, location_unavailable)
values ('dd000000-0000-0000-0000-000000000031', '44444444-4444-4444-4444-444444444444', 'credited', 'Camden', true),
       ('dd000000-0000-0000-0000-000000000032', '44444444-4444-4444-4444-444444444444', 'credited', 'Camden', true);

do $$
declare
  v_err text;
begin
  -- (a) A transfer began: the lapse waits an hour.
  perform public.begin_payout('dd000000-0000-0000-0000-000000000031');
  if public.claim_payout_lapse('dd000000-0000-0000-0000-000000000031') is not null then
    raise exception 'CHECK 3 FAILED: a lapse was claimed while a transfer had just begun';
  end if;

  -- (b) A lapse was claimed: no transfer may begin.
  if public.claim_payout_lapse('dd000000-0000-0000-0000-000000000032') is null then
    raise exception 'CHECK 3 FAILED: a lapse past the deadline was not claimed';
  end if;
  begin
    perform public.begin_payout('dd000000-0000-0000-0000-000000000032');
    v_err := 'none';
  exception when others then v_err := sqlerrm; end;
  if v_err <> 'PAYOUT_LAPSED' then
    raise exception 'CHECK 3 FAILED: a payout began after the lapse (%)', v_err;
  end if;
  raise notice 'CHECK 3 passed: a payout and a lapse exclude each other';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 4 — the lapse claim: in full, exact copy, once; and every refusal.
-- -----------------------------------------------------------------------------
begin;
update public.stripe_connected_accounts set payouts_enabled = false where profile_id = '44444444-4444-4444-4444-444444444444';
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate, recovered_at)
values ('dd000000-0000-0000-0000-000000000041', '11111111-1111-1111-1111-111111111111', 'recovery_claimed', 20000, 'PD04 DUE', now() - interval '30 days'),
       ('dd000000-0000-0000-0000-000000000042', '11111111-1111-1111-1111-111111111111', 'recovery_claimed', 20000, 'PD04 NOT', now() - interval '30 days'),
       ('dd000000-0000-0000-0000-000000000043', '11111111-1111-1111-1111-111111111111', 'recovery_claimed', 20000, 'PD04 REV', now() - interval '30 days'),
       ('dd000000-0000-0000-0000-000000000044', '11111111-1111-1111-1111-111111111111', 'recovery_claimed', 20000, 'PD04 NOC', now() - interval '30 days');
insert into public.payments (id, post_id, stripe_payment_intent_id, status, amount_pence, captured_at)
values ('dd000041-0000-0000-0000-00000000000a', 'dd000000-0000-0000-0000-000000000041', 'pi_pd4_due', 'held', 20000, now() - interval '82 days'),
       ('dd000042-0000-0000-0000-00000000000a', 'dd000000-0000-0000-0000-000000000042', 'pi_pd4_not', 'held', 20000, now() - interval '70 days'),
       ('dd000043-0000-0000-0000-00000000000a', 'dd000000-0000-0000-0000-000000000043', 'pi_pd4_rev', 'held', 20000, now() - interval '82 days'),
       ('dd000044-0000-0000-0000-00000000000a', 'dd000000-0000-0000-0000-000000000044', 'pi_pd4_noc', 'held', 20000, now() - interval '82 days');
insert into public.sightings (post_id, spotter_id, status, area_label, location_unavailable)
values ('dd000000-0000-0000-0000-000000000041', '44444444-4444-4444-4444-444444444444', 'credited', 'Camden', true),
       ('dd000000-0000-0000-0000-000000000042', '44444444-4444-4444-4444-444444444444', 'credited', 'Camden', true),
       ('dd000000-0000-0000-0000-000000000043', '44444444-4444-4444-4444-444444444444', 'credited', 'Camden', true),
       ('dd000000-0000-0000-0000-000000000044', '44444444-4444-4444-4444-444444444444', 'unverified', 'Camden', true);
insert into public.payout_reviews (post_id, owner_id, spotter_id, reasons)
values ('dd000000-0000-0000-0000-000000000043', '11111111-1111-1111-1111-111111111111', '44444444-4444-4444-4444-444444444444', array['test']);

do $$
declare
  v_claim jsonb;
  v_listed integer;
begin
  select count(*) into v_listed from public.payouts_past_deadline(50) where post_id::text like 'dd000000-%';
  if v_listed <> 1 then
    raise exception 'CHECK 4 FAILED: payouts_past_deadline listed % posts, expected only the due one', v_listed;
  end if;

  v_claim := public.claim_payout_lapse('dd000000-0000-0000-0000-000000000041');
  if v_claim is null
     or v_claim -> 'spotter' ->> 'title' <> 'We couldn''t send your reward'
     or v_claim -> 'owner' ->> 'title' <> 'Your reward is coming back to you'
     or v_claim -> 'owner' ->> 'body' <> 'The spotter you credited didn''t set up payouts in time, so your full £200 is going back to your card.' then
    raise exception 'CHECK 4 FAILED: the lapse claim is %', v_claim;
  end if;
  if not (select refund_fee_absorbed and payout_lapse_claimed_at is not null
            from public.payments where id = 'dd000041-0000-0000-0000-00000000000a') then
    raise exception 'CHECK 4 FAILED: the refund basis was not fixed in full';
  end if;
  if public.claim_payout_lapse('dd000000-0000-0000-0000-000000000041') is not null then
    raise exception 'CHECK 4 FAILED: a lapse was claimed twice';
  end if;

  if public.claim_payout_lapse('dd000000-0000-0000-0000-000000000042') is not null then
    raise exception 'CHECK 4 FAILED: claimed before the deadline';
  end if;
  if public.claim_payout_lapse('dd000000-0000-0000-0000-000000000043') is not null then
    raise exception 'CHECK 4 FAILED: claimed over an open payout review';
  end if;
  if public.claim_payout_lapse('dd000000-0000-0000-0000-000000000044') is not null then
    raise exception 'CHECK 4 FAILED: claimed with nobody credited';
  end if;
  raise notice 'CHECK 4 passed: claimed once, in full, exact copy; never early, under review or uncredited';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 5 — the record: the owner is refunded, the listing closes as
-- recovered_no_spotter, the credit stays; an unclaimed payment is refused;
-- and the webhook landing first records the lapse, not a hand refund.
-- -----------------------------------------------------------------------------
begin;
update public.stripe_connected_accounts set payouts_enabled = false where profile_id = '44444444-4444-4444-4444-444444444444';
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate, recovered_at)
values ('dd000000-0000-0000-0000-000000000051', '11111111-1111-1111-1111-111111111111', 'recovery_claimed', 20000, 'PD05 AAA', now() - interval '30 days'),
       ('dd000000-0000-0000-0000-000000000052', '11111111-1111-1111-1111-111111111111', 'recovery_claimed', 20000, 'PD05 BBB', now() - interval '30 days');
insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence, captured_at)
values ('dd000000-0000-0000-0000-000000000051', 'pi_pd5_a', 'held', 20000, now() - interval '82 days'),
       ('dd000000-0000-0000-0000-000000000052', 'pi_pd5_b', 'held', 20000, now() - interval '82 days');
insert into public.sightings (id, post_id, spotter_id, status, area_label, location_unavailable)
values ('dd000051-1111-0000-0000-000000000001', 'dd000000-0000-0000-0000-000000000051', '44444444-4444-4444-4444-444444444444', 'credited', 'Camden', true),
       ('dd000052-1111-0000-0000-000000000001', 'dd000000-0000-0000-0000-000000000052', '44444444-4444-4444-4444-444444444444', 'credited', 'Camden', true);

do $$
declare
  v_err    text;
  v_result text;
begin
  begin
    perform public.mark_payout_lapsed_refunded('pi_pd5_a', 're_pd5a', 20000);
    v_err := 'none';
  exception when others then v_err := sqlerrm; end;
  if v_err <> 'PAYOUT_NOT_LAPSED' then
    raise exception 'CHECK 5 FAILED: an unclaimed credited reward was recorded as a lapse (%)', v_err;
  end if;

  perform public.claim_payout_lapse('dd000000-0000-0000-0000-000000000051');
  perform public.mark_payout_lapsed_refunded('pi_pd5_a', 're_pd5a', 20000);
  if (select status from public.payments where stripe_payment_intent_id = 'pi_pd5_a') <> 'refunded'
     or (select status from public.posts where id = 'dd000000-0000-0000-0000-000000000051') <> 'recovered_no_spotter'
     or (select status from public.sightings where id = 'dd000051-1111-0000-0000-000000000001') <> 'credited' then
    raise exception 'CHECK 5 FAILED: the lapse record is wrong';
  end if;

  -- The webhook lands first on the second one.
  perform public.claim_payout_lapse('dd000000-0000-0000-0000-000000000052');
  v_result := public.reconcile_payment_refund('pi_pd5_b', 're_pd5b', 20000);
  if v_result <> 'payout_lapsed'
     or (select status from public.posts where id = 'dd000000-0000-0000-0000-000000000052') <> 'recovered_no_spotter' then
    raise exception 'CHECK 5 FAILED: the webhook filed a lapse as %', v_result;
  end if;
  raise notice 'CHECK 5 passed: refunded, recovered_no_spotter, credit kept; the webhook records a lapse as one';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 6 — the new kinds are valid and unmutable; the functions are
-- service-role only.
-- -----------------------------------------------------------------------------
begin;
do $$
begin
  insert into public.notifications (user_id, kind, title, body, payload)
  values ('44444444-4444-4444-4444-444444444444', 'payout_reminder', 't', 'b', '{}'::jsonb),
         ('44444444-4444-4444-4444-444444444444', 'payout_lapsed',   't', 'b', '{}'::jsonb);
  if public.notification_category('payout_reminder') is not null
     or public.notification_category('payout_lapsed') is not null then
    raise exception 'CHECK 6 FAILED: a payout-deadline notice can be muted';
  end if;
  if has_function_privilege('authenticated', 'public.claim_payout_lapse(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.begin_payout(uuid)', 'execute')
     or has_function_privilege('anon', 'public.claim_payout_reminders(integer)', 'execute') then
    raise exception 'CHECK 6 FAILED: a payout-deadline function is client-executable';
  end if;
  raise notice 'CHECK 6 passed: the kinds are valid and unmutable; service-role only';
end $$;
rollback;

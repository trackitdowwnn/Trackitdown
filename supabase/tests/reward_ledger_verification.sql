-- =============================================================================
-- WHAT:  Verification for the reward-ledger groundwork
--        (20261005110000_a_reward_can_be_replaced.sql): the one-held rule,
--        renewal and stray captures, the refund reconcile, refunds_due, the
--        75-day ops alert claim, and superseded money blocking a delete.
-- WHY:   Tier 1 money paths (docs/TESTING.md). Stripe caps platform-balance
--        holds at 90 days, so rewards are about to be renewed and expired on a
--        timer — every decision about WHICH payment is the reward, and which
--        refund may close a post, is made in these functions. Nothing tests the
--        Edge Functions, so this file is where those decisions are pinned.
-- HOW:   Self-asserting. Each check seeds inside begin…rollback and RAISES on
--        failure, so psql -v ON_ERROR_STOP=1 exits non-zero (CI's db job:
--        scripts/test-db.sh). Fixture owner 11111111-… and spotter 33333333-…
--        are seed profiles; every post here is seeded by the check that uses it.
-- LINKS: supabase/migrations/20261005110000_a_reward_can_be_replaced.sql;
--        supabase/functions/_shared/refundEscrow.ts;
--        supabase/functions/release-held-refunds/index.ts (Phase 1, 1b);
--        supabase/functions/stripe-webhook/index.ts (charge.refunded).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- CHECK 1 — at most one held payment per post: a second held row is refused.
-- -----------------------------------------------------------------------------
begin;
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate)
values ('eeee0000-0000-0000-0000-000000000001',
        '11111111-1111-1111-1111-111111111111', 'active', 20000, 'RL01 AAA');
insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence)
values ('eeee0000-0000-0000-0000-000000000001', 'pi_rl1_a', 'held', 20000);

do $$
begin
  begin
    insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence)
    values ('eeee0000-0000-0000-0000-000000000001', 'pi_rl1_b', 'held', 20000);
  exception when unique_violation then
    raise notice 'CHECK 1 passed: a second held payment on one post is refused by payments_one_held_per_post_uidx';
    return;
  end;
  raise exception 'CHECK 1 FAILED: a post accepted two held payments — refunds and payouts would read either one';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 2 — a listing fee can never be superseded (it would become refundable).
-- -----------------------------------------------------------------------------
begin;
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate)
values ('eeee0000-0000-0000-0000-000000000002',
        '11111111-1111-1111-1111-111111111111', 'active', null, 'RL02 AAA');

do $$
begin
  begin
    insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence, kind, superseded_at)
    values ('eeee0000-0000-0000-0000-000000000002', 'pi_rl2_fee', 'superseded', 500, 'listing_fee', now());
  exception when check_violation then
    raise notice 'CHECK 2 passed: a listing fee cannot be superseded (payments_superseded_is_bounty_chk)';
    return;
  end;
  raise exception 'CHECK 2 FAILED: a listing fee reached superseded — the sweep would refund a non-refundable fee';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 3 — RENEWAL: a capture that names the post's held payment replaces it
-- in one transaction (old superseded, new held, post offers the new amount,
-- post stays live). A redelivery changes nothing.
-- -----------------------------------------------------------------------------
begin;
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate)
values ('eeee0000-0000-0000-0000-000000000003',
        '11111111-1111-1111-1111-111111111111', 'active', 20000, 'RL03 AAA');
insert into public.payments (id, post_id, stripe_payment_intent_id, status, amount_pence, captured_at)
values ('eeee0003-0000-0000-0000-00000000000a', 'eeee0000-0000-0000-0000-000000000003',
        'pi_rl3_old', 'held', 20000, now() - interval '50 days');
insert into public.payments (id, post_id, stripe_payment_intent_id, status, amount_pence, replaces_payment_id)
values ('eeee0003-0000-0000-0000-00000000000b', 'eeee0000-0000-0000-0000-000000000003',
        'pi_rl3_new', 'requires_payment', 35000, 'eeee0003-0000-0000-0000-00000000000a');

do $$
declare
  v_old  record;
  v_new  record;
  v_post record;
begin
  perform public.mark_post_payment_held('pi_rl3_new');
  perform public.mark_post_payment_held('pi_rl3_new');  -- redelivery

  select status, superseded_at, superseded_by_payment_id, refund_fee_absorbed into v_old
    from public.payments where stripe_payment_intent_id = 'pi_rl3_old';
  select status, captured_at into v_new
    from public.payments where stripe_payment_intent_id = 'pi_rl3_new';
  select status, bounty_amount_pence into v_post
    from public.posts where id = 'eeee0000-0000-0000-0000-000000000003';

  if v_old.status <> 'superseded' or v_old.superseded_at is null
     or v_old.superseded_by_payment_id <> 'eeee0003-0000-0000-0000-00000000000b' then
    raise exception 'CHECK 3 FAILED: the old reward is % (superseded_by %), expected superseded by the renewal',
      v_old.status, v_old.superseded_by_payment_id;
  end if;
  if v_old.refund_fee_absorbed then
    raise exception 'CHECK 3 FAILED: a renewal absorbed the card fee — the owner chose this, so they bear it';
  end if;
  if v_new.status <> 'held' or v_new.captured_at is null then
    raise exception 'CHECK 3 FAILED: the renewal is % (captured_at %), expected held with a capture time',
      v_new.status, v_new.captured_at;
  end if;
  if v_post.status <> 'active' or v_post.bounty_amount_pence <> 35000 then
    raise exception 'CHECK 3 FAILED: the post is % offering %, expected active offering the renewed 35000',
      v_post.status, v_post.bounty_amount_pence;
  end if;
  raise notice 'CHECK 3 passed: a renewal supersedes the old reward atomically, the post offers the new amount, and a redelivery is a no-op';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 4 — STRAY on a live reward: a capture that does NOT name the held
-- payment becomes superseded with the fee absorbed; the reward is untouched.
-- -----------------------------------------------------------------------------
begin;
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate)
values ('eeee0000-0000-0000-0000-000000000004',
        '11111111-1111-1111-1111-111111111111', 'active', 20000, 'RL04 AAA');
insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence)
values ('eeee0000-0000-0000-0000-000000000004', 'pi_rl4_reward', 'held', 20000),
       ('eeee0000-0000-0000-0000-000000000004', 'pi_rl4_stray', 'failed', 15000);

do $$
declare
  v_reward record;
  v_stray  record;
  v_bounty integer;
begin
  perform public.mark_post_payment_held('pi_rl4_stray');

  select status into v_reward from public.payments where stripe_payment_intent_id = 'pi_rl4_reward';
  select status, refund_fee_absorbed, captured_at into v_stray
    from public.payments where stripe_payment_intent_id = 'pi_rl4_stray';
  select bounty_amount_pence into v_bounty from public.posts where id = 'eeee0000-0000-0000-0000-000000000004';

  if v_reward.status <> 'held' then
    raise exception 'CHECK 4 FAILED: a stray capture displaced the live reward (now %)', v_reward.status;
  end if;
  if v_stray.status <> 'superseded' or not v_stray.refund_fee_absorbed or v_stray.captured_at is null then
    raise exception 'CHECK 4 FAILED: the stray is % (absorbed %), expected superseded with the fee absorbed',
      v_stray.status, v_stray.refund_fee_absorbed;
  end if;
  if v_bounty <> 20000 then
    raise exception 'CHECK 4 FAILED: a stray changed the listing''s reward to %', v_bounty;
  end if;
  raise notice 'CHECK 4 passed: a stray capture on a live reward is superseded, fee absorbed, reward untouched';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 5 — STRAY on a closed post: a capture landing on a cancelled post with
-- nothing held is superseded (refunded in full), never held, and the post
-- stays cancelled.
-- -----------------------------------------------------------------------------
begin;
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate)
values ('eeee0000-0000-0000-0000-000000000005',
        '11111111-1111-1111-1111-111111111111', 'cancelled', 20000, 'RL05 AAA');
insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence)
values ('eeee0000-0000-0000-0000-000000000005', 'pi_rl5_late', 'requires_payment', 20000);

do $$
declare
  v_pay  record;
  v_post public.post_status;
begin
  perform public.mark_post_payment_held('pi_rl5_late');
  select status, refund_fee_absorbed into v_pay from public.payments where stripe_payment_intent_id = 'pi_rl5_late';
  select status into v_post from public.posts where id = 'eeee0000-0000-0000-0000-000000000005';

  if v_pay.status <> 'superseded' or not v_pay.refund_fee_absorbed then
    raise exception 'CHECK 5 FAILED: a late capture on a cancelled post is % (absorbed %), expected superseded + absorbed',
      v_pay.status, v_pay.refund_fee_absorbed;
  end if;
  if v_post <> 'cancelled' then
    raise exception 'CHECK 5 FAILED: a late capture moved a cancelled post to %', v_post;
  end if;
  raise notice 'CHECK 5 passed: a capture on a closed post is superseded and refunded in full, the post stays closed';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 6 — the unchanged paths stamp the capture time: a draft bounty goes
-- held + post active; a fee goes collected + post active.
-- -----------------------------------------------------------------------------
begin;
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate)
values ('eeee0000-0000-0000-0000-000000000006',
        '11111111-1111-1111-1111-111111111111', 'draft', 20000, 'RL06 AAA'),
       ('eeee0000-0000-0000-0000-000000000016',
        '11111111-1111-1111-1111-111111111111', 'draft', null, 'RL06 FEE');
insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence, kind)
values ('eeee0000-0000-0000-0000-000000000006', 'pi_rl6_bounty', 'requires_payment', 20000, 'bounty_escrow'),
       ('eeee0000-0000-0000-0000-000000000016', 'pi_rl6_fee', 'requires_payment', 500, 'listing_fee');

do $$
declare
  v_bounty record;
  v_fee    record;
begin
  perform public.mark_post_payment_held('pi_rl6_bounty');
  perform public.mark_post_payment_held('pi_rl6_fee');

  select pay.status, pay.captured_at, po.status as post_status into v_bounty
    from public.payments pay join public.posts po on po.id = pay.post_id
   where pay.stripe_payment_intent_id = 'pi_rl6_bounty';
  select pay.status, pay.captured_at, po.status as post_status into v_fee
    from public.payments pay join public.posts po on po.id = pay.post_id
   where pay.stripe_payment_intent_id = 'pi_rl6_fee';

  if v_bounty.status <> 'held' or v_bounty.captured_at is null or v_bounty.post_status <> 'active' then
    raise exception 'CHECK 6 FAILED: draft bounty capture gave % / captured % / post %',
      v_bounty.status, v_bounty.captured_at, v_bounty.post_status;
  end if;
  if v_fee.status <> 'collected' or v_fee.captured_at is null or v_fee.post_status <> 'active' then
    raise exception 'CHECK 6 FAILED: fee capture gave % / captured % / post %',
      v_fee.status, v_fee.captured_at, v_fee.post_status;
  end if;
  raise notice 'CHECK 6 passed: draft bounty -> held, fee -> collected, both stamp captured_at and go live';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 7 — reconcile: a superseded payment's refund is recorded and the live
-- renewed post is NOT touched; a redelivery of that refund (payment now
-- refunded) changes nothing and still never cancels the post.
-- -----------------------------------------------------------------------------
begin;
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate)
values ('eeee0000-0000-0000-0000-000000000007',
        '11111111-1111-1111-1111-111111111111', 'active', 30000, 'RL07 AAA');
insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence, superseded_at)
values ('eeee0000-0000-0000-0000-000000000007', 'pi_rl7_old', 'superseded', 20000, now()),
       ('eeee0000-0000-0000-0000-000000000007', 'pi_rl7_new', 'held', 30000, null);

do $$
declare
  v_first  text;
  v_second text;
  v_old    record;
  v_new    public.payment_status;
  v_post   public.post_status;
begin
  v_first  := public.reconcile_payment_refund('pi_rl7_old', 're_rl7', 19680);
  v_second := public.reconcile_payment_refund('pi_rl7_old', 're_rl7', 19680);

  select status, stripe_refund_id, refunded_amount_pence into v_old
    from public.payments where stripe_payment_intent_id = 'pi_rl7_old';
  select status into v_new from public.payments where stripe_payment_intent_id = 'pi_rl7_new';
  select status into v_post from public.posts where id = 'eeee0000-0000-0000-0000-000000000007';

  if v_first <> 'superseded_refunded' or v_second <> 'no_change' then
    raise exception 'CHECK 7 FAILED: reconcile returned % then %, expected superseded_refunded then no_change',
      v_first, v_second;
  end if;
  if v_old.status <> 'refunded' or v_old.stripe_refund_id <> 're_rl7' or v_old.refunded_amount_pence <> 19680 then
    raise exception 'CHECK 7 FAILED: the old payment is % (% / %), expected refunded with the refund recorded',
      v_old.status, v_old.stripe_refund_id, v_old.refunded_amount_pence;
  end if;
  if v_new <> 'held' or v_post <> 'active' then
    raise exception 'CHECK 7 FAILED: refunding the OLD payment left the reward % and the post % — a renewed listing was taken down',
      v_new, v_post;
  end if;
  raise notice 'CHECK 7 passed: an old payment''s refund (and its redelivery) never touches the live renewed post';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 8 — reconcile on the CURRENT reward keeps the old behaviour (refunded +
-- post cancelled), and on a recovery_claimed post with nobody credited it
-- finishes the recovery (recovered_no_spotter) instead of stranding it.
-- -----------------------------------------------------------------------------
begin;
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate)
values ('eeee0000-0000-0000-0000-000000000008',
        '11111111-1111-1111-1111-111111111111', 'active', 20000, 'RL08 AAA'),
       ('eeee0000-0000-0000-0000-000000000018',
        '11111111-1111-1111-1111-111111111111', 'recovery_claimed', 20000, 'RL08 REC');
insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence)
values ('eeee0000-0000-0000-0000-000000000008', 'pi_rl8_live', 'held', 20000),
       ('eeee0000-0000-0000-0000-000000000018', 'pi_rl8_rec', 'held', 20000);

do $$
declare
  v_live text;
  v_rec  text;
  v_a    record;
  v_b    record;
begin
  v_live := public.reconcile_payment_refund('pi_rl8_live', 're_rl8a', 19680);
  v_rec  := public.reconcile_payment_refund('pi_rl8_rec',  're_rl8b', 19680);

  select pay.status, po.status as post_status into v_a
    from public.payments pay join public.posts po on po.id = pay.post_id
   where pay.stripe_payment_intent_id = 'pi_rl8_live';
  select pay.status, po.status as post_status into v_b
    from public.payments pay join public.posts po on po.id = pay.post_id
   where pay.stripe_payment_intent_id = 'pi_rl8_rec';

  if v_live <> 'refunded' or v_a.status <> 'refunded' or v_a.post_status <> 'cancelled' then
    raise exception 'CHECK 8 FAILED: refunding the live reward gave % / payment % / post %, expected refunded + cancelled',
      v_live, v_a.status, v_a.post_status;
  end if;
  if v_rec <> 'recovered_no_spotter' or v_b.status <> 'refunded' or v_b.post_status <> 'recovered_no_spotter' then
    raise exception 'CHECK 8 FAILED: a recovery refund gave % / payment % / post %, expected recovered_no_spotter',
      v_rec, v_b.status, v_b.post_status;
  end if;
  raise notice 'CHECK 8 passed: the current reward''s refund cancels as before; a recovery refund finishes the recovery';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 9 — refunds_due: superseded bounties and expired undisputed holds are
-- due; an open dispute pauses a hold; an unexpired hold and a plain held
-- reward are not due; a fee never is.
-- -----------------------------------------------------------------------------
begin;
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate)
values ('eeee0000-0000-0000-0000-000000000009', '11111111-1111-1111-1111-111111111111', 'active',    20000, 'RL09 SUP'),
       ('eeee0000-0000-0000-0000-000000000019', '11111111-1111-1111-1111-111111111111', 'cancelled', 20000, 'RL09 EXP'),
       ('eeee0000-0000-0000-0000-000000000029', '11111111-1111-1111-1111-111111111111', 'cancelled', 20000, 'RL09 DIS'),
       ('eeee0000-0000-0000-0000-000000000039', '11111111-1111-1111-1111-111111111111', 'cancelled', 20000, 'RL09 NEW'),
       ('eeee0000-0000-0000-0000-000000000049', '11111111-1111-1111-1111-111111111111', 'active',    null,  'RL09 FEE');
insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence, kind, superseded_at)
values ('eeee0000-0000-0000-0000-000000000009', 'pi_rl9_superseded', 'superseded', 20000, 'bounty_escrow', now()),
       ('eeee0000-0000-0000-0000-000000000009', 'pi_rl9_current',    'held',       20000, 'bounty_escrow', null),
       ('eeee0000-0000-0000-0000-000000000019', 'pi_rl9_expired',    'held',       20000, 'bounty_escrow', null),
       ('eeee0000-0000-0000-0000-000000000029', 'pi_rl9_disputed',   'held',       20000, 'bounty_escrow', null),
       ('eeee0000-0000-0000-0000-000000000039', 'pi_rl9_window',     'held',       20000, 'bounty_escrow', null),
       ('eeee0000-0000-0000-0000-000000000049', 'pi_rl9_fee',        'collected',  500,   'listing_fee',   null);
insert into public.sightings (id, post_id, spotter_id, status, area_label, location_unavailable)
values ('eeee0009-0000-0000-0000-00000000000d', 'eeee0000-0000-0000-0000-000000000029',
        '33333333-3333-3333-3333-333333333333', 'unverified', 'Camden', true);
insert into public.refund_holds (post_id, owner_id, exit_path, sighting_ids, expires_at)
values ('eeee0000-0000-0000-0000-000000000019', '11111111-1111-1111-1111-111111111111', 'deactivate',
        array[gen_random_uuid()], now() - interval '1 hour'),
       ('eeee0000-0000-0000-0000-000000000029', '11111111-1111-1111-1111-111111111111', 'deactivate',
        array['eeee0009-0000-0000-0000-00000000000d'::uuid], now() - interval '1 hour'),
       ('eeee0000-0000-0000-0000-000000000039', '11111111-1111-1111-1111-111111111111', 'deactivate',
        array[gen_random_uuid()], now() + interval '1 hour');
insert into public.refund_disputes (post_id, sighting_id, spotter_id)
values ('eeee0000-0000-0000-0000-000000000029', 'eeee0009-0000-0000-0000-00000000000d',
        '33333333-3333-3333-3333-333333333333');

do $$
declare
  v_due text[];
begin
  select coalesce(array_agg(payment_intent_id || ':' || reason order by payment_intent_id), '{}')
    into v_due
    from public.refunds_due(500)
   where payment_intent_id like 'pi_rl9_%';

  if v_due <> array['pi_rl9_expired:deactivate', 'pi_rl9_superseded:superseded'] then
    raise exception 'CHECK 9 FAILED: refunds_due returned %, expected exactly the expired undisputed hold and the superseded payment', v_due;
  end if;
  raise notice 'CHECK 9 passed: refunds_due = expired undisputed holds + superseded bounties; disputes pause, windows wait, fees never';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 10 — the 75-day ops alert: old reward money is claimed once (with a
-- resolve-by date and no plate or amount), not again within 24 hours, and a
-- young reward is never claimed.
-- -----------------------------------------------------------------------------
begin;
-- Only these rows may be old: the claim reads every payment.
update public.payments set deadline_alerted_at = now()
 where status in ('held', 'superseded');
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate)
values ('eeee0000-0000-0000-0000-000000000010', '11111111-1111-1111-1111-111111111111', 'active', 20000, 'RL10 OLD'),
       ('eeee0000-0000-0000-0000-000000000020', '11111111-1111-1111-1111-111111111111', 'active', 20000, 'RL10 NEW');
insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence, captured_at)
values ('eeee0000-0000-0000-0000-000000000010', 'pi_rl10_old',   'held', 20000, now() - interval '80 days'),
       ('eeee0000-0000-0000-0000-000000000020', 'pi_rl10_young', 'held', 20000, now() - interval '10 days');

do $$
declare
  v_first  jsonb;
  v_second jsonb;
  v_row    jsonb;
begin
  v_first  := public.claim_money_deadline_alerts(50);
  v_second := public.claim_money_deadline_alerts(50);

  if jsonb_array_length(v_first) <> 1 then
    raise exception 'CHECK 10 FAILED: expected exactly the 80-day payment, got %', v_first;
  end if;
  v_row := v_first -> 0;
  if (v_row ->> 'postId') <> 'eeee0000-0000-0000-0000-000000000010' or (v_row ->> 'daysHeld')::int < 79 then
    raise exception 'CHECK 10 FAILED: the alert row is %', v_row;
  end if;
  if (v_row ->> 'resolveBy') is null then
    raise exception 'CHECK 10 FAILED: the alert row has no resolve-by date';
  end if;
  if v_row::text like '%RL10%' or v_row ? 'amount' or v_row ? 'amountPence' then
    raise exception 'CHECK 10 FAILED: the alert row carries a plate or an amount: %', v_row;
  end if;
  if jsonb_array_length(v_second) <> 0 then
    raise exception 'CHECK 10 FAILED: a second run within 24h alerted again: %', v_second;
  end if;
  raise notice 'CHECK 10 passed: 75+ day reward money is alerted once a day, with a resolve-by date and no plate or amount';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 11 — superseded money blocks deleting a cancelled post.
-- -----------------------------------------------------------------------------
begin;
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate)
values ('eeee0000-0000-0000-0000-000000000011',
        '11111111-1111-1111-1111-111111111111', 'cancelled', 20000, 'RL11 AAA');
insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence, superseded_at, refund_fee_absorbed)
values ('eeee0000-0000-0000-0000-000000000011', 'pi_rl11_owed', 'superseded', 20000, now(), true);

do $$
begin
  begin
    perform public.delete_cancelled_post(
      'eeee0000-0000-0000-0000-000000000011', '11111111-1111-1111-1111-111111111111', '{}'::text[]);
  exception when others then
    if sqlerrm like '%MONEY_IN_FLIGHT%' then
      raise notice 'CHECK 11 passed: superseded money still owed back blocks deleting the post (MONEY_IN_FLIGHT)';
      return;
    end if;
    raise exception 'CHECK 11 FAILED: expected MONEY_IN_FLIGHT, got %', sqlerrm;
  end;
  raise exception 'CHECK 11 FAILED: a post with superseded money still owed was deleted';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 12 — every new money function is service-role only.
-- -----------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.reconcile_payment_refund(text, text, integer)',
    'public.refunds_due(integer)',
    'public.claim_money_deadline_alerts(integer)',
    'public.release_money_deadline_alerts(uuid[])',
    'public.mark_post_payment_held(text)',
    'public.mark_post_payment_refunded(text, text, integer)',
    'public.mark_post_recovered_no_spotter(text, text, integer)',
    'public.delete_cancelled_post(uuid, uuid, text[])'
  ] loop
    if has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute') then
      raise exception 'CHECK 12 FAILED: % is executable by a client role', f;
    end if;
    if not has_function_privilege('service_role', f, 'execute') then
      raise exception 'CHECK 12 FAILED: % is not executable by service_role — the webhook or sweep is broken', f;
    end if;
  end loop;
  raise notice 'CHECK 12 passed: the reward-ledger functions are service-role only';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 13 — a renewal confirmed AFTER the post came under a claim is a stray,
-- never a replacement: (a) deactivated with a refund hold (post cancelled),
-- (b) recovery_claimed with a credited sighting. In both, the old reward stays
-- held for the hold / the spotter, and the new charge goes home in full.
-- -----------------------------------------------------------------------------
begin;
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate)
values ('eeee0000-0000-0000-0000-000000000013', '11111111-1111-1111-1111-111111111111', 'cancelled',        50000, 'RL13 HLD'),
       ('eeee0000-0000-0000-0000-000000000023', '11111111-1111-1111-1111-111111111111', 'recovery_claimed', 50000, 'RL13 CRD');
insert into public.payments (id, post_id, stripe_payment_intent_id, status, amount_pence)
values ('eeee0013-0000-0000-0000-00000000000a', 'eeee0000-0000-0000-0000-000000000013', 'pi_rl13_held_a', 'held', 50000),
       ('eeee0013-0000-0000-0000-00000000000c', 'eeee0000-0000-0000-0000-000000000023', 'pi_rl13_cred_a', 'held', 50000);
insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence, replaces_payment_id)
values ('eeee0000-0000-0000-0000-000000000013', 'pi_rl13_held_b', 'requires_payment', 1000, 'eeee0013-0000-0000-0000-00000000000a'),
       ('eeee0000-0000-0000-0000-000000000023', 'pi_rl13_cred_b', 'requires_payment', 1000, 'eeee0013-0000-0000-0000-00000000000c');
insert into public.refund_holds (post_id, owner_id, exit_path, sighting_ids, expires_at)
values ('eeee0000-0000-0000-0000-000000000013', '11111111-1111-1111-1111-111111111111', 'deactivate',
        array[gen_random_uuid()], now() + interval '72 hours');
insert into public.sightings (post_id, spotter_id, status, area_label, location_unavailable)
values ('eeee0000-0000-0000-0000-000000000023', '33333333-3333-3333-3333-333333333333', 'credited', 'Camden', true);

do $$
declare
  v_rows text[];
begin
  perform public.mark_post_payment_held('pi_rl13_held_b');
  perform public.mark_post_payment_held('pi_rl13_cred_b');

  select array_agg(stripe_payment_intent_id || ':' || status || ':' || refund_fee_absorbed order by stripe_payment_intent_id)
    into v_rows
    from public.payments where stripe_payment_intent_id like 'pi_rl13_%';

  if v_rows <> array['pi_rl13_cred_a:held:false', 'pi_rl13_cred_b:superseded:true',
                     'pi_rl13_held_a:held:false', 'pi_rl13_held_b:superseded:true'] then
    raise exception 'CHECK 13 FAILED: a renewal on a claimed post replaced the reward: %', v_rows;
  end if;
  if (select bounty_amount_pence from public.posts where id = 'eeee0000-0000-0000-0000-000000000023') <> 50000 then
    raise exception 'CHECK 13 FAILED: a late renewal re-priced a credited recovery — the spotter would be paid on the new amount';
  end if;
  raise notice 'CHECK 13 passed: a renewal on a held or credited post is a stray; the reward under claim stays held';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 14 — recording a refund of a payment that is no longer the reward
-- never closes the post: mark_post_payment_refunded raises
-- PAYMENT_NOT_CURRENT_REWARD and the renewed post stays live with its reward.
-- -----------------------------------------------------------------------------
begin;
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate)
values ('eeee0000-0000-0000-0000-000000000014', '11111111-1111-1111-1111-111111111111', 'active', 30000, 'RL14 AAA');
insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence, superseded_at)
values ('eeee0000-0000-0000-0000-000000000014', 'pi_rl14_old', 'superseded', 20000, now()),
       ('eeee0000-0000-0000-0000-000000000014', 'pi_rl14_new', 'held', 30000, null);

do $$
declare
  v_raised boolean := false;
begin
  begin
    perform public.mark_post_payment_refunded('pi_rl14_old', 're_rl14', 19680);
  exception when others then
    if sqlerrm not like '%PAYMENT_NOT_CURRENT_REWARD%' then
      raise exception 'CHECK 14 FAILED: expected PAYMENT_NOT_CURRENT_REWARD, got %', sqlerrm;
    end if;
    v_raised := true;
  end;
  if not v_raised then
    raise exception 'CHECK 14 FAILED: recording an old payment''s refund was silently accepted';
  end if;
  if (select status from public.posts where id = 'eeee0000-0000-0000-0000-000000000014') <> 'active'
     or (select status from public.payments where stripe_payment_intent_id = 'pi_rl14_new') <> 'held' then
    raise exception 'CHECK 14 FAILED: the renewed post or its reward moved';
  end if;
  raise notice 'CHECK 14 passed: an old payment''s refund cannot close a renewed post through the direct recorder';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 15 — a capture for an amount the post does not offer is a stray, and
-- the correctly priced intent still captures afterwards.
-- -----------------------------------------------------------------------------
begin;
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate)
values ('eeee0000-0000-0000-0000-000000000015', '11111111-1111-1111-1111-111111111111', 'draft', 30000, 'RL15 AAA');
insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence)
values ('eeee0000-0000-0000-0000-000000000015', 'pi_rl15_stale', 'failed', 25000),
       ('eeee0000-0000-0000-0000-000000000015', 'pi_rl15_right', 'requires_payment', 30000);

do $$
declare
  v_stale record;
  v_right public.payment_status;
  v_post  public.post_status;
begin
  perform public.mark_post_payment_held('pi_rl15_stale');
  select status, refund_fee_absorbed into v_stale from public.payments where stripe_payment_intent_id = 'pi_rl15_stale';
  select status into v_post from public.posts where id = 'eeee0000-0000-0000-0000-000000000015';
  if v_stale.status <> 'superseded' or not v_stale.refund_fee_absorbed or v_post <> 'draft' then
    raise exception 'CHECK 15 FAILED: a wrong-amount capture gave % (absorbed %), post %',
      v_stale.status, v_stale.refund_fee_absorbed, v_post;
  end if;

  perform public.mark_post_payment_held('pi_rl15_right');
  select status into v_right from public.payments where stripe_payment_intent_id = 'pi_rl15_right';
  select status into v_post from public.posts where id = 'eeee0000-0000-0000-0000-000000000015';
  if v_right <> 'held' or v_post <> 'active' then
    raise exception 'CHECK 15 FAILED: the correctly priced charge then gave % / post %', v_right, v_post;
  end if;
  raise notice 'CHECK 15 passed: a wrong-amount capture goes home in full; the right one still takes the post live';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 16 — a dashboard refund of a CREDITED recovery is recorded, leaves the
-- post in recovery_claimed, and says so (so the webhook alerts a person).
-- -----------------------------------------------------------------------------
begin;
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate)
values ('eeee0000-0000-0000-0000-000000000017', '11111111-1111-1111-1111-111111111111', 'recovery_claimed', 20000, 'RL16 AAA');
insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence)
values ('eeee0000-0000-0000-0000-000000000017', 'pi_rl16', 'held', 20000);
insert into public.sightings (post_id, spotter_id, status, area_label, location_unavailable)
values ('eeee0000-0000-0000-0000-000000000017', '33333333-3333-3333-3333-333333333333', 'credited', 'Camden', true);

do $$
declare
  v_outcome text;
begin
  v_outcome := public.reconcile_payment_refund('pi_rl16', 're_rl16', 19680);
  if v_outcome <> 'refunded_with_credited_sighting'
     or (select status from public.payments where stripe_payment_intent_id = 'pi_rl16') <> 'refunded'
     or (select status from public.posts where id = 'eeee0000-0000-0000-0000-000000000017') <> 'recovery_claimed' then
    raise exception 'CHECK 16 FAILED: a credited recovery''s refund gave %', v_outcome;
  end if;
  raise notice 'CHECK 16 passed: a refunded credited recovery is recorded, flagged, and its post left for a person';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 17 — refunds_due's second lock, both directions:
--   (a) a RENEWAL-superseded payment waits behind a dispute that already
--       existed when it was superseded;
--   (b) it does NOT wait on a dispute opened afterwards (a claim on the new
--       reward), and a STRAY never waits — even on a recovered post with a
--       credited sighting, which would otherwise strand it forever.
-- -----------------------------------------------------------------------------
begin;
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate)
values ('eeee0000-0000-0000-0000-000000000027', '11111111-1111-1111-1111-111111111111', 'cancelled', 20000, 'RL17 OLD'),
       ('eeee0000-0000-0000-0000-000000000037', '11111111-1111-1111-1111-111111111111', 'active',    30000, 'RL17 NEW'),
       ('eeee0000-0000-0000-0000-000000000047', '11111111-1111-1111-1111-111111111111', 'recovered', 20000, 'RL17 REC');
insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence, superseded_at, refund_fee_absorbed)
values ('eeee0000-0000-0000-0000-000000000027', 'pi_rl17_before', 'superseded', 20000, now() + interval '1 minute', false),
       ('eeee0000-0000-0000-0000-000000000037', 'pi_rl17_after',  'superseded', 20000, now() - interval '1 day',    false),
       ('eeee0000-0000-0000-0000-000000000047', 'pi_rl17_stray',  'superseded', 20000, now(),                        true);
insert into public.sightings (id, post_id, spotter_id, status, area_label, location_unavailable)
values ('eeee0017-0000-0000-0000-00000000000d', 'eeee0000-0000-0000-0000-000000000027',
        '33333333-3333-3333-3333-333333333333', 'unverified', 'Camden', true),
       ('eeee0017-0000-0000-0000-00000000000e', 'eeee0000-0000-0000-0000-000000000037',
        '33333333-3333-3333-3333-333333333333', 'unverified', 'Camden', true),
       ('eeee0017-0000-0000-0000-00000000000f', 'eeee0000-0000-0000-0000-000000000047',
        '33333333-3333-3333-3333-333333333333', 'credited', 'Camden', true);
insert into public.refund_disputes (post_id, sighting_id, spotter_id)
values ('eeee0000-0000-0000-0000-000000000027', 'eeee0017-0000-0000-0000-00000000000d',
        '33333333-3333-3333-3333-333333333333'),
       ('eeee0000-0000-0000-0000-000000000037', 'eeee0017-0000-0000-0000-00000000000e',
        '33333333-3333-3333-3333-333333333333');

do $$
declare
  v_due text[];
begin
  select coalesce(array_agg(payment_intent_id order by payment_intent_id), '{}') into v_due
    from public.refunds_due(500) where payment_intent_id like 'pi_rl17_%';
  if v_due <> array['pi_rl17_after', 'pi_rl17_stray'] then
    raise exception 'CHECK 17 FAILED: refunds_due gave % — expected the post-renewal-dispute and the stray due, the pre-existing dispute holding one back', v_due;
  end if;
  raise notice 'CHECK 17 passed: only a dispute that predates the supersede holds a renewal back; strays always go home';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 18 — a failed alert email hands its claim back (this hour's only).
-- -----------------------------------------------------------------------------
begin;
update public.payments set deadline_alerted_at = now()
 where status in ('held', 'superseded');
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate)
values ('eeee0000-0000-0000-0000-000000000028', '11111111-1111-1111-1111-111111111111', 'active', 20000, 'RL18 AAA');
insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence, captured_at)
values ('eeee0000-0000-0000-0000-000000000028', 'pi_rl18', 'held', 20000, now() - interval '80 days');

do $$
declare
  v_claim    jsonb;
  v_released integer;
begin
  v_claim := public.claim_money_deadline_alerts(50);
  v_released := public.release_money_deadline_alerts(
    array[(v_claim -> 0 ->> 'paymentId')::uuid]);
  if v_released <> 1 or jsonb_array_length(public.claim_money_deadline_alerts(50)) <> 1 then
    raise exception 'CHECK 18 FAILED: a released claim was not re-alerted (released %)', v_released;
  end if;
  raise notice 'CHECK 18 passed: a failed alert email re-arms its claim for the next run';
end $$;
rollback;

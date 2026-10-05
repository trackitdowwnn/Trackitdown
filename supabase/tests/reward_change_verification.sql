-- =============================================================================
-- WHAT:  Verification for changing (or adding) the reward on a LIVE listing
--        (20261005130000_a_reward_can_be_changed.sql): the owner's amount
--        RPC and its guards, the ledger-row recorder, the charge context, the
--        owner's status read, and the capture outcomes for change and add.
-- WHY:   Tier 1 money (docs/TESTING.md). This is the first time a live
--        listing's reward can move, so every rule that protects a spotter —
--        no lowering after a recent sighting, nothing while a claim is open,
--        one change at a time — is pinned here, as are the two capture paths
--        that re-price a live listing.
-- HOW:   Self-asserting: each check seeds inside begin…rollback and RAISES on
--        failure (psql -v ON_ERROR_STOP=1; CI's db job). Owner 11111111-…,
--        a second user 22222222-…, spotter 33333333-… are seed profiles.
--        Owner-facing RPCs run as `authenticated` with request.jwt.claims set.
-- LINKS: supabase/migrations/20261005130000_a_reward_can_be_changed.sql;
--        supabase/functions/create-payment-intent/index.ts (chargeRewardChange);
--        supabase/tests/reward_ledger_verification.sql (PR1's half).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- CHECK 1 — set_reward_renewal_amount: the owner may set it on a live listing;
-- another user, an out-of-range amount and a draft are refused.
-- -----------------------------------------------------------------------------
begin;
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate)
values ('ffff0000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'active', 20000, 'RC01 AAA'),
       ('ffff0000-0000-0000-0000-000000000011', '11111111-1111-1111-1111-111111111111', 'draft',  20000, 'RC01 DRF');
insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence)
values ('ffff0000-0000-0000-0000-000000000001', 'pi_rc1_held', 'held', 20000);

do $$
declare
  v_amount integer;
  v_err    text;
begin
  perform set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
  set local role authenticated;
  perform public.set_reward_renewal_amount('ffff0000-0000-0000-0000-000000000001', 35000);

  begin
    perform public.set_reward_renewal_amount('ffff0000-0000-0000-0000-000000000001', 999);
    v_err := 'none';
  exception when others then v_err := sqlerrm; end;
  if v_err not like '%BOUNTY_OUT_OF_RANGE%' then
    raise exception 'CHECK 1 FAILED: £9.99 gave %, expected BOUNTY_OUT_OF_RANGE', v_err;
  end if;

  begin
    perform public.set_reward_renewal_amount('ffff0000-0000-0000-0000-000000000011', 35000);
    v_err := 'none';
  exception when others then v_err := sqlerrm; end;
  if v_err not like '%POST_NOT_LIVE%' then
    raise exception 'CHECK 1 FAILED: a draft gave %, expected POST_NOT_LIVE (drafts use update_post_bounty)', v_err;
  end if;

  perform set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
  begin
    perform public.set_reward_renewal_amount('ffff0000-0000-0000-0000-000000000001', 50000);
    v_err := 'none';
  exception when others then v_err := sqlerrm; end;
  if v_err not like '%POST_NOT_FOUND%' then
    raise exception 'CHECK 1 FAILED: another user gave %, expected POST_NOT_FOUND', v_err;
  end if;
  reset role;

  select renewal_amount_pence into v_amount from public.posts where id = 'ffff0000-0000-0000-0000-000000000001';
  if v_amount <> 35000 then
    raise exception 'CHECK 1 FAILED: renewal_amount_pence is %, expected the owner''s 35000', v_amount;
  end if;
  raise notice 'CHECK 1 passed: only the owner sets the next amount, on a live listing, within £10–£5,000';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 2 — ⚠️ no lowering after a recent sighting: with a recent uncredited
-- sighting, lowering is REWARD_LOWER_BLOCKED; raising (and keeping) still work.
-- -----------------------------------------------------------------------------
begin;
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate)
values ('ffff0000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'active', 20000, 'RC02 AAA');
insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence)
values ('ffff0000-0000-0000-0000-000000000002', 'pi_rc2_held', 'held', 20000);
insert into public.sightings (post_id, spotter_id, status, area_label, location_unavailable)
values ('ffff0000-0000-0000-0000-000000000002', '33333333-3333-3333-3333-333333333333', 'unverified', 'Camden', true);

do $$
declare
  v_err text;
begin
  perform set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
  set local role authenticated;
  begin
    perform public.set_reward_renewal_amount('ffff0000-0000-0000-0000-000000000002', 10000);
    v_err := 'none';
  exception when others then v_err := sqlerrm; end;
  if v_err not like '%REWARD_LOWER_BLOCKED%' then
    raise exception 'CHECK 2 FAILED: lowering after a recent sighting gave %, expected REWARD_LOWER_BLOCKED', v_err;
  end if;
  perform public.set_reward_renewal_amount('ffff0000-0000-0000-0000-000000000002', 20000);  -- keep
  perform public.set_reward_renewal_amount('ffff0000-0000-0000-0000-000000000002', 30000);  -- raise
  reset role;
  raise notice 'CHECK 2 passed: a reward cannot be lowered after a recent sighting; keeping or raising it can';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 3 — nothing changes while there is a claim or a refund in flight:
-- a credited sighting / a refund hold -> REWARD_REVIEW_PENDING; a superseded
-- payment still owed -> REFUND_PENDING.
-- -----------------------------------------------------------------------------
begin;
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate)
values ('ffff0000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'active', 20000, 'RC03 CRD'),
       ('ffff0000-0000-0000-0000-000000000013', '11111111-1111-1111-1111-111111111111', 'active', 20000, 'RC03 HLD'),
       ('ffff0000-0000-0000-0000-000000000023', '11111111-1111-1111-1111-111111111111', 'active', 30000, 'RC03 SUP');
insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence, superseded_at)
values ('ffff0000-0000-0000-0000-000000000003', 'pi_rc3_a', 'held',       20000, null),
       ('ffff0000-0000-0000-0000-000000000013', 'pi_rc3_b', 'held',       20000, null),
       ('ffff0000-0000-0000-0000-000000000023', 'pi_rc3_c', 'held',       30000, null),
       ('ffff0000-0000-0000-0000-000000000023', 'pi_rc3_d', 'superseded', 20000, now());
insert into public.sightings (post_id, spotter_id, status, area_label, location_unavailable)
values ('ffff0000-0000-0000-0000-000000000003', '33333333-3333-3333-3333-333333333333', 'credited', 'Camden', true);
insert into public.refund_holds (post_id, owner_id, exit_path, sighting_ids, expires_at)
values ('ffff0000-0000-0000-0000-000000000013', '11111111-1111-1111-1111-111111111111', 'deactivate',
        array[gen_random_uuid()], now() + interval '72 hours');

do $$
declare
  v_errs text[] := '{}';
  v_post uuid;
begin
  perform set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
  set local role authenticated;
  foreach v_post in array array['ffff0000-0000-0000-0000-000000000003',
                                'ffff0000-0000-0000-0000-000000000013',
                                'ffff0000-0000-0000-0000-000000000023']::uuid[] loop
    begin
      perform public.set_reward_renewal_amount(v_post, 40000);
      v_errs := v_errs || 'none'::text;
    exception when others then
      v_errs := v_errs || sqlerrm;
    end;
  end loop;
  reset role;

  if v_errs <> array['REWARD_REVIEW_PENDING', 'REWARD_REVIEW_PENDING', 'REFUND_PENDING'] then
    raise exception 'CHECK 3 FAILED: credited / held / refund-pending gave %', v_errs;
  end if;
  raise notice 'CHECK 3 passed: a claim on the money, or the last change''s refund still in flight, blocks a change';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 4 — record_reward_renewal_intent: the amount must be the owner's
-- chosen one (BOUNTY_MISMATCH), the replaced payment must still be the reward
-- (RENEWAL_STALE); a good call records one row naming what it replaces, voids
-- an older open attempt, and is idempotent.
-- -----------------------------------------------------------------------------
begin;
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate, renewal_amount_pence)
values ('ffff0000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'active', 20000, 'RC04 AAA', 35000);
update public.posts set renewal_attempt_id = 'ffff0004-0000-0000-0000-0000000000cc' where id = 'ffff0000-0000-0000-0000-000000000004';
insert into public.payments (id, post_id, stripe_payment_intent_id, status, amount_pence)
values ('ffff0004-0000-0000-0000-00000000000a', 'ffff0000-0000-0000-0000-000000000004', 'pi_rc4_held', 'held', 20000);
insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence, replaces_payment_id)
values ('ffff0000-0000-0000-0000-000000000004', 'pi_rc4_abandoned', 'requires_payment', 30000,
        'ffff0004-0000-0000-0000-00000000000a');

do $$
declare
  v_err  text;
  v_rows text[];
begin
  begin
    perform public.record_reward_renewal_intent('ffff0000-0000-0000-0000-000000000004',
      '11111111-1111-1111-1111-111111111111', 'pi_rc4_wrong', 50000, 'ffff0004-0000-0000-0000-00000000000a', 'ffff0004-0000-0000-0000-0000000000cc');
    v_err := 'none';
  exception when others then v_err := sqlerrm; end;
  if v_err not like '%BOUNTY_MISMATCH%' then
    raise exception 'CHECK 4 FAILED: a different amount gave %, expected BOUNTY_MISMATCH', v_err;
  end if;

  begin
    perform public.record_reward_renewal_intent('ffff0000-0000-0000-0000-000000000004',
      '11111111-1111-1111-1111-111111111111', 'pi_rc4_stale', 35000, gen_random_uuid(), 'ffff0004-0000-0000-0000-0000000000cc');
    v_err := 'none';
  exception when others then v_err := sqlerrm; end;
  if v_err not like '%RENEWAL_STALE%' then
    raise exception 'CHECK 4 FAILED: replacing a payment that is not the reward gave %, expected RENEWAL_STALE', v_err;
  end if;

  perform public.record_reward_renewal_intent('ffff0000-0000-0000-0000-000000000004',
    '11111111-1111-1111-1111-111111111111', 'pi_rc4_new', 35000, 'ffff0004-0000-0000-0000-00000000000a', 'ffff0004-0000-0000-0000-0000000000cc');
  perform public.record_reward_renewal_intent('ffff0000-0000-0000-0000-000000000004',
    '11111111-1111-1111-1111-111111111111', 'pi_rc4_new', 35000, 'ffff0004-0000-0000-0000-00000000000a', 'ffff0004-0000-0000-0000-0000000000cc');

  select array_agg(stripe_payment_intent_id || ':' || status || ':' || coalesce(replaces_payment_id::text, '-')
                   order by stripe_payment_intent_id)
    into v_rows
    from public.payments where post_id = 'ffff0000-0000-0000-0000-000000000004';
  if v_rows <> array[
       'pi_rc4_abandoned:failed:ffff0004-0000-0000-0000-00000000000a',
       'pi_rc4_held:held:-',
       'pi_rc4_new:requires_payment:ffff0004-0000-0000-0000-00000000000a'] then
    raise exception 'CHECK 4 FAILED: the ledger is %', v_rows;
  end if;
  raise notice 'CHECK 4 passed: the recorder takes only the owner''s amount against the current reward, voids old attempts, and is idempotent';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 5 — a CHANGE end to end: capture re-prices the live listing, the old
-- reward is owed back (superseded, fee NOT absorbed — the owner chose this),
-- the chosen amount is spent, and the old payment is due for refund.
-- -----------------------------------------------------------------------------
begin;
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate, renewal_amount_pence)
values ('ffff0000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'active', 20000, 'RC05 AAA', 35000);
update public.posts set renewal_attempt_id = 'ffff0005-0000-0000-0000-0000000000cc' where id = 'ffff0000-0000-0000-0000-000000000005';
insert into public.payments (id, post_id, stripe_payment_intent_id, status, amount_pence)
values ('ffff0005-0000-0000-0000-00000000000a', 'ffff0000-0000-0000-0000-000000000005', 'pi_rc5_old', 'held', 20000);

do $$
declare
  v_post record;
  v_old  record;
begin
  perform public.record_reward_renewal_intent('ffff0000-0000-0000-0000-000000000005',
    '11111111-1111-1111-1111-111111111111', 'pi_rc5_new', 35000, 'ffff0005-0000-0000-0000-00000000000a', 'ffff0005-0000-0000-0000-0000000000cc');
  perform public.mark_post_payment_held('pi_rc5_new');

  select status, bounty_amount_pence, renewal_amount_pence into v_post
    from public.posts where id = 'ffff0000-0000-0000-0000-000000000005';
  select status, refund_fee_absorbed into v_old from public.payments where stripe_payment_intent_id = 'pi_rc5_old';

  if v_post.status <> 'active' or v_post.bounty_amount_pence <> 35000 or v_post.renewal_amount_pence is not null then
    raise exception 'CHECK 5 FAILED: the post is % / % / renewal %', v_post.status, v_post.bounty_amount_pence, v_post.renewal_amount_pence;
  end if;
  if v_old.status <> 'superseded' or v_old.refund_fee_absorbed then
    raise exception 'CHECK 5 FAILED: the old reward is % (absorbed %)', v_old.status, v_old.refund_fee_absorbed;
  end if;
  if (select status from public.payments where stripe_payment_intent_id = 'pi_rc5_new') <> 'held' then
    raise exception 'CHECK 5 FAILED: the new charge is not the reward';
  end if;
  if not exists (select 1 from public.refunds_due(500) where payment_intent_id = 'pi_rc5_old' and reason = 'superseded') then
    raise exception 'CHECK 5 FAILED: the old reward is not due back to the owner';
  end if;
  raise notice 'CHECK 5 passed: a change re-prices the live listing and the old reward is due back, minus the card fee';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 6 — ADD to a £5 fee listing: the owner's chosen charge becomes the
-- reward and the listing now offers it; a capture for any other amount on the
-- same listing is a stray (superseded, refunded in full).
-- -----------------------------------------------------------------------------
begin;
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate, renewal_amount_pence)
values ('ffff0000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'active', null, 'RC06 AAA', 15000);
update public.posts set renewal_attempt_id = 'ffff0006-0000-0000-0000-0000000000cc' where id = 'ffff0000-0000-0000-0000-000000000006';
insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence, kind)
values ('ffff0000-0000-0000-0000-000000000006', 'pi_rc6_fee',   'collected',        500,   'listing_fee'),
       ('ffff0000-0000-0000-0000-000000000006', 'pi_rc6_wrong', 'requires_payment', 20000, 'bounty_escrow');

do $$
declare
  v_wrong record;
  v_post  record;
begin
  perform public.mark_post_payment_held('pi_rc6_wrong');
  select status, refund_fee_absorbed into v_wrong from public.payments where stripe_payment_intent_id = 'pi_rc6_wrong';
  if v_wrong.status <> 'superseded' or not v_wrong.refund_fee_absorbed then
    raise exception 'CHECK 6 FAILED: a capture that is not the chosen add gave % (absorbed %)', v_wrong.status, v_wrong.refund_fee_absorbed;
  end if;
  -- The sweep refunds it; until then REFUND_PENDING (rightly) blocks the add.
  update public.payments set status = 'refunded' where stripe_payment_intent_id = 'pi_rc6_wrong';

  perform public.record_reward_renewal_intent('ffff0000-0000-0000-0000-000000000006',
    '11111111-1111-1111-1111-111111111111', 'pi_rc6_add', 15000, null, 'ffff0006-0000-0000-0000-0000000000cc');
  perform public.mark_post_payment_held('pi_rc6_add');

  select status, bounty_amount_pence, renewal_amount_pence into v_post
    from public.posts where id = 'ffff0000-0000-0000-0000-000000000006';
  if (select status from public.payments where stripe_payment_intent_id = 'pi_rc6_add') <> 'held'
     or v_post.bounty_amount_pence <> 15000 or v_post.renewal_amount_pence is not null or v_post.status <> 'active' then
    raise exception 'CHECK 6 FAILED: after the add the post is % / % / renewal %', v_post.status, v_post.bounty_amount_pence, v_post.renewal_amount_pence;
  end if;
  if (select status from public.payments where stripe_payment_intent_id = 'pi_rc6_fee') <> 'collected' then
    raise exception 'CHECK 6 FAILED: adding a reward touched the £5 fee';
  end if;
  raise notice 'CHECK 6 passed: a fee listing takes the owner''s chosen reward; any other capture there goes home in full';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 7 — reward_charge_context: mode, the payment it would replace, the
-- newest reward payment (for the key), and NO_AMOUNT before one is chosen.
-- -----------------------------------------------------------------------------
begin;
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate)
values ('ffff0000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'active', 20000, 'RC07 AAA');
insert into public.payments (id, post_id, stripe_payment_intent_id, status, amount_pence)
values ('ffff0007-0000-0000-0000-00000000000a', 'ffff0000-0000-0000-0000-000000000007', 'pi_rc7_held', 'held', 20000);

do $$
declare
  v_ctx jsonb;
begin
  v_ctx := public.reward_charge_context('ffff0000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111');
  if v_ctx ->> 'mode' <> 'change'
     or v_ctx ->> 'currentPaymentId' <> 'ffff0007-0000-0000-0000-00000000000a'
     or v_ctx ->> 'block' <> 'NO_AMOUNT' then
    raise exception 'CHECK 7 FAILED: context before an amount is chosen: %', v_ctx;
  end if;
  update public.posts set renewal_amount_pence = 30000, renewal_attempt_id = 'ffff0007-0000-0000-0000-0000000000cc'
   where id = 'ffff0000-0000-0000-0000-000000000007';
  v_ctx := public.reward_charge_context('ffff0000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111');
  if v_ctx ->> 'attemptId' <> 'ffff0007-0000-0000-0000-0000000000cc' or v_ctx ->> 'block' is not null then
    raise exception 'CHECK 7 FAILED: context after choosing is still blocked: %', v_ctx;
  end if;
  begin
    perform public.reward_charge_context('ffff0000-0000-0000-0000-000000000007', '22222222-2222-2222-2222-222222222222');
    raise exception 'CHECK 7 FAILED: another user got a charge context';
  exception when others then
    if sqlerrm not like '%POST_NOT_FOUND%' then raise; end if;
  end;
  raise notice 'CHECK 7 passed: the charge context names the reward to replace and refuses until an amount is chosen';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 8 — get_my_reward_status: the owner sees mode, amount, the reward
-- token and whether recent sightings exist; nobody else sees anything.
-- -----------------------------------------------------------------------------
begin;
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate)
values ('ffff0000-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111', 'active', 20000, 'RC08 AAA');
insert into public.payments (id, post_id, stripe_payment_intent_id, status, amount_pence, captured_at)
values ('ffff0008-0000-0000-0000-00000000000a', 'ffff0000-0000-0000-0000-000000000008', 'pi_rc8', 'held', 20000, now());

do $$
declare
  v_doc jsonb;
  v_err text;
begin
  perform set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
  set local role authenticated;
  v_doc := public.get_my_reward_status('ffff0000-0000-0000-0000-000000000008');
  perform set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
  begin
    perform public.get_my_reward_status('ffff0000-0000-0000-0000-000000000008');
    v_err := 'none';
  exception when others then v_err := sqlerrm; end;
  reset role;

  if v_doc ->> 'mode' <> 'change' or (v_doc ->> 'amountPence')::int <> 20000
     or v_doc ->> 'rewardId' <> 'ffff0008-0000-0000-0000-00000000000a'
     or (v_doc ->> 'hasRecentSightings')::boolean or (v_doc ->> 'block') is not null then
    raise exception 'CHECK 8 FAILED: the owner''s status is %', v_doc;
  end if;
  if v_err not like '%POST_NOT_FOUND%' then
    raise exception 'CHECK 8 FAILED: another user got %', v_err;
  end if;
  raise notice 'CHECK 8 passed: the owner reads their reward status; nobody else can';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 9 — grants: service-only stays service-only; the owner RPCs are for
-- signed-in users and never anon; the helpers are nobody's.
-- -----------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.reward_charge_context(uuid, uuid)',
    'public.record_reward_renewal_intent(uuid, uuid, text, integer, uuid)',
    'public.reward_has_claim(uuid)',
    'public.reward_change_block(uuid, integer)'
  ] loop
    if has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute') then
      raise exception 'CHECK 9 FAILED: % is executable by a client role', f;
    end if;
  end loop;
  foreach f in array array[
    'public.set_reward_renewal_amount(uuid, integer)',
    'public.get_my_reward_status(uuid)'
  ] loop
    if has_function_privilege('anon', f, 'execute') then
      raise exception 'CHECK 9 FAILED: % is executable by anon', f;
    end if;
  end loop;
  raise notice 'CHECK 9 passed: the reward change functions are granted as designed';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 10 — ⚠️ the lowering rule holds AT CAPTURE. The owner chooses £100
-- with no sightings (allowed), a sighting arrives while the sheet is open,
-- then they confirm: the £100 is a stray (refunded in full), the £200 reward
-- stays held, and the listing still offers £200.
-- -----------------------------------------------------------------------------
begin;
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate, renewal_amount_pence, renewal_attempt_id)
values ('ffff0000-0000-0000-0000-000000000010', '11111111-1111-1111-1111-111111111111', 'active', 20000, 'RC10 AAA',
        10000, 'ffff0010-0000-0000-0000-0000000000cc');
insert into public.payments (id, post_id, stripe_payment_intent_id, status, amount_pence)
values ('ffff0010-0000-0000-0000-00000000000a', 'ffff0000-0000-0000-0000-000000000010', 'pi_rc10_reward', 'held', 20000);

do $$
declare
  v_low record;
begin
  perform public.record_reward_renewal_intent('ffff0000-0000-0000-0000-000000000010',
    '11111111-1111-1111-1111-111111111111', 'pi_rc10_low', 10000,
    'ffff0010-0000-0000-0000-00000000000a', 'ffff0010-0000-0000-0000-0000000000cc');
  -- The sighting that finds the car, while the sheet is open.
  insert into public.sightings (post_id, spotter_id, status, area_label, location_unavailable)
  values ('ffff0000-0000-0000-0000-000000000010', '33333333-3333-3333-3333-333333333333', 'unverified', 'Camden', true);
  perform public.mark_post_payment_held('pi_rc10_low');

  select status, refund_fee_absorbed into v_low from public.payments where stripe_payment_intent_id = 'pi_rc10_low';
  if v_low.status <> 'superseded' or not v_low.refund_fee_absorbed then
    raise exception 'CHECK 10 FAILED: a lowering confirmed after a sighting became % (absorbed %) — the reward was cut',
      v_low.status, v_low.refund_fee_absorbed;
  end if;
  if (select status from public.payments where stripe_payment_intent_id = 'pi_rc10_reward') <> 'held'
     or (select bounty_amount_pence from public.posts where id = 'ffff0000-0000-0000-0000-000000000010') <> 20000 then
    raise exception 'CHECK 10 FAILED: the reward under a recent sighting moved';
  end if;
  raise notice 'CHECK 10 passed: a reward cannot be lowered by confirming after a sighting; the charge goes home in full';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 11 — only the CURRENT choice can become the reward: an intent from an
-- earlier choice (the owner chose again since) captures late as a stray, and
-- the current choice still captures afterwards.
-- -----------------------------------------------------------------------------
begin;
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate, renewal_amount_pence, renewal_attempt_id)
values ('ffff0000-0000-0000-0000-000000000020', '11111111-1111-1111-1111-111111111111', 'active', 20000, 'RC11 AAA',
        40000, 'ffff0020-0000-0000-0000-0000000000c2');
insert into public.payments (id, post_id, stripe_payment_intent_id, status, amount_pence)
values ('ffff0020-0000-0000-0000-00000000000a', 'ffff0000-0000-0000-0000-000000000020', 'pi_rc11_reward', 'held', 20000);
-- An intent from the FIRST choice (£30,000, attempt c1), never cancelled.
insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence, replaces_payment_id, renewal_attempt_id)
values ('ffff0000-0000-0000-0000-000000000020', 'pi_rc11_old_choice', 'failed', 30000,
        'ffff0020-0000-0000-0000-00000000000a', 'ffff0020-0000-0000-0000-0000000000c1');

do $$
begin
  perform public.mark_post_payment_held('pi_rc11_old_choice');
  if (select status from public.payments where stripe_payment_intent_id = 'pi_rc11_old_choice') <> 'superseded'
     or (select status from public.payments where stripe_payment_intent_id = 'pi_rc11_reward') <> 'held' then
    raise exception 'CHECK 11 FAILED: an earlier choice''s intent changed the reward';
  end if;

  -- While the stray is owed, REFUND_PENDING (rightly) refuses a new record;
  -- settle it the way the sweep would, then take the current choice.
  update public.payments set status = 'refunded' where stripe_payment_intent_id = 'pi_rc11_old_choice';
  perform public.record_reward_renewal_intent('ffff0000-0000-0000-0000-000000000020',
    '11111111-1111-1111-1111-111111111111', 'pi_rc11_current', 40000,
    'ffff0020-0000-0000-0000-00000000000a', 'ffff0020-0000-0000-0000-0000000000c2');
  perform public.mark_post_payment_held('pi_rc11_current');
  if (select status from public.payments where stripe_payment_intent_id = 'pi_rc11_current') <> 'held'
     or (select bounty_amount_pence from public.posts where id = 'ffff0000-0000-0000-0000-000000000020') <> 40000 then
    raise exception 'CHECK 11 FAILED: the current choice did not become the reward';
  end if;
  raise notice 'CHECK 11 passed: only the owner''s current choice can become the reward';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 12 — ADD needs the current choice too: a leftover DRAFT-era intent
-- (no attempt) at exactly the chosen amount does not become the reward; and
-- a claim appearing before capture turns even the right charge into a stray.
-- -----------------------------------------------------------------------------
begin;
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate, renewal_amount_pence, renewal_attempt_id)
values ('ffff0000-0000-0000-0000-000000000030', '11111111-1111-1111-1111-111111111111', 'active', null, 'RC12 AAA',
        15000, 'ffff0030-0000-0000-0000-0000000000cc');
insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence, renewal_attempt_id)
values ('ffff0000-0000-0000-0000-000000000030', 'pi_rc12_draft_era', 'failed',           15000, null),
       ('ffff0000-0000-0000-0000-000000000030', 'pi_rc12_add',       'requires_payment', 15000, 'ffff0030-0000-0000-0000-0000000000cc');

do $$
begin
  perform public.mark_post_payment_held('pi_rc12_draft_era');
  if (select status from public.payments where stripe_payment_intent_id = 'pi_rc12_draft_era') <> 'superseded'
     or (select bounty_amount_pence from public.posts where id = 'ffff0000-0000-0000-0000-000000000030') is not null then
    raise exception 'CHECK 12 FAILED: a draft-era intent became the added reward';
  end if;

  insert into public.payout_reviews (post_id, owner_id, spotter_id, reasons)
  values ('ffff0000-0000-0000-0000-000000000030', '11111111-1111-1111-1111-111111111111',
          '33333333-3333-3333-3333-333333333333', array['shared_device']);
  perform public.mark_post_payment_held('pi_rc12_add');
  if (select status from public.payments where stripe_payment_intent_id = 'pi_rc12_add') <> 'superseded'
     or (select bounty_amount_pence from public.posts where id = 'ffff0000-0000-0000-0000-000000000030') is not null then
    raise exception 'CHECK 12 FAILED: an add captured while a claim was open';
  end if;
  raise notice 'CHECK 12 passed: an add needs the current choice and no claim, at capture';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 13 — refunds_due(p_post_id) narrows to one post (the webhook's call).
-- -----------------------------------------------------------------------------
begin;
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate)
values ('ffff0000-0000-0000-0000-000000000040', '11111111-1111-1111-1111-111111111111', 'active', 30000, 'RC13 AAA'),
       ('ffff0000-0000-0000-0000-000000000041', '11111111-1111-1111-1111-111111111111', 'active', 30000, 'RC13 BBB');
insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence, superseded_at)
values ('ffff0000-0000-0000-0000-000000000040', 'pi_rc13_mine',  'superseded', 20000, now() - interval '1 hour'),
       ('ffff0000-0000-0000-0000-000000000041', 'pi_rc13_other', 'superseded', 20000, now() - interval '2 hours');

do $$
declare
  v_due text[];
begin
  select coalesce(array_agg(payment_intent_id), '{}') into v_due
    from public.refunds_due(50, 'ffff0000-0000-0000-0000-000000000040');
  if v_due <> array['pi_rc13_mine'] then
    raise exception 'CHECK 13 FAILED: refunds_due for one post gave %', v_due;
  end if;
  raise notice 'CHECK 13 passed: refunds_due narrows to one post';
end $$;
rollback;

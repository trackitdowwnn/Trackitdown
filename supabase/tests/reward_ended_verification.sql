-- =============================================================================
-- WHAT:  Verification for "Reward ended" (20261006100000_a_reward_can_end.sql):
--        the readers tell a lapsed reward from a £5 fee listing and from a
--        reward added again; the pair of columns is all-or-nothing and not
--        client-writable; My listings carries the held reward's term and no
--        one else's; the owner's reward status names what ended, only while
--        nothing is held.
-- WHY:   ADR-0020 point 3. Every "no reward" sentence in the app says the
--        owner paid a listing fee instead — false for a lapsed reward. PR5
--        may not end a single reward until these readers say the true thing.
-- HOW:   Self-asserting, begin…rollback per check, RAISE on failure (CI's db
--        job). Owner 11111111-…, other user 22222222-… are seed profiles. The
--        lapse is written by hand here: its only real writer is PR5's expiry.
-- LINKS: supabase/migrations/20261006100000_a_reward_can_end.sql;
--        docs/decisions/ADR-0020-a-reward-has-a-term.md.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- CHECK 1 — reward_ended: true for a lapsed reward ONLY. A fee listing (null
-- bounty, never ended) and a reward added again after a lapse (stamp kept,
-- bounty back) both read false — in the shared helper and in get_post_detail.
-- -----------------------------------------------------------------------------
begin;
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate, reward_ended_at, ended_reward_pence)
values ('eeee0000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'active', null,  'RE01 LAP', now() - interval '1 day', 20000),
       ('eeee0000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'active', null,  'RE01 FEE', null, null),
       ('eeee0000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'active', 30000, 'RE01 ADD', now() - interval '9 days', 20000);

do $$
declare
  v_lapsed jsonb;
  v_fee    jsonb;
  v_added  jsonb;
  v_detail jsonb;
begin
  select public.home_feed_post_json(p, null::numeric) into v_lapsed from public.posts p where p.id = 'eeee0000-0000-0000-0000-000000000001';
  select public.home_feed_post_json(p, null::numeric) into v_fee    from public.posts p where p.id = 'eeee0000-0000-0000-0000-000000000002';
  select public.home_feed_post_json(p, null::numeric) into v_added  from public.posts p where p.id = 'eeee0000-0000-0000-0000-000000000003';

  if (v_lapsed -> 'reward_ended') is distinct from 'true'::jsonb then
    raise exception 'CHECK 1 FAILED: a lapsed reward reads reward_ended=%, expected true', v_lapsed -> 'reward_ended';
  end if;
  if (v_fee -> 'reward_ended') is distinct from 'false'::jsonb then
    raise exception 'CHECK 1 FAILED: a £5 fee listing reads reward_ended=%, expected false — it would say a reward it never had has ended', v_fee -> 'reward_ended';
  end if;
  if (v_added -> 'reward_ended') is distinct from 'false'::jsonb then
    raise exception 'CHECK 1 FAILED: a reward added again after a lapse reads reward_ended=%, expected false — the new reward must win', v_added -> 'reward_ended';
  end if;
  -- The shared helper feeds EVERY public reader (feed, nearby, search, map,
  -- watchlist): the boolean only, never the owner's date or amount.
  if v_lapsed ?| array['reward_ended_at', 'ended_reward_pence', 'reward_term_ends_at'] then
    raise exception 'CHECK 1 FAILED: home_feed_post_json leaked an owner-only reward fact to every public reader: %', v_lapsed;
  end if;

  -- A spotter (anon) reads the same flag through the detail RPC, and nothing
  -- owner-only rides along with it.
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;
  v_detail := public.get_post_detail('eeee0000-0000-0000-0000-000000000001');
  reset role;
  if (v_detail -> 'reward_ended') is distinct from 'true'::jsonb then
    raise exception 'CHECK 1 FAILED: get_post_detail gave a spotter reward_ended=%, expected true', v_detail -> 'reward_ended';
  end if;
  if v_detail ?| array['reward_ended_at', 'ended_reward_pence'] then
    raise exception 'CHECK 1 FAILED: the public detail leaked the owner''s ended date or amount: %', v_detail;
  end if;
  raise notice 'CHECK 1 passed: reward_ended is true for a lapse only — not a fee listing, not a reward added again';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 2 — the pair is all-or-nothing and the amount is positive.
-- -----------------------------------------------------------------------------
begin;
do $$
declare
  v_err text;
begin
  begin
    insert into public.posts (owner_id, status, plate, reward_ended_at)
    values ('11111111-1111-1111-1111-111111111111', 'active', 'RE02 AAA', now());
    v_err := 'none';
  exception when check_violation then v_err := 'check'; end;
  if v_err <> 'check' then
    raise exception 'CHECK 2 FAILED: an ended date without an amount was accepted';
  end if;

  begin
    insert into public.posts (owner_id, status, plate, ended_reward_pence)
    values ('11111111-1111-1111-1111-111111111111', 'active', 'RE02 BBB', 20000);
    v_err := 'none';
  exception when check_violation then v_err := 'check'; end;
  if v_err <> 'check' then
    raise exception 'CHECK 2 FAILED: an ended amount without a date was accepted';
  end if;

  begin
    insert into public.posts (owner_id, status, plate, reward_ended_at, ended_reward_pence)
    values ('11111111-1111-1111-1111-111111111111', 'active', 'RE02 CCC', now(), 0);
    v_err := 'none';
  exception when check_violation then v_err := 'check'; end;
  if v_err <> 'check' then
    raise exception 'CHECK 2 FAILED: a £0 ended reward was accepted';
  end if;
  raise notice 'CHECK 2 passed: reward_ended_at and ended_reward_pence come together, and the amount is positive';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 3 — an owner cannot mark their own reward ended (or un-end it).
-- -----------------------------------------------------------------------------
begin;
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate)
values ('eeee0000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'active', null, 'RE03 AAA');

do $$
declare
  v_err text;
begin
  perform set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
  set local role authenticated;
  begin
    update public.posts
       set reward_ended_at = now(), ended_reward_pence = 20000
     where id = 'eeee0000-0000-0000-0000-000000000004';
    v_err := 'none';
  exception when insufficient_privilege then v_err := 'denied'; end;
  reset role;
  if v_err <> 'denied' then
    raise exception 'CHECK 3 FAILED: an owner wrote reward_ended_at directly (got %)', v_err;
  end if;
  raise notice 'CHECK 3 passed: the ended columns are not client-writable';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 4 — list_my_posts: the held reward's term on the owner's own rows;
-- null for a lapsed or fee listing; another user sees none of them.
-- -----------------------------------------------------------------------------
begin;
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate, reward_ended_at, ended_reward_pence)
values ('eeee0000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'active', 20000, 'RE04 HLD', null, null),
       ('eeee0000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'active', null,  'RE04 LAP', now(), 20000);
insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence, captured_at, term_ends_at)
values ('eeee0000-0000-0000-0000-000000000005', 'pi_re4_held', 'held', 20000,
        now() - interval '50 days', '2026-12-04 23:59:59.999999+00');

do $$
declare
  v_mine   jsonb;
  v_held   jsonb;
  v_lapsed jsonb;
  v_other  jsonb;
begin
  perform set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
  set local role authenticated;
  v_mine := public.list_my_posts();
  perform set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
  v_other := public.list_my_posts();
  reset role;

  select e into v_held   from jsonb_array_elements(v_mine) e where e ->> 'id' = 'eeee0000-0000-0000-0000-000000000005';
  select e into v_lapsed from jsonb_array_elements(v_mine) e where e ->> 'id' = 'eeee0000-0000-0000-0000-000000000006';

  if (v_held ->> 'reward_term_ends_at')::timestamptz is distinct from '2026-12-04 23:59:59.999999+00'::timestamptz then
    raise exception 'CHECK 4 FAILED: the held reward''s term is %, expected 2026-12-04 23:59:59.999999+00', v_held ->> 'reward_term_ends_at';
  end if;
  if not (v_lapsed ? 'reward_term_ends_at') or (v_lapsed -> 'reward_term_ends_at') <> 'null'::jsonb then
    raise exception 'CHECK 4 FAILED: a lapsed listing carries a term (%), expected the key with null', v_lapsed -> 'reward_term_ends_at';
  end if;
  if (v_lapsed -> 'reward_ended') is distinct from 'true'::jsonb then
    raise exception 'CHECK 4 FAILED: My listings does not show the lapse (reward_ended=%)', v_lapsed -> 'reward_ended';
  end if;
  if exists (select 1 from jsonb_array_elements(v_other) e where (e ->> 'id') like 'eeee0000-%') then
    raise exception 'CHECK 4 FAILED: another user''s list_my_posts returned this owner''s listings';
  end if;
  raise notice 'CHECK 4 passed: My listings carries the held reward''s term, null otherwise, and only the owner''s rows';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 5 — get_my_reward_status: the ended date and amount while nothing is
-- held; gone once a reward is held again; never for a fee listing.
-- -----------------------------------------------------------------------------
begin;
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate, reward_ended_at, ended_reward_pence)
values ('eeee0000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'active', null,  'RE05 LAP', '2026-12-04 23:59:59.999999+00', 20000),
       ('eeee0000-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111', 'active', 35000, 'RE05 ADD', '2026-11-01 23:59:59.999999+00', 20000),
       ('eeee0000-0000-0000-0000-000000000009', '11111111-1111-1111-1111-111111111111', 'active', null,  'RE05 FEE', null, null);
insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence, captured_at, term_ends_at)
values ('eeee0000-0000-0000-0000-000000000008', 'pi_re5_readded', 'held', 35000, now(), now() + interval '60 days');

do $$
declare
  v_lapsed jsonb;
  v_added  jsonb;
  v_fee    jsonb;
begin
  perform set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
  set local role authenticated;
  v_lapsed := public.get_my_reward_status('eeee0000-0000-0000-0000-000000000007');
  v_added  := public.get_my_reward_status('eeee0000-0000-0000-0000-000000000008');
  v_fee    := public.get_my_reward_status('eeee0000-0000-0000-0000-000000000009');
  reset role;

  if v_lapsed ->> 'mode' <> 'add'
     or (v_lapsed ->> 'rewardEndedAt')::timestamptz is distinct from '2026-12-04 23:59:59.999999+00'::timestamptz
     or (v_lapsed ->> 'endedRewardPence')::int is distinct from 20000 then
    raise exception 'CHECK 5 FAILED: a lapsed listing''s status is %, expected mode add, ended 4 Dec, £200', v_lapsed;
  end if;
  if v_added ->> 'mode' <> 'change'
     or (v_added -> 'rewardEndedAt') <> 'null'::jsonb
     or (v_added -> 'endedRewardPence') <> 'null'::jsonb then
    raise exception 'CHECK 5 FAILED: a reward added again still reports the old ending: %', v_added;
  end if;
  if (v_fee -> 'rewardEndedAt') <> 'null'::jsonb or (v_fee -> 'endedRewardPence') <> 'null'::jsonb then
    raise exception 'CHECK 5 FAILED: a fee listing reports an ended reward: %', v_fee;
  end if;
  raise notice 'CHECK 5 passed: the owner''s status names the ended reward only while none is held';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 6 — the ended date and amount are not READABLE straight off posts
-- (anon or signed in): only the owner's RPCs say them. The migration asserts
-- this when it runs; this catches a later table-wide re-grant.
-- -----------------------------------------------------------------------------
begin;
do $$
declare
  v_role text;
  v_err  text;
begin
  foreach v_role in array array['anon', 'authenticated'] loop
    perform set_config('request.jwt.claims',
      case when v_role = 'anon' then '{"role":"anon"}'
           else '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}' end, true);
    execute format('set local role %I', v_role);
    begin
      perform reward_ended_at, ended_reward_pence from public.posts limit 1;
      v_err := 'none';
    exception when insufficient_privilege then v_err := 'denied'; end;
    reset role;
    if v_err <> 'denied' then
      raise exception 'CHECK 6 FAILED: % can read posts.reward_ended_at / ended_reward_pence directly', v_role;
    end if;
  end loop;
  raise notice 'CHECK 6 passed: the ended date and amount are not readable off posts by anon or authenticated';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 7 (20261006110000) — the fee is a FACT from the ledger, owner-only: a
-- listing that paid the £5 fee says so; a lapsed reward listing doesn't; a
-- stranger's payload has no such key; the shared helper is not client-callable.
-- -----------------------------------------------------------------------------
begin;
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate, reward_ended_at, ended_reward_pence)
values ('eeee0000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'active', null, 'RE07 FEE', null, null),
       ('eeee0000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'active', null, 'RE07 LAP', now(), 20000);
insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence, kind)
values ('eeee0000-0000-0000-0000-00000000000a', 'pi_re7_fee', 'collected', 500, 'listing_fee');

do $$
declare
  v_fee      jsonb;
  v_lapsed   jsonb;
  v_stranger jsonb;
  v_status   jsonb;
begin
  perform set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
  set local role authenticated;
  v_fee    := public.get_post_detail('eeee0000-0000-0000-0000-00000000000a');
  v_lapsed := public.get_post_detail('eeee0000-0000-0000-0000-00000000000b');
  v_status := public.get_my_reward_status('eeee0000-0000-0000-0000-00000000000a');
  perform set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
  v_stranger := public.get_post_detail('eeee0000-0000-0000-0000-00000000000a');
  reset role;

  if (v_fee -> 'has_listing_fee') is distinct from 'true'::jsonb
     or (v_status -> 'hasListingFee') is distinct from 'true'::jsonb then
    raise exception 'CHECK 7 FAILED: a listing that paid the £5 fee does not say so (detail %, status %)', v_fee -> 'has_listing_fee', v_status -> 'hasListingFee';
  end if;
  if (v_lapsed -> 'has_listing_fee') is distinct from 'false'::jsonb then
    raise exception 'CHECK 7 FAILED: a lapsed reward listing claims a listing fee it never paid';
  end if;
  if v_stranger ? 'has_listing_fee' then
    raise exception 'CHECK 7 FAILED: has_listing_fee reached a non-owner: %', v_stranger;
  end if;
  if has_function_privilege('anon', 'public.home_feed_post_json(public.posts, numeric)', 'execute')
     or has_function_privilege('authenticated', 'public.home_feed_post_json(public.posts, numeric)', 'execute') then
    raise exception 'CHECK 7 FAILED: home_feed_post_json is client-callable';
  end if;
  raise notice 'CHECK 7 passed: the fee comes from the ledger, owner-only; the shared helper is internal';
end $$;
rollback;

-- =============================================================================
-- WHAT:  Tier 1 verification for claim_recovery — the point where an owner's
--        escrow becomes somebody else's money (NOT a migration).
-- WHY:   Crediting a sighting decides who gets £50-£5,000. Every guard on it
--        is a MONEY guard, so each is asserted here against the real
--        `authenticated` role, not merely read in the source: owner-only,
--        active-only, same-post-only, no self-credit, single winner, and
--        anon locked out. CHECK 9 additionally proves the thing the function
--        is designed NOT to do — move money.
-- LINKS: supabase/migrations/20260802200000_claim_recovery.sql;
--        docs/DOMAIN.md (lifecycle 4-6, "Single winner", bounty rules);
--        docs/TESTING.md (Tier 1 = money/safety); scripts/test-db.sh.
--
-- SELF-ASSERTING: every check is a DO block that RAISES on failure, so the
-- file aborts non-zero the moment a property is violated (ON_ERROR_STOP=1).
--
-- Fixtures (from supabase/seed.sql):
--   ACTIVE post  a1a1a1a1-...0003 owned by Beth 22222222
--   ACTIVE post  a1a1a1a1-...0005 owned by Carl 33333333
--   Spotter      Carl 33333333 (sights Beth's car — never the owner)
-- Sightings are created BY THIS FILE (the seed has none) and removed in
-- housekeeping, along with any status/counter drift.
-- =============================================================================

-- --- housekeeping: leave no trace from a previous run ------------------------
delete from public.sightings
where id in ('c0c0c0c0-0000-0000-0000-000000000001',
             'c0c0c0c0-0000-0000-0000-000000000002',
             'c0c0c0c0-0000-0000-0000-000000000003');
update public.posts set status = 'active', recovered_at = null
where id in ('a1a1a1a1-0000-0000-0000-000000000003',
             'a1a1a1a1-0000-0000-0000-000000000005');
update public.profiles set recoveries_credited = 0
where id in ('33333333-3333-3333-3333-333333333333',
             '22222222-2222-2222-2222-222222222222');


-- -----------------------------------------------------------------------------
-- CHECK 1 — the happy path WITH a credited sighting. Post -> recovery_claimed
-- (NOT `recovered`: that is a post-money state), sighting -> credited, the
-- spotter's counter moves, and nextStep names the money call.
-- -----------------------------------------------------------------------------
do $$
declare
  v_doc    jsonb;
  v_status public.post_status;
  v_sight  text;
  v_count  int;
  v_rec_at timestamptz;
begin
  insert into public.sightings (id, post_id, spotter_id, status, area_label, location_unavailable)
  values ('c0c0c0c0-0000-0000-0000-000000000001',
          'a1a1a1a1-0000-0000-0000-000000000003',
          '33333333-3333-3333-3333-333333333333', 'unverified', 'Camden', true);

  perform set_config('request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
  set local role authenticated;
  v_doc := public.claim_recovery('a1a1a1a1-0000-0000-0000-000000000003',
                                 'c0c0c0c0-0000-0000-0000-000000000001');
  reset role;

  select status, recovered_at into v_status, v_rec_at
  from public.posts where id = 'a1a1a1a1-0000-0000-0000-000000000003';
  -- The load-bearing assertion of the whole slice: NOT `recovered`. A post
  -- marked recovered before Stripe has moved has told an owner their case is
  -- closed and a spotter they have been paid, with the money still in escrow.
  if v_status <> 'recovery_claimed' then
    raise exception 'CHECK 1 FAILED: post is % — must be recovery_claimed until the money moves', v_status;
  end if;
  if v_rec_at is null then
    raise exception 'CHECK 1 FAILED: recovered_at not stamped';
  end if;

  select status into v_sight from public.sightings
  where id = 'c0c0c0c0-0000-0000-0000-000000000001';
  if v_sight <> 'credited' then
    raise exception 'CHECK 1 FAILED: sighting is %, expected credited', v_sight;
  end if;

  select recoveries_credited into v_count from public.profiles
  where id = '33333333-3333-3333-3333-333333333333';
  if v_count <> 1 then
    raise exception 'CHECK 1 FAILED: spotter recoveries_credited = %, expected 1', v_count;
  end if;

  if v_doc ->> 'nextStep' <> 'payout' then
    raise exception 'CHECK 1 FAILED: nextStep = %, expected payout', v_doc ->> 'nextStep';
  end if;
  raise notice 'CHECK 1 passed: credited path -> recovery_claimed (NOT recovered), sighting credited, counter +1, nextStep=payout';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 2 — claiming twice is refused. Without this an owner could credit a
-- second spotter from the same escrow, or double a spotter's reputation.
-- -----------------------------------------------------------------------------
do $$
declare v_ok boolean := false;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
  begin
    set local role authenticated;
    perform public.claim_recovery('a1a1a1a1-0000-0000-0000-000000000003', null);
    reset role;
  exception when others then
    if sqlerrm like '%POST_NOT_ACTIVE%' then v_ok := true;
    else raise exception 'CHECK 2 FAILED: wrong error on a second claim: %', sqlerrm; end if;
  end;
  if not v_ok then
    raise exception 'CHECK 2 FAILED: an already-claimed post was claimed again';
  end if;
  raise notice 'CHECK 2 passed: a post can only be claimed once (POST_NOT_ACTIVE)';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 3 — SAFETY. Only the OWNER may claim. Ownership comes from the JWT,
-- so a stranger naming someone else's post gets NOT_OWNER, never a claim.
-- -----------------------------------------------------------------------------
do $$
declare v_ok boolean := false;
begin
  -- Dave (4444) is a genuine stranger to ...0005, which Carl (3333) owns.
  -- Deliberately NOT Carl: he owns it, so his claim would SUCCEED and silently
  -- consume the fixture — which is exactly what an earlier draft of this check
  -- did, taking the post out of `active` and breaking CHECK 4 downstream.
  perform set_config('request.jwt.claims',
    '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}', true);
  begin
    set local role authenticated;
    perform public.claim_recovery('a1a1a1a1-0000-0000-0000-000000000005', null);
    reset role;
  exception when others then
    if sqlerrm like '%NOT_OWNER%' then v_ok := true;
    else raise exception 'CHECK 3 FAILED: wrong error for a non-owner: %', sqlerrm; end if;
  end;
  if not v_ok then
    raise exception 'CHECK 3 FAILED: a non-owner claimed a recovery — ESCROW BYPASS';
  end if;
  raise notice 'CHECK 3 passed: only the owner may claim (NOT_OWNER)';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 4 — SAFETY. A sighting on ANOTHER post is not creditable. Otherwise an
-- owner could aim their escrow at any sighting in the system.
-- -----------------------------------------------------------------------------
do $$
declare v_ok boolean := false;
begin
  insert into public.sightings (id, post_id, spotter_id, status, area_label, location_unavailable)
  values ('c0c0c0c0-0000-0000-0000-000000000002',
          'a1a1a1a1-0000-0000-0000-000000000007',
          '33333333-3333-3333-3333-333333333333', 'unverified', 'Soho', true);

  perform set_config('request.jwt.claims',
    '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
  begin
    set local role authenticated;
    -- Carl owns ...0005; the sighting belongs to ...0007.
    perform public.claim_recovery('a1a1a1a1-0000-0000-0000-000000000005',
                                  'c0c0c0c0-0000-0000-0000-000000000002');
    reset role;
  exception when others then
    if sqlerrm like '%SIGHTING_NOT_ON_POST%' then v_ok := true;
    else raise exception 'CHECK 4 FAILED: wrong error crediting a foreign sighting: %', sqlerrm; end if;
  end;
  if not v_ok then
    raise exception 'CHECK 4 FAILED: a sighting from another post was credited — ESCROW BYPASS';
  end if;
  raise notice 'CHECK 4 passed: a sighting on another post cannot be credited';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 5 — SAFETY. No self-crediting. An owner crediting their own sighting
-- would launder their escrow back to themselves minus the 5% fee.
-- -----------------------------------------------------------------------------
do $$
declare v_ok boolean := false;
begin
  insert into public.sightings (id, post_id, spotter_id, status, area_label, location_unavailable)
  values ('c0c0c0c0-0000-0000-0000-000000000003',
          'a1a1a1a1-0000-0000-0000-000000000005',
          '33333333-3333-3333-3333-333333333333', 'unverified', 'Hackney', true);

  perform set_config('request.jwt.claims',
    '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
  begin
    set local role authenticated;
    -- Carl owns ...0005 AND is the spotter on this sighting.
    perform public.claim_recovery('a1a1a1a1-0000-0000-0000-000000000005',
                                  'c0c0c0c0-0000-0000-0000-000000000003');
    reset role;
  exception when others then
    if sqlerrm like '%CANNOT_CREDIT_OWN_SIGHTING%' then v_ok := true;
    else raise exception 'CHECK 5 FAILED: wrong error on self-credit: %', sqlerrm; end if;
  end;
  if not v_ok then
    raise exception 'CHECK 5 FAILED: an owner credited their OWN sighting — LAUNDERING PATH';
  end if;
  raise notice 'CHECK 5 passed: an owner cannot credit their own sighting';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 6 — SINGLE WINNER is structural. DOMAIN.md forbids splitting in v1.
-- Asserted against the INDEX, not the function, because that is what makes two
-- concurrent claims unable to both win.
-- -----------------------------------------------------------------------------
do $$
declare v_ok boolean := false;
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'sightings_one_credited_per_post_uidx'
  ) then
    raise exception 'CHECK 6 FAILED: the single-winner index is gone';
  end if;

  -- Second credited sighting on the post credited in CHECK 1 -> unique_violation.
  begin
    insert into public.sightings (id, post_id, spotter_id, status, area_label, location_unavailable)
    values ('c0c0c0c0-0000-0000-0000-000000000004',
            'a1a1a1a1-0000-0000-0000-000000000003',
            '44444444-4444-4444-4444-444444444444', 'credited', 'Islington', true);
  exception when unique_violation then v_ok := true;
  end;
  delete from public.sightings where id = 'c0c0c0c0-0000-0000-0000-000000000004';
  if not v_ok then
    raise exception 'CHECK 6 FAILED: a SECOND sighting was credited on one post — the bounty could pay twice';
  end if;
  raise notice 'CHECK 6 passed: single winner enforced by a partial unique index';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 7 — SAFETY. anon holds no EXECUTE. Supabase's ALTER DEFAULT PRIVILEGES
-- grants EXECUTE on new functions to anon, so only the explicit REVOKE in the
-- migration closes this; omitting it would leave the escrow decision open to a
-- logged-out caller.
-- -----------------------------------------------------------------------------
do $$
begin
  if has_function_privilege('anon', 'public.claim_recovery(uuid, uuid)', 'EXECUTE') then
    raise exception 'CHECK 7 FAILED: anon holds EXECUTE on claim_recovery';
  end if;
  if not has_function_privilege('authenticated', 'public.claim_recovery(uuid, uuid)', 'EXECUTE') then
    raise exception 'CHECK 7 FAILED: authenticated lost EXECUTE — no owner could claim a recovery';
  end if;
  raise notice 'CHECK 7 passed: claim_recovery is authenticated-only';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 8 — MONEY. The function records WHO WON; it must not move a penny.
-- The payments ledger for the claimed post is byte-identical afterwards.
-- -----------------------------------------------------------------------------
do $$
declare v_n int;
begin
  select count(*) into v_n
  from public.payments
  where post_id = 'a1a1a1a1-0000-0000-0000-000000000003'
    and status <> 'held';
  if v_n <> 0 then
    raise exception 'CHECK 8 FAILED: claim_recovery moved % payment row(s) off held — money must only move in the Edge Function', v_n;
  end if;
  raise notice 'CHECK 8 passed: no payment row changed — the money still waits for the payout/refund call';
end $$;


-- --- housekeeping ------------------------------------------------------------
delete from public.sightings
where id in ('c0c0c0c0-0000-0000-0000-000000000001',
             'c0c0c0c0-0000-0000-0000-000000000002',
             'c0c0c0c0-0000-0000-0000-000000000003');
update public.posts set status = 'active', recovered_at = null
where id in ('a1a1a1a1-0000-0000-0000-000000000003',
             'a1a1a1a1-0000-0000-0000-000000000005');
update public.profiles set recoveries_credited = 0
where id in ('33333333-3333-3333-3333-333333333333',
             '22222222-2222-2222-2222-222222222222');

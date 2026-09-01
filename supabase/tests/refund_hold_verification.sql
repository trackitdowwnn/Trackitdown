-- =============================================================================
-- WHAT:  Tier 1 verification for the owner-denial control — the refund-hold
--        trigger, the attestation gate, the spotter's dispute lever, and the
--        by-hand resolution that can credit a spotter AFTER the post closed.
--        NOT a migration.
-- WHY:   These functions decide whether £50-£5,000 goes back to an owner who
--        may be lying or on to the spotter who found the car. Every gate is a
--        MONEY guard: the 14-day boundary decides whose refund waits, the
--        single refusal token keeps open_dispute from being an oracle, and
--        resolve_sighting_dispute has claim_recovery's power (it turns escrow
--        into someone else's money) so it re-proves claim_recovery's guards.
--
-- CHECKS: 1 trigger boundary (14 days, helpful in, credited out) ·
-- 2 exit_check owner-gated, no oracle · 3 attestation-stale ·
-- 4 hold happy path (post delists, pushes claimed+built, copy) ·
-- 5 hold idempotent + NO_HOLD_REQUIRED · 6 open_dispute happy + every
-- refusal is the same token · 7 my_dispute_context own-only ·
-- 8 resolve rejected stamps; upheld credits + counter + post back on the
-- money rails + sibling auto-reject; DISPUTE_NOT_OPEN replay ·
-- 9 no-resurrection (NO_HOLD) + no self-credit · 10 grants + NO MONEY MOVED ·
-- 11 my_sighting_record's `dispute` agrees with my_dispute_context's gate, so
-- the in-app door never opens onto DISPUTE_NOT_AVAILABLE.
-- LINKS: supabase/migrations/20260805100000_refund_holds_and_disputes.sql;
--        docs/DOMAIN.md (Disputes); docs/TESTING.md; scripts/test-db.sh.
--
-- SELF-ASSERTING: every check RAISES on failure (ON_ERROR_STOP=1).
--
-- Fixtures (from supabase/seed.sql):
--   ACTIVE post a1a1a1a1-...0003 owned by Beth 22222222 (make Ford in seed)
--   ACTIVE post a1a1a1a1-...0005 owned by Carl 33333333 (no sightings)
--   Spotters: Carl 33333333, Alex 11111111, Dana 44444444
-- Sightings d0d0d0d0-...01..05, payment pi_test_refund_hold, the hold and
-- disputes are created BY THIS FILE and removed in housekeeping.
-- =============================================================================

-- --- housekeeping: leave no trace from a previous run ------------------------
delete from public.refund_disputes
 where post_id in ('a1a1a1a1-0000-0000-0000-000000000003',
                   'a1a1a1a1-0000-0000-0000-000000000005');
delete from public.refund_holds
 where post_id in ('a1a1a1a1-0000-0000-0000-000000000003',
                   'a1a1a1a1-0000-0000-0000-000000000005');
delete from public.payments where stripe_payment_intent_id = 'pi_test_refund_hold';
delete from public.sightings
 where id in ('d0d0d0d0-0000-0000-0000-000000000001',
              'd0d0d0d0-0000-0000-0000-000000000002',
              'd0d0d0d0-0000-0000-0000-000000000003',
              'd0d0d0d0-0000-0000-0000-000000000004',
              'd0d0d0d0-0000-0000-0000-000000000005',
              -- CHECK 11's throwaway: a sighting on the held post that the hold
              -- does NOT name. Deleted inside the check too, but listed here so
              -- a mid-check failure cannot leak it into the next run.
              'd0d0d0d0-0000-0000-0000-000000000009');
update public.posts set status = 'active', recovered_at = null
 where id in ('a1a1a1a1-0000-0000-0000-000000000003',
              'a1a1a1a1-0000-0000-0000-000000000005');
update public.profiles set recoveries_credited = 0
 where id = '33333333-3333-3333-3333-333333333333';

-- --- fixtures ----------------------------------------------------------------
-- A held escrow on Beth's post (open_dispute and my_dispute_context join it).
insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence)
values ('a1a1a1a1-0000-0000-0000-000000000003', 'pi_test_refund_hold', 'held', 20000);

-- s1 Carl (fresh) · s2 Alex (15 days old — OUTSIDE) · s4 Dana (fresh)
insert into public.sightings (id, post_id, spotter_id, status, area_label, location_unavailable, created_at)
values
  ('d0d0d0d0-0000-0000-0000-000000000001', 'a1a1a1a1-0000-0000-0000-000000000003',
   '33333333-3333-3333-3333-333333333333', 'unverified', 'Camden', true, now()),
  ('d0d0d0d0-0000-0000-0000-000000000002', 'a1a1a1a1-0000-0000-0000-000000000003',
   '11111111-1111-1111-1111-111111111111', 'unverified', 'Islington', true, now() - interval '15 days'),
  ('d0d0d0d0-0000-0000-0000-000000000004', 'a1a1a1a1-0000-0000-0000-000000000003',
   '44444444-4444-4444-4444-444444444444', 'unverified', 'Hackney', true, now());


-- -----------------------------------------------------------------------------
-- CHECK 1 — the trigger boundary IS the money boundary. 15 days out; 13 days
-- in; `helpful` in (the owner themselves called it useful); `credited` out.
-- -----------------------------------------------------------------------------
do $$
declare v_ids uuid[];
begin
  select coalesce(array_agg(id), '{}') into v_ids
    from public.recent_uncredited_sightings('a1a1a1a1-0000-0000-0000-000000000003') as t(id);
  if v_ids @> array['d0d0d0d0-0000-0000-0000-000000000002'::uuid] then
    raise exception 'CHECK 1 FAILED: a 15-day-old sighting held up a refund';
  end if;
  if not (v_ids @> array['d0d0d0d0-0000-0000-0000-000000000001'::uuid,
                         'd0d0d0d0-0000-0000-0000-000000000004'::uuid]) then
    raise exception 'CHECK 1 FAILED: fresh sightings missing from the trigger set';
  end if;

  -- Pull s2 inside the window: now it must count...
  update public.sightings set created_at = now() - interval '13 days'
   where id = 'd0d0d0d0-0000-0000-0000-000000000002';
  -- ...and `helpful` must keep counting.
  update public.sightings set status = 'helpful'
   where id = 'd0d0d0d0-0000-0000-0000-000000000002';
  select coalesce(array_agg(id), '{}') into v_ids
    from public.recent_uncredited_sightings('a1a1a1a1-0000-0000-0000-000000000003') as t(id);
  if not (v_ids @> array['d0d0d0d0-0000-0000-0000-000000000002'::uuid]) then
    raise exception 'CHECK 1 FAILED: a helpful 13-day-old sighting did not count';
  end if;

  -- credited never triggers a hold (that money already has an owner). Proven
  -- on a throwaway sighting so the single-winner index stays clean for CHECK 8.
  insert into public.sightings (id, post_id, spotter_id, status, area_label, location_unavailable)
  values ('d0d0d0d0-0000-0000-0000-000000000005', 'a1a1a1a1-0000-0000-0000-000000000003',
          '44444444-4444-4444-4444-444444444444', 'credited', 'Hackney', true);
  select coalesce(array_agg(id), '{}') into v_ids
    from public.recent_uncredited_sightings('a1a1a1a1-0000-0000-0000-000000000003') as t(id);
  if v_ids @> array['d0d0d0d0-0000-0000-0000-000000000005'::uuid] then
    raise exception 'CHECK 1 FAILED: a credited sighting appeared in the trigger set';
  end if;
  delete from public.sightings where id = 'd0d0d0d0-0000-0000-0000-000000000005';
end $$;

-- -----------------------------------------------------------------------------
-- CHECK 2 — exit_check: the owner learns what they must attest to; anyone
-- else gets POST_NOT_FOUND (missing and not-yours are the same answer).
-- -----------------------------------------------------------------------------
do $$
declare v_doc jsonb; v_failed boolean := false;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
  set local role authenticated;
  v_doc := public.exit_check('a1a1a1a1-0000-0000-0000-000000000003');
  reset role;

  if (v_doc->>'requiresAttestation')::boolean is distinct from true then
    raise exception 'CHECK 2 FAILED: owner with recent sightings not asked to attest';
  end if;
  if jsonb_array_length(v_doc->'sightingIds') <> 3 then
    raise exception 'CHECK 2 FAILED: expected 3 sighting ids, got %', v_doc->'sightingIds';
  end if;

  perform set_config('request.jwt.claims',
    '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
  set local role authenticated;
  begin
    v_doc := public.exit_check('a1a1a1a1-0000-0000-0000-000000000003');
    v_failed := true;
  exception when others then
    if sqlerrm <> 'POST_NOT_FOUND' then
      reset role;
      raise exception 'CHECK 2 FAILED: non-owner got % — must be POST_NOT_FOUND', sqlerrm;
    end if;
  end;
  reset role;
  if v_failed then
    raise exception 'CHECK 2 FAILED: a non-owner read another owner''s exit check';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- CHECK 3 — ATTESTATION_STALE: the owner attested to less than reality (a
-- sighting landed between pre-flight and confirm). The hold must refuse.
-- -----------------------------------------------------------------------------
do $$
declare v_doc jsonb; v_failed boolean := false;
begin
  begin
    v_doc := public.create_refund_hold(
      'a1a1a1a1-0000-0000-0000-000000000003',
      '22222222-2222-2222-2222-222222222222',
      'deactivate',
      array['d0d0d0d0-0000-0000-0000-000000000001'::uuid]);  -- missing s2, s4
    v_failed := true;
  exception when others then
    if sqlerrm <> 'ATTESTATION_STALE' then
      raise exception 'CHECK 3 FAILED: got % — must be ATTESTATION_STALE', sqlerrm;
    end if;
  end;
  if v_failed then
    raise exception 'CHECK 3 FAILED: a stale attestation was accepted';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- CHECK 4 — the hold happy path: post delists NOW, hold recorded with the
-- attested evidence, pushes claimed once and carrying the SQL-built copy.
-- -----------------------------------------------------------------------------
do $$
declare
  v_doc jsonb; v_status public.post_status; v_path text; v_claimed int;
begin
  v_doc := public.create_refund_hold(
    'a1a1a1a1-0000-0000-0000-000000000003',
    '22222222-2222-2222-2222-222222222222',
    'deactivate',
    array['d0d0d0d0-0000-0000-0000-000000000001'::uuid,
          'd0d0d0d0-0000-0000-0000-000000000002'::uuid,
          'd0d0d0d0-0000-0000-0000-000000000004'::uuid]);

  if (v_doc->>'held')::boolean is distinct from true then
    raise exception 'CHECK 4 FAILED: hold not created';
  end if;
  if jsonb_array_length(v_doc->'notify') <> 3 then
    raise exception 'CHECK 4 FAILED: expected 3 pushes, got %', v_doc->'notify';
  end if;
  if v_doc->'notify'->0->>'title' <> 'Did your sighting help find it?' then
    raise exception 'CHECK 4 FAILED: push copy drifted: %', v_doc->'notify'->0->>'title';
  end if;

  select status into v_status from public.posts
   where id = 'a1a1a1a1-0000-0000-0000-000000000003';
  if v_status <> 'cancelled' then
    raise exception 'CHECK 4 FAILED: post is % — the listing must delist NOW', v_status;
  end if;

  select exit_path into v_path from public.refund_holds
   where post_id = 'a1a1a1a1-0000-0000-0000-000000000003';
  if v_path is distinct from 'deactivate' then
    raise exception 'CHECK 4 FAILED: hold missing or wrong exit_path (%)', v_path;
  end if;

  select count(*) into v_claimed from public.sightings
   where post_id = 'a1a1a1a1-0000-0000-0000-000000000003'
     and closed_notified_at is not null;
  if v_claimed <> 3 then
    raise exception 'CHECK 4 FAILED: % pushes claimed, expected 3', v_claimed;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- CHECK 5 — idempotent replay sends NOTHING again; a post with no recent
-- sightings must not be held at all (NO_HOLD_REQUIRED — the caller refunds).
-- -----------------------------------------------------------------------------
do $$
declare v_doc jsonb; v_failed boolean := false;
begin
  v_doc := public.create_refund_hold(
    'a1a1a1a1-0000-0000-0000-000000000003',
    '22222222-2222-2222-2222-222222222222',
    'deactivate',
    array['d0d0d0d0-0000-0000-0000-000000000001'::uuid,
          'd0d0d0d0-0000-0000-0000-000000000002'::uuid,
          'd0d0d0d0-0000-0000-0000-000000000004'::uuid]);
  if jsonb_array_length(v_doc->'notify') <> 0 then
    raise exception 'CHECK 5 FAILED: a replayed hold re-sent pushes';
  end if;

  begin
    v_doc := public.create_refund_hold(
      'a1a1a1a1-0000-0000-0000-000000000005',
      '33333333-3333-3333-3333-333333333333',
      'deactivate', array['d0d0d0d0-0000-0000-0000-000000000001'::uuid]);
    v_failed := true;
  exception when others then
    if sqlerrm <> 'NO_HOLD_REQUIRED' then
      raise exception 'CHECK 5 FAILED: got % — must be NO_HOLD_REQUIRED', sqlerrm;
    end if;
  end;
  if v_failed then
    raise exception 'CHECK 5 FAILED: a hold was created with nothing to hold for';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- CHECK 6 — open_dispute: the happy path files once; the replay, another
-- spotter's sighting, and a closed window all get the IDENTICAL token.
-- -----------------------------------------------------------------------------
do $$
declare v_doc jsonb; v_err text;
begin
  -- Carl files on his own sighting.
  perform set_config('request.jwt.claims',
    '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
  set local role authenticated;
  v_doc := public.open_dispute('d0d0d0d0-0000-0000-0000-000000000001', 'I found it on Monday.');
  reset role;
  if v_doc->>'disputeId' is null then
    raise exception 'CHECK 6 FAILED: dispute not filed';
  end if;

  -- Replay: same token.
  perform set_config('request.jwt.claims',
    '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
  set local role authenticated;
  begin
    v_doc := public.open_dispute('d0d0d0d0-0000-0000-0000-000000000001', null);
    v_err := 'no error';
  exception when others then v_err := sqlerrm; end;
  reset role;
  if v_err <> 'DISPUTE_NOT_AVAILABLE' then
    raise exception 'CHECK 6 FAILED: replay got % — must be DISPUTE_NOT_AVAILABLE', v_err;
  end if;

  -- Someone else's sighting: same token (no oracle).
  perform set_config('request.jwt.claims',
    '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}', true);
  set local role authenticated;
  begin
    v_doc := public.open_dispute('d0d0d0d0-0000-0000-0000-000000000001', null);
    v_err := 'no error';
  exception when others then v_err := sqlerrm; end;
  reset role;
  if v_err <> 'DISPUTE_NOT_AVAILABLE' then
    raise exception 'CHECK 6 FAILED: foreign sighting got % — must be DISPUTE_NOT_AVAILABLE', v_err;
  end if;

  -- Window closed: same token. Then reopened so Alex and Dana can file for
  -- the resolution checks.
  update public.refund_holds set expires_at = now() - interval '1 hour'
   where post_id = 'a1a1a1a1-0000-0000-0000-000000000003';
  perform set_config('request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
  set local role authenticated;
  begin
    v_doc := public.open_dispute('d0d0d0d0-0000-0000-0000-000000000002', null);
    v_err := 'no error';
  exception when others then v_err := sqlerrm; end;
  reset role;
  if v_err <> 'DISPUTE_NOT_AVAILABLE' then
    raise exception 'CHECK 6 FAILED: closed window got % — must be DISPUTE_NOT_AVAILABLE', v_err;
  end if;

  update public.refund_holds set expires_at = now() + interval '72 hours'
   where post_id = 'a1a1a1a1-0000-0000-0000-000000000003';
  perform set_config('request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
  set local role authenticated;
  v_doc := public.open_dispute('d0d0d0d0-0000-0000-0000-000000000002', 'It was me.');
  reset role;
  perform set_config('request.jwt.claims',
    '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}', true);
  set local role authenticated;
  v_doc := public.open_dispute('d0d0d0d0-0000-0000-0000-000000000004', null);
  reset role;
end $$;

-- -----------------------------------------------------------------------------
-- CHECK 7 — my_dispute_context: the spotter's own read works and carries the
-- payout share; anyone else's sighting is the same single token.
-- -----------------------------------------------------------------------------
do $$
declare v_doc jsonb; v_err text;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
  set local role authenticated;
  v_doc := public.my_dispute_context('d0d0d0d0-0000-0000-0000-000000000001');
  reset role;
  if v_doc->'dispute'->>'status' is distinct from 'open' then
    raise exception 'CHECK 7 FAILED: own dispute not visible: %', v_doc;
  end if;
  if (v_doc->>'bountySharePence')::int <> 19000 then
    raise exception 'CHECK 7 FAILED: share is % — payout_split(20000) says 19000', v_doc->>'bountySharePence';
  end if;

  perform set_config('request.jwt.claims',
    '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
  set local role authenticated;
  begin
    v_doc := public.my_dispute_context('d0d0d0d0-0000-0000-0000-000000000002');
    v_err := 'no error';
  exception when others then v_err := sqlerrm; end;
  reset role;
  if v_err <> 'DISPUTE_NOT_AVAILABLE' then
    raise exception 'CHECK 7 FAILED: foreign context got % — must be DISPUTE_NOT_AVAILABLE', v_err;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- CHECK 8 — resolution. Rejected stamps and stops. Upheld credits the
-- sighting, moves the counter, puts the post BACK ON THE MONEY RAILS
-- (recovery_claimed — release-payout takes it unchanged), and auto-rejects
-- the sibling open dispute. A resolved dispute cannot be resolved again.
-- -----------------------------------------------------------------------------
do $$
declare
  v_doc jsonb; v_err text; v_status public.post_status;
  v_sight text; v_count int; v_dana uuid; v_carl uuid; v_alex uuid;
begin
  select id into v_carl from public.refund_disputes where sighting_id = 'd0d0d0d0-0000-0000-0000-000000000001';
  select id into v_alex from public.refund_disputes where sighting_id = 'd0d0d0d0-0000-0000-0000-000000000002';
  select id into v_dana from public.refund_disputes where sighting_id = 'd0d0d0d0-0000-0000-0000-000000000004';

  -- Rejected: stamped, final, blocks nothing.
  v_doc := public.resolve_sighting_dispute(v_dana, false);
  if v_doc->>'resolved' <> 'rejected' then
    raise exception 'CHECK 8 FAILED: rejection did not stamp';
  end if;

  -- Upheld: Carl wins.
  v_doc := public.resolve_sighting_dispute(v_carl, true);
  if v_doc->>'resolved' <> 'upheld' then
    raise exception 'CHECK 8 FAILED: uphold did not resolve';
  end if;

  select status into v_sight from public.sightings
   where id = 'd0d0d0d0-0000-0000-0000-000000000001';
  if v_sight <> 'credited' then
    raise exception 'CHECK 8 FAILED: upheld sighting is % — must be credited', v_sight;
  end if;
  select recoveries_credited into v_count from public.profiles
   where id = '33333333-3333-3333-3333-333333333333';
  if v_count <> 1 then
    raise exception 'CHECK 8 FAILED: recoveries_credited is % — must be 1', v_count;
  end if;
  select status into v_status from public.posts
   where id = 'a1a1a1a1-0000-0000-0000-000000000003';
  if v_status <> 'recovery_claimed' then
    raise exception 'CHECK 8 FAILED: post is % — must be back on recovery_claimed for release-payout', v_status;
  end if;
  -- The sibling open dispute lost by construction.
  if (select status from public.refund_disputes where id = v_alex) <> 'rejected' then
    raise exception 'CHECK 8 FAILED: sibling open dispute was not auto-rejected';
  end if;

  -- Replay: a resolved dispute is closed business.
  begin
    v_doc := public.resolve_sighting_dispute(v_carl, false);
    v_err := 'no error';
  exception when others then v_err := sqlerrm; end;
  if v_err <> 'DISPUTE_NOT_OPEN' then
    raise exception 'CHECK 8 FAILED: re-resolve got % — must be DISPUTE_NOT_OPEN', v_err;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- CHECK 9 — the two hard refusals on the upheld path: no resurrecting a post
-- that was never held (NO_HOLD), and no crediting the owner's own sighting.
-- -----------------------------------------------------------------------------
do $$
declare v_doc jsonb; v_err text; v_id uuid;
begin
  -- A dispute row on a post with NO hold (inserted directly — the service
  -- role could, so the function must still refuse).
  insert into public.sightings (id, post_id, spotter_id, status, area_label, location_unavailable)
  values ('d0d0d0d0-0000-0000-0000-000000000003', 'a1a1a1a1-0000-0000-0000-000000000005',
          '11111111-1111-1111-1111-111111111111', 'unverified', 'Soho', true);
  insert into public.refund_disputes (post_id, sighting_id, spotter_id)
  values ('a1a1a1a1-0000-0000-0000-000000000005', 'd0d0d0d0-0000-0000-0000-000000000003',
          '11111111-1111-1111-1111-111111111111')
  returning id into v_id;

  begin
    v_doc := public.resolve_sighting_dispute(v_id, true);
    v_err := 'no error';
  exception when others then v_err := sqlerrm; end;
  if v_err <> 'NO_HOLD' then
    raise exception 'CHECK 9 FAILED: got % — an unheld post must never be resurrected (NO_HOLD)', v_err;
  end if;

  -- Owner's own sighting: the laundering round-trip, refused at the money
  -- boundary exactly as claim_recovery refuses it.
  update public.refund_disputes
     set spotter_id = '33333333-3333-3333-3333-333333333333'
   where id = v_id;
  update public.sightings
     set spotter_id = '33333333-3333-3333-3333-333333333333'
   where id = 'd0d0d0d0-0000-0000-0000-000000000003';
  insert into public.refund_holds (post_id, owner_id, exit_path, sighting_ids, expires_at)
  values ('a1a1a1a1-0000-0000-0000-000000000005', '33333333-3333-3333-3333-333333333333',
          'deactivate', array['d0d0d0d0-0000-0000-0000-000000000003'::uuid], now() + interval '72 hours');

  begin
    v_doc := public.resolve_sighting_dispute(v_id, true);
    v_err := 'no error';
  exception when others then v_err := sqlerrm; end;
  if v_err <> 'CANNOT_CREDIT_OWN_SIGHTING' then
    raise exception 'CHECK 9 FAILED: got % — must be CANNOT_CREDIT_OWN_SIGHTING', v_err;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- CHECK 10 — grants (deny-by-default held) and NO MONEY MOVED: everything
-- above ran and the payment row never left `held`. SQL records who won;
-- Stripe moves money; the sweep and release-payout are the only movers.
-- -----------------------------------------------------------------------------
do $$
declare v_status public.payment_status;
begin
  if has_function_privilege('anon', 'public.exit_check(uuid)', 'execute')
     or has_function_privilege('anon', 'public.open_dispute(uuid, text)', 'execute')
     or has_function_privilege('anon', 'public.my_dispute_context(uuid)', 'execute') then
    raise exception 'CHECK 10 FAILED: anon can execute a dispute function';
  end if;
  if has_function_privilege('authenticated', 'public.create_refund_hold(uuid, uuid, text, uuid[])', 'execute')
     or has_function_privilege('authenticated', 'public.resolve_sighting_dispute(uuid, boolean)', 'execute') then
    raise exception 'CHECK 10 FAILED: authenticated can execute a service-role-only function';
  end if;
  if not has_function_privilege('authenticated', 'public.exit_check(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.open_dispute(uuid, text)', 'execute') then
    raise exception 'CHECK 10 FAILED: authenticated lost a function it needs';
  end if;

  select status into v_status from public.payments
   where stripe_payment_intent_id = 'pi_test_refund_hold';
  if v_status <> 'held' then
    raise exception 'CHECK 10 FAILED: payment is % — SQL must never move money', v_status;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- CHECK 11 — my_sighting_record's `dispute` object AGREES with
-- my_dispute_context's gate. Added 2026-09-01 with the in-app dispute door.
-- -----------------------------------------------------------------------------
-- ⚠️ THIS IS THE CHECK THAT MATTERS FOR THE DOOR. `My reports` decides whether
-- to show a way in from `available`, and the dispute screen then re-reads
-- my_dispute_context and refuses with DISPUTE_NOT_AVAILABLE if it disagrees.
-- Two functions, one rule, duplicated by hand — so the failure mode is a button
-- that leads somewhere it is immediately thrown out of, which reads to a
-- spotter as the product breaking at the one moment they are already unhappy.
--
-- The gate is: caller owns the sighting AND a refund_holds row exists for its
-- post AND the sighting is named in that hold's sighting_ids. It is the third
-- clause that gets dropped by accident, so it is asserted explicitly below.
do $$
declare
  v_rec       jsonb;
  v_available boolean;
  v_status    text;
  v_other     boolean;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
  set local role authenticated;
  v_rec := public.my_sighting_record();
  reset role;

  -- ...0001 is the disputable one: held post, named in sighting_ids, and CHECK 6
  -- filed an open dispute on it.
  select (e->'dispute'->>'available')::boolean, e->'dispute'->>'status'
    into v_available, v_status
  from jsonb_array_elements(v_rec->'sightings') e
  where e->>'id' = 'd0d0d0d0-0000-0000-0000-000000000001';

  if v_available is distinct from true then
    raise exception 'CHECK 11 FAILED: a held, named sighting reports available=% — the door would never appear', v_available;
  end if;
  if v_status is distinct from 'open' then
    raise exception 'CHECK 11 FAILED: own open dispute reads as % on My reports', v_status;
  end if;

  -- ⚠️ THE THIRD CLAUSE. Same post, same owner attestation, but this sighting is
  -- NOT in the hold's sighting_ids — my_dispute_context refuses it (CHECK 7),
  -- so My reports must not offer a door either.
  insert into public.sightings (id, post_id, spotter_id, status, area_label, location_unavailable)
  values ('d0d0d0d0-0000-0000-0000-000000000009',
          (select post_id from public.refund_holds
            where 'd0d0d0d0-0000-0000-0000-000000000001'::uuid = any (sighting_ids)),
          '33333333-3333-3333-3333-333333333333', 'unverified', 'Manchester', true);

  perform set_config('request.jwt.claims',
    '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
  set local role authenticated;
  v_rec := public.my_sighting_record();
  reset role;

  select (e->'dispute'->>'available')::boolean into v_other
  from jsonb_array_elements(v_rec->'sightings') e
  where e->>'id' = 'd0d0d0d0-0000-0000-0000-000000000009';

  if v_other is distinct from false then
    raise exception 'CHECK 11 FAILED: a sighting the hold does NOT name reports available=% — the door would open onto DISPUTE_NOT_AVAILABLE', v_other;
  end if;

  delete from public.sightings where id = 'd0d0d0d0-0000-0000-0000-000000000009';
end $$;


-- --- housekeeping: leave the database as we found it -------------------------
delete from public.refund_disputes
 where post_id in ('a1a1a1a1-0000-0000-0000-000000000003',
                   'a1a1a1a1-0000-0000-0000-000000000005');
delete from public.refund_holds
 where post_id in ('a1a1a1a1-0000-0000-0000-000000000003',
                   'a1a1a1a1-0000-0000-0000-000000000005');
delete from public.payments where stripe_payment_intent_id = 'pi_test_refund_hold';
delete from public.sightings
 where id in ('d0d0d0d0-0000-0000-0000-000000000001',
              'd0d0d0d0-0000-0000-0000-000000000002',
              'd0d0d0d0-0000-0000-0000-000000000003',
              'd0d0d0d0-0000-0000-0000-000000000004',
              'd0d0d0d0-0000-0000-0000-000000000005',
              -- CHECK 11's throwaway: a sighting on the held post that the hold
              -- does NOT name. Deleted inside the check too, but listed here so
              -- a mid-check failure cannot leak it into the next run.
              'd0d0d0d0-0000-0000-0000-000000000009');
update public.posts set status = 'active', recovered_at = null
 where id in ('a1a1a1a1-0000-0000-0000-000000000003',
              'a1a1a1a1-0000-0000-0000-000000000005');
update public.profiles set recoveries_credited = 0
 where id = '33333333-3333-3333-3333-333333333333';

select 'refund_hold_verification: ALL CHECKS PASSED' as result;

-- =============================================================================
-- WHAT:  Tier 1 verification for `claim_not_credited_notifications` — the
--        announcement owed to every spotter who reported a car that was
--        recovered on SOMEBODY ELSE'S sighting. NOT a migration.
-- WHY:   This closed the loop's last silent corner (the 2026-08-05 loop
--        trace): on a crowd product most spotters lose, and losing used to be
--        indistinguishable from being ignored. The properties worth pinning
--        are the ones a well-meaning edit would break — that a spotter with
--        three sightings gets ONE push rather than three, that the winner and
--        the owner never receive it, that `recovered_no_spotter` can never
--        trigger it (those spotters already heard `closed_uncredited`, and a
--        second, contradictory message is worse than silence), and that the
--        copy leaks nothing about the winner.
--
-- CHECKS: 1 the happy path (claimed, audience = uncredited spotters only)
-- · 2 one push per PERSON, not per sighting · 3 the winner is excluded
-- · 4 idempotency (a second call claims nothing) · 5 recovered_no_spotter is
-- refused outright · 6 a still-active post is refused · 7 the copy carries
-- make/colour and NOT the plate, the winner, or any amount · 8 grants
-- (service role only; authenticated cannot execute).
-- LINKS: supabase/migrations/20260806120000_not_credited_notification.sql;
--        supabase/functions/_shared/recoveryAnnounce.ts (announceNotCredited);
--        docs/ROADMAP.md ("Loop integrity"); docs/TESTING.md; scripts/test-db.sh.
--
-- SELF-ASSERTING: every check RAISES on failure (ON_ERROR_STOP=1).
--
-- Fixtures (from supabase/seed.sql):
--   post a1a1a1a1-...0003 owned by Beth 22222222 (Black BMW 3 Series,
--     plate 'BD21 WSE' — the plate the copy must NOT contain)
--   Users: Alex 11111111 / Beth 22222222 / Carl 33333333 / Dana 44444444
-- Sightings c0c0c0c0-...01..05 are created BY THIS FILE and removed in
-- housekeeping. The post's status is restored to 'active' at the end.
-- =============================================================================

-- --- housekeeping: leave no trace from a previous run ------------------------
delete from public.sightings
 where id in ('c0c0c0c0-0000-0000-0000-000000000001',
              'c0c0c0c0-0000-0000-0000-000000000002',
              'c0c0c0c0-0000-0000-0000-000000000003',
              'c0c0c0c0-0000-0000-0000-000000000004',
              'c0c0c0c0-0000-0000-0000-000000000005');
update public.posts
   set status = 'active', recovery_notified_at = null
 where id = 'a1a1a1a1-0000-0000-0000-000000000003';


-- --- fixture: one recovered post, one winner, three runners-up ---------------
-- Carl files TWO sightings on the same car: the dedup case. Dana files one.
-- Alex is the WINNER. Beth is the owner and files none (she cannot sight her
-- own car) — she is asserted absent anyway, because "excluded by construction"
-- is exactly the kind of claim that stops being true after a refactor.
insert into public.sightings (id, post_id, spotter_id, status, area_label, location_unavailable, created_at)
values
  ('c0c0c0c0-0000-0000-0000-000000000001', 'a1a1a1a1-0000-0000-0000-000000000003',
   '11111111-1111-1111-1111-111111111111', 'credited',   'Camden',    true, now() - interval '3 days'),
  ('c0c0c0c0-0000-0000-0000-000000000002', 'a1a1a1a1-0000-0000-0000-000000000003',
   '33333333-3333-3333-3333-333333333333', 'unverified', 'Islington', true, now() - interval '2 days'),
  ('c0c0c0c0-0000-0000-0000-000000000003', 'a1a1a1a1-0000-0000-0000-000000000003',
   '33333333-3333-3333-3333-333333333333', 'helpful',    'Islington', true, now() - interval '1 days'),
  ('c0c0c0c0-0000-0000-0000-000000000004', 'a1a1a1a1-0000-0000-0000-000000000003',
   '44444444-4444-4444-4444-444444444444', 'unverified', 'Hackney',   true, now());

update public.posts
   set status = 'recovered'
 where id = 'a1a1a1a1-0000-0000-0000-000000000003';


-- --- 1/2/3/7: the happy path, the dedup, the exclusions, the copy ------------
do $$
declare
  v_result jsonb;
  v_users  uuid[];
begin
  v_result := public.claim_not_credited_notifications('a1a1a1a1-0000-0000-0000-000000000003');

  if not (v_result->>'claimed')::boolean then
    raise exception 'CHECK 1 FAILED: a recovered post with a credited sighting did not claim';
  end if;

  select array_agg(value::uuid order by value::text)
    into v_users
    from jsonb_array_elements_text(v_result->'user_ids');

  -- CHECK 2: Carl filed TWO sightings and must appear exactly ONCE. Without
  -- the DISTINCT ON, the most diligent spotters would be the most spammed.
  if array_length(v_users, 1) <> 2 then
    raise exception 'CHECK 2 FAILED: expected 2 recipients (Carl once, Dana once), got %: %',
      array_length(v_users, 1), v_users;
  end if;
  if not (v_users @> array['33333333-3333-3333-3333-333333333333'::uuid,
                           '44444444-4444-4444-4444-444444444444'::uuid]) then
    raise exception 'CHECK 2 FAILED: the two runners-up are not both present: %', v_users;
  end if;

  -- CHECK 3: the WINNER never hears this — they get `credited`/`payout_sent`,
  -- and telling them another spotter won would be simply false.
  if v_users @> array['11111111-1111-1111-1111-111111111111'::uuid] then
    raise exception 'CHECK 3 FAILED: the credited spotter received the runner-up push';
  end if;
  -- ...and neither does the OWNER.
  if v_users @> array['22222222-2222-2222-2222-222222222222'::uuid] then
    raise exception 'CHECK 3 FAILED: the post owner received the runner-up push';
  end if;

  -- CHECK 7: the copy. make/colour yes; plate, winner and money never.
  if (v_result->>'body') not like '%Black BMW%' then
    raise exception 'CHECK 7 FAILED: body does not name the car: %', v_result->>'body';
  end if;
  if (v_result->>'body') like '%BD21%' or (v_result->>'title') like '%BD21%' then
    raise exception 'CHECK 7 FAILED: the PLATE reached the copy: %', v_result->>'body';
  end if;
  if (v_result->>'body') ilike '%Alex%' or (v_result->>'body') ilike '%£%' then
    raise exception 'CHECK 7 FAILED: the winner or an amount reached the copy: %', v_result->>'body';
  end if;
end $$;


-- --- 4: idempotency — the claim is one-shot ----------------------------------
do $$
declare
  v_result jsonb;
begin
  v_result := public.claim_not_credited_notifications('a1a1a1a1-0000-0000-0000-000000000003');
  -- The claim consumed every eligible sighting on the first pass, so a replay
  -- finds nothing to mark. It may report claimed:true with an EMPTY audience
  -- (the "we tried" contract) but must never re-list a recipient.
  if jsonb_array_length(coalesce(v_result->'user_ids', '[]'::jsonb)) <> 0 then
    raise exception 'CHECK 4 FAILED: a replay re-announced to %', v_result->'user_ids';
  end if;
end $$;


-- --- 5: recovered_no_spotter is refused outright -----------------------------
-- Those spotters already heard `closed_uncredited` from create_refund_hold.
-- Telling them a second, contradictory story ("someone else was credited"
-- when nobody was) is worse than silence.
do $$
declare
  v_result jsonb;
begin
  delete from public.sightings where id = 'c0c0c0c0-0000-0000-0000-000000000001';
  update public.sightings
     set not_credited_notified_at = null
   where post_id = 'a1a1a1a1-0000-0000-0000-000000000003';
  update public.posts
     set status = 'recovered_no_spotter'
   where id = 'a1a1a1a1-0000-0000-0000-000000000003';

  v_result := public.claim_not_credited_notifications('a1a1a1a1-0000-0000-0000-000000000003');
  if (v_result->>'claimed')::boolean then
    raise exception 'CHECK 5 FAILED: recovered_no_spotter claimed the runner-up announcement';
  end if;
end $$;


-- --- 6: a live post is refused ----------------------------------------------
do $$
declare
  v_result jsonb;
begin
  insert into public.sightings (id, post_id, spotter_id, status, area_label, location_unavailable)
  values ('c0c0c0c0-0000-0000-0000-000000000005', 'a1a1a1a1-0000-0000-0000-000000000003',
          '11111111-1111-1111-1111-111111111111', 'credited', 'Camden', true);
  update public.posts
     set status = 'active'
   where id = 'a1a1a1a1-0000-0000-0000-000000000003';

  v_result := public.claim_not_credited_notifications('a1a1a1a1-0000-0000-0000-000000000003');
  if (v_result->>'claimed')::boolean then
    raise exception 'CHECK 6 FAILED: an ACTIVE post claimed the runner-up announcement';
  end if;

  -- A null id is a refusal, not an error.
  if (public.claim_not_credited_notifications(null)->>'claimed')::boolean then
    raise exception 'CHECK 6 FAILED: a null post id claimed';
  end if;
end $$;


-- --- 8: grants — service role only -------------------------------------------
do $$
declare
  v_has boolean;
begin
  select has_function_privilege('authenticated',
           'public.claim_not_credited_notifications(uuid)', 'execute')
    into v_has;
  if v_has then
    raise exception 'CHECK 8 FAILED: authenticated can execute the claim (it returns other usersّ ids)';
  end if;

  select has_function_privilege('anon',
           'public.claim_not_credited_notifications(uuid)', 'execute')
    into v_has;
  if v_has then
    raise exception 'CHECK 8 FAILED: anon can execute the claim';
  end if;

  select has_function_privilege('service_role',
           'public.claim_not_credited_notifications(uuid)', 'execute')
    into v_has;
  if not v_has then
    raise exception 'CHECK 8 FAILED: service_role CANNOT execute the claim';
  end if;
end $$;


-- --- housekeeping: restore the fixture post ----------------------------------
delete from public.sightings
 where id in ('c0c0c0c0-0000-0000-0000-000000000001',
              'c0c0c0c0-0000-0000-0000-000000000002',
              'c0c0c0c0-0000-0000-0000-000000000003',
              'c0c0c0c0-0000-0000-0000-000000000004',
              'c0c0c0c0-0000-0000-0000-000000000005');
update public.posts
   set status = 'active'
 where id = 'a1a1a1a1-0000-0000-0000-000000000003';

select 'not_credited_verification: ALL CHECKS PASSED' as result;

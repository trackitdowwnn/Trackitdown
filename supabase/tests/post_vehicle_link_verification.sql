-- =============================================================================
-- WHAT:  Tier 1 verification for the post↔vehicle link — create_post's new
--        p_vehicle_id, the ownership check on it, and the delete_vehicle guard
--        it finally arms. Plus: expires_at is no longer stamped. NOT a migration.
-- WHY:   ⚠️ CHECK 4 IS THE POINT OF THIS FILE. delete_vehicle has carried this
--        since 2026-08-01:
--
--            where p.vehicle_id = p_vehicle_id   -- never true, for any row
--
--        and a comment describing it as "a deliberate guard against silently
--        deleting a car that has a live listing and held escrow". Because
--        create_post never wrote the column, the guard could not fire, and an
--        owner could delete a car that was currently reported stolen with money
--        still in escrow. Nothing in the app or the suites would have noticed —
--        which is exactly why the assertion is written from the failing side.
--
--        CHECK 3 is the security half. p_vehicle_id arrives from a client, and
--        posts.vehicle_id feeds that guard: accepting an id blindly would let
--        anyone pin their post to a STRANGER'S vehicle and freeze that
--        stranger's garage row against deletion. The RPC resolves a
--        not-yours id to NULL rather than raising — provenance must never fail
--        a stolen-car report — so the check is that nothing was written.
--
-- CHECKS: 1 a post made from an owned vehicle records it · 2 a post with no
-- vehicle records NULL · 3 ⚠️ a STRANGER'S vehicle id is ignored, not stored ·
-- 4 ⚠️ delete_vehicle now REFUSES while the car has a live listing · 5 it still
-- allows deletion once the post is closed · 6 ⚠️ expires_at is no longer
-- stamped · 7 the post keeps its own snapshot when the vehicle is deleted ·
-- 8 grants survived the DROP.
-- LINKS: supabase/migrations/20260902150000_post_remembers_its_vehicle.sql;
--        supabase/migrations/20260801100000_garage_vehicles.sql (delete_vehicle);
--        docs/decisions/ADR-0019-the-abandoned-post.md (why expiry is a
--          question, not a clock).
--
-- SELF-ASSERTING: every check RAISES on failure (ON_ERROR_STOP=1). Everything
-- runs inside begin/rollback.
-- =============================================================================

begin;
do $$
declare
  v_owner     uuid := '22222222-2222-2222-2222-222222222222';
  v_stranger  uuid := '11111111-1111-1111-1111-111111111111';
  v_vehicle   uuid;
  v_theirs    uuid;
  v_post      uuid;
  v_bare      uuid;
  v_doc       jsonb;
  v_linked    uuid;
  v_expires   timestamptz;
  v_photos    text[] := array[
    'http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/p0.jpg',
    'http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/p1.jpg',
    'http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/p2.jpg'];
begin
  -- Two garage cars: one the caller owns, one belonging to a stranger.
  perform set_config('request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
  v_doc := public.add_vehicle('LK19 OWN', 'Ford', 'Fiesta', 'Blue', null, 2019,
                              'Hatchback', null, array[]::text[], '[]'::jsonb);
  v_vehicle := (v_doc ->> 'vehicle_id')::uuid;

  perform set_config('request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
  v_doc := public.add_vehicle('LK19 THR', 'Audi', 'A3', 'White', null, 2020,
                              'Hatchback', null, array[]::text[], '[]'::jsonb);
  v_theirs := (v_doc ->> 'vehicle_id')::uuid;

  perform set_config('request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);

  -- ---------------------------------------------------------------------
  -- CHECK 1 — a post made from an owned vehicle records which one.
  -- ---------------------------------------------------------------------
  v_doc := public.create_post(
    null, 'Ford', 'Fiesta', 'Blue', 2019, 'Hatchback', null, null, null, null,
    'driveway', 'no', now() - interval '1 day', 53.4808, -2.2426, 'Manchester',
    25000, v_photos, null, null, '[]'::jsonb, 'Manchester', v_vehicle);
  v_post := (v_doc ->> 'post_id')::uuid;

  select vehicle_id into v_linked from public.posts where id = v_post;
  if v_linked is distinct from v_vehicle then
    raise exception 'CHECK 1 FAILED: the post recorded vehicle_id % rather than % -- the link create_post exists to write is still not written', v_linked, v_vehicle;
  end if;

  -- ---------------------------------------------------------------------
  -- CHECK 2 — a post typed from scratch records NULL, as every post did
  -- before today. The default must survive the DROP and recreate.
  -- ---------------------------------------------------------------------
  v_doc := public.create_post(
    null, 'Ford', 'Focus', 'Red', 2018, 'Hatchback', null, null, null, null,
    'driveway', 'no', now() - interval '1 day', 53.4808, -2.2426, 'Manchester',
    25000, v_photos, null, null, '[]'::jsonb, 'Manchester');
  v_bare := (v_doc ->> 'post_id')::uuid;

  if (select vehicle_id from public.posts where id = v_bare) is not null then
    raise exception 'CHECK 2 FAILED: a post created without p_vehicle_id got a vehicle_id anyway';
  end if;

  -- ---------------------------------------------------------------------
  -- CHECK 3 — ⚠️ a STRANGER'S vehicle id is IGNORED, not stored.
  -- Storing it would let anyone freeze someone else's garage row against
  -- deletion by pointing a post at it.
  -- ---------------------------------------------------------------------
  v_doc := public.create_post(
    null, 'Ford', 'Ka', 'Green', 2017, 'Hatchback', null, null, null, null,
    'driveway', 'no', now() - interval '1 day', 53.4808, -2.2426, 'Manchester',
    25000, v_photos, null, null, '[]'::jsonb, 'Manchester', v_theirs);

  if (select vehicle_id from public.posts where id = (v_doc ->> 'post_id')::uuid) is not null then
    raise exception 'CHECK 3 FAILED: a post was linked to a vehicle the caller does not own -- ownership is being trusted rather than checked';
  end if;

  -- ---------------------------------------------------------------------
  -- CHECK 4 — ⚠️ THE GUARD THAT HAD NEVER FIRED. The linked post is a draft;
  -- move it live, then try to delete the car out from under it.
  -- ---------------------------------------------------------------------
  update public.posts set status = 'active' where id = v_post;

  begin
    perform public.delete_vehicle(v_vehicle);
    raise exception 'CHECK 4 FAILED: a car with a LIVE listing was deleted. This is the guard delete_vehicle has advertised since 2026-08-01 and could never enforce, because create_post never wrote posts.vehicle_id';
  exception
    when sqlstate 'P0001' then
      if sqlerrm <> 'VEHICLE_HAS_ACTIVE_POST' then
        raise exception 'CHECK 4 FAILED: expected VEHICLE_HAS_ACTIVE_POST, got %', sqlerrm;
      end if;
  end;

  -- ---------------------------------------------------------------------
  -- CHECK 5 — and it still lets go once the listing is closed. A guard that
  -- never releases is a car nobody can ever remove from their garage.
  -- ---------------------------------------------------------------------
  update public.posts set status = 'recovered' where id = v_post;
  perform public.delete_vehicle(v_vehicle);

  if exists (select 1 from public.vehicles where id = v_vehicle) then
    raise exception 'CHECK 5 FAILED: the car could not be deleted even with its listing closed';
  end if;

  -- ---------------------------------------------------------------------
  -- CHECK 6 — ⚠️ expires_at is NO LONGER STAMPED (review finding #18). It was
  -- set to +90 days and read for a decision by nothing, while post detail
  -- counted down to it in front of an owner whose car was still missing.
  -- ---------------------------------------------------------------------
  select expires_at into v_expires from public.posts where id = v_bare;
  if v_expires is not null then
    raise exception 'CHECK 6 FAILED: create_post stamped expires_at = % -- a date nothing acts on is a countdown to nothing', v_expires;
  end if;

  -- ---------------------------------------------------------------------
  -- CHECK 7 — the post keeps its OWN snapshot. ON DELETE SET NULL means
  -- deleting the garage car (CHECK 5) must not have touched the listing.
  -- ---------------------------------------------------------------------
  if (select vehicle_id from public.posts where id = v_post) is not null then
    raise exception 'CHECK 7 FAILED: vehicle_id survived the vehicle delete -- the FK is not ON DELETE SET NULL';
  end if;
  if (select make from public.posts where id = v_post) is distinct from 'Ford' then
    raise exception 'CHECK 7 FAILED: deleting the garage car altered the listing''s own snapshot';
  end if;

  raise notice 'post_vehicle_link CHECKS 1-7 passed';
end $$;

-- -----------------------------------------------------------------------------
-- CHECK 8 — ⚠️ GRANTS SURVIVED THE DROP. A dropped function loses its grants
-- and comes back with PostgreSQL's default EXECUTE-to-public, so a migration
-- that forgot the revoke would hand anon the post-creation boundary. The old
-- 22-type signature must ALSO be gone — two overloads would make every
-- named-argument call from PostgREST ambiguous.
-- -----------------------------------------------------------------------------
do $$
declare
  v_new text := 'public.create_post(text, text, text, text, int, text, text, text, text, text, text, text, timestamptz, double precision, double precision, text, int, text[], text[], text, jsonb, text, uuid)';
  v_old text := 'public.create_post(text, text, text, text, int, text, text, text, text, text, text, text, timestamptz, double precision, double precision, text, int, text[], text[], text, jsonb, text)';
begin
  if to_regprocedure(v_new) is null then
    raise exception 'CHECK 8 FAILED: the 23-argument create_post does not exist -- the recreate did not run';
  end if;
  if to_regprocedure(v_old) is not null then
    raise exception 'CHECK 8 FAILED: the OLD 22-argument create_post still exists. Two overloads make every PostgREST named-argument call ambiguous (42725)';
  end if;
  if has_function_privilege('anon', v_new, 'EXECUTE') then
    raise exception 'CHECK 8 FAILED: anon can EXECUTE create_post -- the drop took the revoke with it and it was not restated';
  end if;
  if not has_function_privilege('authenticated', v_new, 'EXECUTE') then
    raise exception 'CHECK 8 FAILED: authenticated CANNOT EXECUTE create_post -- nobody can post a car';
  end if;

  raise notice 'post_vehicle_link CHECK 8 passed';
end $$;

rollback;

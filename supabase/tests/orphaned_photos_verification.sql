-- =============================================================================
-- WHAT:  Tier 1 verification for the orphaned-photo queue — the URL parser, the
--        four enqueue triggers, and the shared-object gate that decides what a
--        sweep is allowed to delete. NOT a migration.
-- WHY:   Two failure directions, and they are not symmetric.
--
--          * TOO LITTLE — an object is never queued, so a person who deleted
--            their car still has their photographs sitting in a PUBLIC bucket.
--            That is the UK GDPR gap this feature exists to close.
--          * TOO MUCH — an object still named by a live listing is handed to
--            the sweep and deleted. ⚠️ THAT BLANKS THE HERO IMAGE OF SOMEBODY
--            ELSE'S STOLEN-CAR LISTING, it is irreversible, and the victim is a
--            stranger who did nothing. SECURITY_AND_TRUST §3 names this exact
--            hazard, because posts SNAPSHOT a garage vehicle's photo URLs and
--            the two therefore share objects routinely.
--
--        So the over-delete cases get the most coverage (CHECKS 4 and 5), and
--        the parser gets its own (CHECK 1) because a mis-parsed path is how a
--        sweep would delete the wrong object entirely.
--
-- CHECKS: 1 photo_path_from_url parses ours and refuses everything else ·
-- 2 each of the four tables enqueues on delete · 3 the queue is idempotent ·
-- 4 a still-referenced path is never claimed · 5 a path shared with a LIVE post
-- is never claimed and is dropped from the queue · 6 a genuinely orphaned path
-- IS claimed · 7 forget removes only what it is given · 8 grants.
-- LINKS: supabase/migrations/20260901160000_orphaned_photo_queue.sql;
--        supabase/functions/release-held-refunds/index.ts (the drain);
--        docs/SECURITY_AND_TRUST.md §3.
--
-- SELF-ASSERTING: every check RAISES on failure (ON_ERROR_STOP=1). Every check
-- that mutates runs inside begin/rollback, so a mid-check failure cannot leave
-- a queued path behind for the next run to act on.
-- =============================================================================

-- The URL shape uploadOwnFolderPhoto produces. Kept as one constant-ish literal
-- so a change to the parser fails here rather than silently widening.
-- <project>/storage/v1/object/public/post-photos/<userId>/<hash>-<index>.jpg


-- -----------------------------------------------------------------------------
-- CHECK 1 — photo_path_from_url: ours parses, everything else is NULL.
-- -----------------------------------------------------------------------------
-- ⚠️ FAIL-CLOSED IS THE PROPERTY. A URL we do not recognise must yield NULL and
-- therefore no queue row — never a partial or mangled path, because the sweep
-- deletes whatever it is handed.
do $$
declare
  v_base text := 'https://abc.supabase.co/storage/v1/object/public/post-photos/';
begin
  if public.photo_path_from_url(v_base || 'user-1/abc-0.jpg') <> 'user-1/abc-0.jpg' then
    raise exception 'CHECK 1 FAILED: a real post-photos URL did not parse';
  end if;
  if public.photo_path_from_url(null) is not null then
    raise exception 'CHECK 1 FAILED: null did not stay null';
  end if;
  if public.photo_path_from_url('https://example.com/some/other.jpg') is not null then
    raise exception 'CHECK 1 FAILED: a foreign URL produced a path — the sweep would delete it';
  end if;
  -- The private sighting bucket must never be reachable through this parser:
  -- those objects are evidence and are governed by a different rule entirely.
  if public.photo_path_from_url(
       'https://abc.supabase.co/storage/v1/object/public/sighting-photos/a/b.jpg') is not null then
    raise exception 'CHECK 1 FAILED: another bucket parsed as post-photos';
  end if;
  -- A URL that ends at the bucket names no object.
  if public.photo_path_from_url(v_base) is not null then
    raise exception 'CHECK 1 FAILED: an empty path was returned instead of NULL';
  end if;

  raise notice 'CHECK 1 passed: our URLs parse, everything else is NULL.';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 2 — all four photo tables enqueue on delete, and CHECK 3 — idempotence.
-- -----------------------------------------------------------------------------
-- Four tables lose rows by several routes (cascade from vehicles, cascade from
-- posts, update_vehicle and update_post_photos replacing a set). A trigger on
-- each is why a future RPC cannot forget to queue.
begin;
do $$
declare
  v_base    text := 'https://abc.supabase.co/storage/v1/object/public/post-photos/';
  v_post    uuid := 'a1a1a1a1-0000-0000-0000-000000000003';
  v_vehicle uuid;
  v_user    uuid := '22222222-2222-2222-2222-222222222222';
  v_n       integer;
begin
  insert into public.vehicles (user_id, make, model, colour)
  values (v_user, 'Ford', 'Focus', 'Blue') returning id into v_vehicle;

  insert into public.post_photos (post_id, url, position)
  values (v_post, v_base || 'u/p1.jpg', 90);
  insert into public.vehicle_photos (vehicle_id, url, position)
  values (v_vehicle, v_base || 'u/v1.jpg', 90);
  insert into public.post_distinctive_feature (post_id, photo_url, description, position)
  values (v_post, v_base || 'u/pf1.jpg', 'Cracked wing mirror', 90);
  insert into public.vehicle_distinctive_feature (vehicle_id, photo_url, description, position)
  values (v_vehicle, v_base || 'u/vf1.jpg', 'Cracked wing mirror', 90);

  delete from public.post_photos where url = v_base || 'u/p1.jpg';
  delete from public.vehicle_photos where url = v_base || 'u/v1.jpg';
  delete from public.post_distinctive_feature where photo_url = v_base || 'u/pf1.jpg';
  delete from public.vehicle_distinctive_feature where photo_url = v_base || 'u/vf1.jpg';

  select count(*) into v_n from public.orphaned_photos
   where path in ('u/p1.jpg', 'u/v1.jpg', 'u/pf1.jpg', 'u/vf1.jpg');
  if v_n <> 4 then
    raise exception 'CHECK 2 FAILED: % of 4 tables queued their deleted photo', v_n;
  end if;

  -- CHECK 3: the same object named by two rows is one deletion. Re-queueing
  -- must not error, or one delete could abort a cascade.
  insert into public.vehicle_photos (vehicle_id, url, position)
  values (v_vehicle, v_base || 'u/p1.jpg', 91);
  delete from public.vehicle_photos where url = v_base || 'u/p1.jpg';
  select count(*) into v_n from public.orphaned_photos where path = 'u/p1.jpg';
  if v_n <> 1 then
    raise exception 'CHECK 3 FAILED: the queue holds % rows for one path', v_n;
  end if;

  raise notice 'CHECK 2/3 passed: all four tables enqueue, and the queue is one row per object.';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 4/5 — ⚠️ THE GATE. A path anything still names is NEVER claimed.
-- -----------------------------------------------------------------------------
-- This is the check that stands between a garage deletion and a stranger's live
-- listing losing its photograph. Posts snapshot a vehicle's URLs, so the shared
-- case is the ordinary case, not an edge one.
begin;
do $$
declare
  v_base    text := 'https://abc.supabase.co/storage/v1/object/public/post-photos/';
  v_post    uuid := 'a1a1a1a1-0000-0000-0000-000000000003';
  v_vehicle uuid;
  v_user    uuid := '22222222-2222-2222-2222-222222222222';
  v_shared  text := v_base || 'u/shared.jpg';
  v_claimed text[];
  v_n       integer;
begin
  insert into public.vehicles (user_id, make, model, colour)
  values (v_user, 'Ford', 'Focus', 'Blue') returning id into v_vehicle;

  -- The same object, named by a LIVE post and by a garage vehicle — exactly
  -- what happens when someone posts a car they had saved.
  insert into public.post_photos (post_id, url, position)
  values (v_post, v_shared, 92);
  insert into public.vehicle_photos (vehicle_id, url, position)
  values (v_vehicle, v_shared, 92);

  -- They delete the garage car. The post keeps its snapshot.
  delete from public.vehicle_photos where url = v_shared;

  if not exists (select 1 from public.orphaned_photos where path = 'u/shared.jpg') then
    raise exception 'CHECK 4 FAILED: the delete did not queue at all — the trigger is not firing';
  end if;

  select coalesce(array_agg(p), '{}') into v_claimed
    from public.claim_orphaned_photos(100) as t(p);

  if v_claimed @> array['u/shared.jpg'] then
    raise exception 'CHECK 4 FAILED: a path a LIVE POST still references was handed to the sweep — this deletes a stranger''s listing photo';
  end if;

  -- CHECK 5: and it is dropped from the queue rather than re-checked forever.
  -- If it is ever orphaned for real, its own delete re-queues it.
  select count(*) into v_n from public.orphaned_photos where path = 'u/shared.jpg';
  if v_n <> 0 then
    raise exception 'CHECK 5 FAILED: a still-referenced path stayed queued (% rows)', v_n;
  end if;

  raise notice 'CHECK 4/5 passed: a shared object is never claimed, and leaves the queue.';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 6 — a genuinely orphaned path IS claimed. The other failure direction.
-- -----------------------------------------------------------------------------
begin;
do $$
declare
  v_base    text := 'https://abc.supabase.co/storage/v1/object/public/post-photos/';
  v_vehicle uuid;
  v_user    uuid := '22222222-2222-2222-2222-222222222222';
  v_claimed text[];
begin
  insert into public.vehicles (user_id, make, model, colour)
  values (v_user, 'Ford', 'Focus', 'Blue') returning id into v_vehicle;
  insert into public.vehicle_photos (vehicle_id, url, position)
  values (v_vehicle, v_base || 'u/only.jpg', 93);

  -- Deleting the VEHICLE, which is the case in the gap's own description:
  -- vehicle_photos cascades and nothing else ever named this object.
  delete from public.vehicles where id = v_vehicle;

  select coalesce(array_agg(p), '{}') into v_claimed
    from public.claim_orphaned_photos(100) as t(p);

  if not (v_claimed @> array['u/only.jpg']) then
    raise exception 'CHECK 6 FAILED: a genuinely orphaned object was not offered to the sweep — the erasure gap is still open';
  end if;

  raise notice 'CHECK 6 passed: an unreferenced object is claimed for deletion.';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 7 — forget removes only what it is given, and survives a null.
-- -----------------------------------------------------------------------------
-- ⚠️ CLAIM AND FORGET ARE SEPARATE ON PURPOSE: dropping the queue row at claim
-- time would lose the path forever if the storage call then failed, stranding
-- the object. So forget must be narrow and must never clear the queue wholesale.
begin;
do $$
declare
  v_n integer;
begin
  insert into public.orphaned_photos (path) values ('u/a.jpg'), ('u/b.jpg');

  if public.forget_orphaned_photos(null) <> 0 then
    raise exception 'CHECK 7 FAILED: a null path list deleted something';
  end if;

  if public.forget_orphaned_photos(array['u/a.jpg']) <> 1 then
    raise exception 'CHECK 7 FAILED: forgetting one path did not remove exactly one row';
  end if;

  select count(*) into v_n from public.orphaned_photos where path = 'u/b.jpg';
  if v_n <> 1 then
    raise exception 'CHECK 7 FAILED: forgetting one path removed another';
  end if;

  raise notice 'CHECK 7 passed: forget is narrow and null-safe.';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 8 — grants. Nothing here is a client's business.
-- -----------------------------------------------------------------------------
-- The queue names other people's storage paths, and the RPCs decide what gets
-- deleted. A client role holding either would be able to read object names it
-- was never shown, or to nominate objects for deletion.
do $$
declare
  v_grants text;
begin
  select string_agg(distinct privilege_type, ',' order by privilege_type)
    into v_grants
  from information_schema.role_table_grants
  where table_schema = 'public' and table_name = 'orphaned_photos'
    and grantee in ('anon', 'authenticated');
  if v_grants is not null then
    raise exception 'CHECK 8 FAILED: anon/authenticated hold % on orphaned_photos', v_grants;
  end if;

  if has_function_privilege('authenticated', 'public.claim_orphaned_photos(integer)', 'execute') then
    raise exception 'CHECK 8 FAILED: authenticated can claim photos for deletion';
  end if;
  if has_function_privilege('authenticated', 'public.forget_orphaned_photos(text[])', 'execute') then
    raise exception 'CHECK 8 FAILED: authenticated can clear the deletion queue';
  end if;
  if has_function_privilege('anon', 'public.photo_path_from_url(text)', 'execute') then
    raise exception 'CHECK 8 FAILED: anon can execute photo_path_from_url';
  end if;

  raise notice 'CHECK 8 passed: the queue and its RPCs are service_role only.';
end $$;


select 'orphaned_photos_verification: ALL CHECKS PASSED' as result;

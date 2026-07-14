-- =============================================================================
-- Sightings safety / validation verification (NOT a migration — do not place in
-- migrations/).
--
-- SELF-ASSERTING: every check is a DO block that RAISES EXCEPTION on failure, so
-- the whole file aborts non-zero the moment a property is violated. "Sightings
-- are server-written, rate-limited, and the spotter's identity never reaches the
-- owner beyond first name + reputation" are Tier 1 properties
-- (docs/SECURITY_AND_TRUST.md §1/§5/§6) — this file GATES CI, it is not for
-- eyeballing. On success each block emits a NOTICE.
--
-- Run against a local DB seeded by supabase/seed.sql:
--     supabase db reset            # applies migrations + seed
--     psql -v ON_ERROR_STOP=1 "$DATABASE_URL" -f supabase/tests/sightings_verification.sql
--
-- (ON_ERROR_STOP=1 makes psql exit non-zero on the first RAISE.)
--
-- Fixtures used (from supabase/seed.sql):
--   ACTIVE post  a1a1a1a1-...0001 ('MA19 XKL') owned by 11111111-... (Alex).
--   DRAFT  post  a1a1a1a1-...001b ('MA99 DRF') owned by 11111111-... (trap).
--   Spotter A: 22222222-... (Beth Sanders)  — reports the happy-path sightings.
--   Spotter B: 33333333-... (Carl Thomas)   — invalid-input probes; ends with
--                                             ZERO sightings (RLS zero-row case).
--
-- auth.uid() reads the request.jwt.claims GUC; write-path blocks set it to the
-- caller's sub for the transaction and run as postgres (RLS bypassed for the
-- direct-table assertions). The RLS/grant checks additionally SET LOCAL ROLE
-- authenticated / anon so the GRANT layer applies for real (the technique from
-- anon_role_verification.sql).
--
-- IDEMPOTENCY: all sightings on the fixture post are deleted up-front AND at
-- the end (counter assertions are delta-based, so leftover reputation from an
-- aborted earlier run cannot break anything).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Clean up any leftover sightings from a previous run of this file.
-- -----------------------------------------------------------------------------
delete from public.sightings
where post_id in ('a1a1a1a1-0000-0000-0000-000000000001',
                  'a1a1a1a1-0000-0000-0000-00000000001b');


-- -----------------------------------------------------------------------------
-- CHECK 1 — happy path. A valid create_sighting by spotter A returns
-- { sighting_id }, inserts the sighting with spotter_id PINNED to the caller,
-- status HARD-CODED 'unverified', location_unavailable=false (one photo has
-- GPS), the photos in position order 0..1, and increments the caller's
-- profiles.sightings_reported by exactly 1.
-- -----------------------------------------------------------------------------
do $$
declare
  v_before int;
  v_after  int;
  v_doc    jsonb;
  v_sid    uuid;
  v_row    public.sightings%rowtype;
  v_photos int;
  v_p0_lat double precision;
  v_p1_lat double precision;
begin
  select sightings_reported into v_before
  from public.profiles where id = '22222222-2222-2222-2222-222222222222';

  perform set_config(
    'request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}',
    true);

  v_doc := public.create_sighting(
    'a1a1a1a1-0000-0000-0000-000000000001',
    jsonb_build_array(
      jsonb_build_object(
        'path', 'a1a1a1a1-0000-0000-0000-000000000001/22222222-2222-2222-2222-222222222222/s1-0.jpg',
        'captured_at', (now() - interval '5 minutes')::text,
        'lat', 53.4811, 'lng', -2.2401, 'accuracy_m', 12.5),
      jsonb_build_object(
        'path', 'a1a1a1a1-0000-0000-0000-000000000001/22222222-2222-2222-2222-222222222222/s1-1.jpg',
        'captured_at', (now() - interval '4 minutes')::text)
    ),
    array['parked', 'people_nearby'],
    'Parked on Oldham Road, two people stood near it.',
    'Ancoats, Manchester');

  v_sid := (v_doc ->> 'sighting_id')::uuid;
  if v_sid is null then
    raise exception 'CHECK 1 FAILED: no sighting_id returned: %', v_doc;
  end if;

  select * into v_row from public.sightings where id = v_sid;
  if v_row.spotter_id <> '22222222-2222-2222-2222-222222222222' then
    raise exception 'CHECK 1 FAILED: spotter_id not pinned to caller: %', v_row.spotter_id;
  end if;
  if v_row.status <> 'unverified' then
    raise exception 'CHECK 1 FAILED: status should be unverified, got %', v_row.status;
  end if;
  if v_row.location_unavailable then
    raise exception 'CHECK 1 FAILED: location_unavailable should be FALSE (one photo has GPS)';
  end if;
  if v_row.context_flags <> array['parked', 'people_nearby'] then
    raise exception 'CHECK 1 FAILED: context_flags not stored: %', v_row.context_flags;
  end if;

  select count(*) into v_photos from public.sighting_photos where sighting_id = v_sid;
  if v_photos <> 2 then
    raise exception 'CHECK 1 FAILED: expected 2 photos, got %', v_photos;
  end if;
  select
    (select lat from public.sighting_photos where sighting_id = v_sid and position = 0),
    (select lat from public.sighting_photos where sighting_id = v_sid and position = 1)
    into v_p0_lat, v_p1_lat;
  if v_p0_lat is null or v_p1_lat is not null then
    raise exception 'CHECK 1 FAILED: photo positions/GPS not in array order (p0.lat=%, p1.lat=%)', v_p0_lat, v_p1_lat;
  end if;

  select sightings_reported into v_after
  from public.profiles where id = '22222222-2222-2222-2222-222222222222';
  if v_after <> v_before + 1 then
    raise exception 'CHECK 1 FAILED: sightings_reported should go % -> %, got %', v_before, v_before + 1, v_after;
  end if;

  raise notice 'CHECK 1 passed: valid create_sighting -> unverified sighting, ordered photos, counter +1';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 2 — location_unavailable is TRUE when NO photo carries GPS.
-- (Sighting #2 for spotter A on the fixture post.)
-- -----------------------------------------------------------------------------
do $$
declare
  v_doc  jsonb;
  v_unav boolean;
begin
  perform set_config(
    'request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}',
    true);

  v_doc := public.create_sighting(
    'a1a1a1a1-0000-0000-0000-000000000001',
    jsonb_build_array(
      jsonb_build_object(
        'path', 'a1a1a1a1-0000-0000-0000-000000000001/22222222-2222-2222-2222-222222222222/s2-0.jpg',
        'captured_at', (now() - interval '3 minutes')::text)
    ),
    array['driving'],
    null,
    null);

  select location_unavailable into v_unav
  from public.sightings where id = (v_doc ->> 'sighting_id')::uuid;
  if not v_unav then
    raise exception 'CHECK 2 FAILED: location_unavailable should be TRUE when no photo has GPS';
  end if;
  raise notice 'CHECK 2 passed: location_unavailable=true when no photo carries GPS';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 3 — POST_NOT_ACTIVE for (a) a DRAFT post and (b) a missing post id.
-- Both give the SAME token: no existence oracle for hidden posts.
-- -----------------------------------------------------------------------------
do $$
declare
  v_draft   boolean := false;
  v_missing boolean := false;
begin
  perform set_config(
    'request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}',
    true);

  begin
    perform public.create_sighting(
      'a1a1a1a1-0000-0000-0000-00000000001b',   -- seeded DRAFT trap
      jsonb_build_array(jsonb_build_object(
        'path', 'a1a1a1a1-0000-0000-0000-00000000001b/22222222-2222-2222-2222-222222222222/d.jpg',
        'captured_at', now()::text)),
      null, null, null);
  exception when others then
    if sqlerrm like 'POST_NOT_ACTIVE%' then v_draft := true;
    else raise exception 'CHECK 3 FAILED (draft): expected POST_NOT_ACTIVE, got: %', sqlerrm; end if;
  end;

  begin
    perform public.create_sighting(
      'deaddead-dead-dead-dead-deaddeaddead',   -- no such post
      jsonb_build_array(jsonb_build_object(
        'path', 'deaddead-dead-dead-dead-deaddeaddead/22222222-2222-2222-2222-222222222222/m.jpg',
        'captured_at', now()::text)),
      null, null, null);
  exception when others then
    if sqlerrm like 'POST_NOT_ACTIVE%' then v_missing := true;
    else raise exception 'CHECK 3 FAILED (missing): expected POST_NOT_ACTIVE, got: %', sqlerrm; end if;
  end;

  if not (v_draft and v_missing) then
    raise exception 'CHECK 3 FAILED: draft=% missing=% did not both raise POST_NOT_ACTIVE', v_draft, v_missing;
  end if;
  raise notice 'CHECK 3 passed: draft and missing posts both raise POST_NOT_ACTIVE';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 4 — OWN_POST. The post's OWNER (11111111) reporting a sighting on their
-- own post is refused (collusion hygiene, SECURITY_AND_TRUST §5).
-- -----------------------------------------------------------------------------
do $$
declare
  v_ok boolean := false;
begin
  perform set_config(
    'request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}',
    true);
  begin
    perform public.create_sighting(
      'a1a1a1a1-0000-0000-0000-000000000001',
      jsonb_build_array(jsonb_build_object(
        'path', 'a1a1a1a1-0000-0000-0000-000000000001/11111111-1111-1111-1111-111111111111/o.jpg',
        'captured_at', now()::text)),
      null, null, null);
  exception when others then
    if sqlerrm like 'OWN_POST%' then v_ok := true;
    else raise exception 'CHECK 4 FAILED: expected OWN_POST, got: %', sqlerrm; end if;
  end;
  if not v_ok then
    raise exception 'CHECK 4 FAILED: owner self-sighting did NOT raise OWN_POST';
  end if;
  raise notice 'CHECK 4 passed: owner reporting their own post raises OWN_POST';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 5 — my_sighting_quota reflects the rolling window: spotter A has used
-- 2 of 3 on the fixture post (CHECKs 1 + 2); spotter B has used 0.
-- -----------------------------------------------------------------------------
do $$
declare
  v_q jsonb;
begin
  perform set_config(
    'request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}',
    true);
  v_q := public.my_sighting_quota('a1a1a1a1-0000-0000-0000-000000000001');
  if (v_q ->> 'used')::int <> 2 or (v_q ->> 'max_per_day')::int <> 3 then
    raise exception 'CHECK 5 FAILED: expected used=2 max_per_day=3 for spotter A, got %', v_q;
  end if;

  perform set_config(
    'request.jwt.claims',
    '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}',
    true);
  v_q := public.my_sighting_quota('a1a1a1a1-0000-0000-0000-000000000001');
  if (v_q ->> 'used')::int <> 0 then
    raise exception 'CHECK 5 FAILED: expected used=0 for spotter B, got %', v_q;
  end if;
  raise notice 'CHECK 5 passed: my_sighting_quota counts the caller''s own rolling-24h usage';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 6 — RATE_LIMITED. Spotter A's 3rd sighting inside 24h succeeds; the 4th
-- raises RATE_LIMITED; quota then reads used=3.
-- -----------------------------------------------------------------------------
do $$
declare
  v_doc jsonb;
  v_q   jsonb;
  v_ok  boolean := false;
begin
  perform set_config(
    'request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}',
    true);

  -- 3rd: allowed.
  v_doc := public.create_sighting(
    'a1a1a1a1-0000-0000-0000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'path', 'a1a1a1a1-0000-0000-0000-000000000001/22222222-2222-2222-2222-222222222222/s3-0.jpg',
      'captured_at', (now() - interval '1 minute')::text)),
    array['plate_changed'],
    'Same car, different plates now.',
    null);
  if (v_doc ->> 'sighting_id') is null then
    raise exception 'CHECK 6 FAILED: 3rd sighting within 24h should succeed: %', v_doc;
  end if;

  -- 4th: refused.
  begin
    perform public.create_sighting(
      'a1a1a1a1-0000-0000-0000-000000000001',
      jsonb_build_array(jsonb_build_object(
        'path', 'a1a1a1a1-0000-0000-0000-000000000001/22222222-2222-2222-2222-222222222222/s4-0.jpg',
        'captured_at', now()::text)),
      null, null, null);
  exception when others then
    if sqlerrm like 'RATE_LIMITED%' then v_ok := true;
    else raise exception 'CHECK 6 FAILED: expected RATE_LIMITED on the 4th, got: %', sqlerrm; end if;
  end;
  if not v_ok then
    raise exception 'CHECK 6 FAILED: the 4th sighting within 24h did NOT raise RATE_LIMITED';
  end if;

  v_q := public.my_sighting_quota('a1a1a1a1-0000-0000-0000-000000000001');
  if (v_q ->> 'used')::int <> 3 then
    raise exception 'CHECK 6 FAILED: quota should read used=3 after the limit, got %', v_q;
  end if;
  raise notice 'CHECK 6 passed: 3rd sighting allowed, 4th raises RATE_LIMITED, quota used=3';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 7 — INVALID_PHOTOS. As spotter B: 0 photos, 4 photos, a null payload,
-- a path pinned to ANOTHER user's folder, a path under the WRONG post, and
-- lat-without-lng all raise INVALID_PHOTOS. Spotter B ends with zero rows.
-- -----------------------------------------------------------------------------
do $$
declare
  v_hits int := 0;
begin
  perform set_config(
    'request.jwt.claims',
    '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}',
    true);

  -- (a) 0 photos.
  begin
    perform public.create_sighting(
      'a1a1a1a1-0000-0000-0000-000000000001', '[]'::jsonb, null, null, null);
    raise exception 'CHECK 7 FAILED: 0 photos was accepted';
  exception when others then
    if sqlerrm like 'INVALID_PHOTOS%' then v_hits := v_hits + 1;
    else raise exception 'CHECK 7 FAILED (0 photos): expected INVALID_PHOTOS, got: %', sqlerrm; end if;
  end;

  -- (b) 4 photos.
  begin
    perform public.create_sighting(
      'a1a1a1a1-0000-0000-0000-000000000001',
      jsonb_build_array(
        jsonb_build_object('path', 'a1a1a1a1-0000-0000-0000-000000000001/33333333-3333-3333-3333-333333333333/0.jpg', 'captured_at', now()::text),
        jsonb_build_object('path', 'a1a1a1a1-0000-0000-0000-000000000001/33333333-3333-3333-3333-333333333333/1.jpg', 'captured_at', now()::text),
        jsonb_build_object('path', 'a1a1a1a1-0000-0000-0000-000000000001/33333333-3333-3333-3333-333333333333/2.jpg', 'captured_at', now()::text),
        jsonb_build_object('path', 'a1a1a1a1-0000-0000-0000-000000000001/33333333-3333-3333-3333-333333333333/3.jpg', 'captured_at', now()::text)),
      null, null, null);
    raise exception 'CHECK 7 FAILED: 4 photos was accepted';
  exception when others then
    if sqlerrm like 'INVALID_PHOTOS%' then v_hits := v_hits + 1;
    else raise exception 'CHECK 7 FAILED (4 photos): expected INVALID_PHOTOS, got: %', sqlerrm; end if;
  end;

  -- (c) null payload (not an array).
  begin
    perform public.create_sighting(
      'a1a1a1a1-0000-0000-0000-000000000001', null::jsonb, null, null, null);
    raise exception 'CHECK 7 FAILED: null photos payload was accepted';
  exception when others then
    if sqlerrm like 'INVALID_PHOTOS%' then v_hits := v_hits + 1;
    else raise exception 'CHECK 7 FAILED (null payload): expected INVALID_PHOTOS, got: %', sqlerrm; end if;
  end;

  -- (d) path pinned to ANOTHER user's folder (spotter A's) — impersonated evidence.
  begin
    perform public.create_sighting(
      'a1a1a1a1-0000-0000-0000-000000000001',
      jsonb_build_array(jsonb_build_object(
        'path', 'a1a1a1a1-0000-0000-0000-000000000001/22222222-2222-2222-2222-222222222222/x.jpg',
        'captured_at', now()::text)),
      null, null, null);
    raise exception 'CHECK 7 FAILED: a foreign-folder path was accepted';
  exception when others then
    if sqlerrm like 'INVALID_PHOTOS%' then v_hits := v_hits + 1;
    else raise exception 'CHECK 7 FAILED (foreign folder): expected INVALID_PHOTOS, got: %', sqlerrm; end if;
  end;

  -- (e) path under the WRONG post (the draft trap's folder on the active post).
  begin
    perform public.create_sighting(
      'a1a1a1a1-0000-0000-0000-000000000001',
      jsonb_build_array(jsonb_build_object(
        'path', 'a1a1a1a1-0000-0000-0000-00000000001b/33333333-3333-3333-3333-333333333333/x.jpg',
        'captured_at', now()::text)),
      null, null, null);
    raise exception 'CHECK 7 FAILED: a wrong-post path was accepted';
  exception when others then
    if sqlerrm like 'INVALID_PHOTOS%' then v_hits := v_hits + 1;
    else raise exception 'CHECK 7 FAILED (wrong post): expected INVALID_PHOTOS, got: %', sqlerrm; end if;
  end;

  -- (f) lat without lng.
  begin
    perform public.create_sighting(
      'a1a1a1a1-0000-0000-0000-000000000001',
      jsonb_build_array(jsonb_build_object(
        'path', 'a1a1a1a1-0000-0000-0000-000000000001/33333333-3333-3333-3333-333333333333/x.jpg',
        'captured_at', now()::text,
        'lat', 53.48)),
      null, null, null);
    raise exception 'CHECK 7 FAILED: lat-without-lng was accepted';
  exception when others then
    if sqlerrm like 'INVALID_PHOTOS%' then v_hits := v_hits + 1;
    else raise exception 'CHECK 7 FAILED (lat without lng): expected INVALID_PHOTOS, got: %', sqlerrm; end if;
  end;

  if v_hits <> 6 then
    raise exception 'CHECK 7 FAILED: expected 6 INVALID_PHOTOS rejections, got %', v_hits;
  end if;
  raise notice 'CHECK 7 passed: 0/4/null photos, foreign-folder, wrong-post, lat-without-lng all raise INVALID_PHOTOS';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 8 — INVALID_INPUT. As spotter B: a non-whitelisted context flag, a
-- 501-char note, and a 121-char area label all raise INVALID_INPUT.
-- -----------------------------------------------------------------------------
do $$
declare
  v_hits  int   := 0;
  v_photo jsonb := jsonb_build_array(jsonb_build_object(
    'path', 'a1a1a1a1-0000-0000-0000-000000000001/33333333-3333-3333-3333-333333333333/ok.jpg',
    'captured_at', now()::text));
begin
  perform set_config(
    'request.jwt.claims',
    '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}',
    true);

  -- (a) non-whitelisted flag ("following" is exactly the pursuit-adjacent chip
  -- we must never accept — SECURITY_AND_TRUST §1).
  begin
    perform public.create_sighting(
      'a1a1a1a1-0000-0000-0000-000000000001', v_photo, array['following'], null, null);
    raise exception 'CHECK 8 FAILED: a non-whitelisted flag was accepted';
  exception when others then
    if sqlerrm like 'INVALID_INPUT%' then v_hits := v_hits + 1;
    else raise exception 'CHECK 8 FAILED (bad flag): expected INVALID_INPUT, got: %', sqlerrm; end if;
  end;

  -- (b) 501-char note.
  begin
    perform public.create_sighting(
      'a1a1a1a1-0000-0000-0000-000000000001', v_photo, null, repeat('x', 501), null);
    raise exception 'CHECK 8 FAILED: a 501-char note was accepted';
  exception when others then
    if sqlerrm like 'INVALID_INPUT%' then v_hits := v_hits + 1;
    else raise exception 'CHECK 8 FAILED (long note): expected INVALID_INPUT, got: %', sqlerrm; end if;
  end;

  -- (c) 121-char area label.
  begin
    perform public.create_sighting(
      'a1a1a1a1-0000-0000-0000-000000000001', v_photo, null, null, repeat('y', 121));
    raise exception 'CHECK 8 FAILED: a 121-char area_label was accepted';
  exception when others then
    if sqlerrm like 'INVALID_INPUT%' then v_hits := v_hits + 1;
    else raise exception 'CHECK 8 FAILED (long area_label): expected INVALID_INPUT, got: %', sqlerrm; end if;
  end;

  if v_hits <> 3 then
    raise exception 'CHECK 8 FAILED: expected 3 INVALID_INPUT rejections, got %', v_hits;
  end if;
  raise notice 'CHECK 8 passed: bad flag / long note / long area_label all raise INVALID_INPUT';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 9 — get_post_sightings: the OWNER (11111111) gets all 3 sightings,
-- newest-first, with photos and a MINIMISED spotter block — and the payload
-- text contains NO spotter_id, NO display_name key, NO surname ('Sanders'),
-- NO email, NO avatar path (SECURITY_AND_TRUST §1 absence assertions).
-- -----------------------------------------------------------------------------
do $$
declare
  v_doc jsonb;
  v_txt text;
  v_s0  jsonb;
begin
  perform set_config(
    'request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}',
    true);

  v_doc := public.get_post_sightings('a1a1a1a1-0000-0000-0000-000000000001');
  if jsonb_typeof(v_doc) <> 'array' or jsonb_array_length(v_doc) <> 3 then
    raise exception 'CHECK 9 FAILED: expected an array of 3 sightings, got %', v_doc;
  end if;

  -- Newest-first ordering.
  if (v_doc -> 0 ->> 'created_at')::timestamptz < (v_doc -> 2 ->> 'created_at')::timestamptz then
    raise exception 'CHECK 9 FAILED: sightings not ordered newest-first';
  end if;

  -- Newest = CHECK 6's sighting: 1 GPS-less photo, plate_changed flag.
  v_s0 := v_doc -> 0;
  if jsonb_array_length(v_s0 -> 'photos') <> 1
     or (v_s0 -> 'photos' -> 0 ->> 'path') not like '%/s3-0.jpg'
     or (v_s0 -> 'photos' -> 0 -> 'lat') <> 'null'::jsonb
     or (v_s0 -> 'photos' -> 0 ->> 'captured_at') is null
     or not (v_s0 ->> 'location_unavailable')::boolean then
    raise exception 'CHECK 9 FAILED: newest sighting payload wrong: %', v_s0;
  end if;

  -- Spotter block: first name + reputation + member_since ONLY.
  if (v_s0 -> 'spotter' ->> 'first_name') <> 'Beth'
     or (v_s0 -> 'spotter' ->> 'sightings_reported')::int < 3
     or (v_s0 -> 'spotter' -> 'sightings_helpful') is null
     or (v_s0 -> 'spotter' -> 'recoveries_credited') is null
     or (v_s0 -> 'spotter' ->> 'member_since') is null then
    raise exception 'CHECK 9 FAILED: spotter block incomplete: %', v_s0 -> 'spotter';
  end if;

  -- ABSENCE assertions on the raw payload text (Tier 1 privacy — §1).
  v_txt := v_doc::text;
  if v_txt like '%spotter_id%' then
    raise exception 'CHECK 9 FAILED: payload leaks spotter_id';
  end if;
  if v_txt like '%display_name%' or v_txt like '%Sanders%' then
    raise exception 'CHECK 9 FAILED: payload leaks the spotter''s display_name/surname';
  end if;
  if v_txt like '%avatar%' then
    raise exception 'CHECK 9 FAILED: payload leaks an avatar path (embeds the uid)';
  end if;
  if v_txt like '%trackitdown.test%' or v_txt like '%email%' then
    raise exception 'CHECK 9 FAILED: payload leaks an email';
  end if;

  raise notice 'CHECK 9 passed: owner payload complete, newest-first, and leaks no spotter identity';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 10 — NOT_OWNER. get_post_sightings refuses the SPOTTER (A) and an
-- unrelated user (B); the same token also covers a missing post id.
-- -----------------------------------------------------------------------------
do $$
declare
  v_a boolean := false;
  v_b boolean := false;
  v_m boolean := false;
begin
  perform set_config(
    'request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}',
    true);
  begin
    perform public.get_post_sightings('a1a1a1a1-0000-0000-0000-000000000001');
  exception when others then
    if sqlerrm like 'NOT_OWNER%' then v_a := true;
    else raise exception 'CHECK 10 FAILED (spotter): expected NOT_OWNER, got: %', sqlerrm; end if;
  end;

  perform set_config(
    'request.jwt.claims',
    '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}',
    true);
  begin
    perform public.get_post_sightings('a1a1a1a1-0000-0000-0000-000000000001');
  exception when others then
    if sqlerrm like 'NOT_OWNER%' then v_b := true;
    else raise exception 'CHECK 10 FAILED (unrelated): expected NOT_OWNER, got: %', sqlerrm; end if;
  end;

  begin
    perform public.get_post_sightings('deaddead-dead-dead-dead-deaddeaddead');
  exception when others then
    if sqlerrm like 'NOT_OWNER%' then v_m := true;
    else raise exception 'CHECK 10 FAILED (missing): expected NOT_OWNER, got: %', sqlerrm; end if;
  end;

  if not (v_a and v_b and v_m) then
    raise exception 'CHECK 10 FAILED: spotter=% unrelated=% missing=%', v_a, v_b, v_m;
  end if;
  raise notice 'CHECK 10 passed: non-owners (and missing ids) raise NOT_OWNER';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 11 — RLS under the REAL authenticated role: spotter A sees exactly her
-- own 3 sighting rows + 4 photo rows; spotter B (no sightings) sees ZERO rows
-- on both tables. The owner sees zero raw rows too (owner reads via the RPC
-- ONLY — raw rows carry spotter_id).
-- -----------------------------------------------------------------------------
do $$
declare
  v_s int; v_p int;
begin
  -- Spotter A: own rows only.
  perform set_config(
    'request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}',
    true);
  set local role authenticated;
  select count(*) into v_s from public.sightings;
  select count(*) into v_p from public.sighting_photos;
  reset role;
  if v_s <> 3 or v_p <> 4 then
    raise exception 'CHECK 11 FAILED: spotter A should see 3 sightings / 4 photos, saw % / %', v_s, v_p;
  end if;

  -- Spotter B: zero rows.
  perform set_config(
    'request.jwt.claims',
    '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}',
    true);
  set local role authenticated;
  select count(*) into v_s from public.sightings;
  select count(*) into v_p from public.sighting_photos;
  reset role;
  if v_s <> 0 or v_p <> 0 then
    raise exception 'CHECK 11 FAILED: spotter B should see 0 rows, saw % sightings / % photos', v_s, v_p;
  end if;

  -- The post OWNER: zero RAW rows (spotter_id must never reach them via SELECT).
  perform set_config(
    'request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}',
    true);
  set local role authenticated;
  select count(*) into v_s from public.sightings;
  select count(*) into v_p from public.sighting_photos;
  reset role;
  if v_s <> 0 or v_p <> 0 then
    raise exception 'CHECK 11 FAILED: the owner can read % raw sighting row(s) / % photo row(s) — spotter_id leaks; owners must use get_post_sightings', v_s, v_p;
  end if;

  raise notice 'CHECK 11 passed: RLS shows spotters their own rows only; owner gets zero raw rows';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 12 — DENY-BY-DEFAULT for the REAL anon role: SELECT on both tables and
-- EXECUTE on all three RPCs are denied at the GRANT layer (42501). Any error
-- OTHER than 42501 on an RPC means its body ran — i.e. anon holds EXECUTE —
-- and fails the check (the 20260713191000 incident class).
-- -----------------------------------------------------------------------------
do $$
declare
  v_denied int := 0;
  v_rows   int;
begin
  perform set_config('request.jwt.claims', null, true);

  begin
    set local role anon;
    select count(*) into v_rows from public.sightings;
    reset role;
    raise exception 'CHECK 12 FAILED: anon SELECT on sightings was NOT grant-denied (saw % row(s))', v_rows;
  exception when insufficient_privilege then
    v_denied := v_denied + 1;  -- 42501; sub-block rollback also reverts the role
  end;

  begin
    set local role anon;
    select count(*) into v_rows from public.sighting_photos;
    reset role;
    raise exception 'CHECK 12 FAILED: anon SELECT on sighting_photos was NOT grant-denied (saw % row(s))', v_rows;
  exception when insufficient_privilege then
    v_denied := v_denied + 1;
  end;

  begin
    set local role anon;
    perform public.create_sighting(
      'a1a1a1a1-0000-0000-0000-000000000001', '[]'::jsonb, null, null, null);
    reset role;
  exception
    when insufficient_privilege then v_denied := v_denied + 1;
    when others then
      raise exception 'CHECK 12 FAILED: create_sighting as anon raised "%" (SQLSTATE %) — its body ran, so anon still holds EXECUTE (expected 42501)', sqlerrm, sqlstate;
  end;

  begin
    set local role anon;
    perform public.my_sighting_quota('a1a1a1a1-0000-0000-0000-000000000001');
    reset role;
  exception
    when insufficient_privilege then v_denied := v_denied + 1;
    when others then
      raise exception 'CHECK 12 FAILED: my_sighting_quota as anon raised "%" (SQLSTATE %) — its body ran, so anon still holds EXECUTE (expected 42501)', sqlerrm, sqlstate;
  end;

  begin
    set local role anon;
    perform public.get_post_sightings('a1a1a1a1-0000-0000-0000-000000000001');
    reset role;
  exception
    when insufficient_privilege then v_denied := v_denied + 1;
    when others then
      raise exception 'CHECK 12 FAILED: get_post_sightings as anon raised "%" (SQLSTATE %) — its body ran, so anon still holds EXECUTE (expected 42501)', sqlerrm, sqlstate;
  end;

  if v_denied <> 5 then
    raise exception 'CHECK 12 FAILED: expected 5 grant denials for anon, got %', v_denied;
  end if;
  raise notice 'CHECK 12 passed: anon grant-denied (42501) on both tables and all three RPCs';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 13 — get_post_detail's sighting_stats aggregate is LIVE: the fixture
-- post now reports count=3 with a non-null latest_at — and STILL exposes no
-- per-sighting rows or spotter identity (scalar aggregate only).
-- -----------------------------------------------------------------------------
do $$
declare
  v_doc jsonb;
begin
  perform set_config('request.jwt.claims', null, true);  -- anon-shaped viewer

  v_doc := public.get_post_detail('a1a1a1a1-0000-0000-0000-000000000001');
  if (v_doc -> 'sighting_stats' ->> 'count')::int <> 3 then
    raise exception 'CHECK 13 FAILED: sighting_stats.count should be 3, got %', v_doc -> 'sighting_stats';
  end if;
  if (v_doc -> 'sighting_stats' -> 'latest_at') = 'null'::jsonb then
    raise exception 'CHECK 13 FAILED: sighting_stats.latest_at should be set, got %', v_doc -> 'sighting_stats';
  end if;
  if v_doc ? 'sightings' or v_doc::text like '%"sightings"%' or v_doc::text like '%spotter%' then
    raise exception 'CHECK 13 FAILED: detail payload widened beyond the scalar aggregate: %', v_doc;
  end if;
  raise notice 'CHECK 13 passed: get_post_detail reports the live scalar aggregate (count=3, latest_at set)';
end $$;


-- -----------------------------------------------------------------------------
-- Housekeeping: remove this file's sightings (cascades to photos) and roll the
-- reputation counter back by exactly the rows removed, so the seed state stays
-- as-is for other test files and re-runs.
-- -----------------------------------------------------------------------------
do $$
declare
  v_n int;
begin
  select count(*) into v_n
  from public.sightings
  where post_id = 'a1a1a1a1-0000-0000-0000-000000000001'
    and spotter_id = '22222222-2222-2222-2222-222222222222';

  delete from public.sightings
  where post_id = 'a1a1a1a1-0000-0000-0000-000000000001';

  update public.profiles
  set sightings_reported = greatest(sightings_reported - v_n, 0)
  where id = '22222222-2222-2222-2222-222222222222';

  raise notice 'Housekeeping: removed % sighting(s) and rolled the reputation counter back', v_n;
end $$;

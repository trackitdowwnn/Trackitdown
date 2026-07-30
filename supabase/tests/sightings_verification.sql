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
-- CHECK 14 — create_sighting's p_locality (20260801130000): stored TRIMMED,
-- whitespace-only becomes NULL, and an 81-char locality raises INVALID_INPUT.
-- (Two sightings for spotter B on the fixture post; their created_at is then
-- staggered into the near future so CHECK 15's newest-first order is
-- deterministic. B's reported counter is rolled straight back — housekeeping
-- only rolls back spotter A's.)
-- -----------------------------------------------------------------------------
do $$
declare
  v_d1 jsonb;
  v_d2 jsonb;
  v_loc text;
  v_ok  boolean := false;
begin
  perform set_config(
    'request.jwt.claims',
    '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}',
    true);

  -- (a) padded locality -> stored trimmed.
  v_d1 := public.create_sighting(
    'a1a1a1a1-0000-0000-0000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'path', 'a1a1a1a1-0000-0000-0000-000000000001/33333333-3333-3333-3333-333333333333/l1.jpg',
      'captured_at', now()::text)),
    null, null, null,
    '  Holloway  ');
  select locality into v_loc
  from public.sightings where id = (v_d1 ->> 'sighting_id')::uuid;
  if v_loc is distinct from 'Holloway' then
    raise exception 'CHECK 14 FAILED: locality should store trimmed as Holloway, got %', coalesce(v_loc, '<null>');
  end if;

  -- (b) whitespace-only locality -> stored NULL (renders time-only publicly).
  v_d2 := public.create_sighting(
    'a1a1a1a1-0000-0000-0000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'path', 'a1a1a1a1-0000-0000-0000-000000000001/33333333-3333-3333-3333-333333333333/l2.jpg',
      'captured_at', now()::text)),
    null, null, null,
    '   ');
  select locality into v_loc
  from public.sightings where id = (v_d2 ->> 'sighting_id')::uuid;
  if v_loc is not null then
    raise exception 'CHECK 14 FAILED: whitespace-only locality should store NULL, got %', v_loc;
  end if;

  -- (c) 81-char locality -> INVALID_INPUT (raises before any insert, so it
  -- does not consume spotter B's quota).
  begin
    perform public.create_sighting(
      'a1a1a1a1-0000-0000-0000-000000000001',
      jsonb_build_array(jsonb_build_object(
        'path', 'a1a1a1a1-0000-0000-0000-000000000001/33333333-3333-3333-3333-333333333333/l3.jpg',
        'captured_at', now()::text)),
      null, null, null,
      repeat('z', 81));
    raise exception 'CHECK 14 FAILED: an 81-char locality was accepted';
  exception when others then
    if sqlerrm like 'INVALID_INPUT%' then v_ok := true;
    else raise exception 'CHECK 14 FAILED (long locality): expected INVALID_INPUT, got: %', sqlerrm; end if;
  end;
  if not v_ok then
    raise exception 'CHECK 14 FAILED: the long-locality call did not raise';
  end if;

  -- Stagger for CHECK 15's deterministic newest-first assertions.
  update public.sightings set created_at = now() + interval '2 minutes'
  where id = (v_d1 ->> 'sighting_id')::uuid;
  update public.sightings set created_at = now() + interval '1 minute'
  where id = (v_d2 ->> 'sighting_id')::uuid;

  -- Delta-clean seed state: roll B's reported counter straight back.
  update public.profiles
  set sightings_reported = greatest(sightings_reported - 2, 0)
  where id = '33333333-3333-3333-3333-333333333333';

  raise notice 'CHECK 14 passed: locality stored trimmed, empty -> NULL, 81 chars raises INVALID_INPUT';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 15 — get_public_sighting_entries as the REAL anon role on the ACTIVE
-- post (the ADR-0008 carve-out; the call SUCCEEDING is itself the grant
-- assertion): 7 sightings on the post -> exactly 5 entries newest-first with
-- earlier_count=2, each entry carrying EXACTLY the keys sighted_at + locality
-- (locality null renders as json null), and the raw payload leaking none of
-- the fenced fields. Seeds 2 extra sightings directly (spotter B is
-- rate-capped at 3/24h, and direct rows let this block pin created_at).
-- -----------------------------------------------------------------------------
do $$
declare
  v_doc jsonb;
  v_txt text;
  v_bad int;
begin
  -- Direct seed rows: one future-most WITH a locality, one 2 days old (falls
  -- outside the top 5, so it can only surface via earlier_count).
  insert into public.sightings
    (id, post_id, spotter_id, status, locality, location_unavailable, created_at)
  values
    ('f00d0000-0000-0000-0000-000000000001', 'a1a1a1a1-0000-0000-0000-000000000001',
     '33333333-3333-3333-3333-333333333333', 'unverified', 'Archway', true,
     now() + interval '3 minutes'),
    ('f00d0000-0000-0000-0000-000000000002', 'a1a1a1a1-0000-0000-0000-000000000001',
     '33333333-3333-3333-3333-333333333333', 'unverified', null, true,
     now() - interval '2 days');

  perform set_config('request.jwt.claims', null, true);
  set local role anon;
  v_doc := public.get_public_sighting_entries('a1a1a1a1-0000-0000-0000-000000000001');
  reset role;

  if jsonb_typeof(v_doc -> 'entries') <> 'array'
     or jsonb_array_length(v_doc -> 'entries') <> 5 then
    raise exception 'CHECK 15 FAILED: expected 5 entries (7 seeded, server cap 5), got %', v_doc;
  end if;
  if (v_doc ->> 'earlier_count')::int <> 2 then
    raise exception 'CHECK 15 FAILED: earlier_count should be 2 (7 - 5), got %', v_doc ->> 'earlier_count';
  end if;

  -- Newest-first with the seeded localities in order; entry index 2 (CHECK
  -- 14's whitespace-only locality) must render locality as json null.
  if (v_doc -> 'entries' -> 0 ->> 'locality') is distinct from 'Archway'
     or (v_doc -> 'entries' -> 1 ->> 'locality') is distinct from 'Holloway'
     or (v_doc -> 'entries' -> 2 -> 'locality') <> 'null'::jsonb then
    raise exception 'CHECK 15 FAILED: entry localities/order wrong: %', v_doc -> 'entries';
  end if;
  if (v_doc -> 'entries' -> 0 ->> 'sighted_at')::timestamptz
     < (v_doc -> 'entries' -> 4 ->> 'sighted_at')::timestamptz then
    raise exception 'CHECK 15 FAILED: entries not ordered newest-first';
  end if;

  -- EXACT key set per entry: sighted_at + locality + snap_lat + snap_lng,
  -- nothing else (Tier 1 — ADR-0008 absence BY CONSTRUCTION, asserted rather
  -- than trusted; snap_* added by ADR-0009 / 20260801170000).
  select count(*) into v_bad
  from jsonb_array_elements(v_doc -> 'entries') e
  where (select array_agg(k order by k) from jsonb_object_keys(e.value) k)
        is distinct from array['locality', 'sighted_at', 'snap_lat', 'snap_lng'];
  if v_bad <> 0 then
    raise exception 'CHECK 15 FAILED: % entr(y/ies) carry keys beyond sighted_at+locality+snap_*: %', v_bad, v_doc -> 'entries';
  end if;

  -- ADR-0009: snap_* are GRID-SNAPPED (0.01°), never raw capture points —
  -- every non-null snap must sit exactly on the grid.
  select count(*) into v_bad
  from jsonb_array_elements(v_doc -> 'entries') e
  where (e.value -> 'snap_lat') <> 'null'::jsonb
    and (round((e.value ->> 'snap_lat')::numeric, 2) <> (e.value ->> 'snap_lat')::numeric
         or round((e.value ->> 'snap_lng')::numeric, 2) <> (e.value ->> 'snap_lng')::numeric);
  if v_bad <> 0 then
    raise exception 'CHECK 15 FAILED: % snap point(s) are off the 0.01-degree grid (raw coordinate leak?): %', v_bad, v_doc -> 'entries';
  end if;

  -- Belt-and-braces ABSENCE assertions on the raw payload text. NOTE the
  -- "lat"/"lng" probes stay: the ONLY location keys allowed are snap_lat /
  -- snap_lng — a raw "lat" key appearing is exactly the leak they catch.
  v_txt := v_doc::text;
  if v_txt like '%spotter%' or v_txt like '%"id"%' or v_txt like '%path%'
     or v_txt like '%"lat"%' or v_txt like '%"lng"%' or v_txt like '%note%'
     or v_txt like '%area_label%' or v_txt like '%accuracy%'
     or v_txt like '%status%' or v_txt like '%photo%' then
    raise exception 'CHECK 15 FAILED: public payload leaks a fenced field: %', v_txt;
  end if;

  raise notice 'CHECK 15 passed: anon gets 5 capped {sighted_at, locality, snap_*} entries on the 0.01-degree grid, earlier_count=2, nothing else';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 16 — NO EXISTENCE ORACLE: a non-active post (the seeded DRAFT trap) and
-- a missing post id both return the IDENTICAL empty shape
-- { entries: [], earlier_count: 0 } to anon — no error, no distinguishing bit.
-- -----------------------------------------------------------------------------
do $$
declare
  v_expected jsonb := jsonb_build_object('entries', '[]'::jsonb, 'earlier_count', 0);
  v_doc      jsonb;
begin
  perform set_config('request.jwt.claims', null, true);

  set local role anon;
  v_doc := public.get_public_sighting_entries('a1a1a1a1-0000-0000-0000-00000000001b');
  reset role;
  if v_doc <> v_expected then
    raise exception 'CHECK 16 FAILED: a non-active post should return the empty shape, got %', v_doc;
  end if;

  set local role anon;
  v_doc := public.get_public_sighting_entries('deaddead-dead-dead-dead-deaddeaddead');
  reset role;
  if v_doc <> v_expected then
    raise exception 'CHECK 16 FAILED: a missing post should return the SAME empty shape, got %', v_doc;
  end if;

  raise notice 'CHECK 16 passed: non-active and missing posts return one identical empty shape (no oracle)';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 17 — GRANT boundary: anon holds EXECUTE on get_public_sighting_entries
-- (the ONE deliberate public sighting grant — ADR-0008) and NOT on
-- mark_sighting_helpful; behaviourally, the REAL anon role gets 42501 on
-- mark_sighting_helpful (any OTHER error means its body ran — the
-- 20260713191000 incident class).
-- -----------------------------------------------------------------------------
do $$
declare
  v_denied boolean := false;
begin
  if not has_function_privilege('anon', 'public.get_public_sighting_entries(uuid)', 'execute') then
    raise exception 'CHECK 17 FAILED: anon lost EXECUTE on get_public_sighting_entries (the ADR-0008 carve-out)';
  end if;
  if has_function_privilege('anon', 'public.mark_sighting_helpful(uuid)', 'execute') then
    raise exception 'CHECK 17 FAILED: anon holds EXECUTE on mark_sighting_helpful';
  end if;
  if not has_function_privilege('authenticated', 'public.mark_sighting_helpful(uuid)', 'execute') then
    raise exception 'CHECK 17 FAILED: authenticated lost EXECUTE on mark_sighting_helpful';
  end if;

  perform set_config('request.jwt.claims', null, true);
  begin
    set local role anon;
    perform public.mark_sighting_helpful('f00d0000-0000-0000-0000-000000000001');
    reset role;
  exception
    when insufficient_privilege then v_denied := true;
    when others then
      raise exception 'CHECK 17 FAILED: mark_sighting_helpful as anon raised "%" (SQLSTATE %) — its body ran, so anon still holds EXECUTE (expected 42501)', sqlerrm, sqlstate;
  end;
  if not v_denied then
    raise exception 'CHECK 17 FAILED: mark_sighting_helpful as anon did not raise at all';
  end if;

  raise notice 'CHECK 17 passed: anon may execute get_public_sighting_entries but not mark_sighting_helpful';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 18 — mark_sighting_helpful: the OWNER marks spotter A's unverified
-- sighting -> {helpful, changed:true} with sightings_helpful +1; the repeat is
-- an idempotent no-op ({helpful, changed:false}, NO second bump — exactly +1
-- across both calls); a 'credited' sighting stays credited with no bump and no
-- error; a non-owner and a missing id both raise the one opaque NOT_OWNER.
-- (A's helpful counter is rolled straight back at the end — housekeeping only
-- rolls back sightings_reported.)
-- -----------------------------------------------------------------------------
do $$
declare
  v_target   uuid;
  v_before   int;
  v_after    int;
  v_b_before int;
  v_b_after  int;
  v_r        jsonb;
  v_status   text;
  v_hits     int := 0;
begin
  -- Target: spotter A's oldest sighting on the fixture post (CHECK 1's row,
  -- still 'unverified').
  select id into v_target
  from public.sightings
  where post_id = 'a1a1a1a1-0000-0000-0000-000000000001'
    and spotter_id = '22222222-2222-2222-2222-222222222222'
  order by created_at asc
  limit 1;

  select sightings_helpful into v_before
  from public.profiles where id = '22222222-2222-2222-2222-222222222222';

  -- (a) OWNER: unverified -> helpful, changed:true, row updated.
  perform set_config(
    'request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}',
    true);
  v_r := public.mark_sighting_helpful(v_target);
  if (v_r ->> 'status') <> 'helpful' or not (v_r ->> 'changed')::boolean then
    raise exception 'CHECK 18 FAILED: first mark should be {helpful, changed:true}, got %', v_r;
  end if;
  select status into v_status from public.sightings where id = v_target;
  if v_status <> 'helpful' then
    raise exception 'CHECK 18 FAILED: row status should be helpful, got %', v_status;
  end if;

  -- (b) Repeat: idempotent no-op, changed:false.
  v_r := public.mark_sighting_helpful(v_target);
  if (v_r ->> 'status') <> 'helpful' or (v_r ->> 'changed')::boolean then
    raise exception 'CHECK 18 FAILED: re-mark should be {helpful, changed:false}, got %', v_r;
  end if;

  -- The counter moved EXACTLY once across both calls.
  select sightings_helpful into v_after
  from public.profiles where id = '22222222-2222-2222-2222-222222222222';
  if v_after <> v_before + 1 then
    raise exception 'CHECK 18 FAILED: sightings_helpful should go % -> % across two calls, got %', v_before, v_before + 1, v_after;
  end if;

  -- (c) credited stays credited: no re-label, no bump, no error (a payout
  -- record — DOMAIN.md). Uses CHECK 15's old direct-seeded sighting (spotter B).
  update public.sightings set status = 'credited'
  where id = 'f00d0000-0000-0000-0000-000000000002';
  select sightings_helpful into v_b_before
  from public.profiles where id = '33333333-3333-3333-3333-333333333333';
  v_r := public.mark_sighting_helpful('f00d0000-0000-0000-0000-000000000002');
  if (v_r ->> 'status') <> 'credited' or (v_r ->> 'changed')::boolean then
    raise exception 'CHECK 18 FAILED: a credited tap should return {credited, changed:false}, got %', v_r;
  end if;
  select status into v_status from public.sightings
  where id = 'f00d0000-0000-0000-0000-000000000002';
  if v_status <> 'credited' then
    raise exception 'CHECK 18 FAILED: credited sighting re-labelled to %', v_status;
  end if;
  select sightings_helpful into v_b_after
  from public.profiles where id = '33333333-3333-3333-3333-333333333333';
  if v_b_after <> v_b_before then
    raise exception 'CHECK 18 FAILED: a credited tap bumped sightings_helpful (% -> %)', v_b_before, v_b_after;
  end if;

  -- (d) Non-owner (the spotter herself) and a missing id: one opaque NOT_OWNER.
  perform set_config(
    'request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}',
    true);
  begin
    perform public.mark_sighting_helpful(v_target);
    raise exception 'CHECK 18 FAILED: a non-owner mark was accepted';
  exception when others then
    if sqlerrm like 'NOT_OWNER%' then v_hits := v_hits + 1;
    else raise exception 'CHECK 18 FAILED (non-owner): expected NOT_OWNER, got: %', sqlerrm; end if;
  end;
  begin
    perform public.mark_sighting_helpful('deaddead-dead-dead-dead-deaddeaddead');
    raise exception 'CHECK 18 FAILED: a missing sighting id was accepted';
  exception when others then
    if sqlerrm like 'NOT_OWNER%' then v_hits := v_hits + 1;
    else raise exception 'CHECK 18 FAILED (missing): expected NOT_OWNER, got: %', sqlerrm; end if;
  end;
  if v_hits <> 2 then
    raise exception 'CHECK 18 FAILED: expected 2 NOT_OWNER rejections, got %', v_hits;
  end if;

  -- Delta-clean seed state: roll A's helpful counter straight back.
  update public.profiles
  set sightings_helpful = greatest(sightings_helpful - 1, 0)
  where id = '22222222-2222-2222-2222-222222222222';

  raise notice 'CHECK 18 passed: helpful bumps exactly once, credited never re-labels, non-owner/missing raise NOT_OWNER';
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


-- =============================================================================
-- Context v2 checks (20260801150000_sighting_context_v2.sql). These run AFTER
-- the housekeeping above, so the fixture post starts sighting-free and both
-- spotters have a fresh 3/24h quota. Extra fixtures (deleted-then-inserted
-- here, removed by Housekeeping 2 at the end):
--   post_distinctive_feature dfa10000-...000a / ...000b on the ACTIVE post
--   (the seed ships no marks) and dfa10000-...00ff on a DIFFERENT active post
--   (a1a1a1a1-...0002) — the foreign-feature probe.
-- =============================================================================
do $$
begin
  -- Delete-first (fixed uuids) so an aborted earlier run cannot break inserts.
  delete from public.post_distinctive_feature
  where id in ('dfa10000-0000-0000-0000-00000000000a',
               'dfa10000-0000-0000-0000-00000000000b',
               'dfa10000-0000-0000-0000-0000000000ff');

  insert into public.post_distinctive_feature (id, post_id, photo_url, description, position)
  values
    ('dfa10000-0000-0000-0000-00000000000a', 'a1a1a1a1-0000-0000-0000-000000000001',
     'https://example.test/storage/v1/object/public/post-photos/df-a.jpg',
     'Cracked nearside wing mirror', 0),
    ('dfa10000-0000-0000-0000-00000000000b', 'a1a1a1a1-0000-0000-0000-000000000001',
     'https://example.test/storage/v1/object/public/post-photos/df-b.jpg',
     'Bee sticker on the boot', 1),
    ('dfa10000-0000-0000-0000-0000000000ff', 'a1a1a1a1-0000-0000-0000-000000000002',
     'https://example.test/storage/v1/object/public/post-photos/df-x.jpg',
     'Foreign-post decoy mark', 0);

  raise notice 'Context v2 fixtures: 2 marks on the fixture post, 1 decoy on another post';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 19 — REGRESSION (the 20260801150000 part-1 bugfix): a sighting with
-- context_flags including 'being_loaded' AND the three new condition flags
-- succeeds and stores them. Before the migration the RPC accepted
-- 'being_loaded' but the TABLE constraint (20260714100000) didn't, so this
-- exact call died as a raw 23514 instead of inserting.
-- (Sighting #1 of spotter A's fresh quota.)
-- -----------------------------------------------------------------------------
do $$
declare
  v_doc jsonb;
  v_row public.sightings%rowtype;
begin
  perform set_config(
    'request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}',
    true);

  v_doc := public.create_sighting(
    'a1a1a1a1-0000-0000-0000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'path', 'a1a1a1a1-0000-0000-0000-000000000001/22222222-2222-2222-2222-222222222222/v2-1.jpg',
      'captured_at', (now() - interval '5 minutes')::text)),
    array['being_loaded', 'damage_visible', 'being_stripped', 'looks_intact'],
    'On a flatbed with the doors off.',
    null);

  select * into v_row from public.sightings where id = (v_doc ->> 'sighting_id')::uuid;
  if v_row.context_flags <> array['being_loaded', 'damage_visible', 'being_stripped', 'looks_intact'] then
    raise exception 'CHECK 19 FAILED: v2 context_flags not stored: %', v_row.context_flags;
  end if;
  raise notice 'CHECK 19 passed: being_loaded + the new condition flags insert cleanly (table CHECK matches the RPC)';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 20 — people_presence: a valid value is stored on the row; an invalid
-- value raises INVALID_INPUT (spotter B probes, so no quota is consumed and B
-- stays at zero rows). (Sighting #2 of spotter A's quota.)
-- -----------------------------------------------------------------------------
do $$
declare
  v_doc jsonb;
  v_pp  text;
  v_ok  boolean := false;
begin
  perform set_config(
    'request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}',
    true);

  -- (a) valid: 'in_vehicle' (the urgency case) stored verbatim.
  v_doc := public.create_sighting(
    'a1a1a1a1-0000-0000-0000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'path', 'a1a1a1a1-0000-0000-0000-000000000001/22222222-2222-2222-2222-222222222222/v2-2.jpg',
      'captured_at', (now() - interval '4 minutes')::text)),
    null, null, null,
    null,          -- p_locality
    null,          -- p_parked_likelihood
    null,          -- p_direction
    'in_vehicle'); -- p_people_presence
  select people_presence into v_pp
  from public.sightings where id = (v_doc ->> 'sighting_id')::uuid;
  if v_pp is distinct from 'in_vehicle' then
    raise exception 'CHECK 20 FAILED: people_presence should store in_vehicle, got %', coalesce(v_pp, '<null>');
  end if;

  -- (b) invalid: a value outside nobody/nearby/in_vehicle raises INVALID_INPUT.
  perform set_config(
    'request.jwt.claims',
    '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}',
    true);
  begin
    perform public.create_sighting(
      'a1a1a1a1-0000-0000-0000-000000000001',
      jsonb_build_array(jsonb_build_object(
        'path', 'a1a1a1a1-0000-0000-0000-000000000001/33333333-3333-3333-3333-333333333333/v2-pp.jpg',
        'captured_at', now()::text)),
      null, null, null, null, null, null,
      'crowd');
    raise exception 'CHECK 20 FAILED: an invalid people_presence was accepted';
  exception when others then
    if sqlerrm like 'INVALID_INPUT%' then v_ok := true;
    else raise exception 'CHECK 20 FAILED (invalid value): expected INVALID_INPUT, got: %', sqlerrm; end if;
  end;
  if not v_ok then
    raise exception 'CHECK 20 FAILED: the invalid people_presence call did not raise';
  end if;

  raise notice 'CHECK 20 passed: people_presence stored when valid; invalid value raises INVALID_INPUT';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 21 — confirmed_feature_ids: valid ids (with a duplicate) store DEDUPED;
-- a feature id belonging to a DIFFERENT post and a nonexistent id both raise
-- the one opaque 'unknown feature id' token (no probing another post's feature
-- ids); more than 8 ids raises 'too many confirmed features'. Probes run as
-- spotter B (they raise before any insert). (Sighting #3 of spotter A's quota.)
-- -----------------------------------------------------------------------------
do $$
declare
  v_doc  jsonb;
  v_ids  uuid[];
  v_hits int := 0;
  v_probe jsonb := jsonb_build_array(jsonb_build_object(
    'path', 'a1a1a1a1-0000-0000-0000-000000000001/33333333-3333-3333-3333-333333333333/v2-cf.jpg',
    'captured_at', now()::text));
begin
  perform set_config(
    'request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}',
    true);

  -- (a) valid, with mark A passed twice -> stored deduped (2 ids, both marks).
  v_doc := public.create_sighting(
    'a1a1a1a1-0000-0000-0000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'path', 'a1a1a1a1-0000-0000-0000-000000000001/22222222-2222-2222-2222-222222222222/v2-3.jpg',
      'captured_at', (now() - interval '3 minutes')::text)),
    null, null, null, null, null, null, null,
    array['dfa10000-0000-0000-0000-00000000000a',
          'dfa10000-0000-0000-0000-00000000000b',
          'dfa10000-0000-0000-0000-00000000000a']::uuid[]);
  select confirmed_feature_ids into v_ids
  from public.sightings where id = (v_doc ->> 'sighting_id')::uuid;
  if array_length(v_ids, 1) is distinct from 2
     or not (v_ids @> array['dfa10000-0000-0000-0000-00000000000a',
                            'dfa10000-0000-0000-0000-00000000000b']::uuid[]) then
    raise exception 'CHECK 21 FAILED: confirmed_feature_ids should be the 2 marks deduped, got %', v_ids;
  end if;

  perform set_config(
    'request.jwt.claims',
    '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}',
    true);

  -- (b) a real feature id on a DIFFERENT post -> opaque unknown-feature token.
  begin
    perform public.create_sighting(
      'a1a1a1a1-0000-0000-0000-000000000001', v_probe,
      null, null, null, null, null, null, null,
      array['dfa10000-0000-0000-0000-0000000000ff']::uuid[]);
    raise exception 'CHECK 21 FAILED: another post''s feature id was accepted';
  exception when others then
    if sqlerrm like 'INVALID_INPUT: unknown feature id%' then v_hits := v_hits + 1;
    else raise exception 'CHECK 21 FAILED (foreign feature): expected INVALID_INPUT: unknown feature id, got: %', sqlerrm; end if;
  end;

  -- (c) a nonexistent id -> the SAME token (no existence oracle).
  begin
    perform public.create_sighting(
      'a1a1a1a1-0000-0000-0000-000000000001', v_probe,
      null, null, null, null, null, null, null,
      array['deaddead-dead-dead-dead-deaddeaddead']::uuid[]);
    raise exception 'CHECK 21 FAILED: a nonexistent feature id was accepted';
  exception when others then
    if sqlerrm like 'INVALID_INPUT: unknown feature id%' then v_hits := v_hits + 1;
    else raise exception 'CHECK 21 FAILED (missing feature): expected INVALID_INPUT: unknown feature id, got: %', sqlerrm; end if;
  end;

  -- (d) 9 ids -> bounded BEFORE dedupe/lookup, so 9 randoms fail cheaply.
  begin
    perform public.create_sighting(
      'a1a1a1a1-0000-0000-0000-000000000001', v_probe,
      null, null, null, null, null, null, null,
      (select array_agg(gen_random_uuid()) from generate_series(1, 9)));
    raise exception 'CHECK 21 FAILED: 9 confirmed feature ids were accepted';
  exception when others then
    if sqlerrm like 'INVALID_INPUT: too many confirmed features%' then v_hits := v_hits + 1;
    else raise exception 'CHECK 21 FAILED (9 ids): expected INVALID_INPUT: too many confirmed features, got: %', sqlerrm; end if;
  end;

  if v_hits <> 3 then
    raise exception 'CHECK 21 FAILED: expected 3 rejections, got %', v_hits;
  end if;
  raise notice 'CHECK 21 passed: confirmed ids deduped; foreign/missing ids and >8 ids raise clean INVALID_INPUT tokens';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 22 — get_post_sightings (as the OWNER): every sighting object carries a
-- people_presence key (json null for un-answered rows, 'in_vehicle' on CHECK
-- 20's row) and the newest sighting's confirmed_features resolve to the 2 marks
-- in POSITION order — each entry carrying EXACTLY the keys id + description
-- (never photo_url; the CHECK 15 jsonb_object_keys technique).
-- -----------------------------------------------------------------------------
do $$
declare
  v_doc jsonb;
  v_bad int;
  v_cf  jsonb;
begin
  perform set_config(
    'request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}',
    true);

  v_doc := public.get_post_sightings('a1a1a1a1-0000-0000-0000-000000000001');
  if jsonb_typeof(v_doc) <> 'array' or jsonb_array_length(v_doc) <> 3 then
    raise exception 'CHECK 22 FAILED: expected 3 sightings (CHECKs 19-21), got %', v_doc;
  end if;

  -- Every row carries the people_presence key; only CHECK 20's row sets it.
  select count(*) into v_bad
  from jsonb_array_elements(v_doc) s
  where not (s.value ? 'people_presence');
  if v_bad <> 0 then
    raise exception 'CHECK 22 FAILED: % sighting(s) missing the people_presence key', v_bad;
  end if;
  if (v_doc -> 1 ->> 'people_presence') is distinct from 'in_vehicle'
     or (v_doc -> 0 -> 'people_presence') <> 'null'::jsonb
     or (v_doc -> 2 -> 'people_presence') <> 'null'::jsonb then
    raise exception 'CHECK 22 FAILED: people_presence values wrong (newest-first should be null/in_vehicle/null): %',
      jsonb_build_array(v_doc -> 0 -> 'people_presence',
                        v_doc -> 1 -> 'people_presence',
                        v_doc -> 2 -> 'people_presence');
  end if;

  -- Newest (CHECK 21's row): both marks, POSITION order, {id, description} ONLY.
  v_cf := v_doc -> 0 -> 'confirmed_features';
  if jsonb_typeof(v_cf) <> 'array' or jsonb_array_length(v_cf) <> 2 then
    raise exception 'CHECK 22 FAILED: newest sighting should carry 2 confirmed_features, got %', v_cf;
  end if;
  if (v_cf -> 0 ->> 'description') is distinct from 'Cracked nearside wing mirror'
     or (v_cf -> 1 ->> 'description') is distinct from 'Bee sticker on the boot'
     or (v_cf -> 0 ->> 'id') is distinct from 'dfa10000-0000-0000-0000-00000000000a' then
    raise exception 'CHECK 22 FAILED: confirmed_features not resolved in position order: %', v_cf;
  end if;
  select count(*) into v_bad
  from jsonb_array_elements(v_cf) e
  where (select array_agg(k order by k) from jsonb_object_keys(e.value) k)
        is distinct from array['description', 'id'];
  if v_bad <> 0 then
    raise exception 'CHECK 22 FAILED: % confirmed_features entr(y/ies) carry keys beyond id+description: %', v_bad, v_cf;
  end if;

  -- The other rows confirmed nothing -> [].
  if (v_doc -> 1 -> 'confirmed_features') <> '[]'::jsonb
     or (v_doc -> 2 -> 'confirmed_features') <> '[]'::jsonb then
    raise exception 'CHECK 22 FAILED: unconfirmed sightings should carry [], got % / %',
      v_doc -> 1 -> 'confirmed_features', v_doc -> 2 -> 'confirmed_features';
  end if;

  raise notice 'CHECK 22 passed: owner payload carries people_presence + {id, description}-only confirmed_features';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 23 — get_post_detail: distinctive_features entries now carry an 'id'
-- key (the uuid the wizard submits back), alongside photo_url + description and
-- NOTHING else, in position order — to an anon-shaped viewer on the active post.
-- -----------------------------------------------------------------------------
do $$
declare
  v_doc jsonb;
  v_df  jsonb;
  v_bad int;
begin
  perform set_config('request.jwt.claims', null, true);  -- anon-shaped viewer

  v_doc := public.get_post_detail('a1a1a1a1-0000-0000-0000-000000000001');
  v_df := v_doc -> 'distinctive_features';
  if jsonb_typeof(v_df) <> 'array' or jsonb_array_length(v_df) <> 2 then
    raise exception 'CHECK 23 FAILED: expected the 2 fixture marks, got %', v_df;
  end if;
  if (v_df -> 0 ->> 'id') is distinct from 'dfa10000-0000-0000-0000-00000000000a'
     or (v_df -> 1 ->> 'id') is distinct from 'dfa10000-0000-0000-0000-00000000000b' then
    raise exception 'CHECK 23 FAILED: distinctive_features ids missing/wrong: %', v_df;
  end if;
  select count(*) into v_bad
  from jsonb_array_elements(v_df) e
  where (select array_agg(k order by k) from jsonb_object_keys(e.value) k)
        is distinct from array['description', 'id', 'photo_url'];
  if v_bad <> 0 then
    raise exception 'CHECK 23 FAILED: % entr(y/ies) carry keys beyond id+photo_url+description: %', v_bad, v_df;
  end if;

  raise notice 'CHECK 23 passed: get_post_detail marks carry {id, photo_url, description} exactly, in order';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 24 — vehicle-state flags are mutually exclusive server-side
-- (20260801160000): two state flags in one call raise INVALID_INPUT. Spotter B
-- probes (rolls back — no quota consumed, B stays at zero rows). One state flag
-- alongside condition flags is the ACCEPTED shape — already proven by CHECK 19.
-- -----------------------------------------------------------------------------
do $$
declare
  v_ok boolean := false;
begin
  perform set_config(
    'request.jwt.claims',
    '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}',
    true);
  begin
    perform public.create_sighting(
      'a1a1a1a1-0000-0000-0000-000000000001',
      jsonb_build_array(jsonb_build_object(
        'path', 'a1a1a1a1-0000-0000-0000-000000000001/33333333-3333-3333-3333-333333333333/v2-state.jpg',
        'captured_at', now()::text)),
      array['parked', 'driving'],
      null, null, null, null, null, null);
    raise exception 'CHECK 24 FAILED: two vehicle-state flags were accepted';
  exception when others then
    if sqlerrm like 'INVALID_INPUT%' then v_ok := true;
    else raise exception 'CHECK 24 FAILED: expected INVALID_INPUT, got: %', sqlerrm; end if;
  end;
  if not v_ok then
    raise exception 'CHECK 24 FAILED: the conflicting-state call did not raise';
  end if;

  raise notice 'CHECK 24 passed: conflicting vehicle-state flags raise INVALID_INPUT';
end $$;


-- -----------------------------------------------------------------------------
-- Housekeeping 2: remove the context-v2 sightings (cascades to photos), roll
-- spotter A's reported counter back by exactly the rows removed, and drop the
-- fixture distinctive-feature rows — the seed state leaves as it arrived.
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

  delete from public.post_distinctive_feature
  where id in ('dfa10000-0000-0000-0000-00000000000a',
               'dfa10000-0000-0000-0000-00000000000b',
               'dfa10000-0000-0000-0000-0000000000ff');

  raise notice 'Housekeeping 2: removed % context-v2 sighting(s), rolled the counter back, dropped the fixture marks', v_n;
end $$;

-- =============================================================================
-- create_post DISTINCTIVE-FEATURES safety / validation verification (NOT a
-- migration — do not place in migrations/).
--
-- SELF-ASSERTING: every check is a DO block that RAISES EXCEPTION on failure, so
-- the whole file aborts non-zero the moment a property is violated. It gates CI
-- for the distinctive-features addition to create_post (see
-- supabase/migrations/20260724100000_post_distinctive_features.sql). On success
-- each block emits a NOTICE. Companion to create_post_verification.sql, which
-- covers the pre-existing create_post properties.
--
-- Run against a local DB seeded by supabase/seed.sql:
--     supabase db reset            # applies migrations + seed
--     psql -v ON_ERROR_STOP=1 "$DATABASE_URL" -f supabase/tests/create_post_distinctive_features_verification.sql
--
-- (ON_ERROR_STOP=1 makes psql exit non-zero on the first RAISE.)
--
-- Fixtures used (from supabase/seed.sql):
--   Signed-in caller for creates: 22222222-2222-2222-2222-222222222222.
--
-- auth.uid() reads the request.jwt.claims GUC; the create-path blocks set it to
-- the caller's sub for the transaction. Assertions then read the tables directly
-- as postgres (bypassing RLS) to confirm what landed.
--
-- IDEMPOTENCY: the plates used below are deleted up-front so re-running without a
-- full `supabase db reset` stays deterministic (delete cascades to the post's
-- photos / feature tags / verification-doc / distinctive-feature rows).
--
-- Convenience: two valid own-folder post-photos URLs for the caller. A third
-- (foreign-host) URL is used to prove the own-folder gate for feature photos.
--   OWN:     http://127.0.0.1:54321/storage/v1/object/public/post-photos/<caller>/...
--   FOREIGN: https://evil.example/... (rejected)
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Clean up any leftover drafts from a previous run of this file.
-- -----------------------------------------------------------------------------
delete from public.posts
where upper(regexp_replace(coalesce(plate, ''), '[^A-Za-z0-9]', '', 'g'))
      in ('DF01ABC', 'DF02CNT', 'DF03SHT', 'DF04LNG', 'DF05URL', 'DF06NONE');


-- -----------------------------------------------------------------------------
-- CHECK D1 — a VALID create_post with two distinctive features inserts the right
-- rows in ORDER (position 0,1), with trimmed descriptions and the passed URLs.
-- Also proves the empty/other collections are unaffected.
-- -----------------------------------------------------------------------------
do $$
declare
  v_doc     jsonb;
  v_post_id uuid;
  v_count   int;
  v_desc0   text; v_url0 text;
  v_desc1   text; v_url1 text;
begin
  perform set_config(
    'request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}',
    true);

  v_doc := public.create_post(
    p_plate                   => 'DF01 ABC',
    p_make                    => 'Skoda',
    p_model                   => 'Octavia',
    p_colour                  => 'Green',
    p_year                    => 2020,
    p_body_type               => 'Estate',
    p_distinguishing_features => null,
    p_owner_note              => null,
    p_desc_recognise          => null,
    p_desc_drives             => null,
    p_stolen_from             => null,
    p_keys_taken              => null,
    p_last_seen_at            => now() - interval '1 day',
    p_last_seen_lat           => 53.4808,
    p_last_seen_lng           => -2.2426,
    p_last_seen_area          => 'Manchester',
    p_bounty_amount_pence     => 25000,
    p_photo_urls              => array[
      'http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/0.jpg',
      'http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/1.jpg',
      'http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/2.jpg'],
    p_feature_keys            => null,
    p_verification_path       => null,
    p_distinctive_features    => jsonb_build_array(
      jsonb_build_object(
        'photo_url', 'http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/mirror.jpg',
        'description', '  Cracked nearside wing mirror  '),   -- padded → stored trimmed
      jsonb_build_object(
        'photo_url', 'http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/dent.jpg',
        'description', 'Dent on the tailgate')
    )
  );

  v_post_id := (v_doc ->> 'post_id')::uuid;
  if v_post_id is null then
    raise exception 'CHECK D1 FAILED: no post_id returned: %', v_doc;
  end if;

  select count(*) into v_count
  from public.post_distinctive_feature where post_id = v_post_id;
  if v_count <> 2 then
    raise exception 'CHECK D1 FAILED: expected 2 distinctive features, got %', v_count;
  end if;

  select description, photo_url into v_desc0, v_url0
  from public.post_distinctive_feature where post_id = v_post_id and position = 0;
  select description, photo_url into v_desc1, v_url1
  from public.post_distinctive_feature where post_id = v_post_id and position = 1;

  if v_desc0 <> 'Cracked nearside wing mirror' then
    raise exception 'CHECK D1 FAILED: position 0 description not trimmed/ordered, got %', v_desc0;
  end if;
  if v_url0 not like '%/mirror.jpg' then
    raise exception 'CHECK D1 FAILED: position 0 photo_url wrong, got %', v_url0;
  end if;
  if v_desc1 <> 'Dent on the tailgate' then
    raise exception 'CHECK D1 FAILED: position 1 description wrong/ordered, got %', v_desc1;
  end if;
  if v_url1 not like '%/dent.jpg' then
    raise exception 'CHECK D1 FAILED: position 1 photo_url wrong, got %', v_url1;
  end if;

  delete from public.posts where id = v_post_id;  -- self-clean
  raise notice 'CHECK D1 passed: valid distinctive features insert in order, trimmed';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK D2 — COUNT. More than 8 distinctive features raises
-- DISTINCTIVE_FEATURES_COUNT (here: 9), and nothing is persisted (rolled back).
-- -----------------------------------------------------------------------------
do $$
declare
  v_ok    boolean := false;
  v_feats jsonb   := '[]'::jsonb;
  i       int;
begin
  perform set_config(
    'request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}',
    true);

  -- Build 9 valid feature objects.
  for i in 1..9 loop
    v_feats := v_feats || jsonb_build_array(jsonb_build_object(
      'photo_url', 'http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/f' || i || '.jpg',
      'description', 'Mark number ' || i));
  end loop;

  begin
    perform public.create_post(
      'DF02 CNT', 'Ford', 'Focus', 'Blue', 2019, null, null, null, null, null,
      null, null, now() - interval '1 day', 53.4808, -2.2426, 'Manchester',
      25000,
      array['http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/0.jpg',
            'http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/1.jpg',
            'http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/2.jpg'],
      null, null, v_feats);
  exception when others then
    if sqlerrm like '%DISTINCTIVE_FEATURES_COUNT%' then v_ok := true;
    else raise exception 'CHECK D2 FAILED: expected DISTINCTIVE_FEATURES_COUNT, got: %', sqlerrm; end if;
  end;

  if not v_ok then
    raise exception 'CHECK D2 FAILED: 9 distinctive features did NOT raise DISTINCTIVE_FEATURES_COUNT';
  end if;
  -- Confirm the atomic rollback: no post landed for this plate.
  if exists (select 1 from public.posts
             where upper(regexp_replace(coalesce(plate,''),'[^A-Za-z0-9]','','g')) = 'DF02CNT') then
    raise exception 'CHECK D2 FAILED: a post was persisted despite the count rejection';
  end if;
  raise notice 'CHECK D2 passed: >8 distinctive features raises DISTINCTIVE_FEATURES_COUNT (atomic)';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK D3 — DESCRIPTION too short. A 2-char description raises
-- INVALID_DISTINCTIVE_FEATURE (min is 3, measured trimmed).
-- -----------------------------------------------------------------------------
do $$
declare
  v_ok boolean := false;
begin
  perform set_config(
    'request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}',
    true);

  begin
    perform public.create_post(
      'DF03 SHT', 'Ford', 'Focus', 'Blue', 2019, null, null, null, null, null,
      null, null, now() - interval '1 day', 53.4808, -2.2426, 'Manchester',
      25000,
      array['http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/0.jpg',
            'http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/1.jpg',
            'http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/2.jpg'],
      null, null,
      jsonb_build_array(jsonb_build_object(
        'photo_url', 'http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/x.jpg',
        'description', ' ab ')));                                -- trims to 2 chars
  exception when others then
    if sqlerrm like '%INVALID_DISTINCTIVE_FEATURE%' then v_ok := true;
    else raise exception 'CHECK D3 FAILED: expected INVALID_DISTINCTIVE_FEATURE, got: %', sqlerrm; end if;
  end;

  if not v_ok then
    raise exception 'CHECK D3 FAILED: a too-short description did NOT raise INVALID_DISTINCTIVE_FEATURE';
  end if;
  raise notice 'CHECK D3 passed: too-short description raises INVALID_DISTINCTIVE_FEATURE';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK D4 — DESCRIPTION too long. An 81-char description raises
-- INVALID_DISTINCTIVE_FEATURE (max is 80).
-- -----------------------------------------------------------------------------
do $$
declare
  v_ok boolean := false;
begin
  perform set_config(
    'request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}',
    true);

  begin
    perform public.create_post(
      'DF04 LNG', 'Ford', 'Focus', 'Blue', 2019, null, null, null, null, null,
      null, null, now() - interval '1 day', 53.4808, -2.2426, 'Manchester',
      25000,
      array['http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/0.jpg',
            'http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/1.jpg',
            'http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/2.jpg'],
      null, null,
      jsonb_build_array(jsonb_build_object(
        'photo_url', 'http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/x.jpg',
        'description', repeat('a', 81))));                       -- 81 chars > 80
  exception when others then
    if sqlerrm like '%INVALID_DISTINCTIVE_FEATURE%' then v_ok := true;
    else raise exception 'CHECK D4 FAILED: expected INVALID_DISTINCTIVE_FEATURE, got: %', sqlerrm; end if;
  end;

  if not v_ok then
    raise exception 'CHECK D4 FAILED: an over-long description did NOT raise INVALID_DISTINCTIVE_FEATURE';
  end if;
  raise notice 'CHECK D4 passed: over-long description raises INVALID_DISTINCTIVE_FEATURE';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK D5 — PHOTO URL host. A distinctive feature whose photo_url is on a
-- foreign host (the spotter-tracking vector) raises INVALID_DISTINCTIVE_PHOTO_URL,
-- even though the description is valid.
-- -----------------------------------------------------------------------------
do $$
declare
  v_ok boolean := false;
begin
  perform set_config(
    'request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}',
    true);

  begin
    perform public.create_post(
      'DF05 URL', 'Ford', 'Focus', 'Blue', 2019, null, null, null, null, null,
      null, null, now() - interval '1 day', 53.4808, -2.2426, 'Manchester',
      25000,
      array['http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/0.jpg',
            'http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/1.jpg',
            'http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/2.jpg'],
      null, null,
      jsonb_build_array(jsonb_build_object(
        'photo_url', 'https://evil.example/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/x.jpg',
        'description', 'Cracked nearside wing mirror')));        -- valid desc, bad host
  exception when others then
    if sqlerrm like '%INVALID_DISTINCTIVE_PHOTO_URL%' then v_ok := true;
    else raise exception 'CHECK D5 FAILED: expected INVALID_DISTINCTIVE_PHOTO_URL, got: %', sqlerrm; end if;
  end;

  if not v_ok then
    raise exception 'CHECK D5 FAILED: a foreign-host feature photo did NOT raise INVALID_DISTINCTIVE_PHOTO_URL';
  end if;
  raise notice 'CHECK D5 passed: foreign-host feature photo raises INVALID_DISTINCTIVE_PHOTO_URL';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK D6 — OMITTED / EMPTY. Omitting p_distinctive_features entirely (relying
-- on the default) succeeds and inserts NO distinctive-feature rows. An explicit
-- empty array behaves identically. Proves the default keeps existing 20-arg
-- callers working and the write is a no-op when empty.
-- -----------------------------------------------------------------------------
do $$
declare
  v_doc     jsonb;
  v_post_id uuid;
  v_count   int;
begin
  perform set_config(
    'request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}',
    true);

  -- Positional 20-arg call (no p_distinctive_features) — resolves via the default.
  v_doc := public.create_post(
    'DF06 NONE', 'Ford', 'Focus', 'Blue', 2019, null, null, null, null, null,
    null, null, now() - interval '1 day', 53.4808, -2.2426, 'Manchester',
    25000,
    array['http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/0.jpg',
          'http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/1.jpg',
          'http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/2.jpg'],
    null, null);

  v_post_id := (v_doc ->> 'post_id')::uuid;
  if v_post_id is null then
    raise exception 'CHECK D6 FAILED: omitted-features create did not return a post_id: %', v_doc;
  end if;
  select count(*) into v_count
  from public.post_distinctive_feature where post_id = v_post_id;
  if v_count <> 0 then
    raise exception 'CHECK D6 FAILED: omitted features inserted % rows (expected 0)', v_count;
  end if;

  -- Explicit empty array — identical no-op.
  delete from public.posts where id = v_post_id;
  v_doc := public.create_post(
    'DF06 NONE', 'Ford', 'Focus', 'Blue', 2019, null, null, null, null, null,
    null, null, now() - interval '1 day', 53.4808, -2.2426, 'Manchester',
    25000,
    array['http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/0.jpg',
          'http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/1.jpg',
          'http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/2.jpg'],
    null, null, '[]'::jsonb);
  v_post_id := (v_doc ->> 'post_id')::uuid;
  select count(*) into v_count
  from public.post_distinctive_feature where post_id = v_post_id;
  if v_count <> 0 then
    raise exception 'CHECK D6 FAILED: empty-array features inserted % rows (expected 0)', v_count;
  end if;

  delete from public.posts where id = v_post_id;  -- self-clean
  raise notice 'CHECK D6 passed: omitted/empty distinctive features insert nothing and succeed';
end $$;

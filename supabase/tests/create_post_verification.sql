-- =============================================================================
-- create_post safety / validation verification (NOT a migration — do not place
-- in migrations/).
--
-- SELF-ASSERTING: every check is a DO block that RAISES EXCEPTION on failure, so
-- the whole file aborts non-zero the moment a property is violated. "The server
-- re-validates the wizard and only ever creates drafts" is a Tier 1 property
-- (docs/SECURITY_AND_TRUST.md §2/§6) — this file is meant to GATE CI, not to be
-- eyeballed. On success each block emits a NOTICE.
--
-- Run against a local DB seeded by supabase/seed.sql:
--     supabase db reset            # applies migrations + seed
--     psql -v ON_ERROR_STOP=1 "$DATABASE_URL" -f supabase/tests/create_post_verification.sql
--
-- (ON_ERROR_STOP=1 makes psql exit non-zero on the first RAISE.)
--
-- Fixtures used (from supabase/seed.sql):
--   ACTIVE post 'MA19 XKL' (a1a1a1a1-...0001) owned by 11111111-...  -> the
--     one-active-post-per-plate uniqueness trap.
--   Signed-in caller for creates: 22222222-2222-2222-2222-222222222222 (a
--     different seeded user, so it never collides with the trap's owner).
--
-- auth.uid() reads the request.jwt.claims GUC; the create-path blocks set it to
-- the caller's sub for the transaction. Assertions then read the tables directly
-- as postgres (bypassing RLS) to confirm what landed.
--
-- IDEMPOTENCY: the valid-create plate is deleted up-front so re-running without a
-- full `supabase db reset` stays deterministic (delete cascades to the post's
-- photos / feature tags / verification-doc rows).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Clean up any leftover draft from a previous run of this file (canon 'LT70ABC').
-- -----------------------------------------------------------------------------
delete from public.posts
where upper(regexp_replace(coalesce(plate, ''), '[^A-Za-z0-9]', '', 'g')) = 'LT70ABC';


-- -----------------------------------------------------------------------------
-- CHECK 1 — a VALID create_post returns { post_id, status:'draft' }, inserts the
-- post as a draft with the descriptive columns set (year/body_type/stolen_from/
-- keys_taken/desc_*), the right number of photos in position order, the right
-- number of feature tags, and a verification-document row. Also asserts status
-- is 'draft' (NEVER active) — the core lifecycle property.
-- -----------------------------------------------------------------------------
do $$
declare
  v_doc     jsonb;
  v_post_id uuid;
  v_post    public.posts%rowtype;
  v_photos  int;
  v_p0      int; v_p1 int; v_p2 int; v_p3 int;
  v_feats   int;
  v_docs    int;
begin
  perform set_config(
    'request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}',
    true);  -- is_local: reset at end of this DO block's transaction

  v_doc := public.create_post(
    p_plate                   => 'lt70 abc',           -- lower-case on purpose: server normalises
    p_make                    => 'Skoda',
    p_model                   => 'Octavia',
    p_colour                  => 'Green',
    p_year                    => 2020,
    p_body_type               => 'Estate',
    p_distinguishing_features => 'Roof bars and a dent on the tailgate.',
    p_owner_note              => 'Taken overnight; please keep an eye out.',
    p_desc_recognise          => 'Green Octavia estate with roof bars.',
    p_desc_drives             => 'Slight rattle from the boot over bumps.',
    p_stolen_from             => 'driveway',
    p_keys_taken              => 'yes',
    p_last_seen_at            => now() - interval '1 day',
    p_last_seen_lat           => 53.4808,
    p_last_seen_lng           => -2.2426,
    p_last_seen_area          => 'Manchester',
    p_bounty_amount_pence     => 25000,
    -- Photo URLs must be our own-folder post-photos objects (20260713192000).
    p_photo_urls              => array[
                                   'http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/0.jpg',
                                   'http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/1.jpg',
                                   'http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/2.jpg',
                                   'http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/3.jpg'],
    p_feature_keys            => array['roof_rack', 'dashcam'],
    p_verification_path       => '22222222-2222-2222-2222-222222222222/lt70/v5c.pdf'
  );

  -- Return shape.
  if (v_doc ->> 'status') is distinct from 'draft' then
    raise exception 'CHECK 1 FAILED: return status should be draft, got %', v_doc;
  end if;
  v_post_id := (v_doc ->> 'post_id')::uuid;
  if v_post_id is null then
    raise exception 'CHECK 1 FAILED: no post_id returned: %', v_doc;
  end if;

  select * into v_post from public.posts where id = v_post_id;

  -- Lifecycle + ownership + server-owned columns.
  if v_post.status <> 'draft' then
    raise exception 'CHECK 1 FAILED: persisted status should be draft, got %', v_post.status;
  end if;
  if v_post.owner_id <> '22222222-2222-2222-2222-222222222222' then
    raise exception 'CHECK 1 FAILED: owner_id not pinned to caller, got %', v_post.owner_id;
  end if;
  if v_post.expires_at is null or v_post.expires_at <= now() then
    raise exception 'CHECK 1 FAILED: expires_at should be ~90d in the future, got %', v_post.expires_at;
  end if;
  -- Plate normalised to upper-case.
  if v_post.plate <> 'LT70 ABC' then
    raise exception 'CHECK 1 FAILED: plate not normalised to upper, got %', v_post.plate;
  end if;
  -- Descriptive / structured columns (only writable via this SECURITY DEFINER path).
  if v_post.year <> 2020 or v_post.body_type <> 'Estate'
     or v_post.stolen_from <> 'driveway' or v_post.keys_taken <> 'yes'
     or v_post.desc_recognise is null or v_post.desc_drives is null
     or v_post.distinguishing_features is null or v_post.owner_note is null then
    raise exception 'CHECK 1 FAILED: descriptive columns not set: %', to_jsonb(v_post);
  end if;
  -- Location captured as a geography point (not null).
  if v_post.last_seen_location is null then
    raise exception 'CHECK 1 FAILED: last_seen_location not set';
  end if;

  -- Photos: 4 rows in position order 0,1,2,3.
  select count(*) into v_photos from public.post_photos where post_id = v_post_id;
  if v_photos <> 4 then
    raise exception 'CHECK 1 FAILED: expected 4 photos, got %', v_photos;
  end if;
  select
    (select position from public.post_photos where post_id = v_post_id and url like '%/0.jpg'),
    (select position from public.post_photos where post_id = v_post_id and url like '%/1.jpg'),
    (select position from public.post_photos where post_id = v_post_id and url like '%/2.jpg'),
    (select position from public.post_photos where post_id = v_post_id and url like '%/3.jpg')
    into v_p0, v_p1, v_p2, v_p3;
  if v_p0 <> 0 or v_p1 <> 1 or v_p2 <> 2 or v_p3 <> 3 then
    raise exception 'CHECK 1 FAILED: photo positions not 0..3 in order: % % % %', v_p0, v_p1, v_p2, v_p3;
  end if;

  -- Feature tags: 2 rows.
  select count(*) into v_feats from public.post_feature where post_id = v_post_id;
  if v_feats <> 2 then
    raise exception 'CHECK 1 FAILED: expected 2 feature tags, got %', v_feats;
  end if;

  -- Verification-document row: exactly 1, with the path we passed.
  select count(*) into v_docs from public.verification_documents where post_id = v_post_id;
  if v_docs <> 1 then
    raise exception 'CHECK 1 FAILED: expected 1 verification_documents row, got %', v_docs;
  end if;

  raise notice 'CHECK 1 passed: valid create_post -> draft with photos/features/verification row';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 2 — PLATE UNIQUENESS. Creating a post for a plate that already has an
-- ACTIVE seeded post ('MA19 XKL', owned by 11111111) raises PLATE_IN_USE, even
-- for a DIFFERENT signed-in caller. (SECURITY_AND_TRUST §2: one active post per
-- plate.)
-- -----------------------------------------------------------------------------
do $$
declare
  v_ok boolean := false;
begin
  perform set_config(
    'request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}',
    true);  -- NOT the owner of MA19 XKL
  begin
    perform public.create_post(
      'MA19 XKL', 'Ford', 'Fiesta', 'Blue', 2019, 'Hatchback', null, null,
      null, null, 'street', 'no',
      now() - interval '1 day', 53.4808, -2.2426, 'Manchester',
      25000,
      array['https://example.test/dup/0.jpg',
            'https://example.test/dup/1.jpg',
            'https://example.test/dup/2.jpg'],
      null, null);
  exception when others then
    if sqlerrm like '%PLATE_IN_USE%' then
      v_ok := true;
    else
      raise exception 'CHECK 2 FAILED: expected PLATE_IN_USE, got: %', sqlerrm;
    end if;
  end;
  if not v_ok then
    raise exception 'CHECK 2 FAILED: duplicate active plate did NOT raise PLATE_IN_USE';
  end if;
  raise notice 'CHECK 2 passed: active-plate reuse raises PLATE_IN_USE';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 3 — MONEY. A bounty of 4999 pence (below £50) and 500001 pence (above
-- £5000) both raise BOUNTY_OUT_OF_RANGE.
-- -----------------------------------------------------------------------------
do $$
declare
  v_lo boolean := false;
  v_hi boolean := false;
begin
  perform set_config(
    'request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}',
    true);

  begin
    perform public.create_post(
      'BN49 LOW', 'Ford', 'Ka', 'Silver', 2018, null, null, null, null, null,
      null, null, now() - interval '1 day', 53.4808, -2.2426, 'Manchester',
      4999,
      array['https://example.test/lo/0.jpg',
            'https://example.test/lo/1.jpg',
            'https://example.test/lo/2.jpg'],
      null, null);
  exception when others then
    if sqlerrm like '%BOUNTY_OUT_OF_RANGE%' then v_lo := true;
    else raise exception 'CHECK 3 FAILED (low): expected BOUNTY_OUT_OF_RANGE, got: %', sqlerrm; end if;
  end;

  begin
    perform public.create_post(
      'BN50 HGH', 'Ford', 'Ka', 'Silver', 2018, null, null, null, null, null,
      null, null, now() - interval '1 day', 53.4808, -2.2426, 'Manchester',
      500001,
      array['https://example.test/hi/0.jpg',
            'https://example.test/hi/1.jpg',
            'https://example.test/hi/2.jpg'],
      null, null);
  exception when others then
    if sqlerrm like '%BOUNTY_OUT_OF_RANGE%' then v_hi := true;
    else raise exception 'CHECK 3 FAILED (high): expected BOUNTY_OUT_OF_RANGE, got: %', sqlerrm; end if;
  end;

  if not (v_lo and v_hi) then
    raise exception 'CHECK 3 FAILED: out-of-range bounties did not both raise (lo=%, hi=%)', v_lo, v_hi;
  end if;
  raise notice 'CHECK 3 passed: bounty 4999 and 500001 both raise BOUNTY_OUT_OF_RANGE';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 4 — PHOTO COUNT. 2 photos (below the min of 3) raises PHOTO_COUNT.
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
      'PH02 TWO', 'Ford', 'Focus', 'Blue', 2019, null, null, null, null, null,
      null, null, now() - interval '1 day', 53.4808, -2.2426, 'Manchester',
      25000,
      array['https://example.test/two/0.jpg',
            'https://example.test/two/1.jpg'],
      null, null);
  exception when others then
    if sqlerrm like '%PHOTO_COUNT%' then v_ok := true;
    else raise exception 'CHECK 4 FAILED: expected PHOTO_COUNT, got: %', sqlerrm; end if;
  end;
  if not v_ok then
    raise exception 'CHECK 4 FAILED: 2 photos did NOT raise PHOTO_COUNT';
  end if;
  raise notice 'CHECK 4 passed: 2 photos raises PHOTO_COUNT';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 5 — INVALID PLATE. An empty plate and a garbage (symbols-only) plate
-- both raise INVALID_PLATE.
-- -----------------------------------------------------------------------------
do $$
declare
  v_empty   boolean := false;
  v_garbage boolean := false;
begin
  perform set_config(
    'request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}',
    true);

  -- A plate WITH alphanumerics but the wrong length is malformed → INVALID_PLATE.
  -- (Empty / symbols-only canon to '' and are treated as plate-less — see CHECK
  -- 10 — so they are NOT INVALID_PLATE any more; a non-empty bad canon still is.)
  begin
    perform public.create_post(
      'A', 'Ford', 'Focus', 'Blue', 2019, null, null, null, null, null,  -- 1 char, too short
      null, null, now() - interval '1 day', 53.4808, -2.2426, 'Manchester',
      25000,
      array['https://example.test/e/0.jpg',
            'https://example.test/e/1.jpg',
            'https://example.test/e/2.jpg'],
      null, null);
  exception when others then
    if sqlerrm like '%INVALID_PLATE%' then v_empty := true;
    else raise exception 'CHECK 5 FAILED (too short): expected INVALID_PLATE, got: %', sqlerrm; end if;
  end;

  begin
    perform public.create_post(
      'ABCD12345', 'Ford', 'Focus', 'Blue', 2019, null, null, null, null, null,  -- 9 chars, too long
      null, null, now() - interval '1 day', 53.4808, -2.2426, 'Manchester',
      25000,
      array['https://example.test/g/0.jpg',
            'https://example.test/g/1.jpg',
            'https://example.test/g/2.jpg'],
      null, null);
  exception when others then
    if sqlerrm like '%INVALID_PLATE%' then v_garbage := true;
    else raise exception 'CHECK 5 FAILED (too long): expected INVALID_PLATE, got: %', sqlerrm; end if;
  end;

  if not (v_empty and v_garbage) then
    raise exception 'CHECK 5 FAILED: malformed plates did not both raise (short=%, long=%)', v_empty, v_garbage;
  end if;
  raise notice 'CHECK 5 passed: malformed (wrong-length) plates raise INVALID_PLATE';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 7 — SAFETY (20260713192000). A photo URL that is NOT our own-folder
-- post-photos object (here: a foreign host — the spotter-tracking vector) raises
-- INVALID_PHOTO_URL, even when everything else is valid.
-- -----------------------------------------------------------------------------
do $$
declare
  v_raised text := null;
begin
  perform set_config(
    'request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}',
    true);

  begin
    perform public.create_post(
      'PU71 XYZ', 'Ford', 'Focus', 'Silver', 2018, null, null, null, null, null,
      null, null, now() - interval '1 day', 53.4808, -2.2426, 'Manchester',
      20000,
      -- Photos 0 and 1 are valid own-folder objects; photo 2 is attacker-hosted.
      array['http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/0.jpg',
            'http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/1.jpg',
            'https://evil.example/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/2.jpg'],
      null, null);
  exception when others then
    v_raised := sqlerrm;
    if sqlerrm <> 'INVALID_PHOTO_URL' then
      raise exception 'CHECK 7 FAILED: expected INVALID_PHOTO_URL, got: %', sqlerrm;
    end if;
  end;
  if v_raised is null then
    raise exception 'CHECK 7 FAILED: a foreign-host photo URL did NOT raise INVALID_PHOTO_URL';
  end if;
  raise notice 'CHECK 7 passed: a non-own-folder photo URL raises INVALID_PHOTO_URL';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 8 — SAFETY (20260713192000). A V5C path whose first segment is ANOTHER
-- user's folder raises INVALID_VERIFICATION_PATH (a post's proof-of-ownership
-- row must not point at someone else's document namespace).
-- -----------------------------------------------------------------------------
do $$
declare
  v_raised text := null;
begin
  perform set_config(
    'request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}',
    true);

  begin
    perform public.create_post(
      'PV71 ABC', 'Ford', 'Focus', 'Silver', 2018, null, null, null, null, null,
      null, null, now() - interval '1 day', 53.4808, -2.2426, 'Manchester',
      20000,
      array['http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/0.jpg',
            'http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/1.jpg',
            'http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/2.jpg'],
      null,
      -- Path under a DIFFERENT user's folder (11111111-…, the seed's other user).
      '11111111-1111-1111-1111-111111111111/pv71/v5c.pdf');
  exception when others then
    v_raised := sqlerrm;
    if sqlerrm <> 'INVALID_VERIFICATION_PATH' then
      raise exception 'CHECK 8 FAILED: expected INVALID_VERIFICATION_PATH, got: %', sqlerrm;
    end if;
  end;
  if v_raised is null then
    raise exception 'CHECK 8 FAILED: a foreign-folder V5C path did NOT raise INVALID_VERIFICATION_PATH';
  end if;
  raise notice 'CHECK 8 passed: a foreign-folder V5C path raises INVALID_VERIFICATION_PATH';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 9 — OPTIONAL PLATE. A create with NO plate succeeds and stores plate
-- NULL; make/model/colour (the identity) are still required and stored.
-- -----------------------------------------------------------------------------
do $$
declare
  v_doc     jsonb;
  v_post_id uuid;
  v_post    public.posts%rowtype;
begin
  perform set_config(
    'request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}',
    true);

  v_doc := public.create_post(
    null,                                        -- no plate
    'Plateless', 'Runabout', 'Silver', 2015, null, null, null, null, null,
    null, null, now() - interval '1 day', 53.4808, -2.2426, 'Manchester',
    15000,
    array['http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/0.jpg',
          'http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/1.jpg',
          'http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/2.jpg'],
    null, null);

  v_post_id := (v_doc ->> 'post_id')::uuid;
  select * into v_post from public.posts where id = v_post_id;
  if v_post.plate is not null then
    raise exception 'CHECK 9 FAILED: plate-less post stored a non-null plate: %', v_post.plate;
  end if;
  if v_post.make <> 'Plateless' or v_post.model <> 'Runabout' or v_post.colour <> 'Silver' then
    raise exception 'CHECK 9 FAILED: identity (make/model/colour) not stored';
  end if;
  if v_post.status <> 'draft' then
    raise exception 'CHECK 9 FAILED: plate-less post not a draft: %', v_post.status;
  end if;

  delete from public.posts where id = v_post_id;  -- self-clean (NULL plate, canon '')
  raise notice 'CHECK 9 passed: a plate-less create succeeds with NULL plate';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 10 — a BLANK plate (whitespace) is treated as plate-less (stored NULL),
-- NOT rejected as INVALID_PLATE. Also proves make/model/colour stay required for
-- a plate-less post (MISSING_REQUIRED when make is null).
-- -----------------------------------------------------------------------------
do $$
declare
  v_doc      jsonb;
  v_post_id  uuid;
  v_plate    text;
  v_missing  boolean := false;
begin
  perform set_config(
    'request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}',
    true);

  -- Blank plate → plate-less (NULL), not INVALID_PLATE.
  v_doc := public.create_post(
    '   ',                                        -- whitespace-only plate
    'Blankish', 'Runabout', 'Grey', null, null, null, null, null, null,
    null, null, now() - interval '1 day', 53.4808, -2.2426, 'Manchester',
    15000,
    array['http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/0.jpg',
          'http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/1.jpg',
          'http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/2.jpg'],
    null, null);
  v_post_id := (v_doc ->> 'post_id')::uuid;
  select plate into v_plate from public.posts where id = v_post_id;
  if v_plate is not null then
    raise exception 'CHECK 10 FAILED: blank plate not stored as NULL: %', v_plate;
  end if;
  delete from public.posts where id = v_post_id;

  -- A punctuation-only plate canonicalises to '' → stored NULL (not a fake
  -- "--" plate that skipped the format/uniqueness gates). Regression guard for
  -- 20260713195000.
  v_doc := public.create_post(
    '--',                                        -- punctuation-only "plate"
    'Punct', 'Runabout', 'Grey', null, null, null, null, null, null,
    null, null, now() - interval '1 day', 53.4808, -2.2426, 'Manchester',
    15000,
    array['http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/0.jpg',
          'http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/1.jpg',
          'http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/2.jpg'],
    null, null);
  v_post_id := (v_doc ->> 'post_id')::uuid;
  select plate into v_plate from public.posts where id = v_post_id;
  if v_plate is not null then
    raise exception 'CHECK 10 FAILED: punctuation-only plate not stored as NULL: %', v_plate;
  end if;
  delete from public.posts where id = v_post_id;

  -- Plate-less but missing make → still MISSING_REQUIRED (identity is required).
  begin
    perform public.create_post(
      null,
      null, 'Runabout', 'Grey', null, null, null, null, null, null,  -- make is null
      null, null, now() - interval '1 day', 53.4808, -2.2426, 'Manchester',
      15000,
      array['http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/0.jpg',
            'http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/1.jpg',
            'http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/2.jpg'],
      null, null);
  exception when others then
    if sqlerrm like '%MISSING_REQUIRED%' then v_missing := true;
    else raise exception 'CHECK 10 FAILED: expected MISSING_REQUIRED, got: %', sqlerrm; end if;
  end;
  if not v_missing then
    raise exception 'CHECK 10 FAILED: a plate-less post with no make did NOT raise MISSING_REQUIRED';
  end if;

  raise notice 'CHECK 10 passed: blank/punctuation plate → NULL (not INVALID_PLATE); identity still required';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 11 — posts.plate is length-bounded (20260713196000). A padded input
-- whose alphanumeric canon passes the 2–8 format gate but whose RAW string is
-- absurdly long is rejected by the posts_plate_len_chk column CHECK — it can't
-- be stored as a giant junk "plate".
-- -----------------------------------------------------------------------------
do $$
declare
  v_raised boolean := false;
begin
  perform set_config(
    'request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}',
    true);

  begin
    perform public.create_post(
      'AB' || repeat('-', 200),                    -- canon 'AB' passes {2,8}; 202 chars raw
      'Padded', 'Runabout', 'Grey', null, null, null, null, null, null,
      null, null, now() - interval '1 day', 53.4808, -2.2426, 'Manchester',
      15000,
      array['http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/0.jpg',
            'http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/1.jpg',
            'http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/2.jpg'],
      null, null);
  exception when others then
    v_raised := true;  -- the length CHECK (or any gate) rejected it → rolled back
  end;
  if not v_raised then
    raise exception 'CHECK 11 FAILED: an over-long padded plate was accepted (length bound missing)';
  end if;
  raise notice 'CHECK 11 passed: an over-long padded plate is rejected (length-bounded)';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 6 — status is ALWAYS 'draft', never a client-supplied later status.
-- There is no status parameter, so this re-confirms via the returned + persisted
-- value on a fresh valid create with a distinct plate.
-- -----------------------------------------------------------------------------
do $$
declare
  v_doc     jsonb;
  v_status  public.post_status;
begin
  perform set_config(
    'request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}',
    true);

  v_doc := public.create_post(
    'DR01 AFT', 'Toyota', 'Yaris', 'Red', 2021, null, null, null, null, null,
    null, null, now() - interval '2 days', 53.4808, -2.2426, 'Manchester',
    30000,
    array['http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/dr0.jpg',
          'http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/dr1.jpg',
          'http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/dr2.jpg'],
    null, null);

  if (v_doc ->> 'status') <> 'draft' then
    raise exception 'CHECK 6 FAILED: returned status not draft: %', v_doc;
  end if;
  select status into v_status from public.posts where id = (v_doc ->> 'post_id')::uuid;
  if v_status <> 'draft' then
    raise exception 'CHECK 6 FAILED: persisted status not draft: %', v_status;
  end if;

  -- Housekeeping: remove the two extra drafts this file created beyond CHECK 1
  -- so the seed's post set stays as-is for other test files.
  delete from public.posts
  where upper(regexp_replace(coalesce(plate, ''), '[^A-Za-z0-9]', '', 'g')) in ('DR01AFT', 'LT70ABC');

  raise notice 'CHECK 6 passed: create_post only ever yields status=draft';
end $$;

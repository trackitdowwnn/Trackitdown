-- =============================================================================
-- edit_post_sections safety / validation verification (NOT a migration — do not
-- place in migrations/).
--
-- SELF-ASSERTING: every check is a DO block that RAISES EXCEPTION on failure, so
-- the whole file aborts non-zero the moment a property is violated. "Each
-- per-section RPC edits ONLY its section, is gated by owner + the section's status
-- gate, and the three SAFE sections (theft_context, distinctive_features,
-- description) are the ONLY ones allowed on a PAID post — pending_verification or
-- ACTIVE (live) — while NEVER touching
-- bounty/status/owner/expires" is a Tier 1 property (docs/SECURITY_AND_TRUST.md
-- §2/§6) — this file is meant to GATE CI, not to be eyeballed. On success each
-- block emits a NOTICE.
--
-- Run against a local DB seeded by supabase/seed.sql:
--     supabase db reset            # applies migrations + seed
--     psql -v ON_ERROR_STOP=1 "$DATABASE_URL" -f supabase/tests/edit_post_sections_verification.sql
--
-- (ON_ERROR_STOP=1 makes psql exit non-zero on the first RAISE.)
--
-- ISOLATION: each block seeds its OWN post(s) via create_post (which forces
-- status=draft), forces pending_verification directly as postgres where needed,
-- and deletes the rows it created at the end (delete cascades to the post's
-- photos / feature tags / distinctive features / verification-doc rows).
--
-- Callers: two seeded users — owner 22222222-2222-2222-2222-222222222222 and a
-- DIFFERENT user 11111111-1111-1111-1111-111111111111 (the non-owner). auth.uid()
-- reads the request.jwt.claims GUC; each block sets it to the acting caller.
-- Assertions read the tables directly as postgres (bypassing RLS) to confirm what
-- landed.
--
-- Canons used below (cleaned up first for deterministic re-runs):
--   EP70CAR, EP70PHO, EP70LST, EP70BTY, EP70V5C, EP70THF, EP70DFT (draft cases),
--   EP70PND (pending_verification case), EP70LIV (active/live case),
--   EP70NON (non-owner case), EP70VAL (validation-parity case).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Clean up any leftover posts from a previous run.
-- -----------------------------------------------------------------------------
delete from public.posts
where upper(regexp_replace(coalesce(plate, ''), '[^A-Za-z0-9]', '', 'g'))
      in ('EP70CAR', 'EP70PHO', 'EP70LST', 'EP70BTY', 'EP70V5C', 'EP70THF',
          'EP70DFT', 'EP70PND', 'EP70LIV', 'EP70NON', 'EP70VAL');


-- -----------------------------------------------------------------------------
-- Reusable seed helper is inlined per block (no functions created). Every seed
-- uses 3 own-folder photos, 2 distinctive features, and a V5C so replace/keep can
-- be asserted. The seed's plate canon is passed per block.
-- -----------------------------------------------------------------------------


-- -----------------------------------------------------------------------------
-- CHECK 1 — each of the 8 functions SUCCEEDS on an own DRAFT and writes ONLY its
-- own section, leaving the others untouched. One draft is seeded and edited by all
-- seven in turn; after each call we assert its target changed AND a witness field
-- owned by a different section did not.
-- -----------------------------------------------------------------------------
do $$
declare
  v_doc     jsonb;
  v_post_id uuid;
  v_post    public.posts%rowtype;
  v_n       int;
begin
  perform set_config(
    'request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}',
    true);

  v_doc := public.create_post(
    'EP70 CAR', 'Skoda', 'Octavia', 'Green', 2020, 'Estate', 'Roof bars.',
    'Original note.', 'Green Octavia.', 'Rattle over bumps.', 'driveway', 'yes',
    now() - interval '1 day', 53.4808, -2.2426, 'Manchester', 25000,
    array['http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/0.jpg',
          'http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/1.jpg',
          'http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/2.jpg'],
    null,
    '22222222-2222-2222-2222-222222222222/ep70/v5c.pdf',
    jsonb_build_array(
      jsonb_build_object('photo_url', 'http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/df0.jpg', 'description', 'Cracked nearside mirror'),
      jsonb_build_object('photo_url', 'http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/df1.jpg', 'description', 'Dented tailgate')));
  v_post_id := (v_doc ->> 'post_id')::uuid;

  -- (a) car_details.
  perform public.update_post_car_details(v_post_id, 'Volvo', 'V60', 'Blue', 'New note.', 2022, 'Wagon');
  select * into v_post from public.posts where id = v_post_id;
  if v_post.make <> 'Volvo' or v_post.model <> 'V60' or v_post.colour <> 'Blue'
     or v_post.owner_note <> 'New note.' or v_post.year <> 2022 or v_post.body_type <> 'Wagon' then
    raise exception 'CHECK 1a FAILED: car_details not written: %', to_jsonb(v_post);
  end if;
  if v_post.bounty_amount_pence <> 25000 or v_post.stolen_from <> 'driveway' then
    raise exception 'CHECK 1a FAILED: car_details touched a foreign section';
  end if;

  -- (b) photos: 3 -> 2.
  perform public.update_post_photos(v_post_id, array[
    'http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/x.jpg',
    'http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/y.jpg',
    'http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/z.jpg']);
  select count(*) into v_n from public.post_photos where post_id = v_post_id;
  if v_n <> 3 then raise exception 'CHECK 1b FAILED: expected 3 photos, got %', v_n; end if;
  if not exists (select 1 from public.post_photos where post_id = v_post_id and url like '%/x.jpg' and position = 0) then
    raise exception 'CHECK 1b FAILED: photo positions not reindexed from 0';
  end if;

  -- (c) last_seen.
  perform public.update_post_last_seen(v_post_id, now() - interval '3 hours', 51.5074, -0.1278, 'London');
  select * into v_post from public.posts where id = v_post_id;
  if v_post.last_seen_area <> 'London' or v_post.last_seen_location is null then
    raise exception 'CHECK 1c FAILED: last_seen not written';
  end if;
  if v_post.make <> 'Volvo' then raise exception 'CHECK 1c FAILED: last_seen touched car_details'; end if;

  -- (d) bounty.
  perform public.update_post_bounty(v_post_id, 40000);
  select bounty_amount_pence into v_n from public.posts where id = v_post_id;
  if v_n <> 40000 then raise exception 'CHECK 1d FAILED: bounty not written, got %', v_n; end if;

  -- (e) verification: replace the V5C path.
  perform public.update_post_verification(v_post_id, '22222222-2222-2222-2222-222222222222/ep70/new-v5c.pdf');
  select count(*) into v_n from public.verification_documents where post_id = v_post_id;
  if v_n <> 1 then raise exception 'CHECK 1e FAILED: expected 1 V5C row, got %', v_n; end if;
  if not exists (select 1 from public.verification_documents where post_id = v_post_id and storage_path like '%/new-v5c.pdf') then
    raise exception 'CHECK 1e FAILED: V5C path not replaced';
  end if;

  -- (f) theft_context.
  perform public.update_post_theft_context(v_post_id, 'street', 'no', 'Pulls left.');
  select * into v_post from public.posts where id = v_post_id;
  if v_post.stolen_from <> 'street' or v_post.keys_taken <> 'no' or v_post.desc_drives <> 'Pulls left.' then
    raise exception 'CHECK 1f FAILED: theft_context not written';
  end if;

  -- (g) distinctive_features: 2 -> 1.
  perform public.update_post_distinctive_features(v_post_id, jsonb_build_array(
    jsonb_build_object('photo_url', 'http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/df9.jpg', 'description', 'Only remaining mark')));
  select count(*) into v_n from public.post_distinctive_feature where post_id = v_post_id;
  if v_n <> 1 then raise exception 'CHECK 1g FAILED: expected 1 distinctive feature, got %', v_n; end if;

  -- (h) description.
  perform public.update_post_description(v_post_id, 'Look for the dog guard in the boot.');
  select * into v_post from public.posts where id = v_post_id;
  if v_post.desc_recognise <> 'Look for the dog guard in the boot.' then
    raise exception 'CHECK 1h FAILED: description not written';
  end if;

  -- Whole-post invariants after all eight edits: still an own draft.
  select * into v_post from public.posts where id = v_post_id;
  if v_post.status <> 'draft' or v_post.owner_id <> '22222222-2222-2222-2222-222222222222' then
    raise exception 'CHECK 1 FAILED: status/owner drifted: %', to_jsonb(v_post);
  end if;

  delete from public.posts where id = v_post_id;  -- self-clean
  raise notice 'CHECK 1 passed: all 8 section RPCs succeed on a draft and write only their own section';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 2 — STATUS GATES on a PENDING_VERIFICATION post. The 4 draft-only fns
-- (photos, last_seen, bounty, verification) must raise POST_NOT_EDITABLE;
-- car_details + the 3 safe prose fns must SUCCEED.
-- -----------------------------------------------------------------------------
do $$
declare
  v_doc     jsonb;
  v_post_id uuid;
  v_post    public.posts%rowtype;
  v_n       int;
  v_ok      boolean;
begin
  perform set_config(
    'request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}',
    true);

  v_doc := public.create_post(
    'EP70 PND', 'Ford', 'Focus', 'Blue', 2019, null, null, null, null, null,
    'driveway', 'yes', now() - interval '1 day', 53.4808, -2.2426, 'Manchester', 25000,
    array['http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/0.jpg',
          'http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/1.jpg',
          'http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/2.jpg'],
    null, null,
    jsonb_build_array(
      jsonb_build_object('photo_url', 'http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/df0.jpg', 'description', 'Mark one'),
      jsonb_build_object('photo_url', 'http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/df1.jpg', 'description', 'Mark two')));
  v_post_id := (v_doc ->> 'post_id')::uuid;

  -- Advance to a PAID state (service-role style; RLS bypassed as postgres).
  update public.posts set status = 'pending_verification' where id = v_post_id;

  -- The 4 draft-only fns must all raise POST_NOT_EDITABLE.
  v_ok := false;
  begin perform public.update_post_photos(v_post_id, array[
    'http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/0.jpg',
    'http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/1.jpg',
    'http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/2.jpg']);
  exception when others then if sqlerrm like '%POST_NOT_EDITABLE%' then v_ok := true;
    else raise exception 'CHECK 2 FAILED (photos): got %', sqlerrm; end if; end;
  if not v_ok then raise exception 'CHECK 2 FAILED: photos ran on pending_verification'; end if;

  v_ok := false;
  begin perform public.update_post_last_seen(v_post_id, now(), 51.5, -0.1, 'London');
  exception when others then if sqlerrm like '%POST_NOT_EDITABLE%' then v_ok := true;
    else raise exception 'CHECK 2 FAILED (last_seen): got %', sqlerrm; end if; end;
  if not v_ok then raise exception 'CHECK 2 FAILED: last_seen ran on pending_verification'; end if;

  v_ok := false;
  begin perform public.update_post_bounty(v_post_id, 40000);
  exception when others then if sqlerrm like '%POST_NOT_EDITABLE%' then v_ok := true;
    else raise exception 'CHECK 2 FAILED (bounty): got %', sqlerrm; end if; end;
  if not v_ok then raise exception 'CHECK 2 FAILED: bounty ran on pending_verification (ESCROW AT RISK)'; end if;

  v_ok := false;
  begin perform public.update_post_verification(v_post_id, '22222222-2222-2222-2222-222222222222/ep70/x.pdf');
  exception when others then if sqlerrm like '%POST_NOT_EDITABLE%' then v_ok := true;
    else raise exception 'CHECK 2 FAILED (verification): got %', sqlerrm; end if; end;
  if not v_ok then raise exception 'CHECK 2 FAILED: verification ran on pending_verification'; end if;

  -- car_details is money-neutral and now allowed on a paid post (20260731110000).
  perform public.update_post_car_details(v_post_id, 'Ford', 'Focus', 'Red', null, null, null);
  select * into v_post from public.posts where id = v_post_id;
  if v_post.colour <> 'Red' then
    raise exception 'CHECK 2 FAILED: car_details did not apply on pending_verification';
  end if;
  if v_post.bounty_amount_pence <> 25000 or v_post.status <> 'pending_verification'
     or v_post.owner_id <> '22222222-2222-2222-2222-222222222222' then
    raise exception 'CHECK 2 FAILED: car_details touched money/status/owner on a paid post';
  end if;

  -- The SAFE prose fns must SUCCEED on pending_verification.
  perform public.update_post_theft_context(v_post_id, 'car_park', 'unknown', 'Clunk over bumps.');
  select * into v_post from public.posts where id = v_post_id;
  if v_post.stolen_from <> 'car_park' or v_post.keys_taken <> 'unknown' or v_post.desc_drives <> 'Clunk over bumps.' then
    raise exception 'CHECK 2 FAILED: theft_context did not apply on pending_verification';
  end if;
  -- ...and it must NOT have touched money/status/owner.
  if v_post.bounty_amount_pence <> 25000 or v_post.status <> 'pending_verification'
     or v_post.owner_id <> '22222222-2222-2222-2222-222222222222' then
    raise exception 'CHECK 2 FAILED: theft_context touched money/status/owner on a paid post';
  end if;

  perform public.update_post_distinctive_features(v_post_id, jsonb_build_array(
    jsonb_build_object('photo_url', 'http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/df9.jpg', 'description', 'Single mark now')));
  select count(*) into v_n from public.post_distinctive_feature where post_id = v_post_id;
  if v_n <> 1 then raise exception 'CHECK 2 FAILED: distinctive_features did not apply on pending_verification, got %', v_n; end if;
  select * into v_post from public.posts where id = v_post_id;
  if v_post.bounty_amount_pence <> 25000 or v_post.status <> 'pending_verification' then
    raise exception 'CHECK 2 FAILED: distinctive_features touched money/status on a paid post';
  end if;

  perform public.update_post_description(v_post_id, 'Recognisable by the roof box.');
  select * into v_post from public.posts where id = v_post_id;
  if v_post.desc_recognise <> 'Recognisable by the roof box.' then
    raise exception 'CHECK 2 FAILED: description did not apply on pending_verification';
  end if;
  if v_post.bounty_amount_pence <> 25000 or v_post.status <> 'pending_verification'
     or v_post.owner_id <> '22222222-2222-2222-2222-222222222222' then
    raise exception 'CHECK 2 FAILED: description touched money/status/owner on a paid post';
  end if;

  delete from public.posts where id = v_post_id;  -- self-clean
  raise notice 'CHECK 2 passed: 4 draft-only fns blocked on pending_verification; car_details + 3 safe fns succeed without touching money/status/owner';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 2b — STATUS GATES on an ACTIVE (LIVE) post. This is the state a paid post
-- actually lands in under live-on-payment (20260730100000), so it is the gate that
-- matters in production. Same contract as CHECK 2: the 4 draft-only fns must raise
-- POST_NOT_EDITABLE (photos, last-seen and the escrowed bounty do not move under a
-- live listing), while car_details and the 3 SAFE prose fns must SUCCEED without
-- touching bounty/status/owner — and the PLATE must survive untouched, since no
-- RPC writes it (20260731100000_edit_safe_sections_when_live.sql,
-- 20260731110000_edit_car_details_when_live.sql).
-- -----------------------------------------------------------------------------
do $$
declare
  v_doc     jsonb;
  v_post_id uuid;
  v_post    public.posts%rowtype;
  v_n       int;
  v_ok      boolean;
begin
  perform set_config(
    'request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}',
    true);

  v_doc := public.create_post(
    'EP70 LIV', 'Ford', 'Focus', 'Blue', 2019, null, null, null, null, null,
    'driveway', 'yes', now() - interval '1 day', 53.4808, -2.2426, 'Manchester', 25000,
    array['http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/0.jpg',
          'http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/1.jpg',
          'http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/2.jpg'],
    null, null,
    jsonb_build_array(
      jsonb_build_object('photo_url', 'http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/df0.jpg', 'description', 'Mark one'),
      jsonb_build_object('photo_url', 'http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/df1.jpg', 'description', 'Mark two')));
  v_post_id := (v_doc ->> 'post_id')::uuid;

  -- Advance to LIVE, exactly as mark_post_payment_held does on payment success.
  update public.posts set status = 'active' where id = v_post_id;

  -- The 4 draft-only fns must all raise POST_NOT_EDITABLE on a LIVE post.
  v_ok := false;
  begin perform public.update_post_photos(v_post_id, array[
    'http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/0.jpg',
    'http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/1.jpg',
    'http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/2.jpg']);
  exception when others then if sqlerrm like '%POST_NOT_EDITABLE%' then v_ok := true;
    else raise exception 'CHECK 2b FAILED (photos): got %', sqlerrm; end if; end;
  if not v_ok then raise exception 'CHECK 2b FAILED: photos ran on a LIVE post'; end if;

  v_ok := false;
  begin perform public.update_post_last_seen(v_post_id, now(), 51.5, -0.1, 'London');
  exception when others then if sqlerrm like '%POST_NOT_EDITABLE%' then v_ok := true;
    else raise exception 'CHECK 2b FAILED (last_seen): got %', sqlerrm; end if; end;
  if not v_ok then raise exception 'CHECK 2b FAILED: last_seen ran on a LIVE post'; end if;

  v_ok := false;
  begin perform public.update_post_bounty(v_post_id, 40000);
  exception when others then if sqlerrm like '%POST_NOT_EDITABLE%' then v_ok := true;
    else raise exception 'CHECK 2b FAILED (bounty): got %', sqlerrm; end if; end;
  if not v_ok then raise exception 'CHECK 2b FAILED: bounty ran on a LIVE post (ESCROW AT RISK)'; end if;

  v_ok := false;
  begin perform public.update_post_verification(v_post_id, '22222222-2222-2222-2222-222222222222/ep70/x.pdf');
  exception when others then if sqlerrm like '%POST_NOT_EDITABLE%' then v_ok := true;
    else raise exception 'CHECK 2b FAILED (verification): got %', sqlerrm; end if; end;
  if not v_ok then raise exception 'CHECK 2b FAILED: verification ran on a LIVE post'; end if;

  -- car_details must SUCCEED on a LIVE post (20260731110000): a wrong colour or
  -- model actively harms the search, so the owner must be able to correct it.
  perform public.update_post_car_details(v_post_id, 'Ford', 'Focus', 'Red', null, null, null);
  select * into v_post from public.posts where id = v_post_id;
  if v_post.colour <> 'Red' then
    raise exception 'CHECK 2b FAILED: car_details did not apply on a LIVE post';
  end if;
  if v_post.bounty_amount_pence <> 25000 or v_post.status <> 'active'
     or v_post.owner_id <> '22222222-2222-2222-2222-222222222222' then
    raise exception 'CHECK 2b FAILED: car_details touched money/status/owner on a LIVE post';
  end if;
  -- PLATE STAYS IMMUTABLE: no RPC writes it, so a live post can never be edited
  -- onto a different registration. Assert the seeded canon survived the edit.
  if upper(regexp_replace(coalesce(v_post.plate, ''), '[^A-Za-z0-9]', '', 'g')) <> 'EP70LIV' then
    raise exception 'CHECK 2b FAILED: plate changed on a LIVE post (identity laundering)';
  end if;

  -- The 3 SAFE prose fns must SUCCEED on a LIVE post — an owner can keep refining
  -- the text spotters actually read.
  perform public.update_post_theft_context(v_post_id, 'car_park', 'unknown', 'Clunk over bumps.');
  select * into v_post from public.posts where id = v_post_id;
  if v_post.stolen_from <> 'car_park' or v_post.keys_taken <> 'unknown' or v_post.desc_drives <> 'Clunk over bumps.' then
    raise exception 'CHECK 2b FAILED: theft_context did not apply on a LIVE post';
  end if;
  if v_post.bounty_amount_pence <> 25000 or v_post.status <> 'active'
     or v_post.owner_id <> '22222222-2222-2222-2222-222222222222' then
    raise exception 'CHECK 2b FAILED: theft_context touched money/status/owner on a LIVE post';
  end if;

  perform public.update_post_distinctive_features(v_post_id, jsonb_build_array(
    jsonb_build_object('photo_url', 'http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/df9.jpg', 'description', 'Single mark now')));
  select count(*) into v_n from public.post_distinctive_feature where post_id = v_post_id;
  if v_n <> 1 then raise exception 'CHECK 2b FAILED: distinctive_features did not apply on a LIVE post, got %', v_n; end if;
  select * into v_post from public.posts where id = v_post_id;
  if v_post.bounty_amount_pence <> 25000 or v_post.status <> 'active' then
    raise exception 'CHECK 2b FAILED: distinctive_features touched money/status on a LIVE post';
  end if;

  perform public.update_post_description(v_post_id, 'Recognisable by the roof box.');
  select * into v_post from public.posts where id = v_post_id;
  if v_post.desc_recognise <> 'Recognisable by the roof box.' then
    raise exception 'CHECK 2b FAILED: description did not apply on a LIVE post';
  end if;
  if v_post.bounty_amount_pence <> 25000 or v_post.status <> 'active'
     or v_post.owner_id <> '22222222-2222-2222-2222-222222222222' then
    raise exception 'CHECK 2b FAILED: description touched money/status/owner on a LIVE post';
  end if;

  -- And the terminal states stay closed: cancelled is not editable by anything.
  update public.posts set status = 'cancelled' where id = v_post_id;
  v_ok := false;
  begin perform public.update_post_description(v_post_id, 'should not land');
  exception when others then if sqlerrm like '%POST_NOT_EDITABLE%' then v_ok := true;
    else raise exception 'CHECK 2b FAILED (cancelled description): got %', sqlerrm; end if; end;
  if not v_ok then raise exception 'CHECK 2b FAILED: description ran on a CANCELLED post'; end if;

  delete from public.posts where id = v_post_id;  -- self-clean
  raise notice 'CHECK 2b passed: on a LIVE post the 4 draft-only fns are blocked, car_details + the 3 safe fns succeed without touching money/status/owner/plate, and cancelled stays closed';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 3 — NON-OWNER cannot edit any section. Owner 22222222 seeds a draft; caller
-- 11111111 gets POST_NOT_EDITABLE from every one of the 8 functions.
-- -----------------------------------------------------------------------------
do $$
declare
  v_doc     jsonb;
  v_post_id uuid;
  v_ok      boolean;
begin
  perform set_config(
    'request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}',
    true);
  v_doc := public.create_post(
    'EP70 NON', 'Ford', 'Focus', 'Blue', 2019, null, null, null, null, null,
    null, null, now() - interval '1 day', 53.4808, -2.2426, 'Manchester', 25000,
    array['http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/0.jpg',
          'http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/1.jpg',
          'http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/2.jpg'],
    null, null);
  v_post_id := (v_doc ->> 'post_id')::uuid;

  -- Switch to the DIFFERENT user.
  perform set_config(
    'request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}',
    true);

  v_ok := false;
  begin perform public.update_post_car_details(v_post_id, 'X', 'Y', 'Z', null, null, null);
  exception when others then if sqlerrm like '%POST_NOT_EDITABLE%' then v_ok := true; else raise; end if; end;
  if not v_ok then raise exception 'CHECK 3 FAILED: non-owner ran car_details'; end if;

  v_ok := false;
  begin perform public.update_post_photos(v_post_id, array[
    'http://127.0.0.1:54321/storage/v1/object/public/post-photos/11111111-1111-1111-1111-111111111111/0.jpg',
    'http://127.0.0.1:54321/storage/v1/object/public/post-photos/11111111-1111-1111-1111-111111111111/1.jpg',
    'http://127.0.0.1:54321/storage/v1/object/public/post-photos/11111111-1111-1111-1111-111111111111/2.jpg']);
  exception when others then if sqlerrm like '%POST_NOT_EDITABLE%' then v_ok := true; else raise; end if; end;
  if not v_ok then raise exception 'CHECK 3 FAILED: non-owner ran photos'; end if;

  v_ok := false;
  begin perform public.update_post_last_seen(v_post_id, now(), 51.5, -0.1, 'London');
  exception when others then if sqlerrm like '%POST_NOT_EDITABLE%' then v_ok := true; else raise; end if; end;
  if not v_ok then raise exception 'CHECK 3 FAILED: non-owner ran last_seen'; end if;

  v_ok := false;
  begin perform public.update_post_bounty(v_post_id, 40000);
  exception when others then if sqlerrm like '%POST_NOT_EDITABLE%' then v_ok := true; else raise; end if; end;
  if not v_ok then raise exception 'CHECK 3 FAILED: non-owner ran bounty'; end if;

  v_ok := false;
  begin perform public.update_post_verification(v_post_id, '11111111-1111-1111-1111-111111111111/ep70/x.pdf');
  exception when others then if sqlerrm like '%POST_NOT_EDITABLE%' then v_ok := true; else raise; end if; end;
  if not v_ok then raise exception 'CHECK 3 FAILED: non-owner ran verification'; end if;

  v_ok := false;
  begin perform public.update_post_theft_context(v_post_id, 'street', 'no', 'x');
  exception when others then if sqlerrm like '%POST_NOT_EDITABLE%' then v_ok := true; else raise; end if; end;
  if not v_ok then raise exception 'CHECK 3 FAILED: non-owner ran theft_context'; end if;

  v_ok := false;
  begin perform public.update_post_distinctive_features(v_post_id, jsonb_build_array(
    jsonb_build_object('photo_url', 'http://127.0.0.1:54321/storage/v1/object/public/post-photos/11111111-1111-1111-1111-111111111111/df.jpg', 'description', 'nope')));
  exception when others then if sqlerrm like '%POST_NOT_EDITABLE%' then v_ok := true; else raise; end if; end;
  if not v_ok then raise exception 'CHECK 3 FAILED: non-owner ran distinctive_features'; end if;

  v_ok := false;
  begin perform public.update_post_description(v_post_id, 'nope');
  exception when others then if sqlerrm like '%POST_NOT_EDITABLE%' then v_ok := true; else raise; end if; end;
  if not v_ok then raise exception 'CHECK 3 FAILED: non-owner ran description'; end if;

  -- Clean up as postgres (bypasses RLS).
  delete from public.posts where id = v_post_id;
  raise notice 'CHECK 3 passed: a non-owner gets POST_NOT_EDITABLE from all 8 section RPCs';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 4 — VALIDATION PARITY. On an own draft: a bad bounty raises
-- BOUNTY_OUT_OF_RANGE and < 3 photos raises PHOTO_COUNT — same codes as create_post.
-- -----------------------------------------------------------------------------
do $$
declare
  v_doc     jsonb;
  v_post_id uuid;
  v_bounty  boolean := false;
  v_photos  boolean := false;
begin
  perform set_config(
    'request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}',
    true);
  v_doc := public.create_post(
    'EP70 VAL', 'Ford', 'Focus', 'Blue', 2019, null, null, null, null, null,
    null, null, now() - interval '1 day', 53.4808, -2.2426, 'Manchester', 25000,
    array['http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/0.jpg',
          'http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/1.jpg',
          'http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/2.jpg'],
    null, null);
  v_post_id := (v_doc ->> 'post_id')::uuid;

  begin perform public.update_post_bounty(v_post_id, 500001);
  exception when others then
    if sqlerrm like '%BOUNTY_OUT_OF_RANGE%' then v_bounty := true;
    else raise exception 'CHECK 4 FAILED (bounty): expected BOUNTY_OUT_OF_RANGE, got: %', sqlerrm; end if;
  end;

  begin perform public.update_post_photos(v_post_id, array[
    'http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/0.jpg',
    'http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/1.jpg']);
  exception when others then
    if sqlerrm like '%PHOTO_COUNT%' then v_photos := true;
    else raise exception 'CHECK 4 FAILED (photos): expected PHOTO_COUNT, got: %', sqlerrm; end if;
  end;

  if not (v_bounty and v_photos) then
    raise exception 'CHECK 4 FAILED: validation parity broke (bounty=%, photos=%)', v_bounty, v_photos;
  end if;

  delete from public.posts where id = v_post_id;  -- self-clean
  raise notice 'CHECK 4 passed: bad bounty -> BOUNTY_OUT_OF_RANGE, 2 photos -> PHOTO_COUNT (parity with create_post)';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 5 — update_post_bounty changes ONLY bounty_amount_pence. Snapshot every
-- other column + the photo count + status before, run the bounty edit, and assert
-- NOTHING else moved.
-- -----------------------------------------------------------------------------
do $$
declare
  v_doc     jsonb;
  v_post_id uuid;
  v_before  public.posts%rowtype;
  v_after   public.posts%rowtype;
  v_ph_b    int;
  v_ph_a    int;
begin
  perform set_config(
    'request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}',
    true);
  v_doc := public.create_post(
    'EP70 BTY', 'Skoda', 'Octavia', 'Green', 2020, 'Estate', 'Roof bars.',
    'A note.', 'Green.', 'Rattles.', 'driveway', 'yes',
    now() - interval '1 day', 53.4808, -2.2426, 'Manchester', 25000,
    array['http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/0.jpg',
          'http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/1.jpg',
          'http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/2.jpg'],
    null, '22222222-2222-2222-2222-222222222222/ep70/v5c.pdf');
  v_post_id := (v_doc ->> 'post_id')::uuid;

  select * into v_before from public.posts where id = v_post_id;
  select count(*) into v_ph_b from public.post_photos where post_id = v_post_id;

  perform public.update_post_bounty(v_post_id, 45000);

  select * into v_after from public.posts where id = v_post_id;
  select count(*) into v_ph_a from public.post_photos where post_id = v_post_id;

  if v_after.bounty_amount_pence <> 45000 then
    raise exception 'CHECK 5 FAILED: bounty not updated, got %', v_after.bounty_amount_pence;
  end if;
  -- Everything else identical.
  if v_after.make <> v_before.make or v_after.model <> v_before.model
     or v_after.colour <> v_before.colour or v_after.year is distinct from v_before.year
     or v_after.body_type is distinct from v_before.body_type
     or v_after.owner_note is distinct from v_before.owner_note
     or v_after.stolen_from is distinct from v_before.stolen_from
     or v_after.keys_taken is distinct from v_before.keys_taken
     or v_after.desc_drives is distinct from v_before.desc_drives
     or v_after.last_seen_area is distinct from v_before.last_seen_area
     or v_after.last_seen_at is distinct from v_before.last_seen_at
     or v_after.status <> v_before.status
     or v_after.owner_id <> v_before.owner_id
     or v_after.expires_at is distinct from v_before.expires_at
     or v_after.plate is distinct from v_before.plate
     or v_ph_a <> v_ph_b then
    raise exception 'CHECK 5 FAILED: update_post_bounty touched a non-bounty field. before=%, after=%',
      to_jsonb(v_before), to_jsonb(v_after);
  end if;

  delete from public.posts where id = v_post_id;  -- self-clean
  raise notice 'CHECK 5 passed: update_post_bounty changes ONLY bounty_amount_pence';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 6 — update_post_distinctive_features REPLACES the child rows (2 -> 1), with
-- the new row reindexed to position 0.
-- -----------------------------------------------------------------------------
do $$
declare
  v_doc     jsonb;
  v_post_id uuid;
  v_n       int;
  v_pos     int;
  v_desc    text;
begin
  perform set_config(
    'request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}',
    true);
  v_doc := public.create_post(
    'EP70 DFT', 'Ford', 'Focus', 'Blue', 2019, null, null, null, null, null,
    null, null, now() - interval '1 day', 53.4808, -2.2426, 'Manchester', 25000,
    array['http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/0.jpg',
          'http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/1.jpg',
          'http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/2.jpg'],
    null, null,
    jsonb_build_array(
      jsonb_build_object('photo_url', 'http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/df0.jpg', 'description', 'Mark one'),
      jsonb_build_object('photo_url', 'http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/df1.jpg', 'description', 'Mark two')));
  v_post_id := (v_doc ->> 'post_id')::uuid;

  select count(*) into v_n from public.post_distinctive_feature where post_id = v_post_id;
  if v_n <> 2 then raise exception 'CHECK 6 FAILED: expected 2 seeded features, got %', v_n; end if;

  perform public.update_post_distinctive_features(v_post_id, jsonb_build_array(
    jsonb_build_object('photo_url', 'http://127.0.0.1:54321/storage/v1/object/public/post-photos/22222222-2222-2222-2222-222222222222/df9.jpg', 'description', '  Trimmed mark  ')));

  select count(*) into v_n from public.post_distinctive_feature where post_id = v_post_id;
  if v_n <> 1 then raise exception 'CHECK 6 FAILED: expected 1 feature after replace, got %', v_n; end if;
  select position, description into v_pos, v_desc
    from public.post_distinctive_feature where post_id = v_post_id;
  if v_pos <> 0 then raise exception 'CHECK 6 FAILED: replaced feature not reindexed to position 0, got %', v_pos; end if;
  if v_desc <> 'Trimmed mark' then raise exception 'CHECK 6 FAILED: description not stored trimmed, got "%"', v_desc; end if;

  delete from public.posts where id = v_post_id;  -- self-clean
  raise notice 'CHECK 6 passed: distinctive_features replaces child rows (2 -> 1), reindexed + trimmed';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 7 — GRANTS. anon must NOT be able to EXECUTE any of the 8 functions;
-- authenticated must. Assert via has_function_privilege on the exact signatures.
-- -----------------------------------------------------------------------------
do $$
declare
  v_sigs text[] := array[
    'public.update_post_car_details(uuid, text, text, text, text, int, text)',
    'public.update_post_photos(uuid, text[])',
    -- Gained a trailing, defaulted p_last_seen_locality in 20260802110000.
    -- has_function_privilege resolves by EXACT signature, so the 5-arg form
    -- would raise "function does not exist" rather than fail the assertion.
    'public.update_post_last_seen(uuid, timestamptz, double precision, double precision, text, text)',
    'public.update_post_bounty(uuid, int)',
    'public.update_post_verification(uuid, text)',
    'public.update_post_theft_context(uuid, text, text, text)',
    'public.update_post_distinctive_features(uuid, jsonb)',
    'public.update_post_description(uuid, text)'
  ];
  v_sig text;
begin
  foreach v_sig in array v_sigs loop
    if has_function_privilege('anon', v_sig, 'EXECUTE') then
      raise exception 'CHECK 7 FAILED: anon can EXECUTE % (should be revoked)', v_sig;
    end if;
    if not has_function_privilege('authenticated', v_sig, 'EXECUTE') then
      raise exception 'CHECK 7 FAILED: authenticated CANNOT EXECUTE % (should be granted)', v_sig;
    end if;
  end loop;
  raise notice 'CHECK 7 passed: anon denied EXECUTE on all 8 section RPCs; authenticated granted';
end $$;

-- =============================================================================
-- Post-detail verification (NOT a migration — do not place in migrations/).
--
-- SELF-ASSERTING: every check is a DO block that RAISES EXCEPTION on failure,
-- so the whole file aborts non-zero the moment a safety property is violated.
-- "A non-owner never receives a non-active post's details" is a Tier 1 property
-- (docs/SECURITY_AND_TRUST.md §2) — this file is meant to GATE CI, not to be
-- eyeballed. On success each block emits a NOTICE.
--
-- Run against a local DB seeded by supabase/seed.sql:
--     supabase db reset            # applies migrations + seed
--     psql -v ON_ERROR_STOP=1 "$DATABASE_URL" -f supabase/tests/post_detail_verification.sql
--
-- (ON_ERROR_STOP=1 makes psql exit non-zero on the first RAISE.)
--
-- Fixtures used (from supabase/seed.sql):
--   ACTIVE   a1a1a1a1-0000-0000-0000-000000000001  Ford Fiesta 'MA19 XKL'
--            owner 11111111-1111-1111-1111-111111111111  (has 3 photos, NO features)
--   DRAFT    a1a1a1a1-0000-0000-0000-00000000001b  'MA99 DRF' (trap, non-active)
--   RECOVERED a1a1a1a1-0000-0000-0000-000000000017 'MA18 RCV'
--   DRIVEWAY a1a1a1a1-0000-0000-0000-000000000006  Range Rover Evoque, ACTIVE,
--            owner 11111111-1111-1111-1111-111111111111, stolen_from='driveway'
--            (last-seen exact -2.2350, 53.4850), 3 features -> coarsening fixture
--
-- auth.uid() reads the request.jwt.claims GUC; running as postgres with no JWT
-- it is NULL (an anon / non-owner caller). Checks that need an OWNER caller set
-- request.jwt.claims locally to that owner's sub for the transaction.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- CHECK 1 — active post to an ANON caller: visible=true, is_owner=false, photos
-- present + ordered, exact coords present, and a DORMANT scalar sighting_stats.
-- -----------------------------------------------------------------------------
do $$
declare
  v_doc     jsonb;
  v_photos  jsonb;
begin
  v_doc    := public.get_post_detail('a1a1a1a1-0000-0000-0000-000000000001');
  v_photos := v_doc -> 'photos';

  if (v_doc ->> 'found')   is distinct from 'true'
     or (v_doc ->> 'visible') is distinct from 'true' then
    raise exception 'CHECK 1 FAILED: active post not found/visible: %', v_doc;
  end if;
  if (v_doc ->> 'is_owner') is distinct from 'false' then
    raise exception 'CHECK 1 FAILED: anon caller should NOT be is_owner, got %', v_doc ->> 'is_owner';
  end if;
  -- SAFETY: never leak the owner's uuid.
  if v_doc ? 'owner_id' then
    raise exception 'CHECK 1 FAILED: payload leaked owner_id';
  end if;
  -- Photos: exactly the 3 seeded, in position order 0,1,2, each with a url.
  if jsonb_array_length(v_photos) <> 3 then
    raise exception 'CHECK 1 FAILED: expected 3 photos, got %', jsonb_array_length(v_photos);
  end if;
  if (v_photos -> 0 ->> 'position') <> '0'
     or (v_photos -> 1 ->> 'position') <> '1'
     or (v_photos -> 2 ->> 'position') <> '2' then
    raise exception 'CHECK 1 FAILED: photos not ordered by position: %', v_photos;
  end if;
  if (v_photos -> 0 ->> 'url') is null then
    raise exception 'CHECK 1 FAILED: photo missing url: %', v_photos;
  end if;
  -- Descriptive detail fields present.
  if (v_doc ->> 'body_type') is null or (v_doc ->> 'year') is null then
    raise exception 'CHECK 1 FAILED: descriptive fields missing: %', v_doc;
  end if;
  raise notice 'CHECK 1 passed: active post visible to anon, is_owner=false, 3 ordered photos';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 2 — same active post to its OWNER: is_owner=true, still visible.
-- Sets request.jwt.claims to the owner's sub for this transaction only.
-- -----------------------------------------------------------------------------
do $$
declare
  v_doc jsonb;
begin
  perform set_config(
    'request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}',
    true);  -- is_local: reset at end of this DO block's transaction

  v_doc := public.get_post_detail('a1a1a1a1-0000-0000-0000-000000000001');

  if (v_doc ->> 'visible') is distinct from 'true'
     or (v_doc ->> 'is_owner') is distinct from 'true' then
    raise exception 'CHECK 2 FAILED: owner should see visible=true is_owner=true, got %', v_doc;
  end if;
  if v_doc ? 'owner_id' then
    raise exception 'CHECK 2 FAILED: owner payload still must not include owner_id';
  end if;
  raise notice 'CHECK 2 passed: owner sees is_owner=true';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 3 — NON-active post (draft trap) to a NON-owner (anon): the MINIMAL
-- stub only. visible=false, closedReason='unavailable', and NONE of the
-- sensitive fields present (make/model/plate/colour/lat/lng/owner_id/photos/
-- status/bounty). This is the core anti-stalking property.
-- -----------------------------------------------------------------------------
do $$
declare
  v_doc jsonb;
  v_k   text;
  v_forbidden text[] := array[
    'make','model','plate','colour','lat','lng','owner_id',
    'photos','status','bounty_amount_pence','distinguishing_features',
    'owner_note','year','body_type','last_seen_area','last_seen_at',
    -- Part-2 structured fields must NEVER appear in the leak-free stub either.
    'stolen_from','keys_taken','desc_recognise','desc_drives','features'];
begin
  v_doc := public.get_post_detail('a1a1a1a1-0000-0000-0000-00000000001b');  -- draft

  if (v_doc ->> 'found') is distinct from 'true'
     or (v_doc ->> 'visible') is distinct from 'false' then
    raise exception 'CHECK 3 FAILED: draft trap should be found+not-visible, got %', v_doc;
  end if;
  if (v_doc ->> 'closedReason') <> 'unavailable' then
    raise exception 'CHECK 3 FAILED: draft closedReason should be unavailable, got %', v_doc ->> 'closedReason';
  end if;
  foreach v_k in array v_forbidden loop
    if v_doc ? v_k then
      raise exception 'CHECK 3 FAILED: leak-free stub leaked field "%": %', v_k, v_doc;
    end if;
  end loop;
  raise notice 'CHECK 3 passed: non-active post to non-owner is the leak-free stub';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 4 — recovered post to a NON-owner: visible=false, closedReason
-- 'recovered' (the ONLY status distinction a non-owner ever learns).
-- -----------------------------------------------------------------------------
do $$
declare
  v_doc jsonb;
begin
  v_doc := public.get_post_detail('a1a1a1a1-0000-0000-0000-000000000017');  -- recovered

  if (v_doc ->> 'visible') is distinct from 'false'
     or (v_doc ->> 'closedReason') <> 'recovered' then
    raise exception 'CHECK 4 FAILED: recovered post to non-owner should be visible=false closedReason=recovered, got %', v_doc;
  end if;
  -- Even the recovered stub must not reveal the fine status or identity.
  if v_doc ? 'status' or v_doc ? 'make' or v_doc ? 'lat' then
    raise exception 'CHECK 4 FAILED: recovered stub leaked status/identity/location: %', v_doc;
  end if;
  raise notice 'CHECK 4 passed: recovered post to non-owner -> closedReason=recovered only';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 5 — sighting_stats is a DORMANT scalar aggregate: count is the number
-- 0, latest_at is null, sighting_stats is an OBJECT (not an array), and there
-- is NO 'sightings' array anywhere in the payload. Guards against a future
-- change accidentally widening the dormant aggregate into per-sighting rows.
-- -----------------------------------------------------------------------------
do $$
declare
  v_doc jsonb;
begin
  v_doc := public.get_post_detail('a1a1a1a1-0000-0000-0000-000000000001');  -- active/visible

  if jsonb_typeof(v_doc -> 'sighting_stats') <> 'object' then
    raise exception 'CHECK 5 FAILED: sighting_stats is not an object: %', v_doc -> 'sighting_stats';
  end if;
  if jsonb_typeof(v_doc -> 'sighting_stats' -> 'count') <> 'number'
     or (v_doc -> 'sighting_stats' ->> 'count') <> '0' then
    raise exception 'CHECK 5 FAILED: sighting_stats.count is not the scalar 0: %', v_doc -> 'sighting_stats';
  end if;
  if (v_doc -> 'sighting_stats' -> 'latest_at') <> 'null'::jsonb then
    raise exception 'CHECK 5 FAILED: sighting_stats.latest_at should be null: %', v_doc -> 'sighting_stats';
  end if;
  -- Belt-and-braces: no per-sighting rows array anywhere in the payload.
  if v_doc ? 'sightings' or v_doc::text like '%"sightings"%' then
    raise exception 'CHECK 5 FAILED: payload contains a sightings rows array: %', v_doc;
  end if;
  raise notice 'CHECK 5 passed: sighting_stats is a dormant scalar; no sighting rows leak';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 6 — coordinates are present ONLY for a visible post. Active/visible
-- carries numeric lat/lng; the non-visible stub carries neither key.
-- -----------------------------------------------------------------------------
do $$
declare
  v_visible jsonb;
  v_hidden  jsonb;
begin
  v_visible := public.get_post_detail('a1a1a1a1-0000-0000-0000-000000000001');  -- active
  v_hidden  := public.get_post_detail('a1a1a1a1-0000-0000-0000-00000000001b');  -- draft

  if jsonb_typeof(v_visible -> 'lat') <> 'number'
     or jsonb_typeof(v_visible -> 'lng') <> 'number' then
    raise exception 'CHECK 6 FAILED: visible post missing numeric coords: lat=%, lng=%',
      v_visible -> 'lat', v_visible -> 'lng';
  end if;
  if v_hidden ? 'lat' or v_hidden ? 'lng' then
    raise exception 'CHECK 6 FAILED: non-visible stub exposed coordinates: %', v_hidden;
  end if;
  raise notice 'CHECK 6 passed: coordinates present only for the visible post';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 7 — a missing post id returns the { found:false } stub (no leak, no
-- error).
-- -----------------------------------------------------------------------------
do $$
declare
  v_doc jsonb;
begin
  v_doc := public.get_post_detail('00000000-0000-0000-0000-0000000000ff');

  if (v_doc ->> 'found') is distinct from 'false' then
    raise exception 'CHECK 7 FAILED: missing id should return found=false, got %', v_doc;
  end if;
  if v_doc ? 'visible' or v_doc ? 'closedReason' then
    raise exception 'CHECK 7 FAILED: not-found stub should carry nothing but found=false: %', v_doc;
  end if;
  raise notice 'CHECK 7 passed: missing post id returns found=false';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 8 — AUTHENTICATED non-owner (a signed-in user who is not the owner)
-- hitting the draft trap gets the SAME leak-free stub as anon. Guards the
-- `owner_id = v_viewer` branch, not just the anon (v_viewer null) branch.
-- -----------------------------------------------------------------------------
do $$
declare
  v_doc jsonb;
begin
  perform set_config(
    'request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}',
    true);  -- a different user, NOT the draft's owner

  v_doc := public.get_post_detail('a1a1a1a1-0000-0000-0000-00000000001b');  -- draft

  if (v_doc ->> 'visible') is distinct from 'false'
     or (v_doc ->> 'closedReason') <> 'unavailable' then
    raise exception 'CHECK 8 FAILED: auth non-owner should get the unavailable stub, got %', v_doc;
  end if;
  if v_doc ? 'make' or v_doc ? 'plate' or v_doc ? 'lat' or v_doc ? 'owner_id' then
    raise exception 'CHECK 8 FAILED: auth non-owner stub leaked identity/location: %', v_doc;
  end if;
  raise notice 'CHECK 8 passed: authenticated non-owner gets the same leak-free stub';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 9 — the OWNER sees their OWN draft (a non-active status) in full:
-- visible=true, is_owner=true. Confirms the owner-sees-own-in-any-status path.
-- -----------------------------------------------------------------------------
do $$
declare
  v_doc jsonb;
begin
  perform set_config(
    'request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}',
    true);  -- the draft's owner

  v_doc := public.get_post_detail('a1a1a1a1-0000-0000-0000-00000000001b');  -- own draft

  if (v_doc ->> 'visible') is distinct from 'true'
     or (v_doc ->> 'is_owner') is distinct from 'true' then
    raise exception 'CHECK 9 FAILED: owner should see own draft visible+is_owner, got %', v_doc;
  end if;
  if (v_doc ->> 'status') <> 'draft' then
    raise exception 'CHECK 9 FAILED: owner draft should report its real status, got %', v_doc ->> 'status';
  end if;
  raise notice 'CHECK 9 passed: owner sees own draft in full';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 10 — owner block to an ANON viewer of an active post: de-identified.
-- member_since present; first_name + avatar_path WITHHELD (json null); and no
-- surname (display_name) anywhere. SAFETY: a theft victim isn't exposed to
-- logged-out browsers (docs/DOMAIN.md "Owner identity on a post").
-- -----------------------------------------------------------------------------
do $$
declare
  v_doc   jsonb;
  v_owner jsonb;
begin
  v_doc   := public.get_post_detail('a1a1a1a1-0000-0000-0000-000000000001');  -- anon (no JWT)
  v_owner := v_doc -> 'owner';

  if v_owner is null or jsonb_typeof(v_owner) <> 'object' then
    raise exception 'CHECK 10 FAILED: owner block missing: %', v_doc;
  end if;
  -- anon: no first_name; and NO avatar_path key at all (it embeds owner_id).
  if (v_owner -> 'first_name') is distinct from 'null'::jsonb or v_owner ? 'avatar_path' then
    raise exception 'CHECK 10 FAILED: anon owner block leaked name/avatar: %', v_owner;
  end if;
  if not (v_owner ? 'member_since') or (v_owner -> 'member_since') = 'null'::jsonb then
    raise exception 'CHECK 10 FAILED: member_since missing for anon: %', v_owner;
  end if;
  if v_doc::text like '%display_name%' then
    raise exception 'CHECK 10 FAILED: payload contains display_name (surname risk): %', v_doc;
  end if;
  raise notice 'CHECK 10 passed: anon owner block is de-identified (member_since only)';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 11 — owner block to a SIGNED-IN (non-owner) viewer: first_name is
-- present; still no display_name / owner_id anywhere.
-- -----------------------------------------------------------------------------
do $$
declare
  v_doc   jsonb;
  v_owner jsonb;
begin
  perform set_config(
    'request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}',
    true);  -- a signed-in viewer who is not the owner

  v_doc   := public.get_post_detail('a1a1a1a1-0000-0000-0000-000000000001');
  v_owner := v_doc -> 'owner';

  if (v_owner -> 'first_name') = 'null'::jsonb then
    raise exception 'CHECK 11 FAILED: signed-in viewer should see owner first_name: %', v_owner;
  end if;
  -- SAFETY: owner_id must not leak as a key OR embedded in any value (e.g. an
  -- avatar path pinned to '<owner_id>/avatar.jpg'). Sweep the whole payload for
  -- the owner's uuid and for display_name.
  if v_doc::text like '%display_name%'
     or v_doc ? 'owner_id'
     or v_doc::text like '%11111111-1111-1111-1111-111111111111%' then
    raise exception 'CHECK 11 FAILED: leaked display_name / owner_id / owner uuid: %', v_doc;
  end if;
  raise notice 'CHECK 11 passed: signed-in sees first name; no surname/owner_id/uuid anywhere';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 12 — HOME-ADDRESS COARSENING (Tier 1). The driveway-theft fixture
-- (post ...0006, exact -2.2350, 53.4850) returns COARSENED lat/lng to a
-- non-owner (grid-snapped to 0.01, so != the exact seeded point) but the EXACT
-- point to its owner. SAFETY: stolen_from='driveway' means the last-seen point
-- is the victim's HOME and must never be pinpointed to strangers.
-- -----------------------------------------------------------------------------
do $$
declare
  v_anon    jsonb;
  v_owner   jsonb;
  v_exact_lat constant double precision := 53.4850;
  v_exact_lng constant double precision := -2.2350;
  a_lat double precision; a_lng double precision;
  o_lat double precision; o_lng double precision;
begin
  -- Non-owner (anon: no JWT).
  perform set_config('request.jwt.claims', NULL, true);
  v_anon := public.get_post_detail('a1a1a1a1-0000-0000-0000-000000000006');
  a_lat  := (v_anon ->> 'lat')::double precision;
  a_lng  := (v_anon ->> 'lng')::double precision;

  -- Owner.
  perform set_config(
    'request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}',
    true);
  v_owner := public.get_post_detail('a1a1a1a1-0000-0000-0000-000000000006');
  o_lat   := (v_owner ->> 'lat')::double precision;
  o_lng   := (v_owner ->> 'lng')::double precision;

  if (v_anon ->> 'stolen_from') <> 'driveway' then
    raise exception 'CHECK 12 FAILED: fixture is not a driveway theft (got %); seed drift', v_anon ->> 'stolen_from';
  end if;
  -- Owner sees the EXACT seeded point.
  if abs(o_lat - v_exact_lat) > 1e-6 or abs(o_lng - v_exact_lng) > 1e-6 then
    raise exception 'CHECK 12 FAILED: owner should get EXACT driveway coords, got lat=% lng=%', o_lat, o_lng;
  end if;
  -- Non-owner point must DIFFER from the exact point (it was blurred)...
  if abs(a_lat - v_exact_lat) < 1e-4 and abs(a_lng - v_exact_lng) < 1e-4 then
    raise exception 'CHECK 12 FAILED: non-owner driveway coords were NOT coarsened: lat=% lng=%', a_lat, a_lng;
  end if;
  -- ...and be grid-snapped to a 0.01 cell (ST_SnapToGrid).
  if abs(a_lat - round((a_lat/0.01))*0.01) > 1e-6
     or abs(a_lng - round((a_lng/0.01))*0.01) > 1e-6 then
    raise exception 'CHECK 12 FAILED: non-owner driveway coords are not 0.01-grid-snapped: lat=% lng=%', a_lat, a_lng;
  end if;
  raise notice 'CHECK 12 passed: driveway last-seen point coarsened to non-owner, exact to owner';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 13 — a NON-driveway active post to a non-owner keeps its EXACT point
-- (coarsening applies ONLY to driveway thefts). Post ...0001 is stolen_from
-- 'street', exact -2.2426, 53.4808.
-- -----------------------------------------------------------------------------
do $$
declare
  v_doc jsonb;
begin
  perform set_config('request.jwt.claims', NULL, true);  -- anon / non-owner
  v_doc := public.get_post_detail('a1a1a1a1-0000-0000-0000-000000000001');

  if (v_doc ->> 'stolen_from') = 'driveway' then
    raise exception 'CHECK 13 FAILED: fixture unexpectedly driveway; seed drift';
  end if;
  if abs((v_doc ->> 'lat')::double precision - 53.4808) > 1e-6
     or abs((v_doc ->> 'lng')::double precision - (-2.2426)) > 1e-6 then
    raise exception 'CHECK 13 FAILED: non-driveway post should keep EXACT coords, got lat=% lng=%',
      v_doc ->> 'lat', v_doc ->> 'lng';
  end if;
  raise notice 'CHECK 13 passed: non-driveway post keeps exact coords for a non-owner';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 14 — FEATURES. A tagged post returns the joined key/label/icon array in
-- taxonomy sort order; an untagged post returns []. Post ...0006 has 3 tags
-- (private_plate, roof_rack, tinted_windows); post ...0001 has none.
-- -----------------------------------------------------------------------------
do $$
declare
  v_tagged   jsonb;
  v_untagged jsonb;
  v_feats    jsonb;
begin
  perform set_config('request.jwt.claims', NULL, true);  -- anon; both posts active

  v_tagged   := public.get_post_detail('a1a1a1a1-0000-0000-0000-000000000006');
  v_untagged := public.get_post_detail('a1a1a1a1-0000-0000-0000-000000000001');
  v_feats    := v_tagged -> 'features';

  if jsonb_typeof(v_feats) <> 'array' or jsonb_array_length(v_feats) <> 3 then
    raise exception 'CHECK 14 FAILED: expected 3 features, got %', v_feats;
  end if;
  -- Each element carries key + label + icon (and nothing sensitive).
  if (v_feats -> 0 ->> 'key') is null
     or (v_feats -> 0 ->> 'label') is null
     or (v_feats -> 0 ->> 'icon') is null then
    raise exception 'CHECK 14 FAILED: feature element missing key/label/icon: %', v_feats;
  end if;
  -- Ordered by the taxonomy sort_order: roof_rack(60) < tinted_windows(100) <
  -- private_plate(120).
  if (v_feats -> 0 ->> 'key') <> 'roof_rack'
     or (v_feats -> 1 ->> 'key') <> 'tinted_windows'
     or (v_feats -> 2 ->> 'key') <> 'private_plate' then
    raise exception 'CHECK 14 FAILED: features not in sort_order: %', v_feats;
  end if;
  -- Untagged post -> [].
  if (v_untagged -> 'features') <> '[]'::jsonb then
    raise exception 'CHECK 14 FAILED: untagged post should return [], got %', v_untagged -> 'features';
  end if;
  raise notice 'CHECK 14 passed: features joined + ordered for a tagged post, [] otherwise';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 15 — the Part-2 structured fields (stolen_from, keys_taken,
-- desc_recognise, desc_drives, features) appear in the VISIBLE branch and are
-- ABSENT from the hidden stub. (CHECK 3 already sweeps the stub for them; this
-- asserts the positive/visible side.)
-- -----------------------------------------------------------------------------
do $$
declare
  v_visible jsonb;
  v_hidden  jsonb;
begin
  perform set_config('request.jwt.claims', NULL, true);
  v_visible := public.get_post_detail('a1a1a1a1-0000-0000-0000-000000000006');  -- active
  v_hidden  := public.get_post_detail('a1a1a1a1-0000-0000-0000-00000000001b');  -- draft

  if not (v_visible ? 'stolen_from' and v_visible ? 'keys_taken'
          and v_visible ? 'desc_recognise' and v_visible ? 'desc_drives'
          and v_visible ? 'features') then
    raise exception 'CHECK 15 FAILED: visible branch is missing a Part-2 field: %', v_visible;
  end if;
  if v_hidden ? 'stolen_from' or v_hidden ? 'keys_taken'
     or v_hidden ? 'desc_recognise' or v_hidden ? 'desc_drives'
     or v_hidden ? 'features' then
    raise exception 'CHECK 15 FAILED: hidden stub leaked a Part-2 field: %', v_hidden;
  end if;
  raise notice 'CHECK 15 passed: Part-2 fields present in visible branch, absent from stub';
end $$;

-- =============================================================================
-- WHAT:  create_post gains p_vehicle_id, so a post made from a saved car
--        finally records WHICH car — and stops stamping an expires_at that
--        nothing acts on. DROP + CREATE, because a new parameter changes the
--        function's identity.
-- WHY:   Two findings from the whole-app review, both in the same statement.
--
-- ⚠️ #17 — THE GUARD THAT HAS NEVER FIRED. 20260801100000 added
--        posts.vehicle_id and said in its own header: "A SEPARATE follow-up
--        migration adds the p_vehicle_id parameter to create_post. Until that
--        ships, posts.vehicle_id is written by nothing and is always NULL."
--        That follow-up is this file, thirty-two days later. In between,
--        delete_vehicle's guard has been:
--
--            where p.vehicle_id = p_vehicle_id   -- never true, for any row
--
--        so its own comment — "a deliberate guard against silently deleting a
--        car that has a live listing and held escrow" — described something
--        that could not happen. AN OWNER HAS BEEN ABLE TO DELETE A CAR THAT IS
--        CURRENTLY REPORTED STOLEN WITH MONEY IN ESCROW. list_my_vehicles'
--        is_currently_posted has been permanently false for the same reason,
--        which is why the "Currently reported stolen" card state has never
--        been seen.
--
-- ⚠️ #18 — expires_at IS NO LONGER STAMPED. It was set to now() + 90 days and
--        NOTHING has ever read it for a decision: passive expiry was cut
--        deliberately ("we are cutting the PROMISE, not building the machine"),
--        so the date never arrived and the listing never closed — while post
--        detail counted down to it in front of an owner whose car was still
--        missing. The Terms already say the true thing: "A listing stays live
--        until you cancel it or the vehicle is recovered." Liveness is now a
--        question the owner is ASKED, on a schedule (ADR-0019). A second clock
--        beside that one, counting to a date that does not exist, would undo it.
--
--        The COLUMN stays: rows written before today keep their value, and
--        nothing reads it. New posts leave it NULL, which is what "this listing
--        does not expire" has always actually meant.
--
-- ⚠️ THE BODY IS BYTE-IDENTICAL to 20260819100000's apart from the six changes
--        listed below. It was extracted from that file and patched
--        programmatically rather than retyped, because ~200 lines of plate,
--        photo-path, enum and distinctive-feature validation restated by hand
--        is exactly how a silent regression gets into the app's single most
--        important RPC. Diff this against 20260819100000 lines 130-337; the
--        differences should be:
--          1. create or replace -> create (the drop is above)
--          2. the trailing p_vehicle_id parameter
--          3. the v_vehicle_id declaration
--          4. the ownership check
--          5/6. vehicle_id in the insert, and expires_at out of it
--
-- SAFETY NOTE ON DESTRUCTIVE STATEMENTS: ⚠️ THIS DROPS create_post — the write
--        boundary every stolen-car report passes through. The drop names the
--        exact 22-type signature and carries NO CASCADE, so if anything else
--        depended on it the migration FAILS rather than silently removing the
--        dependent. The recreate follows in the same transaction. No table, no
--        data, no policy and no other function is touched.
--
--        ⚠️ Ownership on p_vehicle_id is CHECKED, never trusted — an
--        unverified id would let a caller pin their post to a stranger's
--        vehicle and freeze that stranger's garage row against deletion.
--
-- LINKS: supabase/migrations/20260819100000_a_listing_can_be_free.sql (the body
--          this is patched from — diff against it);
--        supabase/migrations/20260801100000_garage_vehicles.sql (the column,
--          delete_vehicle's guard, and the NOTE that planned this migration);
--        docs/decisions/ADR-0019-the-abandoned-post.md (why expiry is a
--          question and not a clock);
--        supabase/tests/post_vehicle_link_verification.sql.
-- =============================================================================


-- =============================================================================
-- 1. Drop the old signature
-- =============================================================================
-- Adding a parameter changes the function's identity, so `create or replace`
-- would leave TWO overloads and make every named-argument call ambiguous
-- (PostgREST sends named arguments). No CASCADE, deliberately.
drop function public.create_post(
  text, text, text, text, int, text, text, text, text, text, text, text,
  timestamptz, double precision, double precision, text, int, text[], text[], text, jsonb, text
);


-- =============================================================================
-- 2. Recreate it, with the vehicle link
-- =============================================================================
create function public.create_post(
  p_plate                   text,
  p_make                    text,
  p_model                   text,
  p_colour                  text,
  p_year                    int,
  p_body_type               text,
  p_distinguishing_features text,
  p_owner_note              text,
  p_desc_recognise          text,
  p_desc_drives             text,
  p_stolen_from             text,
  p_keys_taken              text,
  p_last_seen_at            timestamptz,
  p_last_seen_lat           double precision,
  p_last_seen_lng           double precision,
  p_last_seen_area          text,
  p_bounty_amount_pence     int,
  p_photo_urls              text[],
  p_feature_keys            text[],
  p_verification_path       text,
  p_distinctive_features    jsonb default '[]'::jsonb,
  -- TRAILING and DEFAULTED on purpose, despite reading better beside
  -- p_last_seen_area. The client calls this by NAME (PostgREST sends named
  -- arguments), so position buys it nothing — but every POSITIONAL caller
  -- breaks when a non-defaulted parameter is inserted mid-list, and this
  -- function has ~25 positional callers across the SQL verification suites.
  -- Since scripts/test-db.sh runs them under `set -e`, one 42883 there stops
  -- the run before anon_role_verification.sql — the Tier 1 deny-by-default
  -- CI gate — ever executes. A trailing default keeps every existing call
  -- valid and costs only the pleasing argument order.
  p_last_seen_locality      text default null,
  -- TRAILING and DEFAULTED for the same reason p_last_seen_locality is: every
  -- positional caller in the SQL verification suites stays valid.
  p_vehicle_id              uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_owner       uuid := auth.uid();
  v_post_id     uuid;
  v_plate       text;
  v_plate_canon text;
  v_photo_count int  := coalesce(array_length(p_photo_urls, 1), 0);
  v_url         text;
  v_photo_url_re text := '^https?://(127\.0\.0\.1(:[0-9]+)?|[a-z0-9-]+\.supabase\.co)'
                         || '/storage/v1/object/public/post-photos/'
                         || v_owner::text || '/[^/]+$';
  -- Distinctive-feature validation scratch vars (20260724100000).
  v_features    jsonb := coalesce(p_distinctive_features, '[]'::jsonb);
  v_feature     jsonb;
  v_feat_desc   text;
  v_feat_url    text;
  -- SAFETY (this migration): the coarse alert-facing label. Trimmed; '' -> NULL
  -- so the push falls back to 'your area' rather than emitting "near ".
  v_locality    text := nullif(btrim(p_last_seen_locality), '');
  -- The garage vehicle this post came from, AFTER the ownership check below.
  -- Never p_vehicle_id directly: an unverified id must not reach the insert.
  v_vehicle_id  uuid;
begin
  if v_owner is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  -- --- PROVENANCE: the garage vehicle this post was made from ------------------
  -- ⚠️ OWNERSHIP IS CHECKED, NOT TRUSTED. p_vehicle_id arrives from the client,
  -- and posts.vehicle_id feeds delete_vehicle's active-post guard and
  -- list_my_vehicles' is_currently_posted. Accepting an id blindly would let a
  -- caller pin their post to a STRANGER'S vehicle and freeze that stranger's
  -- garage row against deletion.
  --
  -- A vehicle that is not the caller's resolves to NULL rather than raising:
  -- this is provenance, not the point of the call, and failing a whole stolen-car
  -- report because a garage row was deleted mid-flow would be the wrong trade.
  -- NULL is exactly the state every post has had until now.
  if p_vehicle_id is not null then
    select v.id into v_vehicle_id
      from public.vehicles v
     where v.id = p_vehicle_id
       and v.owner_id = v_owner;
  end if;

  -- --- OPTIONAL PLATE: canon first; a plate that strips to nothing is NULL -----
  v_plate_canon := upper(regexp_replace(coalesce(p_plate, ''), '[^A-Za-z0-9]', '', 'g'));
  -- FIX (20260713195000): store NULL whenever the canon is empty (blank,
  -- punctuation-only, or non-ASCII homoglyphs) — those are NOT plates. A non-null
  -- v_plate therefore always passes the {2,8} gate below (also re-bounds length).
  v_plate := case when v_plate_canon = '' then null
                  else upper(trim(coalesce(p_plate, ''))) end;

  -- Format + uniqueness gates apply ONLY when a real plate was provided.
  if v_plate_canon <> '' then
    if v_plate_canon !~ '^[A-Z0-9]{2,8}$' then
      raise exception 'INVALID_PLATE';
    end if;

    if exists (
      select 1
      from public.posts p
      where upper(regexp_replace(coalesce(p.plate, ''), '[^A-Za-z0-9]', '', 'g')) = v_plate_canon
        and p.status in ('active', 'pending_verification', 'recovery_claimed')
    ) then
      raise exception 'PLATE_IN_USE';
    end if;
  end if;

  -- --- Required fields (make/model/colour are the identity, plate or not) ------
  if p_make is null or p_model is null or p_colour is null
     or p_last_seen_at is null
     or p_last_seen_lat is null or p_last_seen_lng is null
     then
    raise exception 'MISSING_REQUIRED';
  end if;

  -- --- MONEY: bounty range, WHEN THERE IS ONE ---------------------------------
  -- NULL is now lawful and means a FREE LISTING: no reward, and the owner pays a
  -- flat listing fee instead of the 5% cut. The range itself is untouched — this
  -- migration adds a case rather than moving the floor, which DOMAIN.md records
  -- as the expensive shape.
  if p_bounty_amount_pence is not null
     and (p_bounty_amount_pence < 1000 or p_bounty_amount_pence > 500000) then
    raise exception 'BOUNTY_OUT_OF_RANGE';
  end if;

  -- --- Photo count ------------------------------------------------------------
  if v_photo_count < 3 or v_photo_count > 6 then
    raise exception 'PHOTO_COUNT';
  end if;

  -- --- SAFETY: photo URLs must be our own-folder post-photos objects ----------
  foreach v_url in array p_photo_urls loop
    if v_url is null or char_length(v_url) > 500 or v_url !~ v_photo_url_re then
      raise exception 'INVALID_PHOTO_URL';
    end if;
  end loop;

  -- --- SAFETY: the V5C path must be under the caller's own folder -------------
  if p_verification_path is not null then
    if char_length(p_verification_path) > 300
       or split_part(p_verification_path, '/', 1) <> v_owner::text then
      raise exception 'INVALID_VERIFICATION_PATH';
    end if;
  end if;

  -- --- Distinctive features (owner-authored photo+description evidence pairs) --
  -- Server re-check of the jsonb array of {"photo_url": text, "description": text}
  -- objects. A non-array payload is treated as malformed. At most 8 features;
  -- each description is 3–80 chars trimmed; each photo_url must be an own-folder
  -- post-photos object (SAME check as p_photo_urls above — same §3 vector).
  if jsonb_typeof(v_features) <> 'array' then
    raise exception 'INVALID_DISTINCTIVE_FEATURE';
  end if;
  if jsonb_array_length(v_features) > 8 then
    raise exception 'DISTINCTIVE_FEATURES_COUNT';
  end if;
  for v_feature in select value from jsonb_array_elements(v_features) loop
    v_feat_desc := v_feature ->> 'description';
    v_feat_url  := v_feature ->> 'photo_url';
    if v_feat_desc is null
       or char_length(btrim(v_feat_desc)) < 3
       or char_length(btrim(v_feat_desc)) > 80 then
      raise exception 'INVALID_DISTINCTIVE_FEATURE';
    end if;
    if v_feat_url is null or char_length(v_feat_url) > 500
       or v_feat_url !~ v_photo_url_re then
      raise exception 'INVALID_DISTINCTIVE_PHOTO_URL';
    end if;
  end loop;

  -- --- Constrained enums (null allowed; posts CHECK also enforces) ------------
  if p_stolen_from is not null
     and p_stolen_from not in ('driveway', 'street', 'car_park', 'other') then
    raise exception 'INVALID_STOLEN_FROM';
  end if;
  if p_keys_taken is not null
     and p_keys_taken not in ('yes', 'no', 'unknown') then
    raise exception 'INVALID_KEYS_TAKEN';
  end if;

  -- --- Atomic assembly (single transaction) -----------------------------------
  -- NOTE: alerts_sent_at is NOT in this column list. A new post is a DRAFT and
  -- has never been alerted; the notify-spotters claim sets it later, server-side.
  insert into public.posts (
    owner_id, plate, make, model, colour,
    year, body_type, distinguishing_features, owner_note,
    desc_recognise, desc_drives, stolen_from, keys_taken,
    last_seen_at, last_seen_location, last_seen_area, last_seen_locality,
    bounty_amount_pence, status, vehicle_id
  )
  values (
    v_owner, v_plate, p_make, p_model, p_colour,
    p_year, p_body_type, p_distinguishing_features, p_owner_note,
    p_desc_recognise, p_desc_drives, p_stolen_from, p_keys_taken,
    p_last_seen_at,
    ST_SetSRID(ST_MakePoint(p_last_seen_lng, p_last_seen_lat), 4326)::geography,
    p_last_seen_area,
    v_locality,
    -- ⚠️ expires_at IS NO LONGER STAMPED (review finding #18). It was set to
    -- +90 days and NOTHING has ever acted on it: passive expiry was cut
    -- deliberately, so the date never arrived and the listing never closed —
    -- while post detail counted down to it. Liveness is now a question the
    -- owner is ASKED (ADR-0019), not a clock nobody set. The column stays for
    -- the rows that already carry a value; new posts leave it NULL, which is
    -- what "this listing does not expire" has always actually meant.
    p_bounty_amount_pence, 'draft', v_vehicle_id
  )
  returning id into v_post_id;

  insert into public.post_photos (post_id, url, position)
  select v_post_id, u.url, (u.ord - 1)::int
  from unnest(p_photo_urls) with ordinality as u(url, ord);

  if p_feature_keys is not null and array_length(p_feature_keys, 1) is not null then
    insert into public.post_feature (post_id, feature_key)
    select v_post_id, k
    from unnest(p_feature_keys) as k;
  end if;

  if p_verification_path is not null then
    insert into public.verification_documents (post_id, storage_path)
    values (v_post_id, p_verification_path);
  end if;

  -- Distinctive features: one row per array element, position = ordinality-1 so
  -- the stored order matches the order the wizard sent them (0-based). description
  -- is stored trimmed (the CHECK measures it trimmed; store the clean label).
  insert into public.post_distinctive_feature (post_id, photo_url, description, position)
  select v_post_id,
         elem.value ->> 'photo_url',
         btrim(elem.value ->> 'description'),
         (elem.ord - 1)::int
  from jsonb_array_elements(v_features) with ordinality as elem(value, ord);

  return jsonb_build_object('post_id', v_post_id, 'status', 'draft');
end;
$$;

comment on function public.create_post(
  -- ⚠️ 23 types now: p_vehicle_id is the trailing uuid. Postgres resolves
  -- comment/revoke/grant by EXACT signature, so a stale list here fails the
  -- migration with 42883 — which is the good outcome, and the reason the older
  -- migrations carry the same note.
  text, text, text, text, int, text, text, text, text, text, text, text,
  timestamptz, double precision, double precision, text, int, text[], text[], text, jsonb, text, uuid
) is
  'The write boundary for the post-a-car wizard. SECURITY DEFINER: pins owner_id to the caller, HARD-CODES status=draft, and atomically inserts the post + photos + feature tags + verification-doc row + distinctive features. Re-validates plate (optional/format/one-active-per-plate), 3-6 photos, own-folder photo/V5C paths, the stolen_from/keys_taken enums, and up to 8 distinctive features (each: 3-80-char trimmed description + own-folder photo URL). MONEY: p_bounty_amount_pence is OPTIONAL - NULL means a FREE LISTING paid for with a flat listing fee; a given bounty is re-validated at 1000-500000 pence. p_last_seen_locality is the COARSE district/city label the spotter-alert push reads. p_vehicle_id (20260902150000) records the GARAGE VEHICLE this post was made from, and is IGNORED unless the caller owns it - provenance only, never displayed; it arms delete_vehicle''s active-post guard and list_my_vehicles.is_currently_posted, both of which were dead while the column was never written. NO LONGER SETS expires_at (review finding #18): the +90d stamp was acted on by nothing, and liveness is now the ADR-0019 question rather than a clock. Never writes alerts_sent_at (service-role claim). Raises: NOT_AUTHENTICATED, INVALID_PLATE, PLATE_IN_USE, MISSING_REQUIRED, BOUNTY_OUT_OF_RANGE, PHOTO_COUNT, INVALID_PHOTO_URL, INVALID_VERIFICATION_PATH, DISTINCTIVE_FEATURES_COUNT, INVALID_DISTINCTIVE_FEATURE, INVALID_DISTINCTIVE_PHOTO_URL, INVALID_STOLEN_FROM, INVALID_KEYS_TAKEN. Only ever creates drafts; payment success advances the lifecycle later, server-side.';


-- =============================================================================
-- 3. Grants, restated for the new signature
-- =============================================================================
-- ⚠️ A DROP TAKES THE GRANTS WITH IT. The recreated function starts with
-- PostgreSQL's default EXECUTE-to-public, so restating these is not tidiness —
-- omitting the revoke would hand anon the post-creation boundary.
revoke execute on function public.create_post(
  text, text, text, text, int, text, text, text, text, text, text, text,
  timestamptz, double precision, double precision, text, int, text[], text[], text, jsonb, text, uuid
) from public, anon;
grant execute on function public.create_post(
  text, text, text, text, int, text, text, text, text, text, text, text,
  timestamptz, double precision, double precision, text, int, text[], text[], text, jsonb, text, uuid
) to authenticated;


-- =============================================================================
-- 4. The column comment catches up
-- =============================================================================
comment on column public.posts.expires_at is
  'DORMANT. Stamped at +90 days by create_post until 2026-09-02 and read for a DECISION by nothing, ever: passive expiry was cut deliberately (docs/DOMAIN.md - "every refund is a human act"), so the date never arrived. New posts leave it NULL; older rows keep the value they were given. Liveness is the ADR-0019 "is your car still missing?" question instead. Do not surface this to a user - a countdown to a date that never comes was review finding #18.';

comment on column public.posts.vehicle_id is
  'PROVENANCE ONLY: the garage vehicle this post was created from, or NULL. NOTHING reads it for display - the post stores its own snapshot of make/model/colour/year/body_type/plate plus its own post_photos and post_distinctive_feature rows. ON DELETE SET NULL guarantees that editing or deleting a garage vehicle can NEVER alter or break a historical post. WRITTEN BY create_post SINCE 2026-09-02 (20260902150000), and only after checking the caller owns the vehicle; before that it was NULL on every row, which left delete_vehicle''s active-post guard and list_my_vehicles.is_currently_posted dead. Excluded from every client column grant.';


-- =============================================================================
-- END OF MIGRATION
-- =============================================================================

-- =============================================================================
-- WHAT:  A car's colour can carry its paint FINISH — metallic, matte, pearl or
--        a two-tone roof — on a post and on a saved garage vehicle.
--          1. posts.colour_finish and vehicles.colour_finish (nullable, CHECKed).
--          2. The retired 'Brown / Beige' colour folds into 'Brown'.
--          3. create_post, update_post_car_details, add_vehicle and
--             update_vehicle take a trailing p_colour_finish text default null.
--          4. get_post_detail and list_my_vehicles return it.
-- WHY:   Owner decision 2026-10-12 (colour step, PR 2 of 3). "Blue" covers a
--        flat navy and a bright metallic; a spotter sees the finish before the
--        badge. It is OPTIONAL: NULL means "not said", never "solid".
--
--        The fold: the app's palette became the DVLA/V5C list on 2026-10-12
--        (#161), which splits Brown and Beige. The app already reads an old
--        'Brown / Beige' as Brown (LEGACY_COLOUR_ALIASES); this makes the
--        stored rows agree, so search and alert matching — lower(btrim(colour))
--        equality — find them under the name the app now sends. Production
--        holds test data only, so nothing real loses its beige.
--
-- CONTRACT for the new parameter: it is the WHOLE value, like every other
--        column these functions write. NULL (or omitted, or blank) stores NULL.
--        update_post_car_details and update_vehicle are full replaces, so a
--        call that omits it CLEARS a stored finish — the app sends it on every
--        save from PR 3 on. Before PR 3 no client can set one, so nothing is
--        lost in the gap.
--
--        Not tied to the colour on the server: the app hides the finish for
--        the two escape colours ("Multicolour / wrapped", "Other"), and the
--        server does not repeat that rule — it would hard-code client names.
--
-- THE BODIES are extracted MECHANICALLY from their latest definitions and
--        patched by anchor (each anchor asserted to hit exactly once), never
--        retyped. Diff each against its source; the ONLY differences are the
--        parameter, the v_finish declaration, the INVALID_COLOUR_FINISH check,
--        and the column in the insert/update/payload (plus `create or replace`
--        -> `create` where the function is dropped first):
--          create_post             — 20260902150000
--          update_post_car_details — 20260731110000
--          add_vehicle             — 20260801100000
--          update_vehicle          — 20260801100000
--          list_my_vehicles        — 20260801100000 (payload key only)
--          get_post_detail         — 20261006110000 (payload key only)
--        update_post is NOT touched: it is retired (no client calls it —
--        editSectionApi.ts) and keeps its old signature.
--
-- SAFETY NOTE ON DESTRUCTIVE STATEMENTS: ⚠️ FOUR FUNCTIONS ARE DROPPED and
--        recreated in this transaction, because a new parameter changes a
--        function's identity (`create or replace` would leave two overloads
--        and make every PostgREST named-argument call ambiguous, 42725). Each
--        drop names the exact signature and carries NO CASCADE, so a dependent
--        fails the migration rather than vanishing. A DROP TAKES THE GRANTS
--        AND COMMENT WITH IT — both are restated below for each function,
--        and the revoke from anon is the part that matters.
--        One data UPDATE per table (the fold), scoped to the retired name.
--        Columns are only ADDED.
-- PRIVACY: the finish is a public fact about a car, at the same visibility as
--        colour: get_post_detail's visible branch (not the owner-only block),
--        and the same anon/authenticated column grant posts.colour has.
-- MONEY: none.
-- LINKS: src/shared/lib/carColours.ts (the palette and LEGACY_COLOUR_ALIASES);
--        supabase/tests/colour_finish_verification.sql;
--        supabase/tests/post_vehicle_link_verification.sql (CHECK 8 now finds
--          create_post by name, so a new parameter no longer breaks it).
-- =============================================================================


-- =============================================================================
-- 1. The columns
-- =============================================================================
alter table public.posts
  add column colour_finish text
    constraint posts_colour_finish_chk
    check (colour_finish in ('metallic', 'matte', 'pearl', 'two_tone_roof'));

alter table public.vehicles
  add column colour_finish text
    constraint vehicles_colour_finish_chk
    check (colour_finish in ('metallic', 'matte', 'pearl', 'two_tone_roof'));

comment on column public.posts.colour_finish is
  'Optional paint finish beside colour: metallic | matte | pearl | two_tone_roof, or NULL for "not said" (never "solid"). Public at the same visibility as colour. Written by create_post and update_post_car_details (20261012100000).';
comment on column public.vehicles.colour_finish is
  'Optional paint finish beside colour: metallic | matte | pearl | two_tone_roof, or NULL for "not said". Written by add_vehicle / update_vehicle (20261012100000); copied into a post by the app when the owner posts from the garage.';

-- posts carries COLUMN-level select grants for the client roles
-- (20260810180000), so a new column is unreadable until named. Same audience
-- as posts.colour. vehicles has a table-level grant and needs nothing.
grant select (colour_finish) on public.posts to anon, authenticated;


-- =============================================================================
-- 2. The retired 'Brown / Beige' becomes 'Brown'
-- =============================================================================
-- Matched the way search and alerts match (lower + btrim), so a stray
-- spacing or casing of the old name folds too. alert_zones.colour is a
-- spotter's filter; leaving it would match nothing once posts say 'Brown'.
update public.posts       set colour = 'Brown' where lower(btrim(colour)) = 'brown / beige';
update public.vehicles    set colour = 'Brown' where lower(btrim(colour)) = 'brown / beige';
update public.alert_zones set colour = 'Brown' where lower(btrim(colour)) = 'brown / beige';


-- =============================================================================
-- 3. create_post — p_colour_finish (24 types)
-- =============================================================================
drop function public.create_post(
  text, text, text, text, int, text, text, text, text, text, text, text,
  timestamptz, double precision, double precision, text, int, text[], text[], text, jsonb, text, uuid
);

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
  p_vehicle_id              uuid default null,
  -- TRAILING and DEFAULTED for the same reason again (20261012100000).
  p_colour_finish           text default null
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
  v_finish      text := nullif(btrim(p_colour_finish), '');
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
    -- ⚠️ vehicles.USER_ID, not owner_id. posts uses owner_id and vehicles uses
    -- user_id, and a plpgsql body is not checked for column existence at
    -- CREATE time — so the wrong name here applies cleanly and then throws
    -- "column v.owner_id does not exist" at runtime, on every prefilled post.
    -- CI's db job caught exactly that on the first push of this migration.
    select v.id into v_vehicle_id
      from public.vehicles v
     where v.id = p_vehicle_id
       and v.user_id = v_owner;
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
  -- Optional paint finish (20261012100000). The column CHECK enforces the set
  -- too; raising here names the fault instead of a bare 23514.
  if v_finish is not null
     and v_finish not in ('metallic', 'matte', 'pearl', 'two_tone_roof') then
    raise exception 'INVALID_COLOUR_FINISH';
  end if;

  -- --- Atomic assembly (single transaction) -----------------------------------
  -- NOTE: alerts_sent_at is NOT in this column list. A new post is a DRAFT and
  -- has never been alerted; the notify-spotters claim sets it later, server-side.
  insert into public.posts (
    owner_id, plate, make, model, colour,
    year, body_type, distinguishing_features, owner_note,
    desc_recognise, desc_drives, stolen_from, keys_taken,
    last_seen_at, last_seen_location, last_seen_area, last_seen_locality,
    bounty_amount_pence, status, vehicle_id, colour_finish
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
    p_bounty_amount_pence, 'draft', v_vehicle_id, v_finish
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
  text, text, text, text, int, text, text, text, text, text, text, text,
  timestamptz, double precision, double precision, text, int, text[], text[], text, jsonb, text, uuid, text
) is
  'The write boundary for the post-a-car wizard. SECURITY DEFINER: pins owner_id to the caller, HARD-CODES status=draft, and atomically inserts the post + photos + feature tags + verification-doc row + distinctive features. Re-validates plate (optional/format/one-active-per-plate), 3-6 photos, own-folder photo/V5C paths, the stolen_from/keys_taken enums, and up to 8 distinctive features (each: 3-80-char trimmed description + own-folder photo URL). MONEY: p_bounty_amount_pence is OPTIONAL - NULL means a FREE LISTING paid for with a flat listing fee; a given bounty is re-validated at 1000-500000 pence. p_last_seen_locality is the COARSE district/city label the spotter-alert push reads. p_vehicle_id (20260902150000) records the GARAGE VEHICLE this post was made from, and is IGNORED unless the caller owns it - provenance only, never displayed; it arms delete_vehicle''s active-post guard and list_my_vehicles.is_currently_posted, both of which were dead while the column was never written. NO LONGER SETS expires_at (review finding #18): the +90d stamp was acted on by nothing, and liveness is now the ADR-0019 question rather than a clock. Never writes alerts_sent_at (service-role claim). Raises: NOT_AUTHENTICATED, INVALID_PLATE, PLATE_IN_USE, MISSING_REQUIRED, BOUNTY_OUT_OF_RANGE, PHOTO_COUNT, INVALID_PHOTO_URL, INVALID_VERIFICATION_PATH, DISTINCTIVE_FEATURES_COUNT, INVALID_DISTINCTIVE_FEATURE, INVALID_DISTINCTIVE_PHOTO_URL, INVALID_STOLEN_FROM, INVALID_KEYS_TAKEN. Only ever creates drafts; payment success advances the lifecycle later, server-side. p_colour_finish (20261012100000, trailing, default NULL): the optional paint finish - metallic, matte, pearl or two_tone_roof; NULL or blank stores NULL; anything else raises INVALID_COLOUR_FINISH.';

revoke execute on function public.create_post(
  text, text, text, text, int, text, text, text, text, text, text, text,
  timestamptz, double precision, double precision, text, int, text[], text[], text, jsonb, text, uuid, text
) from public, anon;
grant execute on function public.create_post(
  text, text, text, text, int, text, text, text, text, text, text, text,
  timestamptz, double precision, double precision, text, int, text[], text[], text, jsonb, text, uuid, text
) to authenticated;


-- =============================================================================
-- 4. update_post_car_details — p_colour_finish
-- =============================================================================
drop function public.update_post_car_details(uuid, text, text, text, text, int, text);

create function public.update_post_car_details(
  p_post_id    uuid,
  p_make       text,
  p_model      text,
  p_colour     text,
  p_owner_note text,
  p_year       int,
  p_body_type  text,
  p_colour_finish text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_owner uuid := auth.uid();
  v_post  public.posts%rowtype;
  v_finish text := nullif(btrim(p_colour_finish), '');
begin
  if v_owner is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  -- SAFETY: DRAFT + PENDING_VERIFICATION + ACTIVE gate. Safe on a LIVE post
  -- because the UPDATE below names only descriptive identity columns — never
  -- bounty/status/owner/expires, and never plate. Own + in-gate + locked, else
  -- POST_NOT_EDITABLE.
  select * into v_post
  from public.posts p
  where p.id = p_post_id
    and p.owner_id = v_owner
    and p.status = any(array['draft', 'pending_verification', 'active']::public.post_status[])
  for update;
  if not found then
    raise exception 'POST_NOT_EDITABLE';
  end if;

  -- Required identity (mirrors create_post's MISSING_REQUIRED for make/model/colour).
  -- Enforced on a live post too: a listing must never be edited into having no
  -- make/model/colour at all.
  if p_make is null or p_model is null or p_colour is null then
    raise exception 'MISSING_REQUIRED';
  end if;

  -- Optional paint finish (20261012100000). The column CHECK enforces the set
  -- too; raising here names the fault instead of a bare 23514.
  if v_finish is not null
     and v_finish not in ('metallic', 'matte', 'pearl', 'two_tone_roof') then
    raise exception 'INVALID_COLOUR_FINISH';
  end if;

  -- year is enforced by the posts_year_range_chk column CHECK (1900-2100), exactly
  -- as create_post enforces it — no explicit raise; the UPDATE rolls back if bad.
  update public.posts set
    make       = p_make,
    model      = p_model,
    colour     = p_colour,
    owner_note = p_owner_note,
    year       = p_year,
    body_type  = p_body_type,
    colour_finish = v_finish
  where id = p_post_id;

  return jsonb_build_object('post_id', p_post_id);
end;
$$;

comment on function public.update_post_car_details(uuid, text, text, text, text, int, text, text) is
  'Per-section edit of the car identity, allowed on an own DRAFT, PENDING_VERIFICATION or ACTIVE (live) post (else POST_NOT_EDITABLE): writes make/model/colour/owner_note/year/body_type ONLY. MISSING_REQUIRED if make/model/colour null; year bounded by the posts_year_range_chk column CHECK. Money-neutral — never writes status/owner_id/expires_at/bounty — and never writes PLATE, which stays immutable after posting. Also raises NOT_AUTHENTICATED. p_colour_finish (20261012100000, trailing, default NULL): the optional paint finish - metallic, matte, pearl or two_tone_roof; NULL or blank stores NULL; anything else raises INVALID_COLOUR_FINISH.';

revoke execute on function public.update_post_car_details(uuid, text, text, text, text, int, text, text) from public, anon;
grant  execute on function public.update_post_car_details(uuid, text, text, text, text, int, text, text) to authenticated, service_role;


-- =============================================================================
-- 5. add_vehicle — p_colour_finish
-- =============================================================================
drop function public.add_vehicle(text, text, text, text, text, int, text, text, text[], jsonb);

create function public.add_vehicle(
  p_plate                text,
  p_make                 text,
  p_model                text,
  p_colour               text,
  p_colour_note          text,
  p_year                 int,
  p_body_type            text,
  p_nickname             text,
  p_photo_urls           text[],
  p_distinctive_features jsonb default '[]'::jsonb,
  p_colour_finish        text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_owner        uuid := auth.uid();
  v_vehicle_id   uuid;
  v_plate        text;
  v_plate_canon  text;
  v_nickname     text;
  v_photo_count  int  := coalesce(array_length(p_photo_urls, 1), 0);
  v_url          text;
  -- IDENTICAL own-folder regex to create_post: our Storage host, the post-photos
  -- bucket, and a single path segment under the CALLER's own uuid folder.
  v_photo_url_re text := '^https?://(127\.0\.0\.1(:[0-9]+)?|[a-z0-9-]+\.supabase\.co)'
                         || '/storage/v1/object/public/post-photos/'
                         || v_owner::text || '/[^/]+$';
  v_features     jsonb := coalesce(p_distinctive_features, '[]'::jsonb);
  v_feature      jsonb;
  v_feat_desc    text;
  v_feat_url     text;
  -- The garage cap. Small on purpose: the garage is a convenience for the cars
  -- you actually own, not a fleet register. It also bounds the blast radius of
  -- an automated abuse loop hammering add_vehicle.
  v_vehicle_cap  int  := 5;
  v_finish       text := nullif(btrim(p_colour_finish), '');
begin
  if v_owner is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  -- --- Required fields (make/model/colour are the identity, plate or not) ------
  if p_make is null or p_model is null or p_colour is null then
    raise exception 'MISSING_REQUIRED';
  end if;

  -- Optional paint finish (20261012100000). The column CHECK enforces the set
  -- too; raising here names the fault instead of a bare 23514.
  if v_finish is not null
     and v_finish not in ('metallic', 'matte', 'pearl', 'two_tone_roof') then
    raise exception 'INVALID_COLOUR_FINISH';
  end if;

  -- --- Garage cap -------------------------------------------------------------
  -- SAFETY: counts the CALLER's rows only (v_owner), so the count can never be a
  -- signal about anyone else's garage.
  if (select count(*) from public.vehicles v where v.user_id = v_owner) >= v_vehicle_cap then
    raise exception 'VEHICLE_LIMIT_REACHED';
  end if;

  -- --- OPTIONAL PLATE: canon first; a plate that strips to nothing is NULL -----
  -- Byte-for-byte create_post's rule (20260713195000): a blank, punctuation-only
  -- or non-ASCII-homoglyph "plate" is NOT a plate and is stored as NULL.
  v_plate_canon := upper(regexp_replace(coalesce(p_plate, ''), '[^A-Za-z0-9]', '', 'g'));
  v_plate := case when v_plate_canon = '' then null
                  else upper(trim(coalesce(p_plate, ''))) end;

  if v_plate_canon <> '' then
    -- Same format gate as create_post, so a saved plate can always be posted.
    if v_plate_canon !~ '^[A-Z0-9]{2,8}$' then
      raise exception 'INVALID_PLATE';
    end if;
    -- Bound the STORED (raw, upper+trimmed) form too: the canon gate above caps
    -- the alphanumerics at 8 but says nothing about padding punctuation, and the
    -- vehicles_plate_len_chk CHECK would otherwise surface as a raw constraint
    -- violation instead of a mapped code.
    if char_length(v_plate) > 15 then
      raise exception 'INVALID_PLATE';
    end if;
    -- SAFETY: PER-USER dedupe only (see vehicles_user_plate_canon_uidx). The
    -- unique index is the real enforcement; this is the friendly, mapped error.
    if exists (
      select 1
      from public.vehicles v
      where v.user_id = v_owner
        and upper(regexp_replace(coalesce(v.plate, ''), '[^A-Za-z0-9]', '', 'g')) = v_plate_canon
    ) then
      raise exception 'PLATE_ALREADY_SAVED';
    end if;
  end if;

  -- --- Nickname: trimmed; an empty box is NULL, not '' ------------------------
  -- Length is enforced by vehicles_nickname_len_chk (the same no-explicit-raise
  -- treatment update_post_car_details gives year).
  v_nickname := nullif(btrim(coalesce(p_nickname, '')), '');

  -- --- Photos: OPTIONAL here (0..6). See the divergence note above. -----------
  if v_photo_count > 6 then
    raise exception 'PHOTO_COUNT';
  end if;

  -- --- SAFETY: photo URLs must be our own-folder post-photos objects ----------
  if v_photo_count > 0 then
    foreach v_url in array p_photo_urls loop
      if v_url is null or char_length(v_url) > 500 or v_url !~ v_photo_url_re then
        raise exception 'INVALID_PHOTO_URL';
      end if;
    end loop;
  end if;

  -- --- Distinctive features: create_post's validation, verbatim ---------------
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

  -- --- Atomic assembly (single transaction) -----------------------------------
  -- SAFETY: user_id pinned to the caller; verification_state deliberately absent
  -- from this INSERT so it takes its 'unverified' default.
  insert into public.vehicles (
    user_id, plate, make, model, colour, colour_note, year, body_type, nickname, colour_finish
  )
  values (
    v_owner, v_plate, p_make, p_model, p_colour, nullif(btrim(p_colour_note), ''),
    p_year, p_body_type, v_nickname, v_finish
  )
  returning id into v_vehicle_id;

  if v_photo_count > 0 then
    insert into public.vehicle_photos (vehicle_id, url, position)
    select v_vehicle_id, u.url, (u.ord - 1)::int
    from unnest(p_photo_urls) with ordinality as u(url, ord);
  end if;

  -- position = ordinality-1 so stored order matches the order the client sent;
  -- description stored TRIMMED (the CHECK measures it trimmed — store it clean).
  insert into public.vehicle_distinctive_feature (vehicle_id, photo_url, description, position)
  select v_vehicle_id,
         elem.value ->> 'photo_url',
         btrim(elem.value ->> 'description'),
         (elem.ord - 1)::int
  from jsonb_array_elements(v_features) with ordinality as elem(value, ord);

  return jsonb_build_object('vehicle_id', v_vehicle_id);
end;
$$;

comment on function public.add_vehicle(text, text, text, text, text, int, text, text, text[], jsonb, text) is
  'The write boundary for saving a car to the garage. SECURITY DEFINER: pins user_id to the caller, leaves verification_state on its dormant ''unverified'' default, and atomically inserts the vehicle + photos + distinctive features. Re-validates make/model/colour (MISSING_REQUIRED), the 5-vehicle cap (VEHICLE_LIMIT_REACHED), the OPTIONAL plate''s format (INVALID_PLATE, same canon+^[A-Z0-9]{2,8}$ gate as create_post) and PER-USER uniqueness (PLATE_ALREADY_SAVED — deliberately not global; see the unique index comment), 0-6 photos (PHOTO_COUNT — photos are OPTIONAL here, unlike create_post''s 3-6 posting minimum), own-folder photo URLs (INVALID_PHOTO_URL), and up to 8 distinctive features (DISTINCTIVE_FEATURES_COUNT / INVALID_DISTINCTIVE_FEATURE / INVALID_DISTINCTIVE_PHOTO_URL). Also raises NOT_AUTHENTICATED. Returns {"vehicle_id": uuid}. p_colour_finish (20261012100000, trailing, default NULL): the optional paint finish - metallic, matte, pearl or two_tone_roof; NULL or blank stores NULL; anything else raises INVALID_COLOUR_FINISH.';

revoke execute on function public.add_vehicle(text, text, text, text, text, int, text, text, text[], jsonb, text) from public, anon;
grant  execute on function public.add_vehicle(text, text, text, text, text, int, text, text, text[], jsonb, text) to authenticated, service_role;


-- =============================================================================
-- 6. update_vehicle — p_colour_finish
-- =============================================================================
drop function public.update_vehicle(uuid, text, text, text, text, text, int, text, text, text[], jsonb);

create function public.update_vehicle(
  p_vehicle_id           uuid,
  p_plate                text,
  p_make                 text,
  p_model                text,
  p_colour               text,
  p_colour_note          text,
  p_year                 int,
  p_body_type            text,
  p_nickname             text,
  p_photo_urls           text[],
  p_distinctive_features jsonb default '[]'::jsonb,
  p_colour_finish        text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_owner        uuid := auth.uid();
  v_vehicle      public.vehicles%rowtype;
  v_plate        text;
  v_plate_canon  text;
  v_nickname     text;
  v_photo_count  int  := coalesce(array_length(p_photo_urls, 1), 0);
  v_url          text;
  v_photo_url_re text := '^https?://(127\.0\.0\.1(:[0-9]+)?|[a-z0-9-]+\.supabase\.co)'
                         || '/storage/v1/object/public/post-photos/'
                         || v_owner::text || '/[^/]+$';
  v_features     jsonb := coalesce(p_distinctive_features, '[]'::jsonb);
  v_feature      jsonb;
  v_feat_desc    text;
  v_feat_url     text;
  v_finish       text := nullif(btrim(p_colour_finish), '');
begin
  if v_owner is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  -- SAFETY: own + locked, else ONE opaque code. Absent and not-yours are
  -- indistinguishable to the caller by design.
  select * into v_vehicle
  from public.vehicles v
  where v.id = p_vehicle_id
    and v.user_id = v_owner
  for update;
  if not found then
    raise exception 'VEHICLE_NOT_FOUND';
  end if;

  -- --- Required identity (same rule as add_vehicle / create_post) -------------
  if p_make is null or p_model is null or p_colour is null then
    raise exception 'MISSING_REQUIRED';
  end if;

  -- Optional paint finish (20261012100000). The column CHECK enforces the set
  -- too; raising here names the fault instead of a bare 23514.
  if v_finish is not null
     and v_finish not in ('metallic', 'matte', 'pearl', 'two_tone_roof') then
    raise exception 'INVALID_COLOUR_FINISH';
  end if;

  -- --- OPTIONAL PLATE: identical canon + gates to add_vehicle -----------------
  v_plate_canon := upper(regexp_replace(coalesce(p_plate, ''), '[^A-Za-z0-9]', '', 'g'));
  v_plate := case when v_plate_canon = '' then null
                  else upper(trim(coalesce(p_plate, ''))) end;

  if v_plate_canon <> '' then
    if v_plate_canon !~ '^[A-Z0-9]{2,8}$' then
      raise exception 'INVALID_PLATE';
    end if;
    if char_length(v_plate) > 15 then
      raise exception 'INVALID_PLATE';
    end if;
    -- PER-USER dedupe, EXCLUDING this row (re-saving the same plate on the same
    -- vehicle is a no-op, not a clash).
    if exists (
      select 1
      from public.vehicles v
      where v.user_id = v_owner
        and v.id <> p_vehicle_id
        and upper(regexp_replace(coalesce(v.plate, ''), '[^A-Za-z0-9]', '', 'g')) = v_plate_canon
    ) then
      raise exception 'PLATE_ALREADY_SAVED';
    end if;
  end if;

  v_nickname := nullif(btrim(coalesce(p_nickname, '')), '');

  -- --- Photos: OPTIONAL (0..6), own-folder only -------------------------------
  if v_photo_count > 6 then
    raise exception 'PHOTO_COUNT';
  end if;
  if v_photo_count > 0 then
    foreach v_url in array p_photo_urls loop
      if v_url is null or char_length(v_url) > 500 or v_url !~ v_photo_url_re then
        raise exception 'INVALID_PHOTO_URL';
      end if;
    end loop;
  end if;

  -- --- Distinctive features: create_post's validation, verbatim ---------------
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

  -- --- Apply (one transaction) ------------------------------------------------
  -- SAFETY: the column list names ONLY the editable descriptive fields.
  -- user_id, verification_state, id and created_at are absent and unwritable here.
  update public.vehicles set
    plate       = v_plate,
    make        = p_make,
    model       = p_model,
    colour      = p_colour,
    colour_note = nullif(btrim(p_colour_note), ''),
    colour_finish = v_finish,
    year       = p_year,
    body_type  = p_body_type,
    nickname   = v_nickname,
    updated_at = now()
  where id = p_vehicle_id;

  -- Full replace of the child rows, SCOPED to this vehicle (never a post's rows).
  delete from public.vehicle_photos where vehicle_id = p_vehicle_id;
  if v_photo_count > 0 then
    insert into public.vehicle_photos (vehicle_id, url, position)
    select p_vehicle_id, u.url, (u.ord - 1)::int
    from unnest(p_photo_urls) with ordinality as u(url, ord);
  end if;

  delete from public.vehicle_distinctive_feature where vehicle_id = p_vehicle_id;
  insert into public.vehicle_distinctive_feature (vehicle_id, photo_url, description, position)
  select p_vehicle_id,
         elem.value ->> 'photo_url',
         btrim(elem.value ->> 'description'),
         (elem.ord - 1)::int
  from jsonb_array_elements(v_features) with ordinality as elem(value, ord);

  return jsonb_build_object('vehicle_id', p_vehicle_id);
end;
$$;

comment on function public.update_vehicle(uuid, text, text, text, text, text, int, text, text, text[], jsonb, text) is
  'Full-replace edit of one OWN garage vehicle. SECURITY DEFINER, owner-pinned (user_id = auth.uid()) and FOR UPDATE locked; absent-or-not-yours is one opaque VEHICLE_NOT_FOUND (no existence oracle). Writes only the descriptive columns + updated_at — never user_id, verification_state, id or created_at — and full-replaces vehicle_photos / vehicle_distinctive_feature SCOPED to this vehicle. Same validation and raise codes as add_vehicle (MISSING_REQUIRED, INVALID_PLATE, PLATE_ALREADY_SAVED [per-user, excluding self], PHOTO_COUNT 0-6, INVALID_PHOTO_URL, DISTINCTIVE_FEATURES_COUNT, INVALID_DISTINCTIVE_FEATURE, INVALID_DISTINCTIVE_PHOTO_URL, NOT_AUTHENTICATED). Cannot alter any post: posts hold their own snapshot. p_colour_finish (20261012100000, trailing, default NULL): the optional paint finish - metallic, matte, pearl or two_tone_roof; NULL or blank stores NULL; anything else raises INVALID_COLOUR_FINISH.';

revoke execute on function public.update_vehicle(uuid, text, text, text, text, text, int, text, text, text[], jsonb, text) from public, anon;
grant  execute on function public.update_vehicle(uuid, text, text, text, text, text, int, text, text, text[], jsonb, text) to authenticated, service_role;


-- =============================================================================
-- 7. The readers — same signatures, so `create or replace` keeps their grants
-- =============================================================================
-- list_my_vehicles: 'colour_finish' beside 'colour_note'.
create or replace function public.list_my_vehicles()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_viewer uuid := auth.uid();
  v_result jsonb;
begin
  -- SAFETY: no caller identity -> nothing. Never fall through to "all rows".
  if v_viewer is null then
    return '[]'::jsonb;
  end if;

  select coalesce(jsonb_agg(t.item order by t.created_at desc), '[]'::jsonb)
    into v_result
  from (
    select
      v.created_at,
      jsonb_build_object(
        'id',                 v.id,
        'plate',              v.plate,
        'make',               v.make,
        'model',              v.model,
        'colour',             v.colour,
        'colour_note',        v.colour_note,
        'colour_finish',      v.colour_finish,
        'year',               v.year,
        'body_type',          v.body_type,
        'nickname',           v.nickname,
        -- Dormant today (always 'unverified') — surfaced so the client shape is
        -- already correct if per-vehicle verification is ever re-introduced.
        'verification_state', v.verification_state,
        'created_at',         v.created_at,
        'updated_at',         v.updated_at,

        'photos', coalesce(
          (select jsonb_agg(
                    jsonb_build_object('url', ph.url, 'position', ph.position)
                    order by ph.position)
             from public.vehicle_photos ph
            where ph.vehicle_id = v.id),
          '[]'::jsonb),

        'distinctive_features', coalesce(
          (select jsonb_agg(
                    jsonb_build_object(
                      'photo_url',   df.photo_url,
                      'description', df.description,
                      'position',    df.position)
                    order by df.position)
             from public.vehicle_distinctive_feature df
            where df.vehicle_id = v.id),
          '[]'::jsonb),

        -- Open-listing flags. Same status set as delete_vehicle's guard, so the
        -- UI can grey out "delete" for exactly the vehicles that would refuse.
        -- If somehow more than one open post points here, take the newest.
        'is_currently_posted', (op.id is not null),
        'active_post_id',      op.id
      ) as item
    from public.vehicles v
    left join lateral (
      select p.id
      from public.posts p
      where p.vehicle_id = v.id
        and p.status = any(array['active', 'pending_verification', 'recovery_claimed']::public.post_status[])
      order by p.created_at desc
      limit 1
    ) op on true
    where v.user_id = v_viewer   -- SAFETY: caller's OWN vehicles ONLY.
  ) t;

  return v_result;
end;
$$;

-- get_post_detail: 'colour_finish' in the VISIBLE branch beside body_type —
-- public like colour, so not in the owner-only merge block.
create or replace function public.get_post_detail(p_post_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_viewer  uuid := auth.uid();
  v_post    public.posts%rowtype;
  v_visible boolean;
  -- Owner block — first_name + member-since ONLY. Never avatar_path (embeds
  -- owner_id), never display_name (surname), never owner_id.
  v_owner_first text;
  v_owner_since timestamptz;
  -- SAFETY: true when the last-seen point must be blurred for this caller —
  -- i.e. a driveway theft (point == victim's HOME) viewed by a non-owner.
  v_coarsen boolean;
begin
  select * into v_post from public.posts p where p.id = p_post_id;
  if not found then
    return jsonb_build_object('found', false);
  end if;

  -- SAFETY: the ONLY visibility gate (RLS is bypassed here).
  v_visible := (v_post.status = 'active')
               or (v_viewer is not null and v_post.owner_id = v_viewer);

  if not v_visible then
    return jsonb_build_object(
      'found', true,
      'visible', false,
      'closedReason',
        case
          when v_post.status in ('recovered', 'recovered_no_spotter')
            then 'recovered'
          else 'unavailable'
        end
    );
  end if;

  select p.first_name, p.created_at
    into v_owner_first, v_owner_since
    from public.profiles p
   where p.id = v_post.owner_id;

  -- SAFETY — home-address coarsening: stolen_from='driveway' means the last-seen
  -- point is the victim's HOME, so it must not be pinpointed to non-owners. The
  -- OWNER always gets the exact point; a non-owner gets the exact point for
  -- non-driveway thefts and a ~1km grid-snapped point for driveway thefts. Snap
  -- reuses the recovered-post idiom ST_SnapToGrid(location::geometry, 0.01).
  v_coarsen := (v_post.stolen_from = 'driveway')
               and not coalesce(v_post.owner_id = v_viewer, false);

  return public.home_feed_post_json(v_post, null::numeric)
    || jsonb_build_object(
         'found',    true,
         'visible',  true,
         'is_owner', coalesce(v_post.owner_id = v_viewer, false),

         'year',                    v_post.year,
         'body_type',               v_post.body_type,
         'colour_finish',           v_post.colour_finish,
         'distinguishing_features', v_post.distinguishing_features,
         'owner_note',              v_post.owner_note,
         'expires_at',              v_post.expires_at,

         -- Part-2 structured fields (visible branch only).
         'stolen_from',    v_post.stolen_from,
         'keys_taken',     v_post.keys_taken,
         'desc_recognise', v_post.desc_recognise,
         'desc_drives',    v_post.desc_drives,

         -- Feature chips: [{key,label,icon}], ordered by the taxonomy sort_order.
         -- [] when the post has no tags.
         'features', coalesce(
           (select jsonb_agg(
                     jsonb_build_object('key', vf.key, 'label', vf.label, 'icon', vf.icon)
                     order by vf.sort_order)
              from public.post_feature pf
              join public.vehicle_feature vf on vf.key = pf.feature_key
             where pf.post_id = v_post.id),
           '[]'::jsonb),

         -- SAFETY: exact coords for the owner and for non-driveway thefts; a
         -- ~1km grid-snapped point for a driveway theft shown to a non-owner (so
         -- the victim's home is never pinpointed). ST_Y = latitude, ST_X = lng.
         'lat', case
                  when v_post.last_seen_location is null then null
                  when v_coarsen
                    then ST_Y(ST_SnapToGrid(v_post.last_seen_location::geometry, 0.01))
                  else ST_Y(v_post.last_seen_location::geometry)
                end,
         'lng', case
                  when v_post.last_seen_location is null then null
                  when v_coarsen
                    then ST_X(ST_SnapToGrid(v_post.last_seen_location::geometry, 0.01))
                  else ST_X(v_post.last_seen_location::geometry)
                end,

         'photos', coalesce(
           (select jsonb_agg(
                     jsonb_build_object('url', ph.url, 'position', ph.position)
                     order by ph.position)
              from public.post_photos ph
             where ph.post_id = v_post.id),
           '[]'::jsonb),

         -- Distinctive features: [{id, photo_url, description}], the
         -- owner-authored photo+description evidence marks, ordered by position;
         -- [] when none.
         -- SAFETY (visibility — mirrors 'photos' / post_photos exactly): this is
         -- built INSIDE the visible branch, reached only after the active-OR-owner
         -- v_visible gate above — the SAME predicate gating 'photos' and the SAME
         -- one enforced by post_distinctive_feature's RLS SELECT policies
         -- (select_active_public + select_own). Owner sees their marks in any
         -- status; the public sees them only on an active post; never in the
         -- hidden/closed stub. These are CAR photos, so they are NOT coarsened
         -- (coarsening applies only to the driveway last_seen point). 'id' (NEW,
         -- 20260801150000) is the opaque row uuid the report-sighting wizard
         -- submits back as confirmed_feature_ids — same visibility as the
         -- feature itself, no extra data.
         'distinctive_features', coalesce(
           (select jsonb_agg(
                     jsonb_build_object(
                       'id',          df.id,
                       'photo_url',   df.photo_url,
                       'description', df.description)
                     order by df.position)
              from public.post_distinctive_feature df
             where df.post_id = v_post.id),
           '[]'::jsonb),

         -- SAFETY: first_name to signed-in only; member_since coarsened to the
         -- month, to all. NO owner_id-bearing avatar path, NO display_name.
         'owner', jsonb_build_object(
           'member_since', date_trunc('month', v_owner_since),
           'first_name',   case when v_viewer is not null then v_owner_first end
         ),

         -- REAL sighting aggregate (was the dormant {0, null} placeholder).
         -- SAFETY: a SCALAR count + latest timestamp only — never rows, never
         -- locations, never spotter identity (those are owner-only via
         -- get_post_sightings). count(*) over zero rows is 0 and max() is null,
         -- so pre-sighting posts keep the exact previous shape.
         'sighting_stats', (
           select jsonb_build_object(
                    'count',     count(*),
                    'latest_at', max(sg.created_at))
           from public.sightings sg
           where sg.post_id = v_post.id),

         -- Whether the CALLER already has a sighting on this post — gates the
         -- post-detail "Message the owner" affordance (chat is sighting-gated;
         -- DOMAIN.md Chat: "No cold DMs"). true -> the client may open a thread;
         -- false -> route the viewer to report a sighting first.
         -- SAFETY (SECURITY_AND_TRUST §1/§6): scoped to spotter_id = v_viewer, so
         -- it reveals ONLY the caller's OWN state (which they already know) — no
         -- other user's data, no count of others. Distinct from sighting_stats.
         -- anon (v_viewer null) -> false; the post's owner -> always false
         -- (own-post sightings are blocked by create_sighting's OWN_POST gate).
         'viewer_has_sighting', (v_viewer is not null and exists (
           select 1 from public.sightings s
           where s.post_id = v_post.id and s.spotter_id = v_viewer))
       )
    -- SAFETY (20260802110000) — OWNER-ONLY, ABSENT FOR EVERYONE ELSE: the coarse
    -- locality exists so the owner's own draft-edit round-trip doesn't blank it.
    -- Merged as a whole object so a non-owner's payload does not even carry the
    -- KEY. Never widen this to the public branch; nothing public needs it and
    -- the spotter-alert matcher reads the column server-side.
    || case
         when coalesce(v_post.owner_id = v_viewer, false)
           then jsonb_build_object(
             'last_seen_locality', v_post.last_seen_locality,
             -- NEW 2026-08-16 — see this migration's header.
             'recovered_at',       v_post.recovered_at,
             'closed_at',          v_post.closed_at,
             'alerts_sent_at',     v_post.alerts_sent_at,
             -- NEW 2026-10-06 — whether this listing PAID the £5 fee, from the
             -- ledger (20261006110000). The owner's fee sentences rest on it.
             'has_listing_fee',    exists (select 1 from public.payments f
                                            where f.post_id = v_post.id
                                              and f.kind = 'listing_fee'
                                              and f.status in ('collected', 'held')))
         else '{}'::jsonb
       end;
end;
$$;


-- =============================================================================
-- END OF MIGRATION
-- =============================================================================

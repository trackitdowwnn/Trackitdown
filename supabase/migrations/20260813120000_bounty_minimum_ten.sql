-- =============================================================================
-- WHAT: The bounty floor moves £50 -> £10. One migration, because the floor is
--       stated in SEVEN places that must never disagree:
--         1. posts.bounty_amount_pence's CHECK      (the authority)
--         2. alert_zones.min_bounty_pence's CHECK   (mirrors it, byte for byte)
--         3. create_post's own guard                (BOUNTY_OUT_OF_RANGE)
--         4. update_post's guard                    (draft edit, same code)
--         5. update_post_bounty's guard             (per-section draft edit)
--         6. create_my_alert / update_my_alert      (INVALID_INPUT)
--         7. get_bounty_guidance's reach curve      (a new £10 rung)
--
-- WHY:  Asked for by the product owner (2026-08-13). The £5,000 ceiling is a
--       fraud control from DOMAIN.md and is UNCHANGED here. The floor never was
--       one: it only ever encoded "below this, a bounty isn't worth a spotter's
--       trip", and setting that price on behalf of someone whose car has just
--       been taken is not this platform's call. Anyone who can only offer £10
--       could previously not post at all.
--
--       THE FIVE FUNCTIONS ARE RE-CREATED VERBATIM apart from the one numeric
--       literal in each. They are copied from their current definitions
--       (20260802110000 create_post, 20260727110000 update_post, 20260727130000
--       update_post_bounty, 20260802150000 create_my_alert / update_my_alert)
--       rather than rewritten, because a hand-retyped 200-line SECURITY DEFINER
--       body is how a safety check goes missing. Diff them against those files:
--       the ONLY change is 5000 -> 1000.
--
--       WHY ALERT ZONES MOVE TOO. min_bounty_pence is a spotter's "only tell me
--       about posts worth at least £X" filter, and the alert slider's lowest
--       stop means "any" precisely BECAUSE it equals the post floor. Left at
--       £50 while posts start at £10, that slider would have had no honest
--       position at all: its floor would still have meant "any" (so a spotter
--       asking for £50 would quietly have been sent £10 posts), and £50 would
--       have become inexpressible. The client constant moved with this CHECK.
--
-- SAFETY: WIDENING ONLY. Every value that satisfied the old CHECK satisfies the
--   new one, so no existing row, escrow or alert can be invalidated by this
--   migration, and it needs no data backfill. Nothing here touches escrow,
--   status, ownership or the 5% split. The ceiling, the draft-only gates, the
--   SECURITY DEFINER search_paths, the caller pinning and every grant are
--   carried across unchanged.
--
-- ⚠️ NOT A PRICE RECOMMENDATION. Lowering what is ALLOWED is not advice about
--   what to set, and no copy anywhere suggests £10 is a sensible bounty. The
--   recommendation engine (bountyRecommendation.ts) is untouched, and the
--   floor-bounty sheet still states reach and only reach.
--
-- LINKS: src/features/vehicles/post/lib/bountyBounds.ts (the client mirror);
--        supabase/migrations/20260707110712_payments_foundation.sql:177
--          (the CHECK this replaces);
--        supabase/migrations/20260813100000_bounty_guidance.sql (the curve);
--        supabase/tests/create_post_verification.sql (CHECK 3 — the boundary).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. posts.bounty_amount_pence — the authority.
--
-- The original constraint was declared inline and so carries a system-generated
-- name. It is looked up by DEFINITION rather than assumed, because a name that
-- differs by one character between the local reset and the deployed project
-- would otherwise fail this migration halfway through.
-- -----------------------------------------------------------------------------
do $$
declare
  v_name text;
begin
  select conname into v_name
  from pg_constraint
  where conrelid = 'public.posts'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%bounty_amount_pence%';

  if v_name is null then
    raise exception 'No CHECK found on posts.bounty_amount_pence — refusing to '
                    'add a second one on top of an unknown state';
  end if;

  execute format('alter table public.posts drop constraint %I', v_name);
end $$;

-- Named explicitly this time, so the next migration to touch it can say so.
alter table public.posts
  add constraint posts_bounty_amount_pence_check
  check (bounty_amount_pence between 1000 and 500000);

-- -----------------------------------------------------------------------------
-- 2. alert_zones.min_bounty_pence — the mirror. See the banner for why a
--    spotter's filter floor has to move with the post floor rather than stay
--    put; the constraint here was named, so it is dropped by name.
-- -----------------------------------------------------------------------------
alter table public.alert_zones
  drop constraint if exists alert_zones_min_bounty_chk;

alter table public.alert_zones
  add constraint alert_zones_min_bounty_chk
  check (min_bounty_pence between 1000 and 500000);

-- ---------------------------------------------------------------------------
-- 3. create_post — verbatim from 20260802110000 but for the guard.
-- ---------------------------------------------------------------------------
create or replace function public.create_post(
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
  p_last_seen_locality      text default null
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
begin
  if v_owner is null then
    raise exception 'NOT_AUTHENTICATED';
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
     or p_bounty_amount_pence is null then
    raise exception 'MISSING_REQUIRED';
  end if;

  -- --- MONEY: bounty range ----------------------------------------------------
  if p_bounty_amount_pence < 1000 or p_bounty_amount_pence > 500000 then
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
    bounty_amount_pence, status, expires_at
  )
  values (
    v_owner, v_plate, p_make, p_model, p_colour,
    p_year, p_body_type, p_distinguishing_features, p_owner_note,
    p_desc_recognise, p_desc_drives, p_stolen_from, p_keys_taken,
    p_last_seen_at,
    ST_SetSRID(ST_MakePoint(p_last_seen_lng, p_last_seen_lat), 4326)::geography,
    p_last_seen_area,
    v_locality,
    p_bounty_amount_pence, 'draft', now() + interval '90 days'
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
  -- NOTE the trailing `text`: p_last_seen_locality is the LAST parameter, not
  -- mid-list beside p_last_seen_area (see the banner). Postgres resolves
  -- comment/revoke/grant by exact signature, so this list must track the
  -- definition — a stale copy here fails the migration with 42883.
  text, text, text, text, int, text, text, text, text, text, text, text,
  timestamptz, double precision, double precision, text, int, text[], text[], text, jsonb, text
) is
  'The write boundary for the post-a-car wizard. SECURITY DEFINER: pins owner_id to the caller, HARD-CODES status=draft, sets expires_at=now()+90d, and atomically inserts the post + photos + feature tags + verification-doc row + distinctive features. Re-validates plate (optional/format/one-active-per-plate), bounty £10–£5000, 3–6 photos, own-folder photo/V5C paths, the stolen_from/keys_taken enums, and up to 8 distinctive features (each: 3–80-char trimmed description + own-folder photo URL). p_last_seen_locality (20260802110000) is the COARSE district/city label the spotter-alert push reads — trimmed, empty -> null, bounded by the posts_last_seen_locality_len CHECK; it is deliberately separate from p_last_seen_area, which can be street-grain and must never reach a push. Never writes alerts_sent_at (service-role claim). Raises: NOT_AUTHENTICATED, INVALID_PLATE, PLATE_IN_USE, MISSING_REQUIRED, BOUNTY_OUT_OF_RANGE, PHOTO_COUNT, INVALID_PHOTO_URL, INVALID_VERIFICATION_PATH, DISTINCTIVE_FEATURES_COUNT, INVALID_DISTINCTIVE_FEATURE, INVALID_DISTINCTIVE_PHOTO_URL, INVALID_STOLEN_FROM, INVALID_KEYS_TAKEN. Only ever creates drafts; escrow success advances the lifecycle later, server-side.';

-- ---------------------------------------------------------------------------
-- 4. update_post — verbatim from 20260727110000 but for the guard.
-- ---------------------------------------------------------------------------
create or replace function public.update_post(
  p_post_id                 uuid,
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
  p_distinctive_features    jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_owner       uuid := auth.uid();
  v_post        public.posts%rowtype;
  v_plate       text;
  v_plate_canon text;
  v_photo_count int  := coalesce(array_length(p_photo_urls, 1), 0);
  v_url         text;
  v_photo_url_re text := '^https?://(127\.0\.0\.1(:[0-9]+)?|[a-z0-9-]+\.supabase\.co)'
                         || '/storage/v1/object/public/post-photos/'
                         || v_owner::text || '/[^/]+$';
  -- Distinctive-feature validation scratch vars (mirror create_post).
  v_features    jsonb := coalesce(p_distinctive_features, '[]'::jsonb);
  v_feature     jsonb;
  v_feat_desc   text;
  v_feat_url    text;
begin
  if v_owner is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  -- --- DRAFT-ONLY HARD GATE (new POST_NOT_EDITABLE code) ----------------------
  -- Lock the target row so a concurrent Post & pay transition (draft ->
  -- pending_verification) cannot interleave. The post must exist, be the caller's,
  -- AND still be a draft. Any other case (missing / not yours / already paid /
  -- active / closed) is POST_NOT_EDITABLE — a single code mirroring the
  -- posts_update_own_draft RLS rule and the status-server-only invariant.
  select * into v_post
  from public.posts p
  where p.id = p_post_id
    and p.owner_id = v_owner
    and p.status = 'draft'
  for update;
  if not found then
    raise exception 'POST_NOT_EDITABLE';
  end if;

  -- --- OPTIONAL PLATE: canon first; a plate that strips to nothing is NULL -----
  v_plate_canon := upper(regexp_replace(coalesce(p_plate, ''), '[^A-Za-z0-9]', '', 'g'));
  v_plate := case when v_plate_canon = '' then null
                  else upper(trim(coalesce(p_plate, ''))) end;

  -- Format + uniqueness gates apply ONLY when a real plate was provided.
  if v_plate_canon <> '' then
    if v_plate_canon !~ '^[A-Z0-9]{2,8}$' then
      raise exception 'INVALID_PLATE';
    end if;

    -- SAFETY: one-active-post-per-plate (SECURITY_AND_TRUST §2), but EXCLUDE the
    -- post being edited (id <> p_post_id) so re-saving an unchanged plate on this
    -- same draft is not flagged as a collision with itself.
    if exists (
      select 1
      from public.posts p
      where p.id <> p_post_id
        and upper(regexp_replace(coalesce(p.plate, ''), '[^A-Za-z0-9]', '', 'g')) = v_plate_canon
        and p.status in ('active', 'pending_verification', 'recovery_claimed')
    ) then
      raise exception 'PLATE_IN_USE';
    end if;
  end if;

  -- --- Required fields (make/model/colour are the identity, plate or not) ------
  if p_make is null or p_model is null or p_colour is null
     or p_last_seen_at is null
     or p_last_seen_lat is null or p_last_seen_lng is null
     or p_bounty_amount_pence is null then
    raise exception 'MISSING_REQUIRED';
  end if;

  -- --- MONEY: bounty range (safe to change — a draft has NO escrow yet) --------
  if p_bounty_amount_pence < 1000 or p_bounty_amount_pence > 500000 then
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
  -- Identical server re-check to create_post: array shape, <= 8, 3–80-char trimmed
  -- description, own-folder photo URL.
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

  -- --- Atomic save (single transaction) ---------------------------------------
  -- SAFETY: SET lists ONLY the client-authorable descriptive columns. status,
  -- owner_id, and expires_at are DELIBERATELY absent — they are server-owned and
  -- this path must never move the lifecycle, transfer the post, or push expiry
  -- out. last_seen_location is rebuilt from (lng, lat) exactly as create_post does
  -- (ST_MakePoint takes longitude first).
  update public.posts set
    plate                   = v_plate,
    make                    = p_make,
    model                   = p_model,
    colour                  = p_colour,
    year                    = p_year,
    body_type               = p_body_type,
    distinguishing_features = p_distinguishing_features,
    owner_note              = p_owner_note,
    desc_recognise          = p_desc_recognise,
    desc_drives             = p_desc_drives,
    stolen_from             = p_stolen_from,
    keys_taken              = p_keys_taken,
    last_seen_at            = p_last_seen_at,
    last_seen_location      = ST_SetSRID(ST_MakePoint(p_last_seen_lng, p_last_seen_lat), 4326)::geography,
    last_seen_area          = p_last_seen_area,
    bounty_amount_pence     = p_bounty_amount_pence
  where id = p_post_id;

  -- --- Replace child rows (all scoped to THIS post; see the SAFETY NOTE) -------

  -- Photos: full replace. delete SCOPED to p_post_id, then reinsert from the new
  -- array with position = ordinality-1 (0-based display order the wizard sent).
  delete from public.post_photos where post_id = p_post_id;
  insert into public.post_photos (post_id, url, position)
  select p_post_id, u.url, (u.ord - 1)::int
  from unnest(p_photo_urls) with ordinality as u(url, ord);

  -- Distinctive features: full replace. delete SCOPED to p_post_id, then reinsert
  -- (description stored trimmed; position = ordinality-1) — mirrors create_post.
  delete from public.post_distinctive_feature where post_id = p_post_id;
  insert into public.post_distinctive_feature (post_id, photo_url, description, position)
  select p_post_id,
         elem.value ->> 'photo_url',
         btrim(elem.value ->> 'description'),
         (elem.ord - 1)::int
  from jsonb_array_elements(v_features) with ordinality as elem(value, ord);

  -- Feature tags: create_post inserts these ONLY when p_feature_keys is non-null
  -- (the wizard always sends null). Replicate: replace only when supplied; when
  -- null LEAVE the existing tags untouched (do not silently wipe them).
  if p_feature_keys is not null and array_length(p_feature_keys, 1) is not null then
    delete from public.post_feature where post_id = p_post_id;
    insert into public.post_feature (post_id, feature_key)
    select p_post_id, k
    from unnest(p_feature_keys) as k;
  end if;

  -- Verification document: replace ONLY when a new V5C path is supplied. When
  -- p_verification_path is null, LEAVE the existing verification_documents row
  -- intact — an unchanged V5C must be KEPT (the client re-sends null when the
  -- owner did not re-upload the logbook). delete is SCOPED to p_post_id.
  if p_verification_path is not null then
    delete from public.verification_documents where post_id = p_post_id;
    insert into public.verification_documents (post_id, storage_path)
    values (p_post_id, p_verification_path);
  end if;

  -- AUDIT: a post-edited audit-log insert belongs here once the audit_log table
  -- exists (SECURITY_AND_TRUST §7). Deferred with the moderation feature, matching
  -- create_post.

  return jsonb_build_object('post_id', p_post_id, 'status', v_post.status);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. update_post_bounty — verbatim from 20260727130000 but for the guard.
-- ---------------------------------------------------------------------------
create or replace function public.update_post_bounty(
  p_post_id             uuid,
  p_bounty_amount_pence int
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_owner uuid := auth.uid();
  v_post  public.posts%rowtype;
begin
  if v_owner is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  -- SAFETY: DRAFT-ONLY gate. Own + draft + locked, else POST_NOT_EDITABLE.
  select * into v_post
  from public.posts p
  where p.id = p_post_id
    and p.owner_id = v_owner
    and p.status = any(array['draft']::public.post_status[])
  for update;
  if not found then
    raise exception 'POST_NOT_EDITABLE';
  end if;

  -- MONEY: bounty range (create_post parity). NOT NULL + 1000–500000 pence.
  if p_bounty_amount_pence is null
     or p_bounty_amount_pence < 1000 or p_bounty_amount_pence > 500000 then
    raise exception 'BOUNTY_OUT_OF_RANGE';
  end if;

  -- MONEY: touch ONLY bounty_amount_pence. Nothing else is in this SET list.
  update public.posts set
    bounty_amount_pence = p_bounty_amount_pence
  where id = p_post_id;

  return jsonb_build_object('post_id', p_post_id);
end;
$$;

comment on function public.update_post_bounty(uuid, int) is
  'DRAFT-ONLY per-section edit: writes bounty_amount_pence and NOTHING ELSE on an own draft post (else POST_NOT_EDITABLE). BOUNTY_OUT_OF_RANGE unless 1000–500000 pence (£10–£5000). Safe only because a draft has no escrow; the draft-only gate keeps it off paid posts. Never writes status/owner_id/expires_at or any non-money column. Also raises NOT_AUTHENTICATED.';

-- ---------------------------------------------------------------------------
-- 6. create_my_alert / update_my_alert — verbatim from 20260802150000.
-- ---------------------------------------------------------------------------
create or replace function public.create_my_alert(
  p_name             text,
  p_lat              double precision,
  p_lng              double precision,
  p_radius_m         int,
  p_approximate      boolean,
  p_enabled          boolean,
  p_make             text,
  p_model            text,
  p_colour           text,
  p_body_type        text,
  p_min_bounty_pence int,
  p_recency_days     int
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid         uuid := auth.uid();
  -- Normalised ONCE, then used everywhere: validating one value and storing
  -- another is how bounds get bypassed. NULL booleans fall back to the
  -- PRIVACY-PRESERVING side rather than erroring — a missing approximate flag
  -- must never mean "store it exactly".
  v_approximate boolean := coalesce(p_approximate, true);
  v_enabled     boolean := coalesce(p_enabled, true);
  -- The name is REQUIRED, so it is btrim'd (not nullif'd) and checked below.
  v_name        text    := btrim(coalesce(p_name, ''));
  -- Criteria: nullif(btrim(...),'') so a BLANK box means "any", not a filter
  -- for the empty string. A client that sends '' for "no preference" (which
  -- every form on earth does) must not silently create an alert that matches
  -- nothing.
  v_make        text    := nullif(btrim(coalesce(p_make,      '')), '');
  v_model       text    := nullif(btrim(coalesce(p_model,     '')), '');
  v_colour      text    := nullif(btrim(coalesce(p_colour,    '')), '');
  v_body_type   text    := nullif(btrim(coalesce(p_body_type, '')), '');
  v_point       geography(Point,4326);
  v_alert       public.alert_zones%rowtype;
  -- The cap. Same number and same reasoning as the garage's vehicle cap: enough
  -- alerts for a real person's actual patterns, small enough to bound an
  -- automated abuse loop and to keep the fan-out's per-user work trivial.
  v_alert_cap   int     := 5;
begin
  -- SAFETY: an alert needs an owner (the grant in section 11 already excludes
  -- anon; this is the belt-and-braces backstop).
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  -- --- The cap ----------------------------------------------------------------
  -- SAFETY: the advisory lock is what makes count-then-insert actually a cap.
  -- Without it two concurrent creates both read a count of 4, both pass, and the
  -- user ends up with six alerts — there is no unique index left to catch it
  -- (section 4 dropped the only one). Keyed on the CALLER, so it serialises one
  -- user's own concurrent creates and nobody else's; it releases automatically
  -- at transaction end. Same idiom as create_sighting's rate limit.
  perform pg_advisory_xact_lock(
    hashtextextended('create_alert:' || v_uid::text, 0));

  -- Counts the CALLER's rows only, so the count can never be a signal about
  -- anyone else's alerts. Served by alert_zones_user_idx (section 4).
  if (select count(*) from public.alert_zones z where z.user_id = v_uid) >= v_alert_cap then
    raise exception 'ALERT_LIMIT_REACHED';
  end if;

  -- --- INVALID_INPUT: name ----------------------------------------------------
  -- Measured AFTER trimming — the value that will actually be stored. A
  -- whitespace-only name is blank, not a name (see the note in section 1: the
  -- CHECK bounds length only, this is where non-blankness is enforced).
  if v_name = '' then
    raise exception 'INVALID_INPUT: name is required';
  end if;
  if char_length(v_name) > 80 then
    raise exception 'INVALID_INPUT: name too long';
  end if;

  -- --- INVALID_INPUT: coordinates and radius ----------------------------------
  -- Coordinates must exist and be on the planet. A NULL cannot build a point, so
  -- it is an input error rather than an implicit "an alert with no place" —
  -- location is still mandatory in v2 (see the point column comment).
  if p_lat is null or p_lng is null
     or p_lat < -90 or p_lat > 90
     or p_lng < -180 or p_lng > 180 then
    raise exception 'INVALID_INPUT: lat/lng out of range';
  end if;

  -- Same bounds as alert_zones_radius_chk, re-checked here so the client gets a
  -- clean mappable token instead of a raw constraint violation. Deliberately NOT
  -- clamped: this is a setting the user chose, so an out-of-range value is a
  -- client bug worth surfacing, not something to silently round.
  if p_radius_m is null or p_radius_m < 1609 or p_radius_m > 80467 then
    raise exception 'INVALID_INPUT: radius_m out of range';
  end if;

  -- --- INVALID_INPUT: criteria ------------------------------------------------
  -- Same bounds as the four *_len_chk constraints in section 2, measured on the
  -- NORMALISED values (what will be stored). NULL criteria are "any" and skip
  -- every check by SQL semantics.
  if char_length(v_make) > 40 then
    raise exception 'INVALID_INPUT: make too long';
  end if;
  if char_length(v_model) > 40 then
    raise exception 'INVALID_INPUT: model too long';
  end if;
  if char_length(v_colour) > 40 then
    raise exception 'INVALID_INPUT: colour too long';
  end if;
  if char_length(v_body_type) > 40 then
    raise exception 'INVALID_INPUT: body_type too long';
  end if;

  -- MONEY: mirrors alert_zones_min_bounty_chk AND posts.bounty_amount_pence.
  -- Only checked when supplied — NULL means "any bounty".
  if p_min_bounty_pence is not null
     and (p_min_bounty_pence < 1000 or p_min_bounty_pence > 500000) then
    raise exception 'INVALID_INPUT: min_bounty_pence out of range';
  end if;

  -- Mirrors alert_zones_recency_days_chk. NULL means "any age".
  if p_recency_days is not null and p_recency_days <= 0 then
    raise exception 'INVALID_INPUT: recency_days out of range';
  end if;

  -- --- The point --------------------------------------------------------------
  -- SAFETY: with `approximate` on, the point is coarsened to the ~1km grid
  -- BEFORE storage, so the database never holds the user's home address. Same
  -- ST_SnapToGrid idiom get_post_detail uses for driveway thefts.
  -- NOTE: ST_MakePoint takes LONGITUDE FIRST (x, y). Getting this backwards
  -- silently stores a point in the wrong hemisphere and the fan-out matches
  -- nobody.
  -- The predicate is v_approximate (the NORMALISED flag), never the raw
  -- p_approximate: a NULL parameter is falsy in a CASE, so branching on the raw
  -- value would store the EXACT point while writing approximate = true on the
  -- row — a silently broken privacy promise, which is the worst kind.
  v_point := case when v_approximate
    then ST_SnapToGrid(ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326), 0.01)::geography
    else ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography
  end;

  -- --- Insert -----------------------------------------------------------------
  -- SAFETY: user_id is PINNED to the caller. id/created_at/updated_at take their
  -- defaults; no client-suppliable timestamps.
  insert into public.alert_zones (
    user_id, name, point, radius_m, enabled, approximate,
    make, model, colour, body_type, min_bounty_pence, recency_days
  )
  values (
    v_uid, v_name, v_point, p_radius_m, v_enabled, v_approximate,
    v_make, v_model, v_colour, v_body_type, p_min_bounty_pence, p_recency_days
  )
  returning * into v_alert;

  -- SAFETY / PRODUCT: returns the STORED point, NOT the submitted one — so when
  -- approximate is on, the client's map pin visibly MOVES to the grid cell that
  -- was actually saved. Deliberate; do not "fix" it by echoing the input back.
  -- Showing someone where their alert really is beats claiming a privacy they
  -- do not have. ELEMENT SHAPE: identical to section 6 — keep all four in step.
  return jsonb_build_object(
    'id',               v_alert.id,
    'name',             v_alert.name,
    'lat',              ST_Y(v_alert.point::geometry),
    'lng',              ST_X(v_alert.point::geometry),
    'radius_m',         v_alert.radius_m,
    'enabled',          v_alert.enabled,
    'approximate',      v_alert.approximate,
    'make',             v_alert.make,
    'model',            v_alert.model,
    'colour',           v_alert.colour,
    'body_type',        v_alert.body_type,
    'min_bounty_pence', v_alert.min_bounty_pence,
    'recency_days',     v_alert.recency_days,
    'updated_at',       v_alert.updated_at
  );
end;
$$;

comment on function public.create_my_alert(text, double precision, double precision, int, boolean, boolean, text, text, text, text, int, int) is
  'Creates ONE alert for the caller and returns the STORED row in the shared element shape { id, name, lat, lng, radius_m, enabled, approximate, make, model, colour, body_type, min_bounty_pence, recency_days, updated_at } (identical to list_my_alerts / update_my_alert / set_my_alert_enabled — keep all four in step). SECURITY DEFINER; user_id is pinned to auth.uid() and is not a parameter, so an alert can never be created on another user''s behalf. CAP: five per user, enforced by a count-then-raise (ALERT_LIMIT_REACHED) under pg_advisory_xact_lock(''create_alert:<uid>'') — the lock is REQUIRED, not decorative, because section 4 dropped the only unique index that could otherwise have caught two concurrent creates. SAFETY: when p_approximate is true (also the fallback for NULL) the centre is ST_SnapToGrid''d to 0.01° (~1km) BEFORE storage — the coarsening is a server guarantee, not a client promise, which is why clients hold no DML grant on alert_zones. Blank criteria text is normalised to NULL = "any", so an empty form field never becomes a filter that matches nothing. Returns the STORED point, not the submitted coordinates, so the client pin moves to what was really saved. Raises NOT_AUTHENTICATED (guest), ALERT_LIMIT_REACHED, and INVALID_INPUT (blank or >80 name, lat/lng off-planet or null, radius_m outside 1609..80467, any criterion text over 40 chars, min_bounty_pence outside 1000..500000, recency_days <= 0).';

create or replace function public.update_my_alert(
  p_alert_id         uuid,
  p_name             text,
  p_lat              double precision,
  p_lng              double precision,
  p_radius_m         int,
  p_approximate      boolean,
  p_enabled          boolean,
  p_make             text,
  p_model            text,
  p_colour           text,
  p_body_type        text,
  p_min_bounty_pence int,
  p_recency_days     int
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid         uuid := auth.uid();
  v_existing    public.alert_zones%rowtype;
  -- SAFETY: approximate falls back to TRUE on NULL — the privacy-preserving
  -- side, exactly as on create. It deliberately does NOT fall back to the row's
  -- current value: an omitted flag must never be able to turn coarsening OFF.
  v_approximate boolean := coalesce(p_approximate, true);
  -- enabled falls back to the row's CURRENT value (read below), not to true: a
  -- client that omits the flag while saving a criteria edit must not silently
  -- un-pause an alert the user deliberately muted.
  v_enabled     boolean;
  v_name        text    := btrim(coalesce(p_name, ''));
  v_make        text    := nullif(btrim(coalesce(p_make,      '')), '');
  v_model       text    := nullif(btrim(coalesce(p_model,     '')), '');
  v_colour      text    := nullif(btrim(coalesce(p_colour,    '')), '');
  v_body_type   text    := nullif(btrim(coalesce(p_body_type, '')), '');
  v_point       geography(Point,4326);
  v_alert       public.alert_zones%rowtype;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  -- SAFETY: own + locked, else ONE opaque code. Absent and not-yours are
  -- indistinguishable to the caller by design. Served by alert_zones_user_idx.
  select * into v_existing
  from public.alert_zones z
  where z.id = p_alert_id
    and z.user_id = v_uid
  for update;
  if not found then
    raise exception 'ALERT_NOT_FOUND';
  end if;

  v_enabled := coalesce(p_enabled, v_existing.enabled);

  -- --- Validation: byte-for-byte create_my_alert's (see its comments) ---------
  if v_name = '' then
    raise exception 'INVALID_INPUT: name is required';
  end if;
  if char_length(v_name) > 80 then
    raise exception 'INVALID_INPUT: name too long';
  end if;

  if p_lat is null or p_lng is null
     or p_lat < -90 or p_lat > 90
     or p_lng < -180 or p_lng > 180 then
    raise exception 'INVALID_INPUT: lat/lng out of range';
  end if;

  if p_radius_m is null or p_radius_m < 1609 or p_radius_m > 80467 then
    raise exception 'INVALID_INPUT: radius_m out of range';
  end if;

  if char_length(v_make) > 40 then
    raise exception 'INVALID_INPUT: make too long';
  end if;
  if char_length(v_model) > 40 then
    raise exception 'INVALID_INPUT: model too long';
  end if;
  if char_length(v_colour) > 40 then
    raise exception 'INVALID_INPUT: colour too long';
  end if;
  if char_length(v_body_type) > 40 then
    raise exception 'INVALID_INPUT: body_type too long';
  end if;

  if p_min_bounty_pence is not null
     and (p_min_bounty_pence < 1000 or p_min_bounty_pence > 500000) then
    raise exception 'INVALID_INPUT: min_bounty_pence out of range';
  end if;

  if p_recency_days is not null and p_recency_days <= 0 then
    raise exception 'INVALID_INPUT: recency_days out of range';
  end if;

  -- --- The point: THE SAME SNAP AS CREATE -------------------------------------
  -- SAFETY: this is not a copy-paste convenience, it is the guarantee itself. If
  -- the edit path skipped the snap, "edit your alert" would be a one-call way to
  -- put an exact home address into a table that promises it holds none — and the
  -- row would still read approximate = true. ST_MakePoint takes LONGITUDE FIRST.
  v_point := case when v_approximate
    then ST_SnapToGrid(ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326), 0.01)::geography
    else ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography
  end;

  -- --- Apply ------------------------------------------------------------------
  -- SAFETY: the column list names ONLY editable fields. user_id, id and
  -- created_at are absent and unwritable here. updated_at is maintained by the
  -- alert_zones_set_updated_at trigger.
  update public.alert_zones set
    name             = v_name,
    point            = v_point,
    radius_m         = p_radius_m,
    enabled          = v_enabled,
    approximate      = v_approximate,
    make             = v_make,
    model            = v_model,
    colour           = v_colour,
    body_type        = v_body_type,
    min_bounty_pence = p_min_bounty_pence,
    recency_days     = p_recency_days
  where id = p_alert_id
    and user_id = v_uid            -- SAFETY: re-stated; never rely on the lock alone
  returning * into v_alert;

  -- Returns the STORED row (snapped point included). ELEMENT SHAPE: identical to
  -- sections 6, 7 and 10 — keep all four in step.
  return jsonb_build_object(
    'id',               v_alert.id,
    'name',             v_alert.name,
    'lat',              ST_Y(v_alert.point::geometry),
    'lng',              ST_X(v_alert.point::geometry),
    'radius_m',         v_alert.radius_m,
    'enabled',          v_alert.enabled,
    'approximate',      v_alert.approximate,
    'make',             v_alert.make,
    'model',            v_alert.model,
    'colour',           v_alert.colour,
    'body_type',        v_alert.body_type,
    'min_bounty_pence', v_alert.min_bounty_pence,
    'recency_days',     v_alert.recency_days,
    'updated_at',       v_alert.updated_at
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. get_bounty_guidance — the reach curve gains a £10 rung.
-- ---------------------------------------------------------------------------
create or replace function public.get_bounty_guidance(
  p_lat double precision,
  p_lng double precision
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $fn$
declare
  -- Same floor, same reasons, as get_alert_reach: small counts are the
  -- identifying ones, and "2 spotters are watching" is also the answer we would
  -- least want to hand a thief.
  c_min_reportable constant integer := 5;
  c_grid           constant double precision := 0.01;
  -- Pre-filter pad only. Exceeds the worst a 0.01° snap can move a point
  -- (~661m at UK latitudes), and is ANDed with a strictly narrower test, so it
  -- can only ever exclude, never admit.
  c_pad_m          constant integer := 1500;
  -- 20 miles — the get_home_feed / get_area_insights default radius. The local
  -- band answers "round here", and "round here" is already defined once.
  c_local_radius_m constant integer := 32187;

  -- MONEY: integer pence, GBP. Every rung is inside posts.bounty_amount_pence's
  -- CHECK (1000..500000) and lands on the MoneySlider's snap grid (£5 steps to
  -- £50, £25 above), so every number derived from this array is one the owner
  -- can actually select.
  --
  -- ⚠️ THE £10 RUNG IS LOAD-BEARING, not a nicety. lowBountyAdvice reads reach
  -- at the FLOOR by taking the highest rung AT OR BELOW the chosen amount — with
  -- the floor at £10 and the curve still starting at £50 there is no such rung,
  -- so the floor-bounty sheet could never fire at all. If the floor moves again,
  -- the first rung moves with it.
  c_rungs constant integer[] := array[1000, 5000, 10000, 25000, 50000, 100000, 250000, 500000];

  v_point  geography;
  v_viewer uuid := auth.uid();
  v_rungs  jsonb;
  v_local  jsonb;
begin
  -- Degenerate input yields an empty payload rather than an error: this feeds a
  -- live wizard whose location step may not have resolved yet, and a throw here
  -- would surface as a failure on a screen that must never block posting.
  if p_lat is null or p_lng is null
     or p_lat < -90 or p_lat > 90
     or p_lng < -180 or p_lng > 180 then
    return jsonb_build_object('rungs', '[]'::jsonb, 'local', null);
  end if;

  -- SAFETY 3: snap BEFORE either table is touched, so this cannot resolve zone
  -- density or bounty distribution more finely than the zones are stored.
  v_point := ST_SnapToGrid(
               ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326),
               c_grid
             )::geography;

  -- ---------------------------------------------------------------------------
  -- rungs: the reach curve.
  --
  -- The predicate is get_alert_reach's, unchanged — including the deliberate
  -- omission of make/model/colour/recency. Folding vehicle matching in would
  -- make the DELTA between two rungs unreadable (a higher bounty could show a
  -- lower count because a different set of zones filters on a different make),
  -- and the delta is the entire point of a curve.
  -- ---------------------------------------------------------------------------
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'bounty_pence', r.rung,
               -- SAFETY 4, per rung and independently. Reach is monotonic in
               -- bounty, so a floored rung simply reads 0 and the curve starts
               -- where it clears.
               'reach', case when r.n >= c_min_reportable then r.n else 0 end
             )
             order by r.rung
           ),
           '[]'::jsonb
         )
    into v_rungs
  from (
    select
      rung,
      (
        select count(distinct z.user_id)
        from public.alert_zones z
        where z.enabled                                  -- paused zones reach nobody
          and z.user_id is distinct from v_viewer        -- never count the caller
          -- geography => ST_DWithin is TRUE METRES; GiST-assisted.
          and ST_DWithin(z.point, v_point, z.radius_m)
          -- MONEY: integer pence both sides. The only criterion applied.
          and (z.min_bounty_pence is null or rung >= z.min_bounty_pence)
      )::integer as n
    from unnest(c_rungs) as rung
  ) r;

  -- ---------------------------------------------------------------------------
  -- local: what owners round here actually set.
  --
  -- Status set matches get_area_insights: drafts, pending_verification and
  -- rejected are NEVER counted — a draft's bounty is a number someone is still
  -- typing, and counting it would let one indecisive user move the band.
  -- ---------------------------------------------------------------------------
  with scan as (
    select p.bounty_amount_pence as pence
    from public.posts p
    where p.status in (
            'active', 'recovery_claimed', 'recovered',
            'recovered_no_spotter', 'cancelled', 'expired'
          )
      -- The caller's own posts are excluded outright, not merely excluded from
      -- the floor. What you already chose must not be evidence for what you
      -- should choose.
      and p.owner_id is distinct from v_viewer
      and p.last_seen_location is not null
      -- Index pre-filter, then the authoritative snapped predicate.
      and ST_DWithin(p.last_seen_location, v_point, c_local_radius_m + c_pad_m)
      and ST_DWithin(
            ST_SnapToGrid(p.last_seen_location::geometry, c_grid)::geography,
            v_point, c_local_radius_m)
  )
  select
    case
      when count(*) >= c_min_reportable then
        jsonb_build_object(
          'p25_pence',
            round(percentile_cont(0.25) within group (order by pence::double precision))::integer,
          'median_pence',
            round(percentile_cont(0.50) within group (order by pence::double precision))::integer,
          'p75_pence',
            round(percentile_cont(0.75) within group (order by pence::double precision))::integer,
          'sample', count(*)::integer
        )
      -- SAFETY 4 again. Below the floor we say nothing, rather than say a
      -- number two listings could move.
      else null
    end
    into v_local
  from scan;

  return jsonb_build_object('rungs', v_rungs, 'local', v_local);
end;
$fn$;

comment on function public.get_bounty_guidance(double precision, double precision) is
  'The two observable inputs to a bounty recommendation, in one round trip: `rungs` (spotter reach at 8 fixed bounty levels — the get_alert_reach predicate run once per rung, so the client can see WHERE more money stops buying more eyes) and `local` (p25/median/p75 of bounty_amount_pence on nearby posts, or NULL below 5 samples). Discloses nothing get_alert_reach does not already: identical grid snap (0.01°), identical floor of 5 applied independently per rung, identical caller exclusion, identical predicate — eight rungs is eight calls any authenticated client could already make, spent as one. SECURITY DEFINER and revoked from anon because it counts rows describing other people''s home-ish points. Says what a bounty REACHES, never what it recovers: nothing here measures outcomes, and no client copy built on it may imply otherwise. Degenerate input returns an empty payload rather than raising, because it feeds a live wizard that must never block posting.';

revoke execute on function public.get_bounty_guidance(double precision, double precision)
  from public, anon;

grant execute on function public.get_bounty_guidance(double precision, double precision)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. The prose the old range is quoted in.
-- ---------------------------------------------------------------------------
comment on table public.posts is
  'Stolen-car post. status drives the lifecycle (docs/DOMAIN.md) and is server-controlled. bounty_amount_pence is integer GBP pence, £10–£5000.';

comment on column public.alert_zones.min_bounty_pence is
  'MONEY: optional minimum bounty in integer pence, GBP implied. NULL = ANY bounty. CHECK 1000..500000 is byte-for-byte posts.bounty_amount_pence''s range (£10–£5000, the DOMAIN.md fraud ceiling) so this filter can never be set to a value no post could satisfy. Never numeric/float.';

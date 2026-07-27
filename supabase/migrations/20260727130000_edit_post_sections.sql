-- =============================================================================
-- WHAT:  Adds SEVEN focused per-section "update a post section" SECURITY DEFINER
--        RPCs so the edit UI can save ONE section of a post at a time instead of
--        the whole-post replace update_post does:
--          public.update_post_car_details(...)          -- draft only
--          public.update_post_photos(...)               -- draft only
--          public.update_post_last_seen(...)            -- draft only
--          public.update_post_bounty(...)               -- draft only (MONEY)
--          public.update_post_verification(...)         -- draft only
--          public.update_post_theft_context(...)        -- draft + pending_verification
--          public.update_post_distinctive_features(...) -- draft + pending_verification
--        Each function edits ONLY its own section, re-validating exactly the same
--        untrusted client input the 21-arg create_post / update_post do, with the
--        SAME raise codes (MISSING_REQUIRED, BOUNTY_OUT_OF_RANGE, PHOTO_COUNT,
--        INVALID_PHOTO_URL, INVALID_VERIFICATION_PATH, DISTINCTIVE_FEATURES_COUNT,
--        INVALID_DISTINCTIVE_FEATURE, INVALID_DISTINCTIVE_PHOTO_URL,
--        INVALID_STOLEN_FROM, INVALID_KEYS_TAKEN, and the posts.year column CHECK),
--        the same owner-pin (auth.uid()), the same FOR UPDATE row lock, the same
--        own-folder photo/V5C URL regex pinned to the caller's uid, and the same
--        child-row delete+reinsert scoped to the single post being edited. The ONE
--        difference between the sections is the NEW POST_NOT_EDITABLE status gate,
--        which VARIES by section (see the SAFETY block).
-- WHY:   The whole-post update_post can only run on a draft (a draft has NO escrow
--        yet, so re-saving anything including its bounty is money-safe). But an
--        owner also needs to add/refine two SAFE, money-neutral sections AFTER
--        payment while a post sits in pending_verification awaiting a moderator:
--        the theft context and the distinctive-feature evidence. Splitting edit
--        into per-section RPCs lets exactly those two run on a paid post while the
--        other five stay draft-only, and lets each section carry its own minimal,
--        precise validation instead of forcing the client to re-send every field.
-- LINKS: docs/DOMAIN.md (post lifecycle: draft is client-editable; pending_
--          verification holds escrow awaiting moderation; £50–£5000 bounty; integer
--          pence; expiry is server-owned),
--        docs/SECURITY_AND_TRUST.md §2 (nothing public before verification; own-
--          folder photo/V5C hosting; anti spotter-tracking), §6 (RLS deny-by-
--          default; status server-only; SECURITY DEFINER hardening; owner_id/
--          expires_at server-owned),
--        supabase/migrations/20260707110712_payments_foundation.sql (posts columns,
--          post_status enum, posts_update_own_draft RLS, and the column-level grant
--          that EXCLUDES status/owner_id/expires_at — invariants ALL 7 fns keep),
--        supabase/migrations/20260724100000_post_distinctive_features.sql (the
--          21-arg create_post whose per-field validation + raise codes + child
--          tables these mirror),
--        supabase/migrations/20260727110000_edit_draft_post.sql (update_post: the
--          owner-pin, FOR UPDATE lock, POST_NOT_EDITABLE gate, own-folder URL
--          regex, and scoped child-row replace mirrored below).
--
-- =============================================================================
-- SAFETY (Tier 1 — read before editing anything below):
--   * Each of the 7 functions is SECURITY DEFINER (bypasses RLS + the posts client
--     column grants) and is HARD-PINNED to a post that EXISTS, is OWNED by the
--     caller (owner_id = auth.uid()), and whose status is in that section's gate —
--     locked FOR UPDATE so a concurrent Post & pay transition cannot race the edit.
--     Any other case (missing / not yours / wrong status) is one opaque code:
--     POST_NOT_EDITABLE.
--   * The status gate VARIES by section, and this is the money-safety boundary:
--       - Draft-only (5): update_post_car_details, update_post_photos,
--         update_post_last_seen, update_post_bounty, update_post_verification.
--         These can therefore NEVER run on a paid (pending_verification+) post.
--       - Draft + pending_verification (2): update_post_theft_context and
--         update_post_distinctive_features are the ONLY functions here allowed on a
--         paid post. They touch ONLY descriptive/evidence columns + the
--         post_distinctive_feature child rows; they NEVER touch bounty_amount_pence,
--         status, owner_id, or expires_at — so a paid post's FROZEN escrow amount
--         and its lifecycle are untouchable through this whole migration.
--   * NONE of the 7 ever writes status, owner_id, or expires_at (those columns are
--     absent from every SET list), preserving the payments-foundation invariants
--     even though SECURITY DEFINER bypasses RLS/column grants. update_post_bounty
--     is the ONLY money writer and it sets bounty_amount_pence and NOTHING else.
--   * All validation is a SERVER re-check of untrusted client input with the SAME
--     raise codes as create_post/update_post. Own-folder photo/V5C URL regexes are
--     pinned to the caller's uid (anti spotter-tracking, §3).
--
-- SAFETY NOTE ON DESTRUCTIVE STATEMENTS: additive — no schema drop/rename/truncate
--   and no new tables. update_post_photos, update_post_verification, and
--   update_post_distinctive_features DO issue child-row `delete ... where post_id =
--   p_post_id` statements: those scoped deletes are the "replace the child rows"
--   mechanism, run INSIDE each function's single transaction (any raise rolls the
--   whole delete+reinsert back), and NEVER touch a row outside the edited post.
-- =============================================================================


-- =============================================================================
-- 1. RPC: update_post_car_details(...)   (DRAFT-ONLY — descriptive identity)
-- =============================================================================
-- Writes ONLY make/model/colour/owner_note/year/body_type on an own DRAFT post.
-- make/model/colour are the required identity (MISSING_REQUIRED). year is left to
-- the posts_year_range_chk column CHECK (1900–2100) exactly as create_post relies
-- on it — an out-of-range year rolls the UPDATE back. NEVER touches status/owner/
-- expires/bounty/plate/location.
create or replace function public.update_post_car_details(
  p_post_id    uuid,
  p_make       text,
  p_model      text,
  p_colour     text,
  p_owner_note text,
  p_year       int,
  p_body_type  text
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

  -- Required identity (mirrors create_post's MISSING_REQUIRED for make/model/colour).
  if p_make is null or p_model is null or p_colour is null then
    raise exception 'MISSING_REQUIRED';
  end if;

  -- year is enforced by the posts_year_range_chk column CHECK (1900–2100), exactly
  -- as create_post enforces it — no explicit raise; the UPDATE rolls back if bad.
  update public.posts set
    make       = p_make,
    model      = p_model,
    colour     = p_colour,
    owner_note = p_owner_note,
    year       = p_year,
    body_type  = p_body_type
  where id = p_post_id;

  return jsonb_build_object('post_id', p_post_id);
end;
$$;

comment on function public.update_post_car_details(uuid, text, text, text, text, int, text) is
  'DRAFT-ONLY per-section edit: writes make/model/colour/owner_note/year/body_type only, on an own draft post (else POST_NOT_EDITABLE). MISSING_REQUIRED if make/model/colour null; year bounded by the posts_year_range_chk column CHECK. Never writes status/owner_id/expires_at/bounty. Also raises NOT_AUTHENTICATED.';

revoke execute on function public.update_post_car_details(uuid, text, text, text, text, int, text) from public;
revoke execute on function public.update_post_car_details(uuid, text, text, text, text, int, text) from anon;
grant  execute on function public.update_post_car_details(uuid, text, text, text, text, int, text) to authenticated, service_role;


-- =============================================================================
-- 2. RPC: update_post_photos(...)   (DRAFT-ONLY — hero photo set)
-- =============================================================================
-- Full-replaces the post_photos child rows for an own DRAFT post: 3–6 own-folder
-- post-photos URLs, reinserted with position = ordinality-1 (0-based display order
-- the wizard sent). Same PHOTO_COUNT + INVALID_PHOTO_URL checks as create_post.
create or replace function public.update_post_photos(
  p_post_id    uuid,
  p_photo_urls text[]
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_owner        uuid := auth.uid();
  v_post         public.posts%rowtype;
  v_photo_count  int  := coalesce(array_length(p_photo_urls, 1), 0);
  v_url          text;
  v_photo_url_re text := '^https?://(127\.0\.0\.1(:[0-9]+)?|[a-z0-9-]+\.supabase\.co)'
                         || '/storage/v1/object/public/post-photos/'
                         || v_owner::text || '/[^/]+$';
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

  -- Photo count (create_post parity).
  if v_photo_count < 3 or v_photo_count > 6 then
    raise exception 'PHOTO_COUNT';
  end if;

  -- SAFETY: every URL must be one of the caller's OWN-folder post-photos objects
  -- (anti spotter-tracking, §3) and <= 500 chars — same check as create_post.
  foreach v_url in array p_photo_urls loop
    if v_url is null or char_length(v_url) > 500 or v_url !~ v_photo_url_re then
      raise exception 'INVALID_PHOTO_URL';
    end if;
  end loop;

  -- Full replace, SCOPED to this post (see the SAFETY NOTE at the top).
  delete from public.post_photos where post_id = p_post_id;
  insert into public.post_photos (post_id, url, position)
  select p_post_id, u.url, (u.ord - 1)::int
  from unnest(p_photo_urls) with ordinality as u(url, ord);

  return jsonb_build_object('post_id', p_post_id);
end;
$$;

comment on function public.update_post_photos(uuid, text[]) is
  'DRAFT-ONLY per-section edit: full-replaces the post_photos child rows (delete SCOPED to p_post_id, then reinsert with position=ordinality-1) on an own draft post (else POST_NOT_EDITABLE). PHOTO_COUNT (3–6); each URL must be an own-folder post-photos object <=500 chars (INVALID_PHOTO_URL). Never writes status/owner_id/expires_at/bounty. Also raises NOT_AUTHENTICATED.';

revoke execute on function public.update_post_photos(uuid, text[]) from public;
revoke execute on function public.update_post_photos(uuid, text[]) from anon;
grant  execute on function public.update_post_photos(uuid, text[]) to authenticated, service_role;


-- =============================================================================
-- 3. RPC: update_post_last_seen(...)   (DRAFT-ONLY — last-seen point + area)
-- =============================================================================
-- Writes last_seen_at, last_seen_location (rebuilt from lng/lat exactly as
-- create_post does — ST_MakePoint takes LONGITUDE first), and last_seen_area on an
-- own DRAFT post. at/lat/lng are required (MISSING_REQUIRED); area is free text.
create or replace function public.update_post_last_seen(
  p_post_id        uuid,
  p_last_seen_at   timestamptz,
  p_last_seen_lat  double precision,
  p_last_seen_lng  double precision,
  p_last_seen_area text
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

  -- Required last-seen inputs (create_post parity).
  if p_last_seen_at is null or p_last_seen_lat is null or p_last_seen_lng is null then
    raise exception 'MISSING_REQUIRED';
  end if;

  update public.posts set
    last_seen_at       = p_last_seen_at,
    last_seen_location = ST_SetSRID(ST_MakePoint(p_last_seen_lng, p_last_seen_lat), 4326)::geography,
    last_seen_area     = p_last_seen_area
  where id = p_post_id;

  return jsonb_build_object('post_id', p_post_id);
end;
$$;

comment on function public.update_post_last_seen(uuid, timestamptz, double precision, double precision, text) is
  'DRAFT-ONLY per-section edit: writes last_seen_at, last_seen_location (from lng/lat, geography 4326), and last_seen_area on an own draft post (else POST_NOT_EDITABLE). MISSING_REQUIRED if last_seen_at/lat/lng null. Never writes status/owner_id/expires_at/bounty. Also raises NOT_AUTHENTICATED.';

revoke execute on function public.update_post_last_seen(uuid, timestamptz, double precision, double precision, text) from public;
revoke execute on function public.update_post_last_seen(uuid, timestamptz, double precision, double precision, text) from anon;
grant  execute on function public.update_post_last_seen(uuid, timestamptz, double precision, double precision, text) to authenticated, service_role;


-- =============================================================================
-- 4. RPC: update_post_bounty(...)   (DRAFT-ONLY — MONEY, the ONLY money writer)
-- =============================================================================
-- Writes bounty_amount_pence and NOTHING ELSE on an own DRAFT post. Safe to change
-- ONLY because a draft has NO escrow yet (the charge is taken at Post & pay, which
-- flips draft -> pending_verification); the draft-only gate guarantees this can
-- never run on a paid post whose escrow is frozen. Range £50–£5000 (5000–500000
-- pence), same BOUNTY_OUT_OF_RANGE code as create_post.
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

  -- MONEY: bounty range (create_post parity). NOT NULL + 5000–500000 pence.
  if p_bounty_amount_pence is null
     or p_bounty_amount_pence < 5000 or p_bounty_amount_pence > 500000 then
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
  'DRAFT-ONLY per-section edit: writes bounty_amount_pence and NOTHING ELSE on an own draft post (else POST_NOT_EDITABLE). BOUNTY_OUT_OF_RANGE unless 5000–500000 pence (£50–£5000). Safe only because a draft has no escrow; the draft-only gate keeps it off paid posts. Never writes status/owner_id/expires_at or any non-money column. Also raises NOT_AUTHENTICATED.';

revoke execute on function public.update_post_bounty(uuid, int) from public;
revoke execute on function public.update_post_bounty(uuid, int) from anon;
grant  execute on function public.update_post_bounty(uuid, int) to authenticated, service_role;


-- =============================================================================
-- 5. RPC: update_post_verification(...)   (DRAFT-ONLY — the V5C proof doc)
-- =============================================================================
-- Full-replaces the verification_documents row for an own DRAFT post with a new
-- V5C path. The path must live under the CALLER's own folder (first segment =
-- v_owner) and be <= 300 chars, else INVALID_VERIFICATION_PATH — same check as
-- create_post. A null/foreign/over-long path is rejected (this section's whole job
-- is to SET the logbook, so it always replaces with a valid path).
create or replace function public.update_post_verification(
  p_post_id           uuid,
  p_verification_path text
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

  -- SAFETY: the V5C path must be under the caller's OWN folder and <= 300 chars
  -- (create_post parity). Unlike update_post (which keeps the existing doc on a
  -- null path), this dedicated setter requires a real path to replace with.
  if p_verification_path is null
     or char_length(p_verification_path) > 300
     or split_part(p_verification_path, '/', 1) <> v_owner::text then
    raise exception 'INVALID_VERIFICATION_PATH';
  end if;

  -- Full replace, SCOPED to this post (see the SAFETY NOTE at the top).
  delete from public.verification_documents where post_id = p_post_id;
  insert into public.verification_documents (post_id, storage_path)
  values (p_post_id, p_verification_path);

  return jsonb_build_object('post_id', p_post_id);
end;
$$;

comment on function public.update_post_verification(uuid, text) is
  'DRAFT-ONLY per-section edit: replaces the verification_documents row (delete SCOPED to p_post_id, then insert) on an own draft post (else POST_NOT_EDITABLE). INVALID_VERIFICATION_PATH unless the path is non-null, <=300 chars, and under the caller''s own folder (first segment = auth.uid()). Never writes status/owner_id/expires_at/bounty. Also raises NOT_AUTHENTICATED.';

revoke execute on function public.update_post_verification(uuid, text) from public;
revoke execute on function public.update_post_verification(uuid, text) from anon;
grant  execute on function public.update_post_verification(uuid, text) to authenticated, service_role;


-- =============================================================================
-- 6. RPC: update_post_theft_context(...)   (DRAFT + PENDING_VERIFICATION — SAFE)
-- =============================================================================
-- Writes stolen_from / keys_taken / desc_drives on an own post that is EITHER a
-- draft OR pending_verification. This is one of the TWO money-neutral sections
-- allowed on a paid post: it touches ONLY these descriptive columns and NEVER
-- bounty/status/owner/expires, so a paid post's frozen escrow + lifecycle are
-- untouched. Constrained enums re-checked (INVALID_STOLEN_FROM / INVALID_KEYS_TAKEN,
-- null allowed); desc_drives is free text bounded by its column CHECK.
create or replace function public.update_post_theft_context(
  p_post_id     uuid,
  p_stolen_from text,
  p_keys_taken  text,
  p_desc_drives text
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

  -- SAFETY: DRAFT + PENDING_VERIFICATION gate. This SAFE, money-neutral section is
  -- one of only two allowed on a paid (pending_verification) post. Own + in-gate +
  -- locked, else POST_NOT_EDITABLE.
  select * into v_post
  from public.posts p
  where p.id = p_post_id
    and p.owner_id = v_owner
    and p.status = any(array['draft', 'pending_verification']::public.post_status[])
  for update;
  if not found then
    raise exception 'POST_NOT_EDITABLE';
  end if;

  -- Constrained enums (null allowed; posts CHECK also enforces) — create_post parity.
  if p_stolen_from is not null
     and p_stolen_from not in ('driveway', 'street', 'car_park', 'other') then
    raise exception 'INVALID_STOLEN_FROM';
  end if;
  if p_keys_taken is not null
     and p_keys_taken not in ('yes', 'no', 'unknown') then
    raise exception 'INVALID_KEYS_TAKEN';
  end if;

  update public.posts set
    stolen_from = p_stolen_from,
    keys_taken  = p_keys_taken,
    desc_drives = p_desc_drives
  where id = p_post_id;

  return jsonb_build_object('post_id', p_post_id);
end;
$$;

comment on function public.update_post_theft_context(uuid, text, text, text) is
  'SAFE per-section edit allowed on an own DRAFT or PENDING_VERIFICATION post (else POST_NOT_EDITABLE): writes stolen_from/keys_taken/desc_drives only. INVALID_STOLEN_FROM (driveway/street/car_park/other or null); INVALID_KEYS_TAKEN (yes/no/unknown or null); desc_drives free text. One of only two functions here permitted on a paid post; NEVER writes bounty/status/owner_id/expires_at. Also raises NOT_AUTHENTICATED.';

revoke execute on function public.update_post_theft_context(uuid, text, text, text) from public;
revoke execute on function public.update_post_theft_context(uuid, text, text, text) from anon;
grant  execute on function public.update_post_theft_context(uuid, text, text, text) to authenticated, service_role;


-- =============================================================================
-- 7. RPC: update_post_distinctive_features(...)   (DRAFT + PENDING_VERIFICATION — SAFE)
-- =============================================================================
-- Full-replaces the post_distinctive_feature child rows on an own post that is
-- EITHER a draft OR pending_verification. The second money-neutral section allowed
-- on a paid post: it touches ONLY the evidence child rows and NEVER bounty/status/
-- owner/expires. Same server re-check as create_post: jsonb array, <= 8 features,
-- 3–80-char trimmed description, own-folder photo URL.
create or replace function public.update_post_distinctive_features(
  p_post_id              uuid,
  p_distinctive_features jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_owner        uuid := auth.uid();
  v_post         public.posts%rowtype;
  v_features     jsonb := coalesce(p_distinctive_features, '[]'::jsonb);
  v_feature      jsonb;
  v_feat_desc    text;
  v_feat_url     text;
  v_photo_url_re text := '^https?://(127\.0\.0\.1(:[0-9]+)?|[a-z0-9-]+\.supabase\.co)'
                         || '/storage/v1/object/public/post-photos/'
                         || v_owner::text || '/[^/]+$';
begin
  if v_owner is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  -- SAFETY: DRAFT + PENDING_VERIFICATION gate. This SAFE, money-neutral section is
  -- the second of only two allowed on a paid (pending_verification) post. Own +
  -- in-gate + locked, else POST_NOT_EDITABLE.
  select * into v_post
  from public.posts p
  where p.id = p_post_id
    and p.owner_id = v_owner
    and p.status = any(array['draft', 'pending_verification']::public.post_status[])
  for update;
  if not found then
    raise exception 'POST_NOT_EDITABLE';
  end if;

  -- Server re-check of the jsonb array of {"photo_url","description"} objects —
  -- IDENTICAL to create_post (same raise codes). A non-array payload is malformed.
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

  -- Full replace, SCOPED to this post (see the SAFETY NOTE at the top). description
  -- stored trimmed; position = ordinality-1 (0-based) — mirrors create_post.
  delete from public.post_distinctive_feature where post_id = p_post_id;
  insert into public.post_distinctive_feature (post_id, photo_url, description, position)
  select p_post_id,
         elem.value ->> 'photo_url',
         btrim(elem.value ->> 'description'),
         (elem.ord - 1)::int
  from jsonb_array_elements(v_features) with ordinality as elem(value, ord);

  return jsonb_build_object('post_id', p_post_id);
end;
$$;

comment on function public.update_post_distinctive_features(uuid, jsonb) is
  'SAFE per-section edit allowed on an own DRAFT or PENDING_VERIFICATION post (else POST_NOT_EDITABLE): full-replaces the post_distinctive_feature child rows (delete SCOPED to p_post_id, then reinsert with position=ordinality-1). jsonb array, <=8 (DISTINCTIVE_FEATURES_COUNT); each description 3–80 trimmed (INVALID_DISTINCTIVE_FEATURE); each photo_url an own-folder object (INVALID_DISTINCTIVE_PHOTO_URL). One of only two functions here permitted on a paid post; NEVER writes bounty/status/owner_id/expires_at. Also raises NOT_AUTHENTICATED.';

revoke execute on function public.update_post_distinctive_features(uuid, jsonb) from public;
revoke execute on function public.update_post_distinctive_features(uuid, jsonb) from anon;
grant  execute on function public.update_post_distinctive_features(uuid, jsonb) to authenticated, service_role;


-- =============================================================================
-- END OF MIGRATION
-- =============================================================================

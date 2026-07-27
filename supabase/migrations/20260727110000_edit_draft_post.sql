-- =============================================================================
-- WHAT:  Adds the two SECURITY DEFINER RPCs that power EDITING a DRAFT post in
--        the post-a-car wizard: public.get_post_for_edit(p_post_id) (fetch
--        everything needed to prefill the edit wizard) and public.update_post(...)
--        (save the edits — DRAFT ONLY). update_post mirrors create_post
--        (20260724100000, the 21-arg p_distinctive_features version) parameter for
--        parameter, validation for validation, and child-table write for
--        child-table write; the ONLY differences are (a) it targets an existing
--        own DRAFT post instead of inserting a new one, (b) it NEVER writes
--        status/owner_id/expires_at, and (c) it raises a NEW code POST_NOT_EDITABLE
--        when the post is not an own draft.
-- WHY:   The wizard now has an Edit entry point for a draft the owner has not yet
--        paid for. A draft has NO escrow taken yet (escrow is charged at Post &
--        pay, which flips draft -> pending_verification server-side — see
--        20260726100000), so re-saving its descriptive fields, photos, distinctive
--        features, V5C, and even its intended bounty is money-safe. But the SAME
--        server re-validation create_post applies to untrusted client input must
--        apply here too (the client's zod cannot be trusted), and the same
--        server-owned invariants must hold: the client may never move status, never
--        change owner_id (transfer a post), and never push expires_at out. Edit is
--        therefore a trusted server boundary exactly like create_post, hard-gated
--        to a post the caller OWNS and that is STILL a draft.
-- LINKS: docs/DOMAIN.md (post lifecycle: only a draft is client-editable; £50–£5000
--          bounty; integer pence; 90-day expiry is server-owned),
--        docs/SECURITY_AND_TRUST.md §2 (nothing public before verification; own-
--          folder photo/V5C hosting; anti spotter-tracking), §6 (RLS deny-by-
--          default; status server-only; SECURITY DEFINER hardening; owner_id/
--          expires_at server-owned),
--        supabase/migrations/20260707110712_payments_foundation.sql (posts columns,
--          post_status enum, posts_update_own_draft RLS = client UPDATE only while
--          status='draft', and the column-level UPDATE grant that EXCLUDES
--          status/owner_id/expires_at — the invariants update_post preserves),
--        supabase/migrations/20260713190000_post_a_car.sql (original create_post,
--          verification_documents table + buckets, the SECURITY DEFINER hardening
--          pattern: owner pinned, status hard-coded, own-folder path checks),
--        supabase/migrations/20260724100000_post_distinctive_features.sql (the
--          CURRENT 21-arg create_post body mirrored below — every param, raise
--          code, and child-table write),
--        supabase/migrations/20260713180000_post_detail_structured_data.sql
--          (get_post_detail: the columns surfaced + how it COARSENS a driveway
--          last-seen point for non-owners — the owner-edit fetch returns the EXACT
--          point instead, and adds the fields get_post_detail omits: plate + the
--          raw stored answers needed to rebuild the wizard).
--
-- SAFETY NOTE ON DESTRUCTIVE STATEMENTS: no schema drop/rename/truncate. update_post
--        DOES issue child-row `delete ... where post_id = p_post_id` statements
--        (post_photos, post_distinctive_feature, and — only when a new V5C path is
--        supplied — verification_documents, plus post_feature only when feature
--        keys are supplied). Those deletes are the "replace the child rows"
--        mechanism and are STRICTLY SCOPED to the single post being edited, INSIDE
--        the function's single transaction: any raise rolls the whole
--        delete+reinsert back, so a failed save never leaves a draft with missing
--        photos/features. No data outside the edited post is ever touched.
--
-- SAFETY (MONEY): the bounty CAN change on edit and is re-validated server-side
--        (BOUNTY_OUT_OF_RANGE, £50–£5000). This is safe precisely because a DRAFT
--        has NO escrow yet — the charge is only taken at Post & pay. If a paid/
--        non-draft post could reach this path a bounty change would desync the
--        escrowed amount, which is exactly why the POST_NOT_EDITABLE draft-only
--        gate (and the RLS draft-only rule it mirrors) exists.
-- =============================================================================


-- =============================================================================
-- 1. RPC: get_post_for_edit(p_post_id uuid) -> jsonb   (SECURITY DEFINER, owner-only)
-- =============================================================================
-- Returns EVERYTHING needed to rebuild the post-a-car wizard answers for an OWN
-- post, so the edit screen can prefill every step. Unlike get_post_detail this is
-- an OWNER-ONLY fetch: it returns the EXACT last-seen lat/lng (get_post_detail
-- coarsens a driveway point for non-owners; here the caller IS the owner, whose
-- own home point is theirs to see) and it ADDS the fields get_post_detail omits —
-- the raw plate and the raw stored wizard answers (owner_note, desc_drives, etc.).
--
-- SAFETY: owner-only. The post must exist AND be owned by the caller, else raise
--   the stable code NOT_FOUND (a single opaque code for "no such post OR not
--   yours" so a stranger cannot probe which post ids exist). There is NO status
--   restriction on the FETCH: the client only surfaces Edit for drafts, but
--   fetching any of the caller's OWN posts in any status is harmless (they can
--   already read them via posts_select_own RLS). WRITE gating lives in update_post.
--
-- SECURITY DEFINER + fixed search_path so ST_Y/ST_X resolve whether PostGIS is in
-- public (fresh local) or extensions (Supabase-hosted). STABLE: read-only.
create or replace function public.get_post_for_edit(p_post_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_owner uuid := auth.uid();
  v_post  public.posts%rowtype;
begin
  -- SAFETY: must be signed in (grants exclude anon; belt-and-braces backstop).
  if v_owner is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  -- SAFETY: owner-only gate. Fold "no such post" and "not your post" into ONE
  -- opaque NOT_FOUND so an attacker cannot enumerate post ids by error code.
  select * into v_post
  from public.posts p
  where p.id = p_post_id
    and p.owner_id = v_owner;
  if not found then
    raise exception 'NOT_FOUND';
  end if;

  return jsonb_build_object(
    -- Scalar wizard answers (raw stored values — this is the OWNER's own draft).
    'post_id',                 v_post.id,
    'status',                  v_post.status,
    'plate',                   v_post.plate,
    'make',                    v_post.make,
    'model',                   v_post.model,
    'colour',                  v_post.colour,
    'year',                    v_post.year,
    'body_type',               v_post.body_type,
    'distinguishing_features', v_post.distinguishing_features,
    'owner_note',              v_post.owner_note,
    'desc_recognise',          v_post.desc_recognise,
    'desc_drives',             v_post.desc_drives,
    'stolen_from',             v_post.stolen_from,
    'keys_taken',              v_post.keys_taken,
    'last_seen_at',            v_post.last_seen_at,
    'last_seen_area',          v_post.last_seen_area,
    'bounty_amount_pence',     v_post.bounty_amount_pence,

    -- EXACT last-seen point (owner fetch — never coarsened). ST_Y = latitude,
    -- ST_X = longitude; null when no point was captured.
    'last_seen_lat', case when v_post.last_seen_location is null then null
                          else ST_Y(v_post.last_seen_location::geometry) end,
    'last_seen_lng', case when v_post.last_seen_location is null then null
                          else ST_X(v_post.last_seen_location::geometry) end,

    -- Ordered hero photos [{url, position}] to repopulate the photo step. [] if none.
    'photos', coalesce(
      (select jsonb_agg(
                jsonb_build_object('url', ph.url, 'position', ph.position)
                order by ph.position)
         from public.post_photos ph
        where ph.post_id = v_post.id),
      '[]'::jsonb),

    -- Ordered distinctive features [{photo_url, description, position}]. [] if none.
    'distinctive_features', coalesce(
      (select jsonb_agg(
                jsonb_build_object(
                  'photo_url',   df.photo_url,
                  'description', df.description,
                  'position',    df.position)
                order by df.position)
         from public.post_distinctive_feature df
        where df.post_id = v_post.id),
      '[]'::jsonb),

    -- The stored V5C path (private-bucket object name), or null if none uploaded.
    -- One doc per post today; take the most recent defensively.
    'verification_path', (
      select vd.storage_path
        from public.verification_documents vd
       where vd.post_id = v_post.id
       order by vd.created_at desc
       limit 1)
  );
end;
$$;

comment on function public.get_post_for_edit(uuid) is
  'Owner-only prefill fetch for the edit-a-draft wizard. SECURITY DEFINER (bypasses RLS); the post must exist AND be owned by the caller or it raises NOT_FOUND (single opaque code so ids cannot be probed). No status restriction on the fetch. Returns every raw wizard answer (incl. plate + EXACT last_seen_lat/lng — never coarsened, unlike get_post_detail), ordered photos[], ordered distinctive_features[], and the stored verification_path (or null). Also raises NOT_AUTHENTICATED.';

-- SAFETY: revoke the default PUBLIC execute + Supabase's auto anon grant; give
-- execute to authenticated + service_role only (editing needs a signed-in owner).
revoke execute on function public.get_post_for_edit(uuid) from public;
revoke execute on function public.get_post_for_edit(uuid) from anon;
grant  execute on function public.get_post_for_edit(uuid) to authenticated, service_role;


-- =============================================================================
-- 2. RPC: update_post(...) -> jsonb   (SECURITY DEFINER — the DRAFT-edit write boundary)
-- =============================================================================
-- Saves edits to an existing OWN DRAFT post and returns { "post_id", "status" }
-- (status is echoed for parity with create_post; it is ALWAYS still 'draft' —
-- update_post never changes it). The parameter list is p_post_id FIRST, then the
-- SAME parameters as the 21-arg create_post in the same order and types.
--
-- SAFETY (Tier 1 — read before editing anything below):
--   * SECURITY DEFINER, so it BYPASSES RLS and the posts client column grants —
--     deliberately, so this one trusted path can rewrite the server-owned
--     descriptive columns (year/body_type/stolen_from/keys_taken/desc_*) a client
--     cannot. It STILL never writes status, owner_id, or expires_at (see the
--     UPDATE below — those columns are not in the SET list), preserving the
--     foundation migration's invariants even though RLS/column grants are bypassed.
--   * DRAFT-ONLY HARD GATE. The post must exist, be owned by the caller, AND be
--     status='draft', else POST_NOT_EDITABLE. This mirrors the posts_update_own_draft
--     RLS rule (client UPDATE only while draft) and the money invariant that a
--     paid/non-draft post is read-only to the client. The row is locked FOR UPDATE
--     so a concurrent Post & pay transition cannot race the edit.
--   * ALL create_post validation is re-applied IDENTICALLY, with the SAME raise
--     codes, on the untrusted client input (plate/bounty/photos/paths/features).
--   * Plate uniqueness EXCLUDES the post being edited (id <> p_post_id) so
--     re-saving an unchanged plate does not collide with itself (PLATE_IN_USE).
--   * Single transaction: the UPDATE + every child delete+reinsert are atomic; any
--     raise rolls the whole save back (no half-updated draft, no lost photos).
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
  if p_bounty_amount_pence < 5000 or p_bounty_amount_pence > 500000 then
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

comment on function public.update_post(
  uuid, text, text, text, text, int, text, text, text, text, text, text, text,
  timestamptz, double precision, double precision, text, int, text[], text[], text, jsonb
) is
  'The DRAFT-edit write boundary for the post-a-car wizard. SECURITY DEFINER: re-validates the same untrusted input as create_post (same raise codes) and atomically UPDATEs an existing OWN DRAFT post + REPLACEs its photos/distinctive-features child rows, replacing feature tags / V5C only when those params are supplied (null V5C keeps the existing logbook). HARD-GATED to a post that exists, is owned by the caller, and is still status=draft — else POST_NOT_EDITABLE (a NEW code mirroring the posts_update_own_draft RLS rule; a paid/non-draft post is never client-editable). NEVER writes status, owner_id, or expires_at. Plate uniqueness excludes the edited post (id <> p_post_id) so re-saving an unchanged plate is allowed. Raises: NOT_AUTHENTICATED, POST_NOT_EDITABLE, INVALID_PLATE, PLATE_IN_USE, MISSING_REQUIRED, BOUNTY_OUT_OF_RANGE, PHOTO_COUNT, INVALID_PHOTO_URL, INVALID_VERIFICATION_PATH, DISTINCTIVE_FEATURES_COUNT, INVALID_DISTINCTIVE_FEATURE, INVALID_DISTINCTIVE_PHOTO_URL, INVALID_STOLEN_FROM, INVALID_KEYS_TAKEN.';

-- SAFETY: functions default to EXECUTE granted to PUBLIC, and Supabase's ALTER
-- DEFAULT PRIVILEGES re-grants anon at CREATE time. Lock both down and grant
-- deliberately to authenticated + service_role ONLY — NOT anon (editing a draft
-- requires a signed-in owner; the function raises NOT_AUTHENTICATED for a null
-- auth.uid() regardless as a backstop).
revoke execute on function public.update_post(
  uuid, text, text, text, text, int, text, text, text, text, text, text, text,
  timestamptz, double precision, double precision, text, int, text[], text[], text, jsonb
) from public;
revoke execute on function public.update_post(
  uuid, text, text, text, text, int, text, text, text, text, text, text, text,
  timestamptz, double precision, double precision, text, int, text[], text[], text, jsonb
) from anon;
grant execute on function public.update_post(
  uuid, text, text, text, text, int, text, text, text, text, text, text, text,
  timestamptz, double precision, double precision, text, int, text[], text[], text, jsonb
) to authenticated, service_role;


-- =============================================================================
-- END OF MIGRATION
-- =============================================================================

-- =============================================================================
-- WHAT:  Adds owner-authored "distinctive features" to the post-a-car wizard —
--        photo+description evidence pairs on a post (e.g. a photo of a cracked
--        nearside wing mirror captioned "Cracked nearside wing mirror"). Creates
--        public.post_distinctive_feature (ordered rows, deny-by-default RLS whose
--        SELECT mirrors post_photos), and extends the SECURITY DEFINER RPC
--        public.create_post() with a trailing p_distinctive_features jsonb param
--        that server-re-validates + atomically inserts those rows alongside the
--        post/photos/feature-tags/verification-doc.
-- WHY:   Free-text distinguishing_features (a single string on posts) can't carry
--        per-mark PHOTO evidence. The wizard now lets an owner attach up to 8
--        specific, photographed identifying marks so spotters can match a car
--        with confidence. These are owner-authored evidence exactly as visible as
--        the post itself, so their read visibility must track the parent post
--        (mirroring post_photos) and their WRITE must run only through the trusted
--        create_post boundary — never a client DML grant.
-- LINKS: docs/DOMAIN.md (post lifecycle; draft fields incl. distinguishing marks),
--        docs/SECURITY_AND_TRUST.md §2 (nothing public before verification; active
--          posts public), §3 (own-folder photo hosting; spotter-tracking vector),
--          §6 (RLS deny-by-default; SECURITY DEFINER hardening; status server-only),
--        supabase/migrations/20260713140000_post_detail.sql (post_photos table +
--          the two SELECT policies mirrored below),
--        supabase/migrations/20260713190000_post_a_car.sql (create_post write
--          boundary; post_photos/post_feature/verification_documents inserts),
--        supabase/migrations/20260713192000_create_post_validate_paths.sql (the
--          own-folder photo-URL regex reused here for the feature photos),
--        supabase/migrations/20260713195000_create_post_plate_canon_fix.sql (the
--          LATEST full create_post body — reproduced verbatim below + the new
--          distinctive-feature logic).
--
-- ############################################################################
-- ## SAFETY NOTE — CONTAINS ONE DESTRUCTIVE STATEMENT (a DROP FUNCTION):     ##
-- ##                                                                          ##
-- ##   DROP FUNCTION public.create_post(<the 20-argument signature>)          ##
-- ##                                                                          ##
-- ## This migration adds a 21st parameter to create_post. Because a function's##
-- ## identity includes its argument types, a plain CREATE OR REPLACE would    ##
-- ## NOT replace the existing function — it would create a SECOND overload,   ##
-- ## leaving the old un-validated 20-arg body callable AND making create_post ##
-- ## calls ambiguous ("function ... is not unique"). So we DROP the old 20-arg##
-- ## signature and CREATE the single new 21-arg version. The new trailing     ##
-- ## parameter has a default ('[]'::jsonb), so existing callers that pass 20  ##
-- ## positional args, or PostgREST callers that omit p_distinctive_features by ##
-- ## name, resolve to the new function unchanged — no client change required. ##
-- ## Nothing else is dropped/renamed/truncated; the new table is additive.    ##
-- ############################################################################
-- =============================================================================


-- =============================================================================
-- 1. TABLE: post_distinctive_feature
-- Ordered owner-authored photo+description evidence pairs for a post.
-- =============================================================================
create table public.post_distinctive_feature (
  id          uuid primary key default gen_random_uuid(),

  -- The post this evidence belongs to. ON DELETE CASCADE: a distinctive feature
  -- is wholly owned by its post and carries no independent value or money state,
  -- so it dies with the post — identical choice to post_photos/post_feature
  -- (contrast payments' ON DELETE RESTRICT). NOTE: this cascades only the DB row;
  -- the underlying Storage object in post-photos is cleaned up by the same
  -- retention/erasure path as the hero photos.
  post_id     uuid not null references public.posts (id) on delete cascade,

  -- Public URL of the stored evidence image (a post-photos bucket object under
  -- the owner's own folder). create_post validates this against the SAME
  -- own-folder host regex as the hero photos (anti spotter-tracking, §3).
  photo_url   text not null,

  -- The owner's caption for this mark (e.g. "Cracked nearside wing mirror").
  -- Bounded 3–80 chars (measured trimmed) so it is a short, human label rather
  -- than an unbounded blob; create_post re-checks the same bound before insert.
  description text not null
    constraint post_distinctive_feature_description_len_chk
      check (char_length(btrim(description)) between 3 and 80),

  -- Display order within the post's distinctive-feature list; 0-based, matching
  -- the order the wizard sent them (post_photos-style). CHECK keeps it >= 0.
  position    int not null
    constraint post_distinctive_feature_position_nonneg_chk
      check (position >= 0),

  created_at  timestamptz not null default now()
);

comment on table public.post_distinctive_feature is
  'Ordered owner-authored photo+description evidence pairs for a post (e.g. "Cracked nearside wing mirror"). Visibility mirrors the parent post (see RLS below). Rows are written ONLY by create_post (SECURITY DEFINER) / service role — no client write policy exists.';
comment on column public.post_distinctive_feature.photo_url is
  'Public URL of the evidence image (own-folder post-photos object). Validated by create_post against the same own-folder host regex as the hero photos.';
comment on column public.post_distinctive_feature.description is
  'Owner caption for the mark, 3–80 chars trimmed (CHECK). Owner-authored; shown on post detail.';

-- Index for the hot read (fetch a post's features in display order) which also
-- covers the post_id equality used by both RLS SELECT policies below.
create index post_distinctive_feature_post_id_position_idx
  on public.post_distinctive_feature (post_id, position);

alter table public.post_distinctive_feature enable row level security;

-- SAFETY: under this project's config (auto_expose_new_tables unset in
-- config.toml) a new public table auto-grants NO data privileges, so the SELECT
-- policies below are dead without an explicit table-level SELECT grant. Grant
-- SELECT to anon + authenticated (a feature is exactly as visible as its post,
-- and active posts are public to anon). NO insert/update/delete grant to clients
-- — writes are create_post / service-role only. service_role bypasses RLS but is
-- not auto-granted, so give it full DML.
grant select on public.post_distinctive_feature to anon, authenticated;
grant select, insert, update, delete on public.post_distinctive_feature to service_role;

-- SAFETY (anti-stalking, mirrors post_photos_select_active_public): anyone (incl.
-- anon) may read a distinctive feature ONLY when its parent post is 'active'. No
-- feature of a draft/pending/recovered/cancelled/etc. post is publicly readable.
create policy post_distinctive_feature_select_active_public
  on public.post_distinctive_feature
  for select
  to anon, authenticated
  using (
    exists (
      select 1 from public.posts p
      where p.id = post_distinctive_feature.post_id
        and p.status = 'active'
    )
  );

-- SAFETY (mirrors post_photos_select_own): an owner may read the distinctive
-- features of their OWN post in ANY status (to review a draft/closed post).
create policy post_distinctive_feature_select_own
  on public.post_distinctive_feature
  for select
  to authenticated
  using (
    exists (
      select 1 from public.posts p
      where p.id = post_distinctive_feature.post_id
        and p.owner_id = (select auth.uid())
    )
  );

-- SAFETY: NO insert/update/delete policy exists -> those are denied by default
-- for anon/authenticated. Feature writes run only through create_post (SECURITY
-- DEFINER) or the service role. Do not add a client write policy here without
-- reviewing SECURITY_AND_TRUST.md §6.


-- =============================================================================
-- 2. DROP the old 20-argument create_post  (see the SAFETY NOTE at the top)
-- =============================================================================
-- DESTRUCTIVE: removing the previous signature so the new 21-arg version below
-- is the single, unambiguous create_post. `if exists` keeps this idempotent /
-- safe on a DB where a prior run already dropped it.
drop function if exists public.create_post(
  text, text, text, text, int, text, text, text, text, text, text, text,
  timestamptz, double precision, double precision, text, int, text[], text[], text
);


-- =============================================================================
-- 3. RPC: create_post(...) -> jsonb   (SECURITY DEFINER — the write boundary)
-- =============================================================================
-- Body reproduced verbatim from 20260713195000 (the latest full definition) with
-- ONLY the distinctive-features additions layered on:
--   * new trailing param p_distinctive_features jsonb default '[]'::jsonb,
--   * server re-validation of that array (count / description / photo URL),
--   * an insert into post_distinctive_feature after the verification-doc insert.
-- Every existing parameter, validation, and insert is unchanged.
--
-- SAFETY (Tier 1 — read before editing): SECURITY DEFINER, so it BYPASSES RLS and
--   the posts client column grants. owner_id is pinned to the caller; status is
--   HARD-CODED 'draft'; there is NO status parameter. auth.uid() reads the
--   CALLER's JWT claim under SECURITY DEFINER. ALL validation is a SERVER re-check
--   of untrusted client input. The whole body is one transaction, so the post +
--   photos + feature tags + verification-doc + distinctive features are inserted
--   ATOMICALLY — any raise rolls the entire thing back (no orphan draft).
--
-- The new distinctive-feature photo URLs are validated against the SAME
-- own-folder post-photos host regex as p_photo_urls, closing the identical
-- spotter-tracking vector (§3) for the evidence images.
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
  p_distinctive_features    jsonb default '[]'::jsonb
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
  -- Distinctive-feature validation scratch vars (this migration).
  v_features    jsonb := coalesce(p_distinctive_features, '[]'::jsonb);
  v_feature     jsonb;
  v_feat_desc   text;
  v_feat_url    text;
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
  insert into public.posts (
    owner_id, plate, make, model, colour,
    year, body_type, distinguishing_features, owner_note,
    desc_recognise, desc_drives, stolen_from, keys_taken,
    last_seen_at, last_seen_location, last_seen_area,
    bounty_amount_pence, status, expires_at
  )
  values (
    v_owner, v_plate, p_make, p_model, p_colour,
    p_year, p_body_type, p_distinguishing_features, p_owner_note,
    p_desc_recognise, p_desc_drives, p_stolen_from, p_keys_taken,
    p_last_seen_at,
    ST_SetSRID(ST_MakePoint(p_last_seen_lng, p_last_seen_lat), 4326)::geography,
    p_last_seen_area,
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
  text, text, text, text, int, text, text, text, text, text, text, text,
  timestamptz, double precision, double precision, text, int, text[], text[], text, jsonb
) is
  'The write boundary for the post-a-car wizard. SECURITY DEFINER: pins owner_id to the caller, HARD-CODES status=draft, sets expires_at=now()+90d, and atomically inserts the post + photos + feature tags + verification-doc row + distinctive features. Re-validates plate (optional/format/one-active-per-plate), bounty £50–£5000, 3–6 photos, own-folder photo/V5C paths, the stolen_from/keys_taken enums, and up to 8 distinctive features (each: 3–80-char trimmed description + own-folder photo URL). Raises: NOT_AUTHENTICATED, INVALID_PLATE, PLATE_IN_USE, MISSING_REQUIRED, BOUNTY_OUT_OF_RANGE, PHOTO_COUNT, INVALID_PHOTO_URL, INVALID_VERIFICATION_PATH, DISTINCTIVE_FEATURES_COUNT, INVALID_DISTINCTIVE_FEATURE, INVALID_DISTINCTIVE_PHOTO_URL, INVALID_STOLEN_FROM, INVALID_KEYS_TAKEN. Only ever creates drafts; escrow success advances the lifecycle later, server-side.';


-- =============================================================================
-- 4. FUNCTION GRANTS  (new 21-arg signature)
-- =============================================================================
-- SAFETY: functions default to EXECUTE granted to PUBLIC, and Supabase's ALTER
-- DEFAULT PRIVILEGES re-grants anon at CREATE time. Lock both down and grant
-- deliberately to authenticated + service_role ONLY — NOT anon (posting a car
-- requires a signed-in account; the function raises NOT_AUTHENTICATED for a null
-- auth.uid() regardless as a backstop).
revoke execute on function public.create_post(
  text, text, text, text, int, text, text, text, text, text, text, text,
  timestamptz, double precision, double precision, text, int, text[], text[], text, jsonb
) from public;
revoke execute on function public.create_post(
  text, text, text, text, int, text, text, text, text, text, text, text,
  timestamptz, double precision, double precision, text, int, text[], text[], text, jsonb
) from anon;
grant execute on function public.create_post(
  text, text, text, text, int, text, text, text, text, text, text, text,
  timestamptz, double precision, double precision, text, int, text[], text[], text, jsonb
) to authenticated, service_role;


-- =============================================================================
-- END OF MIGRATION
-- =============================================================================

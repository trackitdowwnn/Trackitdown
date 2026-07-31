-- =============================================================================
-- WHAT:  The two posts columns the spotter-alert push needs, plus the write
--        paths that populate one of them:
--          1. posts.alerts_sent_at timestamptz — SERVER-ONLY. The
--             notify-spotters Edge Function's idempotency CLAIM: it wins the
--             right to alert a post exactly once. Excluded from every client
--             grant (same posture as recovered_at / closed_at). Backed by the
--             partial index posts_alerts_pending_idx.
--          2. posts.last_seen_locality text (<= 80, named CHECK) — the
--             district/city-grain sibling of last_seen_area. This is a SAFETY
--             column: it is the ONLY place label the alert push body may read.
--             Client-writable on an own draft exactly like last_seen_area, so
--             it joins the column-limited insert/update grants.
--          3. create_post(...) re-issued with a trailing, defaulted
--             p_last_seen_locality text
--             parameter (positioned with the rest of the last-seen block, right
--             after p_last_seen_area) that persists the column.
--          4. update_post_last_seen(...) re-issued with a trailing
--             p_last_seen_locality text default null, so the per-section
--             draft-edit writes all four last-seen fields together.
--          5. get_post_detail(uuid) re-issued to return last_seen_locality
--             **to the post's OWNER ONLY** — the key is absent from every
--             non-owner payload — so the draft-edit round-trip (LastSeenEditor
--             prefills from get_post_detail, then full-replaces the section)
--             cannot blank a locality the owner never touched.
-- WHY:   (a) IDEMPOTENCY WITHOUT TOUCHING THE MONEY FUNCTION. posts.status
--        becomes 'active' only inside mark_post_payment_held, called by the
--        stripe-webhook Edge Function, which deliberately records its dedupe
--        row AFTER the handler has committed (so a crash mid-processing is
--        never silently swallowed). A Stripe retry therefore RE-RUNS the whole
--        handler. If notify-spotters hangs off that path with no claim of its
--        own, a retry fans a second push out to every spotter within 50 miles.
--        alerts_sent_at lets notify-spotters claim the post itself:
--            update public.posts set alerts_sent_at = now()
--             where id = p_post_id and status = 'active' and alerts_sent_at is null
--            returning id;
--        Zero rows back = already alerted OR not active; either way exit
--        quietly. That is the whole safety property, and it needs NO change to
--        the money-critical mark_post_payment_held.
--        (b) THE ALERT MUST NOT BROADCAST A STREET. last_seen_area already
--        exists and is public (it titles the "Recently stolen in <Area>"
--        carousels), but it is populated from the LocationPicker's raw
--        reverse-geocoded addressLabel, which CAN be street-grain — the
--        picker's own tests carry values like
--        'Shenley Rd, Hemel Hempstead, HP2 7RJ'. A street in a feed carousel
--        is one thing; the same string pushed to every spotter within 50 miles
--        is another. Worse: for a stolen_from = 'driveway' post the last-seen
--        POINT is the victim's HOME and get_post_detail coarsens it to a ~1km
--        grid for non-owners — while the area TEXT passes through intact. So
--        the alert reads last_seen_locality ONLY, falling back to the literal
--        string 'your area' when it is null, and NEVER reads last_seen_area.
--        This is the same split sightings already makes between street-grain
--        area_label (owner-only) and district-grain locality (public) under
--        ADR-0008.
-- LINKS: docs/DOMAIN.md (Notifications — the PostGIS radius fan-out when a post
--          goes active; Post content — the driveway/home SAFETY rule),
--        docs/SECURITY_AND_TRUST.md §1 (report-don't-approach; minimisation),
--          §2 (anti-stalking; location coarsening), §6 (RLS deny-by-default;
--          status transitions are server-only),
--        docs/decisions/ADR-0008-public-sighting-entries.md (the street-grain
--          vs district-grain column split this mirrors),
--        supabase/migrations/20260711130000_home_feed_location_and_rpcs.sql
--          (added last_seen_area + recovered_at; the column-grant + partial
--          index house patterns re-used here),
--        supabase/migrations/20260801130000_sighting_timeline.sql
--          (sightings.locality — the precedent column + its NEVER-backfill
--          rule),
--        supabase/migrations/20260724100000_post_distinctive_features.sql
--          (the LATEST create_post body, reproduced below + the new param),
--        supabase/migrations/20260727130000_edit_post_sections.sql
--          (the LATEST update_post_last_seen body, reproduced below),
--        supabase/migrations/20260801150000_sighting_context_v2.sql
--          (the LATEST get_post_detail body, reproduced below),
--        supabase/migrations/20260730100000_live_on_payment.sql
--          (mark_post_payment_held: draft -> active, the transition this claim
--          protects; also the re-assert-the-grants pattern),
--        supabase/functions/stripe-webhook/index.ts (records the dedupe row
--          AFTER processing — the reason a claim is needed at all).
--
-- ############################################################################
-- ## SAFETY NOTE ON DESTRUCTIVE STATEMENTS — THIS MIGRATION DROPS TWO        ##
-- ## FUNCTION SIGNATURES (no table, column, policy, index or DATA is         ##
-- ## dropped, renamed or truncated):                                         ##
-- ##                                                                          ##
-- ##   1. DROP FUNCTION public.create_post(<the 21-argument signature>)       ##
-- ##   2. DROP FUNCTION public.update_post_last_seen(uuid, timestamptz,       ##
-- ##                       double precision, double precision, text)          ##
-- ##                                                                          ##
-- ## A function's identity includes its argument types, so CREATE OR REPLACE  ##
-- ## would NOT replace either one — it would leave a SECOND overload live,    ##
-- ## making the old un-locality-aware body callable and (for the defaulted    ##
-- ## update_post_last_seen case) making 5-argument calls ambiguous            ##
-- ## ("function ... is not unique"). Both drops target signatures created by  ##
-- ## EARLIER migrations in this chain (20260724100000 / 20260727130000), so   ##
-- ## supabase/tests/migrationChain.test.ts replays cleanly. `if exists` keeps ##
-- ## each drop idempotent.                                                    ##
-- ##                                                                          ##
-- ## BOTH new parameters are TRAILING and DEFAULT TO NULL, deliberately.      ##
-- ## p_last_seen_locality reads better beside p_last_seen_area, but a         ##
-- ## non-defaulted parameter inserted mid-list breaks every POSITIONAL caller ##
-- ## — and create_post has ~25 of them across the SQL verification suites.    ##
-- ## scripts/test-db.sh runs those under `set -e`, so a single 42883 stops    ##
-- ## the run before anon_role_verification.sql (the Tier 1 deny-by-default CI ##
-- ## gate) ever executes: the suite would not fail, it would simply never run.##
-- ## Trailing defaults keep every existing call valid and cost only the       ##
-- ## pleasing argument order. The client is unaffected either way — PostgREST ##
-- ## sends NAMED arguments.                                                   ##
-- ############################################################################
-- =============================================================================


-- =============================================================================
-- 1. POSTS: new columns
-- =============================================================================

alter table public.posts
  -- SAFETY (SERVER-ONLY): the spotter-alert CLAIM. Written ONLY by the
  -- notify-spotters Edge Function (service_role) via the conditional update
  -- described in the header; excluded from BOTH client column grants below,
  -- exactly like recovered_at and closed_at. A client-writable value here would
  -- let an owner either suppress their own post's alerts (set it early) or, by
  -- clearing it, re-fan a push to every spotter in range at will.
  add column alerts_sent_at timestamptz,

  -- SAFETY (COARSE BY CONSTRUCTION): district/city-grain place label captured
  -- at posting time from the reverse-geocode's STRUCTURED fields
  -- (district ?? city ?? subregion), never by string-parsing the display label.
  -- This is the ONLY place label the spotter-alert push may read. Bounded to 80
  -- chars like last_seen_area / sightings.locality — it is client-supplied text
  -- that ends up in a notification body.
  add column last_seen_locality text
    constraint posts_last_seen_locality_len
      check (char_length(last_seen_locality) <= 80);

comment on column public.posts.alerts_sent_at is
  'Spotter-alert idempotency CLAIM. Written ONLY by the notify-spotters Edge Function (service_role), which claims the post before sending: update posts set alerts_sent_at = now() where id = $1 and status = ''active'' and alerts_sent_at is null returning id — zero rows means already alerted OR not active, so it exits quietly. Needed because stripe-webhook records its dedupe row AFTER processing, so a Stripe retry re-runs mark_post_payment_held''s whole handler; this claim makes the fan-out retry-safe WITHOUT touching that money function. Excluded from every client grant (same posture as recovered_at / closed_at).';

comment on column public.posts.last_seen_locality is
  'SAFETY COLUMN. The district/city-grain sibling of last_seen_area, captured at posting time from the reverse-geocode''s structured fields (district/city/subregion) — the same street-grain vs district-grain split sightings makes between area_label (owner-only) and locality (public, ADR-0008). The spotter-alert push body reads THIS COLUMN ONLY and falls back to the literal ''your area'' when it is null; it must NEVER read last_seen_area, which comes from the LocationPicker''s raw addressLabel and can be street-grain (e.g. ''Shenley Rd, Hemel Hempstead, HP2 7RJ'') — and which, for a stolen_from=''driveway'' post, would broadcast the victim''s home street even though get_post_detail coarsens that post''s POINT to a ~1km grid. NEVER backfill this from last_seen_area: string-parsing display text would smuggle street names into the push. Nullable, <= 80 chars. Client-writable on an own DRAFT only (create_post / update_post_last_seen); returned by get_post_detail to the OWNER only.';


-- =============================================================================
-- 2. POSTS: index for the alert claim
-- =============================================================================

-- Partial btree serving the "active but never alerted" scan and the claim
-- update's WHERE clause. Partial (and index-only on id) keeps it tiny: rows
-- leave the index the moment they are claimed, so it holds only the posts that
-- still owe a fan-out. Same partial style as posts_active_area_idx /
-- posts_recovered_recent_idx.
create index posts_alerts_pending_idx
  on public.posts (id)
  where status = 'active' and alerts_sent_at is null;


-- =============================================================================
-- 3. POSTS: extend the client column grants
-- =============================================================================
-- SAFETY: 20260707110712 revoked table-wide INSERT/UPDATE from anon/
-- authenticated and granted only an explicit column list, last re-issued in
-- full by 20260711130000. We re-issue the full lists here, ADDING
-- last_seen_locality (client-editable on an owner's own draft, exactly like
-- last_seen_area). alerts_sent_at is deliberately ABSENT from both grants, as
-- are recovered_at / closed_at / status / owner_id / id / expires_at — those
-- are server-owned. The draft-only RLS policies from 20260707110712 still
-- govern which ROWS these grants can touch, and in practice every real write
-- goes through the SECURITY DEFINER RPCs below. service_role already holds
-- table-level DML, so it covers both new columns (including the alert claim).
grant insert (owner_id, plate, make, model, colour, bounty_amount_pence,
              last_seen_at, last_seen_location, last_seen_area,
              last_seen_locality)
  on public.posts to authenticated;
grant update (plate, make, model, colour, bounty_amount_pence,
              last_seen_at, last_seen_location, last_seen_area,
              last_seen_locality)
  on public.posts to authenticated;


-- =============================================================================
-- 4. DROP the old 21-argument create_post  (see the SAFETY NOTE at the top)
-- =============================================================================
-- DESTRUCTIVE: removing the signature created by 20260724100000 so the new
-- 22-arg version below is the single, unambiguous create_post. `if exists`
-- keeps this idempotent / safe on a DB where a prior run already dropped it.
drop function if exists public.create_post(
  text, text, text, text, int, text, text, text, text, text, text, text,
  timestamptz, double precision, double precision, text, int, text[], text[], text, jsonb
);


-- =============================================================================
-- 5. RPC: create_post(...) -> jsonb   (SECURITY DEFINER — the write boundary)
-- =============================================================================
-- Body reproduced BYTE-FOR-BYTE from 20260724100000 (the latest full definition)
-- with EXACTLY three functional changes (plus the comment lines flagging them):
--   * the new parameter p_last_seen_locality text, TRAILING and defaulted to
--     null so every positional caller keeps working (see the banner above —
--     it reads better beside p_last_seen_area, but that placement silently
--     disabled the whole test:db run),
--   * one declare (v_locality) that trims it and maps '' -> NULL, so a blank
--     label can never suppress the push's 'your area' fallback with an empty
--     string,
--   * last_seen_locality added to the posts INSERT column list + values.
-- Every existing parameter, validation, raise code, and child-row insert is
-- unchanged.
--
-- Length is left to the posts_last_seen_locality_len column CHECK, exactly as
-- last_seen_area is left to posts_last_seen_area_len — no new raise code, so
-- the client's existing error mapping is untouched.
--
-- SAFETY (Tier 1 — read before editing): SECURITY DEFINER, so it BYPASSES RLS and
--   the posts client column grants. owner_id is pinned to the caller; status is
--   HARD-CODED 'draft'; there is NO status parameter and NO alerts_sent_at
--   parameter (the alert claim is service-role-only). auth.uid() reads the
--   CALLER's JWT claim under SECURITY DEFINER. ALL validation is a SERVER re-check
--   of untrusted client input. The whole body is one transaction, so the post +
--   photos + feature tags + verification-doc + distinctive features are inserted
--   ATOMICALLY — any raise rolls the entire thing back (no orphan draft).
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
  'The write boundary for the post-a-car wizard. SECURITY DEFINER: pins owner_id to the caller, HARD-CODES status=draft, sets expires_at=now()+90d, and atomically inserts the post + photos + feature tags + verification-doc row + distinctive features. Re-validates plate (optional/format/one-active-per-plate), bounty £50–£5000, 3–6 photos, own-folder photo/V5C paths, the stolen_from/keys_taken enums, and up to 8 distinctive features (each: 3–80-char trimmed description + own-folder photo URL). p_last_seen_locality (20260802110000) is the COARSE district/city label the spotter-alert push reads — trimmed, empty -> null, bounded by the posts_last_seen_locality_len CHECK; it is deliberately separate from p_last_seen_area, which can be street-grain and must never reach a push. Never writes alerts_sent_at (service-role claim). Raises: NOT_AUTHENTICATED, INVALID_PLATE, PLATE_IN_USE, MISSING_REQUIRED, BOUNTY_OUT_OF_RANGE, PHOTO_COUNT, INVALID_PHOTO_URL, INVALID_VERIFICATION_PATH, DISTINCTIVE_FEATURES_COUNT, INVALID_DISTINCTIVE_FEATURE, INVALID_DISTINCTIVE_PHOTO_URL, INVALID_STOLEN_FROM, INVALID_KEYS_TAKEN. Only ever creates drafts; escrow success advances the lifecycle later, server-side.';

-- SAFETY: functions default to EXECUTE granted to PUBLIC, and this project ships
-- ALTER DEFAULT PRIVILEGES that re-grant anon at CREATE time — so naming `anon`
-- in the revoke is REQUIRED, not belt-and-braces. Granted to authenticated +
-- service_role ONLY (posting a car requires a signed-in account; the function
-- raises NOT_AUTHENTICATED for a null auth.uid() regardless as a backstop).
revoke execute on function public.create_post(
  -- NOTE the trailing `text`: p_last_seen_locality is the LAST parameter, not
  -- mid-list beside p_last_seen_area (see the banner). Postgres resolves
  -- comment/revoke/grant by exact signature, so this list must track the
  -- definition — a stale copy here fails the migration with 42883.
  text, text, text, text, int, text, text, text, text, text, text, text,
  timestamptz, double precision, double precision, text, int, text[], text[], text, jsonb, text
) from public, anon;
grant execute on function public.create_post(
  -- NOTE the trailing `text`: p_last_seen_locality is the LAST parameter, not
  -- mid-list beside p_last_seen_area (see the banner). Postgres resolves
  -- comment/revoke/grant by exact signature, so this list must track the
  -- definition — a stale copy here fails the migration with 42883.
  text, text, text, text, int, text, text, text, text, text, text, text,
  timestamptz, double precision, double precision, text, int, text[], text[], text, jsonb, text
) to authenticated, service_role;


-- =============================================================================
-- 6. DROP the old 5-argument update_post_last_seen  (see the SAFETY NOTE above)
-- =============================================================================
-- DESTRUCTIVE: removing the signature created by 20260727130000. The new
-- 6th parameter DEFAULTS to null, so leaving the old overload live would make
-- every 5-argument call ambiguous ("function ... is not unique"). `if exists`
-- keeps this idempotent.
drop function if exists public.update_post_last_seen(
  uuid, timestamptz, double precision, double precision, text
);


-- =============================================================================
-- 7. RPC: update_post_last_seen(...)   (DRAFT-ONLY — last-seen point + labels)
-- =============================================================================
-- Body reproduced BYTE-FOR-BYTE from 20260727130000 with EXACTLY three functional
-- changes (plus the comment flagging them, and the parameter-list realignment):
-- the trailing p_last_seen_locality text default null parameter, one v_locality
-- declare (trim, '' -> NULL — same normalisation as create_post), and
-- last_seen_locality in the SET list. Writes last_seen_at, last_seen_location
-- (rebuilt from lng/lat exactly as create_post does — ST_MakePoint takes
-- LONGITUDE first), last_seen_area and last_seen_locality on an own DRAFT post.
-- at/lat/lng are required (MISSING_REQUIRED); both labels are free text.
--
-- This is a FULL REPLACE of the section, as it always was: omitting
-- p_last_seen_locality nulls the locality (the push then falls back to 'your
-- area'). get_post_detail returns last_seen_locality to the OWNER (section 8)
-- precisely so the editor can round-trip it instead of blanking it.
-- Never writes status/owner_id/expires_at/bounty/alerts_sent_at.
create or replace function public.update_post_last_seen(
  p_post_id            uuid,
  p_last_seen_at       timestamptz,
  p_last_seen_lat      double precision,
  p_last_seen_lng      double precision,
  p_last_seen_area     text,
  p_last_seen_locality text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_owner uuid := auth.uid();
  v_post  public.posts%rowtype;
  -- SAFETY (this migration): coarse alert-facing label; '' -> NULL so the push
  -- falls back to 'your area' rather than emitting "near ".
  v_locality text := nullif(btrim(p_last_seen_locality), '');
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
    last_seen_area     = p_last_seen_area,
    last_seen_locality = v_locality
  where id = p_post_id;

  return jsonb_build_object('post_id', p_post_id);
end;
$$;

comment on function public.update_post_last_seen(uuid, timestamptz, double precision, double precision, text, text) is
  'DRAFT-ONLY per-section edit: writes last_seen_at, last_seen_location (from lng/lat, geography 4326), last_seen_area and last_seen_locality on an own draft post (else POST_NOT_EDITABLE). MISSING_REQUIRED if last_seen_at/lat/lng null. p_last_seen_locality (20260802110000, defaults to null) is the COARSE district/city label the spotter-alert push reads — trimmed, empty -> null; last_seen_area can be street-grain and must never reach a push. Full replace: omitting the locality nulls it. Never writes status/owner_id/expires_at/bounty/alerts_sent_at. Also raises NOT_AUTHENTICATED.';

-- Grants re-asserted on the NEW signature (the drop above took the old one's
-- grants with it). `anon` named explicitly — this project's ALTER DEFAULT
-- PRIVILEGES re-grants it at CREATE time.
revoke execute on function public.update_post_last_seen(uuid, timestamptz, double precision, double precision, text, text)
  from public, anon;
grant  execute on function public.update_post_last_seen(uuid, timestamptz, double precision, double precision, text, text)
  to authenticated, service_role;


-- =============================================================================
-- 8. RPC: get_post_detail(post_id) -> jsonb   (CREATE OR REPLACE — same sig)
-- =============================================================================
-- Body reproduced BYTE-FOR-BYTE from 20260801150000 (the LATEST definition; no
-- later migration re-issued it) with EXACTLY ONE change: the return value is
-- merged with an OWNER-ONLY jsonb object carrying last_seen_locality.
--
-- SAFETY (why owner-only, and why a merged object rather than a key):
--   * The draft-edit round-trip needs it. LastSeenEditor prefills from
--     get_post_detail and update_post_last_seen full-replaces the section, so
--     without this the owner would silently blank their own locality by
--     re-saving the section untouched.
--   * NOTHING public needs it. get_post_detail is granted to anon, and this
--     payload is the public post-detail surface; the alert matcher reads the
--     column server-side, never through this RPC. So the key is merged in ONLY
--     for the owner — for every other caller it is ABSENT from the payload
--     (not present-and-null), which is the same absence-by-construction posture
--     get_public_sighting_entries takes.
--   * The public payload is otherwise untouched: home_feed_post_json (shared
--     with the feed/search/watchlist surfaces) is NOT modified by this
--     migration, so last_seen_locality appears in no feed, map, or watchlist
--     row anywhere.
-- Everything else — the active-OR-owner visibility gate, the driveway ~1km
-- coarsening, the owner identity block, sighting_stats as a SCALAR aggregate,
-- viewer_has_sighting — is byte-identical and must stay that way.
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
           then jsonb_build_object('last_seen_locality', v_post.last_seen_locality)
         else '{}'::jsonb
       end;
end;
$$;

comment on function public.get_post_detail(uuid) is
  'Returns one post''s detail for the post-detail screen. SECURITY DEFINER (bypasses RLS); the active-OR-owner predicate is the ONLY visibility gate. Non-visible -> minimal { found, visible:false, closedReason } stub. Visible -> full detail incl. Part-2 structured fields, features[], ordered photos, ordered distinctive_features [{id, photo_url, description}] (owner-authored photo+description marks; mirrors photos'' active-OR-owner visibility; id is the opaque row uuid the sighting wizard submits as confirmed_feature_ids), is_owner (never owner_id), owner block (first_name/month member_since), a LIVE scalar sighting_stats { count, latest_at } aggregated from public.sightings (scalar only — sighting rows/locations are owner-only via get_post_sightings), and viewer_has_sighting (whether the CALLER themselves already reported a sighting on this post — gates the sighting-gated "Message the owner" affordance; caller-only, leaks no other user''s data; false for anon and for the post''s owner). SAFETY: a driveway theft''s last-seen point is coarsened to a ~1km grid for non-owners. SAFETY (20260802110000): last_seen_locality is merged in for the OWNER ONLY — the key is ABSENT from every non-owner payload — so the draft-edit round-trip cannot blank it; nothing public reads it.';

-- Same grants as before (anon may browse an active post's detail; the new key
-- never reaches them). Re-asserted so this migration is correct standalone.
revoke execute on function public.get_post_detail(uuid) from public;
grant  execute on function public.get_post_detail(uuid)
  to anon, authenticated, service_role;


-- =============================================================================
-- END OF MIGRATION
-- =============================================================================

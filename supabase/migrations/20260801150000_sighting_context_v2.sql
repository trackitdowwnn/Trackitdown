-- =============================================================================
-- WHAT:  Context step v2 for sighting reports, six parts:
--          1. BUGFIX — sightings_context_flags_chk re-created with the FULL
--             new whitelist. 20260801140000 taught create_sighting to accept
--             'being_loaded' but the TABLE constraint (20260714100000, lines
--             83-85) still whitelists only parked/driving/people_nearby/
--             plate_changed — so a being_loaded submit passes the RPC gate and
--             then dies on the table constraint as a raw 23514 instead of a
--             clean INVALID_INPUT token. The constraint now matches the RPC:
--             parked, driving, being_loaded, people_nearby, plate_changed,
--             damage_visible, being_stripped, looks_intact (the three new
--             condition chips ship in the same list).
--          2. sightings.people_presence — nullable 3-way people observation
--             ('nobody'/'nearby'/'in_vehicle'); supersedes the people_nearby
--             flag for NEW reports (old rows keep their flag; both render).
--          3. sightings.confirmed_feature_ids — uuid[] not null default '{}':
--             the post's distinctive-feature rows the spotter confirmed seeing.
--          4. create_sighting re-issued with two new OPTIONAL parameters
--             (p_people_presence text, p_confirmed_feature_ids uuid[], both
--             default null). The old 8-arg signature is DROPPED and a 10-arg
--             one created (see SAFETY below). The RPC's context-flags
--             whitelist expands to the same 8-flag list as part 1.
--          5. get_post_detail re-issued (CREATE OR REPLACE): the
--             distinctive_features jsonb objects gain an 'id' key alongside
--             photo_url and description — the report-sighting wizard needs
--             stable feature ids to submit confirmed_feature_ids.
--          6. get_post_sightings re-issued (CREATE OR REPLACE): the owner
--             payload gains people_presence and a confirmed_features array
--             ({id, description} only — never photo_url here).
-- WHY:   Report-sighting context step upgrade (approved): richer condition
--        chips, a 3-way people-presence field, and confirmable
--        distinctive-feature checkmarks ("Could you see the cracked wing
--        mirror?") give owners sharper situational context without forcing
--        entry — every new field is optional/skippable.
-- LINKS: docs/DOMAIN.md (Sighting rules),
--        docs/SECURITY_AND_TRUST.md §1/§6 (owner-only sighting detail; the
--          privacy posture below is unchanged),
--        supabase/migrations/20260714100000_sightings.sql (the original
--          sightings_context_flags_chk fixed in part 1),
--        supabase/migrations/20260801140000_sighting_context_fields.sql (the
--          8-arg create_sighting + get_post_sightings bodies re-issued here),
--        supabase/migrations/20260727120000_post_detail_distinctive_features.sql
--          (the LATEST get_post_detail body re-issued here),
--        supabase/migrations/20260724100000_post_distinctive_features.sql
--          (the post_distinctive_feature table create_sighting validates
--          confirmed ids against),
--        src/features/sightings/components/sightingSteps.tsx (ContextStep UI);
--        src/features/sightings/api/sightingApi.ts (buildCreateSightingParams);
--        src/features/vehicles/api/vehicleApi.ts (distinctive_features parser).
--
-- SAFETY NOTE ON DESTRUCTIVE STATEMENTS:
--   * TWO DESTRUCTIVE STATEMENTS:
--       1. alter table public.sightings drop constraint
--          sightings_context_flags_chk — immediately re-created in the same
--          transaction with a STRICTLY WIDER whitelist. Every existing row
--          satisfies the old (narrower) list, so re-validation cannot fail
--          and no data is at risk; there is no window where the column is
--          unconstrained outside this transaction.
--       2. drop function public.create_sighting(uuid, jsonb, text[], text,
--          text, text, text, text) — the two new parameters are DEFAULTED, so
--          the signature changes; CREATE OR REPLACE would have created a
--          second overload alongside the old one and made every existing
--          8-arg call ambiguous. The old signature is dropped and the 10-arg
--          function created + re-revoked + re-granted in the same transaction
--          (existing 8-arg callers keep working via the defaults).
--   * BYTE-FOR-BYTE CLAIM (diff it): the new create_sighting body is copied
--     byte-for-byte from 20260801140000_sighting_context_fields.sql with
--     EXACTLY five changes — (a) the two new parameters, (b) two v_* declares
--     (v_people_presence trim/empty->null; v_confirmed null->'{}'), (c) the
--     context-flags whitelist expanded to the part-1 list, (d) new
--     INVALID_INPUT guards (people_presence enum; max 8 confirmed ids; dedupe
--     then every id must belong to THIS post's distinctive features), (e) the
--     two new columns/values in the INSERT. Every existing Tier 1 gate —
--     advisory lock, path pinning, photo checks — is byte-identical.
--   * get_post_detail is re-issued byte-for-byte from 20260727120000 (the
--     latest definition; nothing later re-issued it) with ONE payload change:
--     the 'id' key on distinctive_features elements. Exposing the row id is
--     safe — it is an opaque uuid on an already-visible feature — but NOTHING
--     else about the payload changes.
--   * get_post_sightings is re-issued byte-for-byte from 20260801140000 with
--     TWO new keys in the sighting object (people_presence,
--     confirmed_features). PRIVACY posture unchanged: the spotter block is
--     untouched, and confirmed_features carries id + description only.
-- =============================================================================


-- =============================================================================
-- 1. BUGFIX: sightings_context_flags_chk — table CHECK out of sync with the RPC
-- =============================================================================
-- DESTRUCTIVE (flagged in the header): drop + re-create in one transaction.
-- The old whitelist (parked/driving/people_nearby/plate_changed) predates the
-- 'being_loaded' chip the RPC already accepts; the new list is a strict
-- superset, so existing rows re-validate trivially.
alter table public.sightings
  drop constraint sightings_context_flags_chk;

-- The FULL v2 whitelist: the original four, the towed-state chip the RPC
-- already accepted ('being_loaded'), and the three new condition chips.
-- <@ = "every element is in the whitelist"; '{}' = none selected.
alter table public.sightings
  add constraint sightings_context_flags_chk
    check (context_flags <@ array['parked', 'driving', 'being_loaded',
                                  'people_nearby', 'plate_changed',
                                  'damage_visible', 'being_stripped',
                                  'looks_intact']::text[]);


-- =============================================================================
-- 2. COLUMN: sightings.people_presence
-- =============================================================================
alter table public.sightings
  add column people_presence text
    constraint sightings_people_presence_chk
      check (people_presence in ('nobody', 'nearby', 'in_vehicle'));

comment on column public.sightings.people_presence is
  'The spotter''s 3-way people observation (nobody/nearby/in_vehicle); supersedes the people_nearby context flag for NEW reports (old rows keep their flag; both render). NULL = not answered or older report.';


-- =============================================================================
-- 3. COLUMN: sightings.confirmed_feature_ids
-- =============================================================================
alter table public.sightings
  add column confirmed_feature_ids uuid[] not null default '{}';

comment on column public.sightings.confirmed_feature_ids is
  'Ids of the post''s post_distinctive_feature rows the spotter confirmed seeing ("Could you see the cracked wing mirror?"). No array-element FK exists in Postgres — create_sighting''s validation (deduped; every id must belong to the sighting''s post) is the referential guard. Empty for skipped/older reports.';


-- =============================================================================
-- 4. RPC: create_sighting(...) -> jsonb   (RE-ISSUE — signature change)
-- =============================================================================
-- SAFETY (DESTRUCTIVE — flagged in the header): the 8-arg signature must go
-- before the 10-arg defaulted one arrives, or 8-arg calls become ambiguous
-- between the two overloads. DROP also removes the old grants/comment; both
-- are re-issued below on the new signature.
drop function public.create_sighting(uuid, jsonb, text[], text, text, text, text, text);

create function public.create_sighting(
  p_post_id              uuid,
  p_photos               jsonb,
  p_context_flags        text[],
  p_note                 text,
  p_area_label           text,
  p_locality             text default null,
  p_parked_likelihood    text default null,
  p_direction            text default null,
  p_people_presence      text default null,
  p_confirmed_feature_ids uuid[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_spotter              uuid := auth.uid();
  v_owner                uuid;
  v_post_status          public.post_status;
  v_recent               int;
  v_photo_count          int;
  v_elem                 jsonb;
  v_path                 text;
  v_captured             timestamptz;
  v_lat                  double precision;
  v_lng                  double precision;
  v_acc                  double precision;
  v_any_located          boolean := false;
  v_flags                text[]  := coalesce(p_context_flags, '{}');
  v_locality             text    := nullif(btrim(p_locality), '');
  v_parked_likelihood    text    := nullif(btrim(p_parked_likelihood), '');
  v_direction            text    := nullif(btrim(p_direction), '');
  v_people_presence      text    := nullif(btrim(p_people_presence), '');
  v_confirmed            uuid[]  := coalesce(p_confirmed_feature_ids, '{}');
  v_sighting_id          uuid;
begin
  -- SAFETY: must be signed in (execute is granted to authenticated +
  -- service_role only, never anon — this is a belt-and-braces backstop).
  if v_spotter is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  -- --- POST_NOT_ACTIVE: sightings only on live posts (DOMAIN.md) --------------
  -- A missing post and a non-active post give the SAME token, so this RPC is
  -- not an existence oracle for hidden (draft/pending/closed) posts.
  select p.owner_id, p.status into v_owner, v_post_status
  from public.posts p
  where p.id = p_post_id;
  if not found or v_post_status <> 'active' then
    raise exception 'POST_NOT_ACTIVE';
  end if;

  -- --- OWN_POST: collusion hygiene (SECURITY_AND_TRUST §5) --------------------
  -- An owner "spotting" their own car would let them feed their own reputation
  -- and grease a self-credit; blocked outright.
  if v_owner = v_spotter then
    raise exception 'OWN_POST';
  end if;

  -- --- RATE_LIMITED: max 3 per spotter per post per ROLLING 24h ---------------
  -- (DOMAIN.md / §5). Advisory xact lock serialises concurrent calls for the
  -- same (post, spotter) so parallel requests cannot both pass the count and
  -- land a 4th row; the lock releases automatically at transaction end.
  perform pg_advisory_xact_lock(
    hashtextextended('create_sighting:' || p_post_id::text || ':' || v_spotter::text, 0));
  select count(*) into v_recent
  from public.sightings s
  where s.post_id = p_post_id
    and s.spotter_id = v_spotter
    and s.created_at > now() - interval '24 hours';
  if v_recent >= 3 then
    raise exception 'RATE_LIMITED';
  end if;

  -- --- INVALID_PHOTOS: 1..3 well-formed photo objects -------------------------
  if p_photos is null or jsonb_typeof(p_photos) <> 'array' then
    raise exception 'INVALID_PHOTOS: photos must be a json array';
  end if;
  v_photo_count := jsonb_array_length(p_photos);
  if v_photo_count < 1 or v_photo_count > 3 then
    raise exception 'INVALID_PHOTOS: expected 1..3 photos, got %', v_photo_count;
  end if;

  for v_elem in select e.value from jsonb_array_elements(p_photos) e loop
    if jsonb_typeof(v_elem) <> 'object' then
      raise exception 'INVALID_PHOTOS: each photo must be an object';
    end if;

    -- Any unparseable field (bad timestamp, non-numeric lat/lng/accuracy) is a
    -- malformed photo, not a raw cast error surfaced to the client.
    begin
      v_path     := v_elem ->> 'path';
      v_captured := (v_elem ->> 'captured_at')::timestamptz;
      v_lat      := (v_elem ->> 'lat')::double precision;
      v_lng      := (v_elem ->> 'lng')::double precision;
      v_acc      := (v_elem ->> 'accuracy_m')::double precision;
    exception when others then
      raise exception 'INVALID_PHOTOS: malformed photo field';
    end;

    if v_captured is null then
      raise exception 'INVALID_PHOTOS: captured_at is required';
    end if;

    -- Capture-time GPS: both-or-neither; accuracy only on a located photo.
    -- Range/sign checks are extra hardening under the same token.
    if (v_lat is null) <> (v_lng is null) then
      raise exception 'INVALID_PHOTOS: lat/lng must both be set or both be null';
    end if;
    if v_acc is not null and v_lat is null then
      raise exception 'INVALID_PHOTOS: accuracy_m only allowed on a located photo';
    end if;
    if v_lat is not null
       and (v_lat < -90 or v_lat > 90 or v_lng < -180 or v_lng > 180
            or (v_acc is not null and v_acc < 0)) then
      raise exception 'INVALID_PHOTOS: lat/lng/accuracy_m out of range';
    end if;

    -- SAFETY (path pinning — same split_part technique as create_post's V5C
    -- check, 20260713192000): the object name must be exactly
    -- '<p_post_id>/<caller uid>/<filename>' — this post, the CALLER's folder,
    -- one trailing filename segment, length-bounded. The storage INSERT policy
    -- already forces uploads there; this stops the DB row pointing anywhere
    -- else (another user's evidence, another post's folder).
    if v_path is null
       or char_length(v_path) > 300
       or split_part(v_path, '/', 1) <> p_post_id::text
       or split_part(v_path, '/', 2) <> v_spotter::text
       or split_part(v_path, '/', 3) = ''
       or split_part(v_path, '/', 4) <> '' then
      raise exception 'INVALID_PHOTOS: path must be <post_id>/<own uid>/<filename>';
    end if;

    if v_lat is not null then
      v_any_located := true;
    end if;
  end loop;

  -- --- INVALID_INPUT: flags whitelist + bounded text ---------------------------
  -- Same bounds as the table CHECKs; re-checked here so the client gets a clean
  -- mappable token instead of a raw constraint violation.
  -- Whitelist expanded to the v2 chip set — the SAME list as the table CHECK
  -- re-created in part 1 (the 20260801140000/20260714100000 drift is why that
  -- bugfix exists).
  if not (v_flags <@ array['parked', 'driving', 'being_loaded',
                           'people_nearby', 'plate_changed',
                           'damage_visible', 'being_stripped',
                           'looks_intact']::text[]) then
    raise exception 'INVALID_INPUT: unknown context flag';
  end if;
  if p_note is not null and char_length(p_note) > 500 then
    raise exception 'INVALID_INPUT: note too long';
  end if;
  if p_area_label is not null and char_length(p_area_label) > 120 then
    raise exception 'INVALID_INPUT: area_label too long';
  end if;
  if v_locality is not null and char_length(v_locality) > 80 then
    raise exception 'INVALID_INPUT: locality too long';
  end if;
  if v_parked_likelihood is not null
     and v_parked_likelihood not in ('settled', 'street', 'moving') then
    raise exception 'INVALID_INPUT: parked_likelihood must be settled/street/moving';
  end if;
  if v_direction is not null
     and v_direction not in ('N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW') then
    raise exception 'INVALID_INPUT: direction must be N/NE/E/SE/S/SW/W/NW';
  end if;
  if v_people_presence is not null
     and v_people_presence not in ('nobody', 'nearby', 'in_vehicle') then
    raise exception 'INVALID_INPUT: people_presence must be nobody/nearby/in_vehicle';
  end if;
  -- Confirmed features: bounded, deduped, then every id must belong to THIS
  -- post's distinctive features. There is no array-element FK in Postgres, so
  -- this check IS the referential guard for confirmed_feature_ids. The length
  -- bound is checked BEFORE dedupe so a padded payload fails cheaply.
  if array_length(v_confirmed, 1) > 8 then
    raise exception 'INVALID_INPUT: too many confirmed features';
  end if;
  select coalesce(array_agg(distinct fid), '{}')
    into v_confirmed
  from unnest(v_confirmed) as fid;
  -- SAFETY: one opaque token whichever id is bad — do not reveal WHICH id
  -- failed (no probing another post's feature ids through error detail).
  if exists (
       select 1
       from unnest(v_confirmed) as fid
       where not exists (
         select 1
         from public.post_distinctive_feature df
         where df.id = fid
           and df.post_id = p_post_id)) then
    raise exception 'INVALID_INPUT: unknown feature id';
  end if;

  -- --- Atomic assembly (single transaction) ------------------------------------
  -- SAFETY: spotter_id pinned to the caller; status HARD-CODED 'unverified';
  -- location_unavailable derived (true only when NO photo carried GPS).
  insert into public.sightings (
    post_id, spotter_id, status, context_flags, note, area_label, locality,
    parked_likelihood, direction, people_presence, confirmed_feature_ids,
    location_unavailable
  )
  values (
    p_post_id, v_spotter, 'unverified', v_flags, p_note, p_area_label, v_locality,
    v_parked_likelihood, v_direction, v_people_presence, v_confirmed,
    not v_any_located
  )
  returning id into v_sighting_id;

  -- Photos: one row per payload element, position = array order (0-based, as
  -- sighting_photos/post_photos expect).
  insert into public.sighting_photos (
    sighting_id, path, lat, lng, accuracy_m, captured_at, position
  )
  select
    v_sighting_id,
    e.value ->> 'path',
    (e.value ->> 'lat')::double precision,
    (e.value ->> 'lng')::double precision,
    (e.value ->> 'accuracy_m')::double precision,
    (e.value ->> 'captured_at')::timestamptz,
    (e.ord - 1)::smallint
  from jsonb_array_elements(p_photos) with ordinality as e(value, ord);

  -- Reputation v1 (DOMAIN.md): sightings_reported is server-maintained ONLY
  -- (no client grant); this SECURITY DEFINER path is its increment point.
  update public.profiles
  set sightings_reported = sightings_reported + 1
  where id = v_spotter;

  -- AUDIT: a sighting-created audit-log insert belongs here once the audit_log
  -- table exists (SECURITY_AND_TRUST §7). Deferred with the moderation feature.

  return jsonb_build_object('sighting_id', v_sighting_id);
end;
$$;

comment on function public.create_sighting(uuid, jsonb, text[], text, text, text, text, text, text, uuid[]) is
  'The write boundary for reporting a sighting. SECURITY DEFINER: pins spotter_id to the caller, HARD-CODES status=unverified, derives location_unavailable, atomically inserts the sighting + photos and increments profiles.sightings_reported. Gates: active post only, not the caller''s own post, max 3 per rolling 24h per (post, spotter), 1..3 photos each pinned to <post_id>/<own uid>/<filename> with parseable captured_at and both-or-neither GPS, whitelisted context flags (v2 chip set), bounded note/area_label/locality. p_locality (optional) is the coarse PUBLIC place grain (ADR-0008). p_parked_likelihood (optional, settled/street/moving) is captured when parked flag is set. p_direction (optional, N/NE/E/SE/S/SW/W/NW) is captured when driving flag is set. p_people_presence (optional, nobody/nearby/in_vehicle) is the 3-way people observation. p_confirmed_feature_ids (optional, max 8, deduped) must all belong to the post''s distinctive features — this check is the array''s referential guard. Raises: NOT_AUTHENTICATED, POST_NOT_ACTIVE, OWN_POST, RATE_LIMITED, INVALID_PHOTOS, INVALID_INPUT.';

revoke execute on function public.create_sighting(uuid, jsonb, text[], text, text, text, text, text, text, uuid[])
  from public, anon;
grant execute on function public.create_sighting(uuid, jsonb, text[], text, text, text, text, text, text, uuid[])
  to authenticated, service_role;


-- =============================================================================
-- 5. RPC: get_post_detail(post_id) -> jsonb   (CREATE OR REPLACE)
-- =============================================================================
-- Byte-for-byte the 20260727120000 function (the LATEST definition; no later
-- migration re-issued it) EXCEPT: the distinctive_features jsonb objects gain
-- an 'id' key (df.id) alongside photo_url and description — the
-- report-sighting wizard needs stable feature ids to submit
-- confirmed_feature_ids.
--
-- SAFETY: exposing the row id is safe — it is an opaque uuid on an
-- already-visible feature (same active-OR-owner gate as photo_url and
-- description) — but NOTHING else about the payload may change. sighting_stats
-- stays a SCALAR count + latest timestamp ONLY; it MUST NEVER be widened to
-- individual sighting rows/locations here — the owner's row-level read is
-- get_post_sightings (SECURITY_AND_TRUST §6: public sees no sightings).
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
       );
end;
$$;

comment on function public.get_post_detail(uuid) is
  'Returns one post''s detail for the post-detail screen. SECURITY DEFINER (bypasses RLS); the active-OR-owner predicate is the ONLY visibility gate. Non-visible -> minimal { found, visible:false, closedReason } stub. Visible -> full detail incl. Part-2 structured fields, features[], ordered photos, ordered distinctive_features [{id, photo_url, description}] (owner-authored photo+description marks; mirrors photos'' active-OR-owner visibility; id is the opaque row uuid the sighting wizard submits as confirmed_feature_ids), is_owner (never owner_id), owner block (first_name/month member_since), a LIVE scalar sighting_stats { count, latest_at } aggregated from public.sightings (scalar only — sighting rows/locations are owner-only via get_post_sightings), and viewer_has_sighting (whether the CALLER themselves already reported a sighting on this post — gates the sighting-gated "Message the owner" affordance; caller-only, leaks no other user''s data; false for anon and for the post''s owner). SAFETY: a driveway theft''s last-seen point is coarsened to a ~1km grid for non-owners.';

-- Same grants as before (anon may browse active posts' detail; the feature ids
-- are exactly as visible as the features themselves). Re-asserted so this
-- migration is correct standalone.
revoke execute on function public.get_post_detail(uuid) from public;
grant  execute on function public.get_post_detail(uuid)
  to anon, authenticated, service_role;


-- =============================================================================
-- 6. RPC: get_post_sightings(post_id) -> jsonb   (CREATE OR REPLACE)
-- =============================================================================
-- Byte-for-byte the 20260801140000 function EXCEPT: two new keys in the
-- sighting object — people_presence (nullable; older sightings return null and
-- the client renders their people_nearby flag instead) and confirmed_features
-- (the confirmed distinctive marks as {id, description} pairs, ordered by the
-- feature's position; [] when none). id + description ONLY — never photo_url
-- here; the owner's sighting payload stays lean (the detail screen already has
-- the photos via get_post_detail).
--
-- SAFETY (Tier 1 — CRITICAL PRIVACY, SECURITY_AND_TRUST §1):
--   The spotter block is first_name + reputation counters + coarse member-since
--   ONLY. The payload must NEVER contain spotter_id, display_name/surname,
--   email, or an avatar path (avatar paths embed the uid). If you add a field
--   here, re-read SECURITY_AND_TRUST §1 first. The spotter block below is
--   UNTOUCHED by this re-issue.
--
-- SAFETY (owner gate): SECURITY DEFINER bypasses RLS, so the owner_id check
--   below is the ONLY gate. A missing post and a not-owned post raise the SAME
--   'NOT_OWNER' token, so this is not an existence oracle for other posts.
create or replace function public.get_post_sightings(p_post_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_viewer uuid := auth.uid();
  v_owner  uuid;
  v_out    jsonb;
begin
  -- SAFETY: backstop; the grant below already excludes anon.
  if v_viewer is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  -- SAFETY: the ONLY visibility gate — the caller must own the post.
  select p.owner_id into v_owner from public.posts p where p.id = p_post_id;
  if not found or v_owner <> v_viewer then
    raise exception 'NOT_OWNER';
  end if;

  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id',                   s.id,
               'created_at',           s.created_at,
               'status',               s.status,
               'context_flags',        to_jsonb(s.context_flags),
               'note',                 s.note,
               'area_label',           s.area_label,
               'location_unavailable', s.location_unavailable,
               'parked_likelihood',    s.parked_likelihood,
               'direction',            s.direction,
               'people_presence',      s.people_presence,

               -- Confirmed distinctive marks: {id, description} ONLY (never
               -- photo_url — keep the owner payload lean), ordered by the
               -- feature's display position; [] when none confirmed.
               'confirmed_features', coalesce(
                 (select jsonb_agg(
                           jsonb_build_object(
                             'id',          df.id,
                             'description', df.description)
                           order by df.position)
                    from public.post_distinctive_feature df
                   where df.id = any(s.confirmed_feature_ids)),
                 '[]'::jsonb),

               -- Exact capture GPS to the owner (SECURITY_AND_TRUST §1:
               -- sighting locations shown to owners are exact).
               'photos', coalesce(
                 (select jsonb_agg(
                           jsonb_build_object(
                             'path',        sp.path,
                             'lat',         sp.lat,
                             'lng',         sp.lng,
                             'accuracy_m',  sp.accuracy_m,
                             'captured_at', sp.captured_at)
                           order by sp.position)
                    from public.sighting_photos sp
                   where sp.sighting_id = s.id),
                 '[]'::jsonb),

               -- SAFETY: spotter identity minimised — first name + reputation
               -- counters + month-coarsened member-since. NO spotter_id, NO
               -- display_name/surname, NO email, NO avatar path.
               'spotter', jsonb_build_object(
                 'first_name',          pr.first_name,
                 'sightings_reported',  pr.sightings_reported,
                 'sightings_helpful',   pr.sightings_helpful,
                 'recoveries_credited', pr.recoveries_credited,
                 'member_since',        date_trunc('month', pr.created_at))
             )
             order by s.created_at desc),
           '[]'::jsonb)
    into v_out
  from public.sightings s
  join public.profiles pr on pr.id = s.spotter_id
  where s.post_id = p_post_id;

  return v_out;
end;
$$;

comment on function public.get_post_sightings(uuid) is
  'OWNER-ONLY: every sighting on the caller''s own post, newest-first, with photos (exact capture GPS), the optional context fields (parked_likelihood, direction, people_presence — nullable), the confirmed distinctive marks as {id, description} pairs (never photo_url — the payload stays lean) and a privacy-minimised spotter block (first_name + reputation counters + month member_since — NEVER spotter_id/display_name/email/avatar; SECURITY_AND_TRUST §1). Raises NOT_AUTHENTICATED, NOT_OWNER (same token for missing and not-owned posts).';

-- SAFETY: same lockdown — no PUBLIC, no anon (re-asserted; CREATE OR REPLACE
-- keeps existing grants, but the posture is re-stated per house style).
revoke execute on function public.get_post_sightings(uuid) from public, anon;
grant  execute on function public.get_post_sightings(uuid) to authenticated, service_role;


-- =============================================================================
-- END OF MIGRATION
-- =============================================================================

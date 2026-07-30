-- =============================================================================
-- WHAT:  Extended context fields for sighting reports, four parts:
--          1. sightings.parked_likelihood — nullable enum (settled/street/moving)
--             captured when the parked context flag is selected.
--          2. sightings.direction — nullable enum (N/NE/E/SE/S/SW/W/NW)
--             captured when the driving context flag is selected.
--          3. create_sighting re-issued with two new OPTIONAL parameters
--             (p_parked_likelihood and p_direction, both text default null).
--             Updated to include 'being_loaded' in context_flags whitelist.
--          4. get_post_sightings re-issued so the owner payload carries the
--             two new fields (parked_likelihood, direction — both nullable;
--             the client schema requires the KEYS, older sightings carry null).
-- WHY:   Form improvements (sightings/Phase 5): structured optional fields
--        give owners richer situational context (when parked: likelihood it'll
--        stay; when driving: heading direction) without forcing entry or
--        complicating the interface. Both fields are conditional on their
--        context flag and skippable.
-- LINKS: src/features/sightings/types.ts (PARKED_LIKELIHOOD, DRIVING_DIRECTIONS);
--        src/features/sightings/components/sightingSteps.tsx (ContextStep UI);
--        src/features/sightings/api/sightingApi.ts (buildCreateSightingParams).
--
-- ORDERING (why this file is stamped 20260801140000): it depends on
--   20260801130000_sighting_timeline — it DROPS the 6-arg create_sighting that
--   migration created and writes the locality column that migration added. It
--   was originally stamped 20260729140000, BEFORE its dependency: db push
--   failed on the drop and silently blocked every later migration (the
--   report-sighting outage fixed 2026-07-29).
--
-- SAFETY NOTE ON RPC RE-ISSUE:
--   * The signature changes (6-arg to 8-arg with defaults), so the old
--     6-arg signature is DROPPED and a new 8-arg one created + re-granted.
--   * The context_flags whitelist is expanded to include 'being_loaded'
--     (the new vehicle-state chip).
--   * BYTE-FOR-BYTE except for: (a) the two new parameters (b) whitelist
--     expansion (c) v_* declares for the two new fields (d) length guards
--     in INVALID_INPUT (e) the two columns/values in the INSERT.
-- =============================================================================


-- =============================================================================
-- 1. COLUMNS: sightings.parked_likelihood and sightings.direction
-- =============================================================================
alter table public.sightings
  add column parked_likelihood text
    constraint sightings_parked_likelihood_chk
      check (parked_likelihood in ('settled', 'street', 'moving'));

alter table public.sightings
  add column direction text
    constraint sightings_direction_chk
      check (direction in ('N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'));

comment on column public.sightings.parked_likelihood is
  'If the parked context flag is selected: the spotter''s judgment of whether the vehicle will remain there (settled/street/moving). NULL for sightings without the parked flag or on older reports.';

comment on column public.sightings.direction is
  'If the driving context flag is selected: the compass direction the vehicle was heading (8-way: N/NE/E/SE/S/SW/W/NW). NULL for sightings without the driving flag or on older reports.';


-- =============================================================================
-- 2. RPC: create_sighting(...) -> jsonb   (RE-ISSUE — signature change)
-- =============================================================================
drop function public.create_sighting(uuid, jsonb, text[], text, text, text);

create function public.create_sighting(
  p_post_id              uuid,
  p_photos               jsonb,
  p_context_flags        text[],
  p_note                 text,
  p_area_label           text,
  p_locality             text default null,
  p_parked_likelihood    text default null,
  p_direction            text default null
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
  -- Whitelist now includes 'being_loaded' for the towed state chip.
  if not (v_flags <@ array['parked', 'driving', 'being_loaded', 'people_nearby', 'plate_changed']::text[]) then
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

  -- --- Atomic assembly (single transaction) ------------------------------------
  -- SAFETY: spotter_id pinned to the caller; status HARD-CODED 'unverified';
  -- location_unavailable derived (true only when NO photo carried GPS).
  insert into public.sightings (
    post_id, spotter_id, status, context_flags, note, area_label, locality,
    parked_likelihood, direction, location_unavailable
  )
  values (
    p_post_id, v_spotter, 'unverified', v_flags, p_note, p_area_label, v_locality,
    v_parked_likelihood, v_direction, not v_any_located
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

comment on function public.create_sighting(uuid, jsonb, text[], text, text, text, text, text) is
  'The write boundary for reporting a sighting. SECURITY DEFINER: pins spotter_id to the caller, HARD-CODES status=unverified, derives location_unavailable, atomically inserts the sighting + photos and increments profiles.sightings_reported. Gates: active post only, not the caller''s own post, max 3 per rolling 24h per (post, spotter), 1..3 photos each pinned to <post_id>/<own uid>/<filename> with parseable captured_at and both-or-neither GPS, whitelisted context flags, bounded note/area_label/locality. p_locality (optional) is the coarse PUBLIC place grain (ADR-0008). p_parked_likelihood (optional, settled/street/moving) is captured when parked flag is set. p_direction (optional, N/NE/E/SE/S/SW/W/NW) is captured when driving flag is set. Raises: NOT_AUTHENTICATED, POST_NOT_ACTIVE, OWN_POST, RATE_LIMITED, INVALID_PHOTOS, INVALID_INPUT.';

revoke execute on function public.create_sighting(uuid, jsonb, text[], text, text, text, text, text)
  from public, anon;
grant execute on function public.create_sighting(uuid, jsonb, text[], text, text, text, text, text)
  to authenticated, service_role;


-- =============================================================================
-- 3. RPC: get_post_sightings(post_id) -> jsonb   (CREATE OR REPLACE)
-- =============================================================================
-- Byte-for-byte the 20260714100000 function EXCEPT: two new keys in the
-- sighting object — parked_likelihood and direction (both nullable; older
-- sightings return null and the client renders them without). The client's
-- ownerSightingSchema REQUIRES these keys, so this re-issue ships WITH the
-- column migration above — a payload without them fails the client parse.
--
-- SAFETY (Tier 1 — CRITICAL PRIVACY, SECURITY_AND_TRUST §1):
--   The spotter block is first_name + reputation counters + coarse member-since
--   ONLY. The payload must NEVER contain spotter_id, display_name/surname,
--   email, or an avatar path (avatar paths embed the uid). If you add a field
--   here, re-read SECURITY_AND_TRUST §1 first.
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
  'OWNER-ONLY: every sighting on the caller''s own post, newest-first, with photos (exact capture GPS), the optional context fields (parked_likelihood, direction — nullable) and a privacy-minimised spotter block (first_name + reputation counters + month member_since — NEVER spotter_id/display_name/email/avatar; SECURITY_AND_TRUST §1). Raises NOT_AUTHENTICATED, NOT_OWNER (same token for missing and not-owned posts).';

-- SAFETY: same lockdown — no PUBLIC, no anon (re-asserted; CREATE OR REPLACE
-- keeps existing grants, but the posture is re-stated per house style).
revoke execute on function public.get_post_sightings(uuid) from public, anon;
grant  execute on function public.get_post_sightings(uuid) to authenticated, service_role;


-- =============================================================================
-- END OF MIGRATION
-- =============================================================================

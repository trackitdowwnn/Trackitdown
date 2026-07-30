-- =============================================================================
-- WHAT:  Gallery-hybrid server rules (ADR-0003), three parts:
--          1. sighting_photos.source — text not null default 'live', CHECK in
--             ('live','gallery'): the ADR-0003 provenance flag on every photo
--             row. Default 'live' keeps every existing row honest (all
--             pre-hybrid rows were live in-app captures).
--          2. create_sighting re-issued (CREATE OR REPLACE — same 10-arg
--             signature, no drop) with the photo-loop additions: per-photo
--             'source' parsed (absent/blank -> 'live') and whitelisted;
--             ADR-0003 rule 1 enforced server-side (>=1 live capture per
--             sighting, gallery-only submissions rejected); ADR-0003 rule 3
--             enforced STRUCTURALLY (a gallery photo may carry no
--             lat/lng/accuracy_m — payout blindness by construction, not
--             convention); the sighting_photos INSERT persists source.
--          3. get_post_sightings re-issued (CREATE OR REPLACE): the photos
--             jsonb objects gain 'source' — the owner-facing "added from
--             photo library" label (ADR-0003 rule 2) renders from it.
-- WHY:   ADR-0003 (accepted 2026-07-15, build deferred until now): the
--        snap-first spotter photographs the car BEFORE opening the app;
--        camera-only forces them to discard their best photo. Hybrid keeps
--        the live capture as THE evidence (required, location-bearing) and
--        admits gallery photos as labelled, location-blind supplementary
--        context. All three of the ADR's non-negotiables land here: >=1 live
--        (server-enforced), honest provenance (source column + owner label),
--        payout blindness (gallery rows structurally location-free).
-- LINKS: docs/decisions/ADR-0003-gallery-supplementary-evidence.md;
--        docs/DOMAIN.md (Sighting rules — live capture remains REQUIRED);
--        docs/SECURITY_AND_TRUST.md §1/§6 (owner-only sighting detail; the
--          privacy posture below is unchanged);
--        supabase/migrations/20260801160000_sighting_context_v2_hardening.sql
--          (the LATEST create_sighting + get_post_sightings bodies re-issued
--          here);
--        supabase/migrations/20260714100000_sightings.sql (sighting_photos).
--
-- SAFETY NOTE: NO DESTRUCTIVE STATEMENTS — fully additive. Both signatures
--   are unchanged, so both functions are re-issued via CREATE OR REPLACE (no
--   drops, no grant churn; existing grants survive and the posture is
--   re-stated per house style).
--   BYTE-FOR-BYTE CLAIM (diff it): the new create_sighting body is copied
--   byte-for-byte from 20260801160000 with EXACTLY five changes — (a) two
--   new declares (v_source; v_any_live := false), (b) the per-photo source
--   parse + whitelist ('INVALID_PHOTOS: source must be live or gallery'),
--   (c) the gallery-carries-no-location guard + v_any_live tracking in the
--   loop and the >=1-live guard after it, (d) the source column/value in the
--   sighting_photos INSERT, (e) comment text only (the derived
--   location_unavailable LOGIC is unchanged — see the note at the insert).
--   Every existing Tier 1 gate — advisory lock, path pinning, photo checks,
--   confirmed-ids guard — is byte-identical.
--   get_post_sightings is re-issued byte-for-byte from 20260801160000 with
--   ONE new key in the photos objects ('source'). PRIVACY posture unchanged:
--   the spotter block is byte-identical.
-- =============================================================================


-- =============================================================================
-- 1. COLUMN: sighting_photos.source
-- =============================================================================
alter table public.sighting_photos
  add column source text not null default 'live'
    constraint sighting_photos_source_chk
      check (source in ('live', 'gallery'));

comment on column public.sighting_photos.source is
  'ADR-0003 provenance flag — ''live'' = in-app capture (the evidence); ''gallery'' = supplementary library photo (labelled to owners, NO location/time evidence weight). Default ''live'' keeps every existing row honest (all pre-hybrid rows were live captures).';


-- =============================================================================
-- 2. RPC: create_sighting(...) -> jsonb   (CREATE OR REPLACE — same signature)
-- =============================================================================
-- Tier 1 SAFETY: see 20260801150000/20260801160000 — every gate is
-- byte-identical except the ADR-0003 photo-provenance additions flagged in
-- the header.
create or replace function public.create_sighting(
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
  v_source               text;
  v_any_located          boolean := false;
  v_any_live             boolean := false;
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

    -- ADR-0003 provenance: absent/blank source means 'live' — pre-hybrid
    -- clients send no source, and their captures ARE live in-app captures.
    v_source := coalesce(nullif(btrim(v_elem ->> 'source'), ''), 'live');
    if v_source not in ('live', 'gallery') then
      raise exception 'INVALID_PHOTOS: source must be live or gallery';
    end if;

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

    -- ADR-0003 rule 3 (payout blindness, STRUCTURAL): a gallery photo must
    -- carry NO location — its EXIF is stripped client-side and never read as
    -- evidence, and this guard makes a located gallery row IMPOSSIBLE rather
    -- than merely discouraged. Only live captures can ever bear GPS.
    if v_source = 'gallery'
       and (v_lat is not null or v_lng is not null or v_acc is not null) then
      raise exception 'INVALID_PHOTOS: gallery photos carry no location';
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
    if v_source = 'live' then
      v_any_live := true;
    end if;
  end loop;

  -- ADR-0003 rule 1, server-enforced (never client-only): gallery photos are
  -- SUPPLEMENTARY — every sighting still requires at least one live in-app
  -- capture. A gallery-only submission is unfalsifiable and is rejected.
  if not v_any_live then
    raise exception 'INVALID_PHOTOS: at least one live in-app capture is required';
  end if;

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
  -- At most ONE vehicle-state flag (parked/driving/being_loaded): the states
  -- are mutually exclusive facts (DOMAIN.md). Enforced here for NEW rows only
  -- — the table CHECK cannot (legacy multi-select rows may hold both).
  if (select count(*)
      from unnest(v_flags) f
      where f in ('parked', 'driving', 'being_loaded')) > 1 then
    raise exception 'INVALID_INPUT: conflicting vehicle-state flags';
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
  if array_ndims(v_confirmed) > 1 or cardinality(v_confirmed) > 8 then
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
  -- location_unavailable derived (true only when NO photo carried GPS). The
  -- derivation is UNCHANGED by ADR-0003: gallery photos can never be located
  -- (rejected above), so only live captures can set v_any_located — exactly
  -- the ADR posture: location evidence comes from live capture only.
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
  -- sighting_photos/post_photos expect). source persists the ADR-0003
  -- provenance flag (same absent/blank -> 'live' rule the loop validated).
  insert into public.sighting_photos (
    sighting_id, path, lat, lng, accuracy_m, captured_at, position, source
  )
  select
    v_sighting_id,
    e.value ->> 'path',
    (e.value ->> 'lat')::double precision,
    (e.value ->> 'lng')::double precision,
    (e.value ->> 'accuracy_m')::double precision,
    (e.value ->> 'captured_at')::timestamptz,
    (e.ord - 1)::smallint,
    coalesce(nullif(btrim(e.value ->> 'source'), ''), 'live')
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
  'The write boundary for reporting a sighting. SECURITY DEFINER: pins spotter_id to the caller, HARD-CODES status=unverified, derives location_unavailable, atomically inserts the sighting + photos and increments profiles.sightings_reported. Gates: active post only, not the caller''s own post, max 3 per rolling 24h per (post, spotter), 1..3 photos each pinned to <post_id>/<own uid>/<filename> with parseable captured_at and both-or-neither GPS, whitelisted context flags (v2 chip set), bounded note/area_label/locality. ADR-0003 gallery hybrid: each photo carries source live/gallery (absent -> live); at least ONE live in-app capture is required per sighting (gallery-only rejected), and a gallery photo may carry NO lat/lng/accuracy_m (payout blindness by construction) — so location_unavailable still derives from live captures only. p_locality (optional) is the coarse PUBLIC place grain (ADR-0008). p_parked_likelihood (optional, settled/street/moving) is captured when parked flag is set. p_direction (optional, N/NE/E/SE/S/SW/W/NW) is captured when driving flag is set. p_people_presence (optional, nobody/nearby/in_vehicle) is the 3-way people observation. p_confirmed_feature_ids (optional, max 8, deduped) must all belong to the post''s distinctive features — this check is the array''s referential guard. Raises: NOT_AUTHENTICATED, POST_NOT_ACTIVE, OWN_POST, RATE_LIMITED, INVALID_PHOTOS, INVALID_INPUT.';

revoke execute on function public.create_sighting(uuid, jsonb, text[], text, text, text, text, text, text, uuid[])
  from public, anon;
grant execute on function public.create_sighting(uuid, jsonb, text[], text, text, text, text, text, text, uuid[])
  to authenticated, service_role;


-- =============================================================================
-- 3. RPC: get_post_sightings(post_id) -> jsonb   (CREATE OR REPLACE)
-- =============================================================================
-- Byte-for-byte the 20260801160000 function EXCEPT: the photos jsonb objects
-- gain a 'source' key (sp.source) — the owner-facing "added from photo
-- library" label (ADR-0003 rule 2: honest provenance, unmissable, not fine
-- print) renders from it. PRIVACY posture otherwise untouched: the spotter
-- block is byte-identical.
--
-- Tier 1 SAFETY: see 20260801150000 — the spotter block is first_name +
-- reputation counters + coarse member-since ONLY; the owner gate below is the
-- ONLY visibility gate (same 'NOT_OWNER' token for missing and not-owned
-- posts — no existence oracle).
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
                   where df.id = any(s.confirmed_feature_ids)
                     and df.post_id = s.post_id),
                 '[]'::jsonb),

               -- Exact capture GPS to the owner (SECURITY_AND_TRUST §1:
               -- sighting locations shown to owners are exact). source (NEW,
               -- ADR-0003) drives the owner-facing "added from photo library"
               -- label on gallery photos; gallery rows are structurally
               -- location-free (lat/lng/accuracy_m always null).
               'photos', coalesce(
                 (select jsonb_agg(
                           jsonb_build_object(
                             'path',        sp.path,
                             'lat',         sp.lat,
                             'lng',         sp.lng,
                             'accuracy_m',  sp.accuracy_m,
                             'captured_at', sp.captured_at,
                             'source',      sp.source)
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
  'OWNER-ONLY: every sighting on the caller''s own post, newest-first, with photos (exact capture GPS + ADR-0003 source live/gallery — the owner-facing "added from photo library" label renders from it; gallery photos are structurally location-free), the optional context fields (parked_likelihood, direction, people_presence — nullable), the confirmed distinctive marks as {id, description} pairs (never photo_url — the payload stays lean) and a privacy-minimised spotter block (first_name + reputation counters + month member_since — NEVER spotter_id/display_name/email/avatar; SECURITY_AND_TRUST §1). Raises NOT_AUTHENTICATED, NOT_OWNER (same token for missing and not-owned posts).';

-- SAFETY: same lockdown — no PUBLIC, no anon (re-asserted; CREATE OR REPLACE
-- keeps existing grants, but the posture is re-stated per house style).
revoke execute on function public.get_post_sightings(uuid) from public, anon;
grant  execute on function public.get_post_sightings(uuid) to authenticated, service_role;


-- =============================================================================
-- END OF MIGRATION
-- =============================================================================

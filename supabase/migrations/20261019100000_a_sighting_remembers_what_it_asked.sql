-- #############################################################################
-- ## ⚠️ DESTRUCTIVE STATEMENT: ONE `DROP FUNCTION`                            ##
-- ##                                                                          ##
-- ##   drop function public.create_sighting(uuid, jsonb, text[], text, text,  ##
-- ##                                        text, text, text, text, uuid[])   ##
-- ##                                                                          ##
-- ## create_sighting gains an 11th, trailing, defaulted parameter. A function's##
-- ## identity is its argument types, so CREATE OR REPLACE would NOT replace   ##
-- ## the 10-arg function — it would add a SECOND overload, and PostgREST      ##
-- ## would then refuse every named-arg call that omits the new parameter as  ##
-- ## ambiguous (PGRST203). So the 10-arg signature is dropped and the 11-arg ##
-- ## one created in the SAME transaction (a migration is one transaction: no ##
-- ## moment exists where neither is callable). Because the new parameter     ##
-- ## defaults to NULL, every existing caller — the shipped app's 10 named    ##
-- ## args, the suites' positional calls — resolves to the new function       ##
-- ## unchanged. The grants and comment are re-applied (a drop takes them     ##
-- ## with it): EXECUTE to authenticated + service_role ONLY, never anon or   ##
-- ## public — exactly the 20260801180000 posture.                            ##
-- ##                                                                          ##
-- ## No table, column, row or policy is dropped. update_post_distinctive_    ##
-- ## features DELETES fewer rows than before (only marks the owner removed). ##
-- #############################################################################
--
-- WHAT:  The owner's sighting page can say honestly which of their marks a
--        spotter saw and which they did NOT:
--          1. sightings.offered_feature_ids uuid[] (nullable) — the marks the
--             report wizard actually SHOWED the spotter ("Could you see any of
--             these?"). NULL = unknown (older app, older report); '{}' = asked,
--             but there were no marks to show.
--          2. create_sighting gains p_offered_feature_ids (trailing, default
--             NULL) — bounded, deduped, silently intersected with THIS post's
--             current marks, and confirmed must be a subset of it.
--          3. get_post_sightings returns 'offered_feature_ids' on each row.
--          4. update_post_distinctive_features keeps mark ids STABLE across an
--             edit: it matches the payload to existing rows by photo_url and
--             UPDATEs them, instead of deleting and re-inserting every mark.
-- WHY:   Two gaps made "not seen" impossible to say honestly:
--          (a) every edit of the marks section re-created every row with a NEW
--              id, so sightings.confirmed_feature_ids (uuid[], no FK) dangled
--              and get_post_sightings' join silently dropped them — a spotter
--              who confirmed the cracked mirror looked like they hadn't, the
--              moment the owner fixed a typo in its caption;
--          (b) nothing recorded what the spotter was ASKED, so a mark added
--              after the report, a report from before marks existed, or a
--              wizard whose marks fetch failed would all read as "not seen".
-- LINKS: supabase/migrations/20260801180000_sighting_photo_source.sql (the
--          create_sighting body re-issued here);
--        supabase/migrations/20260903100000_withdraw_a_sighting.sql (the
--          get_post_sightings body re-issued here);
--        supabase/migrations/20260731100000_edit_safe_sections_when_live.sql
--          (the update_post_distinctive_features body re-issued here);
--        supabase/migrations/20260801150000_sighting_context_v2.sql
--          (confirmed_feature_ids — the column this makes trustworthy);
--        supabase/migrations/20260901160000_orphaned_photo_queue.sql (the
--          AFTER DELETE trigger on post_distinctive_feature — fires on far
--          fewer rows now, see §4);
--        supabase/tests/sighting_marks_offered_verification.sql;
--        docs/SECURITY_AND_TRUST.md §1/§6 (owner-only sighting detail).
--
-- NOT CHANGED, deliberately:
--   * create_post / update_post (the DRAFT edit) still insert / full-replace
--     marks. A draft can never carry a sighting (create_sighting requires
--     status = 'active'), so there is no id for a sighting to hold yet.
--   * The client column grant on public.sightings (20260814150000) is NOT
--     widened: offered_feature_ids reaches the owner only through
--     get_post_sightings, and no client may read or write the column directly
--     (deny by default; the suite asserts it).
--   * The existing confirmed-ids checks are byte-identical, including the HARD
--     reject of a confirmed id that is not one of this post's marks. Only the
--     OFFERED ids are forgiven when stale (§2 explains why the two differ).
-- =============================================================================


-- =============================================================================
-- 1. COLUMN: sightings.offered_feature_ids
-- =============================================================================
-- Nullable with NO default and NO backfill: every existing row is honestly
-- "unknown" — we never recorded what those spotters were shown.
alter table public.sightings
  add column offered_feature_ids uuid[];

comment on column public.sightings.offered_feature_ids is
  'Ids of the post''s post_distinctive_feature rows the report wizard SHOWED the spotter ("Could you see any of these?"), 2026-10-19. NULL = unknown (a report from an older app, or from before this column existed) — never read as "not seen". ''{}'' = the spotter was asked but the post had no marks to show. Written only by create_sighting: deduped, at most 8, intersected with the post''s marks at report time (stale ids are dropped, not rejected), and always a superset of confirmed_feature_ids. Mark ids are stable across owner edits since this migration, so these keep resolving. No array-element FK exists; a mark the owner later deletes simply stops resolving. Not in the client column grant — read through get_post_sightings only.';


-- =============================================================================
-- 2. RPC: create_sighting  (DROP the 10-arg signature, CREATE the 11-arg one)
-- =============================================================================
-- ⚠️ DESTRUCTIVE — see the banner at the top of this file.
drop function public.create_sighting(
  uuid, jsonb, text[], text, text, text, text, text, text, uuid[]
);

-- Tier 1 SAFETY: the body is 20260801180000's byte-for-byte with EXACTLY these
-- changes, all marked "NEW 20261019100000" below:
--   (a) the trailing parameter p_offered_feature_ids uuid[] default null;
--   (b) one declare (v_offered);
--   (c) the offered-ids block after the confirmed-ids block;
--   (d) offered_feature_ids in the sightings INSERT column/value lists.
-- Every existing gate — auth, active-post, OWN_POST, advisory-lock rate limit,
-- photo checks, path pinning, ADR-0003 rules, flag/text bounds, the
-- confirmed-ids guard — is unchanged. Diff it against 20260801180000.
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
  p_confirmed_feature_ids uuid[] default null,
  -- NEW 20261019100000 (a). Trailing + defaulted so every older caller keeps
  -- resolving here unchanged and stores NULL, meaning unknown.
  p_offered_feature_ids  uuid[] default null
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
  -- NEW 20261019100000 (b). NOT coalesced: NULL ("unknown") and '{}' ("asked,
  -- nothing to show") are different facts and both are stored as given.
  v_offered              uuid[]  := p_offered_feature_ids;
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

  -- --- NEW 20261019100000 (c): offered features ---------------------------------
  -- The marks the wizard SHOWED the spotter. Skipped entirely when NULL: an
  -- older client said nothing, so we store NULL ("unknown") and apply none of
  -- the rules below — old clients keep working exactly as before.
  if v_offered is not null then
    -- A MALFORMED payload is still a hard reject: same bound (8 = the post's
    -- mark cap), same before-dedupe order, same ndims guard as confirmed.
    if array_ndims(v_offered) > 1 or cardinality(v_offered) > 8 then
      raise exception 'INVALID_INPUT: too many offered features';
    end if;

    -- A STALE id is silently DROPPED, not rejected. The owner can edit their
    -- marks while a spotter is mid-report; offered_feature_ids is display
    -- metadata for the owner, and a mark deleted under the spotter must never
    -- make the whole report — the evidence — fail to send. Intersecting with
    -- THIS post's marks is also the referential guard: no other post's id,
    -- and no made-up id, is ever stored. Nothing is revealed either way (the
    -- call succeeds identically), so this is no oracle. Deduped like
    -- confirmed; '{}' stays '{}' ("asked, nothing to show"), never NULL.
    select coalesce(array_agg(distinct fid), '{}')
      into v_offered
    from unnest(v_offered) as fid
    where exists (
      select 1
      from public.post_distinctive_feature df
      where df.id = fid
        and df.post_id = p_post_id);

    -- A real wizard only confirms marks it showed, so confirmed must be a
    -- subset of offered. Its OWN token rather than the opaque 'unknown
    -- feature id', because it cannot leak anything: by this point every
    -- confirmed id has ALREADY been proven to be one of this post's marks
    -- (else 'unknown feature id' was raised above), and both arrays are the
    -- caller's own input. A distinct token names the client bug precisely.
    -- (The intersection above cannot cause this: it removes only ids that are
    -- not this post's marks, and every confirmed id is one.)
    if not (v_confirmed <@ v_offered) then
      raise exception 'INVALID_INPUT: confirmed feature not offered';
    end if;
  end if;

  -- --- Atomic assembly (single transaction) ------------------------------------
  -- SAFETY: spotter_id pinned to the caller; status HARD-CODED 'unverified';
  -- location_unavailable derived (true only when NO photo carried GPS). The
  -- derivation is UNCHANGED by ADR-0003: gallery photos can never be located
  -- (rejected above), so only live captures can set v_any_located — exactly
  -- the ADR posture: location evidence comes from live capture only.
  -- NEW 20261019100000 (d): offered_feature_ids — NULL when not sent.
  insert into public.sightings (
    post_id, spotter_id, status, context_flags, note, area_label, locality,
    parked_likelihood, direction, people_presence, confirmed_feature_ids,
    location_unavailable, offered_feature_ids
  )
  values (
    p_post_id, v_spotter, 'unverified', v_flags, p_note, p_area_label, v_locality,
    v_parked_likelihood, v_direction, v_people_presence, v_confirmed,
    not v_any_located, v_offered
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

comment on function public.create_sighting(uuid, jsonb, text[], text, text, text, text, text, text, uuid[], uuid[]) is
  'The write boundary for reporting a sighting. SECURITY DEFINER: pins spotter_id to the caller, HARD-CODES status=unverified, derives location_unavailable, atomically inserts the sighting + photos and increments profiles.sightings_reported. Gates: active post only, not the caller''s own post, max 3 per rolling 24h per (post, spotter), 1..3 photos each pinned to <post_id>/<own uid>/<filename> with parseable captured_at and both-or-neither GPS, whitelisted context flags (v2 chip set), bounded note/area_label/locality. ADR-0003 gallery hybrid: each photo carries source live/gallery (absent -> live); at least ONE live in-app capture is required per sighting (gallery-only rejected), and a gallery photo may carry NO lat/lng/accuracy_m (payout blindness by construction) — so location_unavailable still derives from live captures only. p_locality (optional) is the coarse PUBLIC place grain (ADR-0008). p_parked_likelihood (optional, settled/street/moving) is captured when parked flag is set. p_direction (optional, N/NE/E/SE/S/SW/W/NW) is captured when driving flag is set. p_people_presence (optional, nobody/nearby/in_vehicle) is the 3-way people observation. p_confirmed_feature_ids (optional, max 8, deduped) must all belong to the post''s distinctive features — this check is the array''s referential guard. p_offered_feature_ids (optional, 20261019100000; max 8, deduped) = the marks the wizard SHOWED: NULL stores NULL (unknown) and skips every offered rule; otherwise ids that are not this post''s marks are silently DROPPED (a mark edited away mid-report must not fail the report), ''{}'' is stored as ''{}'', and confirmed must be a subset of it (INVALID_INPUT: confirmed feature not offered). Raises: NOT_AUTHENTICATED, POST_NOT_ACTIVE, OWN_POST, RATE_LIMITED, INVALID_PHOTOS, INVALID_INPUT.';

-- SAFETY: functions default to EXECUTE for PUBLIC, and Supabase's default
-- privileges re-grant anon at CREATE time — a freshly CREATEd function (unlike
-- a replaced one) starts open. Lock it down, then grant deliberately. Same
-- posture as 20260801180000.
revoke execute on function public.create_sighting(uuid, jsonb, text[], text, text, text, text, text, text, uuid[], uuid[])
  from public, anon;
-- Who: signed-in users (to report a sighting) and the service role. Never anon.
grant execute on function public.create_sighting(uuid, jsonb, text[], text, text, text, text, text, text, uuid[], uuid[])
  to authenticated, service_role;


-- =============================================================================
-- 3. RPC: get_post_sightings(post_id) -> jsonb   (CREATE OR REPLACE)
-- =============================================================================
-- Restated from 20260903100000 (nothing later redefines it). The ONLY
-- difference is the 'offered_feature_ids' key: to_jsonb of the column, so JSON
-- null when unknown and a uuid array otherwise. The owner-only gate, the
-- withdrawn filter, the spotter minimisation and confirmed_features are
-- byte-identical. Ids only — the client already holds the post's marks
-- (get_post_detail) and resolves them there, so no photo_url is added.
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
               -- NEW 2026-08-16: when the OWNER ruled on this sighting.
               -- Their own act, returned to them; see the migration header.
               'reviewed_at',          s.reviewed_at,
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

               -- NEW 20261019100000: the marks the spotter was SHOWN. JSON
               -- null = unknown (older report) — the client must not read
               -- that as "not seen"; [] = asked, no marks to show.
               'offered_feature_ids',  to_jsonb(s.offered_feature_ids),

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
  where s.post_id = p_post_id
    -- ⚠️ A WITHDRAWN sighting is gone from every surface but the spotter's
    -- own record. Withdrawing means "I got this wrong, do not act on it" —
    -- leaving it visible to the owner (or on the public map) would keep the
    -- exact claim the spotter retracted in front of the person it misleads.
    and s.status <> 'withdrawn';

  return v_out;
end;
$$;

comment on function public.get_post_sightings(uuid) is
  'Returns every sighting on ONE post for its OWNER. SECURITY DEFINER; the owner check inside the body is the ONLY visibility gate (missing and not-owned are the same NOT_OWNER, so the id is no oracle). Spotter block is first_name + reputation counters + month-grained member_since — never spotter_id, never a surname. Adds (2026-08-16) reviewed_at: WHEN THE OWNER SET THE CURRENT VERDICT — their own act, returned to them; it is overwritten by a correction, so it is not a history. review_flags and counted_at remain absent (20260814150000): naming the signal that caught a colluding pair is a tutorial in evading it. Withdrawn sightings are excluded (20260903100000). Adds (2026-10-19) offered_feature_ids: the mark ids the spotter was SHOWN — JSON null when unknown (older report; never "not seen"), [] when asked with no marks, else uuids that may include marks since deleted (they simply do not resolve).';

-- SAFETY: CREATE OR REPLACE keeps the ACL; re-stated per house style.
-- Who: the post's owner, signed in (the body enforces ownership). Never anon.
revoke execute on function public.get_post_sightings(uuid) from public, anon;
grant  execute on function public.get_post_sightings(uuid) to authenticated, service_role;


-- =============================================================================
-- 4. RPC: update_post_distinctive_features — mark ids survive an edit
-- =============================================================================
-- Restated from 20260731100000 §2. Signature, auth check, status gate, FOR
-- UPDATE lock, validation and raise codes are byte-identical. ONLY the write
-- step changes: full replace -> pair / delete / update / insert.
--
-- MATCHING: by photo_url, within THIS post only. Each mark has its own
-- uploaded photo, and the client re-sends an unchanged mark's existing public
-- URL verbatim (saveDistinctiveFeatures keeps remote photos), so the URL is the
-- mark's identity across an edit. A NEW photo uploads under a new name, so a
-- replaced photo reads as remove-old + add-new — correctly a different mark.
-- Each existing row is claimed by at most ONE payload element, in ordinality
-- order: with a duplicated URL the first element takes the row and the rest
-- insert as new rows.
--
-- POSITIONS: post_distinctive_feature has NO unique constraint or index on
-- (post_id, position) — only the plain post_distinctive_feature_post_id_
-- position_idx (20260724100000) — so rows passing through each other's
-- positions inside this transaction cannot collide, and no offset step is
-- needed. ⚠️ If a UNIQUE (post_id, position) is ever added, it must be
-- DEFERRABLE INITIALLY DEFERRED, or this must first park matched rows at
-- position + 1000 and then set the final positions, or a reorder will fail.
--
-- ORPHAN QUEUE: the AFTER DELETE trigger (20260901160000) now fires only for
-- marks the owner actually removed — before, every edit queued every mark
-- photo, and claim_orphaned_photos had to discover they were still in use.
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
  -- NEW 20261019100000: the pairing. v_match[i] is the existing row id the
  -- i-th payload element (1-based ordinality) keeps, or NULL for a new mark;
  -- v_kept is the same ids without the NULLs.
  v_ord          bigint;
  v_match        uuid[] := '{}';
  v_kept         uuid[] := '{}';
  v_id           uuid;
begin
  if v_owner is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  -- SAFETY: DRAFT + PENDING_VERIFICATION + ACTIVE gate. Safe on a LIVE post because
  -- the delete/insert below is SCOPED to this post's evidence child rows and never
  -- touches bounty/status/owner/expires. Own + in-gate + locked, else
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

  -- --- NEW 20261019100000: keep ids stable (all SCOPED to this post) -----------
  -- Step 1 — PAIR, before writing anything. Done first and separately so a row
  -- inserted for one element can never be "matched" by a later duplicate URL.
  -- Ties between existing rows sharing a URL go to the lowest position (then
  -- id, for determinism). The FOR UPDATE on the post above serialises
  -- concurrent edits of this post, so the pairing cannot go stale mid-call.
  for v_feature, v_ord in
    select elem.value, elem.ord
    from jsonb_array_elements(v_features) with ordinality as elem(value, ord)
    order by elem.ord
  loop
    select df.id into v_id
    from public.post_distinctive_feature df
    where df.post_id = p_post_id
      and df.photo_url = v_feature ->> 'photo_url'
      and df.id <> all(v_kept)
    order by df.position, df.id
    limit 1;

    -- NULL when unmatched (a new mark); array_append keeps the NULL, so
    -- v_match stays index-aligned with the payload's ordinality.
    v_match := array_append(v_match, v_id);
    if v_id is not null then
      v_kept := array_append(v_kept, v_id);
    end if;
  end loop;

  -- Step 2 — DELETE the marks the owner removed: this post's rows that no
  -- payload element claimed. (`<> all('{}')` is true, so an empty payload
  -- removes every mark — the old full-replace behaviour for that case.)
  delete from public.post_distinctive_feature df
  where df.post_id = p_post_id
    and df.id <> all(v_kept);

  -- Step 3 — UPDATE the kept marks in place: same id, so a sighting's
  -- confirmed_feature_ids / offered_feature_ids keep resolving. description
  -- stored trimmed; position = ordinality-1 (0-based), as before.
  update public.post_distinctive_feature df
  set description = btrim(elem.value ->> 'description'),
      position    = (elem.ord - 1)::int
  from jsonb_array_elements(v_features) with ordinality as elem(value, ord)
  where df.post_id = p_post_id
    and v_match[elem.ord::int] is not null
    and df.id = v_match[elem.ord::int];

  -- Step 4 — INSERT the new marks (no claimed row), exactly as before.
  insert into public.post_distinctive_feature (post_id, photo_url, description, position)
  select p_post_id,
         elem.value ->> 'photo_url',
         btrim(elem.value ->> 'description'),
         (elem.ord - 1)::int
  from jsonb_array_elements(v_features) with ordinality as elem(value, ord)
  where v_match[elem.ord::int] is null;

  return jsonb_build_object('post_id', p_post_id);
end;
$$;

comment on function public.update_post_distinctive_features(uuid, jsonb) is
  'SAFE per-section edit allowed on an own DRAFT, PENDING_VERIFICATION or ACTIVE (live) post (else POST_NOT_EDITABLE). Since 20261019100000 mark ids are STABLE across edits: each payload element is matched to an existing row of this post by photo_url (each row claimed at most once, first by ordinality; duplicates insert new), matched rows are UPDATEd in place (description trimmed, position=ordinality-1), unmatched elements INSERTed, and rows whose photo_url left the payload DELETEd — so sightings.confirmed_feature_ids / offered_feature_ids keep resolving after an edit. jsonb array, <=8 (DISTINCTIVE_FEATURES_COUNT); each description 3-80 trimmed (INVALID_DISTINCTIVE_FEATURE); each photo_url an own-folder object (INVALID_DISTINCTIVE_PHOTO_URL). Money-neutral — NEVER writes bounty/status/owner_id/expires_at — which is why it is permitted on a paid, live post. Also raises NOT_AUTHENTICATED.';

-- SAFETY: CREATE OR REPLACE keeps the ACL; re-stated per house style.
-- Who: the post's owner, signed in (the body pins owner_id = auth.uid()).
revoke execute on function public.update_post_distinctive_features(uuid, jsonb) from public;
revoke execute on function public.update_post_distinctive_features(uuid, jsonb) from anon;
grant  execute on function public.update_post_distinctive_features(uuid, jsonb) to authenticated, service_role;


-- =============================================================================
-- END OF MIGRATION
-- =============================================================================

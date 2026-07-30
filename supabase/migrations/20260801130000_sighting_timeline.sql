-- =============================================================================
-- WHAT:  Sighting timeline groundwork, four parts:
--          1. sightings.locality — a new nullable column: the coarse,
--             PUBLIC-facing place grain (district/city) captured at report
--             time from the reverse-geocode's structured fields.
--          2. create_sighting re-issued with one new OPTIONAL parameter
--             (p_locality text default null). The old 5-arg signature is
--             DROPPED and the 6-arg one created (see SAFETY below).
--          3. get_public_sighting_entries(post_id) — the FIRST AND ONLY
--             public (anon-executable) sighting surface: an active post's 5
--             most recent sightings as {sighted_at, locality} entries plus a
--             count of the remainder. Nothing else about a sighting is in it.
--          4. mark_sighting_helpful(sighting_id) — the owner-only
--             unverified -> helpful transition, with its one-time
--             profiles.sightings_helpful reputation bump.
-- WHY:   ADR-0008 (accepted 2026-07-29) loosens SECURITY_AND_TRUST §6's
--        "public sees none" to a restrained per-sighting list: visible
--        activity is the network's credibility claim, and locality-grain
--        recency tells a thief nothing they don't already know while telling
--        would-be spotters whether watching HERE is still worthwhile. The
--        sighting's real secrets — who reported it, exactly where, what it
--        looked like — stay owner-only, fenced BY CONSTRUCTION in a dedicated
--        RPC (the table itself stays ungranted to anon and RLS-closed).
--        DOMAIN.md "Sighting rules" (2026-07-29) also makes mark helpful
--        live: unverified -> helpful exclusively, owner-of-post only,
--        idempotent re-marks, and a 'credited' sighting is a payout record
--        that never re-labels.
-- LINKS: docs/decisions/ADR-0008-public-sighting-entries.md,
--        docs/DOMAIN.md (Sighting rules — helpful transition + public entries),
--        docs/SECURITY_AND_TRUST.md §1/§6 (the carve-out this implements),
--        supabase/migrations/20260714100000_sightings.sql (the base
--          create_sighting body re-issued here; table + grant posture),
--        supabase/tests/sightings_verification.sql (CHECKs 14–18 added with
--          this migration).
--
-- SAFETY NOTE ON DESTRUCTIVE STATEMENTS / POLICY POSTURE:
--   * This migration is NOT fully additive in POLICY terms. It opens the
--     first-ever PUBLIC sighting surface: get_public_sighting_entries is
--     granted to anon DELIBERATELY (ADR-0008) — every other sighting function
--     stays authenticated-only. And it re-issues the Tier 1 create_sighting
--     write boundary.
--   * ONE DESTRUCTIVE STATEMENT:
--       drop function public.create_sighting(uuid, jsonb, text[], text, text)
--     The new parameter is DEFAULTED, so the signature changes; CREATE OR
--     REPLACE would have created a second overload alongside the old one and
--     made every existing 5-arg call ambiguous. The old signature is dropped
--     and the 6-arg function created + re-revoked + re-granted in the same
--     transaction (existing 5-arg callers keep working via the default).
--   * BYTE-FOR-BYTE CLAIM (diff it): the new create_sighting body is copied
--     byte-for-byte from 20260714100000_sightings.sql with EXACTLY four
--     additions — (a) the p_locality parameter, (b) one v_locality declare
--     line (trim; empty -> null), (c) one INVALID_INPUT length guard for
--     locality, (d) the locality column/value in the sightings INSERT.
--     Nothing else in the body changed.
-- =============================================================================


-- =============================================================================
-- 1. COLUMN: sightings.locality
-- =============================================================================
-- Nullable: older sightings (and failed geocodes) have none, and their public
-- entries render time-only. Bounded like the table's other text columns.
alter table public.sightings
  add column locality text
    constraint sightings_locality_len_chk
      check (char_length(locality) <= 80);

comment on column public.sightings.locality is
  'The coarse, PUBLIC-facing place grain (district/city) captured at report time from the reverse-geocode''s structured fields — deliberately separate from area_label (street-level, owner-only). NULL = older sighting or failed geocode; the public entry renders time-only. NEVER backfilled from area_label: string-parsing display text would smuggle street names into the public payload (ADR-0008).';

-- No new index: get_public_sighting_entries reads (post_id, created_at desc
-- limit 5), which the existing sightings_post_created_idx already serves;
-- mark_sighting_helpful is a primary-key lookup.


-- =============================================================================
-- 2. RPC: create_sighting(...) -> jsonb   (RE-ISSUE — signature change)
-- =============================================================================
-- SAFETY (DESTRUCTIVE — flagged in the header): the 5-arg signature must go
-- before the 6-arg defaulted one arrives, or 5-arg calls become ambiguous
-- between the two overloads. DROP also removes the old grants/comment; both
-- are re-issued below on the new signature.
drop function public.create_sighting(uuid, jsonb, text[], text, text);

-- Creates ONE sighting (+ photo rows) on an active post and returns
-- { "sighting_id": <uuid> }.
--
-- SAFETY (Tier 1 — read before editing anything below):
--   * SECURITY DEFINER: bypasses RLS/grants so this one trusted path can write
--     sightings/sighting_photos (no client grant exists) and increment the
--     server-owned profiles.sightings_reported counter — while PINNING
--     spotter_id to the caller and HARD-CODING status = 'unverified'. There is
--     no status parameter; the lifecycle is never client-selectable.
--   * auth.uid() reads the CALLER's JWT claim (a request GUC), not the definer
--     role, so it correctly identifies the caller under SECURITY DEFINER.
--   * Every gate below is a SERVER re-check; client-side validation is
--     untrusted. Each raise MESSAGE STARTS with a machine token the client
--     maps: POST_NOT_ACTIVE / OWN_POST / RATE_LIMITED / INVALID_PHOTOS /
--     INVALID_INPUT (plus the NOT_AUTHENTICATED backstop).
--   * A plpgsql body is a single transaction: sighting + photos + counter
--     increment land ATOMICALLY or not at all.
--   * location_unavailable is DERIVED (true only when NO photo carries GPS),
--     never client-asserted.
--   * p_locality (NEW, ADR-0008) is the coarse PUBLIC place grain from the
--     reverse-geocode's structured fields — trimmed, empty -> null, bounded
--     at 80. It is the ONLY sighting field that ever reaches anon.
create function public.create_sighting(
  p_post_id       uuid,
  p_photos        jsonb,
  p_context_flags text[],
  p_note          text,
  p_area_label    text,
  p_locality      text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_spotter     uuid := auth.uid();
  v_owner       uuid;
  v_post_status public.post_status;
  v_recent      int;
  v_photo_count int;
  v_elem        jsonb;
  v_path        text;
  v_captured    timestamptz;
  v_lat         double precision;
  v_lng         double precision;
  v_acc         double precision;
  v_any_located boolean := false;
  v_flags       text[]  := coalesce(p_context_flags, '{}');
  v_locality    text    := nullif(btrim(p_locality), '');
  v_sighting_id uuid;
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
  if not (v_flags <@ array['parked', 'driving', 'people_nearby', 'plate_changed']::text[]) then
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

  -- --- Atomic assembly (single transaction) ------------------------------------
  -- SAFETY: spotter_id pinned to the caller; status HARD-CODED 'unverified';
  -- location_unavailable derived (true only when NO photo carried GPS).
  insert into public.sightings (
    post_id, spotter_id, status, context_flags, note, area_label, locality,
    location_unavailable
  )
  values (
    p_post_id, v_spotter, 'unverified', v_flags, p_note, p_area_label, v_locality,
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

comment on function public.create_sighting(uuid, jsonb, text[], text, text, text) is
  'The write boundary for reporting a sighting. SECURITY DEFINER: pins spotter_id to the caller, HARD-CODES status=unverified, derives location_unavailable, atomically inserts the sighting + photos and increments profiles.sightings_reported. Gates: active post only, not the caller''s own post, max 3 per rolling 24h per (post, spotter), 1..3 photos each pinned to <post_id>/<own uid>/<filename> with parseable captured_at and both-or-neither GPS, whitelisted context flags, bounded note/area_label/locality. p_locality (optional) is the coarse PUBLIC place grain (ADR-0008): trimmed, empty -> null, max 80. Raises: NOT_AUTHENTICATED, POST_NOT_ACTIVE, OWN_POST, RATE_LIMITED, INVALID_PHOTOS, INVALID_INPUT.';

-- SAFETY: functions default to EXECUTE for PUBLIC, and this project's default
-- privileges ALSO auto-grant EXECUTE to anon at CREATE time (the 20260713191000
-- incident) — revoke BOTH explicitly, then grant to authenticated +
-- service_role only. Reporting a sighting requires an account (DOMAIN.md:
-- "Log in to report a sighting"). Re-issued here on the NEW signature (the
-- DROP above took the old grants with it).
revoke execute on function public.create_sighting(uuid, jsonb, text[], text, text, text)
  from public, anon;
grant execute on function public.create_sighting(uuid, jsonb, text[], text, text, text)
  to authenticated, service_role;


-- =============================================================================
-- 3. RPC: get_public_sighting_entries(post_id) -> jsonb   (THE public surface)
-- =============================================================================
-- Returns { "entries": [{ "sighted_at", "locality" }, ...], "earlier_count": n }
-- for an ACTIVE post: the 5 most recent sightings newest-first (locality may be
-- null -> the client renders time-only), and how many earlier ones exist as a
-- NUMBER, never a list.
--
-- SAFETY (Tier 1 — ADR-0008, ABSENCE BY CONSTRUCTION):
--   * This is the ONE public sighting surface. The payload is built from
--     exactly two columns: created_at and locality. It must NEVER contain
--     sighting ids, coordinates, photo paths/counts, spotter anything, notes,
--     status, area_label, or accuracy. If you add a field here, re-read
--     ADR-0008 and SECURITY_AND_TRUST §1/§6 first — widening this payload is
--     a privacy decision, not a feature tweak.
--   * ACTIVE posts only: a missing post and a non-active (draft/pending/
--     closed) post return the SAME empty shape — no existence oracle, and a
--     closed post's public entries vanish with it (§3 posture).
--   * The sightings table itself stays ungranted to anon and RLS-closed;
--     SECURITY DEFINER is what lets this fenced read exist at all.
create function public.get_public_sighting_entries(p_post_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_status  public.post_status;
  v_total   bigint;
  v_entries jsonb;
begin
  -- SAFETY: missing and non-active are indistinguishable — same shape, no
  -- error, no oracle.
  select p.status into v_status from public.posts p where p.id = p_post_id;
  if not found or v_status <> 'active' then
    return jsonb_build_object('entries', '[]'::jsonb, 'earlier_count', 0);
  end if;

  select count(*) into v_total
  from public.sightings s
  where s.post_id = p_post_id;

  -- Cap of 5 enforced SERVER-side (ADR-0008): the remainder is a count, not a
  -- list. Served by the existing sightings_post_created_idx.
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'sighted_at', t.created_at,
               'locality',   t.locality)
             order by t.created_at desc),
           '[]'::jsonb)
    into v_entries
  from (
    select s.created_at, s.locality
    from public.sightings s
    where s.post_id = p_post_id
    order by s.created_at desc
    limit 5
  ) t;

  return jsonb_build_object(
    'entries',       v_entries,
    'earlier_count', greatest(v_total - 5, 0));
end;
$$;

comment on function public.get_public_sighting_entries(uuid) is
  'THE one public sighting surface (ADR-0008): an ACTIVE post''s 5 most recent sightings, newest-first, as { sighted_at, locality } entries (locality nullable -> time-only) plus earlier_count. ABSENCE BY CONSTRUCTION: never ids, coordinates, photos, spotter fields, notes, status, area_label, or accuracy. Missing and non-active posts return the SAME empty shape (no existence oracle). Granted to anon DELIBERATELY — the only sighting function that is.';

-- SAFETY: anon is DELIBERATE here — this is the single public carve-out from
-- "public sees none" (ADR-0008; SECURITY_AND_TRUST §6 names this RPC). Every
-- OTHER sighting function remains authenticated-only; do not copy this grant
-- line as a template. Revoke PUBLIC first per house style.
revoke execute on function public.get_public_sighting_entries(uuid) from public;
grant  execute on function public.get_public_sighting_entries(uuid)
  to anon, authenticated, service_role;


-- =============================================================================
-- 4. RPC: mark_sighting_helpful(sighting_id) -> jsonb   (owner-only transition)
-- =============================================================================
-- The DOMAIN.md sighting transition "unverified -> helpful (owner marks
-- helpful; bumps sightings_helpful)" — declared in 20260714100000's status
-- comment, delivered here.
--
-- SAFETY (Tier 1):
--   * SECURITY DEFINER is the ONLY path that writes sightings.status for this
--     transition (clients hold no update grant on the table at all).
--   * Owner gate: the caller must OWN the post the sighting belongs to. A
--     missing sighting and a not-owned one raise the SAME opaque 'NOT_OWNER'
--     — the sightings feature's existing owner-gate token (get_post_sightings
--     uses it for exactly this missing-or-not-yours pair), so no new token to
--     map and no existence oracle for sighting ids.
--   * Allowed transitions (comment per DOMAIN.md, each branch below):
--       unverified -> helpful : sets status + bumps the spotter's
--                               sightings_helpful by 1 (changed: true)
--       helpful    -> helpful : idempotent no-op, NO second bump
--                               (changed: false)
--       credited   -> (none)  : a payout record never re-labels; returns
--                               status 'credited' unchanged rather than
--                               erroring (the owner may tap an old entry)
--   * FOR UPDATE locks the sighting row, so a double-tap serialises: the
--     second call re-reads 'helpful' after the first commits and takes the
--     no-op branch — the counter can only ever bump once per sighting.
create function public.mark_sighting_helpful(p_sighting_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_caller   uuid := auth.uid();
  v_sighting public.sightings%rowtype;
  v_owner    uuid;
begin
  -- SAFETY: backstop; the grant below already excludes anon.
  if v_caller is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  -- SAFETY: row lock FIRST — concurrent calls for the same sighting queue
  -- here, so the status read below is always post-commit fresh and the
  -- counter bump cannot double-fire on a double-tap.
  select s.* into v_sighting
  from public.sightings s
  where s.id = p_sighting_id
  for update;

  -- Missing sighting: same opaque token as not-owner (no existence oracle).
  if not found then
    raise exception 'NOT_OWNER';
  end if;

  -- SAFETY: the ONLY visibility/authority gate — the caller must own the
  -- post this sighting was reported on.
  select p.owner_id into v_owner
  from public.posts p
  where p.id = v_sighting.post_id;
  if v_owner is distinct from v_caller then
    raise exception 'NOT_OWNER';
  end if;

  -- credited -> (none): a payout record never re-labels (DOMAIN.md). Not an
  -- error — the owner tapping an old credited entry gets the truth back.
  if v_sighting.status = 'credited' then
    return jsonb_build_object('status', 'credited', 'changed', false);
  end if;

  -- helpful -> helpful: idempotent no-op; NO second counter bump.
  if v_sighting.status = 'helpful' then
    return jsonb_build_object('status', 'helpful', 'changed', false);
  end if;

  -- unverified -> helpful: the one real transition. Status write + the
  -- spotter's reputation bump land atomically (single plpgsql transaction).
  update public.sightings
  set status = 'helpful'
  where id = p_sighting_id;

  -- Reputation v1 (DOMAIN.md): sightings_helpful is server-maintained ONLY;
  -- this is its single increment point, reachable once per sighting.
  update public.profiles
  set sightings_helpful = sightings_helpful + 1
  where id = v_sighting.spotter_id;

  -- AUDIT: a sighting-marked-helpful audit-log insert belongs here once the
  -- audit_log table exists (SECURITY_AND_TRUST §7). Deferred with the
  -- moderation feature (same posture as create_sighting).

  return jsonb_build_object('status', 'helpful', 'changed', true);
end;
$$;

comment on function public.mark_sighting_helpful(uuid) is
  'Owner-only unverified -> helpful transition (DOMAIN.md Sighting rules). SECURITY DEFINER; FOR UPDATE row lock so the spotter''s sightings_helpful counter bumps EXACTLY once per sighting (re-marks are idempotent no-ops, changed:false). A credited sighting never re-labels — returns { status: credited, changed: false } without erroring. Missing sighting and not-post-owner raise the SAME opaque NOT_OWNER (the feature''s existing owner-gate token; no existence oracle). Raises NOT_AUTHENTICATED, NOT_OWNER.';

-- SAFETY: same lockdown as every non-public sighting function — no PUBLIC,
-- no anon. Marking helpful is an owner action; accounts only.
revoke execute on function public.mark_sighting_helpful(uuid) from public, anon;
grant  execute on function public.mark_sighting_helpful(uuid) to authenticated, service_role;


-- =============================================================================
-- END OF MIGRATION
-- =============================================================================

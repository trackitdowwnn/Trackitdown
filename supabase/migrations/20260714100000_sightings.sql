-- =============================================================================
-- WHAT:  Sightings feature database layer. Creates public.sightings (one row per
--        spotter report on an active post) and public.sighting_photos (its
--        evidence photos with capture-time GPS), the PRIVATE 'sighting-photos'
--        Storage bucket with spotter-upload / spotter-or-owner-read policies,
--        and three SECURITY DEFINER RPCs:
--          * create_sighting     — the single write boundary (validates post
--                                  state, collusion hygiene, the 3-per-24h rate
--                                  limit, and every photo field; atomic insert +
--                                  reputation increment),
--          * my_sighting_quota   — the caller's rolling-24h usage on one post,
--          * get_post_sightings  — the OWNER-only read of a post's sightings,
--                                  privacy-minimised spotter block.
--        Also CREATE-OR-REPLACEs public.get_post_detail to wake the dormant
--        sighting_stats aggregate (real count + latest_at).
-- WHY:   DOMAIN.md "Sighting rules": a sighting = photo(s) + auto-captured GPS +
--        timestamp + optional note; starts 'unverified'; max 3 per spotter per
--        post per day. SECURITY_AND_TRUST §1: sighting locations shown to owners
--        are exact, but the SPOTTER's identity shows as first name + reputation
--        only. §6: spotter sees their own sightings; the post's owner sees all
--        sightings on their post; public sees none. Raw sighting rows carry
--        spotter_id, so the owner read goes through get_post_sightings (which
--        strips it) — NEVER through row-level SELECT on the table.
-- LINKS: docs/DOMAIN.md (Sighting rules; Reputation v1; lifecycle),
--        docs/SECURITY_AND_TRUST.md §1 (spotter identity minimisation),
--          §3 (GPS only at reporting time; EXIF; 90-day location purge),
--          §5 (fraud controls: 3/post/day rate limit, in-app camera),
--          §6 (RLS deny-by-default; SECURITY DEFINER hardening),
--        supabase/migrations/20260713190000_post_a_car.sql (bucket + RPC
--          hardening conventions mirrored here),
--        supabase/migrations/20260713192000_create_post_validate_paths.sql
--          (the split_part own-folder path pinning reused for photo paths),
--        supabase/migrations/20260713180000_post_detail_structured_data.sql
--          (the CURRENT get_post_detail this migration CREATE-OR-REPLACEs),
--        supabase/migrations/20260710120000_profile_fields_and_avatars.sql
--          (profiles.sightings_reported/_helpful/recoveries_credited counters).
--
-- SAFETY NOTE ON DESTRUCTIVE STATEMENTS: NONE dropped/renamed. Fully additive
--        EXCEPT one forward CREATE OR REPLACE of public.get_post_detail(uuid)
--        (same signature; only the sighting_stats aggregate goes live and its
--        comment updates — flagged here per house convention). Two new tables +
--        indexes + RLS + grants, one idempotent bucket insert, two storage
--        policies, three new functions + grants.
-- =============================================================================


-- =============================================================================
-- 1. TABLE: sightings
-- One row per spotter report on a post. The location evidence lives on the
-- photo rows (capture-time GPS per photo); the sighting itself records the
-- report metadata.
-- =============================================================================
create table public.sightings (
  id          uuid primary key default gen_random_uuid(),

  -- The post this sighting was reported on. ON DELETE CASCADE: a sighting is
  -- evidence FOR a post and carries no independent value once the post row is
  -- gone; a post cannot be deleted while money is in flight anyway (payments'
  -- ON DELETE RESTRICT blocks the cascade), so no credited-payout trail can be
  -- lost this way. The 90-day location-history purge (SECURITY_AND_TRUST §3)
  -- is a separate retention job.
  post_id     uuid not null references public.posts (id) on delete cascade,

  -- Who reported it. ON DELETE CASCADE: UK GDPR erasure of the spotter's
  -- account removes their sightings with them (SECURITY_AND_TRUST §3).
  spotter_id  uuid not null references public.profiles (id) on delete cascade,

  -- Sighting lifecycle (DOMAIN.md): starts 'unverified'; the owner may mark it
  -- 'helpful' (reputation); exactly one may become 'credited' per recovery.
  -- TRANSITIONS: clients NEVER write this column (no client write grant/policy
  -- exists on this table at all). Allowed transitions, each arriving as its own
  -- SECURITY DEFINER function in later features:
  --   unverified -> helpful   (owner marks helpful; bumps sightings_helpful)
  --   unverified -> credited  (recovery flow; the paying sighting)
  --   helpful    -> credited  (recovery flow)
  -- Nothing ever leaves 'credited' (it is the payout record).
  status      text not null default 'unverified'
    constraint sightings_status_chk
      check (status in ('unverified', 'helpful', 'credited')),

  -- What the spotter observed, from a fixed whitelist of chips. <@ = "every
  -- element is in the whitelist"; '{}' = none selected.
  context_flags text[] not null default '{}'
    constraint sightings_context_flags_chk
      check (context_flags <@ array['parked', 'driving', 'people_nearby', 'plate_changed']::text[]),

  -- Optional free-text note. Bounded so a client cannot pad an unbounded blob
  -- into the owner's payload. (CHECK passes on NULL by SQL semantics.)
  note        text
    constraint sightings_note_len_chk
      check (char_length(note) <= 500),

  -- Optional human area label ("Ancoats, Manchester") shown alongside the
  -- exact photo GPS. Bounded.
  area_label  text
    constraint sightings_area_label_len_chk
      check (char_length(area_label) <= 120),

  -- True when NO photo on this sighting carried GPS (device denied / stripped).
  -- Computed server-side by create_sighting, never client-asserted directly.
  location_unavailable boolean not null,

  created_at  timestamptz not null default now()
);

comment on table public.sightings is
  'One spotter report on a post (DOMAIN.md Sighting rules). Written ONLY by create_sighting (SECURITY DEFINER) / service role. Spotter reads own rows via RLS; the OWNER reads via get_post_sightings ONLY (raw rows carry spotter_id, which must never reach the owner — SECURITY_AND_TRUST §1/§6); public sees none.';
comment on column public.sightings.status is
  'unverified -> helpful -> credited (DOMAIN.md). Server-transitioned only via SECURITY DEFINER functions in later features; no client write path exists.';
comment on column public.sightings.location_unavailable is
  'True when no photo on the sighting carried GPS. Derived by create_sighting from the photo payload; not independently client-settable.';

-- Rate-limit lookup: create_sighting / my_sighting_quota count the caller''s
-- sightings on one post inside a rolling 24h window.
create index sightings_post_spotter_created_idx
  on public.sightings (post_id, spotter_id, created_at);

-- Owner list: get_post_sightings fetches a post''s sightings newest-first; also
-- serves the get_post_detail count/max aggregate.
create index sightings_post_created_idx
  on public.sightings (post_id, created_at);

-- RLS predicate (spotter_id = auth.uid()) + the spotter''s own-history screen.
create index sightings_spotter_created_idx
  on public.sightings (spotter_id, created_at);

alter table public.sightings enable row level security;

-- SAFETY: under this project's config (auto_expose_new_tables unset) a new
-- public table auto-grants NO data privileges, so the SELECT policy below is
-- dead without an explicit table-level grant. SELECT to authenticated ONLY —
-- NEVER anon (public sees no sightings, SECURITY_AND_TRUST §6; anon stays
-- grant-denied 42501). NO client insert/update/delete grant — writes go through
-- create_sighting (SECURITY DEFINER, runs as owner) / service role. service_role
-- bypasses RLS but is not auto-granted, so give it full DML (moderation,
-- retention purge, and the later helpful/credited transitions use it).
grant select on public.sightings to authenticated;
grant select, insert, update, delete on public.sightings to service_role;

-- SAFETY: a signed-in SPOTTER may read their OWN sightings (their history).
-- Deliberately NO owner-of-the-post branch here: raw rows expose spotter_id,
-- so the owner's read is get_post_sightings ONLY (which strips identity down
-- to first name + reputation). No write policy exists -> client writes denied
-- by default.
create policy sightings_select_own_spotter
  on public.sightings
  for select
  to authenticated
  using (spotter_id = (select auth.uid()));


-- =============================================================================
-- 2. TABLE: sighting_photos
-- Evidence photos for a sighting, with capture-time GPS per photo.
-- =============================================================================
create table public.sighting_photos (
  id          uuid primary key default gen_random_uuid(),

  -- Parent sighting. ON DELETE CASCADE: a photo row is wholly owned by its
  -- sighting and dies with it (the storage object is removed separately by the
  -- retention job — SECURITY_AND_TRUST §3).
  sighting_id uuid not null references public.sightings (id) on delete cascade,

  -- Object name inside the PRIVATE sighting-photos bucket, pinned by
  -- create_sighting to '<post_id>/<spotter_id>/<filename>.jpg'. Never a URL —
  -- both parties fetch via signed URLs under the storage policies below.
  path        text not null,

  -- Capture-time GPS (the original location is kept ONLY here —
  -- SECURITY_AND_TRUST §3; EXIF is stripped from the served image). Both null
  -- (no fix) or both set.
  lat         double precision,
  lng         double precision,
  constraint sighting_photos_latlng_pair_chk
    check ((lat is null) = (lng is null)),

  -- GPS accuracy in metres; only meaningful on a located photo.
  accuracy_m  double precision,
  constraint sighting_photos_accuracy_located_chk
    check (accuracy_m is null or lat is not null),

  -- Device capture timestamp (validated server-side; the row's created_at is
  -- the trusted server time — DOMAIN.md/§5 "server timestamp").
  captured_at timestamptz not null,

  -- Display order within the sighting; 0-based (matches post_photos).
  position    smallint not null
    constraint sighting_photos_position_chk
      check (position >= 0),

  created_at  timestamptz not null default now()
);

comment on table public.sighting_photos is
  'Evidence photos for a sighting. path points into the PRIVATE sighting-photos bucket (<post_id>/<spotter_id>/...). lat/lng is the capture-time GPS (both-or-neither); rows are written ONLY by create_sighting / service role and are immutable to clients (evidence).';

-- Ordered fetch of a sighting''s photos + the RLS EXISTS predicate below.
create index sighting_photos_sighting_position_idx
  on public.sighting_photos (sighting_id, position);

alter table public.sighting_photos enable row level security;

-- SAFETY: same grant posture as sightings — SELECT to authenticated only
-- (never anon), no client write grant, full DML for service_role.
grant select on public.sighting_photos to authenticated;
grant select, insert, update, delete on public.sighting_photos to service_role;

-- SAFETY: a signed-in spotter may read the photo ROWS of their OWN sightings.
-- The owner's read is get_post_sightings ONLY (same reasoning as sightings).
-- No write policy exists -> client writes denied by default (evidence rows are
-- immutable to clients).
create policy sighting_photos_select_own_spotter
  on public.sighting_photos
  for select
  to authenticated
  using (
    exists (
      select 1 from public.sightings s
      where s.id = sighting_photos.sighting_id
        and s.spotter_id = (select auth.uid())
    )
  );


-- =============================================================================
-- 3. STORAGE: 'sighting-photos' — PRIVATE bucket
-- Path convention: <post_id>/<spotter_id>/<filename>.jpg
-- =============================================================================
-- SAFETY (SECURITY_AND_TRUST §1/§6): PRIVATE (public=false) — sighting photos
-- carry capture-time context of a crime scene and must be reachable ONLY by the
-- spotter who took them and the owner of the sighted post, via signed URLs.
-- 5 MB + image MIMEs mirrors post-photos (in-app camera re-encodes to JPEG; the
-- Storage API enforces these server-side regardless of what a client sends).
-- on conflict DO UPDATE: idempotent AND corrective if the bucket pre-exists.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('sighting-photos', 'sighting-photos', false, 5242880,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- SAFETY: storage.objects is RLS-enabled by Supabase with no default policies,
-- so this bucket is deny-by-default until the two policies below. Each policy
-- is scoped to bucket_id = 'sighting-photos' only.

-- SAFETY: a signed-in user may UPLOAD only under '<post_id>/<THEIR uid>/...',
-- and only while the first segment is an ACTIVE post (sightings can only be
-- reported on active posts — DOMAIN.md). foldername[1] = post_id,
-- foldername[2] = spotter uid. p.id::text comparison avoids a uuid-cast error
-- on a malformed first segment (it simply fails the check). The posts subquery
-- runs under the caller's own posts RLS, where active posts are visible.
create policy "sighting_photos_insert_spotter_active_post"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'sighting-photos'
    and (storage.foldername(name))[2] = (select auth.uid())::text
    and exists (
      select 1 from public.posts p
      where p.id::text = (storage.foldername(name))[1]
        and p.status = 'active'
    )
  );

-- SAFETY (PRIVATE bucket => SELECT is required to mint a signed URL): readable
-- by (a) the SPOTTER — second segment is their uid (their own uploads), or
-- (b) the OWNER of the post named by the first segment (the evidence was taken
-- FOR them — SECURITY_AND_TRUST §1: sighting locations shown to owners are
-- exact). Nobody else; anon holds no storage grant path here at all.
create policy "sighting_photos_select_spotter_or_post_owner"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'sighting-photos'
    and (
      (storage.foldername(name))[2] = (select auth.uid())::text
      or exists (
        select 1 from public.posts p
        where p.id::text = (storage.foldername(name))[1]
          and p.owner_id = (select auth.uid())
      )
    )
  );

-- SAFETY: deliberately NO update and NO delete policy for this bucket —
-- sighting photos are EVIDENCE (a payout may hinge on them, §5 fraud controls)
-- and are immutable to every client role once uploaded. Retention/erasure
-- cleanup runs under the service role, which bypasses these policies.


-- =============================================================================
-- 4. RPC: create_sighting(...) -> jsonb   (SECURITY DEFINER — the write boundary)
-- =============================================================================
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
create or replace function public.create_sighting(
  p_post_id       uuid,
  p_photos        jsonb,
  p_context_flags text[],
  p_note          text,
  p_area_label    text
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

  -- --- Atomic assembly (single transaction) ------------------------------------
  -- SAFETY: spotter_id pinned to the caller; status HARD-CODED 'unverified';
  -- location_unavailable derived (true only when NO photo carried GPS).
  insert into public.sightings (
    post_id, spotter_id, status, context_flags, note, area_label,
    location_unavailable
  )
  values (
    p_post_id, v_spotter, 'unverified', v_flags, p_note, p_area_label,
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

comment on function public.create_sighting(uuid, jsonb, text[], text, text) is
  'The write boundary for reporting a sighting. SECURITY DEFINER: pins spotter_id to the caller, HARD-CODES status=unverified, derives location_unavailable, atomically inserts the sighting + photos and increments profiles.sightings_reported. Gates: active post only, not the caller''s own post, max 3 per rolling 24h per (post, spotter), 1..3 photos each pinned to <post_id>/<own uid>/<filename> with parseable captured_at and both-or-neither GPS, whitelisted context flags, bounded note/area_label. Raises: NOT_AUTHENTICATED, POST_NOT_ACTIVE, OWN_POST, RATE_LIMITED, INVALID_PHOTOS, INVALID_INPUT.';

-- SAFETY: functions default to EXECUTE for PUBLIC, and this project's default
-- privileges ALSO auto-grant EXECUTE to anon at CREATE time (the 20260713191000
-- incident) — revoke BOTH explicitly, then grant to authenticated +
-- service_role only. Reporting a sighting requires an account (DOMAIN.md:
-- "Log in to report a sighting").
revoke execute on function public.create_sighting(uuid, jsonb, text[], text, text)
  from public, anon;
grant execute on function public.create_sighting(uuid, jsonb, text[], text, text)
  to authenticated, service_role;


-- =============================================================================
-- 5. RPC: my_sighting_quota(post_id) -> jsonb
-- =============================================================================
-- Returns { "used": n, "max_per_day": 3 } for the CALLER on one post over the
-- same rolling 24h window create_sighting enforces, so the client can disable
-- the report button honestly. SECURITY DEFINER for symmetry with the enforcing
-- gate (same query, same window); reveals only the caller's OWN count.
create or replace function public.my_sighting_quota(p_post_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_spotter uuid := auth.uid();
  v_used    int;
begin
  -- SAFETY: authenticated only (grant below is the wall; this is the backstop).
  if v_spotter is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select count(*) into v_used
  from public.sightings s
  where s.post_id = p_post_id
    and s.spotter_id = v_spotter
    and s.created_at > now() - interval '24 hours';

  return jsonb_build_object('used', v_used, 'max_per_day', 3);
end;
$$;

comment on function public.my_sighting_quota(uuid) is
  'The caller''s rolling-24h sighting count on one post as { used, max_per_day: 3 } — mirrors create_sighting''s RATE_LIMITED window. Authenticated only; reveals only the caller''s own count.';

-- SAFETY: same lockdown as create_sighting — no PUBLIC, no anon.
revoke execute on function public.my_sighting_quota(uuid) from public, anon;
grant  execute on function public.my_sighting_quota(uuid) to authenticated, service_role;


-- =============================================================================
-- 6. RPC: get_post_sightings(post_id) -> jsonb   (OWNER-ONLY read)
-- =============================================================================
-- Returns every sighting on the caller's OWN post, newest-first, as a jsonb
-- array. This is the ONLY way an owner reads sightings (the table RLS is
-- spotter-own-rows only).
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
  'OWNER-ONLY: every sighting on the caller''s own post, newest-first, with photos (exact capture GPS) and a privacy-minimised spotter block (first_name + reputation counters + month member_since — NEVER spotter_id/display_name/email/avatar; SECURITY_AND_TRUST §1). Raises NOT_AUTHENTICATED, NOT_OWNER (same token for missing and not-owned posts).';

-- SAFETY: same lockdown — no PUBLIC, no anon.
revoke execute on function public.get_post_sightings(uuid) from public, anon;
grant  execute on function public.get_post_sightings(uuid) to authenticated, service_role;


-- =============================================================================
-- 7. RPC: get_post_detail(post_id) -> jsonb   (CREATE OR REPLACE)
-- =============================================================================
-- Byte-for-byte the 20260713180000 function EXCEPT: the DORMANT sighting_stats
-- placeholder ({count: 0, latest_at: null}) is replaced with the REAL aggregate
-- over public.sightings. Everything else — visibility gate, hidden stub,
-- driveway coarsening, owner block, features, photos — is unchanged.
--
-- SAFETY: sighting_stats stays a SCALAR count + latest timestamp ONLY, on posts
-- the caller may already see (active or own). It MUST NEVER be widened to
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
           where sg.post_id = v_post.id)
       );
end;
$$;

comment on function public.get_post_detail(uuid) is
  'Returns one post''s detail for the post-detail screen. SECURITY DEFINER (bypasses RLS); the active-OR-owner predicate is the ONLY visibility gate. Non-visible -> minimal { found, visible:false, closedReason } stub. Visible -> full detail incl. Part-2 structured fields, features[], ordered photos, is_owner (never owner_id), owner block (first_name/month member_since), and a LIVE scalar sighting_stats { count, latest_at } aggregated from public.sightings (scalar only — sighting rows/locations are owner-only via get_post_sightings). SAFETY: a driveway theft''s last-seen point is coarsened to a ~1km grid for non-owners.';

-- Same grants as before (anon may browse active posts' detail; the aggregate is
-- scalar-only). Re-asserted so this migration is correct standalone.
revoke execute on function public.get_post_detail(uuid) from public;
grant  execute on function public.get_post_detail(uuid)
  to anon, authenticated, service_role;


-- =============================================================================
-- END OF MIGRATION
-- =============================================================================

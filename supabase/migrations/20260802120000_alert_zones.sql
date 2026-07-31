-- =============================================================================
-- WHAT:  The spotter's ALERT ZONE — the first real consumer of the push
--        infrastructure shipped in 20260802100000. Creates public.alert_zones
--        (one row per user in v1: a PostGIS point, a 1–50 mile radius, a master
--        switch and an "approximate area only" flag), with deny-by-default RLS
--        that grants the owner a read and NOBODY a write, plus three SECURITY
--        DEFINER RPCs:
--          * get_my_alert_zone()         — the caller's own zone, or
--                                          { "found": false },
--          * upsert_my_alert_zone(...)   — the SINGLE write path; snaps the
--                                          point to the ~1km grid BEFORE
--                                          storage when approximate is on, and
--                                          returns the STORED point,
--          * set_my_alert_zone_enabled() — the master switch on its own, so
--                                          pausing alerts never round-trips a
--                                          location.
-- WHY:   DOMAIN.md "Notifications": spotters set a personal alert radius
--        (1–50 miles) and a home location, stored per user; when a post goes
--        active an Edge Function runs a PostGIS radius query and pushes to the
--        matching users. There was nowhere to store that zone — the fan-out had
--        no audience to fan out to.
--
--        WHY A TABLE, NOT COLUMNS ON profiles (three separate reasons, each
--        sufficient on its own):
--          1. V2 MULTI-ZONE MUST BE ADDITIVE. "One zone per user" is a product
--             decision, not a data-model one. With the rule expressed as a
--             single unique index, DROPPING alert_zones_one_per_user_uidx *is*
--             the entire future migration: no data movement, no backfill, and
--             no change to the matching query (ST_DWithin over the table
--             already fans out over rows, not over one row per user). Columns
--             on profiles would make v2 a table-creation + copy + cutover.
--          2. INDEX COST. Radius matching needs a GiST index on the point. A
--             GiST index on profiles would be paid on EVERY profile write —
--             and profiles is written on nearly every screen (name, avatar,
--             the server-maintained reputation counters bumped by
--             create_sighting and mark_sighting_helpful). The zone changes
--             roughly never; it should not tax the hottest small table we own.
--          3. LEAK SURFACE — the real reason. profiles is the source of the
--             privacy-minimised SPOTTER block in get_post_sightings and the
--             OWNER block in get_post_detail, both assembled with
--             jsonb_build_object. A home-ish point sitting on that row is
--             exactly the field that escapes the day someone adds one more
--             line to one of those objects — the failure is a one-line diff in
--             a file about something else entirely, and it reads as harmless.
--             A separate table with a single "my own zone" read path
--             (get_my_alert_zone, gated on auth.uid()) cannot leak that way:
--             there is no join from it into any public payload to accidentally
--             widen.
-- LINKS: docs/DOMAIN.md (Notifications — alert radius 1–50 miles, home
--          location stored per user, the PostGIS fan-out on going active),
--        docs/SECURITY_AND_TRUST.md §1 (minimisation; every alert carries the
--          don't-approach line), §2 (anti-stalking; ~1km location coarsening),
--          §3 (no background location tracking; personal data cascades on
--          erasure), §6 (RLS deny-by-default; SECURITY DEFINER hardening),
--        supabase/migrations/20260802100000_push_infrastructure.sql (push_tokens
--          — the user-owned, read-own-rows-only, RPC-write-only posture this
--          table copies, and the revoke-public+anon grant pattern),
--        supabase/migrations/20260802110000_post_alert_columns.sql
--          (posts.alerts_sent_at + last_seen_locality — the other half of the
--          alert path; NOT touched here),
--        supabase/migrations/20260711130000_home_feed_location_and_rpcs.sql
--          (posts.last_seen_location geography(Point,4326) + its GiST index;
--          the 1609..80467 metre clamp mirrored by alert_zones_radius_chk),
--        supabase/migrations/20260713180000_post_detail_structured_data.sql
--          (the ST_SnapToGrid(location::geometry, 0.01) driveway-coarsening
--          idiom reused verbatim below),
--        supabase/migrations/20260707110712_payments_foundation.sql
--          (public.set_updated_at(), attached below),
--        src/features/notifications/types.ts (AlertZone / AlertZoneDraft — the
--          client mirror of these payloads),
--        src/shared/lib/distance.ts (RADIUS_MIN_MILES / RADIUS_MAX_MILES, the
--          client side of alert_zones_radius_chk),
--        src/features/notifications/README.md ("The alert zone").
--
-- SAFETY NOTE ON DESTRUCTIVE STATEMENTS: NONE. Fully additive — one new table
--        (+ two indexes + one trigger + RLS + grants + one SELECT policy) and
--        three new functions (+ grants + comments). No drop, rename, truncate
--        or CREATE OR REPLACE of any existing object; nothing in
--        20260802100000_push_infrastructure.sql or
--        20260802110000_post_alert_columns.sql is modified.
-- =============================================================================


-- =============================================================================
-- 1. TABLE: alert_zones  (one zone per user in v1)
-- =============================================================================
create table public.alert_zones (
  id          uuid primary key default gen_random_uuid(),

  -- The spotter. FK to profiles (house convention for user-owned rows —
  -- posts.owner_id, sightings.spotter_id, watchlist_items.user_id and
  -- push_tokens.user_id all reference profiles, which is 1:1 with auth.users).
  -- ON DELETE CASCADE: a zone is a location tied to a person and is meaningless
  -- without them; UK GDPR erasure of the account must take this row — a
  -- home-ish point — with it (SECURITY_AND_TRUST §3).
  user_id     uuid not null references public.profiles (id) on delete cascade,

  -- The zone centre. PostGIS geography(Point,4326) — never bare lat/lng floats,
  -- because this column IS queried spatially (ST_DWithin against a post's
  -- last_seen_location in the notify-spotters fan-out).
  -- SAFETY: when `approximate` is true this point was snapped to the 0.01°
  -- (~1km) grid by upsert_my_alert_zone BEFORE it was stored, so the row holds
  -- a grid cell, not an address. See section 3.
  point       geography(Point,4326) not null,

  -- Alert radius in METRES. 1609..80467 = 1..50 miles, the range DOMAIN.md
  -- fixes for both this and the Explore feed radius (the feed RPCs clamp to the
  -- identical bounds; the client mirror is shared/lib/distance.ts). Integer
  -- metres, so there is one authoritative stored form and no float drift.
  radius_m    int not null constraint alert_zones_radius_chk
                check (radius_m between 1609 and 80467),   -- 1..50 miles

  -- Master switch. A disabled zone is KEPT, not deleted: pausing alerts for a
  -- week must never cost someone the area they took the trouble to set.
  enabled     boolean not null default true,

  -- Whether the stored point was coarsened before insert. Defaults TRUE — the
  -- privacy-preserving setting is the one you get by not choosing. This is a
  -- record of what was DONE to the point, not an instruction to be applied at
  -- read time: the coarsening already happened (section 3).
  approximate boolean not null default true,

  -- Optional user-written label ("Home", "Near work"). Bounded so a client
  -- cannot pad an unbounded blob in. SAFETY: user free text about a location —
  -- it is returned ONLY to its own author (get_my_alert_zone) and must never
  -- reach a log line or another user's payload, the same rule collections'
  -- names and vehicles.nickname carry. (CHECK passes on NULL by SQL semantics.)
  label       text constraint alert_zones_label_len_chk check (char_length(label) <= 80),

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.alert_zones is
  'A spotter''s alert zone: centre point + radius (1–50 miles) + master switch. One row per user in v1, enforced by alert_zones_one_per_user_uidx — dropping that index alone is the whole v2 multi-zone migration. Written ONLY by upsert_my_alert_zone / set_my_alert_zone_enabled (SECURITY DEFINER) or the service role: clients hold NO insert/update/delete grant, because the approximate-mode snap must be a server guarantee. Read by its owner via RLS / get_my_alert_zone, and by the notify-spotters Edge Function (service role) for the ST_DWithin fan-out. Deliberately NOT columns on profiles — see the migration header.';
comment on column public.alert_zones.point is
  'geography(Point,4326) zone centre, GiST-indexed for ST_DWithin. SAFETY: when approximate is true this is already ST_SnapToGrid''d to 0.01° (~1km) — the coarsening happens BEFORE storage in upsert_my_alert_zone, so the database never holds the user''s exact home point.';
comment on column public.alert_zones.radius_m is
  'Alert radius in whole metres; 1609..80467 = 1..50 miles (DOMAIN.md). Same bounds the feed RPCs clamp to and shared/lib/distance.ts mirrors.';
comment on column public.alert_zones.enabled is
  'Master switch. False = keep the zone, send nothing. Toggled without coordinates via set_my_alert_zone_enabled, so pausing never round-trips a location.';
comment on column public.alert_zones.approximate is
  'True when the stored point was grid-snapped before insert (the default). A RECORD of what was done to the point, not a read-time instruction — nothing re-coarsens on read, because there is nothing left to coarsen.';
comment on column public.alert_zones.label is
  'Optional user-written zone label, <= 80 chars. Owner-only free text: never logged, never in another user''s payload (same rule as watchlist collection names / vehicles.nickname).';

-- ONE ZONE PER USER (v1). SAFETY / FORWARD NOTE: this index carries two jobs —
-- it is the product rule, AND it is the arbiter that upsert_my_alert_zone's
-- `on conflict (user_id)` infers. The v2 multi-zone migration that drops it must
-- therefore also re-issue that function with an explicit update-else-insert (or
-- a zone-id parameter); everything else — the table, the GiST index, the RLS
-- policy and the ST_DWithin matching query — carries over untouched.
create unique index alert_zones_one_per_user_uidx on public.alert_zones (user_id);

-- The fan-out: "every zone whose circle contains this post's last-seen point",
-- i.e. ST_DWithin(z.point, p.last_seen_location, z.radius_m). This is the hot
-- path for the whole notification feature and the reason the centre is a
-- geography column rather than two floats.
create index alert_zones_point_gix on public.alert_zones using gist (point);

-- House pattern (payments_foundation): updated_at is trigger-maintained so the
-- client can never spoof it. BEFORE UPDATE only — the column's default covers
-- the insert.
create trigger alert_zones_set_updated_at
  before update on public.alert_zones
  for each row execute function public.set_updated_at();

alter table public.alert_zones enable row level security;

-- SAFETY: under this project's config (auto_expose_new_tables unset) a new table
-- auto-grants NO data privileges, so the policy below would be dead code
-- without an explicit grant. authenticated gets SELECT ONLY.
--
-- NO client insert/update/delete grant, DELIBERATELY — and this is the load-
-- bearing decision of the whole migration. The "use approximate area only"
-- toggle promises that the database never holds the user's exact point. If a
-- client could write this table directly, that promise would be enforced by the
-- app doing the snap before it sends — i.e. by a promise, not a guarantee: any
-- other client, an old build, a replayed request, or a curl with the anon key
-- and a valid JWT would store an exact home address, and the row would still be
-- flagged approximate = true. Routing every write through
-- upsert_my_alert_zone (SECURITY DEFINER) makes the coarsening a property of
-- the SERVER. There is no deletion path either: disabling is the supported
-- "stop alerting me", and it keeps the area (see the enabled column comment).
--
-- anon gets NOTHING: a zone needs an owner. service_role bypasses RLS but is
-- not auto-granted, so give it full DML — the notify-spotters Edge Function
-- reads every candidate zone through it, and account-erasure tooling deletes.
grant select on public.alert_zones to authenticated;
grant select, insert, update, delete on public.alert_zones to service_role;

-- SAFETY: a user may read ONLY their own zone. No other surface exists: nobody
-- can enumerate where other people have set alerts (that is a home-location
-- oracle over the entire user base, and the single worst row in this schema to
-- leak). Not even a post owner sees which spotters cover their area.
create policy alert_zones_select_own
  on public.alert_zones
  for select
  to authenticated
  using (user_id = (select auth.uid()));

-- No insert/update/delete policy (and no such grant above): every write path is
-- an RPC below.


-- =============================================================================
-- 2. RPC: get_my_alert_zone() -> jsonb
-- =============================================================================
-- Returns the CALLER's own zone, or { "found": false } when they have none yet.
--
-- PAYLOAD SHAPE (mirrored by AlertZone in src/features/notifications/types.ts,
-- and returned IDENTICALLY by upsert_my_alert_zone and
-- set_my_alert_zone_enabled — the three must not drift):
--   { found, lat, lng, radius_m, enabled, approximate, label, updated_at }
--
-- SAFETY: SECURITY DEFINER bypasses RLS, so `user_id = v_uid` below is the ONLY
-- thing keeping one user's home-ish point out of another's hands. It is not
-- backstopped by the policy in section 1. Never widen it, and never add a
-- user-id parameter.
--
-- ST_Y = latitude, ST_X = longitude (house idiom; note this is the reverse of
-- ST_MakePoint's argument order — see section 3).
create or replace function public.get_my_alert_zone()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_uid  uuid := auth.uid();
  v_zone public.alert_zones%rowtype;
begin
  -- SAFETY: no caller identity -> nothing. Never fall through to "any row".
  -- A guest legitimately has no zone, so this is { found: false }, not an
  -- exception: the settings screen renders the same empty state either way and
  -- anon holds no EXECUTE anyway (section 5).
  if v_uid is null then
    return jsonb_build_object('found', false);
  end if;

  select * into v_zone
  from public.alert_zones z
  where z.user_id = v_uid;

  if not found then
    return jsonb_build_object('found', false);
  end if;

  return jsonb_build_object(
    'found',       true,
    -- The STORED centre: already grid-snapped when approximate is true. The
    -- client pins the map here, which is the honest thing to show.
    'lat',         ST_Y(v_zone.point::geometry),
    'lng',         ST_X(v_zone.point::geometry),
    'radius_m',    v_zone.radius_m,
    'enabled',     v_zone.enabled,
    'approximate', v_zone.approximate,
    'label',       v_zone.label,
    'updated_at',  v_zone.updated_at
  );
end;
$$;

comment on function public.get_my_alert_zone() is
  'The CALLER''s own alert zone as { found, lat, lng, radius_m, enabled, approximate, label, updated_at }, or { found: false } when none exists (guests included). SECURITY DEFINER (bypasses RLS): user_id = auth.uid() is the ONLY ownership gate — there is no user-id parameter and never should be. lat/lng are the STORED centre, i.e. already coarsened to the ~1km grid when approximate is true.';


-- =============================================================================
-- 3. RPC: upsert_my_alert_zone(...) -> jsonb   (the SINGLE write path)
-- =============================================================================
-- Creates or replaces the caller's zone and returns the STORED zone.
--
-- SAFETY (Tier 1 — read before editing anything below):
--   * SECURITY DEFINER: bypasses RLS/grants so this one trusted path can write
--     a table no client may write (section 1), while PINNING user_id to the
--     caller. There is no user-id parameter; a caller can never set someone
--     else's alert zone (which would redirect their pushes and, worse, plant a
--     location on their account).
--   * auth.uid() reads the CALLER's JWT claim (a request GUC), not the definer
--     role, so it identifies the caller correctly under SECURITY DEFINER.
--   * Every bound below is a SERVER re-check; client-side validation is
--     untrusted. Raises carry machine tokens the client maps:
--     NOT_AUTHENTICATED / INVALID_INPUT.
--
-- Raises: NOT_AUTHENTICATED (guest), INVALID_INPUT (lat outside -90..90, lng
-- outside -180..180, radius_m outside 1609..80467, or a label over 80 chars).
create or replace function public.upsert_my_alert_zone(
  p_lat         double precision,
  p_lng         double precision,
  p_radius_m    int,
  p_enabled     boolean,
  p_approximate boolean,
  p_label       text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid         uuid := auth.uid();
  -- Normalised ONCE, then used everywhere: validating one value and storing
  -- another is how bounds get bypassed (register_push_token does the same).
  -- NULL booleans fall back to the PRIVACY-PRESERVING side rather than
  -- erroring: a missing approximate flag must never mean "store it exactly".
  v_enabled     boolean := coalesce(p_enabled, true);
  v_approximate boolean := coalesce(p_approximate, true);
  v_label       text    := nullif(btrim(coalesce(p_label, '')), '');
  v_point       geography(Point,4326);
  v_zone        public.alert_zones%rowtype;
begin
  -- SAFETY: a zone needs an owner (the grant in section 5 already excludes
  -- anon; this is the belt-and-braces backstop).
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  -- --- INVALID_INPUT: coordinates, radius, label ------------------------------
  -- Coordinates must exist and be on the planet. A NULL here cannot build a
  -- point, so it is an input error rather than an implicit "clear my zone"
  -- (clearing is not a supported operation — disabling is).
  if p_lat is null or p_lng is null
     or p_lat < -90 or p_lat > 90
     or p_lng < -180 or p_lng > 180 then
    raise exception 'INVALID_INPUT: lat/lng out of range';
  end if;

  -- Same bounds as alert_zones_radius_chk, re-checked here so the client gets a
  -- clean mappable token instead of a raw constraint violation. Deliberately
  -- NOT clamped (unlike the anon-reachable feed RPCs): this is a deliberate
  -- setting the user chose, so an out-of-range value is a client bug worth
  -- surfacing, not something to silently round.
  if p_radius_m is null or p_radius_m < 1609 or p_radius_m > 80467 then
    raise exception 'INVALID_INPUT: radius_m out of range';
  end if;

  -- Same bound as alert_zones_label_len_chk, measured AFTER trimming (the value
  -- that will actually be stored).
  if v_label is not null and char_length(v_label) > 80 then
    raise exception 'INVALID_INPUT: label too long';
  end if;

  -- --- The point --------------------------------------------------------------
  -- SAFETY: with `approximate` on, the point is coarsened to the ~1km grid
  -- BEFORE storage, so the database never holds the user's home address. Same
  -- ST_SnapToGrid idiom get_post_detail uses for driveway thefts.
  -- NOTE: ST_MakePoint takes LONGITUDE FIRST (x, y). Getting this backwards
  -- silently stores a point in the wrong hemisphere and the fan-out matches
  -- nobody.
  -- The predicate is v_approximate (the NORMALISED flag), never the raw
  -- p_approximate: a NULL parameter is falsy in a CASE, so branching on the raw
  -- value would store the EXACT point while writing approximate = true on the
  -- row — a silently broken privacy promise, which is the worst kind. Validate
  -- one value and store another and this is exactly how it goes wrong.
  v_point := case when v_approximate
    then ST_SnapToGrid(ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326), 0.01)::geography
    else ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography
  end;

  -- --- Upsert -----------------------------------------------------------------
  -- One zone per user (v1): the conflict target is alert_zones_one_per_user_uidx
  -- (see its forward note in section 1). user_id is pinned to the caller, so the
  -- conflicting row can only ever be the caller's own. updated_at is set
  -- explicitly as well as by the trigger, so the RETURNING below reflects this
  -- write on the insert branch too.
  insert into public.alert_zones (user_id, point, radius_m, enabled, approximate, label)
  values (v_uid, v_point, p_radius_m, v_enabled, v_approximate, v_label)
  on conflict (user_id) do update
    set point       = excluded.point,
        radius_m    = excluded.radius_m,
        enabled     = excluded.enabled,
        approximate = excluded.approximate,
        label       = excluded.label,
        updated_at  = now()
  returning * into v_zone;

  -- SAFETY / PRODUCT: returns the STORED point, NOT the submitted one — so when
  -- approximate is on, the client's map pin visibly MOVES to the grid cell that
  -- was actually saved. This is deliberate and must not be "fixed" by echoing
  -- the input back: showing someone where their zone really is beats claiming a
  -- privacy they don't have. Identical shape to get_my_alert_zone's found
  -- branch (section 2) — keep the three payloads in step.
  return jsonb_build_object(
    'found',       true,
    'lat',         ST_Y(v_zone.point::geometry),
    'lng',         ST_X(v_zone.point::geometry),
    'radius_m',    v_zone.radius_m,
    'enabled',     v_zone.enabled,
    'approximate', v_zone.approximate,
    'label',       v_zone.label,
    'updated_at',  v_zone.updated_at
  );
end;
$$;

comment on function public.upsert_my_alert_zone(double precision, double precision, int, boolean, boolean, text) is
  'The ONLY client write path into alert_zones (no client INSERT/UPDATE/DELETE grant exists). SECURITY DEFINER; user_id is pinned to auth.uid() and is not a parameter, so a zone can never be set on another user''s behalf. SAFETY: when p_approximate is true (also the fallback for NULL) the centre is ST_SnapToGrid''d to 0.01° (~1km) BEFORE storage — the coarsening is a server guarantee, not a client promise. Upserts on alert_zones_one_per_user_uidx. RETURNS THE STORED ZONE, not the submitted coordinates, so the client pin moves to what was really saved: { found:true, lat, lng, radius_m, enabled, approximate, label, updated_at }. Raises NOT_AUTHENTICATED (guest) and INVALID_INPUT (lat/lng off-planet or null, radius_m outside 1609..80467, label over 80 chars).';


-- =============================================================================
-- 4. RPC: set_my_alert_zone_enabled(p_enabled) -> jsonb   (the master switch)
-- =============================================================================
-- Turns the caller's alerts on or off WITHOUT touching the zone geometry.
--
-- WHY IT IS ITS OWN FUNCTION rather than "call upsert with the same coords":
-- pausing alerts must not require the client to hold, re-send, and re-store a
-- location. A toggle that round-trips coordinates is a toggle that can corrupt
-- them (a stale draft, a rounded float, a race with an edit in another tab) and
-- one that needlessly moves a home-ish point across the wire. It also keeps the
-- "disabled is not deleted" rule honest: there is a first-class way to stop
-- alerts that provably cannot lose the area.
--
-- Returns the same payload shape as get_my_alert_zone: the updated zone, or
-- { "found": false } when the caller has no zone yet (toggling nothing is a
-- no-op, not an error — the settings screen shows the empty state either way).
--
-- SAFETY: SECURITY DEFINER; the `user_id = v_uid` predicate is the only gate,
-- and there is no user-id parameter — nobody can silence another user's alerts.
create or replace function public.set_my_alert_zone_enabled(
  p_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid  uuid := auth.uid();
  v_zone public.alert_zones%rowtype;
begin
  -- SAFETY: backstop; the grant below already excludes anon.
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  -- enabled is NOT NULL on the table; reject a null explicitly so the client
  -- gets a mappable token rather than a raw constraint violation.
  if p_enabled is null then
    raise exception 'INVALID_INPUT: enabled is required';
  end if;

  update public.alert_zones z
  set enabled = p_enabled
  where z.user_id = v_uid          -- SAFETY: caller's own row ONLY
  returning z.* into v_zone;

  -- No zone yet: nothing to toggle. Same { found: false } the read path returns.
  if not found then
    return jsonb_build_object('found', false);
  end if;

  -- Identical shape to sections 2 and 3 — keep the three payloads in step.
  -- updated_at comes from the alert_zones_set_updated_at trigger.
  return jsonb_build_object(
    'found',       true,
    'lat',         ST_Y(v_zone.point::geometry),
    'lng',         ST_X(v_zone.point::geometry),
    'radius_m',    v_zone.radius_m,
    'enabled',     v_zone.enabled,
    'approximate', v_zone.approximate,
    'label',       v_zone.label,
    'updated_at',  v_zone.updated_at
  );
end;
$$;

comment on function public.set_my_alert_zone_enabled(boolean) is
  'Master switch for the caller''s alert zone: flips enabled without touching the geometry, so pausing never round-trips (or risks corrupting) a location and can never lose the area — "disabled is not deleted". SECURITY DEFINER; user_id = auth.uid() is the only gate and is not a parameter. Returns the updated zone in the same shape as get_my_alert_zone, or { found: false } when no zone exists yet (a no-op, not an error). Raises NOT_AUTHENTICATED (guest) and INVALID_INPUT (null p_enabled).';


-- =============================================================================
-- 5. FUNCTION GRANTS
-- =============================================================================
-- SAFETY: functions default to EXECUTE granted to PUBLIC, and this project ALSO
-- ships ALTER DEFAULT PRIVILEGES granting EXECUTE to anon (see
-- 20260713190000_post_a_car.sql), so revoking PUBLIC alone is NOT enough — anon
-- must be named explicitly on every one of these. An alert zone belongs to an
-- account: a guest has nothing to read, set, or toggle here.

revoke execute on function public.get_my_alert_zone() from public, anon;
grant  execute on function public.get_my_alert_zone() to authenticated, service_role;

revoke execute on function public.upsert_my_alert_zone(double precision, double precision, int, boolean, boolean, text)
  from public, anon;
grant  execute on function public.upsert_my_alert_zone(double precision, double precision, int, boolean, boolean, text)
  to authenticated, service_role;

revoke execute on function public.set_my_alert_zone_enabled(boolean) from public, anon;
grant  execute on function public.set_my_alert_zone_enabled(boolean) to authenticated, service_role;


-- =============================================================================
-- END OF MIGRATION
-- =============================================================================

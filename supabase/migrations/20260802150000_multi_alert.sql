-- =============================================================================
-- WHAT:  MULTI-ALERT v2. Turns the single alert ZONE shipped in 20260802120000
--        into up to FIVE named, filtered alerts per user, on the SAME
--        public.alert_zones table:
--          * label -> name, backfilled and made NOT NULL (an alert you can have
--            five of needs a name, not an optional label),
--          * six new NULLABLE criteria columns — make / model / colour /
--            body_type / min_bounty_pence / recency_days, where NULL means
--            "any" — so an alert can say "silver BMWs near me with a bounty
--            over £250, seen in the last 3 days" instead of "anything near me",
--          * the one-zone-per-user UNIQUE index is dropped and REPLACED by a
--            plain btree on (user_id) — see the SAFETY note in section 4,
--          * the three v1 RPCs (get_my_alert_zone / upsert_my_alert_zone /
--            set_my_alert_zone_enabled) are DROPPED and replaced by five
--            id-scoped ones: list_my_alerts, create_my_alert, update_my_alert,
--            delete_my_alert, set_my_alert_enabled.
-- WHY:   DOMAIN.md "Notifications" fixes the volume cap at 3 alert pushes per
--        user per rolling 24 hours, and calls alert fatigue "the asymmetric
--        risk". With ONE unfiltered zone the only controls a spotter has are
--        "smaller radius" or "off" — so a user who genuinely wants to help but
--        only recognises, say, vans, has to choose between noise and silence.
--        Named + filtered alerts let them spend those three daily slots on the
--        pushes they will actually act on, which raises the value of every one
--        of them. Five is the same cap idiom (and the same number) as the
--        garage's VEHICLE_LIMIT_REACHED: enough for a real person, small
--        enough to bound an abuse loop and to keep the per-post matching join
--        trivially cheap.
--
--        WHY THE TABLE KEEPS THE NAME alert_zones (deliberate, not inertia):
--        a location is still MANDATORY — every row is still a point + radius,
--        so it is still a zone, just a zone with criteria attached. Renaming it
--        to "alerts" would move two already-deployed function bodies
--        (claim_post_alerts is untouched, but match_alert_zones and the
--        notify-spotters Edge Function both name this table), a 30-check
--        verification suite and every column comment in the file — for no
--        functional gain and a real chance of a mid-apply failure. The v1
--        header predicted the multi-zone migration would be "dropping that
--        index alone"; that prediction was WRONG (section 4) and the table
--        comment is corrected below, but the table itself carries over fine.
-- LINKS: docs/DOMAIN.md (Notifications — 1–50 mile radius, the ~1km coarsening,
--          3 pushes per user per rolling 24h, alert fatigue as the asymmetric
--          risk; "One zone per user in v1" is what this migration supersedes),
--        docs/SECURITY_AND_TRUST.md §1 (data minimisation), §2 (anti-stalking;
--          the ~1km snap is a SERVER guarantee, which is why alert_zones still
--          has no client write grant), §3 (personal data cascades on erasure),
--          §6 (RLS deny-by-default; SECURITY DEFINER hardening),
--        supabase/migrations/20260802120000_alert_zones.sql (the table, its RLS
--          posture and the three RPCs this migration replaces),
--        supabase/migrations/20260802130000_alert_matching.sql
--          (match_alert_zones — reads this table; the criteria predicates are
--          added to it in 20260802160000, NOT here),
--        supabase/migrations/20260801100000_garage_vehicles.sql
--          (VEHICLE_LIMIT_REACHED — the count-then-raise cap idiom copied here
--          as ALERT_LIMIT_REACHED, and the opaque *_NOT_FOUND pattern),
--        supabase/migrations/20260714100000_sightings.sql (create_sighting: the
--          pg_advisory_xact_lock that makes a count-then-insert cap race-proof),
--        supabase/migrations/20260707110712_payments_foundation.sql
--          (posts.bounty_amount_pence CHECK 5000..500000 — mirrored by
--          alert_zones_min_bounty_chk so an alert can never filter for a bounty
--          no post may carry),
--        src/features/notifications/types.ts + api/alertZoneApi.ts (the client
--          mirror — SEE THE BREAKING-CHANGE NOTE below),
--        supabase/tests/alerts_verification.sql (asserts the three dropped
--          signatures exist — SEE THE BREAKING-CHANGE NOTE below).
--
-- SAFETY NOTE ON DESTRUCTIVE STATEMENTS: THIS MIGRATION IS DESTRUCTIVE. Four
--        destructive statements, all deliberate, none of which destroys a ROW:
--          1. `alter table ... rename column label to name` (section 1). A
--             RENAME, not a drop: every existing value is preserved. NULL labels
--             are backfilled to 'My alert area' before the NOT NULL is applied,
--             so no row can fail the constraint. The CHECK constraint is renamed
--             to match (its expression follows the column automatically).
--          2. `drop function` x3 (section 3) — get_my_alert_zone(),
--             upsert_my_alert_zone(double precision, double precision, int,
--             boolean, boolean, text) and set_my_alert_zone_enabled(boolean).
--             NON-DATA-DESTRUCTIVE. They MUST go in this migration and not
--             later: upsert_my_alert_zone's `on conflict (user_id)` infers the
--             unique index dropped in section 4, so leaving it alive would leave
--             a function that raises 42P10 on every call.
--          3. `drop index alert_zones_one_per_user_uidx` (section 4).
--             NON-DATA-DESTRUCTIVE (an index, not a table), and IMMEDIATELY
--             replaced by a plain btree on the same column — read the SAFETY
--             block there before touching it.
--        No table, column or row is dropped or truncated. All six new columns
--        are nullable with no default, so the ALTER is a catalog-only change.
--
-- BREAKING CHANGE (out of scope for this file, but it WILL break on deploy):
--        the three dropped RPCs are still called by
--        src/features/notifications/api/alertZoneApi.ts (+ its test) and are
--        asserted to exist by supabase/tests/alerts_verification.sql (its
--        signature-inventory check near the end). Both must be migrated to the
--        five RPCs below IN THE SAME CHANGE as this migration ships. The
--        notify-spotters Edge Function is NOT affected — it calls
--        claim_post_alerts / match_alert_zones, whose signatures are unchanged.
--
-- ORDERING: 20260802150000 sorts strictly after 20260802140000. It depends on
--        20260802120000 (the table and the three functions it drops). Do not
--        re-stamp it earlier.
-- =============================================================================


-- =============================================================================
-- 1. COLUMN: label -> name   (RENAME + backfill + NOT NULL)
-- =============================================================================
-- v1's `label` was an OPTIONAL nicety on a single zone — with exactly one row
-- there was nothing to tell apart. With up to five, the name IS the
-- disambiguator: it is what the settings list renders, what a "pause this one"
-- toggle points at, and the only way a user can tell "Home" from "Mum's street".
-- An unnamed alert in a list of five is an unusable row, so the column becomes
-- required.
--
-- SAFETY (destructive): RENAME preserves every stored value — this is not a
-- drop-and-add, and no user loses the label they typed.
alter table public.alert_zones rename column label to name;

-- Backfill BEFORE the NOT NULL: v1 rows created without a label hold NULL and
-- would fail the constraint. 'My alert area' is deliberately generic and
-- non-identifying — it must not invent a location, because the user did not
-- name one and this string is shown back to them as if they had.
update public.alert_zones set name = 'My alert area' where name is null;

alter table public.alert_zones alter column name set not null;

-- The CHECK is unchanged (<= 80 chars) — only its NAME is stale, because it was
-- named after the old column. Postgres rewrites the constraint's EXPRESSION to
-- follow the rename automatically; the identifier is ours to keep in step, and
-- a constraint called *_label_len_chk on a column called `name` is exactly the
-- kind of drift that makes the next person doubt which one is authoritative.
alter table public.alert_zones
  rename constraint alert_zones_label_len_chk to alert_zones_name_len_chk;

-- NOTE (known, deliberate gap): the CHECK bounds LENGTH only, so a whitespace-
-- only name would satisfy both NOT NULL and <= 80. Non-blankness is enforced in
-- create_my_alert / update_my_alert (INVALID_INPUT, measured AFTER btrim), which
-- are the ONLY write paths — clients hold no DML grant on this table
-- (20260802120000 section 1: authenticated is granted SELECT and nothing else).
-- Tightening the CHECK to char_length(btrim(name)) >= 1 would need a validating
-- table scan and buys nothing while that stays true.


-- =============================================================================
-- 2. COLUMNS: the alert criteria   (ALL NULLABLE — NULL means "any")
-- =============================================================================
-- Every one of these is a NARROWING filter on top of the geography that already
-- exists. NULL is the neutral element in all six: a row with all of them NULL is
-- byte-for-byte the v1 behaviour ("anything active inside my circle"), which is
-- why this ALTER needs no backfill and why every existing zone keeps working
-- unchanged the moment 20260802160000 teaches the matcher to read them.
--
-- SAFETY: they are USER-AUTHORED free text about the cars a person is watching
-- for. Bounded at 40 chars each so a client cannot pad an unbounded blob into a
-- table the fan-out joins against, and returned ONLY to their own author
-- (list_my_alerts). Like `name` they must never reach a log line or another
-- user's payload. (Every CHECK below passes on NULL by SQL semantics.)
alter table public.alert_zones
  add column make      text constraint alert_zones_make_len_chk      check (char_length(make)      <= 40),
  add column model     text constraint alert_zones_model_len_chk     check (char_length(model)     <= 40),
  add column colour    text constraint alert_zones_colour_len_chk    check (char_length(colour)    <= 40),
  add column body_type text constraint alert_zones_body_type_len_chk check (char_length(body_type) <= 40),

  -- MONEY: integer pence, GBP implied — never numeric/float, the same rule
  -- posts.bounty_amount_pence follows. The bounds are IDENTICAL to that column's
  -- own CHECK (5000..500000 = £50..£5000, the DOMAIN.md fraud ceiling),
  -- deliberately: a filter for a bounty outside the range any post may carry is
  -- not a strict filter, it is a silently dead alert.
  add column min_bounty_pence int constraint alert_zones_min_bounty_chk
    check (min_bounty_pence between 5000 and 500000),

  -- "Only tell me about cars seen in the last N days." Strictly positive: 0 days
  -- is a window that nothing can ever fall inside, i.e. another silently dead
  -- alert, and a negative value is meaningless.
  add column recency_days int constraint alert_zones_recency_days_chk
    check (recency_days > 0);

comment on column public.alert_zones.make is
  'Optional make filter, <= 40 chars. NULL = ANY make (the neutral element — a row with every criterion NULL reproduces v1 behaviour exactly). Compared case-insensitively and trimmed by match_alert_zones because posts.make is unnormalised free text. Owner-only free text: never logged, never in another user''s payload.';
comment on column public.alert_zones.model is
  'Optional model filter, <= 40 chars. NULL = ANY model. Case-insensitive, trimmed comparison (see make).';
comment on column public.alert_zones.colour is
  'Optional colour filter, <= 40 chars. NULL = ANY colour. Case-insensitive, trimmed comparison (see make).';
comment on column public.alert_zones.body_type is
  'Optional body-style filter e.g. Hatchback/SUV/Van, <= 40 chars. NULL = ANY body type. Case-insensitive, trimmed comparison (see make). Mirrors posts.body_type / vehicles.body_type.';
comment on column public.alert_zones.min_bounty_pence is
  'MONEY: optional minimum bounty in integer pence, GBP implied. NULL = ANY bounty. CHECK 5000..500000 is byte-for-byte posts.bounty_amount_pence''s range (£50–£5000, the DOMAIN.md fraud ceiling) so this filter can never be set to a value no post could satisfy. Never numeric/float.';
comment on column public.alert_zones.recency_days is
  'Optional recency window in whole days: only match posts whose last_seen_at is within N days. NULL = ANY age. CHECK > 0 (a zero/negative window would match nothing and read as a broken alert, not a strict one). A post with a NULL last_seen_at never satisfies this filter — same semantics as search_posts'' recency_days criterion.';


-- =============================================================================
-- 3. DROP the three v1 RPCs   -- DESTRUCTIVE (non-data)
-- =============================================================================
-- All three encode "one zone per user" in their shape and cannot be salvaged:
--   * get_my_alert_zone() returns ONE object with a { found: false } branch —
--     with five rows there is no "the" zone to return.
--   * upsert_my_alert_zone(...) is an upsert on `on conflict (user_id)`, whose
--     arbiter is the unique index dropped in section 4. It MUST die in the same
--     migration as that index or it becomes a function that raises 42P10 on
--     every call — a working button that fails 100% of the time.
--   * set_my_alert_zone_enabled(boolean) is the sharpest of the three: its
--     UPDATE is qualified ONLY by user_id, so with five rows one tap would flip
--     EVERY alert the user owns. Replaced by the per-alert
--     set_my_alert_enabled(uuid, boolean) in section 10.
--
-- Signatures are spelled out in full and must match 20260802120000 EXACTLY —
-- drop-by-signature is unforgiving (a mismatch is a 42883 mid-apply, which
-- blocks every later migration; see supabase/tests/migrationChain.test.ts and
-- the 2026-07-29 outage it guards). IF EXISTS so a re-run is idempotent.
drop function if exists public.get_my_alert_zone();
drop function if exists public.upsert_my_alert_zone(double precision, double precision, int, boolean, boolean, text);
drop function if exists public.set_my_alert_zone_enabled(boolean);


-- =============================================================================
-- 4. INDEXES   -- READ THE SAFETY BLOCK BEFORE EDITING
-- =============================================================================
-- The v1 header claimed "dropping alert_zones_one_per_user_uidx alone IS the
-- entire v2 migration". THAT WAS WRONG, and this is the correction.
--
-- SAFETY (the whole reason section 4 exists): that unique index was carrying
-- TWO jobs, and only one of them was the product rule. It was ALSO THE ONLY
-- INDEX ON user_id — a unique btree is still a btree, and the planner was using
-- it for every equality lookup on this table:
--   * alert_zones_select_own (the RLS policy: user_id = auth.uid()),
--   * the caller's own list read (list_my_alerts, section 6),
--   * the cap count in create_my_alert (section 7),
--   * the ownership scoping in sections 8, 9 and 10.
-- Dropping it on its own removes the product rule AND silently downgrades all
-- six of those to a sequential scan — a change that passes every test, looks
-- like a one-line diff, and only shows up as latency later. The replacement
-- btree goes in immediately below, in the same migration, for exactly that
-- reason. Never drop one without the other.
drop index if exists public.alert_zones_one_per_user_uidx;

-- The non-unique replacement. Same column, same lookups, no uniqueness — which
-- is precisely the v1->v2 delta stated as an index.
create index alert_zones_user_idx on public.alert_zones (user_id);

-- alert_zones_point_gix (the GiST index on `point`) is KEPT, untouched. It is
-- the fan-out's driver: ST_DWithin(z.point, post.last_seen_location, z.radius_m).
--
-- DELIBERATELY NO INDEXES ON THE CRITERIA COLUMNS (make/model/colour/body_type/
-- min_bounty_pence/recency_days). Two independent reasons, either sufficient:
--   1. The GiST spatial predicate narrows FIRST — matching starts from "zones
--      whose circle contains this point", which is already a small set. The
--      criteria are cheap RESIDUAL filters on top of it, exactly the way
--      search_posts treats make/model/colour inside a bbox (20260725100000).
--   2. There are at most FIVE rows per user (the cap in section 7), so even a
--      pathological per-user scan reads five rows.
-- An index here would be paid on every alert write to save nothing measurable.
-- This mirrors the pg_trgm note in 20260725100000: index when EXPLAIN on
-- production-scale data says to, not speculatively.


-- =============================================================================
-- 5. TABLE + COLUMN COMMENTS  (correcting the v1 text)
-- =============================================================================
-- The v1 table comment named functions that no longer exist and asserted the
-- "drop one index" claim section 4 just disproved. Comments that describe a
-- schema which is no longer there are worse than no comments: they are read as
-- authoritative.
comment on table public.alert_zones is
  'A spotter''s alert: a mandatory centre point + radius (1–50 miles), a name, an on/off switch, and six OPTIONAL narrowing criteria (make, model, colour, body_type, min_bounty_pence, recency_days — NULL means "any"). UP TO FIVE PER USER (v2), enforced by create_my_alert''s count-then-raise cap under an advisory lock, NOT by a unique index. Written ONLY by create_my_alert / update_my_alert / delete_my_alert / set_my_alert_enabled (SECURITY DEFINER) or the service role: clients hold NO insert/update/delete grant, because the approximate-mode ~1km snap must be a server guarantee, not a client promise. Read by its owner via RLS / list_my_alerts, and by the notify-spotters Edge Function (service role) for the ST_DWithin fan-out. Still called alert_zones because a location is still mandatory — every row is still a zone, now with criteria. Deliberately NOT columns on profiles — see 20260802120000''s header. HISTORICAL CORRECTION: v1 claimed the multi-zone migration was "dropping alert_zones_one_per_user_uidx alone"; it was not — that index was also the only btree on user_id, and 20260802150000 had to add alert_zones_user_idx to replace the lookup path for the RLS policy, the list read, the cap count and the matching join.';

comment on column public.alert_zones.name is
  'REQUIRED user-written alert name ("Home", "Near work", "Vans only"), <= 80 chars, stored btrim''d. With up to five alerts per user this is the disambiguator the settings list renders and the per-alert toggle points at — it is not the optional v1 `label` under a new name. Non-blankness is enforced by create_my_alert / update_my_alert, not by the CHECK. Owner-only free text: never logged, never in another user''s payload (same rule as watchlist collection names / vehicles.nickname).';

comment on column public.alert_zones.point is
  'geography(Point,4326) alert centre, GiST-indexed for ST_DWithin. STILL MANDATORY in v2 — an alert is always a place first, and the criteria only narrow it. SAFETY: when approximate is true this is already ST_SnapToGrid''d to 0.01° (~1km) — the coarsening happens BEFORE storage in create_my_alert / update_my_alert, so the database never holds the user''s exact home point.';

comment on column public.alert_zones.enabled is
  'Per-alert switch. False = keep this alert, send nothing for it. Toggled without coordinates via set_my_alert_enabled(alert_id, enabled), so pausing never round-trips a location. NOTE: v1''s set_my_alert_zone_enabled(boolean) flipped EVERY row a user owned (its UPDATE was qualified on user_id alone); the v2 function is scoped to one alert id.';


-- =============================================================================
-- 6. RPC: list_my_alerts() -> jsonb   (a JSON ARRAY)
-- =============================================================================
-- Returns the CALLER's alerts, oldest first (created_at), as a jsonb ARRAY.
--
-- ELEMENT SHAPE — THE CONTRACT. This exact object is built in FOUR places in
-- this file (sections 6, 7, 8 and 10) and mirrored by the client's Alert type.
-- If you add, rename or remove a key, do it in all four or the settings list
-- will disagree with the row the user just saved:
--   { id, name, lat, lng, radius_m, enabled, approximate,
--     make, model, colour, body_type, min_bounty_pence, recency_days,
--     updated_at }
--
-- WHY AN ARRAY AND NOT { alerts: [...] }: it replaces a read whose only job was
-- "give me my alerts", and list_my_vehicles / list_my_posts already return a
-- bare array. Note there is no v1-style `found` key anywhere in v2 — "none" is
-- now simply an empty array, which is a shape the client can render directly.
--
-- SAFETY (Tier 1): SECURITY DEFINER bypasses RLS, so `user_id = v_uid` below is
-- the ONLY thing keeping one user's home-ish points and watch criteria out of
-- another's hands — alert_zones_select_own does NOT backstop it. Never widen it
-- and never add a user-id parameter. No caller identity -> EMPTY ARRAY, never a
-- fall-through to "all rows" (that would dump every user's approximate home
-- location, the single worst read in this schema to leak).
--
-- A guest gets [] rather than an exception: having no alerts is not an error,
-- the settings screen renders the same empty state either way, and anon holds no
-- EXECUTE grant anyway (section 11).
--
-- ST_Y = latitude, ST_X = longitude (house idiom; the REVERSE of ST_MakePoint's
-- argument order — see section 7). STABLE: reads only.
create or replace function public.list_my_alerts()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_uid    uuid := auth.uid();
  v_result jsonb;
begin
  -- SAFETY: no caller identity -> nothing. Never fall through to "any row".
  if v_uid is null then
    return '[]'::jsonb;
  end if;

  -- `id` is the TIEBREAKER, and it is not decoration: created_at defaults to
  -- now(), which is the TRANSACTION timestamp, so alerts created in one
  -- transaction share a byte-identical value and `order by created_at` alone
  -- is non-deterministic — the settings list would silently reshuffle between
  -- reads. Ordering by (created_at, id) is total.
  select coalesce(jsonb_agg(t.item order by t.created_at, t.id), '[]'::jsonb)
    into v_result
  from (
    select
      z.created_at,
      z.id,
      jsonb_build_object(
        'id',               z.id,
        'name',             z.name,
        -- The STORED centre: already grid-snapped when approximate is true.
        -- The client pins the map here, which is the honest thing to show.
        'lat',              ST_Y(z.point::geometry),
        'lng',              ST_X(z.point::geometry),
        'radius_m',         z.radius_m,
        'enabled',          z.enabled,
        'approximate',      z.approximate,
        'make',             z.make,
        'model',            z.model,
        'colour',           z.colour,
        'body_type',        z.body_type,
        'min_bounty_pence', z.min_bounty_pence,
        'recency_days',     z.recency_days,
        'updated_at',       z.updated_at
      ) as item
    from public.alert_zones z
    where z.user_id = v_uid          -- SAFETY: caller's OWN alerts ONLY.
  ) t;

  return v_result;
end;
$$;

comment on function public.list_my_alerts() is
  'The CALLER''s alerts as a jsonb ARRAY, oldest first (created_at). Each element is { id, name, lat, lng, radius_m, enabled, approximate, make, model, colour, body_type, min_bounty_pence, recency_days, updated_at } — the SAME shape returned by create_my_alert, update_my_alert and set_my_alert_enabled; all four must be kept in step. lat/lng are the STORED centre, i.e. already coarsened to the ~1km grid when approximate is true. SECURITY DEFINER (bypasses RLS): user_id = auth.uid() is the ONLY ownership gate — there is no user-id parameter and never should be. A guest (or a user with no alerts) gets [], not an error. Replaces v1''s get_my_alert_zone(), whose single-object { found:false } shape cannot express five rows.';


-- =============================================================================
-- 7. RPC: create_my_alert(...) -> jsonb
-- =============================================================================
-- Creates ONE new alert for the caller and returns the STORED row.
--
-- SAFETY (Tier 1 — read before editing anything below):
--   * SECURITY DEFINER: bypasses RLS/grants so this one trusted path can write a
--     table no client may write, while PINNING user_id to the caller. There is
--     no user-id parameter; a caller can never create an alert on someone else's
--     account (which would both redirect pushes AND plant a location on them).
--   * auth.uid() reads the CALLER's JWT claim (a request GUC), not the definer
--     role, so it identifies the caller correctly under SECURITY DEFINER.
--   * Every bound below is a SERVER re-check; client-side validation is
--     untrusted. Raises carry machine tokens the client maps:
--     NOT_AUTHENTICATED / ALERT_LIMIT_REACHED / INVALID_INPUT.
--   * THE ~1km SNAP IS THE LOAD-BEARING PRIVACY PROPERTY OF THIS FILE. Carried
--     forward verbatim from upsert_my_alert_zone: when approximate is on the
--     point is coarsened BEFORE storage, so the database never holds the user's
--     home address. That is a property of the SERVER, which is the entire reason
--     clients still hold no DML grant on this table (SECURITY_AND_TRUST §2).
--
-- Raises: NOT_AUTHENTICATED (guest), ALERT_LIMIT_REACHED (already at five),
-- INVALID_INPUT (blank/over-80 name, lat/lng off-planet or null, radius_m
-- outside 1609..80467, any criterion text over 40 chars, min_bounty_pence
-- outside 5000..500000, recency_days <= 0).
create or replace function public.create_my_alert(
  p_name             text,
  p_lat              double precision,
  p_lng              double precision,
  p_radius_m         int,
  p_approximate      boolean,
  p_enabled          boolean,
  p_make             text,
  p_model            text,
  p_colour           text,
  p_body_type        text,
  p_min_bounty_pence int,
  p_recency_days     int
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid         uuid := auth.uid();
  -- Normalised ONCE, then used everywhere: validating one value and storing
  -- another is how bounds get bypassed. NULL booleans fall back to the
  -- PRIVACY-PRESERVING side rather than erroring — a missing approximate flag
  -- must never mean "store it exactly".
  v_approximate boolean := coalesce(p_approximate, true);
  v_enabled     boolean := coalesce(p_enabled, true);
  -- The name is REQUIRED, so it is btrim'd (not nullif'd) and checked below.
  v_name        text    := btrim(coalesce(p_name, ''));
  -- Criteria: nullif(btrim(...),'') so a BLANK box means "any", not a filter
  -- for the empty string. A client that sends '' for "no preference" (which
  -- every form on earth does) must not silently create an alert that matches
  -- nothing.
  v_make        text    := nullif(btrim(coalesce(p_make,      '')), '');
  v_model       text    := nullif(btrim(coalesce(p_model,     '')), '');
  v_colour      text    := nullif(btrim(coalesce(p_colour,    '')), '');
  v_body_type   text    := nullif(btrim(coalesce(p_body_type, '')), '');
  v_point       geography(Point,4326);
  v_alert       public.alert_zones%rowtype;
  -- The cap. Same number and same reasoning as the garage's vehicle cap: enough
  -- alerts for a real person's actual patterns, small enough to bound an
  -- automated abuse loop and to keep the fan-out's per-user work trivial.
  v_alert_cap   int     := 5;
begin
  -- SAFETY: an alert needs an owner (the grant in section 11 already excludes
  -- anon; this is the belt-and-braces backstop).
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  -- --- The cap ----------------------------------------------------------------
  -- SAFETY: the advisory lock is what makes count-then-insert actually a cap.
  -- Without it two concurrent creates both read a count of 4, both pass, and the
  -- user ends up with six alerts — there is no unique index left to catch it
  -- (section 4 dropped the only one). Keyed on the CALLER, so it serialises one
  -- user's own concurrent creates and nobody else's; it releases automatically
  -- at transaction end. Same idiom as create_sighting's rate limit.
  perform pg_advisory_xact_lock(
    hashtextextended('create_alert:' || v_uid::text, 0));

  -- Counts the CALLER's rows only, so the count can never be a signal about
  -- anyone else's alerts. Served by alert_zones_user_idx (section 4).
  if (select count(*) from public.alert_zones z where z.user_id = v_uid) >= v_alert_cap then
    raise exception 'ALERT_LIMIT_REACHED';
  end if;

  -- --- INVALID_INPUT: name ----------------------------------------------------
  -- Measured AFTER trimming — the value that will actually be stored. A
  -- whitespace-only name is blank, not a name (see the note in section 1: the
  -- CHECK bounds length only, this is where non-blankness is enforced).
  if v_name = '' then
    raise exception 'INVALID_INPUT: name is required';
  end if;
  if char_length(v_name) > 80 then
    raise exception 'INVALID_INPUT: name too long';
  end if;

  -- --- INVALID_INPUT: coordinates and radius ----------------------------------
  -- Coordinates must exist and be on the planet. A NULL cannot build a point, so
  -- it is an input error rather than an implicit "an alert with no place" —
  -- location is still mandatory in v2 (see the point column comment).
  if p_lat is null or p_lng is null
     or p_lat < -90 or p_lat > 90
     or p_lng < -180 or p_lng > 180 then
    raise exception 'INVALID_INPUT: lat/lng out of range';
  end if;

  -- Same bounds as alert_zones_radius_chk, re-checked here so the client gets a
  -- clean mappable token instead of a raw constraint violation. Deliberately NOT
  -- clamped: this is a setting the user chose, so an out-of-range value is a
  -- client bug worth surfacing, not something to silently round.
  if p_radius_m is null or p_radius_m < 1609 or p_radius_m > 80467 then
    raise exception 'INVALID_INPUT: radius_m out of range';
  end if;

  -- --- INVALID_INPUT: criteria ------------------------------------------------
  -- Same bounds as the four *_len_chk constraints in section 2, measured on the
  -- NORMALISED values (what will be stored). NULL criteria are "any" and skip
  -- every check by SQL semantics.
  if char_length(v_make) > 40 then
    raise exception 'INVALID_INPUT: make too long';
  end if;
  if char_length(v_model) > 40 then
    raise exception 'INVALID_INPUT: model too long';
  end if;
  if char_length(v_colour) > 40 then
    raise exception 'INVALID_INPUT: colour too long';
  end if;
  if char_length(v_body_type) > 40 then
    raise exception 'INVALID_INPUT: body_type too long';
  end if;

  -- MONEY: mirrors alert_zones_min_bounty_chk AND posts.bounty_amount_pence.
  -- Only checked when supplied — NULL means "any bounty".
  if p_min_bounty_pence is not null
     and (p_min_bounty_pence < 5000 or p_min_bounty_pence > 500000) then
    raise exception 'INVALID_INPUT: min_bounty_pence out of range';
  end if;

  -- Mirrors alert_zones_recency_days_chk. NULL means "any age".
  if p_recency_days is not null and p_recency_days <= 0 then
    raise exception 'INVALID_INPUT: recency_days out of range';
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
  -- row — a silently broken privacy promise, which is the worst kind.
  v_point := case when v_approximate
    then ST_SnapToGrid(ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326), 0.01)::geography
    else ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography
  end;

  -- --- Insert -----------------------------------------------------------------
  -- SAFETY: user_id is PINNED to the caller. id/created_at/updated_at take their
  -- defaults; no client-suppliable timestamps.
  insert into public.alert_zones (
    user_id, name, point, radius_m, enabled, approximate,
    make, model, colour, body_type, min_bounty_pence, recency_days
  )
  values (
    v_uid, v_name, v_point, p_radius_m, v_enabled, v_approximate,
    v_make, v_model, v_colour, v_body_type, p_min_bounty_pence, p_recency_days
  )
  returning * into v_alert;

  -- SAFETY / PRODUCT: returns the STORED point, NOT the submitted one — so when
  -- approximate is on, the client's map pin visibly MOVES to the grid cell that
  -- was actually saved. Deliberate; do not "fix" it by echoing the input back.
  -- Showing someone where their alert really is beats claiming a privacy they
  -- do not have. ELEMENT SHAPE: identical to section 6 — keep all four in step.
  return jsonb_build_object(
    'id',               v_alert.id,
    'name',             v_alert.name,
    'lat',              ST_Y(v_alert.point::geometry),
    'lng',              ST_X(v_alert.point::geometry),
    'radius_m',         v_alert.radius_m,
    'enabled',          v_alert.enabled,
    'approximate',      v_alert.approximate,
    'make',             v_alert.make,
    'model',            v_alert.model,
    'colour',           v_alert.colour,
    'body_type',        v_alert.body_type,
    'min_bounty_pence', v_alert.min_bounty_pence,
    'recency_days',     v_alert.recency_days,
    'updated_at',       v_alert.updated_at
  );
end;
$$;

comment on function public.create_my_alert(text, double precision, double precision, int, boolean, boolean, text, text, text, text, int, int) is
  'Creates ONE alert for the caller and returns the STORED row in the shared element shape { id, name, lat, lng, radius_m, enabled, approximate, make, model, colour, body_type, min_bounty_pence, recency_days, updated_at } (identical to list_my_alerts / update_my_alert / set_my_alert_enabled — keep all four in step). SECURITY DEFINER; user_id is pinned to auth.uid() and is not a parameter, so an alert can never be created on another user''s behalf. CAP: five per user, enforced by a count-then-raise (ALERT_LIMIT_REACHED) under pg_advisory_xact_lock(''create_alert:<uid>'') — the lock is REQUIRED, not decorative, because section 4 dropped the only unique index that could otherwise have caught two concurrent creates. SAFETY: when p_approximate is true (also the fallback for NULL) the centre is ST_SnapToGrid''d to 0.01° (~1km) BEFORE storage — the coarsening is a server guarantee, not a client promise, which is why clients hold no DML grant on alert_zones. Blank criteria text is normalised to NULL = "any", so an empty form field never becomes a filter that matches nothing. Returns the STORED point, not the submitted coordinates, so the client pin moves to what was really saved. Raises NOT_AUTHENTICATED (guest), ALERT_LIMIT_REACHED, and INVALID_INPUT (blank or >80 name, lat/lng off-planet or null, radius_m outside 1609..80467, any criterion text over 40 chars, min_bounty_pence outside 5000..500000, recency_days <= 0).';


-- =============================================================================
-- 8. RPC: update_my_alert(...) -> jsonb
-- =============================================================================
-- Full-replace edit of ONE alert the caller owns. Same validation and the SAME
-- ~1km snap as create_my_alert — an edit must not be a way to launder an exact
-- home point into a row that was created approximate.
--
-- SAFETY (Tier 1): SECURITY DEFINER (bypasses RLS). Scoped
--   `where id = p_alert_id and user_id = auth.uid()`, taken FOR UPDATE so two
--   concurrent edits (or an edit racing a delete) serialise on the row.
--
-- SAFETY (no existence oracle): "no such alert" and "not yours" raise the SAME
--   single opaque ALERT_NOT_FOUND. Distinguishing them would let anyone probe
--   alert ids and learn which ones exist — and an alert id maps to a person's
--   approximate home. This is the same rule VEHICLE_NOT_FOUND and
--   POST_NOT_EDITABLE follow.
--
-- NOT WRITABLE HERE, deliberately: user_id (an alert cannot be reassigned to
--   another account), id, and created_at. They are absent from the UPDATE's
--   column list.
create or replace function public.update_my_alert(
  p_alert_id         uuid,
  p_name             text,
  p_lat              double precision,
  p_lng              double precision,
  p_radius_m         int,
  p_approximate      boolean,
  p_enabled          boolean,
  p_make             text,
  p_model            text,
  p_colour           text,
  p_body_type        text,
  p_min_bounty_pence int,
  p_recency_days     int
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid         uuid := auth.uid();
  v_existing    public.alert_zones%rowtype;
  -- SAFETY: approximate falls back to TRUE on NULL — the privacy-preserving
  -- side, exactly as on create. It deliberately does NOT fall back to the row's
  -- current value: an omitted flag must never be able to turn coarsening OFF.
  v_approximate boolean := coalesce(p_approximate, true);
  -- enabled falls back to the row's CURRENT value (read below), not to true: a
  -- client that omits the flag while saving a criteria edit must not silently
  -- un-pause an alert the user deliberately muted.
  v_enabled     boolean;
  v_name        text    := btrim(coalesce(p_name, ''));
  v_make        text    := nullif(btrim(coalesce(p_make,      '')), '');
  v_model       text    := nullif(btrim(coalesce(p_model,     '')), '');
  v_colour      text    := nullif(btrim(coalesce(p_colour,    '')), '');
  v_body_type   text    := nullif(btrim(coalesce(p_body_type, '')), '');
  v_point       geography(Point,4326);
  v_alert       public.alert_zones%rowtype;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  -- SAFETY: own + locked, else ONE opaque code. Absent and not-yours are
  -- indistinguishable to the caller by design. Served by alert_zones_user_idx.
  select * into v_existing
  from public.alert_zones z
  where z.id = p_alert_id
    and z.user_id = v_uid
  for update;
  if not found then
    raise exception 'ALERT_NOT_FOUND';
  end if;

  v_enabled := coalesce(p_enabled, v_existing.enabled);

  -- --- Validation: byte-for-byte create_my_alert's (see its comments) ---------
  if v_name = '' then
    raise exception 'INVALID_INPUT: name is required';
  end if;
  if char_length(v_name) > 80 then
    raise exception 'INVALID_INPUT: name too long';
  end if;

  if p_lat is null or p_lng is null
     or p_lat < -90 or p_lat > 90
     or p_lng < -180 or p_lng > 180 then
    raise exception 'INVALID_INPUT: lat/lng out of range';
  end if;

  if p_radius_m is null or p_radius_m < 1609 or p_radius_m > 80467 then
    raise exception 'INVALID_INPUT: radius_m out of range';
  end if;

  if char_length(v_make) > 40 then
    raise exception 'INVALID_INPUT: make too long';
  end if;
  if char_length(v_model) > 40 then
    raise exception 'INVALID_INPUT: model too long';
  end if;
  if char_length(v_colour) > 40 then
    raise exception 'INVALID_INPUT: colour too long';
  end if;
  if char_length(v_body_type) > 40 then
    raise exception 'INVALID_INPUT: body_type too long';
  end if;

  if p_min_bounty_pence is not null
     and (p_min_bounty_pence < 5000 or p_min_bounty_pence > 500000) then
    raise exception 'INVALID_INPUT: min_bounty_pence out of range';
  end if;

  if p_recency_days is not null and p_recency_days <= 0 then
    raise exception 'INVALID_INPUT: recency_days out of range';
  end if;

  -- --- The point: THE SAME SNAP AS CREATE -------------------------------------
  -- SAFETY: this is not a copy-paste convenience, it is the guarantee itself. If
  -- the edit path skipped the snap, "edit your alert" would be a one-call way to
  -- put an exact home address into a table that promises it holds none — and the
  -- row would still read approximate = true. ST_MakePoint takes LONGITUDE FIRST.
  v_point := case when v_approximate
    then ST_SnapToGrid(ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326), 0.01)::geography
    else ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography
  end;

  -- --- Apply ------------------------------------------------------------------
  -- SAFETY: the column list names ONLY editable fields. user_id, id and
  -- created_at are absent and unwritable here. updated_at is maintained by the
  -- alert_zones_set_updated_at trigger.
  update public.alert_zones set
    name             = v_name,
    point            = v_point,
    radius_m         = p_radius_m,
    enabled          = v_enabled,
    approximate      = v_approximate,
    make             = v_make,
    model            = v_model,
    colour           = v_colour,
    body_type        = v_body_type,
    min_bounty_pence = p_min_bounty_pence,
    recency_days     = p_recency_days
  where id = p_alert_id
    and user_id = v_uid            -- SAFETY: re-stated; never rely on the lock alone
  returning * into v_alert;

  -- Returns the STORED row (snapped point included). ELEMENT SHAPE: identical to
  -- sections 6, 7 and 10 — keep all four in step.
  return jsonb_build_object(
    'id',               v_alert.id,
    'name',             v_alert.name,
    'lat',              ST_Y(v_alert.point::geometry),
    'lng',              ST_X(v_alert.point::geometry),
    'radius_m',         v_alert.radius_m,
    'enabled',          v_alert.enabled,
    'approximate',      v_alert.approximate,
    'make',             v_alert.make,
    'model',            v_alert.model,
    'colour',           v_alert.colour,
    'body_type',        v_alert.body_type,
    'min_bounty_pence', v_alert.min_bounty_pence,
    'recency_days',     v_alert.recency_days,
    'updated_at',       v_alert.updated_at
  );
end;
$$;

comment on function public.update_my_alert(uuid, text, double precision, double precision, int, boolean, boolean, text, text, text, text, int, int) is
  'Full-replace edit of ONE alert the caller owns; returns the STORED row in the shared element shape (identical to list_my_alerts / create_my_alert / set_my_alert_enabled — keep all four in step). SECURITY DEFINER, scoped to id = p_alert_id AND user_id = auth.uid() and taken FOR UPDATE; absent-or-not-yours raises the SAME opaque ALERT_NOT_FOUND, because an alert id maps to a person''s approximate home and must not be probeable. SAFETY: applies the IDENTICAL ~1km ST_SnapToGrid as create_my_alert when p_approximate is true (the fallback for NULL) — skipping it here would make "edit" a way to launder an exact home point into a row flagged approximate. p_enabled falls back to the row''s CURRENT value on NULL (never silently un-pauses a muted alert); p_approximate falls back to TRUE (never silently un-coarsens). Writes only the editable columns — never user_id, id or created_at. Same validation and INVALID_INPUT tokens as create_my_alert. Also raises NOT_AUTHENTICATED.';


-- =============================================================================
-- 9. RPC: delete_my_alert(p_alert_id uuid) -> jsonb
-- =============================================================================
-- Removes ONE alert the caller owns. Returns { "deleted": true }.
--
-- WHY DELETE EXISTS AT ALL IN v2 (it did not in v1): with one zone, "disabled is
-- not deleted" was the right rule — deleting would have cost the user the area
-- they took the trouble to set, so the master switch was the whole answer. With
-- up to five, an alert is a disposable, replaceable object and the cap makes
-- them scarce: without delete, a user who fills all five slots can never make
-- another. `enabled` still exists for pausing (section 10); delete is for
-- "I don't want this one any more".
--
-- SAFETY: SECURITY DEFINER; scoped to id AND user_id = auth.uid(), with the SAME
-- opaque ALERT_NOT_FOUND for absent and not-yours (see section 8). Nobody can
-- delete — i.e. permanently silence — another user's alert, and nobody can use
-- this to test whether an alert id exists.
create or replace function public.delete_my_alert(p_alert_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  -- The predicate IS the authorisation. A single statement: no read-then-delete
  -- window, and the row lock the DELETE takes serialises it against a concurrent
  -- update_my_alert. Served by alert_zones_user_idx.
  delete from public.alert_zones z
  where z.id = p_alert_id
    and z.user_id = v_uid          -- SAFETY: caller's own row ONLY
  returning z.id into v_id;

  -- SAFETY: shared opaque code for BOTH "no such alert" and "not yours".
  if not found then
    raise exception 'ALERT_NOT_FOUND';
  end if;

  return jsonb_build_object('deleted', true);
end;
$$;

comment on function public.delete_my_alert(uuid) is
  'Deletes ONE alert the caller owns and returns { deleted: true }. SECURITY DEFINER; the WHERE clause (id = p_alert_id AND user_id = auth.uid()) is the authorisation, applied in a single statement so there is no read-then-delete window. Absent-or-not-yours raises the SAME opaque ALERT_NOT_FOUND as update_my_alert / set_my_alert_enabled — an alert id maps to a person''s approximate home, so existence must not be probeable. Deletion is a v2 addition: with one zone "disabled is not deleted" was the whole answer, but with a five-alert cap a user who cannot delete can never free a slot. Pausing without losing the area is still set_my_alert_enabled. Also raises NOT_AUTHENTICATED.';


-- =============================================================================
-- 10. RPC: set_my_alert_enabled(p_alert_id uuid, p_enabled boolean) -> jsonb
-- =============================================================================
-- Turns ONE alert on or off WITHOUT touching its geometry or its criteria.
--
-- SAFETY / THE v1 BUG THIS FIXES: set_my_alert_zone_enabled(boolean) qualified
-- its UPDATE on user_id ALONE. That was correct when a user had exactly one row
-- and catastrophic the moment they have five — one tap on "pause Home" would
-- have silently muted every alert they own, with no error and nothing in the UI
-- to show it. The alert id is now a REQUIRED parameter and the predicate carries
-- both id and user_id. Never remove the id from that WHERE clause.
--
-- WHY IT IS STILL ITS OWN FUNCTION rather than "call update with the same
-- values": pausing must not require the client to hold, re-send and re-store a
-- location. A toggle that round-trips coordinates is a toggle that can corrupt
-- them (a stale draft, a rounded float, a race with an edit on another device)
-- and one that needlessly moves a home-ish point across the wire.
create or replace function public.set_my_alert_enabled(
  p_alert_id uuid,
  p_enabled  boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid   uuid := auth.uid();
  v_alert public.alert_zones%rowtype;
begin
  -- SAFETY: backstop; the grant in section 11 already excludes anon.
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
  where z.id = p_alert_id         -- SAFETY: ONE alert. See the v1 bug note above.
    and z.user_id = v_uid         -- SAFETY: caller's own row ONLY
  returning z.* into v_alert;

  -- SAFETY: shared opaque code for BOTH "no such alert" and "not yours".
  -- (v1 returned { found:false } here; with an id parameter that would be an
  -- existence oracle, so v2 raises the same code every other id-scoped alert RPC
  -- raises.)
  if not found then
    raise exception 'ALERT_NOT_FOUND';
  end if;

  -- ELEMENT SHAPE: identical to sections 6, 7 and 8 — keep all four in step.
  -- updated_at comes from the alert_zones_set_updated_at trigger.
  return jsonb_build_object(
    'id',               v_alert.id,
    'name',             v_alert.name,
    'lat',              ST_Y(v_alert.point::geometry),
    'lng',              ST_X(v_alert.point::geometry),
    'radius_m',         v_alert.radius_m,
    'enabled',          v_alert.enabled,
    'approximate',      v_alert.approximate,
    'make',             v_alert.make,
    'model',            v_alert.model,
    'colour',           v_alert.colour,
    'body_type',        v_alert.body_type,
    'min_bounty_pence', v_alert.min_bounty_pence,
    'recency_days',     v_alert.recency_days,
    'updated_at',       v_alert.updated_at
  );
end;
$$;

comment on function public.set_my_alert_enabled(uuid, boolean) is
  'Per-alert switch: flips `enabled` on ONE alert without touching its geometry or criteria, so pausing never round-trips (or risks corrupting) a location. Returns the updated row in the shared element shape (identical to list_my_alerts / create_my_alert / update_my_alert — keep all four in step). SECURITY DEFINER; the predicate carries BOTH id and user_id = auth.uid(). THIS REPLACES v1''s set_my_alert_zone_enabled(boolean), whose UPDATE was qualified on user_id ALONE — harmless with one row per user, but with five it would have muted every alert the user owned on a single tap. Absent-or-not-yours raises the SAME opaque ALERT_NOT_FOUND as update_my_alert / delete_my_alert (v1''s { found:false } would be an existence oracle now that an id is a parameter). Raises NOT_AUTHENTICATED (guest) and INVALID_INPUT (null p_enabled).';


-- =============================================================================
-- 11. FUNCTION GRANTS
-- =============================================================================
-- SAFETY: functions default to EXECUTE granted to PUBLIC, and this project ALSO
-- ships ALTER DEFAULT PRIVILEGES granting EXECUTE to anon (see
-- 20260713190000_post_a_car.sql / the 20260713191000 incident), so revoking
-- PUBLIC alone is NOT enough — anon must be named EXPLICITLY on every one of
-- these. An alert belongs to an account: a guest has nothing to list, create,
-- edit, delete or toggle here. The NOT_AUTHENTICATED / empty-array guards inside
-- the bodies are a backstop, not the control.
--
-- Every signature below is spelled out in full and must match its CREATE exactly
-- — revoke/grant/comment all resolve by exact signature, and a mismatch is a
-- 42883 mid-apply that blocks every later migration.

revoke execute on function public.list_my_alerts() from public, anon;
grant  execute on function public.list_my_alerts() to authenticated, service_role;

revoke execute on function public.create_my_alert(text, double precision, double precision, int, boolean, boolean, text, text, text, text, int, int)
  from public, anon;
grant  execute on function public.create_my_alert(text, double precision, double precision, int, boolean, boolean, text, text, text, text, int, int)
  to authenticated, service_role;

revoke execute on function public.update_my_alert(uuid, text, double precision, double precision, int, boolean, boolean, text, text, text, text, int, int)
  from public, anon;
grant  execute on function public.update_my_alert(uuid, text, double precision, double precision, int, boolean, boolean, text, text, text, text, int, int)
  to authenticated, service_role;

revoke execute on function public.delete_my_alert(uuid) from public, anon;
grant  execute on function public.delete_my_alert(uuid) to authenticated, service_role;

revoke execute on function public.set_my_alert_enabled(uuid, boolean) from public, anon;
grant  execute on function public.set_my_alert_enabled(uuid, boolean) to authenticated, service_role;


-- =============================================================================
-- END OF MIGRATION
-- =============================================================================

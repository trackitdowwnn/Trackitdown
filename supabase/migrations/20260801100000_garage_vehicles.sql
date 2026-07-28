-- =============================================================================
-- WHAT:  The GARAGE feature ("my saved cars") database layer. Creates three new
--        user-owned tables — public.vehicles (a saved car: make/model/colour
--        required, plate/year/body_type/nickname optional), public.vehicle_photos
--        (ordered images, mirroring post_photos) and
--        public.vehicle_distinctive_feature (ordered photo+description evidence
--        pairs, mirroring post_distinctive_feature) — each with deny-by-default
--        RLS granting the OWNER a read and nobody a write. Adds a provenance-only
--        posts.vehicle_id (ON DELETE SET NULL). Adds four SECURITY DEFINER RPCs:
--        add_vehicle(), update_vehicle(), delete_vehicle() and list_my_vehicles().
-- WHY:   Owners re-post the same car (recovered then stolen again; a car sold on
--        and re-listed; a household with several cars) and today must re-type
--        every field and re-upload every photo into the wizard each time. The
--        garage lets them save a car ONCE and prefill the post-a-car wizard from
--        it. A saved vehicle is PRIVATE — it is not a post, it is not published,
--        it is not searchable, and nobody but its owner may ever read it (a
--        public "who owns which car" index would be a gift to a thief and a
--        stalking vector, SECURITY_AND_TRUST §2/§3). Garage photos deliberately
--        reuse the SAME post-photos bucket and the SAME own-folder URL rule as
--        posts, so a saved photo URL is handed straight to create_post with no
--        re-upload and no second validation surface.
-- LINKS: docs/DOMAIN.md (post lifecycle — the active-ish set gating deletion;
--          "Post content — structured fields" — the car fields mirrored here;
--          the plate is OPTIONAL, so it is optional here too),
--        docs/SECURITY_AND_TRUST.md §2 (anti-stalking; one ACTIVE post per
--          plate — note this table's uniqueness is per-USER, see below),
--          §3 (own-folder photo hosting), §6 (RLS deny by default; SECURITY
--          DEFINER hardening; writes never via client DML),
--        supabase/migrations/20260722100000_watchlist.sql (THE canonical
--          user-owned-row pattern copied here: FK to profiles, explicit grants,
--          anon gets nothing, wrapped (select auth.uid()), reads via a SECURITY
--          DEFINER RPC, revoke/grant execute at the end),
--        supabase/migrations/20260713140000_post_detail.sql (post_photos — the
--          shape vehicle_photos mirrors),
--        supabase/migrations/20260724100000_post_distinctive_features.sql (the
--          post_distinctive_feature shape + create_post's plate canon rule,
--          own-folder photo regex and raise codes, all reused verbatim below),
--        supabase/migrations/20260727130000_edit_post_sections.sql (the
--          owner-pinned + FOR UPDATE + single-opaque-code edit pattern that
--          update_vehicle follows),
--        supabase/migrations/20260727100000_list_my_posts.sql (list_my_vehicles
--          mirrors its SECURITY DEFINER + empty-array-for-anon read model).
--
-- NOTE — create_post IS DELIBERATELY NOT TOUCHED HERE. This migration only adds
--        the posts.vehicle_id COLUMN. A SEPARATE follow-up migration adds the
--        p_vehicle_id parameter to create_post (that change must DROP and
--        recreate create_post because a new parameter changes the function's
--        identity — see the 20260724100000 safety note). Until that ships,
--        posts.vehicle_id is written by nothing and is always NULL.
--
-- SAFETY NOTE ON DESTRUCTIVE STATEMENTS: none. Fully additive — three new
--        tables + their indexes/RLS/policies/grants, one new NULLABLE posts
--        column + its index, and four new functions + their grants. No
--        drop/rename/truncate of any existing object, no data change, no
--        existing function body, policy, grant or constraint is modified.
-- =============================================================================


-- =============================================================================
-- 1. TABLE: vehicles
-- A car the caller has SAVED. Private to its owner. Not a post.
-- =============================================================================
create table public.vehicles (
  id         uuid primary key default gen_random_uuid(),

  -- The owner. FK to profiles (the house convention for user-owned rows —
  -- posts.owner_id, sightings.spotter_id, watchlist_items.user_id all reference
  -- profiles, which is 1:1 with auth.users). ON DELETE CASCADE: a saved car is
  -- worthless without its owner and carries NO money state (contrast payments'
  -- ON DELETE RESTRICT), so UK GDPR erasure of the user removes their garage
  -- with them. Their historical POSTS are unaffected — see §4, posts keep their
  -- own denormalised snapshot and posts.vehicle_id is ON DELETE SET NULL.
  user_id    uuid not null references public.profiles (id) on delete cascade,

  -- UK number plate. NULLABLE — plates are OPTIONAL exactly as they are on posts
  -- (DOMAIN.md: some owners don't have it, e.g. the thief swapped it). Stored
  -- upper+trimmed like posts.plate; add_vehicle/update_vehicle store NULL
  -- whenever the canonical form is empty. Length bound mirrors posts_plate_len_chk.
  plate      text
    constraint vehicles_plate_len_chk
      check (plate is null or char_length(plate) <= 15),

  -- The car's identity. Required here for the same reason it is required on a
  -- post: with an optional plate, make/model/colour ARE the identification.
  make       text not null,
  model      text not null,
  colour     text not null,

  -- Free-text specifics for an ESCAPE colour ("Multicolour / wrapped", "Other"),
  -- e.g. "matte black wrap over silver". Kept in its own column so `colour`
  -- stays a clean enum for cards and future colour filters — exactly the split
  -- posts make, where this value lands in posts.owner_note. Without it a saved
  -- wrapped car would silently lose the one detail that actually identifies it,
  -- and so would every post prefilled from that car.
  colour_note text
    constraint vehicles_colour_note_len_chk
    check (colour_note is null or char_length(colour_note) <= 200),

  -- Model year (nullable). SAME range CHECK as posts_year_range_chk so a garage
  -- vehicle can never prefill a post with a year the post would reject.
  year       int
    constraint vehicles_year_range_chk
      check (year is null or year between 1900 and 2100),

  -- Body style label ("Hatchback", "SUV", "Saloon"); mirrors posts.body_type.
  body_type  text
    constraint vehicles_body_type_len_chk
      check (body_type is null or char_length(body_type) <= 40),

  -- The owner's own label for this car in their garage ("Mum's Golf", "the van").
  -- PRIVATE free text that never reaches a post or any public surface. Bounded so
  -- it stays a short label rather than an unbounded blob.
  nickname   text
    constraint vehicles_nickname_len_chk
      check (nickname is null or char_length(btrim(nickname)) <= 40),

  -- RESERVED — DORMANT. NOTHING WRITES THIS TODAY. Every row is 'unverified'.
  -- Proof-of-ownership (V5C / pre-verification) was DELIBERATELY EXCLUDED from
  -- the garage: the whole point of a saved car is a fast wizard prefill, and the
  -- post lifecycle itself no longer has a pre-publish verification gate
  -- (DOMAIN.md LIVE-ON-PAYMENT; the verification_documents table is dormant for
  -- the same reason). The column exists ONLY so that re-introducing per-vehicle
  -- verification later (e.g. a "verified owner" badge, or proof for very high
  -- bounties — the deferred item in DOMAIN.md Anti-abuse) is a code change, not
  -- a table rewrite/backfill on live user data. If you make it live: it must be
  -- written by a MODERATOR/service-role path only, never by add_vehicle or
  -- update_vehicle, and never by a client DML grant.
  verification_state text not null default 'unverified'
    constraint vehicles_verification_state_chk
      check (verification_state in ('unverified', 'pending', 'verified', 'rejected')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.vehicles is
  'A car SAVED by a user (their "garage"), used to prefill the post-a-car wizard. PRIVATE to its owner: no public, cross-user, or owner-of-another-post read exists. Not a post and never published. Written ONLY by add_vehicle/update_vehicle/delete_vehicle (SECURITY DEFINER) or the service role — no client write policy exists. Read via list_my_vehicles().';
comment on column public.vehicles.user_id is
  'Owner (profiles.id). ON DELETE CASCADE — the garage dies with the account (GDPR erasure); historical posts are NOT affected (posts.vehicle_id is ON DELETE SET NULL and posts hold their own snapshot).';
comment on column public.vehicles.plate is
  'OPTIONAL UK plate, stored upper+trimmed (<=15 chars, mirrors posts_plate_len_chk). NULL when the owner has no plate or supplied one that canonicalises to empty. Unique PER USER only — see vehicles_user_plate_canon_uidx.';
comment on column public.vehicles.make is
  'Manufacturer. Required — with an optional plate, make/model/colour are the car''s identity (same rule as posts / create_post MISSING_REQUIRED).';
comment on column public.vehicles.model is
  'Model. Required (see make).';
comment on column public.vehicles.colour is
  'Colour. Required (see make). A canonical colour NAME from the swatch grid, kept as a clean enum for cards and future colour filters.';
comment on column public.vehicles.colour_note is
  'Free-text specifics for an ESCAPE colour ("Multicolour / wrapped" / "Other") — e.g. "matte black wrap over silver". Optional, <=200 chars, stored trimmed-or-NULL. Mirrors the colour/colourNote split posts make (where this lands in posts.owner_note); without it a saved wrapped car would lose the detail that actually identifies it.';
comment on column public.vehicles.year is
  'Model year (nullable). CHECK 1900-2100 — identical bound to posts_year_range_chk so a saved vehicle can never prefill a post with a year the post rejects.';
comment on column public.vehicles.body_type is
  'Body style label e.g. Hatchback/SUV/Saloon (nullable, <=40 chars); mirrors posts.body_type.';
comment on column public.vehicles.nickname is
  'The owner''s private label for this car in their garage, e.g. "Mum''s Golf" (nullable, <=40 chars trimmed). Never copied onto a post and never shown to anyone but the owner.';
comment on column public.vehicles.verification_state is
  'RESERVED / DORMANT — NOTHING WRITES THIS TODAY; every row is ''unverified''. V5C / pre-verification was deliberately excluded from the garage (DOMAIN.md LIVE-ON-PAYMENT). The column exists so a future re-introduction is a code change, not a table rewrite. If activated it must be moderator/service-role-written only. Constrained to unverified/pending/verified/rejected.';
comment on column public.vehicles.updated_at is
  'Last edit of this vehicle or its child rows, set explicitly by update_vehicle. Not client-suppliable (clients hold no write grant on this table).';

-- The garage list read (list_my_vehicles) and every RLS predicate on this table
-- filter by user_id, so it needs its own index.
create index vehicles_user_id_idx
  on public.vehicles (user_id);

-- ONE saved vehicle per (owner, canonical plate). The canon expression is
-- IDENTICAL to the one create_post uses for its PLATE_IN_USE check, so "the same
-- plate" means the same thing in both places (punctuation/case/spacing-insensitive).
-- Partial: plate-less vehicles are unconstrained (an owner may save several cars
-- with no plate — there is nothing to dedupe on).
--
-- SAFETY — this is PER-USER uniqueness, deliberately NOT global. Two different
-- people may legitimately both have the same plate saved (a car sold on; a
-- household member saving the family car; a plate transferred). More importantly,
-- a GLOBAL unique index would turn "save this car" into an ORACLE for other
-- users' garages: a stranger could probe plate by plate and learn which cars are
-- in someone's garage from the constraint violation alone. The one-ACTIVE-POST-
-- per-plate rule (SECURITY_AND_TRUST §2) stays where it belongs — on POSTS, in
-- create_post — and is unaffected by this table.
create unique index vehicles_user_plate_canon_uidx
  on public.vehicles (
    user_id,
    (upper(regexp_replace(coalesce(plate, ''), '[^A-Za-z0-9]', '', 'g')))
  )
  where plate is not null;

alter table public.vehicles enable row level security;

-- SAFETY: under this project's config (auto_expose_new_tables unset in
-- config.toml) a new public table auto-grants NO data privileges, so the policy
-- below is DEAD without an explicit grant. authenticated gets SELECT ONLY —
-- every write runs through the SECURITY DEFINER RPCs (§5), which pin ownership,
-- enforce the 5-vehicle cap and re-validate photo URLs; a client INSERT/UPDATE/
-- DELETE grant would bypass all three. anon gets NOTHING: a garage requires an
-- account by definition, and a logged-out reader must not learn that any of this
-- exists. service_role bypasses RLS but is not auto-granted, so give it full DML.
grant select on public.vehicles to authenticated;
grant select, insert, update, delete on public.vehicles to service_role;

-- SAFETY: a user may read ONLY their own saved vehicles. There is no other read
-- path — not for other users, not for a post's viewers, not for moderators (a
-- moderator surface, if ever built, goes through service_role/an explicit RPC).
create policy vehicles_select_own
  on public.vehicles
  for select
  to authenticated
  using (user_id = (select auth.uid()));

-- SAFETY: NO insert/update/delete policy exists -> those are denied by default
-- for anon/authenticated (and no grant exists either — belt and braces). Writes
-- run ONLY through add_vehicle/update_vehicle/delete_vehicle or the service role.
-- Do not add a client write policy here without reviewing SECURITY_AND_TRUST §6.


-- =============================================================================
-- 2. TABLE: vehicle_photos
-- Ordered images for a saved vehicle. Mirrors post_photos exactly.
-- =============================================================================
create table public.vehicle_photos (
  id         uuid primary key default gen_random_uuid(),

  -- The vehicle these photos belong to. ON DELETE CASCADE: a photo row is wholly
  -- owned by its vehicle and carries no independent value or money state, so it
  -- dies with it — identical choice to post_photos. NOTE: this cascades only the
  -- DB row; the underlying Storage object in the post-photos bucket is cleaned up
  -- by the same retention/erasure path as post imagery (and may still be
  -- referenced by a POST the owner created from this vehicle — see §4, which is
  -- exactly why deleting a garage vehicle must never touch post_photos).
  vehicle_id uuid not null references public.vehicles (id) on delete cascade,

  -- Public URL of the stored image. DELIBERATELY the SAME post-photos bucket and
  -- the SAME own-folder host regex the hero photos use (§3 anti spotter-tracking),
  -- re-validated by add_vehicle/update_vehicle, so a saved URL is directly usable
  -- by create_post with no re-upload and no second validation surface.
  url        text not null,

  -- Display order within the vehicle's gallery; 0-based (post_photos-style).
  position   int not null
    constraint vehicle_photos_position_nonneg_chk
      check (position >= 0),

  created_at timestamptz not null default now()
);

comment on table public.vehicle_photos is
  'Ordered images for a saved garage vehicle; mirrors post_photos. PRIVATE — readable only by the owning user (RLS below). Written ONLY by add_vehicle/update_vehicle (SECURITY DEFINER) or the service role; no client write policy exists.';
comment on column public.vehicle_photos.url is
  'Public URL of the image, an own-folder object in the SAME post-photos bucket the wizard uploads to, re-validated against the same own-folder regex create_post uses. Reusing the bucket is what lets a saved photo prefill a post with no re-upload.';
comment on column public.vehicle_photos.position is
  '0-based display order, matching the order the client sent the URLs (mirrors post_photos.position).';

-- Index for the hot read (a vehicle's photos in display order); also covers the
-- vehicle_id equality used by the RLS SELECT policy and the FK cascade path.
create index vehicle_photos_vehicle_id_position_idx
  on public.vehicle_photos (vehicle_id, position);

alter table public.vehicle_photos enable row level security;

-- SAFETY: explicit grants (see the vehicles note — policies are dead without
-- them). SELECT only for authenticated; anon gets NOTHING. Writes are RPC /
-- service-role only. service_role gets full DML.
grant select on public.vehicle_photos to authenticated;
grant select, insert, update, delete on public.vehicle_photos to service_role;

-- SAFETY: a user may read a vehicle photo ONLY when the parent vehicle is theirs.
-- Gated on the parent (mirrors post_photos_select_own's shape) so the photo's
-- visibility can never drift from the vehicle's.
create policy vehicle_photos_select_own_vehicle
  on public.vehicle_photos
  for select
  to authenticated
  using (
    exists (
      select 1 from public.vehicles v
      where v.id = vehicle_photos.vehicle_id
        and v.user_id = (select auth.uid())
    )
  );

-- SAFETY: NO insert/update/delete policy (and no grant) -> denied by default.
-- Photo writes run only through add_vehicle/update_vehicle or the service role.


-- =============================================================================
-- 3. TABLE: vehicle_distinctive_feature
-- Ordered photo+description evidence pairs for a saved vehicle.
-- Mirrors post_distinctive_feature exactly.
-- =============================================================================
create table public.vehicle_distinctive_feature (
  id          uuid primary key default gen_random_uuid(),

  -- ON DELETE CASCADE: wholly owned by its vehicle, no independent value or
  -- money state — identical choice to post_distinctive_feature.
  vehicle_id  uuid not null references public.vehicles (id) on delete cascade,

  -- Public URL of the evidence image. SAME post-photos bucket + SAME own-folder
  -- regex as vehicle_photos and the post equivalents (§3).
  photo_url   text not null,

  -- The owner's caption for this mark (e.g. "Cracked nearside wing mirror").
  -- 3-80 chars measured TRIMMED — byte-for-byte the post_distinctive_feature
  -- bound, so a saved feature always satisfies create_post's re-check.
  description text not null
    constraint vehicle_distinctive_feature_description_len_chk
      check (char_length(btrim(description)) between 3 and 80),

  -- 0-based display order within the vehicle's feature list.
  position    int not null
    constraint vehicle_distinctive_feature_position_nonneg_chk
      check (position >= 0),

  created_at  timestamptz not null default now()
);

comment on table public.vehicle_distinctive_feature is
  'Ordered owner-authored photo+description evidence pairs for a saved garage vehicle (e.g. "Cracked nearside wing mirror"); mirrors post_distinctive_feature so the rows prefill a post unchanged. PRIVATE — readable only by the owning user. Written ONLY by add_vehicle/update_vehicle (SECURITY DEFINER) or the service role.';
comment on column public.vehicle_distinctive_feature.photo_url is
  'Public URL of the evidence image (own-folder post-photos object), validated against the same own-folder regex create_post uses.';
comment on column public.vehicle_distinctive_feature.description is
  'Owner caption for the mark, 3-80 chars trimmed (CHECK) — the identical bound post_distinctive_feature enforces.';

-- Index for the hot read (features in display order); also covers the RLS
-- vehicle_id equality and the FK cascade path.
create index vehicle_distinctive_feature_vehicle_id_position_idx
  on public.vehicle_distinctive_feature (vehicle_id, position);

alter table public.vehicle_distinctive_feature enable row level security;

-- SAFETY: explicit grants; SELECT only for authenticated, anon gets NOTHING,
-- writes are RPC / service-role only.
grant select on public.vehicle_distinctive_feature to authenticated;
grant select, insert, update, delete on public.vehicle_distinctive_feature to service_role;

-- SAFETY: a user may read a vehicle's distinctive feature ONLY when the parent
-- vehicle is theirs (gated on the parent, mirroring vehicle_photos).
create policy vehicle_distinctive_feature_select_own_vehicle
  on public.vehicle_distinctive_feature
  for select
  to authenticated
  using (
    exists (
      select 1 from public.vehicles v
      where v.id = vehicle_distinctive_feature.vehicle_id
        and v.user_id = (select auth.uid())
    )
  );

-- SAFETY: NO insert/update/delete policy (and no grant) -> denied by default.


-- =============================================================================
-- 4. POSTS: vehicle_id  —  PROVENANCE ONLY. READ THIS BEFORE USING IT.
-- =============================================================================
-- This column records WHICH saved vehicle (if any) a post was created from. That
-- is ALL it is for. It is NOT a foreign-key-normalised "the post's car lives over
-- there" relationship, and NOTHING may ever read it to render a post.
--
-- WHY (the invariant this protects): a post is a SNAPSHOT taken at posting time.
-- posts already carries every car field denormalised ON THE POST ROW ITSELF —
-- make, model, colour, year, body_type, plate — plus its own child rows in
-- post_photos and post_distinctive_feature. A post is therefore complete and
-- self-describing with no reference to any vehicle whatsoever.
--
-- The failure mode this design forbids: an owner edits their garage vehicle (new
-- colour, deletes a photo, fixes a typo) or deletes it entirely, and a LIVE
-- stolen-car listing silently changes underneath the spotters who matched against
-- it — or worse, breaks. That would be a safety bug, not just a data bug:
-- spotters scan for "silver Golf" and a listing must never mutate out from under
-- them. It is also the same reason update_post_car_details exists as a separate,
-- deliberate, owner-driven edit path on the POST.
--
-- ON DELETE SET NULL is the mechanical guarantee. Deleting a garage vehicle sets
-- this pointer to NULL and touches NOTHING else on the post — the post keeps its
-- own make/model/colour/year/body_type/plate and its own photos and distinctive
-- features. (Contrast the child tables above, which CASCADE because they belong
-- to the vehicle; and payments' ON DELETE RESTRICT, which protects money state.)
--
-- Uses of this column that ARE legitimate: "you already have a live post for this
-- car" checks (delete_vehicle's VEHICLE_HAS_ACTIVE_POST gate, and
-- list_my_vehicles' is_currently_posted / active_post_id flags), and future
-- analytics on garage->post conversion.
-- Uses that are NOT: joining to vehicles to display anything on a post.
--
-- SAFETY (grants): posts' client grants are EXPLICIT COLUMN LISTS, so this new
-- column is excluded from every one of them by default and no client can write
-- it. It is populated server-side by create_post once the follow-up migration
-- adds p_vehicle_id (see the NOTE in the header). Until then it is always NULL.
alter table public.posts
  add column vehicle_id uuid references public.vehicles (id) on delete set null;

comment on column public.posts.vehicle_id is
  'PROVENANCE ONLY: the garage vehicle this post was created from, or NULL. NOTHING reads it for display — the post stores its own snapshot of make/model/colour/year/body_type/plate plus its own post_photos and post_distinctive_feature rows. ON DELETE SET NULL guarantees that editing or deleting a garage vehicle can NEVER alter or break a historical post. Used only for "is this car currently posted" checks (delete_vehicle, list_my_vehicles) and conversion analytics. Server-written (create_post, after the follow-up migration); excluded from every client column grant.';

-- Partial index: serves the FK's SET NULL maintenance scan, delete_vehicle's
-- active-post gate, and list_my_vehicles' per-vehicle active-post lookup. Partial
-- because the overwhelming majority of posts have no vehicle_id (every post
-- predating the garage, and every post made without one).
create index posts_vehicle_id_idx
  on public.posts (vehicle_id)
  where vehicle_id is not null;


-- =============================================================================
-- 5. RPC: add_vehicle(...) -> jsonb   (SECURITY DEFINER — the write boundary)
-- =============================================================================
-- Creates one saved vehicle plus its photos and distinctive features, ATOMICALLY
-- (single transaction — any raise rolls the whole thing back, no orphan vehicle
-- with half its photos).
--
-- SAFETY (Tier 1 — read before editing): SECURITY DEFINER, so it BYPASSES RLS.
--   user_id is PINNED to auth.uid() — there is no owner parameter and none may
--   ever be added. verification_state is NOT a parameter either: it stays on its
--   'unverified' default (see the column comment — it is dormant and, if ever
--   activated, is moderator-written only). ALL validation below is a SERVER
--   re-check of untrusted client input, and every photo URL is re-validated
--   against the caller's OWN folder — a client cannot smuggle in someone else's
--   (or an attacker-controlled) image URL as a tracking beacon (§3).
--
-- Raise codes mirror create_post's vocabulary so the client error mapper is
-- shared: NOT_AUTHENTICATED, MISSING_REQUIRED, INVALID_PLATE, PHOTO_COUNT,
-- INVALID_PHOTO_URL, DISTINCTIVE_FEATURES_COUNT, INVALID_DISTINCTIVE_FEATURE,
-- INVALID_DISTINCTIVE_PHOTO_URL, plus two garage-specific ones:
-- VEHICLE_LIMIT_REACHED and PLATE_ALREADY_SAVED.
--
-- DELIBERATE DIVERGENCES FROM create_post:
--   * PHOTOS ARE OPTIONAL (0..6). The wizard's 3-6 minimum is a POSTING rule —
--     a listing with too few photos is a bad listing. Saving a car for later is
--     not publishing anything, so demanding 3 photos up front would just stop
--     people using the garage. create_post still enforces 3-6 at posting time,
--     which is where it matters; a photo-light saved vehicle simply means the
--     owner tops up in the wizard.
--   * PLATE UNIQUENESS IS PER-USER (PLATE_ALREADY_SAVED), not create_post's
--     global one-active-post-per-plate (PLATE_IN_USE). See the index comment —
--     a global check here would be an oracle for other users' garages. Saving a
--     plate does NOT reserve it; create_post's PLATE_IN_USE gate is still the
--     only thing that governs posting.
--   * NO bounty, location, last-seen or verification-document handling: a saved
--     vehicle has NO money and NO location. It is the car, not the incident.
create or replace function public.add_vehicle(
  p_plate                text,
  p_make                 text,
  p_model                text,
  p_colour               text,
  p_colour_note          text,
  p_year                 int,
  p_body_type            text,
  p_nickname             text,
  p_photo_urls           text[],
  p_distinctive_features jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_owner        uuid := auth.uid();
  v_vehicle_id   uuid;
  v_plate        text;
  v_plate_canon  text;
  v_nickname     text;
  v_photo_count  int  := coalesce(array_length(p_photo_urls, 1), 0);
  v_url          text;
  -- IDENTICAL own-folder regex to create_post: our Storage host, the post-photos
  -- bucket, and a single path segment under the CALLER's own uuid folder.
  v_photo_url_re text := '^https?://(127\.0\.0\.1(:[0-9]+)?|[a-z0-9-]+\.supabase\.co)'
                         || '/storage/v1/object/public/post-photos/'
                         || v_owner::text || '/[^/]+$';
  v_features     jsonb := coalesce(p_distinctive_features, '[]'::jsonb);
  v_feature      jsonb;
  v_feat_desc    text;
  v_feat_url     text;
  -- The garage cap. Small on purpose: the garage is a convenience for the cars
  -- you actually own, not a fleet register. It also bounds the blast radius of
  -- an automated abuse loop hammering add_vehicle.
  v_vehicle_cap  int  := 5;
begin
  if v_owner is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  -- --- Required fields (make/model/colour are the identity, plate or not) ------
  if p_make is null or p_model is null or p_colour is null then
    raise exception 'MISSING_REQUIRED';
  end if;

  -- --- Garage cap -------------------------------------------------------------
  -- SAFETY: counts the CALLER's rows only (v_owner), so the count can never be a
  -- signal about anyone else's garage.
  if (select count(*) from public.vehicles v where v.user_id = v_owner) >= v_vehicle_cap then
    raise exception 'VEHICLE_LIMIT_REACHED';
  end if;

  -- --- OPTIONAL PLATE: canon first; a plate that strips to nothing is NULL -----
  -- Byte-for-byte create_post's rule (20260713195000): a blank, punctuation-only
  -- or non-ASCII-homoglyph "plate" is NOT a plate and is stored as NULL.
  v_plate_canon := upper(regexp_replace(coalesce(p_plate, ''), '[^A-Za-z0-9]', '', 'g'));
  v_plate := case when v_plate_canon = '' then null
                  else upper(trim(coalesce(p_plate, ''))) end;

  if v_plate_canon <> '' then
    -- Same format gate as create_post, so a saved plate can always be posted.
    if v_plate_canon !~ '^[A-Z0-9]{2,8}$' then
      raise exception 'INVALID_PLATE';
    end if;
    -- Bound the STORED (raw, upper+trimmed) form too: the canon gate above caps
    -- the alphanumerics at 8 but says nothing about padding punctuation, and the
    -- vehicles_plate_len_chk CHECK would otherwise surface as a raw constraint
    -- violation instead of a mapped code.
    if char_length(v_plate) > 15 then
      raise exception 'INVALID_PLATE';
    end if;
    -- SAFETY: PER-USER dedupe only (see vehicles_user_plate_canon_uidx). The
    -- unique index is the real enforcement; this is the friendly, mapped error.
    if exists (
      select 1
      from public.vehicles v
      where v.user_id = v_owner
        and upper(regexp_replace(coalesce(v.plate, ''), '[^A-Za-z0-9]', '', 'g')) = v_plate_canon
    ) then
      raise exception 'PLATE_ALREADY_SAVED';
    end if;
  end if;

  -- --- Nickname: trimmed; an empty box is NULL, not '' ------------------------
  -- Length is enforced by vehicles_nickname_len_chk (the same no-explicit-raise
  -- treatment update_post_car_details gives year).
  v_nickname := nullif(btrim(coalesce(p_nickname, '')), '');

  -- --- Photos: OPTIONAL here (0..6). See the divergence note above. -----------
  if v_photo_count > 6 then
    raise exception 'PHOTO_COUNT';
  end if;

  -- --- SAFETY: photo URLs must be our own-folder post-photos objects ----------
  if v_photo_count > 0 then
    foreach v_url in array p_photo_urls loop
      if v_url is null or char_length(v_url) > 500 or v_url !~ v_photo_url_re then
        raise exception 'INVALID_PHOTO_URL';
      end if;
    end loop;
  end if;

  -- --- Distinctive features: create_post's validation, verbatim ---------------
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

  -- --- Atomic assembly (single transaction) -----------------------------------
  -- SAFETY: user_id pinned to the caller; verification_state deliberately absent
  -- from this INSERT so it takes its 'unverified' default.
  insert into public.vehicles (
    user_id, plate, make, model, colour, colour_note, year, body_type, nickname
  )
  values (
    v_owner, v_plate, p_make, p_model, p_colour, nullif(btrim(p_colour_note), ''),
    p_year, p_body_type, v_nickname
  )
  returning id into v_vehicle_id;

  if v_photo_count > 0 then
    insert into public.vehicle_photos (vehicle_id, url, position)
    select v_vehicle_id, u.url, (u.ord - 1)::int
    from unnest(p_photo_urls) with ordinality as u(url, ord);
  end if;

  -- position = ordinality-1 so stored order matches the order the client sent;
  -- description stored TRIMMED (the CHECK measures it trimmed — store it clean).
  insert into public.vehicle_distinctive_feature (vehicle_id, photo_url, description, position)
  select v_vehicle_id,
         elem.value ->> 'photo_url',
         btrim(elem.value ->> 'description'),
         (elem.ord - 1)::int
  from jsonb_array_elements(v_features) with ordinality as elem(value, ord);

  return jsonb_build_object('vehicle_id', v_vehicle_id);
end;
$$;

comment on function public.add_vehicle(text, text, text, text, text, int, text, text, text[], jsonb) is
  'The write boundary for saving a car to the garage. SECURITY DEFINER: pins user_id to the caller, leaves verification_state on its dormant ''unverified'' default, and atomically inserts the vehicle + photos + distinctive features. Re-validates make/model/colour (MISSING_REQUIRED), the 5-vehicle cap (VEHICLE_LIMIT_REACHED), the OPTIONAL plate''s format (INVALID_PLATE, same canon+^[A-Z0-9]{2,8}$ gate as create_post) and PER-USER uniqueness (PLATE_ALREADY_SAVED — deliberately not global; see the unique index comment), 0-6 photos (PHOTO_COUNT — photos are OPTIONAL here, unlike create_post''s 3-6 posting minimum), own-folder photo URLs (INVALID_PHOTO_URL), and up to 8 distinctive features (DISTINCTIVE_FEATURES_COUNT / INVALID_DISTINCTIVE_FEATURE / INVALID_DISTINCTIVE_PHOTO_URL). Also raises NOT_AUTHENTICATED. Returns {"vehicle_id": uuid}.';


-- =============================================================================
-- 6. RPC: update_vehicle(...) -> jsonb
-- =============================================================================
-- Full-replace edit of one saved vehicle the caller OWNS, plus a full replace of
-- its child rows SCOPED to that vehicle.
--
-- SAFETY (Tier 1): SECURITY DEFINER (bypasses RLS). Owner-pinned via
--   user_id = auth.uid() with FOR UPDATE (serialises concurrent edits/deletes of
--   the same row). A miss on ANY of (doesn't exist / isn't yours) raises the SAME
--   single opaque VEHICLE_NOT_FOUND — no existence oracle, matching the
--   POST_NOT_EDITABLE pattern in the per-section post edit RPCs.
--   user_id and verification_state are NOT in the UPDATE's column list: a vehicle
--   cannot be reassigned to another user, and the dormant verification state
--   cannot be self-awarded, through this path.
--
-- SAFETY (the post snapshot): editing a vehicle changes NOTHING on any post ever
--   created from it. Posts hold their own denormalised fields and their own
--   post_photos / post_distinctive_feature rows; the deletes below are scoped to
--   vehicle_id and cannot reach a post's child rows. See §4. This is why an edit
--   is allowed even while the car has a live listing.
create or replace function public.update_vehicle(
  p_vehicle_id           uuid,
  p_plate                text,
  p_make                 text,
  p_model                text,
  p_colour               text,
  p_colour_note          text,
  p_year                 int,
  p_body_type            text,
  p_nickname             text,
  p_photo_urls           text[],
  p_distinctive_features jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_owner        uuid := auth.uid();
  v_vehicle      public.vehicles%rowtype;
  v_plate        text;
  v_plate_canon  text;
  v_nickname     text;
  v_photo_count  int  := coalesce(array_length(p_photo_urls, 1), 0);
  v_url          text;
  v_photo_url_re text := '^https?://(127\.0\.0\.1(:[0-9]+)?|[a-z0-9-]+\.supabase\.co)'
                         || '/storage/v1/object/public/post-photos/'
                         || v_owner::text || '/[^/]+$';
  v_features     jsonb := coalesce(p_distinctive_features, '[]'::jsonb);
  v_feature      jsonb;
  v_feat_desc    text;
  v_feat_url     text;
begin
  if v_owner is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  -- SAFETY: own + locked, else ONE opaque code. Absent and not-yours are
  -- indistinguishable to the caller by design.
  select * into v_vehicle
  from public.vehicles v
  where v.id = p_vehicle_id
    and v.user_id = v_owner
  for update;
  if not found then
    raise exception 'VEHICLE_NOT_FOUND';
  end if;

  -- --- Required identity (same rule as add_vehicle / create_post) -------------
  if p_make is null or p_model is null or p_colour is null then
    raise exception 'MISSING_REQUIRED';
  end if;

  -- --- OPTIONAL PLATE: identical canon + gates to add_vehicle -----------------
  v_plate_canon := upper(regexp_replace(coalesce(p_plate, ''), '[^A-Za-z0-9]', '', 'g'));
  v_plate := case when v_plate_canon = '' then null
                  else upper(trim(coalesce(p_plate, ''))) end;

  if v_plate_canon <> '' then
    if v_plate_canon !~ '^[A-Z0-9]{2,8}$' then
      raise exception 'INVALID_PLATE';
    end if;
    if char_length(v_plate) > 15 then
      raise exception 'INVALID_PLATE';
    end if;
    -- PER-USER dedupe, EXCLUDING this row (re-saving the same plate on the same
    -- vehicle is a no-op, not a clash).
    if exists (
      select 1
      from public.vehicles v
      where v.user_id = v_owner
        and v.id <> p_vehicle_id
        and upper(regexp_replace(coalesce(v.plate, ''), '[^A-Za-z0-9]', '', 'g')) = v_plate_canon
    ) then
      raise exception 'PLATE_ALREADY_SAVED';
    end if;
  end if;

  v_nickname := nullif(btrim(coalesce(p_nickname, '')), '');

  -- --- Photos: OPTIONAL (0..6), own-folder only -------------------------------
  if v_photo_count > 6 then
    raise exception 'PHOTO_COUNT';
  end if;
  if v_photo_count > 0 then
    foreach v_url in array p_photo_urls loop
      if v_url is null or char_length(v_url) > 500 or v_url !~ v_photo_url_re then
        raise exception 'INVALID_PHOTO_URL';
      end if;
    end loop;
  end if;

  -- --- Distinctive features: create_post's validation, verbatim ---------------
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

  -- --- Apply (one transaction) ------------------------------------------------
  -- SAFETY: the column list names ONLY the editable descriptive fields.
  -- user_id, verification_state, id and created_at are absent and unwritable here.
  update public.vehicles set
    plate       = v_plate,
    make        = p_make,
    model       = p_model,
    colour      = p_colour,
    colour_note = nullif(btrim(p_colour_note), ''),
    year       = p_year,
    body_type  = p_body_type,
    nickname   = v_nickname,
    updated_at = now()
  where id = p_vehicle_id;

  -- Full replace of the child rows, SCOPED to this vehicle (never a post's rows).
  delete from public.vehicle_photos where vehicle_id = p_vehicle_id;
  if v_photo_count > 0 then
    insert into public.vehicle_photos (vehicle_id, url, position)
    select p_vehicle_id, u.url, (u.ord - 1)::int
    from unnest(p_photo_urls) with ordinality as u(url, ord);
  end if;

  delete from public.vehicle_distinctive_feature where vehicle_id = p_vehicle_id;
  insert into public.vehicle_distinctive_feature (vehicle_id, photo_url, description, position)
  select p_vehicle_id,
         elem.value ->> 'photo_url',
         btrim(elem.value ->> 'description'),
         (elem.ord - 1)::int
  from jsonb_array_elements(v_features) with ordinality as elem(value, ord);

  return jsonb_build_object('vehicle_id', p_vehicle_id);
end;
$$;

comment on function public.update_vehicle(uuid, text, text, text, text, text, int, text, text, text[], jsonb) is
  'Full-replace edit of one OWN garage vehicle. SECURITY DEFINER, owner-pinned (user_id = auth.uid()) and FOR UPDATE locked; absent-or-not-yours is one opaque VEHICLE_NOT_FOUND (no existence oracle). Writes only the descriptive columns + updated_at — never user_id, verification_state, id or created_at — and full-replaces vehicle_photos / vehicle_distinctive_feature SCOPED to this vehicle. Same validation and raise codes as add_vehicle (MISSING_REQUIRED, INVALID_PLATE, PLATE_ALREADY_SAVED [per-user, excluding self], PHOTO_COUNT 0-6, INVALID_PHOTO_URL, DISTINCTIVE_FEATURES_COUNT, INVALID_DISTINCTIVE_FEATURE, INVALID_DISTINCTIVE_PHOTO_URL, NOT_AUTHENTICATED). Cannot alter any post: posts hold their own snapshot.';


-- =============================================================================
-- 7. RPC: delete_vehicle(uuid) -> jsonb
-- =============================================================================
-- Removes one saved vehicle the caller OWNS. Children cascade; any post created
-- from it keeps its full snapshot and simply has vehicle_id set to NULL (§4).
--
-- SAFETY (Tier 1): SECURITY DEFINER (bypasses RLS). Owner-pinned + FOR UPDATE;
--   absent-or-not-yours is the same opaque VEHICLE_NOT_FOUND as update_vehicle.
--
-- THE ACTIVE-POST GATE: deletion is REFUSED (VEHICLE_HAS_ACTIVE_POST) while any
--   post created from this vehicle is in an OPEN state —
--   'active' (live, escrow held, spotters looking),
--   'pending_verification' (retired but still tolerated — a legacy row could sit
--     here, and stranding it would be worse than refusing the delete), or
--   'recovery_claimed' (mid-payout: the owner is choosing the winning sighting).
--   This is NOT because the post needs the vehicle row (it does not — see §4).
--   It is a deliberate product/UX guard: the garage is where an owner manages
--   "my cars", and quietly deleting a car that currently has a LIVE stolen-car
--   listing and a HELD bounty against it is not something to do by accident. The
--   correct order is: deal with the listing (deactivate/refund, or complete the
--   recovery), then delete the car. Closed states (recovered, recovered_no_spotter,
--   cancelled, expired, rejected, and unpaid drafts) do NOT block deletion.
create or replace function public.delete_vehicle(p_vehicle_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_owner   uuid := auth.uid();
  v_vehicle public.vehicles%rowtype;
begin
  if v_owner is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  -- SAFETY: own + locked, else ONE opaque code (no existence oracle).
  select * into v_vehicle
  from public.vehicles v
  where v.id = p_vehicle_id
    and v.user_id = v_owner
  for update;
  if not found then
    raise exception 'VEHICLE_NOT_FOUND';
  end if;

  -- The open-listing guard (see the block comment above). Served by
  -- posts_vehicle_id_idx.
  if exists (
    select 1
    from public.posts p
    where p.vehicle_id = p_vehicle_id
      and p.status = any(array['active', 'pending_verification', 'recovery_claimed']::public.post_status[])
  ) then
    raise exception 'VEHICLE_HAS_ACTIVE_POST';
  end if;

  -- vehicle_photos + vehicle_distinctive_feature cascade. Any post created from
  -- this vehicle keeps EVERY field and child row it captured at posting time;
  -- only its provenance pointer goes NULL (ON DELETE SET NULL, §4).
  delete from public.vehicles where id = p_vehicle_id;

  return jsonb_build_object('vehicle_id', p_vehicle_id, 'deleted', true);
end;
$$;

comment on function public.delete_vehicle(uuid) is
  'Deletes one OWN garage vehicle. SECURITY DEFINER, owner-pinned and FOR UPDATE locked; absent-or-not-yours is one opaque VEHICLE_NOT_FOUND. REFUSES with VEHICLE_HAS_ACTIVE_POST while any post made from this vehicle is active / pending_verification / recovery_claimed (a deliberate guard against silently deleting a car that has a live listing and held escrow — not a data dependency). Otherwise deletes: vehicle_photos and vehicle_distinctive_feature cascade, and posts.vehicle_id goes NULL via ON DELETE SET NULL with the post''s own snapshot fully intact. Also raises NOT_AUTHENTICATED.';


-- =============================================================================
-- 8. RPC: list_my_vehicles() -> jsonb
-- =============================================================================
-- Returns the CALLER's garage as a JSON array, newest saved first (created_at
-- desc). Each element carries the vehicle's fields plus:
--   'photos'              — [{url, position}] ordered by position ([] when none)
--   'distinctive_features'— [{photo_url, description, position}] ordered by position
--   'is_currently_posted' — true when a post made from this vehicle is in an open
--                           state (active / pending_verification / recovery_claimed)
--   'active_post_id'      — that post's id, else null. Lets the client say "this
--                           car is already listed" and deep-link to the listing
--                           instead of offering a duplicate post.
--
-- SAFETY (Tier 1 — read before editing): SECURITY DEFINER, so RLS is BYPASSED
--   and vehicles_select_own DOES NOT protect the read below. `v.user_id =
--   v_viewer` is the SOLE ownership gate for the vehicles AND (via the correlated
--   subqueries) for their photos and features. Never weaken it and never rely on
--   RLS to backstop it. No caller identity -> empty array; NEVER fall through to
--   "all rows" (that would dump every user's saved cars and plates — the exact
--   "who owns which car" index this feature must not create, §2/§3).
--   active_post_id is scoped to posts made from THIS caller's own vehicle, so it
--   cannot expose another user's post.
--
-- auth.uid() reads the CALLER's JWT claim (a request GUC), so it identifies the
-- caller even though the body runs as the definer. STABLE: reads only.
create or replace function public.list_my_vehicles()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_viewer uuid := auth.uid();
  v_result jsonb;
begin
  -- SAFETY: no caller identity -> nothing. Never fall through to "all rows".
  if v_viewer is null then
    return '[]'::jsonb;
  end if;

  select coalesce(jsonb_agg(t.item order by t.created_at desc), '[]'::jsonb)
    into v_result
  from (
    select
      v.created_at,
      jsonb_build_object(
        'id',                 v.id,
        'plate',              v.plate,
        'make',               v.make,
        'model',              v.model,
        'colour',             v.colour,
        'colour_note',        v.colour_note,
        'year',               v.year,
        'body_type',          v.body_type,
        'nickname',           v.nickname,
        -- Dormant today (always 'unverified') — surfaced so the client shape is
        -- already correct if per-vehicle verification is ever re-introduced.
        'verification_state', v.verification_state,
        'created_at',         v.created_at,
        'updated_at',         v.updated_at,

        'photos', coalesce(
          (select jsonb_agg(
                    jsonb_build_object('url', ph.url, 'position', ph.position)
                    order by ph.position)
             from public.vehicle_photos ph
            where ph.vehicle_id = v.id),
          '[]'::jsonb),

        'distinctive_features', coalesce(
          (select jsonb_agg(
                    jsonb_build_object(
                      'photo_url',   df.photo_url,
                      'description', df.description,
                      'position',    df.position)
                    order by df.position)
             from public.vehicle_distinctive_feature df
            where df.vehicle_id = v.id),
          '[]'::jsonb),

        -- Open-listing flags. Same status set as delete_vehicle's guard, so the
        -- UI can grey out "delete" for exactly the vehicles that would refuse.
        -- If somehow more than one open post points here, take the newest.
        'is_currently_posted', (op.id is not null),
        'active_post_id',      op.id
      ) as item
    from public.vehicles v
    left join lateral (
      select p.id
      from public.posts p
      where p.vehicle_id = v.id
        and p.status = any(array['active', 'pending_verification', 'recovery_claimed']::public.post_status[])
      order by p.created_at desc
      limit 1
    ) op on true
    where v.user_id = v_viewer   -- SAFETY: caller's OWN vehicles ONLY.
  ) t;

  return v_result;
end;
$$;

comment on function public.list_my_vehicles() is
  'Returns the caller''s garage as a JSON array, newest saved first (created_at desc). Each element carries the vehicle fields (incl. the dormant verification_state) plus "photos" and "distinctive_features" ordered by position, and "is_currently_posted"/"active_post_id" derived from a post made from this vehicle in active / pending_verification / recovery_claimed. SECURITY DEFINER (bypasses RLS): user_id = auth.uid() is the ONLY ownership gate. Anon -> [].';


-- =============================================================================
-- 9. FUNCTION GRANTS
-- =============================================================================
-- SAFETY: functions default to EXECUTE granted to PUBLIC, and Supabase's ALTER
-- DEFAULT PRIVILEGES re-grants anon at CREATE time. Lock BOTH down and grant
-- deliberately to authenticated + service_role ONLY. anon gets NOTHING on any of
-- these — a garage is inherently a signed-in, owner-scoped surface, and the
-- 20260713191000 incident class is why anon must be GRANT-denied, not merely
-- body-denied (the NOT_AUTHENTICATED / empty-array guards inside are a backstop,
-- not the control).
revoke execute on function public.add_vehicle(text, text, text, text, text, int, text, text, text[], jsonb) from public;
revoke execute on function public.add_vehicle(text, text, text, text, text, int, text, text, text[], jsonb) from anon;
grant  execute on function public.add_vehicle(text, text, text, text, text, int, text, text, text[], jsonb) to authenticated, service_role;

revoke execute on function public.update_vehicle(uuid, text, text, text, text, text, int, text, text, text[], jsonb) from public;
revoke execute on function public.update_vehicle(uuid, text, text, text, text, text, int, text, text, text[], jsonb) from anon;
grant  execute on function public.update_vehicle(uuid, text, text, text, text, text, int, text, text, text[], jsonb) to authenticated, service_role;

revoke execute on function public.delete_vehicle(uuid) from public;
revoke execute on function public.delete_vehicle(uuid) from anon;
grant  execute on function public.delete_vehicle(uuid) to authenticated, service_role;

revoke execute on function public.list_my_vehicles() from public;
revoke execute on function public.list_my_vehicles() from anon;
grant  execute on function public.list_my_vehicles() to authenticated, service_role;


-- =============================================================================
-- END OF MIGRATION
-- =============================================================================

-- =============================================================================
-- WHAT:  Post-detail feature database layer. Adds four descriptive columns to
--        public.posts (year, body_type, distinguishing_features, owner_note);
--        creates public.post_photos (the hero-carousel image rows) with
--        deny-by-default RLS whose SELECT policies mirror the posts visibility
--        rules; and creates the SECURITY DEFINER RPC public.get_post_detail(),
--        which returns a single post's full detail to viewers who may see it and
--        a MINIMAL, leak-free stub to everyone else.
-- WHY:   The post-detail screen needs one server call that (a) resolves whether
--        the caller may see this post at all and (b) returns everything the
--        screen renders (core summary + the new descriptive fields + exact
--        last-seen coordinates + ordered photos + a dormant sighting-count
--        aggregate). Composed server-side so the client never assembles a
--        safety-sensitive query and never receives fields it must not see.
-- LINKS: docs/DOMAIN.md (post lifecycle; draft fields incl. photos, body type,
--          distinguishing features, owner note),
--        docs/SECURITY_AND_TRUST.md §2 (nothing public before verification;
--          closed posts hidden from search), §6 (RLS deny-by-default; SECURITY
--          DEFINER hardening; status server-only),
--        supabase/migrations/20260707110712_payments_foundation.sql (posts,
--          post_status enum, RLS + column-grant house patterns),
--        supabase/migrations/20260711130000_home_feed_location_and_rpcs.sql
--          (home_feed_post_json helper; RPC hardening pattern),
--        supabase/migrations/20260711190000_map_viewport_rpc.sql (SECURITY
--          DEFINER + ST_Y/ST_X coordinate-merge idiom copied here).
--
-- SAFETY NOTE ON DESTRUCTIVE STATEMENTS: none. Fully additive — ALTER TABLE ...
--        ADD COLUMN, one new table + index, new RLS policies + grants, and one
--        new function + grant. No drop/rename/truncate of any existing object.
-- =============================================================================


-- =============================================================================
-- 1. POSTS: new descriptive columns
-- =============================================================================
-- Additive and NULLABLE: the posting wizard that captures these does not write
-- them yet, and existing rows predate them. All four are owner-authored free
-- text / a year, shown on the detail screen. They are NOT lifecycle- or
-- money-adjacent, so (unlike status/expires_at/recovered_at) they will join the
-- client draft column grants in the posting-wizard migration; that grant is
-- deliberately deferred here to keep this migration read-path-only for posts.
alter table public.posts
  -- Model year. CHECK bounds it to a sane range so a client cannot pad a huge
  -- integer; NULL allowed (unknown / not yet captured).
  add column year int
    constraint posts_year_range_chk
      check (year is null or year between 1900 and 2100),

  -- Body style label ("Hatchback", "SUV", "Saloon"). Short bounded text.
  add column body_type text
    constraint posts_body_type_len_chk
      check (char_length(body_type) <= 40),

  -- Free-text distinguishing marks (dents, stickers, alloys, etc.). Bounded so
  -- a client cannot pad an unbounded blob into the detail payload.
  add column distinguishing_features text
    constraint posts_distinguishing_features_len_chk
      check (char_length(distinguishing_features) <= 500),

  -- Longer owner note / appeal shown on the detail screen. Bounded.
  add column owner_note text
    constraint posts_owner_note_len_chk
      check (char_length(owner_note) <= 2000);

comment on column public.posts.year is
  'Model year (nullable). CHECK 1900–2100. Owner-authored; shown on post detail. Not yet in the client draft grant (posting-wizard migration adds it).';
comment on column public.posts.body_type is
  'Body style label e.g. Hatchback/SUV/Saloon (nullable, <= 40 chars). Owner-authored; shown on post detail.';
comment on column public.posts.distinguishing_features is
  'Free-text distinguishing marks (nullable, <= 500 chars). Owner-authored; shown on post detail.';
comment on column public.posts.owner_note is
  'Owner note / appeal (nullable, <= 2000 chars). Owner-authored; shown on post detail.';


-- =============================================================================
-- 2. TABLE: post_photos
-- Ordered image rows for a post's hero carousel.
-- =============================================================================
create table public.post_photos (
  id         uuid primary key default gen_random_uuid(),

  -- The post these photos belong to. ON DELETE CASCADE: photos are wholly owned
  -- by their post and carry no independent value or money state, so when a post
  -- row is removed its photos go with it (contrast payments' ON DELETE RESTRICT).
  post_id    uuid not null references public.posts (id) on delete cascade,

  -- Public URL of the stored image (Storage object). EXIF is stripped server-
  -- side before an image is exposed (SECURITY_AND_TRUST §... photos/EXIF).
  url        text not null,

  -- Display order within the carousel; 0-based. CHECK keeps it non-negative.
  position   int not null default 0 check (position >= 0),

  created_at timestamptz not null default now()
);

comment on table public.post_photos is
  'Ordered hero-carousel images for a post. Visibility mirrors the parent post (see RLS below). Writes come later via the posting flow / service role — no client write policy exists.';

-- Index for the hot read: fetch a post''s photos in display order. Also covers
-- the post_id equality used by both RLS SELECT policies below.
create index post_photos_post_id_position_idx
  on public.post_photos (post_id, position);

alter table public.post_photos enable row level security;

-- SAFETY: under this project''s config (auto_expose_new_tables unset in
-- config.toml) a new public table auto-grants NO data privileges, so the SELECT
-- policies below are dead without an explicit table-level SELECT grant. Grant
-- SELECT to anon + authenticated (a photo is exactly as visible as its post, and
-- active posts are public to anon under posts_select_active_public). NO
-- insert/update/delete grant to clients — writes are service-role / posting-flow
-- only. service_role bypasses RLS but is not auto-granted, so give it full DML.
grant select on public.post_photos to anon, authenticated;
grant select, insert, update, delete on public.post_photos to service_role;

-- SAFETY (anti-stalking, mirrors posts_select_active_public): anyone (incl. anon)
-- may read a photo ONLY when its parent post is 'active'. No photo of a draft /
-- pending / recovered / cancelled / etc. post is ever publicly readable.
create policy post_photos_select_active_public
  on public.post_photos
  for select
  to anon, authenticated
  using (
    exists (
      select 1 from public.posts p
      where p.id = post_photos.post_id
        and p.status = 'active'
    )
  );

-- SAFETY (mirrors posts_select_own): an owner may read the photos of their OWN
-- post in ANY status (so they can review a draft/closed post's images).
create policy post_photos_select_own
  on public.post_photos
  for select
  to authenticated
  using (
    exists (
      select 1 from public.posts p
      where p.id = post_photos.post_id
        and p.owner_id = (select auth.uid())
    )
  );

-- SAFETY: NO insert/update/delete policy exists -> those are denied by default
-- for anon/authenticated. Photo writes arrive with the posting-flow migration
-- (owner-own-draft policies) or run under the service role. Do not add a client
-- write policy here without reviewing SECURITY_AND_TRUST.md §6.


-- =============================================================================
-- 3. RPC: get_post_detail(post_id) -> jsonb
-- =============================================================================
-- Returns ONE post's detail for the post-detail screen. The shape depends on
-- visibility:
--   * not found      -> { "found": false }
--   * found, hidden  -> { "found": true, "visible": false, "closedReason": ... }
--                       (a MINIMAL stub — no make/model/plate/location/owner_id)
--   * found, visible -> the full detail object (see the visible branch below).
--
-- SAFETY (Tier 1 — read before editing anything below):
--   This function is SECURITY DEFINER, so it BYPASSES RLS. The
--   posts_select_active_public / _own policies DO NOT protect the reads here.
--   The v_visible predicate ('active' OR caller owns it) is the ONLY gate that
--   decides what a caller sees — NEVER rely on RLS to backstop it. When NOT
--   visible we return the leak-free stub: only the recovered/unavailable
--   distinction, never the fine status, make/model, plate, location, photos, or
--   the owner's uuid, of a non-active post to a non-owner (anti-stalking,
--   SECURITY_AND_TRUST §2: closed posts are hidden from search).
--
-- SAFETY (auth.uid under SECURITY DEFINER): auth.uid() reads the CALLER's JWT
--   claim (a request GUC), not the function owner, so it correctly identifies
--   the caller even though the body runs as the definer. It is schema-qualified
--   (auth.uid()) so it resolves regardless of the search_path below.
--
-- SAFETY (never leak owner_id): the visible payload returns 'is_owner' (a bool),
--   NOT owner_id — the owner's uuid must never reach any client.
--
-- search_path fixed to public, extensions so the PostGIS operators (ST_X/ST_Y)
-- resolve whether PostGIS is installed into public (fresh local) or the
-- extensions schema (Supabase-hosted). STABLE: reads only, no writes.
create or replace function public.get_post_detail(p_post_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  -- The CALLER's uid (null for anon). Works under SECURITY DEFINER — reads the
  -- caller's JWT claim, not the definer role. See the SAFETY note above.
  v_viewer  uuid := auth.uid();
  v_post    public.posts%rowtype;
  v_visible boolean;
begin
  -- Load the post. `found` is set by the INTO; a missing id -> leak-free stub.
  select * into v_post from public.posts p where p.id = p_post_id;
  if not found then
    return jsonb_build_object('found', false);
  end if;

  -- SAFETY: the ONLY visibility gate (RLS is bypassed here). Visible iff the
  -- post is publicly 'active', or the caller is its owner.
  v_visible := (v_post.status = 'active')
               or (v_viewer is not null and v_post.owner_id = v_viewer);

  -- -------------------------------------------------------------------------
  -- NOT VISIBLE: minimal, leak-free stub. Only the recovered/unavailable
  -- distinction escapes — never the fine status, car identity, plate,
  -- location, photos, or owner_id.
  -- -------------------------------------------------------------------------
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

  -- -------------------------------------------------------------------------
  -- VISIBLE: full detail. Reuse the shared summary shape for the core fields,
  -- then merge in the detail-only fields. `visible` means the post is active
  -- (its location is already public under RLS) OR the caller owns it, so exact
  -- coordinates are safe to return here.
  -- -------------------------------------------------------------------------
  return public.home_feed_post_json(v_post, null::numeric)
    || jsonb_build_object(
         'found',    true,
         'visible',  true,
         -- SAFETY: expose is_owner, NEVER owner_id itself.
         'is_owner', (v_post.owner_id is not null and v_post.owner_id = v_viewer),

         'year',                    v_post.year,
         'body_type',               v_post.body_type,
         'distinguishing_features', v_post.distinguishing_features,
         'owner_note',              v_post.owner_note,

         -- Exact last-seen coordinates (null-safe if no location captured).
         -- ST_Y = latitude, ST_X = longitude.
         'lat', case when v_post.last_seen_location is not null
                     then ST_Y(v_post.last_seen_location::geometry) end,
         'lng', case when v_post.last_seen_location is not null
                     then ST_X(v_post.last_seen_location::geometry) end,

         -- Ordered photos for the hero carousel ([] when none).
         'photos', coalesce(
           (select jsonb_agg(
                     jsonb_build_object('url', ph.url, 'position', ph.position)
                     order by ph.position)
              from public.post_photos ph
             where ph.post_id = v_post.id),
           '[]'::jsonb),

         -- DORMANT AGGREGATE. There is no sightings table yet; a later
         -- sightings-feature migration replaces this 0/null with a real
         -- aggregate. SAFETY: this returns a SCALAR count + latest timestamp
         -- ONLY and MUST NEVER be widened to return individual sighting rows or
         -- sighting locations to a non-owner (SECURITY_AND_TRUST §... sightings:
         -- public sees none). Owner-vs-non-owner scoping of the future real
         -- aggregate must be added when the sightings table lands.
         'sighting_stats', jsonb_build_object('count', 0, 'latest_at', null)
       );
end;
$$;

comment on function public.get_post_detail(uuid) is
  'Returns one post''s detail for the post-detail screen. SECURITY DEFINER (bypasses RLS); the active-OR-owner predicate is the ONLY visibility gate. Non-visible -> minimal { found, visible:false, closedReason } stub (no make/model/plate/location/owner_id). Visible -> full detail incl. exact coords, ordered photos, is_owner (never owner_id), and a DORMANT scalar sighting_stats.';


-- =============================================================================
-- 4. FUNCTION GRANT
-- =============================================================================
-- SAFETY: functions default to EXECUTE granted to PUBLIC. Lock that down and
-- grant deliberately, matching the home-feed / viewport RPCs: anon (logged-out
-- browse of active posts is already permitted by posts_select_active_public) +
-- authenticated + service_role. Non-visible callers still only get the stub.
revoke execute on function public.get_post_detail(uuid) from public;
grant  execute on function public.get_post_detail(uuid)
  to anon, authenticated, service_role;


-- =============================================================================
-- END OF MIGRATION
-- =============================================================================

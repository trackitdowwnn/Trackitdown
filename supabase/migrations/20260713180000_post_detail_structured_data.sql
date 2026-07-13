-- =============================================================================
-- WHAT:  Part-2 structured data for the post-detail screen. Adds a curated
--        vehicle-feature TAXONOMY (public.vehicle_feature reference list +
--        public.post_feature join), four new descriptive/structured columns on
--        public.posts (stolen_from, keys_taken, desc_recognise, desc_drives),
--        and widens public.get_post_detail() to surface all of the above —
--        INCLUDING a new anti-stalking rule that COARSENS the last-seen point
--        for driveway thefts when the caller is not the owner.
-- WHY:   The post-detail screen gains a "features" chip grid (dents, roof rack,
--        tinted windows, private plate, dashcam, …), a "where/how it was taken"
--        block (stolen_from, keys_taken), and two free-text appeals
--        (desc_recognise = "how you'd recognise it", desc_drives = "how it
--        drives / anything odd"). A driveway theft's last-seen point IS the
--        victim's HOME address, so it must not be pinpointed to strangers.
-- LINKS: docs/DOMAIN.md (post lifecycle; draft fields; owner-identity block),
--        docs/SECURITY_AND_TRUST.md §1 (identity minimisation / anti-stalking),
--          §2 (nothing public before verification), §6 (RLS deny-by-default;
--          SECURITY DEFINER hardening; status server-only),
--        supabase/migrations/20260707110712_payments_foundation.sql (posts,
--          post_status enum, RLS + column-grant house patterns),
--        supabase/migrations/20260711130000_home_feed_location_and_rpcs.sql
--          (home_feed_post_json helper; the recovered-post coordinate-coarsening
--           idiom ST_SnapToGrid(location::geometry, 0.01) reused below),
--        supabase/migrations/20260713140000_post_detail.sql (post_photos: the
--          RLS-mirrors-post-visibility pattern reused for post_feature),
--        supabase/migrations/20260713170000_post_detail_owner_no_avatar_path.sql
--          (the CURRENT get_post_detail this migration CREATE-OR-REPLACEs).
--
-- SAFETY NOTE ON DESTRUCTIVE STATEMENTS: NONE. Fully additive — two new tables
--        + indexes + RLS + grants, reference-data seed (idempotent), four
--        ALTER TABLE ... ADD COLUMN, and one CREATE OR REPLACE FUNCTION. No
--        drop / rename / truncate of any existing object.
--
-- =============================================================================
-- !!! REQUIRED FOLLOW-UP (DO NOT SHIP DRIVEWAY THEFTS WITHOUT IT) !!!
-- This migration coarsens the driveway last-seen point in get_post_detail ONLY.
-- The SAME coarsening MUST be applied to the map + feed RPCs before ANY real
-- stolen_from='driveway' post goes live, or the exact HOME point leaks there:
--     * public.get_posts_in_viewport   (map pins)
--     * public.get_home_feed           (near_you / area / highest_bounties)
--     * public.get_nearby_posts        (map hero list pagination)
-- Those RPCs currently return / match on the EXACT active-post point. Tracked as
-- a hard blocker for the driveway-theft posting flow — NOT implemented here.
-- =============================================================================


-- =============================================================================
-- 1. TABLE: vehicle_feature  (static reference taxonomy)
-- =============================================================================
-- The curated list of vehicle "features" a post can be tagged with (bodywork
-- damage, add-ons, identity marks, mods, …). Reference data: seeded below, read
-- by everyone, never written by clients.
create table public.vehicle_feature (
  -- Stable machine key (e.g. 'roof_rack'). Referenced by post_feature.
  key        text primary key,
  -- Human label shown on the chip (e.g. 'Roof rack').
  label      text not null,
  -- Grouping header on the detail screen (e.g. 'Add-ons').
  category   text not null,
  -- Feather icon name for the chip glyph (client renders <Feather name={icon}/>).
  icon       text not null,
  -- Display order across the whole list (jsonb_agg in get_post_detail sorts by it).
  sort_order int not null default 0
);

comment on table public.vehicle_feature is
  'Static reference taxonomy of vehicle features (chips on the post-detail screen). Public SELECT; no client writes — seeded in-migration and maintained by service role.';

alter table public.vehicle_feature enable row level security;

-- SAFETY: under this project''s config (auto_expose_new_tables unset in
-- config.toml) a new public table auto-grants NO data privileges, so the SELECT
-- policy below is dead without an explicit table-level SELECT grant. This is a
-- static, non-sensitive reference list, so grant SELECT to anon + authenticated
-- (an anon browser of active posts must render the same chips). NO client
-- insert/update/delete — the taxonomy is seeded here and curated by service_role.
grant select on public.vehicle_feature to anon, authenticated;
grant select, insert, update, delete on public.vehicle_feature to service_role;

-- SAFETY: public, non-sensitive reference list — anyone (incl. anon) may read
-- every row. No write policy exists, so writes are denied by default.
create policy vehicle_feature_select_all
  on public.vehicle_feature
  for select
  to anon, authenticated
  using (true);


-- =============================================================================
-- 2. TABLE: post_feature  (post <-> feature join)
-- =============================================================================
-- Which taxonomy features a given post is tagged with. Visibility MIRRORS the
-- parent post exactly (same pattern as post_photos in 20260713140000).
create table public.post_feature (
  -- The tagged post. ON DELETE CASCADE: a feature tag is wholly owned by its
  -- post and carries no independent/money state, so it dies with the post
  -- (matches post_photos; contrast payments'' ON DELETE RESTRICT).
  post_id     uuid not null references public.posts (id) on delete cascade,
  -- The taxonomy key. ON DELETE RESTRICT: never silently drop tags by deleting a
  -- reference row — retiring a taxonomy key must be a deliberate migration that
  -- first clears its usages.
  feature_key text not null references public.vehicle_feature (key) on delete restrict,
  -- One tag per (post, feature). The PK''s leading column (post_id) also serves
  -- the by-post lookup used by both RLS policies and get_post_detail.
  primary key (post_id, feature_key)
);

comment on table public.post_feature is
  'Join of posts to vehicle_feature. Visibility mirrors the parent post (RLS below). No client writes yet — populated by the posting flow / service role.';

-- Reverse lookup for a FUTURE "filter posts by feature" search (the composite PK
-- already covers the by-post direction). Kept now so the search migration is
-- purely additive.
create index post_feature_feature_key_idx
  on public.post_feature (feature_key);

alter table public.post_feature enable row level security;

-- SAFETY: as with post_photos, no data privilege is auto-granted, so grant
-- table-level SELECT to anon + authenticated (a tag is exactly as visible as its
-- post; active posts are public to anon). NO client insert/update/delete — tags
-- are written by the posting flow / service role. service_role bypasses RLS but
-- is not auto-granted, so give it full DML.
grant select on public.post_feature to anon, authenticated;
grant select, insert, update, delete on public.post_feature to service_role;

-- SAFETY (anti-stalking, mirrors posts_select_active_public / post_photos): anyone
-- (incl. anon) may read a tag ONLY when its parent post is 'active'. No tag of a
-- draft / pending / recovered / cancelled post is ever publicly readable.
create policy post_feature_select_active_public
  on public.post_feature
  for select
  to anon, authenticated
  using (
    exists (
      select 1 from public.posts p
      where p.id = post_feature.post_id
        and p.status = 'active'
    )
  );

-- SAFETY (mirrors posts_select_own / post_photos): an owner may read the tags of
-- their OWN post in ANY status (so they can review a draft/closed post''s chips).
create policy post_feature_select_own
  on public.post_feature
  for select
  to authenticated
  using (
    exists (
      select 1 from public.posts p
      where p.id = post_feature.post_id
        and p.owner_id = (select auth.uid())
    )
  );

-- SAFETY: NO insert/update/delete policy -> denied by default for clients. Tag
-- writes arrive with the posting-flow migration (owner-own-draft) or run under
-- the service role. Do not add a client write policy without reviewing
-- SECURITY_AND_TRUST.md §6.


-- =============================================================================
-- 3. SEED: vehicle_feature  (reference data — belongs in the migration)
-- =============================================================================
-- Curated ~20-item taxonomy grouped by category. Idempotent
-- (ON CONFLICT (key) DO NOTHING) so re-applying is safe. icon values are valid
-- Feather icon names. This is REFERENCE data (not dev-only seed), hence it lives
-- in the migration rather than supabase/seed.sql.
insert into public.vehicle_feature (key, label, category, icon, sort_order) values
  -- Bodywork ------------------------------------------------------------------
  ('dent',               'Dents',              'Bodywork',       'alert-circle',   10),
  ('deep_scratch',       'Deep scratches',     'Bodywork',       'slash',          20),
  ('rust',               'Rust',               'Bodywork',       'droplet',        30),
  ('mismatched_panel',   'Mismatched panel',   'Bodywork',       'grid',           40),
  ('cracked_windscreen', 'Cracked windscreen', 'Bodywork',       'alert-octagon',  50),
  -- Add-ons -------------------------------------------------------------------
  ('roof_rack',          'Roof rack',          'Add-ons',        'layers',         60),
  ('roof_box',           'Roof box',           'Add-ons',        'package',        70),
  ('tow_bar',            'Tow bar',            'Add-ons',        'link',           80),
  ('bike_rack',          'Bike rack',          'Add-ons',        'anchor',         90),
  -- Glass & wheels ------------------------------------------------------------
  ('tinted_windows',     'Tinted windows',     'Glass & wheels', 'eye-off',       100),
  ('aftermarket_alloys', 'Aftermarket alloys', 'Glass & wheels', 'disc',          110),
  -- Identity ------------------------------------------------------------------
  ('private_plate',      'Private plate',      'Identity',       'hash',          120),
  ('plate_surround',     'Plate surround',     'Identity',       'square',        130),
  ('window_stickers',    'Window stickers',    'Identity',       'tag',           140),
  ('debadged',           'Debadged',           'Identity',       'minus',         150),
  -- Interior ------------------------------------------------------------------
  ('dashcam',            'Dashcam',            'Interior',       'camera',        160),
  ('child_seat',         'Child seat',         'Interior',       'shield',        170),
  -- Mods ----------------------------------------------------------------------
  ('modified_exhaust',   'Modified exhaust',   'Mods',           'wind',          180),
  ('lowered_lifted',     'Lowered / lifted',   'Mods',           'sliders',       190),
  ('body_kit',           'Body kit',           'Mods',           'tool',          200),
  ('spotlights',         'Spotlights',         'Mods',           'sun',           210)
on conflict (key) do nothing;


-- =============================================================================
-- 4. POSTS: new structured columns
-- =============================================================================
-- Additive and NULLABLE: the posting wizard that captures these is not built
-- yet and existing rows predate them. Like the 20260713140000 descriptive
-- fields, these are owner-authored and NOT lifecycle-/money-adjacent, so they
-- will join the client draft column grants in the posting-wizard migration; that
-- grant is deliberately deferred here to keep this migration read-path-only.
alter table public.posts
  -- Where the car was taken from. Constrained set (drives the detail UI + the
  -- driveway home-coarsening rule below). NULL = not captured.
  add column stolen_from text
    constraint posts_stolen_from_chk
      check (stolen_from is null
             or stolen_from in ('driveway','street','car_park','other')),

  -- Were the keys taken too. Constrained set. NULL = not captured / unknown.
  add column keys_taken text
    constraint posts_keys_taken_chk
      check (keys_taken is null
             or keys_taken in ('yes','no','unknown')),

  -- Free-text "how you'd recognise it" appeal. Bounded so a client cannot pad an
  -- unbounded blob into the detail payload.
  add column desc_recognise text
    constraint posts_desc_recognise_len_chk
      check (char_length(desc_recognise) <= 1000),

  -- Free-text "how it drives / anything odd about it" appeal. Bounded.
  add column desc_drives text
    constraint posts_desc_drives_len_chk
      check (char_length(desc_drives) <= 1000);

comment on column public.posts.stolen_from is
  'Where taken: driveway|street|car_park|other (nullable). SAFETY: stolen_from=''driveway'' means the last-seen point is the victim''s HOME — get_post_detail coarsens it to a ~1km grid for non-owners (and the map/feed RPCs MUST do the same before driveway posts go live).';
comment on column public.posts.keys_taken is
  'Whether the keys were taken: yes|no|unknown (nullable). Owner-authored; shown on post detail.';
comment on column public.posts.desc_recognise is
  'Free-text "how you would recognise it" appeal (nullable, <= 1000 chars). Owner-authored; shown on post detail.';
comment on column public.posts.desc_drives is
  'Free-text "how it drives / anything odd" appeal (nullable, <= 1000 chars). Owner-authored; shown on post detail.';


-- =============================================================================
-- 5. RPC: get_post_detail(post_id) -> jsonb   (CREATE OR REPLACE)
-- =============================================================================
-- Byte-for-byte the 20260713170000 function EXCEPT:
--   * new visible-branch fields: stolen_from, keys_taken, desc_recognise,
--     desc_drives, and features (aggregated from post_feature x vehicle_feature);
--   * the last-seen lat/lng is now COARSENED for driveway thefts shown to a
--     non-owner (see the SAFETY block on the coordinates below).
-- The visibility gate, hidden stub, is_owner coalesce, owner block
-- (first_name + month-truncated member_since; no avatar/owner_id/display_name),
-- expires_at, photos, and the dormant sighting_stats are all unchanged.
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

         'sighting_stats', jsonb_build_object('count', 0, 'latest_at', null)
       );
end;
$$;

comment on function public.get_post_detail(uuid) is
  'Returns one post''s detail for the post-detail screen. SECURITY DEFINER (bypasses RLS); the active-OR-owner predicate is the ONLY visibility gate. Non-visible -> minimal { found, visible:false, closedReason } stub. Visible -> full detail incl. Part-2 structured fields (stolen_from, keys_taken, desc_recognise, desc_drives), features[], ordered photos, is_owner (never owner_id), owner block (first_name/month member_since), and a DORMANT scalar sighting_stats. SAFETY: a driveway theft''s last-seen point is coarsened to a ~1km grid for non-owners.';

revoke execute on function public.get_post_detail(uuid) from public;
grant  execute on function public.get_post_detail(uuid)
  to anon, authenticated, service_role;


-- =============================================================================
-- END OF MIGRATION
-- =============================================================================

-- =============================================================================
-- WHAT: Closes the seven database leads from security audit run 1 that a
--       read-only check of production (2026-10-26) showed are live:
--
--         1. Feed membership read the EXACT driveway point.
--         2. A driveway theft's street-level label was public.
--         3. A listing's owner_id was readable by anyone signed out.
--         4. Any signed-in user could read every column of every profile.
--         5. A paid £5 fee put a draft live with a reward set AFTER the fee.
--         6. claim_recovery bumped recoveries_credited with no collusion check.
--         7. register_push_token took any string, without limit.
--
-- WHY / HOW, per lead:
--
--   1. get_home_feed / get_nearby_posts tested ST_DWithin on
--      p.last_seen_location while distance came from post_pin_geog. Whether a
--      known post id came back was a 1-metre membership bit, and a binary
--      search on the radius from three origins found a driveway victim's home.
--      Membership now reads post_pin_geog, the get_area_insights pattern
--      (20260811160000): a padded exact-point line keeps the GiST index, the
--      snapped line decides. 1500 m covers the 0.01° (~1.1 km) snap.
--
--   2. last_seen_area is the reverse-geocoded street/postcode label. For a
--      driveway theft it is the victim's address. Non-owners now get the
--      district (last_seen_locality) instead, or nothing when there is none —
--      the owner's decision, 2026-10-26. One rule, post_public_area, used by
--      home_feed_post_json and the feed's area carousels. The owner's own
--      reads (get_post_detail owner branch, list_my_posts) keep the raw label.
--      Both columns leave the client column grants: every reader is a
--      SECURITY DEFINER RPC, so only PostgREST's direct route closes.
--
--   3. owner_id leaves the ANON column grant only (owner's decision). The
--      authenticated grant stays: five RLS policies on other tables read
--      p.owner_id as the caller, and they are all `to authenticated`.
--
--   4. profiles_select_authenticated was USING (true) on a table-wide grant,
--      so a uid (from owner_id, a photo path, a thread row) turned into a
--      display_name — which may hold a surname. Every cross-user profile read
--      is already a SECURITY DEFINER RPC that returns first_name and counters
--      only, so the table policy narrows to the caller's own row.
--
--   5. mark_post_payment_held's listing-fee branch activated any draft. A
--      draft's bounty stays owner-writable after the fee intent exists, so the
--      fee could put live a listing advertising a reward nobody holds. The
--      branch now activates only a draft that is still a free listing. The fee
--      is still collected; a draft with a reward goes live when the reward is
--      held, as it always did.
--
--   6. claim_recovery now applies mark_sighting_helpful's gate
--      (20260814140000): a shared device or a repeat owner/spotter pair skips
--      the public recoveries_credited bump. The credit itself — and any
--      payout, which has its own collusion gate — is unchanged.
--
--   7. register_push_token now accepts only an Expo token and keeps a user's
--      ten newest. One planted malformed token could fail a whole 100-message
--      Expo request (_shared/push.ts), costing other users their pushes.
--
-- ⚠️ NEXT EDITOR: the live definitions of every function below are THIS file.
--    Each is restated verbatim from its previous latest definition (checked
--    against production by md5 on 2026-10-26) with only the marked edits.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- post_public_area — the area label a post may be shown with, to non-owners.
--
-- Same rule as post_pin_geog: a driveway theft's last-seen point is the
-- victim's home, so its street-level label is never shown; the district is.
-- NULL when a driveway post has no district — never the street as a fallback.
-- -----------------------------------------------------------------------------
create or replace function public.post_public_area(
  p_area        text,
  p_locality    text,
  p_stolen_from text
)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
           when p_stolen_from = 'driveway' then p_locality
           else p_area
         end;
$$;

-- Leads 2 + 3: close PostgREST's direct route. Every RPC that emits these
-- columns is SECURITY DEFINER and unaffected.
revoke select (last_seen_area, last_seen_locality) on public.posts from anon, authenticated;
revoke select (owner_id) on public.posts from anon;

-- Lead 4: a profile row is readable by its owner only. Other people's
-- first_name / counters come from the SECURITY DEFINER RPCs.
drop policy if exists profiles_select_authenticated on public.profiles;
create policy profiles_select_self
  on public.profiles
  for select
  to authenticated
  using (id = (select auth.uid()));


-- -----------------------------------------------------------------------------
-- home_feed_post_json — Lead 2 — the shared card shows the PUBLIC area.
-- -----------------------------------------------------------------------------
create or replace function public.home_feed_post_json(
  p_post           public.posts,
  p_distance_miles numeric
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id',                  p_post.id,
    'plate',               p_post.plate,
    'make',                p_post.make,
    'model',               p_post.model,
    'colour',              p_post.colour,
    'bounty_amount_pence', p_post.bounty_amount_pence,
    -- A lapsed reward (ADR-0020) — distinct from a £5 fee listing, which also
    -- has a null bounty. Both facts, never the stamp alone: see the header.
    'reward_ended',        (p_post.reward_ended_at is not null and p_post.bounty_amount_pence is null),
    'status',              p_post.status,
    'last_seen_at',        p_post.last_seen_at,
    -- SAFETY (AUDIT 2026-10-26, lead 2): the PUBLIC label — a driveway theft
    -- shows its district, never the street. Owner callers override this key.
    'last_seen_area',      public.post_public_area(p_post.last_seen_area,
                                                   p_post.last_seen_locality,
                                                   p_post.stolen_from),
    'distance_miles',      p_distance_miles,   -- null in national mode
    'created_at',          p_post.created_at,
    -- The card thumbnail: first photo by position, shaped as a one-element
    -- array so the client maps it to PostSummary.photos unchanged. A post
    -- with no photos yields NULL from the subquery, coalesced to [] — never
    -- a null key, so the client schema can require an array.
    'photos', coalesce(
      (
        select jsonb_build_array(jsonb_build_object('url', pp.url))
        from public.post_photos pp
        where pp.post_id = p_post.id
        order by pp.position
        limit 1
      ),
      '[]'::jsonb
    )
  );
$$;

-- -----------------------------------------------------------------------------
-- get_home_feed — Leads 1 + 2 — membership on the pin; carousels grouped by the public area.
-- -----------------------------------------------------------------------------
create or replace function public.get_home_feed(
  p_lat      double precision,
  p_lng      double precision,
  p_radius_m integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  -- National / fallback mode when the client has no usable location fix.
  v_national boolean := (p_lat is null or p_lng is null);
  v_origin   geography;
  -- SAFETY: clamp caller radius to 1–50 miles (default 20 miles). 1609 m ≈ 1
  -- mile, 80467 m ≈ 50 miles, 32187 m ≈ 20 miles.
  v_radius   integer := least(greatest(coalesce(p_radius_m, 32187), 1609), 80467);
  -- The caller, or NULL for anon. Read once: auth.uid() parses the request JWT
  -- on every call, and it is referenced from four predicates below.
  v_viewer   uuid := auth.uid();
  v_near      jsonb := '[]'::jsonb;
  v_areas     jsonb := '[]'::jsonb;
  v_highest   jsonb := '[]'::jsonb;
  v_recovered jsonb := '[]'::jsonb;
  v_recent    jsonb := '[]'::jsonb;
  v_sections  jsonb := '[]'::jsonb;
begin
  -- ---------------------------------------------------------------------------
  -- NATIONAL MODE: no location -> only the most recent active posts UK-wide.
  -- ---------------------------------------------------------------------------
  if v_national then
    select coalesce(jsonb_agg(t.j order by t.created_at desc), '[]'::jsonb)
      into v_recent
    from (
      select public.home_feed_post_json(p, null::numeric) as j, p.created_at
      from public.posts p
      where p.status = 'active'                 -- SAFETY: active only
        and p.owner_id is distinct from v_viewer  -- never your own listing
      order by p.created_at desc
      limit 10
    ) t;

    if jsonb_array_length(v_recent) > 0 then
      v_sections := jsonb_build_array(
        jsonb_build_object(
          'id', 'recent_uk', 'title', 'Recent listings across the UK',
          'layout', 'hero-vertical', 'posts', v_recent));
    end if;

    return jsonb_build_object('sections', v_sections);
  end if;

  -- ---------------------------------------------------------------------------
  -- LOCAL MODE. Origin point (note ST_MakePoint takes lng, lat).
  -- ---------------------------------------------------------------------------
  v_origin := ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography;

  -- Build near_you, the area carousels, and highest_bounties from ONE in-radius
  -- active set; recently_recovered scans the recovered window separately (it is
  -- a different status set). Each CTE re-states its status predicate.
  with in_radius as (
    -- Active posts with a location inside the requested radius. `p as post`
    -- keeps the whole row so home_feed_post_json can consume it downstream.
    -- Excluding the viewer HERE covers near_you, the area carousels and
    -- highest_bounties in one place — they all read from this CTE.
    select p as post, ST_Distance(public.post_pin_geog(p.last_seen_location, p.stolen_from), v_origin) as dist,
           -- AUDIT 2026-10-26 (lead 2): the label non-owners may see.
           public.post_public_area(p.last_seen_area, p.last_seen_locality, p.stolen_from) as area
    from public.posts p
    where p.status = 'active'                    -- SAFETY: active only
      and p.last_seen_location is not null
      and p.owner_id is distinct from v_viewer   -- never your own listing
      -- SAFETY (AUDIT 2026-10-26, lead 1): membership reads the SAME point as
      -- distance. On the exact point, a post id's presence was a 1-metre
      -- oracle on a driveway victim's home. Padded line = index pre-filter.
      and ST_DWithin(p.last_seen_location, v_origin, v_radius + 1500)
      and ST_DWithin(public.post_pin_geog(p.last_seen_location, p.stolen_from), v_origin, v_radius)
  ),
  near_you as (
    select coalesce(jsonb_agg(t.j order by t.dist), '[]'::jsonb) as posts
    from (
      select public.home_feed_post_json(ir.post,
               round((ir.dist / 1609.344)::numeric, 1)) as j, ir.dist
      from in_radius ir
      order by ir.dist
      limit 10                                   -- first page; rest via get_nearby_posts
    ) t
  ),
  areas as (
    -- Nearest (min distance) up to 3 localities that have >= 2 in-radius posts.
    select ir.area, min(ir.dist) as min_dist
    from in_radius ir
    where ir.area is not null
    group by ir.area
    having count(*) >= 2
    order by min_dist
    limit 3
  ),
  area_sections as (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id',     'area_' || public.slugify(a.area),
        'title',  'Recently stolen in ' || a.area,
        'layout', 'carousel',
        'area',   a.area,
        'posts',  (
          -- Up to 10 of this locality's in-radius active posts, newest first.
          select coalesce(jsonb_agg(t.j order by t.last_seen_at desc nulls last),
                          '[]'::jsonb)
          from (
            select public.home_feed_post_json(ir.post,
                     round((ir.dist / 1609.344)::numeric, 1)) as j,
                   (ir.post).last_seen_at as last_seen_at
            from in_radius ir
            where ir.area = a.area
            order by (ir.post).last_seen_at desc nulls last
            limit 10
          ) t
        )
      )
      order by a.min_dist
    ), '[]'::jsonb) as sections
    from areas a
  ),
  highest as (
    select coalesce(jsonb_agg(t.j order by t.bounty desc), '[]'::jsonb) as posts
    from (
      select public.home_feed_post_json(ir.post,
               round((ir.dist / 1609.344)::numeric, 1)) as j,
             (ir.post).bounty_amount_pence as bounty
      from in_radius ir
      -- SAFETY (2026-08-20, ADR-0014): a no-reward listing has a NULL bounty and
      -- Postgres sorts NULLs FIRST under DESC — without this predicate they would
      -- take the top slots of a section titled "Highest rewards nearby". Filtered
      -- rather than `nulls last` so the LIMIT below is spent on ten REAL bounties;
      -- ordering alone would still let a no-reward post fill a slot whenever fewer
      -- than ten bounty posts are in radius. Inside the inner query on purpose, so
      -- the filter runs BEFORE the limit rather than shortening the carousel.
      where (ir.post).bounty_amount_pence is not null
      order by (ir.post).bounty_amount_pence desc
      limit 10
    ) t
  ),
  recovered as (
    -- SAFETY (anti-trilateration): unlike active posts (whose exact location is
    -- already public under RLS), a recovered post's precise point is withheld.
    -- Matching + measuring on the EXACT point would leak it back: an anon caller
    -- could vary the origin/radius and read the 0.1-mile distance to trilaterate
    -- the point. So for THIS section only we snap the location to a ~1 km grid
    -- (ST_SnapToGrid on a ~0.01° cell, matching the client's redactLocation
    -- coarseness) and both match AND measure on that snapped point, returning
    -- distance in WHOLE miles. (This also means the GiST index can't serve this
    -- predicate — acceptable: the recovered+30-day set is tiny and narrowed by
    -- posts_recovered_recent_idx first.)
    select coalesce(jsonb_agg(t.j order by t.recovered_at desc), '[]'::jsonb) as posts
    from (
      select public.home_feed_post_json(p,
               round((ST_Distance(
                        ST_SnapToGrid(p.last_seen_location::geometry, 0.01)::geography,
                        v_origin) / 1609.344)::numeric, 0)) as j,
             p.recovered_at
      from public.posts p
      where p.status in ('recovered', 'recovered_no_spotter')  -- SAFETY: recovered only
        and p.recovered_at is not null
        and p.recovered_at >= now() - interval '30 days'       -- SAFETY: 30-day window
        and p.last_seen_location is not null
        and p.owner_id is distinct from v_viewer               -- never your own listing
        and ST_DWithin(
              ST_SnapToGrid(p.last_seen_location::geometry, 0.01)::geography,
              v_origin, v_radius)
      order by p.recovered_at desc
      limit 10
    ) t
  )
  select near_you.posts, area_sections.sections, highest.posts, recovered.posts
    into v_near, v_areas, v_highest, v_recovered
  from near_you, area_sections, highest, recovered;

  -- ---------------------------------------------------------------------------
  -- Assemble sections in fixed order; omit any that came back empty.
  -- ---------------------------------------------------------------------------
  if jsonb_array_length(v_near) > 0 then
    v_sections := v_sections || jsonb_build_array(
      jsonb_build_object(
        'id', 'near_you', 'title', 'Near you',
        'layout', 'hero-vertical', 'posts', v_near));
  end if;

  -- v_areas is already a JSON array of section objects, each with >= 2 posts.
  v_sections := v_sections || v_areas;

  -- NOTE: this section can now be absent in a radius that HAS active posts —
  -- if every one of them is a no-reward listing, v_highest is empty and the
  -- carousel is omitted, exactly as it already is when the radius is empty.
  -- The client needs no change: sections have always been omitted when empty.
  if jsonb_array_length(v_highest) > 0 then
    v_sections := v_sections || jsonb_build_array(
      jsonb_build_object(
        'id', 'highest_bounties', 'title', 'Highest rewards nearby',
        'layout', 'carousel', 'posts', v_highest));
  end if;

  if jsonb_array_length(v_recovered) > 0 then
    v_sections := v_sections || jsonb_build_array(
      jsonb_build_object(
        'id', 'recently_recovered', 'title', 'Recently recovered near you',
        'layout', 'carousel', 'posts', v_recovered));
  end if;

  -- Good-news fallback: nothing active within the radius, but the country is
  -- not empty -> show recent UK posts under the empty state. Keyed on v_near
  -- (all active posts nearby), never on v_highest — a radius full of no-reward
  -- listings is not an empty radius.
  if jsonb_array_length(v_near) = 0 then
    select coalesce(jsonb_agg(t.j order by t.created_at desc), '[]'::jsonb)
      into v_recent
    from (
      select public.home_feed_post_json(p, null::numeric) as j, p.created_at
      from public.posts p
      where p.status = 'active'                 -- SAFETY: active only
        and p.owner_id is distinct from v_viewer  -- never your own listing
      order by p.created_at desc
      limit 10
    ) t;

    if jsonb_array_length(v_recent) > 0 then
      v_sections := v_sections || jsonb_build_array(
        jsonb_build_object(
          'id', 'recent_uk', 'title', 'Recent listings across the UK',
          'layout', 'hero-vertical', 'posts', v_recent));
    end if;
  end if;

  return jsonb_build_object('sections', v_sections);
end;
$$;

-- -----------------------------------------------------------------------------
-- get_nearby_posts — Lead 1 — membership on the pin.
-- -----------------------------------------------------------------------------
create or replace function public.get_nearby_posts(
  p_lat      double precision,
  p_lng      double precision,
  p_radius_m integer,
  p_offset   integer,
  p_limit    integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_origin geography;
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_limit  integer := least(greatest(coalesce(p_limit, 10), 1), 25);  -- hard cap 25
  -- SAFETY: clamp caller radius to 1–50 miles (default 20 miles), same as
  -- get_home_feed. 1609 m ≈ 1 mile, 80467 m ≈ 50 miles, 32187 m ≈ 20 miles.
  v_radius integer := least(greatest(coalesce(p_radius_m, 32187), 1609), 80467);
  v_viewer uuid := auth.uid();   -- NULL for anon
  v_result jsonb;
begin
  -- No location -> nothing to page (national mode is served by get_home_feed).
  if p_lat is null or p_lng is null then
    return '[]'::jsonb;
  end if;

  v_origin := ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography;

  select coalesce(jsonb_agg(t.j order by t.dist), '[]'::jsonb)
    into v_result
  from (
    select public.home_feed_post_json(p,
             round((ST_Distance(public.post_pin_geog(p.last_seen_location, p.stolen_from), v_origin) / 1609.344)::numeric, 1)) as j,
           ST_Distance(public.post_pin_geog(p.last_seen_location, p.stolen_from), v_origin) as dist
    from public.posts p
    where p.status = 'active'                    -- SAFETY: active only
      and p.last_seen_location is not null
      and p.owner_id is distinct from v_viewer   -- never your own listing
      -- SAFETY (AUDIT 2026-10-26, lead 1): membership on the pin, as get_home_feed.
      and ST_DWithin(p.last_seen_location, v_origin, v_radius + 1500)
      and ST_DWithin(public.post_pin_geog(p.last_seen_location, p.stolen_from), v_origin, v_radius)
    order by dist
    offset v_offset
    limit v_limit
  ) t;

  return v_result;
end;
$$;

-- -----------------------------------------------------------------------------
-- get_post_detail — Lead 2 — the owner keeps the raw label.
-- -----------------------------------------------------------------------------
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
         'colour_finish',           v_post.colour_finish,
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

         -- Distinctive features: [{id, photo_url, description}], the
         -- owner-authored photo+description evidence marks, ordered by position;
         -- [] when none.
         -- SAFETY (visibility — mirrors 'photos' / post_photos exactly): this is
         -- built INSIDE the visible branch, reached only after the active-OR-owner
         -- v_visible gate above — the SAME predicate gating 'photos' and the SAME
         -- one enforced by post_distinctive_feature's RLS SELECT policies
         -- (select_active_public + select_own). Owner sees their marks in any
         -- status; the public sees them only on an active post; never in the
         -- hidden/closed stub. These are CAR photos, so they are NOT coarsened
         -- (coarsening applies only to the driveway last_seen point). 'id' (NEW,
         -- 20260801150000) is the opaque row uuid the report-sighting wizard
         -- submits back as confirmed_feature_ids — same visibility as the
         -- feature itself, no extra data.
         'distinctive_features', coalesce(
           (select jsonb_agg(
                     jsonb_build_object(
                       'id',          df.id,
                       'photo_url',   df.photo_url,
                       'description', df.description)
                     order by df.position)
              from public.post_distinctive_feature df
             where df.post_id = v_post.id),
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
           where sg.post_id = v_post.id),

         -- Whether the CALLER already has a sighting on this post — gates the
         -- post-detail "Message the owner" affordance (chat is sighting-gated;
         -- DOMAIN.md Chat: "No cold DMs"). true -> the client may open a thread;
         -- false -> route the viewer to report a sighting first.
         -- SAFETY (SECURITY_AND_TRUST §1/§6): scoped to spotter_id = v_viewer, so
         -- it reveals ONLY the caller's OWN state (which they already know) — no
         -- other user's data, no count of others. Distinct from sighting_stats.
         -- anon (v_viewer null) -> false; the post's owner -> always false
         -- (own-post sightings are blocked by create_sighting's OWN_POST gate).
         'viewer_has_sighting', (v_viewer is not null and exists (
           select 1 from public.sightings s
           where s.post_id = v_post.id and s.spotter_id = v_viewer))
       )
    -- SAFETY (20260802110000) — OWNER-ONLY, ABSENT FOR EVERYONE ELSE: the coarse
    -- locality exists so the owner's own draft-edit round-trip doesn't blank it.
    -- Merged as a whole object so a non-owner's payload does not even carry the
    -- KEY. Never widen this KEY to the public branch; the spotter-alert matcher
    -- reads the column server-side. (AUDIT 2026-10-26: a driveway theft's
    -- public last_seen_area now IS the locality — the owner's decision — via
    -- post_public_area in home_feed_post_json.)
    || case
         when coalesce(v_post.owner_id = v_viewer, false)
           then jsonb_build_object(
             -- AUDIT 2026-10-26 (lead 2): the owner keeps the raw label.
             'last_seen_area',     v_post.last_seen_area,
             'last_seen_locality', v_post.last_seen_locality,
             -- NEW 2026-08-16 — see this migration's header.
             'recovered_at',       v_post.recovered_at,
             'closed_at',          v_post.closed_at,
             'alerts_sent_at',     v_post.alerts_sent_at,
             -- NEW 2026-10-06 — whether this listing PAID the £5 fee, from the
             -- ledger (20261006110000). The owner's fee sentences rest on it.
             'has_listing_fee',    exists (select 1 from public.payments f
                                            where f.post_id = v_post.id
                                              and f.kind = 'listing_fee'
                                              and f.status in ('collected', 'held')))
         else '{}'::jsonb
       end;
end;
$$;

-- -----------------------------------------------------------------------------
-- list_my_posts — Lead 2 — the owner keeps the raw label.
-- -----------------------------------------------------------------------------
create or replace function public.list_my_posts()
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
      p.created_at,
      -- Shared PostSummary core (distance is meaningless for an owner's own
      -- list, so pass null), extended with the first-photo array, the
      -- owner's archive stamp and the held reward's term end.
      public.home_feed_post_json(p, null::numeric)
        || jsonb_build_object(
             'photos',
             case
               when ph.url is not null
                 then jsonb_build_array(jsonb_build_object('url', ph.url))
               else '[]'::jsonb
             end,
             'archived_at',
             p.archived_at,
             -- AUDIT 2026-10-26 (lead 2): the owner keeps the raw label.
             'last_seen_area',
             p.last_seen_area,
             -- When the held reward's 60-day term ends (ADR-0020), or null.
             'reward_term_ends_at',
             (select pay.term_ends_at
                from public.payments pay
               where pay.post_id = p.id
                 and pay.status = 'held'
                 and pay.kind = 'bounty_escrow')
           ) as item
    from public.posts p
    -- First photo (lowest position) as the card thumbnail; null row when the
    -- post has no photos. Served by post_photos_post_id_position_idx.
    left join lateral (
      select pp.url
      from public.post_photos pp
      where pp.post_id = p.id
      order by pp.position
      limit 1
    ) ph on true
    where p.owner_id = v_viewer   -- SAFETY: caller's OWN posts ONLY. All statuses.
  ) t;

  return v_result;
end;
$$;

-- -----------------------------------------------------------------------------
-- mark_post_payment_held — Lead 5 — the fee activates a free draft only.
-- -----------------------------------------------------------------------------
create or replace function public.mark_post_payment_held(
  p_payment_intent_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- ⚠️ THE TERM (ADR-0020). Moving it is a create-or-replace here AND a
  -- Terms change (legalContent.ts) — never one without the other.
  c_term         constant interval := interval '60 days';
  v_post_id      uuid;
  v_post_status  public.post_status;
  v_post_bounty  integer;
  v_post_renewal integer;
  v_post_attempt uuid;
  v_pay          record;
  v_current      uuid;
  v_current_amt  integer;
  v_is_choice    boolean;
begin
  -- Which post? Read unlocked first: the lock order is POST, then payment.
  select post_id into v_post_id
    from public.payments
   where stripe_payment_intent_id = p_payment_intent_id;

  -- Benign no-op: a success webhook for an intent we never recorded.
  if not found then
    return;
  end if;

  if v_post_id is not null then
    select status, bounty_amount_pence, renewal_amount_pence, renewal_attempt_id
      into v_post_status, v_post_bounty, v_post_renewal, v_post_attempt
      from public.posts where id = v_post_id
       for update;
  end if;

  select id, kind, status, amount_pence, replaces_payment_id, renewal_attempt_id
    into v_pay
    from public.payments
   where stripe_payment_intent_id = p_payment_intent_id
     for update;

  -- The row went between the two reads (a draft deleted with its intents).
  if not found then
    return;
  end if;

  -- NEVER REGRESS: only an uncaptured row advances. A duplicate delivery, or
  -- a late one after the row was released/refunded/collected/superseded, is
  -- a no-op.
  if v_pay.status not in ('requires_payment', 'failed') then
    return;
  end if;

  -- --- A listing fee: ours on capture (ADR-0018) -----------------------------
  -- ⚠️ THE CASTS ARE REQUIRED (see 20260902130000): a bare literal assigned
  -- through CASE resolves to text and fails at runtime, not at create time.
  if v_pay.kind = 'listing_fee' then
    update public.payments
       set status      = 'collected'::public.payment_status,
           captured_at = now()
     where id = v_pay.id;

    -- MONEY (AUDIT 2026-10-26, lead 5): a fee puts live a FREE listing only.
    -- A draft's bounty stays owner-writable after this intent existed, so
    -- without the null test a £5 capture published a reward nobody holds. A
    -- draft that now asks for a reward goes live when that reward is held.
    update public.posts
       set status = 'active'
     where id = v_post_id
       and status = 'draft'
       and bounty_amount_pence is null;
    return;
  end if;

  -- --- A bounty --------------------------------------------------------------
  -- The reward currently on offer, if any (the unique index: at most one).
  select id, amount_pence into v_current, v_current_amt
    from public.payments
   where post_id = v_post_id
     and status = 'held'
     and id <> v_pay.id;

  -- ⚠️ THE OWNER'S CURRENT CHOICE, AND NOTHING ELSE, MAY CHANGE A LIVE REWARD.
  -- A PaymentIntent never expires and its client secret is enough to confirm
  -- it, so 'the charge was valid when it was created' proves nothing at
  -- capture. A charge may become a live listing's reward only if it was made
  -- for the CURRENT attempt (set_reward_renewal_amount mints a fresh one on
  -- every choice) at exactly the amount chosen. An intent from an earlier
  -- choice — abandoned, or prepared and held back — is a stray, refunded in
  -- full.
  v_is_choice := coalesce(
    v_pay.renewal_attempt_id is not null
      and v_pay.renewal_attempt_id = v_post_attempt
      and v_pay.amount_pence = v_post_renewal,
    false);

  if v_current is not null then
    -- ⚠️ A RENEWAL ONLY ON A LIVE, UNCONTESTED POST, AS THE CURRENT CHOICE —
    -- CHECKED AT CAPTURE, not just when the intent was created: an owner can
    -- open the sheet on a live post, deactivate with a hold (or credit a
    -- spotter), and THEN confirm. Superseding the reward then would refund it
    -- past the dispute window, or hand a credited spotter's reward back.
    -- ⚠️ AND THE LOWERING RULE AGAIN: a sighting can land while the sheet is
    -- open; without this an owner could choose £10, wait for the sighting
    -- that finds the car, confirm, and credit the spotter on the smaller sum.
    if v_pay.replaces_payment_id = v_current
       and v_is_choice
       and v_post_status in ('active', 'pending_verification')
       and not public.reward_has_claim(v_post_id)
       and not (
         v_pay.amount_pence < v_current_amt
         and exists (select 1 from public.recent_uncredited_sightings(v_post_id))
       ) then
      update public.payments
         set status                   = 'superseded'::public.payment_status,
             superseded_at            = now(),
             superseded_by_payment_id = v_pay.id
       where id = v_current;

      -- The renewed reward starts a FRESH term from today.
      update public.payments
         set status         = 'held'::public.payment_status,
             captured_at    = now(),
             term_ends_at   = public.reward_term_end(now() + c_term),
             term_notice_at = now()
       where id = v_pay.id;

      update public.posts
         set bounty_amount_pence  = v_pay.amount_pence,
             renewal_amount_pence = null,
             renewal_attempt_id   = null
       where id = v_post_id;
    else
      -- STRAY: a reward is already held and this charge was not taken (or is
      -- no longer allowed) to replace it. It must not become a second held
      -- row (the index forbids it, and the webhook would then fail forever).
      -- The owner never chose this outcome, so it comes back IN FULL; it was
      -- never anyone's reward, so it gets no term.
      update public.payments
         set status                   = 'superseded'::public.payment_status,
             captured_at              = now(),
             superseded_at            = now(),
             superseded_by_payment_id = v_current,
             refund_fee_absorbed      = true
       where id = v_pay.id;
    end if;
    return;
  end if;

  -- No reward is held on the post.
  -- ADD: a LIVE £5 fee listing takes a reward — but only the owner's current
  -- choice (no draft-era leftover can satisfy it), naming nothing to replace,
  -- while nobody has a claim. The fee is not refunded (ADR-0014).
  if v_post_status in ('active', 'pending_verification')
     and v_post_bounty is null
     and v_pay.replaces_payment_id is null
     and v_is_choice
     and not public.reward_has_claim(v_post_id) then
    update public.payments
       set status         = 'held'::public.payment_status,
           captured_at    = now(),
           term_ends_at   = public.reward_term_end(now() + c_term),
           term_notice_at = now()
     where id = v_pay.id;

    update public.posts
       set bounty_amount_pence  = v_pay.amount_pence,
           renewal_amount_pence = null,
           renewal_attempt_id   = null
     where id = v_post_id;
    return;
  end if;

  -- ⚠️ A CLOSED OR MISSING POST NEVER TAKES A REWARD, AND NEITHER DOES A
  -- CHARGE FOR THE WRONG AMOUNT — each used to be held on a post that could
  -- never pay it out or refund it correctly, stranding money with a 90-day
  -- clock on it. Superseded + absorbed sends it home in full.
  if v_post_status is null
     or v_post_status not in ('draft', 'active', 'pending_verification')
     or v_post_bounty is distinct from v_pay.amount_pence then
    update public.payments
       set status              = 'superseded'::public.payment_status,
           captured_at         = now(),
           superseded_at       = now(),
           refund_fee_absorbed = true
     where id = v_pay.id;
    return;
  end if;

  -- The FIRST reward on a draft (or a live post charged what it offers).
  update public.payments
     set status         = 'held'::public.payment_status,
         captured_at    = now(),
         term_ends_at   = public.reward_term_end(now() + c_term),
         term_notice_at = now()
   where id = v_pay.id;

  -- LIVE-ON-PAYMENT: draft -> ACTIVE. Guarded so a late delivery never pulls a
  -- later lifecycle state backwards.
  update public.posts
     set status = 'active'
   where id = v_post_id
     and status = 'draft';

  -- AUDIT: a money-state-transition audit-log insert belongs here once the
  -- audit_log table exists (SECURITY_AND_TRUST §7). Deferred with moderation.
end;
$$;

-- -----------------------------------------------------------------------------
-- claim_recovery — Lead 6 — the public counter respects the collusion signals.
-- -----------------------------------------------------------------------------
create or replace function public.claim_recovery(
  p_post_id     uuid,
  p_sighting_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller     uuid := auth.uid();
  v_owner      uuid;
  v_status     public.post_status;
  v_spotter    uuid;
  v_sighting_post uuid;
  -- MONEY (ADR-0014): NULL bounty = a free listing = nothing to release or refund.
  v_bounty     integer;
  v_next_step  text;
  v_new_status public.post_status;
  -- AUDIT 2026-10-26 (lead 6): true when the owner/spotter pair looks like
  -- one person — the public recoveries_credited counter then stays put.
  v_flagged    boolean;
begin
  if v_caller is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  -- Lock the post row for the duration. Without this, two taps of "I got it
  -- back" can both read `active` and both proceed; the unique index would stop
  -- a double CREDIT but not a double counter increment.
  select owner_id, status, bounty_amount_pence
    into v_owner, v_status, v_bounty
  from public.posts
  where id = p_post_id
  for update;

  if v_owner is null then
    raise exception 'POST_NOT_FOUND';
  end if;
  -- SAFETY: ownership from the JWT, never from an argument.
  if v_owner <> v_caller then
    raise exception 'NOT_OWNER';
  end if;
  -- SAFETY: `active` only. A draft has no payment to resolve; a cancelled or
  -- expired post has already refunded; an already-claimed post would
  -- double-credit. Deliberately NOT a "not closed" test — an allowlist of one.
  if v_status <> 'active' then
    raise exception 'POST_NOT_ACTIVE';
  end if;

  -- MONEY: "free" is decided by the missing bounty, so refuse the one case
  -- where that lies — a NULL bounty with REAL escrow held. It can happen: a
  -- draft switched from bounty to free, while the old bounty intent still
  -- captured (create-payment-intent cancels it best-effort only), and
  -- mark_post_payment_held writes 'held' by the ROW's kind. Closing such a
  -- post to a terminal state would strand that escrow for good: refund-recovery
  -- and release-payout both require recovery_claimed. The 20260802 version at
  -- least routed it to a refund; this must never be worse. Raised BEFORE any
  -- write, so nothing is credited and the post stays active. Same code
  -- cancel_fee_listing uses for the same case (20260822100000).
  -- (Security review, 2026-09-24.)
  if v_bounty is null and exists (
    select 1 from public.payments
    where post_id = p_post_id and status = 'held'
  ) then
    raise exception 'POST_HAS_BOUNTY';
  end if;

  if p_sighting_id is not null then
    select spotter_id, post_id into v_spotter, v_sighting_post
    from public.sightings
    where id = p_sighting_id;

    if v_spotter is null then
      raise exception 'SIGHTING_NOT_FOUND';
    end if;
    -- SAFETY: a sighting on ANOTHER post must never be creditable — that would
    -- let an owner point their escrow at any sighting in the system.
    if v_sighting_post <> p_post_id then
      raise exception 'SIGHTING_NOT_ON_POST';
    end if;
    -- SAFETY: self-credit is a laundering round-trip on a bounty post. Kept for
    -- free listings too: there is no money to launder, but crediting yourself
    -- would still inflate your own recoveries_credited, and reputation is the
    -- thing a free listing DOES pay out.
    if v_spotter = v_caller then
      raise exception 'CANNOT_CREDIT_OWN_SIGHTING';
    end if;

    -- SAFETY (AUDIT 2026-10-26, lead 6): mark_sighting_helpful's collusion
    -- gate (20260814140000). Read BEFORE the credit, so this sighting does not
    -- count towards its own pair total.
    v_flagged := public.shared_device_exists(v_caller, v_spotter)
                 or public.confirmation_pair_count(v_caller, v_spotter) >= 3;

    update public.sightings
    set status = 'credited'
    where id = p_sighting_id;

    -- Reputation v1 (DOMAIN.md): server-maintained ONLY. Runs for BOTH pricing
    -- modes: on a free listing the credit and this bump ARE the spotter's
    -- whole reward (ADR-0014). A flagged pair keeps the credit, not the count.
    if not v_flagged then
      update public.profiles
      set recoveries_credited = recoveries_credited + 1
      where id = v_spotter;
    end if;
  end if;

  -- Where this post lands, and what the client must do next.
  --
  -- BOUNTY POST: 'recovery_claimed' for both answers. recovered /
  -- recovered_no_spotter are post-MONEY states and belong to the Edge Function
  -- that actually moves the money. Unchanged.
  --
  -- FREE LISTING: there is no money leg and no Edge Function to follow, so this
  -- IS the resolution — land on the terminal state directly. posts.closed_at is
  -- maintained by the posts_set_closed_at trigger on the status transition.
  if v_bounty is null then
    v_new_status := case when p_sighting_id is null
                         then 'recovered_no_spotter'::public.post_status
                         else 'recovered'::public.post_status end;
    v_next_step  := 'done';
  else
    v_new_status := 'recovery_claimed'::public.post_status;
    v_next_step  := case when p_sighting_id is null then 'refund' else 'payout' end;
  end if;

  -- recovered_at is when the CAR was recovered — what the 30-day public window
  -- and the feed's "Recently recovered" section date from.
  update public.posts
  set status = v_new_status,
      recovered_at = now()
  where id = p_post_id;

  return jsonb_build_object(
    'postId', p_post_id,
    'creditedSightingId', p_sighting_id,
    -- Named rather than inferred, so the app never re-derives the money path
    -- from a status or a null bounty.
    'nextStep', v_next_step
  );
end $$;

-- -----------------------------------------------------------------------------
-- register_push_token — Lead 7 — Expo tokens only, ten per user.
-- -----------------------------------------------------------------------------
create or replace function public.register_push_token(
  p_token    text,
  p_platform text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := auth.uid();
  -- Normalised once, then used everywhere: validating one value and storing
  -- another is how whitelists get bypassed.
  v_token    text := btrim(coalesce(p_token, ''));
  v_platform text := lower(btrim(coalesce(p_platform, '')));
  -- ADDED 2026-08-03: who held this device before this call, for device_links.
  v_previous uuid;
  -- NEW 20261023130000: the session this JWT was issued for.
  v_session  uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
begin
  -- A token must belong to an account: no owner, no audience row.
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  -- NEW 20261023130000: signed out everywhere — this JWT's session is gone.
  if v_session is not null
     and not exists (select 1 from auth.sessions where id = v_session) then
    return;
  end if;

  -- Bounds the token defensively (Expo tokens are ~40-50 chars; 255 is generous
  -- headroom) so a client cannot pad an unbounded blob into a PRIMARY KEY, and
  -- rejects any platform outside the CHECK whitelist with a stable token rather
  -- than a raw constraint-violation error.
  -- SAFETY (AUDIT 2026-10-26, lead 7): an Expo token or nothing. The send path
  -- batches 100 users' tokens per Expo request, so one planted non-Expo
  -- string could fail the whole request for everyone in it.
  if v_token = ''
     or char_length(v_token) > 255
     or v_token !~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$'
     or v_platform not in ('ios', 'android') then
    raise exception 'INVALID_INPUT';
  end if;

  -- ADDED 2026-08-03: read the current owner BEFORE the upsert re-points it.
  select user_id into v_previous
    from public.push_tokens
   where token = v_token;

  -- Upsert keyed on the token (the device). ON CONFLICT re-points user_id to the
  -- caller — see DEVICE MIGRATION above — and refreshes the platform (a token
  -- cannot change OS, but a re-registration is the honest moment to re-assert
  -- it) and updated_at.
  insert into public.push_tokens (token, user_id, platform, updated_at)
  values (v_token, v_uid, v_platform, now())
  on conflict (token) do update
    set user_id    = excluded.user_id,
        platform   = excluded.platform,
        updated_at = now();

  -- ADDED 2026-08-03: the handover is THE one-phone-two-accounts collusion
  -- signal (SECURITY_AND_TRUST §5), recorded only when the token actually
  -- moved. Same-user refreshes — every app start — write nothing. Hashed so
  -- the ledger never holds a live push credential.
  if v_previous is not null and v_previous <> v_uid then
    insert into public.device_links (token_hash, from_user_id, to_user_id)
    values (encode(extensions.digest(v_token, 'sha256'), 'hex'), v_previous, v_uid);
  end if;

  -- SAFETY (AUDIT 2026-10-26, lead 7): a user keeps their ten newest devices,
  -- so nobody can stuff the shared fan-out with tokens.
  delete from public.push_tokens t
   where t.user_id = v_uid
     and t.token not in (select k.token
                           from public.push_tokens k
                          where k.user_id = v_uid
                          order by k.updated_at desc, k.token
                          limit 10);
end;
$$;

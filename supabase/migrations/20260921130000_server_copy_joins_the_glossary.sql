-- =============================================================================
-- WHAT: The four server-composed user-facing strings that still said "bounty"
--       or "post" catch up with the 2026-09-21 copy glossary (reward is the
--       user-facing money word — ADR-0014's own rule; listing is the entry):
--
--         claim_dispute_outcome_notification (rejected body):
--           "this bounty won't be coming to you"  -> "this reward …"
--         claim_payout_sent_notification (body):
--           "Your bounty is heading …"            -> "Your reward is heading …"
--         get_home_feed (section titles, ×3 sites):
--           "Recent posts across the UK"          -> "Recent listings across the UK"
--           "Highest bounties nearby"             -> "Highest rewards nearby"
--
--       Three CREATE OR REPLACEs, each character-identical to its predecessor
--       except the copy and the comments that quote it. Section IDs
--       ('recent_uk', 'highest_bounties'), payload keys and every predicate
--       are untouched — the client keys sections by id, never by title.
--
-- WHY:  The client-side glossary pass (polish/wording) renamed every "bounty"
--       an owner or spotter reads to "reward" and every "post" to "listing" —
--       but push bodies and feed section titles are composed HERE, so the app
--       would have said "£500 reward" on the card and "Highest bounties
--       nearby" above it. Copy that lives in SQL moves by migration; this is
--       that migration.
--
-- SAFETY NOTE ON DESTRUCTIVE STATEMENTS: none. Three CREATE OR REPLACE
--       FUNCTIONs; no schema, data, kind-vocabulary or grant change. Grants
--       are re-asserted because CREATE OR REPLACE re-runs this project's
--       ALTER DEFAULT PRIVILEGES (which re-grant anon at CREATE time).
--       The alert and sighting pushes are deliberately NOT touched: their
--       bodies end with the don't-approach clause (SECURITY_AND_TRUST §1/§3)
--       and contain no glossary violations — nothing to change, and safety
--       copy does not ride along on a wording pass.
--
-- LINKS: supabase/migrations/20260805110000_hold_dispute_notifications.sql
--          (claim_dispute_outcome_notification this restates);
--        supabase/migrations/20260806100000_notification_center.sql
--          (claim_payout_sent_notification this restates);
--        supabase/migrations/20260820120000_highest_bounties_excludes_no_reward.sql
--          (the get_home_feed this restates — its HOW notes still apply);
--        docs/decisions/ADR-0014-no-bounty-listings.md ("reward" is the
--          user-facing word); .claude/commands/polish-copy.md (the glossary).
-- =============================================================================


-- =============================================================================
-- 1. claim_dispute_outcome_notification — restated from 20260805110000; the
--    only change is one word in the rejected body.
-- =============================================================================
create or replace function public.claim_dispute_outcome_notification(
  p_dispute_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id      uuid;
  v_status  text;
  v_spotter uuid;
  v_post    uuid;
  v_sight   uuid;
  v_bounty  integer;
  v_transfer integer;
begin
  -- Resolved and unclaimed only. The conditional update IS the idempotency.
  update public.refund_disputes
     set outcome_notified_at = now()
   where id = p_dispute_id
     and status in ('upheld', 'rejected')
     and outcome_notified_at is null
  returning id, status, spotter_id, post_id, sighting_id
    into v_id, v_status, v_spotter, v_post, v_sight;

  if v_id is null then
    return jsonb_build_object('claimed', false);
  end if;

  if v_status = 'rejected' then
    -- Final and calm. No reasons: the evidence was weighed by a person, and
    -- a reasons string would become an argument surface.
    return jsonb_build_object(
      'claimed', true,
      'kind', 'dispute_rejected',
      'user_id', v_spotter,
      'sighting_id', v_sight,
      'title', 'About your sighting',
      'body', 'We looked into it carefully, and this reward won''t be coming to you. Thank you for reporting it.'
    );
  end if;

  -- UPHELD: the earn moment, same shape as the credited push. held OR
  -- released — a fast payout may already have beaten this claim.
  select p.amount_pence into v_bounty
    from public.payments p
   where p.post_id = v_post
     and p.status in ('held', 'released')
   limit 1;

  if v_bounty is null then
    -- An upheld dispute with no funded payment should be impossible. Send no
    -- push rather than inventing a number (the claim stays consumed; the
    -- anomaly is for the logs, not the spotter).
    return jsonb_build_object('claimed', false);
  end if;

  select transfer_pence into v_transfer from public.payout_split(v_bounty);

  return jsonb_build_object(
    'claimed', true,
    'kind', 'dispute_upheld',
    'user_id', v_spotter,
    'sighting_id', v_sight,
    'title', 'You''ve earned £' || to_char(v_transfer / 100.0, 'FM999990.00'),
    'body', 'You were right — your sighting led to the recovery. Tell us where to send it.'
  );
end $$;

comment on function public.claim_dispute_outcome_notification(uuid) is
  'One-shot claim for a resolved dispute''s outcome push. Conditional update on outcome_notified_at is the idempotency (the sweep retries; the spotter hears once). Upheld amount via payout_split, mirroring claim_credited_notification. Every refusal returns the identical {claimed:false}. SERVICE ROLE ONLY.';

revoke all on function public.claim_dispute_outcome_notification(uuid) from public;
revoke all on function public.claim_dispute_outcome_notification(uuid) from anon;
revoke all on function public.claim_dispute_outcome_notification(uuid) from authenticated;
grant execute on function public.claim_dispute_outcome_notification(uuid) to service_role;


-- =============================================================================
-- 2. claim_payout_sent_notification — restated from 20260806100000; the only
--    change is one word in the body.
-- =============================================================================
create or replace function public.claim_payout_sent_notification(p_post_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment  uuid;
  v_transfer integer;
  v_sighting uuid;
  v_spotter  uuid;
begin
  if p_post_id is null then
    return jsonb_build_object('claimed', false);
  end if;

  -- Every gate in ONE predicate: a released payment on this post, its recorded
  -- transfer amount, and the credited sighting that names the recipient.
  select pay.id, pay.transfer_amount_pence, s.id, s.spotter_id
    into v_payment, v_transfer, v_sighting, v_spotter
    from public.payments pay
    join public.sightings s on s.post_id = pay.post_id and s.status = 'credited'
   where pay.post_id = p_post_id
     and pay.status = 'released'
     and pay.transfer_amount_pence is not null
     and pay.payout_notified_at is null
   limit 1;

  if v_payment is null then
    return jsonb_build_object('claimed', false);
  end if;

  -- The conditional update IS the idempotency.
  update public.payments
     set payout_notified_at = now()
   where id = v_payment
     and payout_notified_at is null
  returning id into v_payment;

  if v_payment is null then
    return jsonb_build_object('claimed', false);
  end if;

  -- MONEY: the amount is the RECORDED transfer_amount_pence — what
  -- mark_recovery_paid wrote when the Stripe transfer was created — NEVER a
  -- payout_split recomputation, which could drift from what actually moved.
  -- Formatted exactly as claim_credited_notification formats its amount.
  return jsonb_build_object(
    'claimed',     true,
    'user_id',     v_spotter,
    'sighting_id', v_sighting,
    'post_id',     p_post_id,
    'title',       'On its way — £' || to_char(v_transfer / 100.0, 'FM999990.00'),
    'body',        'Your reward is heading to your bank account.'
  );
end $$;

comment on function public.claim_payout_sent_notification(uuid) is
  'One-shot claim for the payout-sent push to the credited spotter of a post whose payment is released. Conditional update on payments.payout_notified_at is the idempotency. MONEY: the title carries the RECORDED transfer_amount_pence (written by mark_recovery_paid), never a payout_split recomputation. Every refusal — no such post, payment not released, no recorded amount, no credited sighting, already claimed — returns the identical {claimed:false}. SERVICE ROLE ONLY.';

revoke execute on function public.claim_payout_sent_notification(uuid) from public, anon, authenticated;
grant  execute on function public.claim_payout_sent_notification(uuid) to service_role;


-- =============================================================================
-- 3. get_home_feed — restated from 20260820120000 (whose HOW notes remain the
--    reference); the only changes are the two section titles and the comments
--    that quote them. Section IDs are API keys and do not move.
--    ⚠️ NEXT EDITOR: the live definition of get_home_feed is THIS file.
--    get_nearby_posts and post_pin_geog remain in 20260811100000.
-- =============================================================================
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
    select p as post, ST_Distance(public.post_pin_geog(p.last_seen_location, p.stolen_from), v_origin) as dist
    from public.posts p
    where p.status = 'active'                    -- SAFETY: active only
      and p.last_seen_location is not null
      and p.owner_id is distinct from v_viewer   -- never your own listing
      and ST_DWithin(p.last_seen_location, v_origin, v_radius)
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
    select (ir.post).last_seen_area as area, min(ir.dist) as min_dist
    from in_radius ir
    where (ir.post).last_seen_area is not null
    group by (ir.post).last_seen_area
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
            where (ir.post).last_seen_area = a.area
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

comment on function public.get_home_feed(double precision, double precision, integer) is
  'Composes the Explore home feed server-side in one call: { sections: [...] }. SECURITY DEFINER (bypasses RLS) so every query carries an explicit status predicate — active only, except recently_recovered (recovered states within 30 days, location snapped to a ~1km grid). Radius clamped to 1–50 miles. EXCLUDES the caller''s own posts (feed only — the map and search still show them). highest_bounties (titled "Highest rewards nearby" since the 2026-09-21 glossary pass) EXCLUDES no-reward listings (2026-08-20, ADR-0014): their bounty is NULL and Postgres sorts NULLs first under DESC, so they would otherwise head a section named for the thing they lack; every other section still includes them. See DOMAIN.md / SECURITY_AND_TRUST §2.';

-- Grants unchanged from 20260711130000, RE-ASSERTED because CREATE OR REPLACE
-- re-runs this project's ALTER DEFAULT PRIVILEGES (which re-grant anon at CREATE
-- time). The feed is a public, guest-first surface: anon reads it deliberately.
revoke execute on function public.get_home_feed(double precision, double precision, integer) from public;
grant  execute on function public.get_home_feed(double precision, double precision, integer) to anon, authenticated, service_role;


-- =============================================================================
-- END OF MIGRATION
-- =============================================================================

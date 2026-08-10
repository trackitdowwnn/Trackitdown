-- =============================================================================
-- WHAT: Removes `posts.last_seen_location` from the SELECT grant held by anon
--       and authenticated, replacing the table-wide grant with a column list.
--
-- WHY:  ⚠️ THIS IS A LIVE LEAK, verified against production on 2026-08-10.
--
--       `grant select on public.posts to anon, authenticated`
--       (20260707110712 / 20260711130000) is TABLE-WIDE, and the geography
--       column was added later without narrowing it. PostgREST exposes the
--       `public` schema, so one unauthenticated request —
--
--         GET /rest/v1/posts?select=last_seen_location&status=eq.active
--
--       — returns exact coordinates for every active post, including
--       `stolen_from = 'driveway'` posts whose point IS the victim's home
--       address. Confirmed HTTP 200 with the column present.
--
--       This makes the ~1km coarsening added in 20260810160000 BYPASSABLE, and
--       falsified the claim in SECURITY_AND_TRUST §2 that coarsening was "true
--       of every coordinate-emitting surface". The RPCs were never the only
--       surface — the table itself was one.
--
--       The RPCs are unaffected: get_home_feed, get_nearby_posts,
--       get_post_detail, search_posts and search_posts_count are all SECURITY
--       DEFINER, so they read the column as the definer regardless of what
--       anon holds. They stay the ONLY way to obtain a location, which is what
--       lets them decide how precise it may be.
--
--       Client impact: none. The only direct read of this table anywhere in
--       the app is profileApi.countDeletionBlockingPosts, which selects `id`
--       filtered on `owner_id` and `status` — all three still granted.
--       (`owner_id` is deliberately KEPT: a WHERE clause needs SELECT
--       privilege on the columns it references, and RLS still confines the
--       rows.)
--
-- COLUMNS: enumerated explicitly rather than computed, so ADDING a column to
--       posts does NOT silently grant it. A new sensitive column stays unread
--       by anon until someone deliberately adds it here — the failure mode is
--       a missing field in an app, which is loud, rather than a silent leak.
-- =============================================================================

revoke select on public.posts from anon, authenticated;

grant select (
  id,
  owner_id,
  status,
  bounty_amount_pence,
  plate,
  make,
  model,
  colour,
  last_seen_at,
  expires_at,
  created_at,
  updated_at,
  last_seen_area,
  recovered_at,
  year,
  body_type,
  distinguishing_features,
  owner_note,
  stolen_from,
  keys_taken,
  desc_recognise,
  desc_drives,
  closed_at,
  vehicle_id,
  alerts_sent_at,
  last_seen_locality,
  recovery_notified_at
) on public.posts to anon, authenticated;

-- service_role keeps the whole table: it is the trusted server identity behind
-- Edge Functions and webhooks, and is never exposed to a client.
grant select on public.posts to service_role;

comment on column public.posts.last_seen_location is
  'Exact last-seen point. NOT readable by anon or authenticated through PostgREST (20260810180000) — a driveway theft''s point is the victim''s home address. Reach it only through a SECURITY DEFINER RPC that decides the precision it may emit: get_post_detail and search_posts snap it to a ~1km grid for driveway thefts, get_home_feed snaps recovered posts.';

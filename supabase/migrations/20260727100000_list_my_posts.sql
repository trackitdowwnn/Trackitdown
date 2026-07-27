-- =============================================================================
-- WHAT:  "My Listings" database layer. Creates the SECURITY DEFINER RPC
--        public.list_my_posts(), which returns EVERY post owned by the
--        caller — in ANY lifecycle status (draft, pending_verification,
--        active, recovery_claimed, recovered, recovered_no_spotter,
--        cancelled, expired, rejected) — as a JSON array of card rows,
--        newest first (created_at desc), each carrying the shared
--        PostSummary payload plus the post's first photo.
-- WHY:   A signed-in owner needs a single call that lists all of THEIR OWN
--        posts as cards, across the full lifecycle (a draft they haven't
--        paid for, a live active post, a recovered/closed one), so the
--        "My Listings" screen renders without the client assembling a
--        query or leaking anyone else's posts. This mirrors get_my_watchlist
--        (the closest user-scoped card RPC): same jsonb-array return, same
--        home_feed_post_json core shape, same first-photo lateral join, same
--        SECURITY DEFINER + grant model. Unlike the watchlist it applies NO
--        status/window redaction — every field of the caller's OWN posts is
--        the caller's to see (RLS posts_select_own already permits exactly
--        this for direct reads); the ONLY gate is owner_id = auth.uid().
-- LINKS: docs/DOMAIN.md (post lifecycle — the full status set returned here),
--        docs/SECURITY_AND_TRUST.md §2 (owner sees own posts in any status),
--          §6 (RLS deny by default; SECURITY DEFINER hardening),
--        supabase/migrations/20260707110712_payments_foundation.sql (posts,
--          post_status enum, posts_select_own, posts_owner_id_idx),
--        supabase/migrations/20260711130000_home_feed_location_and_rpcs.sql
--          (home_feed_post_json helper; SECURITY DEFINER RPC hardening),
--        supabase/migrations/20260713140000_post_detail.sql (post_photos;
--          post_photos_post_id_position_idx first-photo scan),
--        supabase/migrations/20260722100000_watchlist.sql (get_my_watchlist —
--          the RPC this one mirrors: return shape, grants, security model),
--        src/shared/types/posts.ts (PostSummary shape the client maps to).
--
-- SAFETY NOTE ON DESTRUCTIVE STATEMENTS: none. Fully additive — one new
--        function + its grants. No table/column/enum/policy is created,
--        altered, dropped, renamed, or truncated. No existing object changes.
-- =============================================================================


-- =============================================================================
-- 1. RPC: list_my_posts() -> jsonb
-- =============================================================================
-- Returns the CALLER's own posts as a JSON array, newest first (created_at
-- desc). Each element is the shared PostSummary core (home_feed_post_json —
-- the same shape the home feed emits: id, plate, make, model, colour,
-- bounty_amount_pence, status, last_seen_at, last_seen_area, distance_miles
-- [always null here — this list is not location-scoped], created_at) extended
-- with:
--   'photos' — a JSON array with the post's FIRST photo as [{ "url": ... }]
--              (lowest post_photos.position), or [] when the post has none.
--              Kept as an array (not a bare url) so the client maps it
--              straight to PostSummary.photos: [{ uri }] with no reshaping.
--
-- STATUS COVERAGE: ALL statuses are returned unfiltered. This is deliberately
-- the opposite of the home feed / watchlist visibility rules — those hide
-- non-active/closed posts from OTHER users (anti-stalking). Here the caller is
-- the OWNER of every row, so a draft, pending_verification, recovery_claimed,
-- cancelled, expired, or rejected post is all correctly theirs to see. The
-- client 'My Listings' surface renders the status badge per card.
--
-- SAFETY (Tier 1 — read before editing): SECURITY DEFINER, so RLS is
--   BYPASSED. The posts_select_own policy DOES NOT protect the read below.
--   The `p.owner_id = v_viewer` predicate is the ONLY thing keeping one user's
--   posts out of another user's hands — never weaken it or rely on RLS to
--   backstop it. No caller identity (anon / missing uid) -> empty array; never
--   fall through to "all rows". Photos joined here belong to the caller's own
--   posts, so there is no cross-user photo exposure.
--
-- auth.uid() reads the CALLER's JWT claim (a request GUC), so it identifies
-- the caller even though the body runs as the definer. It is schema-qualified
-- so it resolves regardless of search_path.
--
-- search_path fixed to public, extensions to match the house RPC pattern
-- (home_feed_post_json lives in public). STABLE: reads only, no writes.
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
      -- list, so pass null), extended with the first-photo array.
      public.home_feed_post_json(p, null::numeric)
        || jsonb_build_object(
             'photos',
             case
               when ph.url is not null
                 then jsonb_build_array(jsonb_build_object('url', ph.url))
               else '[]'::jsonb
             end
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

comment on function public.list_my_posts() is
  'Returns the caller''s own posts as a JSON array, newest first (created_at desc), across ALL lifecycle statuses. Each element is the home_feed_post_json PostSummary core plus a "photos" array carrying the first photo ([{url}] or []). SECURITY DEFINER (bypasses RLS): owner_id = auth.uid() is the only ownership gate. Anon -> [].';


-- =============================================================================
-- 2. FUNCTION GRANT
-- =============================================================================
-- SAFETY: functions default to EXECUTE granted to PUBLIC. Lock that down and
-- grant deliberately, matching get_my_watchlist: authenticated + service_role
-- ONLY. anon deliberately gets NO execute — "My Listings" is inherently a
-- signed-in, owner-scoped surface (an anon caller has no auth.uid() and would
-- only ever get []); denying execute keeps the surface minimal rather than
-- relying on the empty-array body guard alone.
revoke execute on function public.list_my_posts() from public;
grant  execute on function public.list_my_posts()
  to authenticated, service_role;


-- =============================================================================
-- END OF MIGRATION
-- =============================================================================

-- =============================================================================
-- WHAT:  Feed cards get their photographs. Redefines the shared serialiser
--        public.home_feed_post_json() to carry a 'photos' key — the post's
--        FIRST photo (lowest post_photos.position) as [{ "url": ... }], or []
--        when the post has none.
-- WHY:   ⛳ ROADMAP critical path #1. `get_home_feed` returned no photo column
--        at all, so `feedApi.toPostSummary` fell back to `samplePhotos()` —
--        which yields ten Unsplash cars in __DEV__ and [] in production. The
--        Explore feed and the search map therefore rendered PLACEHOLDER CARDS
--        for every real user while looking perfect to us, and a stolen-car
--        feed without photographs of the cars is not a shipped search feature.
--        The dev fallback is deleted in the same commit so the feed can never
--        flatter us again.
--
--        Fixing the HELPER rather than each RPC is the point. Nine callers
--        compose their payload as `home_feed_post_json(p, …) || …`, so one
--        edit here reaches get_home_feed (every section), get_nearby_posts,
--        search_posts, get_map_posts and get_post_detail at once — and, more
--        importantly, a tenth caller added later cannot forget photos. The
--        shape is copied verbatim from list_my_posts (2026-07-27), which has
--        emitted exactly this array for a month: kept as an ARRAY rather than
--        a bare url so the client maps it straight to PostSummary.photos with
--        no reshaping, and so a future "up to N cover photos" widening is a
--        change of limit here rather than a change of contract everywhere.
--
--        FIRST photo only, deliberately. A card renders one image; shipping
--        the whole carousel down the feed would multiply the payload by ~3
--        (the seed gives every post three) to render nothing extra. The
--        post-detail RPC keeps its own complete, ordered `photos` array —
--        it appends AFTER this helper in the `||`, so the right-hand side
--        wins and detail is untouched.
--
-- SAFETY: this helper does NO filtering and gains none — every caller still
--        owns its status predicates, exactly as before. What changes is that
--        a caller which emits a post now also emits that post's cover image,
--        so the rule "only emit posts the viewer may see" now also governs
--        photos. That rule already held everywhere it matters, and the two
--        REDACTING branches never reach this helper at all:
--          · get_post_detail's non-visible branch returns a
--            { found, visible:false } stub before calling it;
--          · get_my_watchlist's tombstone branch hand-builds its explicit-NULL
--            object rather than calling it.
--        Both were re-read against this change; neither can leak a photo.
--        post_photos.url is a PUBLIC Storage URL with EXIF already stripped
--        server-side, so no signing, no coordinates and no owner identity
--        travel with it.
--
--        The subquery is index-served by post_photos_post_id_position_idx
--        (post_id, position) — an ordered one-row lookup per card, the same
--        access list_my_posts already performs. STABLE is still correct: the
--        function reads, and reads only.
--
-- LINKS: docs/ROADMAP.md (Search — critical path #1),
--        supabase/migrations/20260711130000_home_feed_location_and_rpcs.sql
--          (the original helper this replaces; get_home_feed SAFETY notes),
--        supabase/migrations/20260713140000_post_detail.sql (post_photos +
--          post_photos_post_id_position_idx),
--        supabase/migrations/20260727100000_list_my_posts.sql (the shape and
--          the lateral-join precedent copied here),
--        supabase/tests/home_feed_verification.sql (CHECKS 17–19 assert this),
--        src/features/search-map/api/feedApi.ts (the client mapping),
--        src/shared/types/posts.ts (PostSummary.photos).
--
-- SAFETY NOTE ON DESTRUCTIVE STATEMENTS: none. One CREATE OR REPLACE of an
--        existing function at its EXISTING signature — privileges are
--        preserved by definition, so the 20260711130000 revoke-from-public
--        still stands and the function remains non-client-callable. No table,
--        column, enum, policy, index or row is created, altered or dropped.
-- =============================================================================


-- =============================================================================
-- 1. HELPER (replaced): home_feed_post_json(posts, numeric) -> jsonb
-- =============================================================================
-- Every key below is unchanged from 20260711130000 except the new 'photos'.
-- Callers that append their own 'photos' (list_my_posts, get_post_detail and
-- friends) put this call on the LEFT of `||`, so their value still wins — the
-- new key is a floor, never an override.
--
-- search_path stays '' (this function qualifies everything it touches), which
-- is why public.post_photos is spelled out in the subquery below.
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
    'status',              p_post.status,
    'last_seen_at',        p_post.last_seen_at,
    'last_seen_area',      p_post.last_seen_area,
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

comment on function public.home_feed_post_json(public.posts, numeric) is
  'Serialises a post into the client PostSummary shape, including "photos" — the FIRST photo by position as [{url}], or [] (2026-08-06; previously photos were omitted entirely and the client faked them in __DEV__). Callers appending their own "photos" override this one, since this call sits left of the ||. Does NO status filtering; callers own the safety predicates. STABLE (timestamptz->json depends on the TimeZone GUC), not IMMUTABLE.';

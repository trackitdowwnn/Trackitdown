-- =============================================================================
-- WHAT: Corrects get_home_feed's stored COMMENT. No function body changes.
--
-- WHY:  20260806160000 introduced the owner exclusion as feed-only and said so
--       in its `comment on function`:
--
--         "EXCLUDES the caller's own posts (feed only — the map and search
--          still show them)."
--
--       20260806170000 extended the exclusion to get_nearby_posts, search_posts
--       and search_posts_count later the same day, but never re-issued that
--       comment — so the LIVE database describes a scope that stopped being
--       true minutes after it was written. `\df+` and every schema dump have
--       been reporting it ever since.
--
--       Comment-only: nothing here changes a predicate, a signature, or a
--       grant, so it is safe to apply to a database already running the
--       corrected functions.
-- =============================================================================

comment on function public.get_home_feed(double precision, double precision, integer) is
  'Composes the Explore home feed server-side in one call: { sections: [...] }. SECURITY DEFINER (bypasses RLS) so every query carries an explicit status predicate — active only, except recently_recovered (recovered states within 30 days, location snapped to a ~1km grid). Radius clamped to 1–50 miles. EXCLUDES the caller''s own posts, as do get_nearby_posts, search_posts and search_posts_count — every spotter-facing browse surface (20260806170000). See DOMAIN.md / SECURITY_AND_TRUST §2.';

-- =============================================================================
-- WHAT:  Makes the watchlist INSERT policy's recovered-post branch actually
--        reachable, via a SECURITY DEFINER predicate `post_is_watchable`.
--        No change to WHICH posts are watchable — only to whether the rule
--        already written down can be evaluated at all.
--
-- WHY:   `watchlist_items_insert_own_visible_post` (the Tier 1 see-before-act
--        gate) has always allowed a post that is either `active` OR recovered
--        inside its 30-day window. The second half has never worked. Its
--        `exists (select 1 from public.posts p ...)` runs under the CALLER's
--        RLS, and the only SELECT policies on posts are:
--            posts_select_active_public  (status = 'active')
--            posts_select_own            (owner_id = auth.uid())
--        so for a non-owner a recovered post is invisible, the EXISTS is false,
--        and the INSERT is denied. The branch was dead on arrival.
--
--        This is NOT theoretical. `get_my_watchlist` is SECURITY DEFINER and
--        deliberately returns a FULL payload for recovered-within-30-days
--        posts, and CollectionScreen renders those as a normal WatchedCardRow
--        — bookmark included. So the reachable sequence is:
--            1. a watched car is recovered; it moves to "No longer active"
--            2. the user taps the bookmark off (DELETE — allowed, no gate)
--            3. the row unmounts (WatchedCardRow returns null once unwatched)
--            4. the user taps it back on -> INSERT -> DENIED by RLS
--        and the way back is narrow to the point of unreliable.
--        `get_post_detail` gates on active-or-owner and `search_posts` is
--        active-only, so neither can re-surface it. `get_home_feed`'s
--        `recently_recovered` section CAN — it is public, anon included — but
--        only for a post with a non-null location, only within the caller's
--        <=50-mile radius, and only in the top 10 of that section. A recovered
--        car that is far away, location-less, or simply ranked 11th is gone
--        from the watchlist for good. That is the 30-day tombstone window
--        failing at exactly the thing it exists to preserve.
--
--        Fixed with a narrow SECURITY DEFINER predicate rather than a new
--        posts SELECT policy. Publishing recovered posts to everyone would
--        change the feed, search and detail visibility of every resolved post
--        in the app to fix a watchlist bug — a blast radius far larger than
--        the defect. This function answers exactly one question and nothing
--        else leaks through it.
--
-- SAFETY: `post_is_watchable` bypasses RLS by design, so it is deliberately
--        minimal: it takes a post id and returns a BOOLEAN. It exposes no
--        column, no owner, no location, no plate, no money. The status values
--        it reports on are exactly the ones the caller could already observe
--        via get_my_watchlist for their own watches. The argument is an
--        unguessable uuid (not a plate or an email), so it is not an
--        enumerable oracle. EXECUTE is granted to `authenticated` only and
--        explicitly REVOKED from anon/public — a logged-out caller has no
--        business asking, and anon holds no INSERT on watchlist_items anyway.
--
--        The one bit it discloses that is not already public: `get_home_feed`
--        only publishes recovered posts that have a location and fall inside
--        the caller's radius, so for a LOCATION-LESS recovered post this
--        function tells any authenticated holder of its id that the car was
--        found. Accepted — DOMAIN.md treats "recovered" as public social
--        proof, and the INSERT attempt itself leaks the same bit whether or
--        not this function exists (it is the gate's answer, not new
--        information). Recorded rather than hand-waved.
--
--        NOTE for anyone tempted to simplify: Postgres will not inline a
--        `language sql` function that is SECURITY DEFINER or carries a SET
--        clause. Both properties are load-bearing here — drop either and the
--        posts scan silently reverts to the CALLER's RLS, resurrecting the
--        exact dead branch this migration exists to fix.
--
-- LINKS: supabase/migrations/20260722100000_watchlist.sql (the original gate);
--        supabase/migrations/20260801110000_watchlist_collections.sql (the
--          collection-ownership clause preserved verbatim below);
--        supabase/tests/watchlist_verification.sql (CHECK 4 — was failing);
--        src/features/watchlist/screens/CollectionScreen.tsx (the reachable
--          re-watch path).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. The predicate.
-- STABLE, not VOLATILE: one statement's evaluation may be cached, which is what
-- lets the planner call it once per candidate row rather than once per
-- reference. It reads `now()`, which is stable within a transaction.
-- -----------------------------------------------------------------------------
create or replace function public.post_is_watchable(p_post_id uuid)
returns boolean
language sql
stable
security definer
-- Pinned search_path: a SECURITY DEFINER function without one is the classic
-- privilege-escalation hole (a caller-controlled path could resolve `posts` to
-- their own table). `pg_temp` LAST, per the PostgreSQL docs' own recommended
-- form — this deviates from the house `public, extensions` because the body
-- uses no extension operators, and a trailing pg_temp cannot shadow a
-- schema-qualified reference.
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.posts p
    where p.id = p_post_id
      and (
        p.status = 'active'
        or (
          p.status in ('recovered', 'recovered_no_spotter')
          and p.closed_at is not null
          and p.closed_at >= now() - interval '30 days'
        )
      )
  );
$$;

comment on function public.post_is_watchable(uuid) is
  'True when a post may be added to a watchlist: active, or recovered within '
  'the last 30 days. SECURITY DEFINER so the recovered branch is reachable — '
  'recovered posts are invisible under posts RLS. Returns a boolean only.';

-- Deny-by-default, then grant the one role that needs it. REVOKE FROM PUBLIC
-- first: Postgres grants EXECUTE to PUBLIC on new functions automatically, and
-- on Supabase that would hand it straight to anon.
revoke all on function public.post_is_watchable(uuid) from public;
revoke all on function public.post_is_watchable(uuid) from anon;
grant execute on function public.post_is_watchable(uuid) to authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 2. The policy.
-- The user_id and collection-ownership clauses are COPIED BYTE-FOR-BYTE from
-- 20260801110000_watchlist_collections.sql — only the posts EXISTS block is
-- replaced, by the predicate that encodes the same rule.
-- -----------------------------------------------------------------------------
alter policy watchlist_items_insert_own_visible_post
  on public.watchlist_items
  with check (
    user_id = (select auth.uid())
    and (
      collection_id is null
      or exists (
        select 1 from public.watchlist_collections c
        where c.id = watchlist_items.collection_id
          and c.user_id = (select auth.uid())
      )
    )
    and public.post_is_watchable(post_id)
  );

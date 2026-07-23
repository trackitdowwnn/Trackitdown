-- =============================================================================
-- WHAT:  Watchlist feature database layer. Adds posts.closed_at (a dedicated,
--        trigger-maintained "when did this post close" timestamp) and creates
--        public.watchlist_items (a user's private "watching" bookmarks on
--        posts, PK (user_id, post_id)) with deny-by-default RLS (own rows
--        only, insert pinned to the caller, anon gets nothing), plus the
--        SECURITY DEFINER RPC get_my_watchlist(), which returns the caller's
--        watches joined to posts — full payload for active and
--        publicly-visible recovered posts, a reduced TOMBSTONE for
--        expired/cancelled posts within 30 days of closing, and nothing at
--        all beyond that window.
-- WHY:   Spotters and worried owners want a "watching" list of posts they care
--        about. A watch is PRIVATE to the watcher: no owner-facing surface may
--        ever expose who watches a post or how many watchers it has (that
--        would let a poster gauge — or bait — attention on a specific car,
--        an anti-stalking concern). The list itself must also honour post
--        visibility: once a post closes and leaves its public window, its
--        details must stop flowing to watchers too. closed_at exists because
--        keying the window to updated_at would let ANY later write to a
--        closed post (moderation edit, anonymisation) re-extend the 30-day
--        tombstone window and leak post-close admin activity via resolved_at.
-- LINKS: docs/DOMAIN.md (post lifecycle; recovered 30-day public window),
--        docs/SECURITY_AND_TRUST.md §2 (closed posts hidden from search),
--        §6 (RLS deny by default; SECURITY DEFINER hardening),
--        supabase/migrations/20260707110712_payments_foundation.sql (posts,
--          post_status enum, RLS + column-grant house patterns),
--        supabase/migrations/20260711130000_home_feed_location_and_rpcs.sql
--          (home_feed_post_json helper; recovered_at; RPC hardening pattern),
--        supabase/migrations/20260713140000_post_detail.sql (post_photos),
--        supabase/tests/watchlist_verification.sql (Tier 1 gate for this file).
--
-- SAFETY NOTE ON DESTRUCTIVE STATEMENTS: none. Fully additive — one new posts
--        column + trigger + backfill UPDATE (fills only NULL closed_at on
--        already-closed rows), one new table + index, new RLS policies +
--        grants, new functions + grants. No drop/rename/truncate of any
--        existing object.
-- =============================================================================


-- =============================================================================
-- 1. POSTS: closed_at column + maintaining trigger
-- =============================================================================

alter table public.posts
  -- When the post entered a CLOSED state (recovered / recovered_no_spotter /
  -- cancelled / expired). Written ONLY by the trigger below (which freezes it
  -- once set — later writes to a closed post cannot move it). For the
  -- recovered states it mirrors recovered_at. SAFETY: like recovered_at it is
  -- excluded from every client column grant (the grants are explicit column
  -- lists, so a new column is excluded by default); a client-writable value
  -- here would let someone stretch or shrink the watchlist tombstone window.
  add column closed_at timestamptz;

comment on column public.posts.closed_at is
  'When status entered a closed state (recovered/recovered_no_spotter/cancelled/expired). Trigger-maintained (posts_set_closed_at); mirrors recovered_at for the recovered states; FROZEN once set so later writes to a closed post cannot move it. Excluded from all client grants. Drives the watchlist 30-day tombstone window.';

-- Trigger: maintain closed_at on every status transition into/out of a closed
-- state. BEFORE INSERT too, so server-side rows born closed (seed fixtures,
-- imports, service-role fixes) get a value without a separate write.
-- Allowed transitions of closed_at (each commented in the body):
--   * (not closed) -> closed : set to recovered_at if supplied, else now().
--   * closed -> closed       : FROZEN to the old value (drift/tamper guard —
--                              an UPDATE on an already-closed post must NOT
--                              move closed_at, even if a value is supplied).
--   * closed -> not closed   : cleared to NULL (a reopened post is not
--                              closed; keeps the timestamp honest).
create or replace function public.set_post_closed_at()
returns trigger
language plpgsql
-- Empty search_path (Supabase hardening, matches set_updated_at). The enum
-- comparisons below use untyped string literals, which need no search_path.
set search_path = ''
as $$
declare
  v_new_closed boolean := new.status in
    ('recovered', 'recovered_no_spotter', 'cancelled', 'expired');
  v_old_closed boolean := tg_op = 'UPDATE' and old.status in
    ('recovered', 'recovered_no_spotter', 'cancelled', 'expired');
begin
  if v_new_closed and not v_old_closed then
    -- ENTERING a closed state (or inserted already-closed). recovered_at wins
    -- when the same write sets it (the recovery Edge Function does); an
    -- explicitly supplied closed_at is honoured ONLY on INSERT (server-side
    -- backdated fixtures/imports — clients hold no grant on this column and
    -- can only insert status='draft' anyway, so only service role reaches it).
    if tg_op = 'INSERT' then
      new.closed_at := coalesce(new.closed_at, new.recovered_at, now());
    else
      new.closed_at := coalesce(new.recovered_at, now());
    end if;
  elsif v_new_closed and v_old_closed then
    -- ALREADY closed: freeze. SAFETY: without this, any later write to a
    -- closed post (moderation edit, anonymisation) could move closed_at and
    -- re-extend the watchlist tombstone window / leak post-close admin
    -- activity through resolved_at.
    new.closed_at := old.closed_at;
  else
    -- NOT closed (never closed, or a server-side reopen): no closed_at.
    new.closed_at := null;
  end if;
  return new;
end;
$$;

comment on function public.set_post_closed_at() is
  'Trigger function: maintains posts.closed_at across status transitions. Sets it on entry to a closed state (recovered_at if present, else now(); honours a supplied value on INSERT only), FREEZES it while closed, clears it on reopen.';

create trigger posts_set_closed_at
  before insert or update on public.posts
  for each row execute function public.set_post_closed_at();

-- Backfill rows that closed BEFORE the trigger existed: mirror recovered_at
-- for the recovered states; fall back to updated_at (at the moment this
-- migration ships, a closed row's last write WAS its closing transition, so
-- updated_at is the honest one-time approximation). Fills only NULLs.
-- The trigger is DISABLED for this one statement: a backfill UPDATE keeps
-- status closed->closed, so the trigger's freeze branch would overwrite the
-- value being set here with the old NULL. Re-enabled immediately after.
alter table public.posts disable trigger posts_set_closed_at;
update public.posts
set closed_at = coalesce(recovered_at, updated_at)
where status in ('recovered', 'recovered_no_spotter', 'cancelled', 'expired')
  and closed_at is null;
alter table public.posts enable trigger posts_set_closed_at;

-- Partial btree for the closed-window scans (watchlist tombstone/recovered
-- window; future janitor jobs pruning long-closed data).
create index posts_closed_at_idx
  on public.posts (closed_at)
  where status in ('recovered', 'recovered_no_spotter', 'cancelled', 'expired');


-- =============================================================================
-- 2. TABLE: watchlist_items
-- =============================================================================
create table public.watchlist_items (
  -- The watcher. FK to profiles (the house convention for user-owned rows —
  -- posts.owner_id, sightings.spotter_id, threads all reference profiles,
  -- which is 1:1 with auth.users). ON DELETE CASCADE: a watch is worthless
  -- without its watcher; GDPR erasure of the user removes their watches.
  user_id    uuid not null references public.profiles (id) on delete cascade,

  -- The watched post. ON DELETE CASCADE: a watch is a pure bookmark with no
  -- money state or independent value, so it dies with the post (contrast
  -- payments' ON DELETE RESTRICT, which protects money state).
  post_id    uuid not null references public.posts (id) on delete cascade,

  created_at timestamptz not null default now(),

  -- The (user, post) pair IS the identity: one watch per user per post, and
  -- the composite PK doubles as the index for every RLS predicate
  -- (user_id = auth.uid()) and the get_my_watchlist scan.
  primary key (user_id, post_id)
);

comment on table public.watchlist_items is
  'A user''s private watchlist bookmark on a post. PK (user_id, post_id). SAFETY: a watch is the watcher''s business — no owner-facing surface may ever expose watcher rows or counts. Read via get_my_watchlist().';
comment on column public.watchlist_items.created_at is
  'When the watch was created (watched_at in the RPC payload). Not client-suppliable — excluded from the INSERT column grant.';

-- Index for the FK's delete-cascade path and any future service-role
-- maintenance by post (e.g. pruning). The PK already covers user_id lookups.
create index watchlist_items_post_id_idx
  on public.watchlist_items (post_id);

alter table public.watchlist_items enable row level security;

-- SAFETY: under this project's config (auto_expose_new_tables unset) a new
-- table auto-grants NO data privileges, so the policies below are dead
-- without explicit grants. authenticated gets SELECT/DELETE and a
-- column-limited INSERT (user_id, post_id ONLY — created_at stays on its
-- default so a watch cannot be backdated). anon gets NOTHING: a watchlist
-- requires an account by definition. No UPDATE grant or policy exists —
-- there is nothing to update on a watch; toggling is delete + re-insert.
-- service_role bypasses RLS but is not auto-granted, so give it full DML.
grant select, delete on public.watchlist_items to authenticated;
grant insert (user_id, post_id) on public.watchlist_items to authenticated;
grant select, insert, update, delete on public.watchlist_items to service_role;

-- SAFETY: a user may read ONLY their own watches. Nobody else — not even the
-- watched post's owner — can see who watches a post (see the table comment:
-- watcher rows/counts are never owner-facing).
create policy watchlist_items_select_own
  on public.watchlist_items
  for select
  to authenticated
  using (user_id = (select auth.uid()));

-- SAFETY: a user may create a watch only AS themselves (user_id pinned to
-- auth.uid(); a spoofed user_id fails the check) and only on a post they can
-- currently SEE publicly: 'active', or a recovered state inside its 30-day
-- public social-proof window (DOMAIN.md). The window's clock is the FROZEN
-- closed_at (which the trigger sets from recovered_at at transition) — the
-- same clock get_my_watchlist reads with, so the watchable window and the
-- readable window can never diverge even if a service-role write later moves
-- recovered_at on a closed post (code review 2026-07-23). This mirrors the
-- public visibility rules so
-- the insert path is not an existence/status oracle for hidden posts
-- (draft/pending/cancelled/etc. are unwatchable, exactly as they are
-- unreadable). The repo enforces see-before-act elsewhere the same way
-- (create_sighting's POST_NOT_ACTIVE gate); here it fits in the policy.
create policy watchlist_items_insert_own_visible_post
  on public.watchlist_items
  for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.posts p
      where p.id = watchlist_items.post_id
        and (
          p.status = 'active'
          or (p.status in ('recovered', 'recovered_no_spotter')
              and p.closed_at is not null
              and p.closed_at >= now() - interval '30 days')
        )
    )
  );

-- SAFETY: a user may remove ONLY their own watches (unwatch).
create policy watchlist_items_delete_own
  on public.watchlist_items
  for delete
  to authenticated
  using (user_id = (select auth.uid()));

-- No UPDATE policy (and no UPDATE grant above): a watch has no mutable state.


-- =============================================================================
-- 3. RPC: get_my_watchlist() -> jsonb
-- =============================================================================
-- Returns the CALLER's watchlist as a JSON array, newest watch first. Each
-- element is the shared PostSummary shape (home_feed_post_json — the same
-- core the home feed emits) extended with:
--   'watched_at'    — when the caller watched it (watchlist_items.created_at)
--   'thumbnail_url' — the post's first photo (post_photos position 0), or null
--   'resolved_at'   — posts.closed_at: when the post left 'active' (trigger-
--                     maintained and FROZEN, so later admin writes to a closed
--                     post neither move the window nor show up here), or null
--                     while it is still active.
--
-- VISIBILITY (deliberate, approved DOMAIN carve-out — a watcher may see
-- slightly more of a CLOSED post than the anonymous public, because they
-- explicitly bookmarked it while it was public):
--   * active                              -> full payload, resolved_at null.
--   * recovered / recovered_no_spotter    -> full payload while inside the
--     30-day window from closed_at (which mirrors recovered_at, so this is
--     identical to what the home feed already shows publicly), then GONE.
--   * expired / cancelled (NOT publicly readable states) -> a TOMBSTONE for
--     30 days after closed_at, then GONE. The tombstone carries ONLY: id,
--     watched_at, status, make, model, colour, resolved_at, thumbnail_url,
--     and EXPLICIT NULLs for plate, bounty_amount_pence, last_seen_at,
--     last_seen_area, distance_miles, created_at.
--     // SAFETY: the tombstone deliberately exposes LESS than the post's
--     // active-era public payload (no plate, no bounty, no location fields)
--     // and only to that post's own watcher — enough to explain "this post
--     // you watched has closed", never enough to keep tracking the car.
--   * every other status (draft, pending_verification, recovery_claimed,
--     rejected) -> row EXCLUDED entirely. A watched post passing through
--     recovery_claimed briefly disappears from the list and returns once it
--     lands in a recovered state; hidden states must not leak even to a
--     watcher (SECURITY_AND_TRUST §2).
--
-- SAFETY (Tier 1 — read before editing): SECURITY DEFINER, so RLS is
--   bypassed. The user_id = v_viewer predicate is the ONLY thing keeping one
--   user's watchlist out of another's hands, and the status/window
--   predicates are the ONLY things keeping closed-post data from flowing.
--   Never weaken them or rely on RLS to backstop them.
--   (supabase/tests/watchlist_verification.sql asserts all of this.)
--
-- auth.uid() reads the CALLER's JWT claim (a request GUC), so it identifies
-- the caller even though the body runs as the definer. Anon / missing uid ->
-- empty array (and anon holds no EXECUTE anyway — see the grant below).
--
-- search_path fixed to public, extensions to match the house RPC pattern
-- (home_feed_post_json lives in public). STABLE: reads only.
create or replace function public.get_my_watchlist()
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

  select coalesce(jsonb_agg(t.item order by t.watched_at desc), '[]'::jsonb)
    into v_result
  from (
    select
      w.created_at as watched_at,
      case
        -- ---------------------------------------------------------------
        -- FULL PAYLOAD: active, or recovered inside the 30-day window
        -- from closed_at (mirrors recovered_at — identical to the home
        -- feed's public window). Same core shape the home feed emits,
        -- plus the watch fields. resolved_at is null while active.
        -- ---------------------------------------------------------------
        when p.status = 'active'
          or (p.status in ('recovered', 'recovered_no_spotter')
              and p.closed_at is not null
              and p.closed_at >= now() - interval '30 days')
        then public.home_feed_post_json(p, null::numeric)
             || jsonb_build_object(
                  'watched_at',    w.created_at,
                  'thumbnail_url', ph.url,
                  'resolved_at',   case when p.status = 'active'
                                        then null else p.closed_at end)
        -- ---------------------------------------------------------------
        -- TOMBSTONE: expired/cancelled within 30 days of closed_at (the
        -- FROZEN transition timestamp — later writes to the closed post
        -- cannot re-extend this window). EXPLICIT NULLs for plate,
        -- bounty, and every location/time field.
        -- SAFETY: exposes less than the active-era public payload, and
        -- only to this post's own watcher. Do not widen.
        -- ---------------------------------------------------------------
        when p.status in ('expired', 'cancelled')
          and p.closed_at is not null
          and p.closed_at >= now() - interval '30 days'
        then jsonb_build_object(
               'id',                  p.id,
               'watched_at',          w.created_at,
               'status',              p.status,
               'make',                p.make,
               'model',               p.model,
               'colour',              p.colour,
               'resolved_at',         p.closed_at,
               'thumbnail_url',       ph.url,
               -- Explicit NULLs: sensitive fields are tombstoned, not omitted,
               -- so the client shape stays stable and the redaction is loud.
               'plate',               null,
               'bounty_amount_pence', null,
               'last_seen_at',        null,
               'last_seen_area',      null,
               'distance_miles',      null,
               'created_at',          null)
        -- Everything else (hidden states; resolved beyond +30d) -> excluded
        -- by the WHERE below; this NULL is unreachable belt-and-braces.
        else null
      end as item
    from public.watchlist_items w
    join public.posts p on p.id = w.post_id
    -- First photo (position order) as the thumbnail; null when none.
    left join lateral (
      select pp.url
      from public.post_photos pp
      where pp.post_id = p.id
      order by pp.position
      limit 1
    ) ph on true
    where w.user_id = v_viewer               -- SAFETY: caller's rows ONLY
      and (
        p.status = 'active'
        or (p.status in ('recovered', 'recovered_no_spotter',
                         'expired', 'cancelled')
            and p.closed_at is not null
            and p.closed_at >= now() - interval '30 days')
      )
  ) t;

  return v_result;
end;
$$;

comment on function public.get_my_watchlist() is
  'Returns the caller''s watchlist as a JSON array, newest watch first. SECURITY DEFINER (bypasses RLS): user_id = auth.uid() is the only ownership gate. Active + recovered-within-30d posts return the full home-feed payload (+watched_at/thumbnail_url/resolved_at); expired/cancelled within 30d of closed_at return a reduced tombstone (explicit NULL plate/bounty/location); everything else is excluded. closed_at is trigger-frozen so post-close writes cannot re-extend any window. Anon -> [].';


-- =============================================================================
-- 4. FUNCTION GRANTS
-- =============================================================================
-- SAFETY: functions default to EXECUTE granted to PUBLIC. Lock down and grant
-- deliberately: authenticated + service_role ONLY. anon deliberately gets NO
-- execute (a watchlist requires an account; the 20260713191000 incident class
-- is why anon must be grant-denied, not just body-denied).
revoke execute on function public.get_my_watchlist() from public;
grant  execute on function public.get_my_watchlist()
  to authenticated, service_role;

-- Internal trigger function: NOT client-callable (matches the slugify /
-- home_feed_post_json pattern of revoking the default PUBLIC execute).
revoke execute on function public.set_post_closed_at() from public;


-- =============================================================================
-- END OF MIGRATION
-- =============================================================================

-- =============================================================================
-- WHAT:  "Archive a listing" — an owner may file their OWN closed listings
--        (recovered, recovered_no_spotter, cancelled, expired) into a
--        collapsed "Archived" section on My listings, and take them out again.
--          1. posts.archived_at timestamptz null — server-only (NO client
--             SELECT / INSERT / UPDATE column grant).
--          2. public.set_post_archived(uuid, boolean) -> jsonb — the ONLY way
--             a client sets or clears it.
--          3. posts_clear_archived_at trigger — a post that is (or becomes)
--             not closed never carries an archived_at.
--          4. public.list_my_posts() re-issued with 'archived_at' on each row.
-- WHY:   Purely personal organisation, stored on the account so it follows
--        the owner across devices. It changes NOTHING public: no status, no
--        money, no visibility. The only reader is the owner's own list.
-- LINKS: docs/DOMAIN.md ("The stolen-car post lifecycle" — the closed four;
--          dispute resolution can move cancelled -> recovery_claimed),
--        docs/SECURITY_AND_TRUST.md §6 (deny by default; SECURITY DEFINER),
--        supabase/migrations/20260727100000_list_my_posts.sql (the body copied
--          verbatim in section 4),
--        supabase/migrations/20260810180000_posts_location_column_not_readable_by_anon.sql
--          (the enumerated posts SELECT grant this column stays OUT of),
--        supabase/migrations/20260802110000_post_alert_columns.sql (the last
--          full client UPDATE column grant on posts — this column stays OUT),
--        supabase/migrations/20260722100000_watchlist.sql (set_post_closed_at —
--          the closed-set definition and trigger shape mirrored in section 3),
--        supabase/migrations/20260805100000_refund_holds_and_disputes.sql
--          (resolve_sighting_dispute — the one closed -> open transition).
--
-- SAFETY NOTE ON DESTRUCTIVE STATEMENTS: none. Additive only: one nullable
--        column, one function, one trigger function + trigger, and a
--        `create or replace` of list_my_posts whose RETURN TYPE IS UNCHANGED
--        (jsonb — it never had a RETURNS TABLE), so no DROP FUNCTION is needed
--        and its existing ACL survives. Nothing is dropped or renamed.
--
-- BEHAVIOUR CHANGE (small, deliberate): section 5 now revokes EXECUTE on
--        list_my_posts from anon. The 2026-07-27 migration SAID anon gets no
--        execute but only revoked from PUBLIC; Supabase's default privileges
--        grant anon EXECUTE directly, so anon has held it all along (harmless:
--        the body returns [] without a uid). This closes it to match the
--        documented intent. Authenticated / service_role are unchanged.
-- =============================================================================


-- =============================================================================
-- 1. COLUMN: posts.archived_at
-- =============================================================================
-- Nullable: NULL = not archived. No default, no backfill — every existing
-- listing starts un-archived.
--
-- GRANTS (read before editing): deliberately NONE for anon / authenticated.
--   * SELECT — 20260810180000 replaced the table-wide SELECT grant with an
--     ENUMERATED column list precisely so a new column is NOT silently
--     readable. archived_at is not added to it. Whether an owner archived a
--     listing is their private filing; there is no reason for anon (or anyone
--     else under posts_select_active) to read it, and the owner reads it
--     through list_my_posts (SECURITY DEFINER), which is the only surface that
--     needs it.
--   * UPDATE — the client UPDATE grant is also an enumerated column list
--     (last re-issued in full by 20260802110000). archived_at is not added: a
--     direct write would bypass the closed-only rule in set_post_archived, and
--     the draft-only RLS UPDATE policy would refuse closed rows anyway, so a
--     grant could only ever be a hole, never a feature.
--   * INSERT — likewise enumerated; not added.
--   service_role holds table-level DML (20260707110712) and so covers it.
-- No index: nothing filters on archived_at. list_my_posts selects by owner_id
-- (posts_owner_id_idx) and the client splits the result into two sections.
alter table public.posts
  add column archived_at timestamptz null;

comment on column public.posts.archived_at is
  'When the OWNER filed this closed listing into their "Archived" section (null = not archived). Personal organisation only: no effect on status, money or visibility. Set/cleared ONLY by set_post_archived(); cleared automatically by posts_clear_archived_at if the post is ever not closed. NO anon/authenticated column grant — read it through list_my_posts().';


-- =============================================================================
-- 2. TRIGGER: a post that is not closed is never archived
-- =============================================================================
-- STATUS TRANSITIONS FOUND (docs/DOMAIN.md + every `set status` in the chain):
--   * No owner-facing path reopens a closed post. There is no renew / relist,
--     `expired` and `rejected` are retired (nothing enters them), and the
--     payment webhooks move to 'active' only from 'draft'.
--   * ONE server path moves closed -> open: resolve_sighting_dispute
--     (20260805100000, service-role only) upholds a spotter's dispute on a
--     held, CANCELLED post and moves it cancelled -> recovery_claimed, back
--     onto the money rails. An archived listing whose money is moving again
--     must not stay hidden in a collapsed section.
-- CHOICE: a trigger rather than edits to each RPC, so this holds for that path
-- AND for any future reopen (or a service-role hand fix) without anyone having
-- to remember archived_at. It mirrors set_post_closed_at, which already clears
-- closed_at on reopen for the same reason. It also backstops set_post_archived:
-- even a service-role write cannot leave a non-closed post archived.
--
-- Closed -> closed (e.g. a hypothetical recovered_no_spotter correction) KEEPS
-- the archive: the listing is still closed, so the owner's filing stands.
--
-- `before insert or update` (not `update of status`) so an INSERT born open, or
-- an UPDATE that sets archived_at on an open row, is also normalised.
-- Empty search_path, matching set_post_closed_at: the enum comparison uses
-- untyped literals, which need no search_path.
create or replace function public.clear_post_archived_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.archived_at is not null
     and new.status not in ('recovered', 'recovered_no_spotter', 'cancelled', 'expired') then
    new.archived_at := null;
  end if;
  return new;
end;
$$;

comment on function public.clear_post_archived_at() is
  'Trigger function: nulls posts.archived_at whenever the row''s status is not one of the closed four (recovered, recovered_no_spotter, cancelled, expired). Covers the one closed -> open path (resolve_sighting_dispute: cancelled -> recovery_claimed) and any future reopen.';

-- Trigger functions are never called directly; keep them off the RPC surface.
revoke execute on function public.clear_post_archived_at() from public, anon, authenticated;

create trigger posts_clear_archived_at
  before insert or update on public.posts
  for each row execute function public.clear_post_archived_at();


-- =============================================================================
-- 3. RPC: set_post_archived(p_post_id uuid, p_archived boolean) -> jsonb
-- =============================================================================
-- Archives (p_archived = true) or unarchives (false) one of the CALLER's own
-- posts. Returns { "postId": uuid, "archivedAt": timestamptz | null }.
--
-- Errors (raised as the exception message, like claim_recovery):
--   NOT_AUTHENTICATED — no auth.uid() in the JWT.
--   POST_NOT_FOUND    — no such post (or p_post_id is null).
--   NOT_OWNER         — the post belongs to someone else.
--   NOT_CLOSED        — archiving a post whose status is not one of the closed
--                       four. Unarchiving is allowed in ANY status (a no-op on
--                       an open post, which the trigger guarantees is never
--                       archived anyway).
--
-- Transitions of archived_at (status is NEVER touched):
--   null     --archive-->   now()     (closed posts only)
--   set      --archive-->   unchanged (idempotent: keeps the ORIGINAL time)
--   set      --unarchive--> null
--   null     --unarchive--> null      (idempotent)
--
-- SAFETY (Tier 1 — read before editing): SECURITY DEFINER, so RLS and the
--   column grants are BYPASSED. Ownership comes from auth.uid() (the caller's
--   JWT), never from an argument; the `v_owner <> v_caller` check is the only
--   thing stopping one user filing another's post. The row is locked FOR UPDATE
--   so a concurrent status change (e.g. a dispute reopening it) cannot
--   interleave between the NOT_CLOSED check and the write.
--
-- NO audit_log insert: archiving is an owner's personal filing, not a
--   moderator, money or status action, and no audit_log table exists yet
--   (SECURITY_AND_TRUST §7 — deferred with moderation).
create or replace function public.set_post_archived(
  p_post_id  uuid,
  p_archived boolean
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller   uuid := auth.uid();
  v_owner    uuid;
  v_status   public.post_status;
  v_archived timestamptz;
begin
  if v_caller is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select owner_id, status, archived_at
    into v_owner, v_status, v_archived
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

  if coalesce(p_archived, false) then
    -- Only a CLOSED listing may be archived. An allowlist, so a new enum value
    -- is refused until someone decides it is closed. Same four as
    -- set_post_closed_at.
    if v_status not in ('recovered', 'recovered_no_spotter', 'cancelled', 'expired') then
      raise exception 'NOT_CLOSED';
    end if;
    -- Idempotent: only a REPEAT archive (the post is already archived) skips
    -- the write, so it keeps its original archived_at and updated_at stays put.
    -- A REAL archive (and a real unarchive below) DOES write the row, so
    -- posts_set_updated_at fires and posts.updated_at moves. posts.updated_at
    -- therefore no longer means "content last changed" — archive filing
    -- moves it too.
    if v_archived is null then
      update public.posts
         set archived_at = now()
       where id = p_post_id
      returning archived_at into v_archived;
    end if;
  else
    -- Unarchive: allowed any time. Skip the write when already null.
    if v_archived is not null then
      update public.posts
         set archived_at = null
       where id = p_post_id;
      v_archived := null;
    end if;
  end if;

  return jsonb_build_object('postId', p_post_id, 'archivedAt', v_archived);
end;
$$;

comment on function public.set_post_archived(uuid, boolean) is
  'Owner-only: archive (true) or unarchive (false) one of the caller''s own posts. Archiving requires a closed status (recovered, recovered_no_spotter, cancelled, expired) and is idempotent (keeps the original archived_at); unarchiving is allowed any time. Returns {postId, archivedAt}. Raises NOT_AUTHENTICATED, POST_NOT_FOUND, NOT_OWNER, NOT_CLOSED. Touches ONLY posts.archived_at — never status or money. SECURITY DEFINER; ownership from auth.uid().';

-- SAFETY: functions default to EXECUTE for PUBLIC, and Supabase's default
-- privileges grant anon directly — so anon is named explicitly. Signed-in
-- owners only.
revoke execute on function public.set_post_archived(uuid, boolean) from public;
revoke execute on function public.set_post_archived(uuid, boolean) from anon;
grant  execute on function public.set_post_archived(uuid, boolean) to authenticated;


-- =============================================================================
-- 4. RPC: list_my_posts() -> jsonb — now carries 'archived_at'
-- =============================================================================
-- Body copied VERBATIM from 20260727100000_list_my_posts.sql (its only
-- definition — no later migration redefined it; the PostSummary core it calls,
-- home_feed_post_json, has changed since and is picked up by reference as
-- before). The ONE change: 'archived_at' is added to the per-row object
-- alongside 'photos' (snake_case, like every other key in this row; a
-- timestamptz rendered as an ISO string, or JSON null when not archived).
--
-- The return type is still jsonb, so `create or replace` is enough — no DROP.
--
-- Returns the CALLER's own posts as a JSON array, newest first (created_at
-- desc). Each element is the shared PostSummary core (home_feed_post_json —
-- the same shape the home feed emits: id, plate, make, model, colour,
-- bounty_amount_pence, status, last_seen_at, last_seen_area, distance_miles
-- [always null here — this list is not location-scoped], created_at) extended
-- with:
--   'photos'      — a JSON array with the post's FIRST photo as [{ "url": ... }]
--                   (lowest post_photos.position), or [] when the post has none.
--                   Kept as an array (not a bare url) so the client maps it
--                   straight to PostSummary.photos: [{ uri }] with no reshaping.
--   'archived_at' — when the owner archived the listing, or null. The client
--                   puts non-null rows in the collapsed "Archived" section.
--                   This is the ONLY client read of posts.archived_at.
--
-- STATUS COVERAGE: ALL statuses are returned unfiltered. This is deliberately
-- the opposite of the home feed / watchlist visibility rules — those hide
-- non-active/closed posts from OTHER users (anti-stalking). Here the caller is
-- the OWNER of every row, so a draft, pending_verification, recovery_claimed,
-- cancelled, expired, or rejected post is all correctly theirs to see. The
-- client 'My Listings' surface renders the status badge per card. Archived
-- posts are INCLUDED (not filtered out) — archiving moves a card, not hides it.
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
      -- list, so pass null), extended with the first-photo array and the
      -- owner's archive stamp.
      public.home_feed_post_json(p, null::numeric)
        || jsonb_build_object(
             'photos',
             case
               when ph.url is not null
                 then jsonb_build_array(jsonb_build_object('url', ph.url))
               else '[]'::jsonb
             end,
             'archived_at',
             p.archived_at
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
  'Returns the caller''s own posts as a JSON array, newest first (created_at desc), across ALL lifecycle statuses. Each element is the home_feed_post_json PostSummary core plus a "photos" array carrying the first photo ([{url}] or []) and "archived_at" (timestamptz or null — the owner''s archive stamp, set by set_post_archived). SECURITY DEFINER (bypasses RLS): owner_id = auth.uid() is the only ownership gate. Anon -> [].';


-- =============================================================================
-- 5. FUNCTION GRANT (restated)
-- =============================================================================
-- `create or replace` keeps the existing ACL, so the first and last lines only
-- restate 20260727100000. The anon revoke is NEW — see BEHAVIOUR CHANGE in the
-- header: that migration intended "anon deliberately gets NO execute" but
-- revoked only from PUBLIC, and Supabase's default privileges grant anon
-- directly.
revoke execute on function public.list_my_posts() from public;
revoke execute on function public.list_my_posts() from anon;
grant  execute on function public.list_my_posts()
  to authenticated, service_role;


-- =============================================================================
-- END OF MIGRATION
-- =============================================================================

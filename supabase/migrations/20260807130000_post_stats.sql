-- =============================================================================
-- WHAT: get_post_stats(post_id) -> jsonb. What has happened to ONE of the
--       caller's own listings, aggregated server-side into a single object of
--       counts. Plus the index that count needs.
--
-- WHY:  An owner can see their post and their sightings, but nothing told them
--       whether the thing is working — how many spotters were reached, whether
--       reports have gone quiet, how long is left on the clock. Those answers
--       already exist across four tables and have never been assembled.
--
--       Counts, never rows. The client receives integers and two timestamps;
--       it does not receive a spotter list or a notification ledger.
--
-- SAFETY: OWNER ONLY, and the ownership test is the only gate — owner_id =
--   auth.uid(), no user-id parameter, exactly like list_my_posts. A post the
--   caller does not own returns NULL, the same answer a post that does not
--   exist returns: no existence oracle, no status oracle. Revoked from anon.
--
--   ⚠️ NO WATCHER COUNT, and this is not an oversight to be corrected.
--   DOMAIN.md ("A watch is the watcher's business: no owner-facing surface ever
--   exposes watcher rows, COUNTS, or existence") forbids it in those exact
--   terms, and watchlist_verification CHECK 8 is that rule in executable form.
--   A first draft of this function counted watchlist_items and allowlisted
--   itself past that check; the count is a live delta oracle, because an owner
--   controls when a listing becomes reachable by a chosen person and can
--   re-read the number on demand — 0→1 attributes that watch with certainty.
--   Reinstating it needs DOMAIN.md amended first, not a comment here.
--
--   ⚠️ spotters_alerted IS FLOORED, for the same reason get_alert_reach's
--   count is (20260807120000). Both answer "how many alert zones cover this
--   point", and this one is reachable for the price of posting a car: an exact
--   unfloored answer would route around that floor for the cost of a cancelled
--   listing. Below the floor it reports 0.
--
-- ⚠️ WHY NOTIFICATIONS AND NOT push_sends: push_sends looks like the alert
--   ledger and is the wrong table. match_alert_zones purges it GLOBALLY on
--   every fan-out (`delete … where created_at < now() - interval '30 days'`,
--   20260802130000:416) while posts live 90 days — so a still-live listing
--   would silently report 0 alerted from about day 31, and the drop would be
--   triggered by some unrelated post going live. An owner seeing "0 spotters
--   alerted" on day 40 of a real theft could cancel a listing that had in fact
--   reached hundreds. notifications is purged at 90 days (20260806110000),
--   matching a post's own lifetime, and it is the row that lands even when a
--   spotter has push denied — so it is also the truer count of who was told.
--
-- SAFETY NOTE ON DESTRUCTIVE STATEMENTS: none. One new function, one new
--   index. No table, column, enum, policy or existing function is altered.
--
-- LINKS: supabase/migrations/20260721100000_my_posts.sql (list_my_posts — the
--          ownership-gate pattern this copies);
--        supabase/migrations/20260807120000_alert_reach_count.sql (the floor
--          this one matches, and why);
--        supabase/functions/_shared/push.ts (notifyUsers — writes the rows
--          counted here, payload = { type, postId });
--        docs/DOMAIN.md (the watcher rule), docs/SECURITY_AND_TRUST.md §2, §6.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. The index the alert count needs.
--
-- notifications carries (user_id, created_at desc) and a partial unread index —
-- both lead with user_id, which serves the notification centre's "my feed"
-- read. Counting by SUBJECT asks the opposite question and can use neither, so
-- without this it is a sequential scan of every notification ever written.
-- Partial on kind = 'alert': that is the only kind this counts, and it keeps
-- the index off the sighting/message/recovery rows that dominate the table.
-- -----------------------------------------------------------------------------
create index if not exists notifications_alert_subject_idx
  on public.notifications ((payload ->> 'postId'))
  where kind = 'alert';

comment on index public.notifications_alert_subject_idx is
  'Counting alerted spotters BY POST (get_post_stats.spotters_alerted). The two older notifications indexes both lead with user_id for the notification centre''s own feed read, which cannot serve a per-post count. Partial on kind=''alert'' — the only kind counted, and it keeps the index off the far more numerous sighting/message rows; that predicate is also the WATCHER GATE described on the function itself, so the two must stay in step. Built NON-concurrently because Supabase migrations run in a transaction and CREATE INDEX CONCURRENTLY cannot: not an oversight. ⚠️ THE COST IS REAL AND USER-FACING, corrected 2026-08-08 — an earlier version of this comment claimed the only writer was the service role via notifyUsers, so the SHARE lock could stall nothing but a background function. That is false: mark_notification_read, mark_notifications_read_by_payload and mark_all_notifications_read are SECURITY DEFINER UPDATEs granted to authenticated and fired by a user tapping an inbox row or a push. The lock is held for the WHOLE migration transaction, not just the build; a queued SHARE also blocks subsequent ACCESS SHARE, so inbox READS can stall behind it; and a blocked statement errors rather than waits once it passes statement_timeout (8s for authenticated on Supabase). The decision still stands on a table bounded by the 90-day purge — the build is short and a mark-read that fails is retried by the next tap — but deploy it off-peak, and if notifications ever grows unbounded, move this to its own migration and build it CONCURRENTLY outside a transaction.';


-- -----------------------------------------------------------------------------
-- 1b. A retention invariant this function now depends on.
--
-- Recorded against purge_old_notifications itself (additively, from here —
-- 20260806110000 is already applied and this project corrects comments with a
-- new migration rather than by editing history; see 20260807100000).
--
-- The invariant is NOT "keep 90 days". It is "keep at least as long as a post
-- can live". Two different edits break it and neither is in this file:
--   * shortening the purge window;
--   * EXTENDING post lifetime. DOMAIN.md allows renewal ("default 90 days,
--     owner can renew") and nothing implements it yet — the day it ships, a
--     renewed post outlives the window and reports 0 alerted from day 91.
-- Either way a live listing silently claims it reached nobody, which is the
-- exact push_sends trap this migration switched away from.
-- -----------------------------------------------------------------------------
comment on function public.purge_old_notifications() is
  'The 90-day feed retention (ADR-0012 §8). Called hourly by release-held-refunds (Phase 0) and daily by the dashboard cron job purge-old-notifications — both idempotent. Age-only: read state never extends retention. SERVICE ROLE ONLY. ⚠️ RETENTION INVARIANT (added 20260807130000): get_post_stats.spotters_alerted counts the kind=''alert'' rows this deletes, so this window must stay >= THE MAXIMUM POST LIFETIME — 90 days on both sides today. Shortening it, or extending post lifetime (renewal, which DOMAIN.md allows and nothing implements yet), makes a still-live listing report 0 spotters alerted: the push_sends trap that RPC switched away from. Note also that notifications.user_id cascades on profile deletion, so the count drifts down as recipients delete accounts — correct behaviour (they no longer exist), and the reportable floor absorbs small drift.';


-- -----------------------------------------------------------------------------
-- 2. get_post_stats(post_id) -> jsonb
-- -----------------------------------------------------------------------------
create or replace function public.get_post_stats(p_post_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  -- Below this, report 0. Kept identical to get_alert_reach's floor on
  -- purpose: the two functions answer the same question about the same rows,
  -- and a difference between them is a way around the stricter one.
  c_min_reportable constant integer := 5;
  v_post    public.posts%rowtype;
  v_first   timestamptz;
  v_last    timestamptz;
  v_alerted integer;
begin
  -- The ONLY gate. A post owned by someone else and a post that does not exist
  -- return the same NULL, and this returns BEFORE any aggregate runs, so the
  -- two cases are not even distinguishable by how long the call takes.
  select * into v_post
  from public.posts
  where id = p_post_id
    and owner_id = auth.uid();

  if not found then
    return null;
  end if;

  select min(created_at), max(created_at)
    into v_first, v_last
  from public.sightings
  where post_id = p_post_id;

  -- Distinct users, not rows: the number means PEOPLE.
  --
  -- ⚠️ `kind = 'alert'` IS THE WATCHER GATE, not a tidy-up. recovery,
  -- credited, sighting, closed_uncredited and not_credited rows all carry the
  -- same payload ->> 'postId' for the same post, and
  -- claim_recovery_notifications draws its audience straight from the watch
  -- table — so dropping this predicate turns spotters_alerted into
  -- alerted + WATCHERS, the count DOMAIN.md forbids showing an owner in those
  -- exact terms. CHECK 16 seeds a recovery row on the same post to prove it
  -- stays excluded.
  --
  -- The watch table is named here in PROSE, never in code, and that is
  -- deliberate: watchlist_verification CHECK 8 greps pg_proc.prosrc for the
  -- table name to prove no second query path exists, so it cannot tell a
  -- reference from a mention. Writing the name in this comment failed that
  -- check — correctly, in the sense that a function claiming to reason about
  -- watch rows deserves a second look, and this one now says why it does not
  -- touch them.
  --
  -- ⚠️ prosrc is only the text inside the dollar-quoted body, which is why the
  -- file header above may spell the table out and this paragraph may not.
  -- Moving prose across that boundary in either direction changes what CHECK 8
  -- sees, and it fails with no hint that a comment was the cause.
  --
  -- (And do not write the dollar-quote delimiter itself in here: a literal pair
  -- terminates the body early and the migration dies on a syntax error several
  -- lines later. Asking for that mistake is how this parenthesis got written.)
  --
  -- The caller exclusion is the third belt: match_alert_zones excludes the
  -- owner and notify-spotters re-filters, but it is free here and means the
  -- reader can never be inside their own number if either is relaxed.
  select count(distinct user_id)
    into v_alerted
  from public.notifications
  where kind = 'alert'
    and payload ->> 'postId' = p_post_id::text
    and user_id is distinct from auth.uid();

  if coalesce(v_alerted, 0) < c_min_reportable then
    v_alerted := 0;
  end if;

  return jsonb_build_object(
    'spotters_alerted', v_alerted,

    -- --- The clock ---------------------------------------------------------
    'created_at', v_post.created_at,
    'expires_at', v_post.expires_at,

    -- --- Sightings, split honestly -----------------------------------------
    -- 'unverified' is not 'credited', and collapsing them would overstate what
    -- has been established. Four scans of sightings_post_created_idx, which is
    -- cheap at the tens-of-rows a single post ever carries; a filtered
    -- single-pass rollup would be denser to read for no measurable gain.
    'sightings_total',      (select count(*) from public.sightings where post_id = p_post_id),
    'sightings_unverified', (select count(*) from public.sightings where post_id = p_post_id and status = 'unverified'),
    'sightings_helpful',    (select count(*) from public.sightings where post_id = p_post_id and status = 'helpful'),
    'sightings_credited',   (select count(*) from public.sightings where post_id = p_post_id and status = 'credited'),
    'first_sighting_at',    v_first,
    'last_sighting_at',     v_last,

    -- --- The trend ---------------------------------------------------------
    -- One row per DAY THAT HAS AT LEAST ONE sighting: [{day, count}, …],
    -- oldest first. Deliberately sparse — the client fills the empty days,
    -- because it is the side that knows how wide the chart is.
    --
    -- `at time zone 'UTC'` is load-bearing, not decoration. date_trunc on a
    -- timestamptz buckets by the SESSION timezone, which is UTC on Supabase
    -- today but is not a guarantee — under Europe/London a sighting at 23:30
    -- UTC would bucket to the NEXT day here while the client (which anchors on
    -- UTC midnight) looks up the previous one, find no match, and silently drop
    -- the bar. A sighting disappearing from an owner's chart is not a defect
    -- anyone would report; it would just look like a quiet day. Converting to a
    -- plain timestamp first makes the day independent of session settings.
    'sightings_by_day', coalesce((
      select jsonb_agg(jsonb_build_object('day', d.day, 'count', d.n) order by d.day)
      from (
        select (created_at at time zone 'UTC')::date as day, count(*) as n
        from public.sightings
        where post_id = p_post_id
        group by 1
      ) d
    ), '[]'::jsonb),

    -- --- Contact made ------------------------------------------------------
    -- BOTH figures are kind='user' only. open_thread writes a kind='system'
    -- safety message on creation, so counting every message row would report
    -- "1 message" for a conversation nobody has spoken in.
    --
    -- The same row makes an EMPTY thread possible: a spotter can open one and
    -- never type. Counting those here gave "Conversations 1 / Messages 0" — the
    -- literal wall of zeros this screen exists to avoid, and worse, it tells an
    -- owner mid-theft that someone reached out and said nothing. A thread with
    -- no user message is not a conversation, so it is not counted as one; the
    -- screen then degrades the whole block to a sentence, as it should.
    'conversations', (
      select count(*)
      from public.threads t
      where t.post_id = p_post_id
        and exists (
          select 1 from public.messages m
          where m.thread_id = t.id and m.kind = 'user'
        )
    ),
    'messages', (
      select count(*)
      from public.messages m
      join public.threads t on t.id = m.thread_id
      where t.post_id = p_post_id
        and m.kind = 'user'
    )
  );
end;
$$;

comment on function public.get_post_stats(uuid) is
  'What has happened to ONE of the caller''s own listings, as a single object of counts: spotters_alerted (distinct recipients of the kind=alert notification for this post, FLOORED to 0 below 5), created_at/expires_at, sightings_total and the unverified/helpful/credited split, first_sighting_at/last_sighting_at, sightings_by_day ([{day,count}] for days that HAVE sightings, oldest first, UTC days — the client fills the gaps), conversations and messages (kind=user only; open_thread''s system safety row is not a message anyone sent). SECURITY DEFINER; owner_id = auth.uid() is the ONLY gate and there is no user-id parameter; a post owned by someone else returns the SAME null as one that does not exist, before any aggregate runs. Revoked from anon. DELIBERATELY carries NO watcher count — DOMAIN.md forbids exposing watcher rows, counts or existence to an owner, and a count is a delta oracle when the owner controls who can reach the listing. Counts alerted spotters from notifications, NOT push_sends: push_sends is purged globally at 30 days while posts live 90, so it would silently decay to 0 mid-life. THE SHAPE MAY NOT GROW to per-person granularity, and must never gain a time series over spotters_alerted — a timestamped reach series would reintroduce exactly the delta oracle the watcher count was dropped for. The sightings day series is permitted because an owner may already enumerate their own sightings individually.';

revoke execute on function public.get_post_stats(uuid) from public, anon;
grant execute on function public.get_post_stats(uuid) to authenticated, service_role;

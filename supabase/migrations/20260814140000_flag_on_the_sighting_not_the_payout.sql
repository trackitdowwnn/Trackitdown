-- =============================================================================
-- WHAT: Three corrections to 20260814110000–130000, found in review.
--         1. The badge-path collusion flag moves OFF payout_reviews and onto
--            the sighting row (new columns review_flags, counted_at)
--         2. get_post_stats gains a `not_mine` bucket
--         3. (client) the timeline's confirmed chip stops claiming not_mine
--
-- WHY:  ⚠️ 1 IS A MONEY-PATH REGRESSION THAT A FREE FEATURE INTRODUCED, and it
--       is the reason this migration exists. 20260814110000 called
--       flag_payout_for_review from mark_sighting_helpful, reusing the money
--       gate's ledger as instructed. Reuse was the right instinct and the wrong
--       table, for two independent reasons:
--
--         · _shared/collusion.ts reads payout_reviews FIRST and short-circuits
--           on it: "Approved by a human → the gate never re-runs; the signals
--           were judged." So a moderator clearing a BADGE flag in the console
--           would silently pre-approve that post's future payout — and the card
--           fingerprint and email signals would then never be evaluated at all.
--           A transfer of up to £5,000 would go out on the strength of a review
--           that had only ever considered one signal, about a free badge.
--         · payout_reviews.post_id is a PRIMARY KEY — one review per post,
--           ever, and flag_payout_for_review is `on conflict do nothing`. That
--           invariant is right for a per-post payout and wrong for a
--           per-sighting judgement: a second flagged confirmation on the same
--           post, from a DIFFERENT spotter, would vanish without trace.
--
--       The thing being judged here is a SIGHTING, so the evidence belongs on
--       the sighting. review_flags is service-role readable (the whole table is
--       — no client holds any write grant and RLS is spotter-own-rows for
--       select), so console review works from day one, which is all
--       payout_reviews offered at v1 volume anyway.
--
--       2. get_post_stats counted unverified/helpful/credited. A not_mine
--       sighting fell out of all three, so the owner's own stats screen stopped
--       summing to its own total — the kind of arithmetic error that makes a
--       reader distrust every other number on the page.
--
-- SAFETY: `create or replace` on functions that EXIST, so both keep their OIDs
--       and ACLs. mark_sighting_helpful's body is copied mechanically from
--       20260814120000:50-191; the ONLY changes are the removal of the
--       flag_payout_for_review call and the two new columns in its UPDATE.
--
--       review_flags NEVER leaves the database. It is not returned by
--       my_sighting_record, not by get_post_sightings, and not by this
--       function: naming the signal that caught someone is a tutorial in
--       evading it (_shared/collusion.ts's rule, kept).
--
--       HONEST LIMIT, unchanged and worth restating: the false-positive shape
--       is one household with two accounts — a partner spotting the other's
--       car, a family phone passed between them. They silently get no badge and
--       are never told. `select count(*) from sightings where review_flags is
--       not null` is the number that decides whether this stays universal.
-- LINKS: supabase/functions/_shared/collusion.ts (the gate this protects);
--        supabase/migrations/20260803140000_payout_collusion_check.sql;
--        supabase/migrations/20260814120000_reputation_one_point_per_listing.sql.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Where the evidence lives now.
-- -----------------------------------------------------------------------------
alter table public.sightings
  add column review_flags text[],
  add column counted_at   timestamptz;

comment on column public.sightings.review_flags is
  'Machine words naming why this confirmation was not counted toward reputation (e.g. {shared_device}). Service-role readable only and NEVER returned by any RPC — telling someone which signal caught them is a tutorial in evading it. Deliberately NOT written to payout_reviews: that table short-circuits the money gate, so a console approval here would pre-approve a payout whose other signals were never evaluated.';

comment on column public.sightings.counted_at is
  'When this sighting''s confirmation actually moved profiles.sightings_helpful. NULL when the point was withheld — either the per-listing cap or a collusion flag. The record that makes a future counter RECOMPUTE possible (an assignment, not a decrement) without guessing which confirmations were real.';

-- ---------------------------------------------------------------------------
-- 2. mark_sighting_helpful, with the flag written to the sighting instead.
-- ---------------------------------------------------------------------------
create or replace function public.mark_sighting_helpful(p_sighting_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_caller   uuid := auth.uid();
  v_sighting public.sightings%rowtype;
  v_owner    uuid;
  v_before   integer;
  v_after    integer;
  v_crossed  integer := null;
  v_flagged  boolean := false;
  v_counted  boolean := true;
  v_reasons  text[] := '{}';
begin
  if v_caller is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select s.* into v_sighting
  from public.sightings s
  where s.id = p_sighting_id
  for update;

  if not found then
    raise exception 'NOT_OWNER';
  end if;

  select p.owner_id into v_owner
  from public.posts p
  where p.id = v_sighting.post_id;
  if v_owner is distinct from v_caller then
    raise exception 'NOT_OWNER';
  end if;

  -- (c) Defence in depth. Unreachable while create_sighting blocks OWN_POST,
  -- which is exactly why it belongs here — the upstream guard is one edit away
  -- from the reputation boundary and this is the boundary.
  if v_sighting.spotter_id = v_caller then
    raise exception 'CANNOT_CONFIRM_OWN_SIGHTING';
  end if;

  if v_sighting.status = 'credited' then
    return jsonb_build_object('status', 'credited', 'changed', false);
  end if;

  if v_sighting.status = 'helpful' then
    return jsonb_build_object('status', 'helpful', 'changed', false);
  end if;

  -- (d) THE GATE. Signals are read BEFORE the write so a flagged pair is still
  -- recorded truthfully; what they lose is the counter, not the verdict.
  -- Fail-closed is inherited: both readers are deterministic SQL over local
  -- tables, so there is no "unevaluable" branch to guess at.
  if public.shared_device_exists(v_owner, v_sighting.spotter_id) then
    v_flagged := true;
    v_reasons := array_append(v_reasons, 'shared_device');
  end if;

  -- 3 DISTINCT posts, not 3 sightings — see the banner. The count excludes
  -- this sighting, which is still unverified at this point.
  if public.confirmation_pair_count(v_owner, v_sighting.spotter_id) >= 3 then
    v_flagged := true;
    v_reasons := array_append(v_reasons, 'repeat_pair');
  end if;

  -- (e) ONE REPUTATION POINT PER LISTING, PER SPOTTER.
  -- A reputation point answers "how many owners found this person useful",
  -- not "how many times did one owner tap". A spotter who tracked one car
  -- across three days and filed three sightings earned one owner's trust
  -- once, not three times — and the difference matters because the cheapest
  -- badge farm is a single post confirmed five times (the per-post cap is 3
  -- sightings/day, so two days buys five). Capping here makes each point cost
  -- a SEPARATE listing, and three separate listings for one pair is what
  -- confirmation_pair_count above already refuses to count at all.
  --
  -- Unlike the collusion branch this is an honest rule, not a trap, so the
  -- caller is told plainly (counted:false).
  if exists (
    select 1
      from public.sightings s2
     where s2.post_id = v_sighting.post_id
       and s2.spotter_id = v_sighting.spotter_id
       and s2.id <> p_sighting_id
       and s2.status in ('helpful', 'credited')
  ) then
    v_counted := false;
  end if;

  -- (a) + (b). unverified -> helpful, and not_mine -> helpful (a correction).
  update public.sightings
  set status = 'helpful',
      reviewed_at = now(),
      review_flags = case when v_flagged then v_reasons end,
      counted_at = case when v_flagged or not v_counted then null else now() end
  where id = p_sighting_id;

  if v_flagged or not v_counted then
    -- Recorded, not counted. The evidence lives on the SIGHTING row
    -- (review_flags), never in payout_reviews — see the banner for why
    -- writing there would weaken the money gate.
    -- counted:false is honest for the per-listing cap and deliberately
    -- INDISTINGUISHABLE for a flagged pair: naming the signal teaches the
    -- attack (_shared/collusion.ts).
    return jsonb_build_object(
      'status', 'helpful', 'changed', true, 'crossedThreshold', null, 'counted', false
    );
  end if;

  -- Reputation v1 (DOMAIN.md): sightings_helpful is server-maintained ONLY;
  -- this is its single increment point, reachable once per sighting.
  select sightings_helpful into v_before from public.profiles where id = v_sighting.spotter_id;

  update public.profiles
  set sightings_helpful = sightings_helpful + 1
  where id = v_sighting.spotter_id
  returning sightings_helpful into v_after;

  -- THE BADGE-THRESHOLD REPORT. Badges are DERIVED (reputation.ts earnedBadges)
  -- with no award table and no awarded_at, so nothing downstream can tell that
  -- THIS call crossed a rung — only the function holding both sides of the
  -- increment can. Thresholds mirror BADGE_THRESHOLDS = [1, 5, 25]; a single
  -- +1 can cross at most one.
  select t into v_crossed
  from unnest(array[1, 5, 25]) as t
  where v_before < t and v_after >= t
  limit 1;

  -- AUDIT: a sighting-marked-helpful audit-log insert belongs here once the
  -- audit_log table exists (SECURITY_AND_TRUST §7). Deferred with the
  -- moderation feature (same posture as create_sighting).

  return jsonb_build_object(
    'status', 'helpful', 'changed', true, 'crossedThreshold', v_crossed, 'counted', true
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. get_post_stats — the fourth bucket. Body copied mechanically from
--    20260807130000:100-247; the ONLY change is the added line.
-- ---------------------------------------------------------------------------
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
    -- The fourth bucket (2026-08-14). Without it the three above stopped
    -- summing to sightings_total the moment not_mine existed, and a page whose
    -- own numbers disagree teaches a reader to trust none of them.
    'sightings_not_mine',   (select count(*) from public.sightings where post_id = p_post_id and status = 'not_mine'),
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

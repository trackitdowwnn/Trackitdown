-- =============================================================================
-- WHAT: Alert zones match a driveway theft on its SNAPPED point, not the exact
--       one (security audit hardening, 2026-10-26).
--
-- WHY:  match_alert_zones tested ST_DWithin(zone.point, last_seen_location,
--       radius) on the exact point. A driveway theft's point is the victim's
--       HOME. Whether a push arrived for a new listing told a zone's owner if
--       that home lay inside their circle — and a few pre-placed zones (or
--       accounts) with their edges in the right places make that a location
--       oracle, the alerts twin of the feed leak 20261026120000 closed.
--
-- HOW:  Read stolen_from with the post, and match on
--       post_pin_geog(last_seen_location, stolen_from) — the same ~1km grid
--       the feeds, search and post detail use. Every other theft keeps its
--       exact point, so who gets alerted only changes at the edge of a zone
--       for driveway thefts. The point is computed ONCE, so the zone side's
--       GiST index still serves the predicate.
--
-- ⚠️ NEXT EDITOR: the live definition of match_alert_zones is THIS file —
--    restated verbatim from 20260922120000 (md5-checked against production
--    2026-10-26), plus the three marked edits.
-- =============================================================================

create or replace function public.match_alert_zones(
  p_post_id      uuid,
  p_max_per_day  int default 3
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_owner     uuid;
  v_point     geography(Point, 4326);
  v_locality  text;
  v_colour    text;
  v_make      text;
  v_model     text;
  -- CHANGE 1: the post-side values the new criteria compare against. Read here,
  -- inside the lock, alongside the fields the copy already needed — never
  -- re-joined into the CTE below, which stays a single-table scan of
  -- alert_zones driven by the GiST index.
  v_body_type text;
  -- AUDIT 2026-10-26: how it was stolen, so a driveway theft (the victim's
  -- home) is matched on its snapped point.
  v_stolen_from text;
  v_bounty    int;
  v_last_seen timestamptz;
  v_desc      text;
  v_article   text;
  v_title     text;
  v_body      text;
  -- A null p_max_per_day would make every `count < p_max_per_day` comparison
  -- NULL and silently match nobody; coalesce to the documented default. Floored
  -- at 0 so a negative argument means "send nothing", never "unbounded".
  v_max       int := greatest(coalesce(p_max_per_day, 3), 0);
  v_users     jsonb := '[]'::jsonb;
begin
  -- --- 1. Serialise concurrent fan-outs for THIS post -------------------------
  -- The house idiom from create_sighting: an advisory lock held for the
  -- transaction, released automatically at commit/rollback. Two invocations for
  -- the same post (a Stripe retry racing the original) queue here instead of
  -- both reading the same pre-insert counts. claim_post_alerts should already
  -- have stopped the second one; this is the belt to that pair of braces, and
  -- it also covers a caller that matches without claiming.
  perform pg_advisory_xact_lock(
    hashtextextended('notify_spotters:' || p_post_id::text, 0));

  -- --- 2. Re-read the post inside the lock ------------------------------------
  -- Re-read rather than trust the claim's payload: the caller may have done
  -- other work in between, and the copy below must reflect the row as it stands
  -- at send time.
  --
  -- NOTE (deliberate): there is no status predicate here. The caller's gate is
  -- claim_post_alerts, which only ever claims an 'active' post, and the window
  -- between the two calls is milliseconds. Adding `and status = 'active'` would
  -- also break a legitimate re-match of an already-claimed post. If this
  -- function ever gains a caller that does NOT claim first, revisit this line.
  --
  -- CHANGE 1: body_type, bounty_amount_pence and last_seen_at are new here.
  -- They are read for MATCHING ONLY and are deliberately NOT added to the push
  -- copy in step 3 — the body's contents are governed by SECURITY_AND_TRUST §1
  -- and DOMAIN.md's payload rule (make + colour + district-grain locality +
  -- the don't-approach clause), not by whatever happens to be in scope.
  select p.owner_id,
         p.last_seen_location,
         p.last_seen_locality,
         p.colour,
         p.make,
         p.model,
         p.body_type,
         p.bounty_amount_pence,
         p.last_seen_at,
         p.stolen_from
    into v_owner, v_point, v_locality, v_colour, v_make, v_model,
         v_body_type, v_bounty, v_last_seen, v_stolen_from
    from public.posts p
   where p.id = p_post_id;

  -- --- 3. The push copy -------------------------------------------------------
  -- Built BEFORE the early return so the response shape is identical whether or
  -- not there is an audience: the caller never has to branch on a missing key.
  --
  -- Vehicle descriptor: concat_ws drops nulls, and nullif(btrim(x), '') turns a
  -- blank-but-not-null column into a null so it is dropped too. If make, model
  -- and colour are ALL empty the descriptor falls back to the literal 'car', so
  -- the sentence can never read "A null null" or "A  was reported stolen".
  --
  -- SAFETY (Tier 1): every interpolated value is bounded HERE, before the
  -- sentence is assembled — NOT by truncating the finished string. Those look
  -- equivalent and are not. colour/make/model are unbounded owner-authored
  -- text (public.posts has no length CHECK on them), so bounding only the
  -- assembled body lets the post's OWNER choose which characters survive by
  -- padding `make` — and the don't-approach clause is at the END, so it is
  -- what gets cut. That would strip the safety line from a push sent to every
  -- spotter within 50 miles (SECURITY_AND_TRUST §1 / DOMAIN.md: EVERY alert
  -- notification carries it).
  v_desc := left(
              coalesce(
                nullif(
                  concat_ws(' ',
                    nullif(btrim(coalesce(v_colour, '')), ''),
                    nullif(btrim(coalesce(v_make,   '')), ''),
                    nullif(btrim(coalesce(v_model,  '')), '')),
                  ''),
                'car'),
              48);

  -- "An orange Ford Fiesta", not "A orange Ford Fiesta". Cheap, and this string
  -- is read by every spotter in range.
  v_article := case when lower(left(v_desc, 1)) in ('a','e','i','o','u')
                    then 'An' else 'A' end;

  -- The PLACE is what makes a spotter look up, so it leads. Same district-grain
  -- locality the body already carried (see the SAFETY note below) and the same
  -- 'your area' fallback — nothing new is disclosed by moving it one line up.
  v_title := format('Car stolen in %s', left(coalesce(v_locality, 'your area'), 40));

  -- SAFETY: locality is district-grain (posts.last_seen_locality). NEVER
  -- last_seen_area (it is the raw reverse-geocoded label and can be
  -- street-grain — on a driveway theft, the victim's own street). NEVER the
  -- plate, NEVER coordinates. The don't-approach clause is not optional
  -- (DOMAIN.md / SECURITY_AND_TRUST.md §1: every alert notification carries
  -- the safety line).
  --
  -- There is deliberately NO left() around the finished sentence. Its one
  -- input is already bounded (v_desc <= 48), so the worst case is ~86
  -- characters — far inside Expo's 4KB payload limit. An outer bound would
  -- add nothing today and would silently start eating the safety clause again
  -- the moment someone widened that bound. Failing long is safe here; failing
  -- truncated is not. (The locality left this sentence for the title on
  -- 2026-09-22, which is why the figure dropped from ~133; the TITLE bounds
  -- its own copy of it at 40, and carries no safety clause to lose.)
  -- The title says where; the body says what, and then the safety line. Still
  -- ends with the exact "don't approach." token CHECK 21 matches.
  v_body := format('%s %s. Keep an eye out — don''t approach.', v_article, v_desc);

  -- --- 4. No point, no match --------------------------------------------------
  -- SAFETY: never match on a null point. ST_DWithin(null, ...) is null, so this
  -- would fall out anyway — but stating it explicitly means a future rewrite
  -- that reorders the predicates cannot accidentally turn "no location" into
  -- "matches everyone".
  if v_owner is null or v_point is null then
    return jsonb_build_object('user_ids', v_users, 'title', v_title, 'body', v_body);
  end if;

  -- SAFETY (AUDIT 2026-10-26): match on the point a stranger may know — a
  -- driveway theft's ~1km-snapped pin, every other theft's exact point. On the
  -- exact point, whether a push arrived told a zone's owner if the victim's
  -- home lay inside their circle. Computed once: the zone GiST still serves
  -- ST_DWithin below.
  v_point := public.post_pin_geog(v_point, v_stolen_from);

  -- --- 5. Match, cap and record — one statement, one snapshot -----------------
  -- A data-modifying CTE so matching and recording are ATOMIC: every id in the
  -- result already has its ledger row. Splitting this into a SELECT then an
  -- INSERT would reopen the race the advisory lock is here to close.
  with matched as (
    -- SAFETY / LOAD-BEARING: `distinct` collapses a user's up-to-five matching
    -- alerts into ONE row before the insert. See the header — in v1 this was
    -- belt-and-braces behind a unique index; since 20260802150000 dropped that
    -- index it is the only thing standing between a well-configured spotter and
    -- five push_sends rows plus five notifications for a single post.
    select distinct z.user_id
      from public.alert_zones z
     where z.enabled                                   -- muted alerts never match

       -- SAFETY (owner exclusion): never push the victim their own theft.
       and z.user_id <> v_owner

       -- geography(Point,4326) => ST_DWithin's distance is TRUE METRES on the
       -- spheroid, so radius_m needs no conversion. GiST-assisted via
       -- alert_zones' index on point. This predicate narrows FIRST, which is
       -- why the non-sargable criteria below are cheap.
       and ST_DWithin(z.point, v_point, z.radius_m)

       -- CHANGE 2: the alert criteria. NULL on the ZONE side means "ANY", so a
       -- v1 zone (all six NULL) matches exactly what it always did.
       --
       -- Compared lower(btrim(...)) on BOTH sides because posts.make/model/
       -- colour carry no CHECK and no normalisation — create_post stores what
       -- the owner typed and MakeField allows free-typed entry, so "bmw" and
       -- "BMW" are both really in there. An exact `=` here would silently drop
       -- the spotter who explicitly asked for that car. search_posts /
       -- search_posts_count are changed to the identical comparison in section
       -- B of this migration so the two can never disagree.
       --
       -- NULL on the POST side (e.g. a post with no body_type) makes the
       -- comparison NULL, which excludes the row — correct: an unknown value
       -- cannot satisfy a filter that asked for a specific one.
       and (z.make      is null or lower(btrim(v_make))      = lower(btrim(z.make)))
       and (z.model     is null or lower(btrim(v_model))     = lower(btrim(z.model)))
       and (z.colour    is null or lower(btrim(v_colour))    = lower(btrim(z.colour)))
       and (z.body_type is null or lower(btrim(v_body_type)) = lower(btrim(z.body_type)))

       -- MONEY: both sides are integer pence, GBP implied. No rounding, no
       -- float comparison. alert_zones.min_bounty_pence carries the same
       -- 5000..500000 CHECK as posts.bounty_amount_pence, so this can never be
       -- a filter no post could satisfy.
       and (z.min_bounty_pence is null or v_bounty >= z.min_bounty_pence)

       -- Recency window. A post with a NULL last_seen_at never satisfies it —
       -- the `is not null` is explicit rather than relying on NULL propagation,
       -- so a future reorder cannot turn "unknown age" into "matches".
       and (z.recency_days is null
            or (v_last_seen is not null
                and v_last_seen >= now() - (z.recency_days || ' days')::interval))

       -- Never twice for the same post. Uses push_sends
       -- (user_id, kind, subject_id) — the exact-match dedup index. Keyed on the
       -- USER, not the alert: five alerts, one notification.
       and not exists (
         select 1
           from public.push_sends s
          where s.user_id    = z.user_id
            and s.kind       = 'alert'
            and s.subject_id = p_post_id)

       -- Rolling-24h cap (not a midnight reset), the same window shape
       -- create_sighting uses. Uses push_sends (user_id, kind, created_at) as
       -- an index range scan. Also keyed on the USER: owning five alerts does
       -- NOT buy a spotter more than three pushes a day.
       and (select count(*)
              from public.push_sends s
             where s.user_id    = z.user_id
               and s.kind       = 'alert'
               and s.created_at > now() - interval '24 hours') < v_max
  ),
  inserted as (
    insert into public.push_sends (user_id, kind, subject_id)
    select m.user_id, 'alert', p_post_id
      from matched m
    returning user_id
  )
  select coalesce(jsonb_agg(i.user_id), '[]'::jsonb)
    into v_users
    from inserted i;

  -- --- 6. Opportunistic retention ---------------------------------------------
  -- There is no pg_cron in this project, so the ledger is trimmed on the path
  -- that grows it. push_sends is append-only and unbounded otherwise.
  --
  -- Why 30 days is safe for the dedup: a post is alerted ONCE, at go-live, and
  -- posts.alerts_sent_at (not this ledger) is the primary idempotency guard —
  -- it is never purged. The dedup rows only need to outlive the send attempt
  -- itself; the cap window they also serve is 24 hours. Purging at 30 days is
  -- therefore two orders of magnitude of headroom on both.
  delete from public.push_sends
   where created_at < now() - interval '30 days';

  -- AUDIT: a fan-out audit-log row (post, audience size, cap) belongs here once
  -- the audit_log table exists (SECURITY_AND_TRUST §7). Deferred with the
  -- moderation feature.

  return jsonb_build_object('user_ids', v_users, 'title', v_title, 'body', v_body);
end;
$$;

comment on function public.match_alert_zones(uuid, int) is
  'SERVICE ROLE ONLY. The spotter-alert fan-out: returns { user_ids: [...], title, body } for one post and records a push_sends row per matched user in the SAME transaction, under pg_advisory_xact_lock(''notify_spotters:<post_id>''), so the cap cannot be raced. A user matches when an alert_zones row of theirs is enabled, is NOT the post owner, ST_DWithin(zone.point, post_pin_geog(post.last_seen_location, post.stolen_from), zone.radius_m) (geography => metres, GiST-assisted; since 20261026170000 a driveway theft is matched on its ~1km-snapped point, so no zone can locate the home it was taken from), SATISFIES THAT ALERT''S CRITERIA — make / model / colour / body_type compared lower(btrim(...)) on both sides, min_bounty_pence <= the post''s bounty (integer pence, GBP), last_seen_at inside recency_days; NULL on the zone side means ANY, so a pre-20260802150000 zone matches exactly what it always did — has no existing push_sends row for (this user, kind=''alert'', this post), and has had fewer than p_max_per_day alert pushes in the rolling 24h. FIVE ALERTS STILL PRODUCE ONE PUSH: `select distinct z.user_id`, the (user_id, kind, subject_id) dedup and the rolling-24h cap are ALL user-keyed, never alert-keyed — the distinct is LOAD-BEARING now that 20260802150000 dropped the one-zone-per-user unique index. The case-insensitive comparison exists because posts.make/model/colour have no CHECK and no normalisation (create_post stores what the owner typed; MakeField allows free-typed entry), so an exact `=` silently drops the spotter who explicitly asked for that car; search_posts/search_posts_count use the identical comparison so the two can never disagree. Empty user_ids for a missing post, a null last-seen point, an empty audience, or everyone deduped/capped — all normal outcomes, never errors. The COPY IS BUILT HERE ON PURPOSE so its privacy properties are covered by npm run test:db rather than a second (Deno) test stack: the push carries the district-grain last_seen_locality ONLY (in the TITLE since 2026-09-22 — "Car stolen in Hemel Hempstead"; never street-grain last_seen_area), never the plate, never coordinates, and the body always ENDS with the don''t-approach clause (SECURITY_AND_TRUST §1); body_type/bounty/last_seen_at are read for MATCHING ONLY and are deliberately never interpolated into it. Each interpolated value is bounded BEFORE assembly (descriptor 48 in the body, locality 40 in the title) rather than truncating the finished sentence — the clause is last, so an outer left() would let an owner pad `make` until the safety line fell off the end. Also purges push_sends rows older than 30 days (no pg_cron here); safe because posts.alerts_sent_at, not this ledger, is the primary idempotency guard. LIMITATION 1: the advisory lock is keyed on the POST, so two concurrent invocations for DIFFERENT posts sharing a recipient could each see a count of 2 and both send — worst case a 4th push in a day. LIMITATION 2: ledger rows are written before the send, so a total send failure costs the user a cap slot and permanently dedups them out of that post — conservative in the right direction, but real. LIMITATION 3: the criteria comparisons are non-sargable (no index can serve lower(btrim(...))), which is fine because the GiST spatial predicate narrows first, an alert table holds at most 5 rows per user, and this runs once per post going live; expression indexes are a measured follow-up. Revoked from public, anon and authenticated: it writes the rate-limit ledger and returns other users'' ids, which is a location oracle over strangers.';

-- =============================================================================
-- WHAT:  The SERVICE-ROLE-ONLY matching layer for spotter alerts — the two RPCs
--        the notify-spotters Edge Function calls, in order:
--          1. public.claim_post_alerts(p_post_id uuid) -> jsonb
--             The idempotency CLAIM. Conditionally stamps posts.alerts_sent_at
--             and hands back the post's alert-relevant fields. Zero rows back =
--             somebody already claimed it, or the post is not active — the
--             caller exits quietly either way.
--          2. public.match_alert_zones(p_post_id uuid, p_max_per_day int
--             default 3) -> jsonb
--             The PostGIS fan-out: which spotters' alert zones cover the post's
--             last-seen point, minus the owner, minus anyone already told about
--             THIS post, minus anyone at their rolling-24h alert cap — recorded
--             in public.push_sends and returned WITH the finished push copy, all
--             inside one transaction under a per-post advisory lock.
--        No new tables, no new columns, no new policies: this migration is two
--        functions and their grants over objects that already exist.
-- WHY:   DOMAIN.md "Notifications": when a post goes 'active', an Edge Function
--        runs a PostGIS query to find users whose radius circle contains the
--        post's last-seen point and pushes to them. Every piece of that except
--        the query itself already exists (push_tokens / push_sends /
--        posts.alerts_sent_at / posts.last_seen_locality / alert_zones); this is
--        the query, plus the two properties that must not live in TypeScript:
--
--        (a) IDEMPOTENCY. posts.status becomes 'active' only inside
--            mark_post_payment_held, called from the stripe-webhook Edge
--            Function, which records its dedupe row AFTER the handler has
--            committed. A Stripe retry therefore RE-RUNS the whole handler. The
--            conditional claim in claim_post_alerts is what makes that retry
--            safe WITHOUT modifying the money-critical mark_post_payment_held.
--            A post with NO zones in range still gets claimed — deliberately.
--            The claim means "we tried", not "we sent": if it only stamped on a
--            non-empty audience, a retry hours or days later could blast a stale
--            post at spotters who have since moved their zone into range.
--
--        (b) THE PUSH COPY IS BUILT IN SQL. The body must never carry the plate,
--            never carry coordinates, never carry street-grain
--            posts.last_seen_area, and must always carry the don't-approach
--            clause. Building it here puts every one of those privacy
--            properties under `npm run test:db`, the runner this project already
--            has. Building it in the Edge Function would mean standing up a Deno
--            test runner purely to assert "the plate isn't in the body" — a
--            second test stack guarding one string.
--
--        Both functions are SERVICE-ROLE ONLY. An authenticated user must never
--        be able to burn a post's alert claim (permanently silencing a victim's
--        fan-out with one RPC call) or trigger a fan-out at all.
-- LINKS: docs/DOMAIN.md (Notifications — personal alert radius + home location,
--          the PostGIS fan-out when a post goes active; Sighting rules — the
--          safety line on every notification),
--        docs/SECURITY_AND_TRUST.md §1 (report-don't-approach on EVERY alert
--          notification; data minimisation), §2 (anti-stalking; location
--          coarsening), §6 (RLS deny-by-default; SECURITY DEFINER hardening;
--          service-role keys live only in Edge Function secrets),
--        supabase/migrations/20260802100000_push_infrastructure.sql
--          (push_sends: the ledger, its kind CHECK and its two indexes — both
--          of which this migration's WHERE clauses are shaped to use),
--        supabase/migrations/20260802110000_post_alert_columns.sql
--          (posts.alerts_sent_at + posts.last_seen_locality, and the claim
--          statement this migration wraps verbatim),
--        supabase/migrations/20260802120000_alert_zones.sql
--          (public.alert_zones: the spotter's point + radius_m + enabled flag,
--          its unique index on user_id and its GiST index on point — THIS
--          MIGRATION DEPENDS ON THAT ONE and is stamped after it),
--        supabase/migrations/20260714100000_sightings.sql
--          (create_sighting: the pg_advisory_xact_lock + rolling-24h count
--          idiom reproduced here),
--        supabase/migrations/20260711130000_home_feed_location_and_rpcs.sql
--          (ST_DWithin over geography(Point,4326); the search_path = public,
--          extensions requirement for PostGIS operators),
--        supabase/migrations/20260730100000_live_on_payment.sql
--          (mark_post_payment_held: draft -> active, the transition the claim
--          protects),
--        supabase/functions/stripe-webhook/index.ts (records its dedupe row
--          AFTER processing — the reason a claim is needed at all).
--
-- SAFETY NOTE ON DESTRUCTIVE STATEMENTS: NONE. Fully additive — two brand-new
--        function signatures (neither replaces nor overloads an existing one),
--        their comments and their grants. No table, column, index, policy,
--        function or DATA is dropped, renamed or truncated. The one row-removing
--        statement in the file is the 30-day push_sends retention purge INSIDE
--        match_alert_zones (section 2, step 5) — it deletes only ledger rows
--        older than 30 days, which are past both the cap window (24h) and any
--        live post's alert window; see the comment there for why that cannot
--        resurrect a duplicate alert.
--
-- ORDERING: 20260802130000 sorts strictly after 20260802120000_alert_zones.sql,
--        which creates public.alert_zones. Applying this file first would fail
--        on an unknown relation. Do not re-stamp it earlier.
-- =============================================================================


-- =============================================================================
-- 1. FUNCTION: claim_post_alerts(post_id) -> jsonb   -- SERVICE ROLE ONLY
-- =============================================================================
-- Claims the right to alert a post exactly once and returns everything the
-- fan-out needs about it:
--   {"claimed": false}                                 -- someone else won, or
--                                                      -- the post is not active
--   {"claimed": true, "owner_id",
--    "locality", "colour", "make", "model"}   -- NO coordinates, by design
--
-- SAFETY (Tier 1 — read before editing):
--   * SERVICE ROLE ONLY. posts.alerts_sent_at is excluded from every client
--     column grant precisely so no client can touch it (20260802110000). This
--     function is a legitimate write path to it, so exposing it to
--     `authenticated` would hand any signed-in user a one-call button that
--     PERMANENTLY suppresses the alert fan-out on any post id they can name —
--     i.e. silences a theft victim's crowd during the hours that matter. Grants
--     below revoke public, anon AND authenticated.
--   * The single UPDATE is the whole concurrency control. `alerts_sent_at is
--     null` in the WHERE makes it a compare-and-set: under two concurrent
--     Stripe retries, one transaction updates the row and the other blocks on
--     the row lock, then re-evaluates the (now non-null) predicate and matches
--     zero rows. No advisory lock is needed for the claim itself.
--   * ZERO ROWS IS NOT AN ERROR. Already-claimed and not-active return the SAME
--     {"claimed": false}, so this is not an existence or status oracle for a
--     post — and, more practically, a Stripe retry is a normal event, not a
--     failure to log loudly.
--   * A post with no zones in range STILL gets claimed. See WHY(a) in the
--     header: the claim means "we tried".
--   * SAFETY: this DELIBERATELY returns NO COORDINATES. For a
--     stolen_from='driveway' post the last-seen point IS the victim's home
--     (SECURITY_AND_TRUST §2), and nothing downstream needs it:
--     match_alert_zones re-reads the point itself and does all the spatial
--     work inside the database, so the exact home never enters an Edge
--     Function's memory, its logs, or a crash report. If a future caller
--     genuinely needs a point, give it the ST_SnapToGrid'd one — do not
--     re-add the exact pair here.
create function public.claim_post_alerts(p_post_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_owner    uuid;
  v_locality text;
  v_colour   text;
  v_make     text;
  v_model    text;
begin
  -- The claim, verbatim from posts.alerts_sent_at's column comment. Conditional
  -- on BOTH status = 'active' (never alert a draft, a cancelled post or a
  -- recovered one) and alerts_sent_at is null (never alert twice).
  update public.posts
     set alerts_sent_at = now()
   where id = p_post_id
     and status = 'active'
     and alerts_sent_at is null
  -- NOTE: last_seen_location is deliberately NOT selected. See SAFETY above.
  returning owner_id,
            last_seen_locality,
            colour,
            make,
            model
       into v_owner, v_locality, v_colour, v_make, v_model;

  -- Zero rows: already alerted, not active, or no such post. Exit quietly with
  -- the same shape in every case (see SAFETY above).
  if not found then
    return jsonb_build_object('claimed', false);
  end if;

  -- AUDIT: an alert-claimed audit-log row belongs here once the audit_log table
  -- exists (SECURITY_AND_TRUST §7). Deferred with the moderation feature.

  return jsonb_build_object(
    'claimed',  true,
    'owner_id', v_owner,

    -- SAFETY: locality is posts.last_seen_locality — the district-grain SAFETY
    -- column. Deliberately NOT last_seen_area, which can be street-grain.
    'locality', v_locality,
    'colour',   v_colour,
    'make',     v_make,
    'model',    v_model
  );
end;
$$;

comment on function public.claim_post_alerts(uuid) is
  'SERVICE ROLE ONLY. Claims the right to alert a post exactly once: conditionally stamps posts.alerts_sent_at where status = ''active'' and alerts_sent_at is null, and returns { claimed:true, owner_id, locality, colour, make, model }. Zero rows -> { claimed:false } for BOTH "already alerted" and "not active" (no status oracle, and a Stripe retry is a normal event). The conditional UPDATE is a compare-and-set, so concurrent retries cannot both win; this is what makes the fan-out idempotent WITHOUT touching the money-critical mark_post_payment_held, whose caller records its dedupe row after processing. A post with no zones in range is still claimed — the claim means "we tried", so a later retry cannot blast a stale post. SAFETY: returns NO coordinates at all — a driveway theft''s point is the victim''s home, and match_alert_zones re-reads the point itself, so the exact location never leaves the database; locality is the district-grain last_seen_locality, NEVER last_seen_area. Revoked from public, anon and authenticated: a client grant here would let anyone permanently silence any post''s alerts.';

-- SAFETY: functions default to EXECUTE for PUBLIC, and this project also ships
-- ALTER DEFAULT PRIVILEGES granting EXECUTE to anon AND authenticated at create
-- time (20260713190000_post_a_car.sql / the 20260713191000 incident) — revoking
-- PUBLIC alone is NOT enough. All three are named explicitly, then service_role
-- alone is granted, matching prune_push_token / the Stripe webhook RPCs.
revoke execute on function public.claim_post_alerts(uuid) from public, anon, authenticated;
grant  execute on function public.claim_post_alerts(uuid) to service_role;


-- =============================================================================
-- 2. FUNCTION: match_alert_zones(post_id, max_per_day) -> jsonb
--    -- SERVICE ROLE ONLY
-- =============================================================================
-- The fan-out query. Returns the audience AND the finished push copy:
--   {"user_ids": [uuid, ...], "title": "...", "body": "..."}
-- user_ids is [] whenever there is nothing to send (no such post, no last-seen
-- point, no zone in range, everyone already told or capped) — the caller treats
-- an empty list as a normal outcome, not an error.
--
-- Matching AND recording happen in ONE transaction so the cap cannot be raced:
-- every returned user id already has its push_sends row committed alongside it.
--
-- SAFETY (Tier 1 — read before editing):
--   * SERVICE ROLE ONLY. This function WRITES push_sends (the rate-limit ledger
--     that has no client policies and no client grants at all — a user must not
--     be able to read it, let alone add rows to it) and it returns a list of
--     OTHER USERS' ids together with their implied approximate location ("these
--     accounts have an alert zone covering this point"). That is a location
--     oracle over strangers. Revoked from public, anon AND authenticated.
--   * OWNER EXCLUSION (z.user_id <> v_owner) is not cosmetic. Without it the
--     victim gets pushed "a car was reported stolen near you" about their own
--     theft, minutes after reporting it.
--   * The BODY is assembled below under its own SAFETY block. Do not widen it.
--
-- HONEST LIMITATION 1 — the cap is per-post-serialised, not per-user.
--   The advisory lock is keyed on the POST, which is exactly right for the
--   retry/concurrent-invocation case this feature actually has (the same post
--   claimed twice). It does NOT serialise two invocations for DIFFERENT posts
--   that happen to share a recipient: each could independently see that user's
--   24h count as 2 and both send, so the worst case is a 4th push in a day
--   against a nominal cap of 3. Per-user locks inside a set-based query mean
--   either a row-by-row loop or sorting the audience to lock in a stable order
--   to avoid deadlocks — real complexity for one extra notification in a rare
--   race. Deliberately not built.
--
-- HONEST LIMITATION 2 — a push_sends row is a promise, not a receipt.
--   Rows are recorded in the SAME transaction as the match, before the caller
--   has talked to Expo at all. If the send then fails entirely (Expo outage,
--   Edge Function crash between the two), those users have spent a cap slot on
--   a notification they never received, and the same-subject dedup means they
--   will not be told about that post again. This is conservative in the right
--   direction — the alternative, recording after a successful send, loses the
--   race outright and double-pushes on every retry — but it is a real cost, not
--   a theoretical one.
create function public.match_alert_zones(
  p_post_id      uuid,
  p_max_per_day  int default 3
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_owner    uuid;
  v_point    geography(Point, 4326);
  v_locality text;
  v_colour   text;
  v_make     text;
  v_model    text;
  v_desc     text;
  v_article  text;
  v_title    text;
  v_body     text;
  -- A null p_max_per_day would make every `count < p_max_per_day` comparison
  -- NULL and silently match nobody; coalesce to the documented default. Floored
  -- at 0 so a negative argument means "send nothing", never "unbounded".
  v_max      int := greatest(coalesce(p_max_per_day, 3), 0);
  v_users    jsonb := '[]'::jsonb;
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
  select p.owner_id,
         p.last_seen_location,
         p.last_seen_locality,
         p.colour,
         p.make,
         p.model
    into v_owner, v_point, v_locality, v_colour, v_make, v_model
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
  -- notification carries it). claim_sighting_notification (20260802140000)
  -- already bounds per-field for exactly this reason; this function did not.
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

  v_title := 'Stolen car reported near you';

  -- SAFETY: locality is district-grain (posts.last_seen_locality). NEVER
  -- last_seen_area (it is the raw reverse-geocoded label and can be
  -- street-grain — on a driveway theft, the victim's own street). NEVER the
  -- plate, NEVER coordinates. The don't-approach clause is not optional
  -- (DOMAIN.md / SECURITY_AND_TRUST.md §1: every alert notification carries
  -- the safety line).
  --
  -- There is deliberately NO left() around the finished sentence. Every input
  -- is already bounded (v_desc <= 48, locality <= 40), so the worst case is
  -- ~133 characters — far inside Expo's 4KB payload limit. An outer bound
  -- would add nothing today and would silently start eating the safety clause
  -- again the moment someone widened one of the field bounds. Failing long is
  -- safe here; failing truncated is not.
  v_body := format('%s %s was reported stolen in %s — don''t approach.',
                   v_article, v_desc, left(coalesce(v_locality, 'your area'), 40));

  -- --- 4. No point, no match --------------------------------------------------
  -- SAFETY: never match on a null point. ST_DWithin(null, ...) is null, so this
  -- would fall out anyway — but stating it explicitly means a future rewrite
  -- that reorders the predicates cannot accidentally turn "no location" into
  -- "matches everyone".
  if v_owner is null or v_point is null then
    return jsonb_build_object('user_ids', v_users, 'title', v_title, 'body', v_body);
  end if;

  -- --- 5. Match, cap and record — one statement, one snapshot -----------------
  -- A data-modifying CTE so matching and recording are ATOMIC: every id in the
  -- result already has its ledger row. Splitting this into a SELECT then an
  -- INSERT would reopen the race the advisory lock is here to close.
  with matched as (
    select distinct z.user_id
      from public.alert_zones z
     where z.enabled                                   -- muted zones never match

       -- SAFETY (owner exclusion): never push the victim their own theft.
       and z.user_id <> v_owner

       -- geography(Point,4326) => ST_DWithin's distance is TRUE METRES on the
       -- spheroid, so radius_m needs no conversion. GiST-assisted via
       -- alert_zones' index on point.
       and ST_DWithin(z.point, v_point, z.radius_m)

       -- Never twice for the same post. Uses push_sends
       -- (user_id, kind, subject_id) — the exact-match dedup index.
       and not exists (
         select 1
           from public.push_sends s
          where s.user_id    = z.user_id
            and s.kind       = 'alert'
            and s.subject_id = p_post_id)

       -- Rolling-24h cap (not a midnight reset), the same window shape
       -- create_sighting uses. Uses push_sends (user_id, kind, created_at) as
       -- an index range scan.
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

  -- `distinct` above is belt-and-braces: alert_zones carries a UNIQUE index on
  -- (user_id), so one user has at most one zone today. If that ever becomes
  -- one-user-many-zones, this line is what stops a user getting N ledger rows
  -- and N pushes for a single post.

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
  'SERVICE ROLE ONLY. The spotter-alert fan-out: returns { user_ids: [...], title, body } for one post and records a push_sends row per matched user in the SAME transaction, under pg_advisory_xact_lock(''notify_spotters:<post_id>''), so the cap cannot be raced. A user matches when their alert_zones row is enabled, is NOT the post owner, ST_DWithin(zone.point, post.last_seen_location, zone.radius_m) (geography => metres, GiST-assisted), has no existing push_sends row for (this user, kind=''alert'', this post), and has had fewer than p_max_per_day alert pushes in the rolling 24h. Empty user_ids for a missing post, a null last-seen point, an empty audience, or everyone deduped/capped — all normal outcomes, never errors. The COPY IS BUILT HERE ON PURPOSE so its privacy properties are covered by npm run test:db rather than a second (Deno) test stack: the body carries the district-grain last_seen_locality ONLY (never street-grain last_seen_area), never the plate, never coordinates, and always the don''t-approach clause (SECURITY_AND_TRUST §1). Each interpolated value is bounded BEFORE assembly (descriptor 48, locality 40) rather than truncating the finished sentence — the clause is last, so an outer left() would let an owner pad `make` until the safety line fell off the end. Also purges push_sends rows older than 30 days (no pg_cron here); safe because posts.alerts_sent_at, not this ledger, is the primary idempotency guard. LIMITATION 1: the advisory lock is keyed on the POST, so two concurrent invocations for DIFFERENT posts sharing a recipient could each see a count of 2 and both send — worst case a 4th push in a day; per-user locks inside a set-based query are not worth the complexity. LIMITATION 2: ledger rows are written before the send, so a total send failure costs the user a cap slot and permanently dedups them out of that post — conservative in the right direction, but real. Revoked from public, anon and authenticated: it writes the rate-limit ledger and returns other users'' ids, which is a location oracle over strangers.';

-- SAFETY: same lockdown as claim_post_alerts — public, anon AND authenticated
-- are all revoked (this project's default privileges grant EXECUTE to anon and
-- authenticated at create time), leaving service_role alone. No client may
-- trigger a fan-out or read this audience list.
revoke execute on function public.match_alert_zones(uuid, int) from public, anon, authenticated;
grant  execute on function public.match_alert_zones(uuid, int) to service_role;


-- =============================================================================
-- END OF MIGRATION
-- =============================================================================

-- =============================================================================
-- WHAT:  Teaches the two sides of vehicle matching to agree, CASE-INSENSITIVELY.
--          A. Redefines public.match_alert_zones(uuid, int) so the spotter
--             fan-out honours the six alert criteria added in 20260802150000
--             (make / model / colour / body_type / min_bounty_pence /
--             recency_days, NULL = any). Same NAME, same SIGNATURE, same return
--             shape — the notify-spotters Edge Function needs no edit and no
--             redeploy.
--          B. Redefines public.search_posts(...) and public.search_posts_count(...)
--             so their exact make / model / colour equality becomes
--             lower(btrim(...)) on BOTH sides, in all THREE copies of the shared
--             predicate.
--        No new tables, no new columns, no new policies, no new signatures: this
--        migration is three CREATE OR REPLACEs, their comments and their grants.
-- WHY:   posts.make / posts.model / posts.colour have NO check constraint and NO
--        normalisation anywhere. create_post inserts exactly what the owner
--        typed, and src/features/vehicles/post/components/MakeField.tsx allows
--        free-typed entry rather than forcing a picker value. So the database
--        genuinely holds "BMW", "bmw", "Bmw" and " BMW " as four different
--        makes, and an exact `=` matches at most one of them.
--
--        For SEARCH that is a nuisance: a filter chip finds fewer cars than it
--        should and the user shrugs. For an ALERT it is a safety failure. A
--        spotter who deliberately narrowed their alert to "BMW" — spending one
--        of their three daily push slots on precisely the car they can
--        recognise — is silently never told about the stolen BMW two streets
--        away, because the victim typed it in lower case. The user did
--        everything right, the system quietly dropped them, and nothing
--        anywhere reports an error.
--
--        BOTH SIDES CHANGE IN ONE MIGRATION ON PURPOSE. If only the matcher
--        became case-insensitive, "BMWs near me" in the alert settings and
--        "BMW" in the search filters would mean two different things, and the
--        obvious way to sanity-check an alert ("does search find this car?")
--        would start lying. They can now never disagree about what "a BMW" is.
--
--        WHY NOT NORMALISE THE COLUMNS INSTEAD: canonicalising posts.make on
--        write is the better long-term fix, but it is a data migration over live
--        rows plus a change to create_post, update_post_car_details, add_vehicle,
--        update_vehicle and the wizard — a much bigger, much riskier change than
--        making the two READ paths agree. Comparing case-insensitively is
--        correct regardless of whether that normalisation ever lands.
-- LINKS: docs/DOMAIN.md (Notifications — the ST_DWithin fan-out, 3 pushes per
--          user per rolling 24h, alert fatigue as the asymmetric risk; Post
--          content — structured fields),
--        docs/SECURITY_AND_TRUST.md §1 (every alert carries the don't-approach
--          line; data minimisation), §2 (anti-stalking; district-grain locality
--          only), §6 (SECURITY DEFINER hardening; service-role-only surfaces),
--        supabase/migrations/20260802130000_alert_matching.sql (the ORIGINAL
--          match_alert_zones — this file reproduces its body and changes only
--          what section A lists; read that header for the idempotency-claim and
--          push-copy reasoning, which is unchanged),
--        supabase/migrations/20260802150000_multi_alert.sql (the six criteria
--          columns and the five-alert cap this matcher now reads — THIS
--          MIGRATION DEPENDS ON THAT ONE and is stamped after it),
--        supabase/migrations/20260725100000_search_posts_rpc.sql (search_posts /
--          search_posts_count — this file reproduces both bodies and changes
--          only the three equality predicates),
--        supabase/migrations/20260713190000_post_a_car.sql (create_post — inserts
--          make/model/colour verbatim, with no normalisation; the root cause),
--        src/features/vehicles/post/components/MakeField.tsx (free-typed make
--          entry — the other half of the root cause),
--        supabase/functions/notify-spotters/index.ts (calls match_alert_zones by
--          its UNCHANGED signature — deliberately needs no redeploy).
--
-- SAFETY NOTE ON DESTRUCTIVE STATEMENTS: NONE. No drop, rename or truncate of
--        any object; no data is written, moved or deleted by this migration.
--        Three CREATE OR REPLACE FUNCTION statements over existing signatures
--        (identical names, parameter names, parameter types and return types —
--        so none of them is a drop-and-recreate), plus their comments and a
--        re-assertion of their existing grants. The only row-removing statement
--        in the file is the pre-existing 30-day push_sends retention purge
--        INSIDE match_alert_zones, carried forward verbatim from
--        20260802130000 — see the comment there for why it cannot resurrect a
--        duplicate alert.
--
-- BEHAVIOUR CHANGE (not destructive, but real): existing alerts are unaffected —
--        every criterion added in 20260802150000 defaults to NULL, and NULL is
--        the neutral element in all six predicates, so a v1 zone keeps matching
--        exactly what it matched before. Search results can only GROW: making a
--        comparison case-insensitive never removes a row that matched under the
--        exact one.
--
-- ORDERING: 20260802160000 sorts strictly after 20260802150000, which adds the
--        columns section A reads. Applying this file first would fail on unknown
--        columns. Do not re-stamp it earlier.
-- =============================================================================


-- =============================================================================
-- A. FUNCTION: match_alert_zones(post_id, max_per_day) -> jsonb
--    -- SERVICE ROLE ONLY  -- REDEFINED, SAME SIGNATURE
-- =============================================================================
-- This is 20260802130000's body reproduced in full, with EXACTLY three changes:
--   1. step 2 also reads posts.body_type, posts.bounty_amount_pence and
--      posts.last_seen_at into locals,
--   2. the `matched` CTE gains six criteria predicates (NULL on the ZONE side
--      means "any"),
--   3. the comments that described the one-zone-per-user world are corrected.
-- Everything else is untouched and must stay untouched: the advisory lock, the
-- owner exclusion, `select distinct z.user_id`, the push_sends dedup, the
-- rolling-24h cap, the 30-day purge, and every line of the push copy.
--
-- WHY THE NAME AND SIGNATURE ARE FROZEN: supabase/functions/notify-spotters
-- calls match_alert_zones(p_post_id, p_max_per_day) by name. Changing either
-- would turn every fan-out into a PGRST202 the moment this migration landed and
-- before the function was redeployed — the failure mode is "no spotter is ever
-- told about any stolen car", and it would be silent. CREATE OR REPLACE with an
-- identical signature is the whole point of doing it this way.
--
-- HOW FIVE ALERTS STILL PRODUCE ONE PUSH (the property this change stresses,
-- and the reason nothing below the CTE may be touched): a user may now own up to
-- five alerts, and several of them can legitimately cover the same post — "BMWs
-- near home", "anything near work", "high-bounty anything". Three things keep
-- that to a SINGLE notification, and all three are user-keyed, not alert-keyed:
--   * `select distinct z.user_id` collapses the matching alerts to one row per
--     PERSON before anything else runs. In v1 this was belt-and-braces (a unique
--     index guaranteed one zone per user); it is now LOAD-BEARING, and removing
--     it would give a user N push_sends rows and N pushes for one post.
--   * the push_sends dedup is keyed (user_id, kind, subject_id) — no alert id
--     appears in it, so "already told about this post" is a fact about the
--     person.
--   * the rolling-24h cap counts a USER's alert pushes, so five alerts consume
--     the same three daily slots as one. Filtering therefore makes those slots
--     more valuable without ever making them more numerous — which is the whole
--     point of DOMAIN.md's "alert fatigue is the asymmetric risk".
--
-- HONEST LIMITATION 3 (new here) — the criteria predicates are NON-SARGABLE.
--   lower(btrim(z.make)) = lower(btrim(v_make)) cannot use a plain btree index
--   on z.make, so every candidate row is compared with a function call. That is
--   fine, and deliberately not indexed:
--     * the GiST spatial predicate narrows FIRST — matching starts from the
--       zones whose circle contains this one post's point, which is already a
--       small set,
--     * there are at most FIVE alert rows per user (the cap in 20260802150000),
--     * this runs ONCE per post going live, not per request.
--   Expression indexes on lower(btrim(...)) are deferred as a MEASURED
--   follow-up, consistent with the pg_trgm note in 20260725100000: add them when
--   EXPLAIN on production-scale data says to, not speculatively.
--
-- The SAFETY notes, HONEST LIMITATION 1 (the lock is per-post, not per-user) and
-- HONEST LIMITATION 2 (a push_sends row is a promise, not a receipt) from
-- 20260802130000 all still apply verbatim; read that header before editing.
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
         p.last_seen_at
    into v_owner, v_point, v_locality, v_colour, v_make, v_model,
         v_body_type, v_bounty, v_last_seen
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
  'SERVICE ROLE ONLY. The spotter-alert fan-out: returns { user_ids: [...], title, body } for one post and records a push_sends row per matched user in the SAME transaction, under pg_advisory_xact_lock(''notify_spotters:<post_id>''), so the cap cannot be raced. A user matches when an alert_zones row of theirs is enabled, is NOT the post owner, ST_DWithin(zone.point, post.last_seen_location, zone.radius_m) (geography => metres, GiST-assisted), SATISFIES THAT ALERT''S CRITERIA — make / model / colour / body_type compared lower(btrim(...)) on both sides, min_bounty_pence <= the post''s bounty (integer pence, GBP), last_seen_at inside recency_days; NULL on the zone side means ANY, so a pre-20260802150000 zone matches exactly what it always did — has no existing push_sends row for (this user, kind=''alert'', this post), and has had fewer than p_max_per_day alert pushes in the rolling 24h. FIVE ALERTS STILL PRODUCE ONE PUSH: `select distinct z.user_id`, the (user_id, kind, subject_id) dedup and the rolling-24h cap are ALL user-keyed, never alert-keyed — the distinct is LOAD-BEARING now that 20260802150000 dropped the one-zone-per-user unique index. The case-insensitive comparison exists because posts.make/model/colour have no CHECK and no normalisation (create_post stores what the owner typed; MakeField allows free-typed entry), so an exact `=` silently drops the spotter who explicitly asked for that car; search_posts/search_posts_count use the identical comparison so the two can never disagree. Empty user_ids for a missing post, a null last-seen point, an empty audience, or everyone deduped/capped — all normal outcomes, never errors. The COPY IS BUILT HERE ON PURPOSE so its privacy properties are covered by npm run test:db rather than a second (Deno) test stack: the body carries the district-grain last_seen_locality ONLY (never street-grain last_seen_area), never the plate, never coordinates, and always the don''t-approach clause (SECURITY_AND_TRUST §1); body_type/bounty/last_seen_at are read for MATCHING ONLY and are deliberately never interpolated into it. Each interpolated value is bounded BEFORE assembly (descriptor 48, locality 40) rather than truncating the finished sentence — the clause is last, so an outer left() would let an owner pad `make` until the safety line fell off the end. Also purges push_sends rows older than 30 days (no pg_cron here); safe because posts.alerts_sent_at, not this ledger, is the primary idempotency guard. LIMITATION 1: the advisory lock is keyed on the POST, so two concurrent invocations for DIFFERENT posts sharing a recipient could each see a count of 2 and both send — worst case a 4th push in a day. LIMITATION 2: ledger rows are written before the send, so a total send failure costs the user a cap slot and permanently dedups them out of that post — conservative in the right direction, but real. LIMITATION 3: the criteria comparisons are non-sargable (no index can serve lower(btrim(...))), which is fine because the GiST spatial predicate narrows first, an alert table holds at most 5 rows per user, and this runs once per post going live; expression indexes are a measured follow-up. Revoked from public, anon and authenticated: it writes the rate-limit ledger and returns other users'' ids, which is a location oracle over strangers.';

-- SAFETY: RE-ASSERTED after CREATE OR REPLACE. Replacing a function preserves
-- its ACL today, but this project also ships ALTER DEFAULT PRIVILEGES granting
-- EXECUTE to anon AND authenticated, so the cost of being wrong about that is a
-- client-callable fan-out. Same lockdown as the original: public, anon AND
-- authenticated all revoked, service_role alone granted. No client may trigger a
-- fan-out or read this audience list. Signature must match the CREATE exactly.
revoke execute on function public.match_alert_zones(uuid, int) from public, anon, authenticated;
grant  execute on function public.match_alert_zones(uuid, int) to service_role;


-- =============================================================================
-- B. RPC: search_posts(min_lat, min_lng, max_lat, max_lng, criteria, limit)
--    -> jsonb   -- REDEFINED, SAME SIGNATURE
-- =============================================================================
-- 20260725100000's body reproduced in full, with ONE change: the exact
-- make/model/colour equality becomes lower(btrim(...)) on BOTH sides. Everything
-- else — the bbox guard, the LIKE escaping, the unconditional active-only
-- predicate, the 100-row cap, the exact-coordinate payload — is untouched.
--
-- SAFETY (shared predicate): the WHERE block below is REPEATED verbatim in the
--   count subquery, the page subquery, AND in search_posts_count. All three MUST
--   stay byte-for-byte identical so total, page and the live count never
--   disagree (and so the active-only predicate can never drift apart between
--   them). If you touch one, touch all three. THIS MIGRATION IS THE PROOF THAT
--   MATTERS: three separate copies of the same three lines had to change
--   together to make one behaviour change.
--
-- SAFETY (Tier 1 — unchanged, restated because this file rewrites the body):
--   This function is SECURITY DEFINER, so it BYPASSES RLS. The
--   posts_select_active_public policy DOES NOT protect these queries. The count,
--   the page, AND search_posts_count all carry an EXPLICIT `status = 'active'`
--   predicate, and that predicate IS the enforcement — it is UNCONDITIONAL,
--   never gated on a criterion. No draft / pending_verification /
--   recovery_claimed / cancelled / expired / rejected / recovered post may EVER
--   leave this function (anti-stalking, SECURITY_AND_TRUST §2). Do not weaken
--   the predicate or rely on RLS to backstop it.
--   (supabase/tests/home_feed_verification.sql asserts this and gates CI.)
--
-- SAFETY (exact coordinates + the driveway-coarsening KNOWN GAP) carry forward
--   unchanged from 20260725100000 — read that header before touching the
--   payload; nothing in this migration alters either.
--
-- The `text` free-text criterion is NOT changed: it already used ILIKE, which is
-- case-insensitive. Only the three EXACT-equality criteria were case-sensitive,
-- and they are the ones a filter chip sets.
create or replace function public.search_posts(
  p_min_lat   double precision,
  p_min_lng   double precision,
  p_max_lat   double precision,
  p_max_lng   double precision,
  p_criteria  jsonb,
  p_limit     integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_bbox  geography;
  -- Hard server cap 100; default 100; floor 1.
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 100);
  v_total integer;
  v_posts jsonb;
  -- Criteria, each extracted ONCE. Blank strings collapse to NULL (= no filter).
  v_text   text;    -- LIKE-escaped free-text term (matches make OR model)
  v_make   text;
  v_model  text;
  v_colour text;
  v_bmin   integer;
  v_bmax   integer;
  v_days   integer;
begin
  -- Guard degenerate input: any null coordinate, or a zero-area / inverted box
  -- (min >= max on either axis) yields nothing. Returned as an empty result so
  -- the client renders "0 cars" rather than erroring.
  if p_min_lat is null or p_min_lng is null
     or p_max_lat is null or p_max_lng is null
     or p_min_lat >= p_max_lat or p_min_lng >= p_max_lng then
    return jsonb_build_object('total', 0, 'posts', '[]'::jsonb);
  end if;

  -- Bounding box. ST_MakeEnvelope takes (xmin=min_lng, ymin=min_lat,
  -- xmax=max_lng, ymax=max_lat) — lng first. The && overlap operator on
  -- geography is served by the GiST index posts_last_seen_location_gix.
  -- ANTIMERIDIAN: UK-only app — dateline-crossing viewports are deliberately
  -- unsupported (no ±180° split); the guard above already rejects min >= max.
  v_bbox := ST_MakeEnvelope(p_min_lng, p_min_lat, p_max_lng, p_max_lat, 4326)::geography;

  -- Extract criteria. nullif(...,'') turns an absent OR blank key into NULL so
  -- every predicate below is skipped by its `v_x is null` guard.
  -- LIKE-ESCAPING: a raw free-text term is escaped BEFORE it is wrapped in
  -- '%...%' so a user typing '%' or '_' cannot turn the search into match-all /
  -- match-any. Escape the escape char '\' FIRST, then the wildcards '%' and '_',
  -- and pair the ILIKE with `escape '\'`. Result: wildcards typed by the user
  -- are treated as literal characters.
  v_text := nullif(trim(p_criteria->>'text'), '');
  v_text := replace(replace(replace(v_text, '\', '\\'), '%', '\%'), '_', '\_');
  v_make   := nullif(p_criteria->>'make',   '');
  v_model  := nullif(p_criteria->>'model',  '');
  v_colour := nullif(p_criteria->>'colour', '');
  v_bmin   := nullif(p_criteria->>'bounty_min',   '')::integer;
  v_bmax   := nullif(p_criteria->>'bounty_max',   '')::integer;
  v_days   := nullif(p_criteria->>'recency_days', '')::integer;

  -- total: count of ALL matching active posts (not limited) for the button/handle.
  -- SHARED PREDICATE (keep identical to the page subquery + search_posts_count).
  select count(*)
    into v_total
  from public.posts p
  where p.status = 'active'                                    -- SAFETY: active only
    and p.last_seen_location is not null
    and p.last_seen_location && v_bbox
    and (v_text   is null or (p.make  ilike '%' || v_text || '%' escape '\'
                           or p.model ilike '%' || v_text || '%' escape '\'))
    -- CASE-INSENSITIVE, BOTH SIDES: posts.make/model/colour have no CHECK and no
    -- normalisation, so "bmw" and "BMW" are both really stored. Copy 1 of 3 —
    -- the identical three lines are in the page subquery below and in
    -- search_posts_count; match_alert_zones (section A) uses the same comparison
    -- so search and alerts agree on what "a BMW" means. Change all four together.
    and (v_make   is null or lower(btrim(p.make))   = lower(btrim(v_make)))
    and (v_model  is null or lower(btrim(p.model))  = lower(btrim(v_model)))
    and (v_colour is null or lower(btrim(p.colour)) = lower(btrim(v_colour)))
    and (v_bmin   is null or p.bounty_amount_pence >= v_bmin)
    and (v_bmax   is null or p.bounty_amount_pence <= v_bmax)
    -- recency: NULL last_seen_at is dropped here (>= against NULL is NULL). Intended.
    and (v_days   is null or p.last_seen_at >= now() - (v_days || ' days')::interval);

  -- posts: capped, newest first, each carrying exact lat/lng for its pin.
  -- SHARED PREDICATE (keep identical to the count subquery + search_posts_count).
  select coalesce(jsonb_agg(t.j order by t.last_seen_at desc nulls last), '[]'::jsonb)
    into v_posts
  from (
    select
      -- Reuse the shared summary shape (distance is null — irrelevant on a map)
      -- and add the pin coordinates. ST_Y = latitude, ST_X = longitude.
      public.home_feed_post_json(p, null::numeric)
        || jsonb_build_object(
             'lat', ST_Y(p.last_seen_location::geometry),
             'lng', ST_X(p.last_seen_location::geometry)
           ) as j,
      p.last_seen_at
    from public.posts p
    where p.status = 'active'                                   -- SAFETY: active only
      and p.last_seen_location is not null
      and p.last_seen_location && v_bbox
      and (v_text   is null or (p.make  ilike '%' || v_text || '%' escape '\'
                             or p.model ilike '%' || v_text || '%' escape '\'))
      -- CASE-INSENSITIVE, BOTH SIDES. Copy 2 of 3 — the identical three lines
      -- are in the count subquery above and in search_posts_count. If total and
      -- the page ever disagree, it is because someone changed one of the three.
      and (v_make   is null or lower(btrim(p.make))   = lower(btrim(v_make)))
      and (v_model  is null or lower(btrim(p.model))  = lower(btrim(v_model)))
      and (v_colour is null or lower(btrim(p.colour)) = lower(btrim(v_colour)))
      and (v_bmin   is null or p.bounty_amount_pence >= v_bmin)
      and (v_bmax   is null or p.bounty_amount_pence <= v_bmax)
      -- recency: NULL last_seen_at is dropped here (>= against NULL is NULL). Intended.
      and (v_days   is null or p.last_seen_at >= now() - (v_days || ' days')::interval)
    order by p.last_seen_at desc nulls last
    limit v_limit
  ) t;

  return jsonb_build_object('total', v_total, 'posts', v_posts);
end;
$$;

comment on function public.search_posts(double precision, double precision, double precision, double precision, jsonb, integer) is
  'Returns { total, posts } for active posts inside a lat/lng bbox matching an optional jsonb criteria bag (text=make/model ILIKE, make/model/colour, bounty_min/max, recency_days). The make/model/colour criteria are matched CASE-INSENSITIVELY and trimmed on BOTH sides — posts.make/model/colour carry no CHECK and no normalisation (create_post stores what the owner typed; MakeField allows free-typed entry), so an exact `=` missed "bmw" vs "BMW"; match_alert_zones uses the identical comparison so search and alerts can never disagree about what "a BMW" means. SECURITY DEFINER (bypasses RLS); the UNCONDITIONAL status = active predicate is the enforcement. With ''{}''::jsonb it is a strict superset of the retired get_posts_in_viewport. posts capped at 100, newest first, exact lat/lng (safe only because active locations are already public under RLS). Plate is deliberately never a filter (privacy). Degenerate/inverted bbox -> empty. The shared WHERE predicate exists in THREE byte-for-byte copies (count subquery, page subquery, search_posts_count) — change one, change all three.';


-- =============================================================================
-- B (cont). RPC: search_posts_count(...) -> integer
--    -- REDEFINED, SAME SIGNATURE
-- =============================================================================
-- Cheap live count of active posts matching bbox + criteria — drives the
-- "Show N cars" button while the user drags filter sliders, WITHOUT paying for
-- jsonb_agg / home_feed_post_json. Returns just count(*).
--
-- SAFETY: SAME shared predicate as search_posts (keep byte-for-byte identical),
-- SAME unconditional active-only enforcement, SAME degenerate-bbox guard (-> 0).
-- This is copy 3 of 3 of the case-insensitive comparison; a stale exact `=` left
-- here would make the "Show N cars" button disagree with the results it opens.
create or replace function public.search_posts_count(
  p_min_lat   double precision,
  p_min_lng   double precision,
  p_max_lat   double precision,
  p_max_lng   double precision,
  p_criteria  jsonb
)
returns integer
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_bbox  geography;
  v_total integer;
  v_text   text;
  v_make   text;
  v_model  text;
  v_colour text;
  v_bmin   integer;
  v_bmax   integer;
  v_days   integer;
begin
  -- Degenerate / null / inverted bbox -> 0 (mirrors search_posts's empty result).
  if p_min_lat is null or p_min_lng is null
     or p_max_lat is null or p_max_lng is null
     or p_min_lat >= p_max_lat or p_min_lng >= p_max_lng then
    return 0;
  end if;

  v_bbox := ST_MakeEnvelope(p_min_lng, p_min_lat, p_max_lng, p_max_lat, 4326)::geography;

  -- Criteria extraction — identical to search_posts (see its escaping note).
  v_text := nullif(trim(p_criteria->>'text'), '');
  v_text := replace(replace(replace(v_text, '\', '\\'), '%', '\%'), '_', '\_');
  v_make   := nullif(p_criteria->>'make',   '');
  v_model  := nullif(p_criteria->>'model',  '');
  v_colour := nullif(p_criteria->>'colour', '');
  v_bmin   := nullif(p_criteria->>'bounty_min',   '')::integer;
  v_bmax   := nullif(p_criteria->>'bounty_max',   '')::integer;
  v_days   := nullif(p_criteria->>'recency_days', '')::integer;

  -- SHARED PREDICATE (keep identical to both subqueries in search_posts).
  select count(*)
    into v_total
  from public.posts p
  where p.status = 'active'                                    -- SAFETY: active only
    and p.last_seen_location is not null
    and p.last_seen_location && v_bbox
    and (v_text   is null or (p.make  ilike '%' || v_text || '%' escape '\'
                           or p.model ilike '%' || v_text || '%' escape '\'))
    -- CASE-INSENSITIVE, BOTH SIDES. Copy 3 of 3 — the identical three lines are
    -- in search_posts's count subquery and page subquery. This function's whole
    -- job is to predict that function's total, so a divergence here is a button
    -- that lies.
    and (v_make   is null or lower(btrim(p.make))   = lower(btrim(v_make)))
    and (v_model  is null or lower(btrim(p.model))  = lower(btrim(v_model)))
    and (v_colour is null or lower(btrim(p.colour)) = lower(btrim(v_colour)))
    and (v_bmin   is null or p.bounty_amount_pence >= v_bmin)
    and (v_bmax   is null or p.bounty_amount_pence <= v_bmax)
    -- recency: NULL last_seen_at is dropped here (>= against NULL is NULL). Intended.
    and (v_days   is null or p.last_seen_at >= now() - (v_days || ' days')::interval);

  return v_total;
end;
$$;

comment on function public.search_posts_count(double precision, double precision, double precision, double precision, jsonb) is
  'Returns the live count(*) of active posts inside a lat/lng bbox matching the SAME jsonb criteria as search_posts, including the SAME case-insensitive, trimmed make/model/colour comparison (copy 3 of 3 of that predicate — a divergence here is a "Show N cars" button that lies). SECURITY DEFINER (bypasses RLS); unconditional status = active predicate is the enforcement. Cheap count for the button (no jsonb_agg). Degenerate/inverted bbox -> 0.';


-- =============================================================================
-- INDEXES
-- =============================================================================
-- Deliberately NONE added here, and deliberately NO expression index on
-- lower(btrim(make)) / lower(btrim(model)) / lower(btrim(colour)).
--
-- Making the comparison case-insensitive makes it non-sargable: a plain btree on
-- posts.make can no longer serve it. That is knowingly accepted, for the same
-- reason 20260725100000 accepted the residual ILIKE — inside a bbox the GiST
-- index posts_last_seen_location_gix is the selective driver, reducing the table
-- to the posts physically inside the viewport, and the attribute criteria are
-- cheap residual filters on that already-tiny candidate set. On the alert side
-- the GiST index on alert_zones.point plays the same role over a table with at
-- most five rows per user.
--
-- Expression indexes (and the pg_trgm GIN index that file already deferred) are
-- a MEASURED follow-up: add them once EXPLAIN on production-scale data shows the
-- residual filter is actually the bottleneck. We do not add them speculatively.


-- =============================================================================
-- GRANTS
-- =============================================================================
-- SAFETY: RE-ASSERTED after CREATE OR REPLACE, exactly as in 20260725100000.
-- Replacing a function preserves its ACL today; re-stating it means the grants
-- are visible in the same file as the body they protect and cannot silently
-- diverge. anon is intentionally GRANTED here (unlike every function in
-- 20260802150000): logged-out browse of ACTIVE posts is already permitted by
-- posts_select_active_public, and the search RPCs emit nothing an anonymous
-- viewer could not already see. Signatures must match the CREATEs exactly.
revoke execute on function public.search_posts(double precision, double precision, double precision, double precision, jsonb, integer) from public;
grant  execute on function public.search_posts(double precision, double precision, double precision, double precision, jsonb, integer)
  to anon, authenticated, service_role;

revoke execute on function public.search_posts_count(double precision, double precision, double precision, double precision, jsonb) from public;
grant  execute on function public.search_posts_count(double precision, double precision, double precision, double precision, jsonb)
  to anon, authenticated, service_role;


-- =============================================================================
-- END OF MIGRATION
-- =============================================================================

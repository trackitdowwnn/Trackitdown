-- =============================================================================
-- WHAT: Every push notification's wording, rewritten to lead with the news.
--       Eleven CREATE OR REPLACEs, each character-identical to its predecessor
--       except the user-facing strings and the comments that quote them. No
--       signature, payload key, predicate, claim/idempotency rule, bound or
--       grant changes.
--
-- WHY:  Owner request (2026-09-22): "minimal but effective". The titles had
--       drifted into CATEGORY LABELS — "New sighting reported", "New message",
--       "About your sighting" — which is the one line a lock screen is
--       guaranteed to show, spent on naming the feature rather than the news.
--       The bodies then restated the title before getting to the point. So:
--       the title carries what happened, the body adds only what the title
--       cannot, and the restatement goes.
--
--         sighting  "New sighting reported"                -> "Your blue BMW was spotted"
--         alert     "Stolen car reported near you"         -> "Car stolen in Watford"
--         message   "New message"                          -> "Message from Oliver"
--         payout    "On its way - £250"                    -> "£250 on its way"
--         recovery  "Good news - a car you were watching…" -> "A car you watched was recovered"
--         upheld    "You've earned £250"                   -> "You were right - you've earned £250"
--       plus a tightened body on all eleven.
--
-- ⚠️ THREE THINGS THIS PASS MAY NOT TOUCH, and does not:
--       1. The alert body still ENDS with "don't approach." — the exact token
--          alerts_verification CHECK 21 matches, and SECURITY_AND_TRUST §1
--          requires the clause on every alert. The safety line is the last
--          thing in the sentence so owner-authored text cannot push it off.
--       2. The sighting body keeps its own don't-approach clause, for the same
--          reason: an owner told their car has been seen is exactly the person
--          who would drive over.
--       3. closed_uncredited still states the SEVENTY-TWO HOUR window in
--          words. That push is the only door to /sighting-dispute, so the
--          deadline is a money right, not a nicety.
--
-- ⚠️ THE SIGHTING AND MESSAGE TITLES NOW INTERPOLATE OWNER-AUTHORED TEXT, so
--       they take the same defences the bodies already had: the values are the
--       ones bounded at SELECT (make/first name <= 32, 'car'/'Someone' when
--       blank), the sentence is assembled from them rather than truncated
--       afterwards, regexp_replace collapses the double space a car with no
--       recorded colour leaves, and the finished title is bounded at 80. No
--       plate, no location, no spotter identity enters a title — the same
--       absences the bodies assert, now asserted one line higher.
--
-- SAFETY NOTE ON DESTRUCTIVE STATEMENTS: none. Eleven CREATE OR REPLACE
--       FUNCTIONs and their re-asserted grants; no schema, data, kind
--       vocabulary, audience, or privilege change. Grants are re-asserted
--       because CREATE OR REPLACE re-runs this project's ALTER DEFAULT
--       PRIVILEGES (which re-grant anon at CREATE time).
--
-- LINKS: supabase/migrations/20260921130000_server_copy_joins_the_glossary.sql
--          (the previous server-copy pass, and the pattern this follows);
--        supabase/tests/alerts_verification.sql (CHECK 21 — the safety clause);
--        supabase/tests/notification_center_verification.sql;
--        docs/SECURITY_AND_TRUST.md §1 (report, don't approach);
--        docs/DESIGN_SYSTEM.md (Tone of voice: calm, human, direct).
-- =============================================================================


-- =============================================================================
-- 1. claim_sighting_notification — restated from 20260802140000; title and body.
-- =============================================================================
create or replace function public.claim_sighting_notification(
  p_sighting_id uuid,
  p_actor       uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner   uuid;
  v_post_id uuid;
  -- Copy inputs, normalised at read time: blank/NULL make or colour must never
  -- reach the owner's lock screen as the word "null", and neither may push the
  -- safety clause past the 150-char cap (see the SAFETY note on the body).
  v_make    text;
  v_colour  text;
  v_claimed uuid;
begin
  -- Null inputs are simply an unclaimable request — same shared refusal, no
  -- exception, so a malformed invocation cannot be distinguished from a
  -- well-formed one that lost the race.
  if p_sighting_id is null or p_actor is null then
    return jsonb_build_object('claimed', false);
  end if;

  -- Every gate in ONE predicate, so every failure mode exits through the same
  -- `not found` branch below:
  --   s.id = p_sighting_id        -- the sighting must exist
  --   s.spotter_id = p_actor      -- AUTHORISATION: the actor WROTE this row
  --   s.notified_at is null       -- REPLAY: not already pushed
  --   p.status = 'active'         -- a closed post's owner is not chasing a car
  -- The owner-is-the-actor case is checked immediately after (create_sighting's
  -- OWN_POST gate makes it unreachable today; kept so the invariant does not
  -- silently rest on another function).
  -- SAFETY: posts.make / posts.colour are UNBOUNDED text (no length CHECK), and
  -- they are owner-authored. left(..., 32) each keeps the assembled body inside
  -- the 150-char cap, so a 400-character "make" can never truncate the
  -- don't-approach clause off the end of the push (§1: EVERY notification
  -- carries the safety line). Blank -> 'car' / '' so it never reads "your null".
  select p.owner_id,
         p.id,
         left(coalesce(nullif(btrim(p.make),   ''), 'car'), 32),
         left(coalesce(nullif(btrim(p.colour), ''), ''),    32)
    into v_owner, v_post_id, v_make, v_colour
  from public.sightings s
  join public.posts p on p.id = s.post_id
  where s.id = p_sighting_id
    and s.spotter_id = p_actor
    and s.notified_at is null
    and p.status = 'active';

  if not found or v_owner = p_actor then
    return jsonb_build_object('claimed', false);
  end if;

  -- THE CLAIM. Conditional by design: two concurrent invocations for the same
  -- sighting cannot both win (see IDEMPOTENCE above). Zero rows back = somebody
  -- else already claimed it between the select and here -> shared refusal.
  update public.sightings
     set notified_at = now()
   where id = p_sighting_id
     and notified_at is null
  returning id into v_claimed;

  if v_claimed is null then
    return jsonb_build_object('claimed', false);
  end if;

  -- AUDIT: a notification-claimed audit-log row belongs here once the audit_log
  -- table exists (SECURITY_AND_TRUST §7). Deferred with the moderation feature.

  return jsonb_build_object(
    'claimed', true,
    'user_id', v_owner,
    'post_id', v_post_id,
    -- The NEWS, not the feature's name: "Your blue BMW was spotted" is the one
    -- line a lock screen always shows, and it is the whole message for an owner
    -- who reads nothing else. Same values as the body below — already bounded at
    -- SELECT (make <= 32, 'car' when blank), assembled rather than truncated,
    -- with the same regexp_replace collapsing the double space a car with no
    -- recorded colour leaves ("Your  BMW"). Bounded at 80: a title is not a
    -- place to spend an owner's 32-character make twice.
    'title',   left(regexp_replace(format('Your %s %s was spotted', v_colour, v_make), '\s+', ' ', 'g'), 80),
    -- SAFETY: make/colour + the fact of a sighting only. NEVER the plate, NEVER
    -- the spotter's identity, NEVER the sighting's location or note — the owner
    -- opens the app for those. The don't-approach clause is not optional: an
    -- owner told their car has been spotted is exactly the person who would drive
    -- over (DOMAIN.md / SECURITY_AND_TRUST.md §1 — every notification carries the
    -- safety line). It stays LAST, so no interpolation can push it off the end.
    -- The car moved up into the title, so the body no longer repeats it.
    --
    -- ⚠️ "don''t approach" STAYS LOWER-CASE AND UNBROKEN. CHECK 23 in
    -- alerts_verification matches that exact token with LIKE, which is
    -- case-sensitive — a tidier "Don''t approach." at the start of a sentence
    -- would read identically to a human and silently fail the one test that
    -- proves the safety clause is there at all.
    'body', left('Someone reported seeing it — don''t approach, let the police handle it.', 150));
end;
$$;


-- =============================================================================
-- 2. match_alert_zones — restated from 20260802160000; title and body only.
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


-- =============================================================================
-- 3. claim_message_notification — restated from 20260802140000; title and body.
-- =============================================================================
create or replace function public.claim_message_notification(
  p_message_id uuid,
  p_actor      uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recipient uuid;
  v_thread_id uuid;
  -- Copy inputs, normalised AND length-bounded at read time (see the SAFETY
  -- block on the body).
  v_first     text;
  v_make      text;
  v_colour    text;
  v_claimed   uuid;
begin
  -- Same shared refusal for malformed input as the sighting claim.
  if p_message_id is null or p_actor is null then
    return jsonb_build_object('claimed', false);
  end if;

  -- Every gate in ONE predicate, so every failure exits through `not found`:
  --   m.id = p_message_id                    -- the message must exist
  --   m.sender_id = p_actor                  -- AUTHORISATION: the actor SENT it
  --   m.notified_at is null                  -- REPLAY: not already pushed
  --   m.kind <> 'system'                     -- the safety message never pushes
  --                                             (belt and braces: a system row's
  --                                             sender_id is NULL, so the actor
  --                                             check already excludes it)
  --   m.sender_id in (t.owner_id, t.spotter_id)
  --                                          -- the sender must BE a participant,
  --                                             so the recipient below is always
  --                                             the genuine other side
  -- RECIPIENT: whichever side of the thread did NOT send the message. Derived
  -- server-side from the thread row — never a parameter, so a caller can never
  -- redirect a push to a third party.
  -- SAFETY: first_name, make and colour are all UNBOUNDED user-authored text.
  -- left(..., 32) each keeps the assembled body inside the 150-char cap, so a
  -- padded first name cannot push the post context out of the notification (and
  -- cannot turn the body into a wall of attacker-chosen text on a lock screen).
  select case when t.owner_id = m.sender_id then t.spotter_id else t.owner_id end,
         t.id,
         left(coalesce(nullif(btrim(pr.first_name), ''), 'Someone'), 32),
         left(coalesce(nullif(btrim(p.make),        ''), 'car'),     32),
         left(coalesce(nullif(btrim(p.colour),      ''), ''),        32)
    into v_recipient, v_thread_id, v_first, v_make, v_colour
  from public.messages m
  join public.threads  t  on t.id  = m.thread_id
  join public.posts    p  on p.id  = t.post_id
  join public.profiles pr on pr.id = m.sender_id
  where m.id = p_message_id
    and m.sender_id = p_actor
    and m.notified_at is null
    and m.kind <> 'system'
    and m.sender_id in (t.owner_id, t.spotter_id);

  -- Never notify someone about their own action (unreachable while the thread
  -- CHECK forbids owner_id = spotter_id; kept so the invariant is local).
  if not found or v_recipient = p_actor then
    return jsonb_build_object('claimed', false);
  end if;

  -- THE CLAIM (conditional — see IDEMPOTENCE above).
  update public.messages
     set notified_at = now()
   where id = p_message_id
     and notified_at is null
  returning id into v_claimed;

  if v_claimed is null then
    return jsonb_build_object('claimed', false);
  end if;

  -- --- VOLUME: one push per thread per MESSAGE_PUSH_COOLDOWN ------------------
  -- SAFETY. send_message allows 20 messages per minute per thread, and this
  -- path has no rolling-24h cap (push_sends is the ALERT ledger). Without a
  -- cooldown a hostile counterpart can fire 20 HIGH-importance pushes a minute
  -- — sound and vibration each time — into a theft victim's phone. Collapsing
  -- (collapseId/tag) replaces the BANNER but not the buzz, so it is not a
  -- volume control on its own.
  --
  -- The message is still claimed above, so this suppresses the PUSH only: the
  -- message itself is delivered, the thread and its unread badge are unaffected,
  -- and the recipient sees everything the moment they open the app.
  if exists (
    select 1
      from public.push_sends s
     where s.user_id = v_recipient
       and s.kind = 'message'
       and s.subject_id = v_thread_id
       and s.created_at > now() - interval '2 minutes'
  ) then
    return jsonb_build_object('claimed', false);
  end if;

  insert into public.push_sends (user_id, kind, subject_id)
  values (v_recipient, 'message', v_thread_id);

  -- AUDIT: as above, a notification-claimed audit-log row lands here with the
  -- moderation feature (SECURITY_AND_TRUST §7).

  return jsonb_build_object(
    'claimed',   true,
    'user_id',   v_recipient,
    'thread_id', v_thread_id,
    -- Who it is from, not that a message exists. v_first is already bounded at
    -- SELECT (<= 32, 'Someone' when blank), so a padded first name cannot turn
    -- the title into a wall of attacker-chosen text on a lock screen — the same
    -- defence the body's note below describes, one line higher.
    'title',     left(format('Message from %s', v_first), 80),
    -- SAFETY: sender FIRST NAME + post context ONLY. Message CONTENT NEVER
    -- transits push — it crosses third-party infrastructure (Expo, then FCM/APNs)
    -- and SECURITY_AND_TRUST.md §3 forbids it. No surname, no avatar, no uid.
    -- regexp_replace collapses the double space a car with no recorded colour
    -- would otherwise leave; the pinned copy itself is unchanged.
    'body', left(regexp_replace(format('About the %s %s', v_colour, v_make), '\s+', ' ', 'g'), 150));
end;
$$;


-- =============================================================================
-- 4. claim_credited_notification — restated from 20260902110000; both bodies.
-- =============================================================================
create or replace function public.claim_credited_notification(
  p_post_id uuid,
  p_actor   uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sighting_id uuid;
  v_spotter     uuid;
  v_bounty      integer;
  v_transfer    integer;
  v_kind        text;
  v_title       text;
  v_body        text;
begin
  -- The credited sighting on a post the ACTOR owns. Status may be
  -- recovery_claimed (the normal moment) or recovered (a fast payout finished
  -- first) — both are legitimate times for the spotter to hear the news.
  select s.id, s.spotter_id
    into v_sighting_id, v_spotter
    from public.sightings s
    join public.posts p on p.id = s.post_id
   where s.post_id = p_post_id
     and s.status = 'credited'
     and p.owner_id = p_actor
     and p.status in ('recovery_claimed', 'recovered');

  if v_sighting_id is null then
    return jsonb_build_object('claimed', false);
  end if;

  -- MONEY: the spotter's share via payout_split — the one definition of the
  -- arithmetic. amount_pence is read whatever the payment status: held is the
  -- normal case, released means a fast payout beat the push.
  --
  -- ⚠️ `kind = 'bounty_escrow'` IS LOAD-BEARING. A £5 listing fee is a payment
  -- row too, and reading it here would produce "You've earned £4.75" on a
  -- listing that carries no reward — inventing exactly the number the original
  -- refused to invent. ADR-0014 records that these filters went missing
  -- elsewhere for four days and an hourly cron refunded fees.
  select p.amount_pence into v_bounty
    from public.payments p
   where p.post_id = p_post_id
     and p.status in ('held', 'released')
     and p.kind = 'bounty_escrow'
   limit 1;

  if v_bounty is not null then
    select transfer_pence into v_transfer
      from public.payout_split(v_bounty);

    -- The COPY, built here so its privacy is DB-testable: an amount and an
    -- instruction. No car, no plate, no location, no owner name — the spotter
    -- knows which sighting was theirs, and the tap lands on /payouts where the
    -- context is money, not the vehicle.
    v_kind  := 'credited';
    v_title := 'You''ve earned £' || to_char(v_transfer / 100.0, 'FM999990.00');
    -- The title already says what happened and how much; the body is the one
    -- thing it cannot carry — what to do next.
    v_body  := 'Tell us where to send it.';
  else
    -- ⚠️ THE REWARDLESS CREDIT. No amount exists, so the copy must not imply
    -- one — and must not apologise for its absence either. The listing said
    -- plainly there was no cash reward before this spotter reported anything;
    -- what they are owed here is being TOLD it counted, which is the whole of
    -- what "recognition is the reward" promises.
    v_kind  := 'credited_no_reward';
    v_title := 'Your sighting found the car';
    v_body  := 'The owner credited your report.';
  end if;

  -- ⚠️ THE CLAIM IS LAST, AND THAT IS THE FIX. The old body claimed here-ish
  -- FIRST and then tried to build copy, so a branch that could not produce copy
  -- burned the one-shot permanently and sent nothing, forever. Two concurrent
  -- callers now both build copy and exactly one wins this update, so the
  -- idempotency is identical — what changed is that nothing is consumed unless
  -- there is something to send.
  update public.sightings
     set credited_notified_at = now()
   where id = v_sighting_id
     and credited_notified_at is null
  returning id into v_sighting_id;

  if v_sighting_id is null then
    return jsonb_build_object('claimed', false);
  end if;

  return jsonb_build_object(
    'claimed', true,
    'user_id', v_spotter,
    'post_id', p_post_id,
    -- The CALLER must send this kind rather than assume 'credited' — the two
    -- branches route to different screens.
    'kind',    v_kind,
    'title',   v_title,
    'body',    v_body
  );
end $$;


-- =============================================================================
-- 5. claim_dispute_outcome_notification — restated from 20260921130000.
-- =============================================================================
create or replace function public.claim_dispute_outcome_notification(
  p_dispute_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id      uuid;
  v_status  text;
  v_spotter uuid;
  v_post    uuid;
  v_sight   uuid;
  v_bounty  integer;
  v_transfer integer;
begin
  -- Resolved and unclaimed only. The conditional update IS the idempotency.
  update public.refund_disputes
     set outcome_notified_at = now()
   where id = p_dispute_id
     and status in ('upheld', 'rejected')
     and outcome_notified_at is null
  returning id, status, spotter_id, post_id, sighting_id
    into v_id, v_status, v_spotter, v_post, v_sight;

  if v_id is null then
    return jsonb_build_object('claimed', false);
  end if;

  if v_status = 'rejected' then
    -- Final and calm. No reasons: the evidence was weighed by a person, and
    -- a reasons string would become an argument surface.
    return jsonb_build_object(
      'claimed', true,
      'kind', 'dispute_rejected',
      'user_id', v_spotter,
      'sighting_id', v_sight,
      'title', 'About your sighting',
      'body', 'We looked into it — this reward won''t be coming to you. Thank you for reporting it.'
    );
  end if;

  -- UPHELD: the earn moment, same shape as the credited push. held OR
  -- released — a fast payout may already have beaten this claim.
  select p.amount_pence into v_bounty
    from public.payments p
   where p.post_id = v_post
     and p.status in ('held', 'released')
   limit 1;

  if v_bounty is null then
    -- An upheld dispute with no funded payment should be impossible. Send no
    -- push rather than inventing a number (the claim stays consumed; the
    -- anomaly is for the logs, not the spotter).
    return jsonb_build_object('claimed', false);
  end if;

  select transfer_pence into v_transfer from public.payout_split(v_bounty);

  return jsonb_build_object(
    'claimed', true,
    'kind', 'dispute_upheld',
    'user_id', v_spotter,
    'sighting_id', v_sight,
    -- The verdict and the amount in one line: this reader contested a decision
    -- and is owed "you were right" before anything else.
    'title', 'You were right — you''ve earned £' || to_char(v_transfer / 100.0, 'FM999990.00'),
    'body', 'Tell us where to send it.'
  );
end $$;


-- =============================================================================
-- 6. claim_payout_sent_notification — restated from 20260921130000.
-- =============================================================================
create or replace function public.claim_payout_sent_notification(p_post_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment  uuid;
  v_transfer integer;
  v_sighting uuid;
  v_spotter  uuid;
begin
  if p_post_id is null then
    return jsonb_build_object('claimed', false);
  end if;

  -- Every gate in ONE predicate: a released payment on this post, its recorded
  -- transfer amount, and the credited sighting that names the recipient.
  select pay.id, pay.transfer_amount_pence, s.id, s.spotter_id
    into v_payment, v_transfer, v_sighting, v_spotter
    from public.payments pay
    join public.sightings s on s.post_id = pay.post_id and s.status = 'credited'
   where pay.post_id = p_post_id
     and pay.status = 'released'
     and pay.transfer_amount_pence is not null
     and pay.payout_notified_at is null
   limit 1;

  if v_payment is null then
    return jsonb_build_object('claimed', false);
  end if;

  -- The conditional update IS the idempotency.
  update public.payments
     set payout_notified_at = now()
   where id = v_payment
     and payout_notified_at is null
  returning id into v_payment;

  if v_payment is null then
    return jsonb_build_object('claimed', false);
  end if;

  -- MONEY: the amount is the RECORDED transfer_amount_pence — what
  -- mark_recovery_paid wrote when the Stripe transfer was created — NEVER a
  -- payout_split recomputation, which could drift from what actually moved.
  -- Formatted exactly as claim_credited_notification formats its amount.
  return jsonb_build_object(
    'claimed',     true,
    'user_id',     v_spotter,
    'sighting_id', v_sighting,
    'post_id',     p_post_id,
    'title',       '£' || to_char(v_transfer / 100.0, 'FM999990.00') || ' on its way',
    'body',        'Heading to your bank account.'
  );
end $$;


-- =============================================================================
-- 7. claim_not_credited_notifications — restated from 20260806140000; body.
-- =============================================================================
create or replace function public.claim_not_credited_notifications(p_post_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner   uuid;
  v_winner  uuid;
  v_colour  text;
  v_make    text;
  v_desc    text;
  v_users   jsonb;
begin
  if p_post_id is null then
    return jsonb_build_object('claimed', false);
  end if;

  -- GATE (unchanged): a genuinely recovered post that credited SOMEBODY. The
  -- credited sighting is what separates this from `recovered_no_spotter`,
  -- where the runners-up already heard `closed_uncredited` from
  -- create_refund_hold and must not now be told a second, contradictory story.
  select p.owner_id,
         left(coalesce(nullif(btrim(p.colour), ''), ''), 32),
         left(coalesce(nullif(btrim(p.make),   ''), ''), 32),
         s.spotter_id
    into v_owner, v_colour, v_make, v_winner
    from public.posts p
    join public.sightings s
      on s.post_id = p.id
     and s.status = 'credited'
   where p.id = p_post_id
     and p.status = 'recovered';

  if v_owner is null or v_winner is null then
    return jsonb_build_object('claimed', false);
  end if;

  -- Claim + audience in ONE conditional pass. The update is the idempotency,
  -- so two concurrent releases send once.
  --
  -- CLAIM EVERY eligible row, DEDUPE ONLY THE ANSWER. A spotter who filed
  -- three sightings on one car is one person who gets one push — that is the
  -- `distinct` in the aggregate below. It is NOT in this predicate, because a
  -- claim that stamped one of their three rows would leave the other two
  -- eligible and let the next call announce to them all over again (the bug
  -- this migration exists to fix). One call must exhaust the post.
  with claimed as (
    update public.sightings s
       set not_credited_notified_at = now()
     where s.post_id = p_post_id
       and s.status <> 'credited'
       and s.not_credited_notified_at is null
       -- Belt and braces: the winner is excluded by status already (theirs IS
       -- the credited row), and the owner cannot sight their own car, but
       -- neither should ever receive this.
       and s.spotter_id <> v_winner
       and s.spotter_id <> v_owner
    returning s.spotter_id
  )
  select coalesce(jsonb_agg(distinct claimed.spotter_id), '[]'::jsonb)
    into v_users
    from claimed;

  -- THE COPY (unchanged), built here so it is DB-testable. Same privacy line
  -- every other announcement draws (DOMAIN.md Notifications payload):
  -- make/colour ONLY — no plate, no location, no owner identity, and NOTHING
  -- about the winner: not their name, not their count, not the amount.
  -- "Another spotter" is the whole of what the runner-up is entitled to know
  -- about a stranger. Falls back to 'car' so it never reads "The  you reported".
  v_desc := coalesce(nullif(btrim(concat_ws(' ', nullif(v_colour, ''), nullif(v_make, ''))), ''), 'car');

  return jsonb_build_object(
    'claimed',  true,
    'user_ids', v_users,
    'post_id',  p_post_id,
    'title',    'A car you reported was found',
    'body',     'The ' || v_desc || ' is back with its owner. Another spotter''s report led to it — thank you for looking out.'
  );
end $$;


-- =============================================================================
-- 8. claim_recovery_notifications — restated from 20260806100000; title and body.
-- =============================================================================
create or replace function public.claim_recovery_notifications(p_post_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner  uuid;
  v_colour text;
  v_make   text;
  v_desc   text;
  v_users  jsonb;
begin
  if p_post_id is null then
    return jsonb_build_object('claimed', false);
  end if;

  -- The conditional update IS the idempotency: of two concurrent calls,
  -- exactly one row comes back. Copy inputs are normalised and BOUNDED here
  -- (make/colour are unbounded owner-authored text — the match_alert_zones
  -- rule: bound each field, never truncate the finished sentence).
  update public.posts
     set recovery_notified_at = now()
   where id = p_post_id
     and recovery_notified_at is null
     and status in ('recovered', 'recovered_no_spotter')
  returning owner_id,
            left(coalesce(nullif(btrim(colour), ''), ''), 32),
            left(coalesce(nullif(btrim(make),   ''), ''), 32)
       into v_owner, v_colour, v_make;

  if v_owner is null then
    return jsonb_build_object('claimed', false);
  end if;

  -- The AUDIENCE: everyone watching this post, EXCLUDING the owner (the
  -- watchlist insert policy lets an owner watch their own post, and they do
  -- not need to be told their own good news).
  select coalesce(jsonb_agg(w.user_id), '[]'::jsonb)
    into v_users
    from public.watchlist_items w
   where w.post_id = p_post_id
     and w.user_id <> v_owner;

  -- The COPY, built here so its privacy is DB-testable. Same line the alert
  -- copy draws (DOMAIN.md Notifications payload): make/colour ONLY — NO plate,
  -- NO location (not even district grain: a recovered car's whereabouts are
  -- nobody's business), no owner identity. Falls back to 'car' so it never
  -- reads "The  you were watching".
  v_desc := coalesce(nullif(btrim(concat_ws(' ', nullif(v_colour, ''), nullif(v_make, ''))), ''), 'car');

  return jsonb_build_object(
    'claimed',  true,
    'user_ids', v_users,
    'post_id',  p_post_id,
    'title',    'A car you watched was recovered',
    'body',     'The ' || v_desc || ' is back with its owner. Thanks for keeping an eye out.'
  );
end $$;


-- =============================================================================
-- 9. claim_sighting_confirmed_notification — restated from 20260815100000; body.
-- =============================================================================
create or replace function public.claim_sighting_confirmed_notification(
  p_sighting_id uuid,
  p_actor       uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id      uuid;
  v_spotter uuid;
  v_make    text;
  v_colour  text;
  v_count   integer;
  v_badge   text;
  v_body    text;
begin
  -- A confirmed sighting on a post the ACTOR owns. Bounded and blank-safe at
  -- the SELECT, not at the concatenation — see the banner.
  select s.id,
         s.spotter_id,
         left(coalesce(nullif(btrim(p.make),   ''), ''), 32),
         left(coalesce(nullif(btrim(p.colour), ''), ''), 32)
    into v_id, v_spotter, v_make, v_colour
    from public.sightings s
    join public.posts p on p.id = s.post_id
   where s.id = p_sighting_id
     and s.status = 'helpful'
     and p.owner_id = p_actor;

  if v_id is null then
    return jsonb_build_object('claimed', false);
  end if;

  -- The conditional update IS the idempotency: of two concurrent calls,
  -- exactly one row comes back.
  update public.sightings
     set confirmed_notified_at = now()
   where id = v_id
     and confirmed_notified_at is null
  returning id into v_id;

  if v_id is null then
    return jsonb_build_object('claimed', false);
  end if;

  -- The badge line, derived not asserted. EXACTLY on a rung or nothing:
  -- landing past one (two confirmations racing this claim) says nothing rather
  -- than something wrong. Labels mirror reputation.ts COUNTER_KINDS exactly.
  select sightings_helpful into v_count
    from public.profiles where id = v_spotter;

  v_badge := case v_count
               when 1  then 'First helpful mark'
               when 5  then '5 helpful marks'
               when 25 then '25 helpful marks'
             end;

  -- The title already says a sighting of theirs was confirmed, and the spotter
  -- knows which car they reported — so the body no longer names it. That
  -- retired the colour/make descriptor this function used to assemble here
  -- (with its blank-halves collapse and its 'car' fallback); the SELECT above
  -- still bounds both columns, and nothing else reads them, so the only thing
  -- lost is a sentence that repeated the title.
  v_body := 'The owner confirmed it.';
  if v_badge is not null then
    v_body := v_body || ' That earned you "' || v_badge || '".';
  end if;

  return jsonb_build_object(
    'claimed', true,
    'user_id', v_spotter,
    'sighting_id', v_id,
    'title', 'Your sighting was confirmed',
    'body', v_body
  );
end;
$$;


-- =============================================================================
-- 10. create_refund_hold — restated from 20260805100000; the closed_uncredited body.
-- =============================================================================
create or replace function public.create_refund_hold(
  p_post_id      uuid,
  p_owner_id     uuid,
  p_exit_path    text,
  p_attested_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner    uuid;
  v_status   text;
  v_recent   uuid[];
  v_expires  timestamptz;
  v_inserted uuid;
  v_notify   jsonb;
begin
  if p_exit_path not in ('deactivate', 'recovery') then
    raise exception 'BAD_EXIT_PATH';
  end if;

  -- Lock the post: a concurrent second tap must not create two holds, close
  -- the post twice, or race the recompute below.
  select owner_id, status::text into v_owner, v_status
    from public.posts where id = p_post_id for update;

  if v_owner is null or v_owner <> p_owner_id then
    raise exception 'POST_NOT_FOUND';
  end if;

  -- IDEMPOTENCY FIRST, before any status check: the hold itself changes the
  -- post's status (deactivate delists it below), so a retry after a dropped
  -- response arrives with a post that no longer passes the entry checks. The
  -- existing hold IS the answer — and it sends nothing (already claimed).
  select expires_at into v_expires
    from public.refund_holds where post_id = p_post_id;
  if found then
    return jsonb_build_object('held', true, 'expiresAt', v_expires, 'notify', '[]'::jsonb);
  end if;

  if p_exit_path = 'deactivate' and v_status not in ('active', 'pending_verification') then
    raise exception 'POST_NOT_REFUNDABLE';
  end if;
  if p_exit_path = 'recovery' then
    if v_status <> 'recovery_claimed' then
      raise exception 'POST_NOT_CLAIMED';
    end if;
    -- A credited sighting means this money is a spotter's, not refundable.
    if exists (
      select 1 from public.sightings
       where post_id = p_post_id and status = 'credited'
    ) then
      raise exception 'RECOVERY_HAS_CREDITED_SIGHTING';
    end if;
  end if;

  -- Recompute NOW, under the lock — the attestation the client gathered a
  -- moment ago must still cover reality. A sighting reported between the
  -- pre-flight and the confirm is exactly the case ATTESTATION_STALE exists
  -- for: the owner has not seen it, so they cannot have attested to it.
  select coalesce(array_agg(id), '{}')
    into v_recent
    from public.recent_uncredited_sightings(p_post_id) as t(id);

  if cardinality(v_recent) = 0 then
    -- The caller should have refunded immediately. Fail loudly: silently
    -- holding a refund nothing requires would strand the owner's money.
    raise exception 'NO_HOLD_REQUIRED';
  end if;
  if not (v_recent <@ p_attested_ids) then
    raise exception 'ATTESTATION_STALE';
  end if;

  v_expires := now() + interval '72 hours';

  -- Idempotent: a retry after a dropped response falls through to the
  -- existing hold (and sends nothing — the pushes below were already claimed).
  insert into public.refund_holds (post_id, owner_id, exit_path, sighting_ids, expires_at)
  values (p_post_id, p_owner_id, p_exit_path, v_recent, v_expires)
  on conflict (post_id) do nothing
  returning post_id into v_inserted;

  if v_inserted is null then
    select expires_at into v_expires from public.refund_holds where post_id = p_post_id;
    return jsonb_build_object('held', true, 'expiresAt', v_expires, 'notify', '[]'::jsonb);
  end if;

  -- The deactivate path DELISTS NOW: the owner asked for the listing to come
  -- down and that part is theirs unconditionally — only the money waits.
  -- (mark_post_payment_refunded's post update becomes a benign no-op at sweep
  -- time; the payment flip is what matters there.) The recovery path is
  -- already on recovery_claimed, which is precisely "claim recorded, money
  -- not moved", so it stays put.
  if p_exit_path = 'deactivate' then
    update public.posts set status = 'cancelled' where id = p_post_id;
  end if;

  -- Claim + build the pushes in one conditional pass (the claim IS the
  -- idempotency). COPY LIVES HERE, DB-testable: no car, no plate, no owner
  -- name — the spotter knows which sighting was theirs.
  with claimed as (
    update public.sightings
       set closed_notified_at = now()
     where id = any (v_recent)
       and closed_notified_at is null
    returning id, spotter_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'user_id', claimed.spotter_id,
           'sighting_id', claimed.id,
           'title', 'Did your sighting help find it?',
           -- ⚠️ THE 72 HOURS STAYS IN WORDS. This push is the only door to
           -- /sighting-dispute, so the deadline is a money right, not a detail.
           'body', 'A car you sighted closed without crediting anyone. You have 72 hours to tell us if it was yours.'
         )), '[]'::jsonb)
    into v_notify
    from claimed;

  return jsonb_build_object('held', true, 'expiresAt', v_expires, 'notify', v_notify);
end $$;


-- =============================================================================
-- 11. claim_cancelled_deletion_warnings — restated from 20260921120000; body.
-- =============================================================================
create or replace function public.claim_cancelled_deletion_warnings(p_limit integer default 200)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- ⚠️ THE ONE CONSTANTS BLOCK. 27 days = the purge's 30 minus 3 days of
  -- notice; the "about 3 days" in the body below is this same arithmetic in
  -- words — move one, move both. purge_cancelled_posts' own 72-hour wait (its
  -- guarantee that the notice was ever sent) lives THERE, not here.
  c_warn_after constant interval := interval '27 days';
  v_rows jsonb;
begin
  with due as (
    select p.id
      from public.posts p
     where p.status = 'cancelled'
       and p.deletion_warned_at is null
       and p.closed_at is not null
       and p.closed_at < now() - c_warn_after
     order by p.closed_at
     limit greatest(p_limit, 0)
  ),
  claimed as (
    update public.posts p
       set deletion_warned_at = now()
      from due
     where p.id = due.id
       -- Re-checked inside the update: this is what makes two concurrent
       -- sweeps safe, not the select above.
       and p.status = 'cancelled'
       and p.deletion_warned_at is null
    returning p.id, p.owner_id, p.make, p.model, p.colour
  )
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'post_id', c.id,
               'user_id', c.owner_id,
               -- A cancelled post can be sparse (unlike still_missing's
               -- active ones), so an all-NULL car falls back to 'vehicle'
               -- rather than rendering 'Your cancelled  listing…'.
               'title',   'Your cancelled ' || coalesce(
                            nullif(
                              left(
                                trim(coalesce(c.colour, '') || ' ' ||
                                     coalesce(c.make, '')   || ' ' ||
                                     coalesce(c.model, '')),
                                48
                              ),
                              ''
                            ),
                            'vehicle'
                          ) || ' listing is deleted soon',
               'body',    'Deleted for good in about 3 days. Nothing you need to do.'
             )
           ),
           '[]'::jsonb
         )
    into v_rows
    from claimed c;

  return v_rows;
end $$;


-- =============================================================================
-- Grants, re-asserted. CREATE OR REPLACE re-runs this project's ALTER DEFAULT
-- PRIVILEGES, which re-grant anon at CREATE time; every one of these functions
-- is SERVICE ROLE ONLY and must stay so. Copied from the migrations each
-- function was restated from — no privilege changes hands here.
-- =============================================================================
revoke execute on function public.claim_sighting_notification(uuid, uuid) from public, anon, authenticated;
grant  execute on function public.claim_sighting_notification(uuid, uuid) to service_role;

revoke execute on function public.match_alert_zones(uuid, int) from public, anon, authenticated;
grant  execute on function public.match_alert_zones(uuid, int) to service_role;

revoke execute on function public.claim_message_notification(uuid, uuid) from public, anon, authenticated;
grant  execute on function public.claim_message_notification(uuid, uuid) to service_role;

revoke execute on function public.claim_credited_notification(uuid, uuid) from public, anon, authenticated;
grant  execute on function public.claim_credited_notification(uuid, uuid) to service_role;

revoke execute on function public.claim_dispute_outcome_notification(uuid) from public, anon, authenticated;
grant  execute on function public.claim_dispute_outcome_notification(uuid) to service_role;

revoke execute on function public.claim_payout_sent_notification(uuid) from public, anon, authenticated;
grant  execute on function public.claim_payout_sent_notification(uuid) to service_role;

revoke execute on function public.claim_not_credited_notifications(uuid) from public, anon, authenticated;
grant  execute on function public.claim_not_credited_notifications(uuid) to service_role;

revoke execute on function public.claim_recovery_notifications(uuid) from public, anon, authenticated;
grant  execute on function public.claim_recovery_notifications(uuid) to service_role;

revoke execute on function public.claim_sighting_confirmed_notification(uuid, uuid) from public, anon, authenticated;
grant  execute on function public.claim_sighting_confirmed_notification(uuid, uuid) to service_role;

revoke execute on function public.create_refund_hold(uuid, uuid, text, uuid[]) from public, anon, authenticated;
grant  execute on function public.create_refund_hold(uuid, uuid, text, uuid[]) to service_role;

revoke execute on function public.claim_cancelled_deletion_warnings(integer) from public, anon, authenticated;
grant  execute on function public.claim_cancelled_deletion_warnings(integer) to service_role;


-- =============================================================================
-- Catalogue comments, re-issued for the three functions whose SAFETY sentence
-- named the FIELD a value travels in.
--
-- ⚠️ WHY THIS IS NOT HOUSEKEEPING. `comment on function` survives CREATE OR
-- REPLACE, so without these the live catalogue would keep asserting, of copy
-- this migration moved, that "the body is the sender's FIRST NAME", that "the
-- body carries make/colour", and that "the body carries the district-grain
-- last_seen_locality". Each of those is now the TITLE. A stale SAFETY claim is
-- how the next reader concludes a control sits somewhere it does not — the
-- failure this project has already recorded twice (SECURITY_AND_TRUST §3's
-- EXIF entry, §7's moderation entry).
--
-- ⚠️ EACH IS THE FULL PREDECESSOR TEXT WITH ONLY THE FIELD NAMES CHANGED.
-- `comment on function` REPLACES, so a shorter re-issue silently deletes every
-- claim it does not repeat. The first cut of this block did exactly that to
-- match_alert_zones — dropping the load-bearing `distinct`, the search_posts
-- comparison cross-reference that home_feed_verification cites by name, the
-- 30-day push_sends purge, the three LIMITATIONs and the revoke rationale,
-- none of which have anything to do with which field carries a locality. They
-- are carried over verbatim here.
--
-- FOUR functions, not three: claim_sighting_confirmed_notification's comment
-- said "Carries the car as the spotter already saw it", and this pass removed
-- the car from that push entirely.
-- =============================================================================
comment on function public.claim_sighting_notification(uuid, uuid) is
  'Authorises AND claims the sighting -> POST OWNER push exactly once. SERVICE ROLE ONLY (the actor is a parameter, not auth.uid(): the caller is an Edge Function that already verified the end-user JWT — a client grant would let a user nominate themselves as the actor and defeat the whole check). Returns {"claimed": true, user_id (post owner), post_id, title, body} on the single winning call, and the IDENTICAL {"claimed": false} for every refusal — missing sighting, actor is not the sighting''s spotter (AUTHORISATION), post not active, owner is the actor, or already notified — so it is no existence oracle for sighting ids. Idempotent via a conditional `update sightings set notified_at = now() where id = $1 and notified_at is null returning id`, so two concurrent calls cannot both claim (REPLAY). SAFETY: the push carries make/colour (in the TITLE since 2026-09-22 — "Your blue BMW was spotted") and the don''t-approach line (in the body) ONLY — never the plate, the spotter''s identity, the sighting location or the note (SECURITY_AND_TRUST §1); make/colour fall back to ''car''/'''' so it can never read "your null null", and each is left(...,32)-bounded (both columns are unbounded owner-authored text) before assembly, with the title bounded at 80 and the body a literal, so nothing an owner types can truncate the safety clause away. Does not send, and deliberately does NOT write push_sends: this is the authorisation + replay boundary, while volume control (the rolling-24h cap / same-subject dedup) belongs to the send path. post_id is the kind=''sighting'' subject_id for that ledger.';

comment on function public.claim_message_notification(uuid, uuid) is
  'Authorises AND claims the message -> OTHER PARTICIPANT push exactly once. SERVICE ROLE ONLY (actor is a parameter, not auth.uid(): the caller is an Edge Function that already verified the end-user JWT). Returns {"claimed": true, user_id (the other participant, derived server-side from the thread — never a parameter), thread_id, title, body} on the single winning call, and the IDENTICAL {"claimed": false} for every refusal — missing message, actor is not the sender (AUTHORISATION), kind=''system'' (the automatic safety first message must never push), recipient is the actor, or already notified — so it is no existence oracle for message ids or for whether two users have a thread. Idempotent via a conditional `update messages set notified_at = now() where id = $1 and notified_at is null returning id` (REPLAY). SAFETY: the push carries the sender''s FIRST NAME (in the TITLE since 2026-09-22 — "Message from Beth") + post make/colour (in the body) ONLY — message CONTENT never transits push (third-party infrastructure; SECURITY_AND_TRUST §3), and no surname, avatar or uid is ever returned (§1); first_name falls back to ''Someone'' when blank and make/colour to ''car''; all three are left(...,32)-bounded (unbounded user-authored columns) before assembly, and the title is bounded at 80, so neither line can be padded into a wall of attacker-chosen text. Deliberately NOT gated on the post being active (send_message already blocks writes on closed posts; history stays readable). Does not send. VOLUME: writes a kind=''message'' push_sends row keyed on the thread and returns {"claimed": false} when one exists from the last 2 minutes — send_message allows 20 messages/minute/thread and this path has no rolling-24h cap, so without the cooldown a hostile counterpart could fire 20 HIGH-importance pushes a minute (sound + vibration each) at a theft victim; collapseId replaces the banner but not the buzz. The MESSAGE is still claimed and delivered — only the push is suppressed.';

comment on function public.match_alert_zones(uuid, int) is
  'SERVICE ROLE ONLY. The spotter-alert fan-out: returns { user_ids: [...], title, body } for one post and records a push_sends row per matched user in the SAME transaction, under pg_advisory_xact_lock(''notify_spotters:<post_id>''), so the cap cannot be raced. A user matches when an alert_zones row of theirs is enabled, is NOT the post owner, ST_DWithin(zone.point, post.last_seen_location, zone.radius_m) (geography => metres, GiST-assisted), SATISFIES THAT ALERT''S CRITERIA — make / model / colour / body_type compared lower(btrim(...)) on both sides, min_bounty_pence <= the post''s bounty (integer pence, GBP), last_seen_at inside recency_days; NULL on the zone side means ANY, so a pre-20260802150000 zone matches exactly what it always did — has no existing push_sends row for (this user, kind=''alert'', this post), and has had fewer than p_max_per_day alert pushes in the rolling 24h. FIVE ALERTS STILL PRODUCE ONE PUSH: `select distinct z.user_id`, the (user_id, kind, subject_id) dedup and the rolling-24h cap are ALL user-keyed, never alert-keyed — the distinct is LOAD-BEARING now that 20260802150000 dropped the one-zone-per-user unique index. The case-insensitive comparison exists because posts.make/model/colour have no CHECK and no normalisation (create_post stores what the owner typed; MakeField allows free-typed entry), so an exact `=` silently drops the spotter who explicitly asked for that car; search_posts/search_posts_count use the identical comparison so the two can never disagree. Empty user_ids for a missing post, a null last-seen point, an empty audience, or everyone deduped/capped — all normal outcomes, never errors. The COPY IS BUILT HERE ON PURPOSE so its privacy properties are covered by npm run test:db rather than a second (Deno) test stack: the push carries the district-grain last_seen_locality ONLY (in the TITLE since 2026-09-22 — "Car stolen in Hemel Hempstead"; never street-grain last_seen_area), never the plate, never coordinates, and the body always ENDS with the don''t-approach clause (SECURITY_AND_TRUST §1); body_type/bounty/last_seen_at are read for MATCHING ONLY and are deliberately never interpolated into it. Each interpolated value is bounded BEFORE assembly (descriptor 48 in the body, locality 40 in the title) rather than truncating the finished sentence — the clause is last, so an outer left() would let an owner pad `make` until the safety line fell off the end. Also purges push_sends rows older than 30 days (no pg_cron here); safe because posts.alerts_sent_at, not this ledger, is the primary idempotency guard. LIMITATION 1: the advisory lock is keyed on the POST, so two concurrent invocations for DIFFERENT posts sharing a recipient could each see a count of 2 and both send — worst case a 4th push in a day. LIMITATION 2: ledger rows are written before the send, so a total send failure costs the user a cap slot and permanently dedups them out of that post — conservative in the right direction, but real. LIMITATION 3: the criteria comparisons are non-sargable (no index can serve lower(btrim(...))), which is fine because the GiST spatial predicate narrows first, an alert table holds at most 5 rows per user, and this runs once per post going live; expression indexes are a measured follow-up. Revoked from public, anon and authenticated: it writes the rate-limit ledger and returns other users'' ids, which is a location oracle over strangers.';

comment on function public.claim_sighting_confirmed_notification(uuid, uuid) is
  'Claims the sighting_confirmed push for a spotter whose sighting the post owner marked helpful. Actor must own the post; the sighting must be helpful; the conditional update on confirmed_notified_at is the idempotency. Every refusal returns the IDENTICAL {claimed:false} — no oracle. Copy is built HERE (so npm run test:db covers it) and names a badge ONLY when the spotter''s counter sits exactly on a rung, so it under-claims rather than over-claims. Carries NO car since 2026-09-22 — the title says the sighting was confirmed and the body is the literal "The owner confirmed it." (plus the badge sentence when one is earned); no vehicle, no owner identity, no location, no plate.';

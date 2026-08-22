-- =============================================================================
-- WHAT: The verification loop's write boundary.
--         1. confirmation_pair_count  — the collusion signal nobody was asking
--         2. mark_sighting_not_mine   — the owner's "that isn't my car"
--         3. mark_sighting_helpful    — re-stated: reviewed_at, a self-check,
--                                       a collusion gate, and a badge-threshold
--                                       report for the spotter's notification
--         4. my_sighting_record       — what a spotter may know about their own
--
-- WHY:  Reputation is manufactured on the FREE path. `credited` costs an owner
--       a real bounty and passes through the collusion gate in release-payout;
--       `helpful` is a one-tap, evidence-free opinion that until now had no
--       self-check, no rate limit, no gate and no audit — and it is 5 of the 6
--       counters a Trusted Spotter needs (TRUSTED_MIN_HELPFUL = 5,
--       TRUSTED_MIN_RECOVERIES = 1). The attack was two accounts and one £10
--       post: A posts, B reports 3 sightings (the per-post daily cap), A marks
--       them helpful, repeat tomorrow, A credits one. B is a Trusted Spotter
--       and the collusion check never ran, because it lives in release-payout.
--
--       THE PAIR SIGNAL IS THE NEW ONE, AND IT IS THE CHEAP ONE. The existing
--       gate reads shared device, matching email and shared card
--       (_shared/collusion.ts) and its own header admits all three fall to two
--       phones, two cards and two unrelated emails. What survives that is the
--       RELATIONSHIP: the same owner confirming the same spotter again and
--       again. payout_reviews has stored owner_id and spotter_id since
--       20260803140000 and nothing has ever asked the pair question.
--
--       ⚠️ COUNTED IN DISTINCT POSTS, NOT SIGHTINGS. One spotter filing three
--       sightings on one stolen car and the owner confirming all three is the
--       ORDINARY case — the per-post cap is literally 3/day. Counting sightings
--       would flag the app's happy path on day one. Three of an owner's
--       SEPARATE listings confirmed by the same person is the shape that has no
--       innocent reading.
--
-- SAFETY: a flagged pair still gets its confirmation RECORDED — the status
--       moves, reviewed_at stamps, the owner's screen tells the truth. What it
--       does not get is the counter bump. Reputation is the thing being farmed,
--       so reputation is the thing withheld; silently, because a message saying
--       "this didn't count" is a tutorial in which signal caught them
--       (_shared/collusion.ts's rule, kept). Honest limit, on the record: an
--       innocent pair caught by this loses credit and is never told. That is
--       the cost of not teaching the attack, and it is why the threshold is 3
--       distinct posts rather than 1.
--
--       'not_mine' bumps NOTHING. It is the absence of a confirmation, not a
--       punishment, and no counter anywhere may read it.
-- LINKS: supabase/migrations/20260814100000_sighting_verification.sql (state);
--        supabase/migrations/20260803140000_payout_collusion_check.sql
--          (shared_device_exists, flag_payout_for_review — reused, not rebuilt);
--        supabase/functions/_shared/collusion.ts (the payout-path sibling);
--        src/shared/lib/spotterTrust.ts (TRUSTED_MIN_*, and why volume ≠ trust).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. The pair signal. DISTINCT POSTS of this owner on which this spotter
--    already holds a confirmation. Cheap: the (post_id, spotter_id, created_at)
--    index on sightings covers the lookup and posts is keyed by id.
--
--    Not grantable — a client able to ask "how many times have we transacted"
--    could binary-search the threshold and tune around it.
-- -----------------------------------------------------------------------------
create or replace function public.confirmation_pair_count(
  p_owner_id   uuid,
  p_spotter_id uuid
)
returns integer
language sql
stable
set search_path = ''
as $$
  select count(distinct s.post_id)::integer
    from public.sightings s
    join public.posts p on p.id = s.post_id
   where p.owner_id = p_owner_id
     and s.spotter_id = p_spotter_id
     and s.status in ('helpful', 'credited');
$$;

comment on function public.confirmation_pair_count(uuid, uuid) is
  'How many of this owner''s DISTINCT posts this spotter already holds a confirmation on. The collusion signal that survives two phones, two cards and two emails — the relationship itself. Distinct POSTS, never sightings: three sightings on one car confirmed by one owner is the ordinary case (the per-post cap is 3/day). Not grantable to clients: a readable threshold is a tunable one.';

revoke all on function public.confirmation_pair_count(uuid, uuid) from public;

revoke all on function public.confirmation_pair_count(uuid, uuid) from anon;

revoke all on function public.confirmation_pair_count(uuid, uuid) from authenticated;

-- -----------------------------------------------------------------------------
-- 2. mark_sighting_not_mine — the verdict the schema could not hold until now.
--    Shape copied from mark_sighting_helpful (20260801130000:416): row lock
--    FIRST, opaque NOT_OWNER for missing and not-owned alike, idempotent
--    no-ops, credited refuses to re-label.
--
--    It bumps NO counter, so it needs no collusion gate and no undo: there is
--    nothing to farm and nothing to unwind.
-- -----------------------------------------------------------------------------
create or replace function public.mark_sighting_not_mine(p_sighting_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_caller   uuid := auth.uid();
  v_sighting public.sightings%rowtype;
  v_owner    uuid;
begin
  if v_caller is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  -- Row lock FIRST, for the same reason its sibling does it: a double tap must
  -- serialise so the status read below is post-commit fresh.
  select s.* into v_sighting
  from public.sightings s
  where s.id = p_sighting_id
  for update;

  -- Missing sighting: same opaque token as not-owner (no existence oracle).
  if not found then
    raise exception 'NOT_OWNER';
  end if;

  select p.owner_id into v_owner
  from public.posts p
  where p.id = v_sighting.post_id;
  if v_owner is distinct from v_caller then
    raise exception 'NOT_OWNER';
  end if;

  -- A payout record never re-labels (DOMAIN.md). Not an error — the owner
  -- tapping an old credited entry gets the truth back.
  if v_sighting.status = 'credited' then
    return jsonb_build_object('status', 'credited', 'changed', false);
  end if;

  -- ⚠️ helpful -> not_mine is REFUSED, and this is the one place it matters.
  -- The confirmation has already moved profiles.sightings_helpful, and the
  -- counters are append-only — there is no decrement anywhere in this schema
  -- and this migration does not add the first one. Taking a badge back off a
  -- spotter's profile with no explanation is worse than an owner living with a
  -- mis-tap, and the mis-tap case is covered client-side by the undo window
  -- (the RPC is simply never called). Distinct token so the UI can say why.
  if v_sighting.status = 'helpful' then
    raise exception 'ALREADY_COUNTED';
  end if;

  -- not_mine -> not_mine: idempotent no-op.
  if v_sighting.status = 'not_mine' then
    return jsonb_build_object('status', 'not_mine', 'changed', false);
  end if;

  update public.sightings
  set status = 'not_mine',
      reviewed_at = now()
  where id = p_sighting_id;

  -- AUDIT: belongs here once audit_log exists (SECURITY_AND_TRUST §7), same
  -- posture as create_sighting and mark_sighting_helpful.

  return jsonb_build_object('status', 'not_mine', 'changed', true);
end;
$$;

comment on function public.mark_sighting_not_mine(uuid) is
  'Owner-only unverified -> not_mine transition: "that is not my car". SECURITY DEFINER; FOR UPDATE row lock; re-marks are idempotent no-ops (changed:false); a credited sighting never re-labels. Refuses helpful -> not_mine with ALREADY_COUNTED because the reputation counter has already moved and this schema has no decrement. Bumps NO counter and is NOT a punishment — it records the absence of a confirmation so "nobody looked" and "looked, and no" stop being the same value. Missing sighting and not-post-owner raise the SAME opaque NOT_OWNER. Raises NOT_AUTHENTICATED, NOT_OWNER, ALREADY_COUNTED.';

revoke execute on function public.mark_sighting_not_mine(uuid) from public, anon;

grant  execute on function public.mark_sighting_not_mine(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 3. mark_sighting_helpful — re-stated. `create or replace` on a function that
--    EXISTS, so it keeps its OID and therefore its ACL (20260813120000 learned
--    the other way round: replacing a DROPPED function creates it fresh with a
--    default ACL and hands anon EXECUTE on a SECURITY DEFINER RPC).
--
--    Everything from 20260801130000:416 is preserved — the lock-first ordering,
--    the opaque NOT_OWNER, the idempotent no-ops, the credited terminal, the
--    single increment point. FOUR additions:
--      a. not_mine is an explicit legal source — an owner may correct a
--         rejection, and it costs nothing because not_mine bumped nothing.
--      b. reviewed_at is stamped.
--      c. a spotter <> caller self-check. create_sighting already blocks
--         OWN_POST upstream, but the money path re-checks anyway
--         (CANNOT_CREDIT_OWN_SIGHTING) precisely because it is a boundary;
--         the reputation path is a boundary too and had no such re-check.
--      d. the collusion gate, and a badge-threshold report.
-- -----------------------------------------------------------------------------
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

  -- (a) + (b). unverified -> helpful, and not_mine -> helpful (a correction).
  update public.sightings
  set status = 'helpful',
      reviewed_at = now()
  where id = p_sighting_id;

  if v_flagged then
    -- Recorded, not counted. No message to the client: naming the signal
    -- teaches the attack (_shared/collusion.ts). The review row is the record;
    -- flag_payout_for_review is `on conflict do nothing`, so the FIRST reasons
    -- stand and a retry cannot reset a human resolution.
    perform public.flag_payout_for_review(
      v_sighting.post_id, v_owner, v_sighting.spotter_id, v_reasons
    );
    return jsonb_build_object('status', 'helpful', 'changed', true, 'crossedThreshold', null);
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
    'status', 'helpful', 'changed', true, 'crossedThreshold', v_crossed
  );
end;
$$;

comment on function public.mark_sighting_helpful(uuid) is
  'Owner-only -> helpful transition (DOMAIN.md Sighting rules). SECURITY DEFINER; FOR UPDATE row lock so sightings_helpful bumps EXACTLY once per sighting (re-marks are idempotent no-ops, changed:false). Accepts unverified OR not_mine as the source, so an owner may correct a rejection at no cost. Stamps reviewed_at. Re-checks spotter <> caller (CANNOT_CONFIRM_OWN_SIGHTING) even though create_sighting blocks OWN_POST upstream — this is the reputation boundary. A collusion-flagged pair (shared device, or 3+ distinct posts of this owner already confirmed for this spotter) has the verdict RECORDED but the counter WITHHELD, and is told nothing, because naming the signal teaches the attack. Returns crossedThreshold: the badge rung this call passed (1/5/25) or null — badges are derived, so this is the only place that can know. A credited sighting never re-labels. Missing sighting and not-post-owner raise the SAME opaque NOT_OWNER. Raises NOT_AUTHENTICATED, NOT_OWNER, CANNOT_CONFIRM_OWN_SIGHTING.';

-- -----------------------------------------------------------------------------
-- 4. my_sighting_record — the spotter's own record, which has never existed.
--
--    Until now a spotter could see three cumulative lifetime numbers and
--    nothing else: no per-sighting list, no "pending", no way to learn what
--    happened to report #7. There is no list_my_sightings RPC in the schema and
--    no client anywhere reads the sightings table directly.
--
--    PRIVACY: mirrors my_dispute_context (20260805100000:446-477) exactly — the
--    car as the spotter already saw it (make + colour), and nothing else about
--    the post. No owner identity, no location, no plate, no bounty. Own rows
--    only, scoped by auth.uid(), which is also what makes it oracle-proof.
--
--    The rejections in here are visible to THIS SPOTTER ONLY. No stranger-
--    facing surface may ever show them: SpotterTrustLine's rule is that a
--    number implying a measurement we cannot make is worse than silence, and
--    that rule is unchanged by this feature.
-- -----------------------------------------------------------------------------
create or replace function public.my_sighting_record()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_caller uuid := auth.uid();
  v_rows   jsonb;
begin
  if v_caller is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select coalesce(jsonb_agg(r order by r.created_at desc), '[]'::jsonb)
    into v_rows
  from (
    select s.id,
           s.created_at,
           s.status,
           s.reviewed_at,
           s.area_label,
           jsonb_build_object('make', p.make, 'colour', p.colour) as car
      from public.sightings s
      join public.posts p on p.id = s.post_id
     where s.spotter_id = v_caller
  ) as r;

  return jsonb_build_object('sightings', v_rows);
end;
$$;

comment on function public.my_sighting_record() is
  'A spotter''s OWN sighting record, newest-first: id, created_at, status, reviewed_at, their own area_label, and the car as they already saw it (make + colour, mirroring my_dispute_context). Own rows only via auth.uid() — that scoping is the oracle-proofing. No owner identity, no location, no plate, no bounty. This is the ONLY surface on which a not_mine verdict is visible, and it is visible to the spotter alone: no stranger-facing surface may show a rejection or derive an accuracy figure from one.';

revoke execute on function public.my_sighting_record() from public, anon;

grant  execute on function public.my_sighting_record() to authenticated, service_role;

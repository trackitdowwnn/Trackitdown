-- =============================================================================
-- WHAT: The badge ladder becomes 1 / 3 / 10 / 25 on CONFIRMED SIGHTINGS, in the
--       two functions that know about rungs. Both re-stated with only the
--       ladder changed.
--
-- WHY:  Owner's product decision (2026-08-26). The ladder was 1/5/25 run
--       against all three reputation counters — nine badges — and the client
--       collapsed it to one ladder on sightings_helpful, the counter that means
--       an owner actually acted. Reporting a sighting is something you do;
--       having one confirmed is something someone else did about it, and only
--       the second is worth calling an achievement.
--
--       ⚠️ THE LADDER IS WRITTEN IN THREE PLACES AND THIS MIGRATION MOVES TWO
--       OF THEM. src/features/profile/lib/reputation.ts holds BADGE_THRESHOLDS
--       and BADGE_LABELS; mark_sighting_helpful decides which rung a
--       confirmation crossed; claim_sighting_confirmed_notification writes the
--       words that go in the push. Move one alone and a spotter is told they
--       earned a badge the app will not show them.
--       supabase/tests/badgeThresholds.test.ts reads THIS FILE and the TS and
--       fails if they disagree — added with this change, because nothing
--       previously stopped that drift.
--
--       ⚠️ TRUSTED_MIN_HELPFUL IS STILL 5 AND IS NOT TOUCHED HERE. 20260814120000
--       priced the cheapest farm against exactly that number — "a SINGLE listing
--       confirmed five times" — and answered it with the per-listing cap. A
--       badge rung at 3 is display-only; the trusted marker is the one owners
--       weigh, and lowering it would reverse that work rather than decorate it.
--
-- SAFETY: `create or replace` on functions that EXIST, so both keep their OID
--       and their ACL. The bodies were EXTRACTED PROGRAMMATICALLY from
--       20260814120000 and 20260814130000 and substituted only where the ladder
--       appears — the extraction asserted that the new rungs are present and
--       that no trace of the old ones survives, so the collusion gate, the
--       per-listing cap, the FOR UPDATE lock-first ordering, the opaque
--       NOT_OWNER, the idempotent no-ops and the no-oracle refusal shapes are
--       byte-identical to what they replace.
--
--       Nothing is recomputed. Badges are DERIVED with no award table, so a
--       spotter on 5 confirmed sightings simply reads as 3-of-10 from now on
--       rather than as finished; nobody loses a stored award because there has
--       never been one. A spotter sitting exactly on an old rung is not
--       re-notified — the claim is idempotent on confirmed_notified_at.
-- LINKS: supabase/migrations/20260814120000_reputation_one_point_per_listing.sql
--          (where mark_sighting_helpful was last stated);
--        supabase/migrations/20260814130000_sighting_confirmed_notification.sql
--          (where the claim RPC was last stated);
--        src/features/profile/lib/reputation.ts (the third copy of the ladder);
--        supabase/tests/badgeThresholds.test.ts (the pin).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. mark_sighting_helpful — the rung a confirmation crossed.
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
      reviewed_at = now()
  where id = p_sighting_id;

  if v_flagged or not v_counted then
    -- Recorded, not counted. No message to the client: naming the signal
    -- teaches the attack (_shared/collusion.ts). The review row is the record;
    -- flag_payout_for_review is `on conflict do nothing`, so the FIRST reasons
    -- stand and a retry cannot reset a human resolution.
    if v_flagged then
      perform public.flag_payout_for_review(
        v_sighting.post_id, v_owner, v_sighting.spotter_id, v_reasons
      );
    end if;
    -- counted:false is honest for the cap and deliberately indistinguishable
    -- for a flagged pair — naming the signal teaches the attack.
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
  -- increment can. Thresholds mirror BADGE_THRESHOLDS = [1, 3, 10, 25]; a single
  -- +1 can cross at most one.
  select t into v_crossed
  from unnest(array[1, 3, 10, 25]) as t
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

comment on function public.mark_sighting_helpful(uuid) is
  'Owner-only -> helpful transition (DOMAIN.md Sighting rules). SECURITY DEFINER; FOR UPDATE row lock; re-marks are idempotent no-ops (changed:false). Accepts unverified OR not_mine as the source, so an owner may correct a rejection at no cost. Stamps reviewed_at. Re-checks spotter <> caller (CANNOT_CONFIRM_OWN_SIGHTING). REPUTATION IS CAPPED AT ONE POINT PER LISTING PER SPOTTER: a second confirmed sighting by the same spotter on the same post records the verdict but returns counted:false and bumps nothing, because a point measures how many OWNERS found this person useful, not how many times one owner tapped. A collusion-flagged pair (shared handset, or 3+ distinct posts of this owner already confirmed for this spotter) gets the identical counted:false shape and is told nothing further, because naming the signal teaches the attack. Returns crossedThreshold: the badge rung this call passed (1/3/10/25) or null — badges are derived, so this is the only place that can know. Missing sighting and not-post-owner raise the SAME opaque NOT_OWNER. Raises NOT_AUTHENTICATED, NOT_OWNER, CANNOT_CONFIRM_OWN_SIGHTING.';

-- -----------------------------------------------------------------------------
-- 2. claim_sighting_confirmed_notification — the words that go in the push.
-- -----------------------------------------------------------------------------
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
  -- A confirmed sighting on a post the ACTOR owns.
  select s.id, s.spotter_id, p.make, p.colour
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
  -- than something wrong. Labels mirror reputation.ts BADGE_LABELS exactly.
  select sightings_helpful into v_count
    from public.profiles where id = v_spotter;

  v_badge := case v_count
               when 1  then 'First confirmed sighting'
               when 3  then '3 confirmed sightings'
               when 10 then '10 confirmed sightings'
               when 25 then '25 confirmed sightings'
             end;

  -- Copy. The car as the spotter already saw it — no owner identity, no
  -- location, no plate. "Confirmed" is the honest word: an owner acted, which
  -- is not the same as the spotter being verified right, and the copy around
  -- this number must never imply otherwise (spotterTrust.ts).
  v_body := 'The owner confirmed your sighting of the ' || lower(v_colour) || ' ' || v_make || '.';
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

comment on function public.claim_sighting_confirmed_notification(uuid, uuid) is
  'Claims the sighting_confirmed push for a spotter whose sighting the post owner marked helpful. Actor must own the post; the sighting must be helpful; the conditional update on confirmed_notified_at is the idempotency. Every refusal returns the IDENTICAL {claimed:false} — no oracle. Copy is built HERE (so npm run test:db covers it) and names a badge ONLY when the spotter''s counter sits exactly on a rung, so it under-claims rather than over-claims. Carries the car as the spotter already saw it: no owner identity, no location, no plate.';

-- =============================================================================
-- END
-- =============================================================================

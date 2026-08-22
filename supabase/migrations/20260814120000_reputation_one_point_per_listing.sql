-- =============================================================================
-- WHAT: One reputation point per LISTING per spotter, not one per confirmed
--       sighting. mark_sighting_helpful re-stated with that cap.
--
-- WHY:  20260814110000 added two collusion signals to the free path — a shared
--       handset, and the same owner confirming the same spotter across three or
--       more DISTINCT listings. Testing them found the gap between: the
--       cheapest farm is a SINGLE listing confirmed five times. The per-post
--       submission cap is 3 sightings/day, so two days buys five confirmations,
--       the distinct-post pair count stays at 1, and TRUSTED_MIN_HELPFUL = 5 is
--       met. Two handsets defeat the device signal, and nothing else fires.
--
--       The fix is not another detector, it is answering what a reputation
--       point MEANS. It answers "how many owners found this person useful", not
--       "how many times did one owner tap". A spotter who tracked one car over
--       three days and filed three confirmed sightings has earned one owner's
--       trust once — genuinely useful work, but one owner's opinion of one
--       person. Counting it three times was always measuring the wrong thing;
--       it only became visible when someone could farm it.
--
--       With the cap, each point costs a SEPARATE listing — and three separate
--       listings for one owner→spotter pair is exactly what
--       confirmation_pair_count already refuses to count. The two rules
--       compose: the cap makes the farm need more posts, and more posts is
--       what the pair signal sees.
--
--       ⚠️ THIS CHANGES WHAT A LIVE COUNTER MEANS. A spotter with three
--       confirmed sightings on one car scores 1 from now on, where they would
--       have scored 3. Existing profiles.sightings_helpful values are NOT
--       recomputed — there is no decrement in this schema and this migration
--       does not add the first one, so historic totals stand and only new
--       confirmations follow the new rule. Owner's product decision, taken with
--       the trade-off stated (2026-08-14).
--
-- SAFETY: `create or replace` on a function that EXISTS, so it keeps its OID
--       and its ACL. Body copied mechanically from 20260814110000:190-301 with
--       the cap inserted; everything else — the lock-first ordering, the opaque
--       NOT_OWNER, the self-check, the collusion gate, the idempotent no-ops,
--       the credited terminal — is byte-identical.
--
--       A capped confirmation is still RECORDED: status moves, reviewed_at
--       stamps, the owner's screen tells the truth. `counted:false` says so
--       honestly — unlike the collusion branch, which returns the same shape
--       deliberately, because naming that signal teaches the attack.
-- LINKS: supabase/migrations/20260814110000_sighting_verification_rpcs.sql;
--        src/shared/lib/spotterTrust.ts (TRUSTED_MIN_HELPFUL = 5).
-- =============================================================================


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

comment on function public.mark_sighting_helpful(uuid) is
  'Owner-only -> helpful transition (DOMAIN.md Sighting rules). SECURITY DEFINER; FOR UPDATE row lock; re-marks are idempotent no-ops (changed:false). Accepts unverified OR not_mine as the source, so an owner may correct a rejection at no cost. Stamps reviewed_at. Re-checks spotter <> caller (CANNOT_CONFIRM_OWN_SIGHTING). REPUTATION IS CAPPED AT ONE POINT PER LISTING PER SPOTTER: a second confirmed sighting by the same spotter on the same post records the verdict but returns counted:false and bumps nothing, because a point measures how many OWNERS found this person useful, not how many times one owner tapped. A collusion-flagged pair (shared handset, or 3+ distinct posts of this owner already confirmed for this spotter) gets the identical counted:false shape and is told nothing further, because naming the signal teaches the attack. Returns crossedThreshold: the badge rung this call passed (1/5/25) or null — badges are derived, so this is the only place that can know. Missing sighting and not-post-owner raise the SAME opaque NOT_OWNER. Raises NOT_AUTHENTICATED, NOT_OWNER, CANNOT_CONFIRM_OWN_SIGHTING.';

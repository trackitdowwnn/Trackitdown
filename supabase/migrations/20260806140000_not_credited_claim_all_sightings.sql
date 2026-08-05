-- =============================================================================
-- WHAT:  Fixes the idempotency of public.claim_not_credited_notifications.
--        The claim now MARKS every eligible sighting a runner-up filed, while
--        still RETURNING that person once.
-- WHY:   The original (20260806120000) put `distinct on (spotter_id)` inside
--        the update's WHERE, so a spotter who filed THREE sightings on one car
--        had exactly ONE of them stamped with not_credited_notified_at. The
--        other two stayed NULL and therefore stayed eligible: the second call
--        found them, deduped them to one row, and pushed the same "a car you
--        reported was found" to the same person a second time. The dedup and
--        the claim disagreed about what a claim covers — a person, or a row.
--
--        The announcement is best-effort and fired from the release core
--        (releasePayout.ts), which is precisely the code path most likely to
--        be retried after a partial failure, so this was not theoretical: the
--        most diligent spotters — the only ones who file more than once — were
--        the only ones who could be told twice. Exactly the outcome the
--        DISTINCT ON was added to prevent, arriving one retry later.
--
--        The fix moves the dedup from the ROW SELECTION to the RETURN. The
--        update's predicate is now the plain eligibility test (this post, not
--        the credited row, never claimed, not the winner, not the owner), so
--        one call exhausts the post; `jsonb_agg(distinct …)` collapses the
--        returning rows to one entry per person, which is what the audience
--        always meant. Conditional-update-as-idempotency is unchanged and
--        still makes two concurrent releases send once.
--
-- SAFETY: no change to the GATE (status = 'recovered' AND a credited sighting
--        exists), so recovered_no_spotter is still refused outright and those
--        spotters still hear only closed_uncredited. No change to the audience
--        RULE — the winner and the owner remain excluded by the same two
--        predicates, and no spotter who was not already eligible becomes so.
--        No change to the copy, so the privacy properties asserted by CHECK 7
--        (make/colour only; never the plate, the winner or an amount) are
--        untouched. The only observable differences are that more of the
--        claimant's OWN rows get stamped, and that a replay is now silent.
--
--        Widening the update from one row per spotter to all of them writes at
--        most as many rows as the post has sightings, under the same partial
--        index sightings_not_credited_pending_idx (post_id) — the DISTINCT ON
--        was never what made this cheap.
--
-- MONEY: none. Announcement only, after the transfer, best-effort by contract.
-- LINKS: supabase/migrations/20260806120000_not_credited_notification.sql (the
--          function this replaces, and its column/index/grants — all kept),
--        supabase/tests/not_credited_verification.sql (CHECK 4 is the one that
--          caught this, once scripts/test-db.sh finally ran the suite),
--        supabase/functions/_shared/recoveryAnnounce.ts (announceNotCredited),
--        supabase/functions/_shared/releasePayout.ts (the retried call site).
--
-- SAFETY NOTE ON DESTRUCTIVE STATEMENTS: none. One CREATE OR REPLACE of an
--        existing function at its EXISTING signature, so the 20260806120000
--        revoke-from-public/anon/authenticated and the service_role grant are
--        preserved by definition. No table, column, constraint, index, policy
--        or row is created, altered or dropped.
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
    'body',     'The ' || v_desc || ' you reported is back with its owner. Another spotter''s report led to the recovery this time — thank you for looking out for it.'
  );
end $$;

comment on function public.claim_not_credited_notifications(uuid) is
  'One-shot claim for the runner-up announcement: tells every spotter who reported a post that it was recovered on SOMEONE ELSE''S sighting. Gated on status = recovered AND an existing credited sighting, so recovered_no_spotter (where closed_uncredited already spoke) can never trigger it. Conditional update on sightings.not_credited_notified_at is the idempotency; it stamps ALL of a spotter''s eligible sightings and the audience is deduped with jsonb_agg(distinct) instead (2026-08-06 — stamping only one row per person left the rest eligible and let a retry announce twice). The winner and the owner are excluded explicitly as well as by status. No recency window — unlike create_refund_hold''s 14 days, which gates MONEY, this is the ending of a story anyone who reported is owed. Copy is built here (make/colour only; nothing whatsoever about the winner) so npm run test:db covers its privacy. An empty audience still returns claimed:true with user_ids [] — the claim means "we tried", so a retry cannot re-announce to spotters who arrived since. Every refusal returns the identical {claimed:false}. SERVICE ROLE ONLY.';

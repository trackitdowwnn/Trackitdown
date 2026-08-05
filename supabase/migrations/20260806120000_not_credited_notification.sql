-- =============================================================================
-- ⚠️ DESTRUCTIVE STATEMENTS: section 1 DROPs constraints notifications_kind_chk
--    and push_sends_kind_chk and immediately re-ADDs each one value wider
--    ('not_credited') — the established widening idiom (20260804100000,
--    20260805110000, 20260806100000 each did exactly this). No table, column,
--    row or function is dropped. Everything else is additive.
--
-- WHAT:  The `not_credited` push kind and its claim — the announcement owed to
--        every spotter who reported a car that was recovered on SOMEBODY
--        ELSE'S sighting.
-- WHY:   THE SILENT RUNNER-UP (found by the 2026-08-05 loop trace).
--        `claim_recovery` sets exactly one sighting to 'credited' and leaves
--        the rest untouched, and the only existing "you weren't credited"
--        push — `closed_uncredited` — fires solely from `create_refund_hold`,
--        i.e. only when NOBODY was credited. So the crowd product's most
--        common outcome was its one silent one: several people report the same
--        car, one is credited, and the others are never told the car was even
--        found. Single-winner is deliberate (ROADMAP: bounty splitting is
--        explicitly out); silence for everyone else was never a decision, just
--        a gap between two senders.
--
--        NOT a dispute door. `closed_uncredited` opens a 72-hour window
--        because an owner exiting with a refund has a direct financial motive
--        to deny every sighting. Here the owner PAID — they credited someone,
--        the money left escrow — so the adversarial reading is gone and
--        "someone else deserved it more" is an adjudication we deliberately do
--        not offer. This kind carries news, not a lever, and routes to the
--        post rather than the dispute screen.
--
-- MONEY: none. This fires after the transfer, from the release core, and is
--        best-effort by contract — an announcement must never fail a payout.
-- LINKS: supabase/functions/_shared/recoveryAnnounce.ts (the sender, beside
--          the two it copies); _shared/releasePayout.ts (the one call site);
--          20260806100000_notification_center.sql (claim_recovery_notifications,
--          the template); 20260805100000_refund_holds_and_disputes.sql
--          (create_refund_hold's closed_uncredited claim, the near-analogue);
--        docs/ROADMAP.md ("Loop integrity" — this is hole 2 of 2).
-- =============================================================================


-- =============================================================================
-- 1. Widen both kind whitelists. Mirrored by NOTIFICATION_KINDS in
--    notificationKinds.ts, which gains 'not_credited' in this same commit.
-- =============================================================================
alter table public.notifications drop constraint notifications_kind_chk;
alter table public.notifications
  add constraint notifications_kind_chk check (kind in ('alert','sighting','message','recovery','credited','closed_uncredited','dispute_upheld','dispute_rejected','payout_sent','not_credited'));

alter table public.push_sends drop constraint push_sends_kind_chk;
alter table public.push_sends
  add constraint push_sends_kind_chk check (kind in ('alert','sighting','message','recovery','credited','closed_uncredited','dispute_upheld','dispute_rejected','payout_sent','not_credited'));


-- =============================================================================
-- 2. The claim column. Its OWN column rather than reusing closed_notified_at:
--    the two can never both apply to one sighting (a post either credits
--    somebody or it does not), but they mean different things, and a shared
--    marker would make one of the two column comments a lie the first time
--    anyone read it. Same server-only posture as its siblings — `sightings`
--    carries no client write grant at all.
-- =============================================================================
alter table public.sightings
  add column not_credited_notified_at timestamptz;

comment on column public.sightings.not_credited_notified_at is
  'not_credited push idempotency CLAIM. NULL = this spotter has never been told the post was recovered on someone else''s sighting. Set exactly once by claim_not_credited_notifications via conditional update. Distinct from closed_notified_at, which marks the OPPOSITE outcome (closed crediting nobody); no sighting can ever receive both. Server-only: sightings has no client write grant.';

-- The pending scan: which recovered posts still owe their runners-up the news.
-- Partial and narrow — this is only ever probed per-post by the claim.
create index sightings_not_credited_pending_idx
  on public.sightings (post_id)
  where status <> 'credited' and not_credited_notified_at is null;


-- =============================================================================
-- 3. The claim. Same contract as claim_recovery_notifications: conditional
--    update IS the idempotency, copy is built HERE so its privacy properties
--    are covered by `npm run test:db`, and every refusal returns the IDENTICAL
--    {claimed:false} so nothing about another person's post can be probed.
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

  -- GATE: a genuinely recovered post that credited SOMEBODY. The credited
  -- sighting is what separates this from `recovered_no_spotter`, where the
  -- runners-up already heard `closed_uncredited` from create_refund_hold and
  -- must not now be told a second, contradictory story.
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

  -- Claim + audience in ONE conditional pass, exactly as create_refund_hold
  -- does: the update is the idempotency, so two concurrent releases send once.
  --
  -- DISTINCT ON (spotter_id): a spotter who filed three sightings on one car
  -- is one person who gets one push, not three. Without it the most diligent
  -- spotters would be the most spammed — precisely backwards.
  --
  -- No recency window, deliberately. create_refund_hold's 14-day rule exists
  -- to decide whose refund WAITS, which is a money question. This is courtesy:
  -- anyone who ever reported this car is owed the ending, however long ago.
  with claimed as (
    update public.sightings s
       set not_credited_notified_at = now()
     where s.id in (
             select distinct on (inner_s.spotter_id) inner_s.id
               from public.sightings inner_s
              where inner_s.post_id = p_post_id
                and inner_s.status <> 'credited'
                and inner_s.not_credited_notified_at is null
                -- Belt and braces: the winner is excluded by status already
                -- (theirs IS the credited row), and the owner cannot sight
                -- their own car, but neither should ever receive this.
                and inner_s.spotter_id <> v_winner
                and inner_s.spotter_id <> v_owner
              order by inner_s.spotter_id, inner_s.created_at
           )
    returning s.spotter_id
  )
  select coalesce(jsonb_agg(claimed.spotter_id), '[]'::jsonb)
    into v_users
    from claimed;

  -- THE COPY, built here so it is DB-testable. Same privacy line every other
  -- announcement draws (DOMAIN.md Notifications payload): make/colour ONLY —
  -- no plate, no location, no owner identity, and NOTHING about the winner:
  -- not their name, not their count, not the amount. "Another spotter" is the
  -- whole of what the runner-up is entitled to know about a stranger.
  -- Falls back to 'car' so it never reads "The  you reported".
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
  'One-shot claim for the runner-up announcement: tells every spotter who reported a post that it was recovered on SOMEONE ELSE''S sighting. Gated on status = recovered AND an existing credited sighting, so recovered_no_spotter (where closed_uncredited already spoke) can never trigger it. Conditional update on sightings.not_credited_notified_at is the idempotency; DISTINCT ON (spotter_id) means one push per person however many sightings they filed; the winner and the owner are excluded explicitly as well as by status. No recency window — unlike create_refund_hold''s 14 days, which gates MONEY, this is the ending of a story anyone who reported is owed. Copy is built here (make/colour only; nothing whatsoever about the winner) so npm run test:db covers its privacy. An empty audience still returns claimed:true with user_ids [] — the claim means "we tried", so a retry cannot re-announce to spotters who arrived since. Every refusal returns the identical {claimed:false}. SERVICE ROLE ONLY.';

revoke execute on function public.claim_not_credited_notifications(uuid) from public, anon, authenticated;
grant  execute on function public.claim_not_credited_notifications(uuid) to service_role;

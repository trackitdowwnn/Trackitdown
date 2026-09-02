-- =============================================================================
-- WHAT:  Tells a spotter they were credited on a listing that carries no cash
--        reward. Adds the `credited_no_reward` kind to both kind constraints
--        and to notification_category, and rewrites
--        claim_credited_notification so it CLAIMS ONLY ONCE IT CAN BUILD COPY.
-- WHY:   DOMAIN.md has carried this as a KNOWN GAP since 2026-08-20, and it is
--        the one that undermines an argument the product rests on.
--
--        On a £5 listing-fee post there is no bounty, so the credited push —
--        "You've earned £X", routed to /payouts — cannot be built, and
--        claim_credited_notification correctly refuses to invent a number.
--        But it BURNS THE ONE-SHOT CLAIM FIRST: `credited_notified_at` is
--        stamped before the amount is read, so the refusal is permanent and a
--        retry sends nothing. The spotter learns they were credited only if
--        they happen to open the app, and — because this also skipped the
--        persist-then-push rule (ADR-0012) — the Inbox was silent too.
--
--        ⚠️ WHY IT MATTERS MORE THAN A MISSING PUSH USUALLY WOULD. "Recognition
--        is the reward" is the ENTIRE basis for keeping fee listings outside
--        ADR-0011's dispute machinery. A reward that is never delivered does
--        not carry that argument. The Terms now say it too, in as many words
--        (2026-09-01: "it counts towards their record"), so this is a promise
--        in a legal document that the code was not keeping.
--
-- ⚠️ THE REORDERING IS THE FIX, and it is the whole of it. The old body was
--        claim → read amount → build copy, so any failure after the claim was
--        unrecoverable. It is now resolve → read amount → BUILD COPY → claim.
--        Two concurrent callers both build copy and exactly one wins the
--        conditional update, so the idempotency is unchanged; what changes is
--        that a branch which cannot produce copy never consumes the claim.
--
--        DOMAIN.md called for exactly this: "a claim_credited_notification
--        branch that only claims once the copy can be built".
--
-- ⚠️ THE NEW KIND IS `my_sightings`, NOT `money`. There is no money in it. It
--        belongs with sighting_confirmed and not_credited — the outcomes of a
--        report — and it is MUTABLE like them, because unlike
--        closed_uncredited there is no clock on it and nothing is lost by
--        hearing it late. It routes to /my-sightings, where the credit is
--        visible, rather than /payouts, where there would be nothing to see.
--
-- SAFETY NOTE ON DESTRUCTIVE STATEMENTS: two `drop constraint … / add
--        constraint` pairs on `notifications.kind` and `push_sends.kind`, which
--        WIDEN the accepted set — every existing row still satisfies the new
--        check. No data is read, moved or deleted. `create or replace` on two
--        functions, each restated in full.
--
-- LINKS: docs/DOMAIN.md (the KNOWN GAP this closes, and "recognition is the
--          reward"); docs/decisions/ADR-0014-no-bounty-listings.md;
--        supabase/migrations/20260804100000_credited_notification.sql (the body
--          being replaced — diff against THAT file);
--        supabase/migrations/20260824170000_notification_preferences.sql
--          (notification_category, replaced below);
--        supabase/functions/notify-credited/index.ts (now sends the kind the
--          claim returns rather than a hardcoded one);
--        src/features/notifications/lib/notificationKinds.ts (the mirror that
--          notificationCategories.test.ts pins to this file).
-- =============================================================================


-- =============================================================================
-- 1. The kind vocabulary widens
-- =============================================================================
-- Both constraints, together: push_sends carries the same kind and a row is
-- written there before the send, so a kind valid in one and not the other
-- fails at delivery rather than at write.
alter table public.notifications drop constraint notifications_kind_chk;
alter table public.notifications add constraint notifications_kind_chk
  check (kind in ('alert','sighting','message','recovery','credited',
                  'credited_no_reward','closed_uncredited','dispute_upheld',
                  'dispute_rejected','payout_sent','not_credited',
                  'sighting_confirmed'));

alter table public.push_sends drop constraint push_sends_kind_chk;
alter table public.push_sends add constraint push_sends_kind_chk
  check (kind in ('alert','sighting','message','recovery','credited',
                  'credited_no_reward','closed_uncredited','dispute_upheld',
                  'dispute_rejected','payout_sent','not_credited',
                  'sighting_confirmed'));


-- =============================================================================
-- 2. notification_category — the new kind is mutable, under my_sightings
-- =============================================================================
-- Restated in full from 20260824170000; the only change is one `when` line.
create or replace function public.notification_category(p_kind text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_kind
    when 'alert'               then 'alerts'
    when 'message'             then 'messages'
    when 'sighting_confirmed'  then 'my_sightings'
    when 'not_credited'        then 'my_sightings'
    -- ⚠️ NOT 'money'. There is no money in this one — it is the outcome of a
    -- report, like the two above, and muting it costs nobody a payment.
    when 'credited_no_reward'  then 'my_sightings'
    when 'credited'            then 'money'
    when 'payout_sent'         then 'money'
    when 'dispute_upheld'      then 'money'
    when 'dispute_rejected'    then 'money'
    when 'recovery'            then 'watched'
    else null
  end;
$$;

comment on function public.notification_category(text) is
  'Maps a notification kind to its mutable preference category, or NULL when the kind may not be muted (sighting, closed_uncredited) or is not yet classified. NULL always means "deliver". credited_no_reward is my_sightings rather than money: it carries no payment, and unlike closed_uncredited it has no clock on it.';


-- =============================================================================
-- 3. claim_credited_notification — claim LAST
-- =============================================================================
-- ⚠️ RESTATED IN FULL from 20260804100000, with two changes: the branch for a
-- rewardless credit, and the claim moved to the end. Everything else — the
-- ownership check, the status set, the payout_split arithmetic, the copy that
-- carries no car, plate, location or owner name — is unchanged. Diff against
-- that file.
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
    v_body  := 'Your sighting led to a recovery. Tell us where to send it.';
  else
    -- ⚠️ THE REWARDLESS CREDIT. No amount exists, so the copy must not imply
    -- one — and must not apologise for its absence either. The listing said
    -- plainly there was no cash reward before this spotter reported anything;
    -- what they are owed here is being TOLD it counted, which is the whole of
    -- what "recognition is the reward" promises.
    v_kind  := 'credited_no_reward';
    v_title := 'Your sighting found the car';
    v_body  := 'The owner credited your report. It counts towards your record.';
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

comment on function public.claim_credited_notification(uuid, uuid) is
  'One-shot claim for the credited-spotter notification. Verifies the ACTOR owns the post and a credited sighting exists, builds the copy for whichever branch applies — a bounty_escrow payment gives the money copy via payout_split, its absence gives the rewardless "your sighting found the car" — and ONLY THEN claims via conditional update on sightings.credited_notified_at. Returns the `kind` to send; the caller must not assume. Claiming last is deliberate: the previous version claimed first and so burned the one-shot on fee listings while sending nothing. Every refusal returns the identical {claimed:false} — no oracle. SERVICE ROLE ONLY.';

revoke execute on function public.claim_credited_notification(uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_credited_notification(uuid, uuid) to service_role;


-- =============================================================================
-- END OF MIGRATION
-- =============================================================================

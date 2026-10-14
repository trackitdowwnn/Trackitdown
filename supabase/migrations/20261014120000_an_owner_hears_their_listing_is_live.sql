-- -----------------------------------------------------------------------------
-- WHAT:  An owner is told when their listing goes live:
--          1. posts.live_notified_at — the one-shot stamp.
--          2. claim_listing_live_notification(payment intent) — claims the push
--             for the capture that took the post live, and only that one.
--          3. Kind 'listing_live' — UNMUTABLE.
-- WHY:   2026-10-14 (low-friction payments plan, PR6). A listing goes live
--        when Stripe confirms the payment, which is usually seconds — but when
--        it isn't, the confirmation screen says "goes live by itself… you don't
--        need to wait here", and then nothing ever said it had. Spotters were
--        alerted; the person who paid was not.
--
-- WHICH CAPTURE: only the post's FIRST captured payment takes it live. A
--        renewal, a changed reward, or a reward added to a fee listing is a
--        later capture on a post already live — "your listing is live" there
--        would be news about nothing. So the claim refuses whenever any OTHER
--        payment on the post was ever captured (captured_at is stamped on
--        every capture, 20261005110000). No backfill is needed: a post live
--        before this has its first capture behind it and never claims.
--
-- UNMUTABLE: once per listing, ever — the receipt for money they paid — so
--        notification_category needs no change (an unlisted kind is NULL).
-- LINKS: supabase/functions/_shared/afterCapture.ts (the caller, from the
--          webhook and sync-post-payment); 20261014110000 (the kind lists
--          restated here).
-- -----------------------------------------------------------------------------

alter table public.posts
  add column if not exists live_notified_at timestamptz;

comment on column public.posts.live_notified_at is
  'When the owner was told their listing went live (claim_listing_live_notification, 2026-10-14). One-shot.';


create or replace function public.claim_listing_live_notification(p_payment_intent_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post  uuid;
  v_owner uuid;
begin
  select pay.post_id, po.owner_id
    into v_post, v_owner
    from public.payments pay
    join public.posts po on po.id = pay.post_id
   where pay.stripe_payment_intent_id = p_payment_intent_id
     and pay.captured_at is not null
     and po.status in ('active', 'pending_verification')
     and po.live_notified_at is null
     -- The FIRST capture only: no other payment on this post was ever taken.
     and not exists (
       select 1 from public.payments other
        where other.post_id = pay.post_id
          and other.id <> pay.id
          and other.captured_at is not null
     );

  if v_post is null then
    return jsonb_build_object('claimed', false);
  end if;

  update public.posts
     set live_notified_at = now()
   where id = v_post
     and live_notified_at is null
  returning id into v_post;

  if v_post is null then
    return jsonb_build_object('claimed', false);
  end if;

  -- The copy: what happened and what comes next. No car, no plate — it is
  -- their own listing, and the tap opens it.
  return jsonb_build_object(
    'claimed', true,
    'user_id', v_owner,
    'post_id', v_post,
    'title',   'Your listing is live',
    'body',    'Spotters can see it now. We''ll tell you the moment someone reports a sighting.');
end;
$$;

revoke all on function public.claim_listing_live_notification(text) from public, anon, authenticated;
grant execute on function public.claim_listing_live_notification(text) to service_role;

comment on function public.claim_listing_live_notification(text) is
  'Claims the one listing_live push for the capture that took a post live (2026-10-14): the payment must be captured, the post live and not yet notified, and NO other payment on the post ever captured (a renewal or later reward is not a go-live). Returns {claimed, user_id, post_id, title, body} or {claimed:false}. Service role only.';


alter table public.notifications drop constraint notifications_kind_chk;
alter table public.notifications add constraint notifications_kind_chk
  check (kind in ('alert','sighting','message','recovery','credited',
                  'credited_no_reward','closed_uncredited','dispute_upheld',
                  'dispute_rejected','payout_sent','not_credited',
                  'sighting_confirmed','still_missing','deletion_soon',
                  'reward_ending','reward_ended',
                  'payout_reminder','payout_lapsed',
                  'sighting_withdrawn','payout_failed','listing_live'));

alter table public.push_sends drop constraint push_sends_kind_chk;
alter table public.push_sends add constraint push_sends_kind_chk
  check (kind in ('alert','sighting','message','recovery','credited',
                  'credited_no_reward','closed_uncredited','dispute_upheld',
                  'dispute_rejected','payout_sent','not_credited',
                  'sighting_confirmed','still_missing','deletion_soon',
                  'reward_ending','reward_ended',
                  'payout_reminder','payout_lapsed',
                  'sighting_withdrawn','payout_failed','listing_live'));

comment on function public.notification_category(text) is
  'Maps a notification kind to its mutable preference category, or NULL when the kind may not be muted (sighting, sighting_withdrawn, closed_uncredited, still_missing, deletion_soon, reward_ending, reward_ended, payout_reminder, payout_lapsed, payout_failed, listing_live) or is not yet classified. NULL always means "deliver". reward_ending / reward_ended are the notice a reward''s automatic refund must follow (ADR-0020); payout_reminder / payout_lapsed are the notice a credited spotter''s reward is about to go, and went, back to the owner. sighting_withdrawn (2026-10-09) follows sighting. payout_failed (2026-10-14): a bank refused the spotter''s payout. listing_live (2026-10-14): once per listing, the receipt for the payment that took it live.';

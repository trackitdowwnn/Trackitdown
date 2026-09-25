-- =============================================================================
-- WHAT:  Owners hear when their money moves (ADR-0021), and the spotter's
--        credited push gets a server-side safety net.
--          1. payments.refund_notified_at / owner_payout_notified_at — the
--             one-shot claim markers, BACKFILLED so no past move is news.
--          2. Two push kinds: refund_sent ("£516.92 refunded") and
--             reward_delivered ("£500.00 sent to your spotter"), both to the
--             OWNER, both in the `money` preference category.
--          3. claim_refund_sent_notification / claim_reward_delivered_notification
--             — claim-then-copy, service-role only, copy built here.
--          4. sightings.credited_notified_at backfilled on historical credits,
--             so the new sweep scan never announces an old credit as news.
--
-- WHY:   An owner was told nothing when their money moved while they were not
--        looking: a refund released by the hourly sweep 72 hours after they
--        closed the listing, a reward delivered days later when the spotter
--        finally finished payout setup. ADR-0011 §7 chose that silence; the
--        2026-09-25 escrow review reverses it (ADR-0021): these are the two
--        moments an owner most wants to know about, and the only two a toast
--        can never cover because the owner is not in the app when they happen.
--
--        The credited push to the SPOTTER is fired from the OWNER's phone
--        (RecoverPostScreen → notify-credited). If that app dies at the wrong
--        moment, the spotter is never told they earned anything. The sweep now
--        scans for credited sightings whose claim marker is still NULL and
--        sends through the SAME claim, so the worst case is an hour's delay.
--
-- PRIVACY: owner pushes carry the amount and the owner's own car — nothing
--        about the spotter (not even a first name), no plate, no location.
--
-- SAFETY NOTE ON DESTRUCTIVE STATEMENTS: the two kind constraints are dropped
--        and re-added WIDER in the same transaction (every existing row still
--        satisfies them). notification_category is restated from
--        20260902140000 with two added lines. Nothing else is dropped.
--
-- LINKS: docs/decisions/ADR-0021-owners-hear-when-money-moves.md;
--        supabase/functions/_shared/recoveryAnnounce.ts (the senders);
--        supabase/migrations/20260921120000_a_warning_comes_before_the_purge.sql
--          (the kind constraints this widens);
--        src/features/notifications/lib/notificationKinds.ts (the client
--          registry the Jest agreement tests hold this to);
--        supabase/tests/owner_money_notifications_verification.sql.
-- =============================================================================

begin;

-- =============================================================================
-- 1. The claim markers — backfilled, so nothing that already happened is news.
-- =============================================================================
alter table public.payments
  add column refund_notified_at       timestamptz,
  add column owner_payout_notified_at timestamptz;

comment on column public.payments.refund_notified_at is
  'refund_sent push idempotency CLAIM. NULL = the owner has not been told their refund went out. Set once by claim_refund_sent_notification (service role). Backfilled to the migration time on every already-refunded row (20260925120000) so history is never announced.';
comment on column public.payments.owner_payout_notified_at is
  'reward_delivered push idempotency CLAIM. NULL = the owner has not been told their reward reached the spotter. Set once by claim_reward_delivered_notification (service role). Backfilled on every already-released row (20260925120000).';

update public.payments set refund_notified_at = now()
 where status = 'refunded' and refund_notified_at is null;
update public.payments set owner_payout_notified_at = now()
 where status = 'released' and owner_payout_notified_at is null;

-- The sweep's pending scans (Phase 2c). Partial, so they stay tiny.
create index payments_refund_notify_pending_idx
  on public.payments (updated_at)
  where status = 'refunded' and refund_notified_at is null;
create index payments_owner_payout_notify_pending_idx
  on public.payments (updated_at)
  where status = 'released' and owner_payout_notified_at is null;

-- The credited backstop scans credited sightings with no claim. Every credit
-- that exists today is either announced or too old to be news.
update public.sightings set credited_notified_at = now()
 where status = 'credited' and credited_notified_at is null;

create index sightings_credited_notify_pending_idx
  on public.sightings (post_id)
  where status = 'credited' and credited_notified_at is null;


-- =============================================================================
-- 2. The kind vocabulary widens. Both constraints together: push_sends carries
--    the same kind and is written before the send.
-- =============================================================================
alter table public.notifications drop constraint notifications_kind_chk;
alter table public.notifications add constraint notifications_kind_chk
  check (kind in ('alert','sighting','message','recovery','credited',
                  'credited_no_reward','closed_uncredited','dispute_upheld',
                  'dispute_rejected','payout_sent','not_credited',
                  'sighting_confirmed','still_missing','deletion_soon',
                  'refund_sent','reward_delivered'));

alter table public.push_sends drop constraint push_sends_kind_chk;
alter table public.push_sends add constraint push_sends_kind_chk
  check (kind in ('alert','sighting','message','recovery','credited',
                  'credited_no_reward','closed_uncredited','dispute_upheld',
                  'dispute_rejected','payout_sent','not_credited',
                  'sighting_confirmed','still_missing','deletion_soon',
                  'refund_sent','reward_delivered'));


-- =============================================================================
-- 3. notification_category — both owner money kinds are MUTABLE, under money.
--    Restated from 20260902140000; two lines added. News, not a lever: an
--    owner who would rather not hear about their refund may say so.
-- =============================================================================
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
    when 'credited_no_reward'  then 'my_sightings'
    when 'credited'            then 'money'
    when 'payout_sent'         then 'money'
    when 'dispute_upheld'      then 'money'
    when 'dispute_rejected'    then 'money'
    when 'refund_sent'         then 'money'
    when 'reward_delivered'    then 'money'
    when 'recovery'            then 'watched'
    else null
  end;
$$;

comment on function public.notification_category(text) is
  'Maps a notification kind to its mutable preference category, or NULL when the kind may not be muted (sighting, closed_uncredited, still_missing, deletion_soon) or is not yet classified. NULL always means "deliver". still_missing is capped at three sends per case; deletion_soon at one per post, ever. refund_sent and reward_delivered (owner money, ADR-0021) are mutable under money.';


-- =============================================================================
-- 4. claim_refund_sent_notification — "£X refunded", to the owner.
-- =============================================================================
create or replace function public.claim_refund_sent_notification(p_post_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment uuid;
  v_amount  integer;
  v_owner   uuid;
  v_colour  text;
  v_make    text;
begin
  if p_post_id is null then
    return jsonb_build_object('claimed', false);
  end if;

  -- An escrow refund that actually landed and has not been announced. `kind`
  -- is belt and braces: a £5 fee is never refunded, so it never reaches here.
  select pay.id, pay.refunded_amount_pence, p.owner_id,
         coalesce(nullif(btrim(p.colour), ''), ''), coalesce(nullif(btrim(p.make), ''), '')
    into v_payment, v_amount, v_owner, v_colour, v_make
    from public.payments pay
    join public.posts p on p.id = pay.post_id
   where pay.post_id = p_post_id
     and pay.kind = 'bounty_escrow'
     and pay.status = 'refunded'
     and pay.refunded_amount_pence is not null
     and pay.refund_notified_at is null
   limit 1;

  if v_payment is null then
    return jsonb_build_object('claimed', false);
  end if;

  -- The conditional update IS the idempotency.
  update public.payments
     set refund_notified_at = now()
   where id = v_payment
     and refund_notified_at is null
  returning id into v_payment;

  if v_payment is null then
    return jsonb_build_object('claimed', false);
  end if;

  -- MONEY: the RECORDED refund — what Stripe actually returned, net of the
  -- card fee — never an estimate. The body names the car (an owner may have
  -- two listings) and the one thing a toast never said: when it arrives.
  return jsonb_build_object(
    'claimed', true,
    'user_id', v_owner,
    'post_id', p_post_id,
    'title',   '£' || to_char(v_amount / 100.0, 'FM999990.00') || ' refunded',
    'body',    left(regexp_replace(
                 format('For your %s %s. It usually reaches your card within 5–10 working days.',
                        v_colour, v_make),
                 '\s+', ' ', 'g'), 150)
  );
end $$;

comment on function public.claim_refund_sent_notification(uuid) is
  'One-shot claim for the refund_sent push to the OWNER of a post whose escrow refund landed. Conditional update on payments.refund_notified_at is the idempotency. The amount is the RECORDED refunded_amount_pence (net of the card fee). Copy carries the owner''s own car and the arrival window; nothing about any spotter. Every refusal returns the identical {claimed:false}. SERVICE ROLE ONLY. ADR-0021.';

revoke execute on function public.claim_refund_sent_notification(uuid) from public, anon, authenticated;
grant  execute on function public.claim_refund_sent_notification(uuid) to service_role;


-- =============================================================================
-- 5. claim_reward_delivered_notification — "£X sent to your spotter".
-- =============================================================================
create or replace function public.claim_reward_delivered_notification(p_post_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment  uuid;
  v_transfer integer;
  v_owner    uuid;
  v_colour   text;
  v_make     text;
begin
  if p_post_id is null then
    return jsonb_build_object('claimed', false);
  end if;

  select pay.id, pay.transfer_amount_pence, p.owner_id,
         coalesce(nullif(btrim(p.colour), ''), ''), coalesce(nullif(btrim(p.make), ''), '')
    into v_payment, v_transfer, v_owner, v_colour, v_make
    from public.payments pay
    join public.posts p on p.id = pay.post_id
   where pay.post_id = p_post_id
     and pay.kind = 'bounty_escrow'
     and pay.status = 'released'
     and pay.transfer_amount_pence is not null
     and pay.owner_payout_notified_at is null
   limit 1;

  if v_payment is null then
    return jsonb_build_object('claimed', false);
  end if;

  update public.payments
     set owner_payout_notified_at = now()
   where id = v_payment
     and owner_payout_notified_at is null
  returning id into v_payment;

  if v_payment is null then
    return jsonb_build_object('claimed', false);
  end if;

  -- MONEY: the RECORDED transfer. "your spotter" and never a name: the owner
  -- chose them and knows who they are, and a name in a push crosses
  -- third-party infrastructure for no gain.
  return jsonb_build_object(
    'claimed', true,
    'user_id', v_owner,
    'post_id', p_post_id,
    'title',   '£' || to_char(v_transfer / 100.0, 'FM999990.00') || ' sent to your spotter',
    'body',    left(regexp_replace(
                 format('The reward for your %s %s is on its way to them.', v_colour, v_make),
                 '\s+', ' ', 'g'), 150)
  );
end $$;

comment on function public.claim_reward_delivered_notification(uuid) is
  'One-shot claim for the reward_delivered push to the OWNER of a post whose reward transfer went out. Conditional update on payments.owner_payout_notified_at is the idempotency. The amount is the RECORDED transfer_amount_pence. Copy carries the owner''s own car and "your spotter" — no spotter name. Every refusal returns the identical {claimed:false}. SERVICE ROLE ONLY. ADR-0021.';

revoke execute on function public.claim_reward_delivered_notification(uuid) from public, anon, authenticated;
grant  execute on function public.claim_reward_delivered_notification(uuid) to service_role;

commit;

-- =============================================================================
-- WHAT: A reward that ends at its term is refunded under the POST LOCK, so a
--       sighting credited in the meantime can never be refunded from under the
--       spotter (security audit run 1, lead 6).
--
-- WHY:  A reward_end hold runs on a LIVE listing, so the owner can credit a
--       finder until the refund actually happens (the owner's decision,
--       2026-10-26: the spotter wins). release-held-refunds read refunds_due
--       once, with no lock, then refunded through Stripe — and only
--       mark_reward_ended_refunded, AFTER the money moved, noticed a credit
--       that landed in between. The owner got the reward back and the credited
--       spotter's payout failed (or, payout first, could be paid twice).
--
-- HOW:  The shape the payout deadline already uses (claim_payout_lapse /
--       begin_payout, 20261007100000), for reward_end only:
--         1. claim_reward_end_refund — under the post lock (post, then payment:
--            begin_payout's order), re-asks refunds_due for THIS payment and
--            stamps payments.reward_end_refund_claimed_at. The sweep refunds
--            only what it has claimed.
--         2. claim_recovery refuses to CREDIT a sighting while that stamp is on
--            a held payment (REWARD_ENDING); begin_payout refuses to start a
--            payout from it. Same lock, so exactly one side wins.
--         3. release_reward_end_refund_claim — the sweep gives the claim back
--            when it KNOWS no refund reached Stripe. When it cannot know (a
--            Stripe error may be a refund that timed out), the claim stays and
--            the next run resumes it: refundPayment finds an existing refund
--            and records it.
--       The claim lasts the seconds of one Stripe call; until the sweep takes
--       it, crediting works exactly as before.
--
-- ⚠️ NEXT EDITOR: the live definitions of begin_payout and claim_recovery are
--    THIS file (restated verbatim from 20261007100000 / 20261026120000, both
--    md5-checked against production on 2026-10-26, plus the marked edits).
-- =============================================================================

alter table public.payments
  add column reward_end_refund_claimed_at timestamptz;

comment on column public.payments.reward_end_refund_claimed_at is
  'Set by claim_reward_end_refund (under the post lock) when the hourly sweep '
  'is about to refund a reward that ended at its term. While set on a held '
  'payment, claim_recovery will not credit a sighting and begin_payout will '
  'not start a payout. Cleared by release_reward_end_refund_claim when no '
  'refund reached Stripe; kept on the refunded row as the record.';

-- -----------------------------------------------------------------------------
-- claim_reward_end_refund — the sweep's claim on one reward_end refund.
-- true = claimed (or already claimed and still due): refund it now.
-- false = not now: settled, credited, disputed, under review or paying out.
-- -----------------------------------------------------------------------------
create or replace function public.claim_reward_end_refund(p_payment_intent_id text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post    uuid;
  v_pay_id  uuid;
  v_started timestamptz;
begin
  select post_id into v_post
    from public.payments
   where stripe_payment_intent_id = p_payment_intent_id;
  if v_post is null then
    return false;
  end if;

  -- THE POST LOCK, then the payment — begin_payout's order, so the two never
  -- deadlock. claim_recovery takes the same post lock.
  perform 1 from public.posts where id = v_post for update;
  select id, payout_started_at into v_pay_id, v_started
    from public.payments
   where stripe_payment_intent_id = p_payment_intent_id
     and status = 'held'
     and kind = 'bounty_escrow'
     for update;
  if v_pay_id is null or v_started is not null then
    return false;
  end if;

  -- Everything refunds_due checks (no credited sighting, no open/upheld
  -- dispute, no unresolved payout review, hold expired), asked again UNDER
  -- the lock. One definition of "due", never a second copy of it.
  if not exists (
    select 1 from public.refunds_due(1000, v_post) d
     where d.payment_intent_id = p_payment_intent_id
       and d.reason = 'reward_end'
  ) then
    return false;
  end if;

  update public.payments
     set reward_end_refund_claimed_at = coalesce(reward_end_refund_claimed_at, now())
   where id = v_pay_id;
  return true;
end $$;

comment on function public.claim_reward_end_refund(text) is
  'Service-role only (release-held-refunds). Under the post lock, re-checks '
  'that a reward_end refund is still due and claims it; claim_recovery and '
  'begin_payout refuse while claimed. Idempotent: a claimed, still-due '
  'payment returns true again so a crashed run resumes. 20261026140000.';

revoke all on function public.claim_reward_end_refund(text) from public, anon, authenticated;
grant execute on function public.claim_reward_end_refund(text) to service_role;

-- -----------------------------------------------------------------------------
-- release_reward_end_refund_claim — give the claim back when no refund
-- reached Stripe, so the owner can credit again straight away.
-- -----------------------------------------------------------------------------
create or replace function public.release_reward_end_refund_claim(p_payment_intent_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post uuid;
begin
  select post_id into v_post
    from public.payments
   where stripe_payment_intent_id = p_payment_intent_id;
  if v_post is null then
    return;
  end if;

  perform 1 from public.posts where id = v_post for update;
  update public.payments
     set reward_end_refund_claimed_at = null
   where stripe_payment_intent_id = p_payment_intent_id
     and status = 'held';
end $$;

comment on function public.release_reward_end_refund_claim(text) is
  'Service-role only (release-held-refunds). Clears a reward_end refund claim '
  'on a still-held payment, when the sweep knows no refund reached Stripe. '
  '20261026140000.';

revoke all on function public.release_reward_end_refund_claim(text) from public, anon, authenticated;
grant execute on function public.release_reward_end_refund_claim(text) to service_role;


-- -----------------------------------------------------------------------------
-- begin_payout — no payout starts from a reward being refunded.
-- -----------------------------------------------------------------------------
create or replace function public.begin_payout(p_post_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment uuid;
  v_lapsed  timestamptz;
  v_ending  timestamptz;   -- 20261026140000
begin
  -- THE POST LOCK — the same one claim_payout_lapse takes.
  perform 1 from public.posts where id = p_post_id for update;

  select id, payout_lapse_claimed_at, reward_end_refund_claimed_at
    into v_payment, v_lapsed, v_ending
    from public.payments
   where post_id = p_post_id and status = 'held' and kind = 'bounty_escrow'
     for update;

  if v_payment is null then
    raise exception 'NO_HELD_PAYMENT';
  end if;
  if v_lapsed is not null then
    raise exception 'PAYOUT_LAPSED';
  end if;
  -- MONEY (20261026140000): the sweep is refunding this reward at its term
  -- end. claim_recovery already refuses the credit a payout needs; this is
  -- the second lock. Never a payout AND a refund.
  if v_ending is not null then
    raise exception 'REWARD_ENDING';
  end if;

  update public.payments set payout_started_at = now() where id = v_payment;
end $$;

-- -----------------------------------------------------------------------------
-- claim_recovery — no credit lands on a reward being refunded.
-- -----------------------------------------------------------------------------
create or replace function public.claim_recovery(
  p_post_id     uuid,
  p_sighting_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller     uuid := auth.uid();
  v_owner      uuid;
  v_status     public.post_status;
  v_spotter    uuid;
  v_sighting_post uuid;
  -- MONEY (ADR-0014): NULL bounty = a free listing = nothing to release or refund.
  v_bounty     integer;
  v_next_step  text;
  v_new_status public.post_status;
  -- AUDIT 2026-10-26 (lead 6): true when the owner/spotter pair looks like
  -- one person — the public recoveries_credited counter then stays put.
  v_flagged    boolean;
begin
  if v_caller is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  -- Lock the post row for the duration. Without this, two taps of "I got it
  -- back" can both read `active` and both proceed; the unique index would stop
  -- a double CREDIT but not a double counter increment.
  select owner_id, status, bounty_amount_pence
    into v_owner, v_status, v_bounty
  from public.posts
  where id = p_post_id
  for update;

  if v_owner is null then
    raise exception 'POST_NOT_FOUND';
  end if;
  -- SAFETY: ownership from the JWT, never from an argument.
  if v_owner <> v_caller then
    raise exception 'NOT_OWNER';
  end if;
  -- SAFETY: `active` only. A draft has no payment to resolve; a cancelled or
  -- expired post has already refunded; an already-claimed post would
  -- double-credit. Deliberately NOT a "not closed" test — an allowlist of one.
  if v_status <> 'active' then
    raise exception 'POST_NOT_ACTIVE';
  end if;

  -- MONEY: "free" is decided by the missing bounty, so refuse the one case
  -- where that lies — a NULL bounty with REAL escrow held. It can happen: a
  -- draft switched from bounty to free, while the old bounty intent still
  -- captured (create-payment-intent cancels it best-effort only), and
  -- mark_post_payment_held writes 'held' by the ROW's kind. Closing such a
  -- post to a terminal state would strand that escrow for good: refund-recovery
  -- and release-payout both require recovery_claimed. The 20260802 version at
  -- least routed it to a refund; this must never be worse. Raised BEFORE any
  -- write, so nothing is credited and the post stays active. Same code
  -- cancel_fee_listing uses for the same case (20260822100000).
  -- (Security review, 2026-09-24.)
  if v_bounty is null and exists (
    select 1 from public.payments
    where post_id = p_post_id and status = 'held'
  ) then
    raise exception 'POST_HAS_BOUNTY';
  end if;

  if p_sighting_id is not null then
    select spotter_id, post_id into v_spotter, v_sighting_post
    from public.sightings
    where id = p_sighting_id;

    if v_spotter is null then
      raise exception 'SIGHTING_NOT_FOUND';
    end if;
    -- SAFETY: a sighting on ANOTHER post must never be creditable — that would
    -- let an owner point their escrow at any sighting in the system.
    if v_sighting_post <> p_post_id then
      raise exception 'SIGHTING_NOT_ON_POST';
    end if;
    -- SAFETY: self-credit is a laundering round-trip on a bounty post. Kept for
    -- free listings too: there is no money to launder, but crediting yourself
    -- would still inflate your own recoveries_credited, and reputation is the
    -- thing a free listing DOES pay out.
    if v_spotter = v_caller then
      raise exception 'CANNOT_CREDIT_OWN_SIGHTING';
    end if;

    -- MONEY (20261026140000): the hourly sweep has claimed this reward's
    -- term-end refund and is sending it back to the owner right now. Under the
    -- post lock, so either the claim or this credit wins — never both. Until
    -- the sweep claims it, a credit wins (the owner's decision, 2026-10-26).
    if exists (
      select 1 from public.payments
       where post_id = p_post_id
         and status = 'held'
         and reward_end_refund_claimed_at is not null
    ) then
      raise exception 'REWARD_ENDING';
    end if;

    -- SAFETY (AUDIT 2026-10-26, lead 6): mark_sighting_helpful's collusion
    -- gate (20260814140000). Read BEFORE the credit, so this sighting does not
    -- count towards its own pair total.
    v_flagged := public.shared_device_exists(v_caller, v_spotter)
                 or public.confirmation_pair_count(v_caller, v_spotter) >= 3;

    update public.sightings
    set status = 'credited'
    where id = p_sighting_id;

    -- Reputation v1 (DOMAIN.md): server-maintained ONLY. Runs for BOTH pricing
    -- modes: on a free listing the credit and this bump ARE the spotter's
    -- whole reward (ADR-0014). A flagged pair keeps the credit, not the count.
    if not v_flagged then
      update public.profiles
      set recoveries_credited = recoveries_credited + 1
      where id = v_spotter;
    end if;
  end if;

  -- Where this post lands, and what the client must do next.
  --
  -- BOUNTY POST: 'recovery_claimed' for both answers. recovered /
  -- recovered_no_spotter are post-MONEY states and belong to the Edge Function
  -- that actually moves the money. Unchanged.
  --
  -- FREE LISTING: there is no money leg and no Edge Function to follow, so this
  -- IS the resolution — land on the terminal state directly. posts.closed_at is
  -- maintained by the posts_set_closed_at trigger on the status transition.
  if v_bounty is null then
    v_new_status := case when p_sighting_id is null
                         then 'recovered_no_spotter'::public.post_status
                         else 'recovered'::public.post_status end;
    v_next_step  := 'done';
  else
    v_new_status := 'recovery_claimed'::public.post_status;
    v_next_step  := case when p_sighting_id is null then 'refund' else 'payout' end;
  end if;

  -- recovered_at is when the CAR was recovered — what the 30-day public window
  -- and the feed's "Recently recovered" section date from.
  update public.posts
  set status = v_new_status,
      recovered_at = now()
  where id = p_post_id;

  return jsonb_build_object(
    'postId', p_post_id,
    'creditedSightingId', p_sighting_id,
    -- Named rather than inferred, so the app never re-derives the money path
    -- from a status or a null bounty.
    'nextStep', v_next_step
  );
end $$;

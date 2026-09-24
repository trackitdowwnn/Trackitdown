-- =============================================================================
-- WHAT:  claim_recovery learns that a FREE listing (no reward, ADR-0014) has
--        nothing to pay or refund: it closes the post straight to its terminal
--        state and answers nextStep = 'done'. Then it repairs the free
--        listings that were already stranded in 'recovery_claimed' by the
--        version that lacked this.
-- WHY:   Reported by the owner on 2026-09-24. They marked their own free
--        listing (a £5 listing-fee post, bounty NULL) as "I found it another
--        way" and got "We couldn't find the reward for this listing".
--
--        The cause: claim_recovery was only ever defined by
--        20260802200000_claim_recovery.sql, which predates free listings. It
--        lands EVERY post on 'recovery_claimed' and answers 'refund' | 'payout'
--        — so for a free listing the app dutifully called refund-recovery,
--        which found no held escrow (a listing fee goes requires_payment ->
--        collected, never 'held') and answered NO_HELD_PAYMENT.
--
--        The branch that fixes this WAS written — in
--        20260820110000_no_bounty_listing_fee.sql, section 11 — but that file
--        was deleted from git by 19f3d57 when the £5 design was adopted from
--        what production actually ran, and production's claim_recovery never
--        received it. Verified on production 2026-09-24:
--        pg_get_functiondef(claim_recovery) contains no 'done'. The client has
--        expected 'done' since 2026-08-20 (recoveryApi.ts) and skips the refund
--        call on it; the server simply never sent it.
--
--        What it left behind is worse than the error. The claim had already
--        landed, so the post sits in 'recovery_claimed' — publicly hidden,
--        waiting on a payout or refund that cannot exist, with no way out for
--        the owner, and it is one of the states that block account deletion
--        (DOMAIN.md "Account deletion"). Every free listing marked recovered
--        since free listings shipped ends the same way. Section 2 repairs
--        them. (That removes this block only: erasing a user whose closed
--        posts still carry payment rows meets payments.post_id ON DELETE
--        RESTRICT, for recovered bounty posts too — a separate, older issue.)
--
-- MONEY: this moves no money and touches no payment row. The bounty path is
--        byte-for-byte unchanged: a post WITH a bounty still lands on
--        'recovery_claimed' and answers 'refund' | 'payout', because its
--        terminal state belongs to the Edge Function that moves the money.
-- LINKS: supabase/migrations/20260802200000_claim_recovery.sql (the version
--          this replaces); git show 19f3d57^:supabase/migrations/
--          20260820110000_no_bounty_listing_fee.sql (section 11, restored
--          here); supabase/migrations/20260819100000_a_listing_can_be_free.sql
--          (bounty_amount_pence NULL = a free listing);
--        src/features/vehicles/api/recoveryApi.ts (the 'done' contract);
--        supabase/tests/recovery_verification.sql (CHECKS 18-22);
--        docs/decisions/ADR-0014-* ; docs/DOMAIN.md (lifecycle 4-6).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. claim_recovery — a free listing closes immediately.
-- -----------------------------------------------------------------------------
-- `create or replace` REPLACES, so this is the whole function: the 20260802
-- body verbatim, plus v_bounty and the terminal-state branch. Every guard —
-- auth, row lock, owner-only, active-only, foreign sighting, self-credit — is
-- unchanged.
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

    update public.sightings
    set status = 'credited'
    where id = p_sighting_id;

    -- Reputation v1 (DOMAIN.md): server-maintained ONLY. Runs for BOTH pricing
    -- modes: on a free listing the credit and this bump ARE the spotter's
    -- whole reward (ADR-0014).
    update public.profiles
    set recoveries_credited = recoveries_credited + 1
    where id = v_spotter;
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

comment on function public.claim_recovery(uuid, uuid) is
  'Owner marks their post recovered and credits one sighting or none. Moves no money. Owner-only, active-only, single-winner, no self-credit. BOUNTY POST: lands on recovery_claimed for both answers (recovered/recovered_no_spotter are post-money states set by the resolving Edge Function) and returns nextStep refund|payout. FREE LISTING (bounty NULL, ADR-0014): no money leg, so it lands DIRECTLY on recovered (a sighting was credited) or recovered_no_spotter (found another way) and returns nextStep=done. Without that branch (missing 2026-08-20 to 2026-09-24) a free listing was stranded in recovery_claimed with a refund call that could never succeed.';

-- Deny-by-default then grant (re-stated: create or replace keeps grants, but
-- this file should be correct read on its own).
revoke all on function public.claim_recovery(uuid, uuid) from public;
revoke all on function public.claim_recovery(uuid, uuid) from anon;
grant execute on function public.claim_recovery(uuid, uuid) to authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 2. Repair — free listings already stranded in 'recovery_claimed'.
-- -----------------------------------------------------------------------------
-- A FUNCTION, called once below, rather than a bare UPDATE: its money guard is
-- the part that matters most, and a function is something the verification
-- suite can call and assert (recovery_verification CHECK 22). Service-role
-- only; kept afterwards as a safe, idempotent maintenance tool.
--
-- Each post gets the terminal state the fixed function would have given it:
-- 'recovered' if a sighting was credited, 'recovered_no_spotter' if not.
-- recovered_at was stamped by the original claim and is kept (closed_at
-- follows it via posts_set_closed_at).
--
-- MONEY GUARD: only posts with NO bounty AND no payment in 'held'. A bounty
-- post in recovery_claimed is legitimately waiting on its payout or refund; a
-- NULL-bounty post holding escrow is the POST_HAS_BOUNTY case above and needs
-- a refund, not a close. Neither is ever touched here.
--
-- Idempotent: a second run finds nothing in recovery_claimed to move.
create or replace function public.resolve_stranded_free_recoveries()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_moved integer;
begin
  update public.posts p
  set status = case
                 when exists (
                   select 1 from public.sightings s
                   where s.post_id = p.id and s.status = 'credited'
                 )
                 then 'recovered'::public.post_status
                 else 'recovered_no_spotter'::public.post_status
               end
  where p.status = 'recovery_claimed'
    and p.bounty_amount_pence is null
    and not exists (
      select 1 from public.payments pay
      where pay.post_id = p.id and pay.status = 'held'
    );
  get diagnostics v_moved = row_count;
  return v_moved;
end $$;

comment on function public.resolve_stranded_free_recoveries() is
  'Moves FREE listings (bounty NULL, no held payment) stranded in recovery_claimed to recovered (a sighting was credited) or recovered_no_spotter. Repairs posts claimed while claim_recovery lacked its free-listing branch (to 2026-09-24). Never touches a bounty post or one holding escrow. Idempotent; returns the number of posts moved. Service role only.';

revoke all on function public.resolve_stranded_free_recoveries() from public;
revoke all on function public.resolve_stranded_free_recoveries() from anon, authenticated;
grant execute on function public.resolve_stranded_free_recoveries() to service_role;

-- Run the repair now.
select public.resolve_stranded_free_recoveries();

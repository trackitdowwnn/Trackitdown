-- =============================================================================
-- WHAT:  public.claim_recovery(p_post_id, p_sighting_id) — the owner marks
--        their car recovered and either credits ONE sighting or credits none.
--        Moves the post `active` -> `recovery_claimed`, stamps `recovered_at`,
--        and (when a sighting is named) flips it to `credited` and increments
--        that spotter's `recoveries_credited`.
-- WHY:   This is the hole in the core loop. Nothing in the schema moved a post
--        to `recovery_claimed` or a sighting to `credited`, so an owner could
--        post, pay, be sighted and chat — and then the app ran out of road.
--        Three things were blocked behind it and none of them were separately
--        buildable: the 95/5 payout, the `recovered_no_spotter` refund, and
--        `recoveries_credited`, which could never leave 0 and left a third of
--        the reputation system permanently inert.
--
-- WHERE THIS STOPS, AND WHY THERE: at the money. DOMAIN.md's lifecycle is
--        explicit that `recovered` means *already paid* ("the Edge Function
--        releases the escrowed bounty: 95% to the winning spotter, 5%
--        platform fee") and `recovered_no_spotter` means *already refunded*.
--        Neither is a state SQL may assign — Stripe has to succeed first.
--        So this function deliberately lands on `recovery_claimed` for BOTH
--        answers, which is precisely what that state is for: the claim is
--        recorded, the winner is decided, the money has not moved. The two
--        Edge Functions that resolve it (`release-payout` and the no-spotter
--        refund) are the next slice, and both already have a sibling to copy
--        (`deactivate-post` does refund-then-record today).
--
--        Getting this order wrong is the classic escrow bug: a post marked
--        `recovered` whose transfer then fails has told an owner their case is
--        closed and a spotter they have been paid, with the money still in
--        escrow and no state left to retry from.
--
-- MONEY: this function moves NO money and touches NO payment row. It records
--        WHO WON. All amounts remain in pence in the payments ledger, and the
--        95/5 split is computed server-side at transfer time (ADR-0002),
--        never here and never in the client.
--
-- SAFETY: the collusion surface is the whole point of the guards below.
--        Crediting a sighting is what turns £50-£5,000 of escrow into someone
--        else's money, so every guard is a hard server check, not UI:
--          * only the post's OWNER may claim (auth.uid(), not a passed id)
--          * only from `active` — never from draft (unpaid), cancelled,
--            expired, or an already-claimed post (double-credit)
--          * the sighting must belong to THIS post
--          * the spotter must not be the owner — self-crediting would be a
--            free round-trip of your own escrow minus the platform fee
--          * SINGLE WINNER (DOMAIN.md): at most one credited sighting per
--            post, enforced by a partial unique index as well as by this
--            function, so a concurrent double-claim cannot slip between the
--            check and the write.
-- LINKS: docs/DOMAIN.md (lifecycle states 4-6; "Single winner"; bounty rules);
--        docs/decisions/ADR-0002-stripe-connect.md (transfer math);
--        supabase/migrations/20260801130000_sighting_timeline.sql
--          (mark_sighting_helpful — the counter pattern mirrored here);
--        supabase/functions/deactivate-post/index.ts (the refund-then-record
--          shape the resolving Edge Functions will follow);
--        supabase/tests/recovery_verification.sql.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. SINGLE WINNER, structurally.
-- DOMAIN.md: "Exactly one sighting can be credited per recovery. No splitting
-- in v1." A partial unique index makes that an invariant of the DATA rather
-- than a promise made by a function — two concurrent claims cannot both win.
-- -----------------------------------------------------------------------------
create unique index if not exists sightings_one_credited_per_post_uidx
  on public.sightings (post_id)
  where status = 'credited';

comment on index public.sightings_one_credited_per_post_uidx is
  'DOMAIN.md single-winner rule: at most one credited sighting per post. Structural, so concurrent claim_recovery calls cannot both credit.';


-- -----------------------------------------------------------------------------
-- 2. The RPC.
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
begin
  if v_caller is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  -- Lock the post row for the duration. Without this, two taps of "I got it
  -- back" can both read `active` and both proceed; the unique index would stop
  -- a double CREDIT but not a double counter increment.
  select owner_id, status into v_owner, v_status
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
  -- SAFETY: `active` only. A draft has no escrow to release; a cancelled or
  -- expired post has already refunded; an already-claimed post would
  -- double-credit. Deliberately NOT a "not closed" test — an allowlist of one.
  if v_status <> 'active' then
    raise exception 'POST_NOT_ACTIVE';
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
    -- SAFETY: self-credit is a laundering round-trip — the owner would recover
    -- 95% of their own escrow and pay 5% for the privilege. Blocked here even
    -- though reporting a sighting on your own post is already blocked
    -- upstream: this is the money boundary, so it re-checks.
    if v_spotter = v_caller then
      raise exception 'CANNOT_CREDIT_OWN_SIGHTING';
    end if;

    update public.sightings
    set status = 'credited'
    where id = p_sighting_id;

    -- Reputation v1 (DOMAIN.md): server-maintained ONLY — clients hold no
    -- write grant on these columns. Mirrors mark_sighting_helpful.
    update public.profiles
    set recoveries_credited = recoveries_credited + 1
    where id = v_spotter;
  end if;

  -- BOTH answers land here. See the header: `recovered` / `recovered_no_spotter`
  -- are post-money states and are set by the resolving Edge Function, not by
  -- SQL. recovered_at is stamped now because it is when the CAR was recovered,
  -- which is what the 30-day public window and the feed's "Recently recovered"
  -- section date from — not when the transfer settles.
  update public.posts
  set status = 'recovery_claimed',
      recovered_at = now()
  where id = p_post_id;

  return jsonb_build_object(
    'postId', p_post_id,
    'creditedSightingId', p_sighting_id,
    -- What the client must do next. Named rather than inferred so the app
    -- never has to re-derive the money path from the status.
    'nextStep', case when p_sighting_id is null then 'refund' else 'payout' end
  );
end $$;

comment on function public.claim_recovery(uuid, uuid) is
  'Owner marks their post recovered and credits one sighting or none. Lands on recovery_claimed for BOTH answers — recovered/recovered_no_spotter are post-money states set by the resolving Edge Function. Moves no money. Owner-only, active-only, single-winner, no self-credit.';

-- Deny-by-default then grant. REVOKE FROM PUBLIC first: Postgres grants
-- EXECUTE to PUBLIC on new functions, which on Supabase reaches anon.
revoke all on function public.claim_recovery(uuid, uuid) from public;
revoke all on function public.claim_recovery(uuid, uuid) from anon;
grant execute on function public.claim_recovery(uuid, uuid) to authenticated, service_role;

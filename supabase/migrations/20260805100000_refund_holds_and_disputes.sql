-- =============================================================================
-- WHAT:  Refund holds, exit attestation, and spotter disputes — the owner-denial
--        control. When an owner exits with a refund while RECENT UNCREDITED
--        sightings exist, the exit must be attested ("none of these led me to
--        the car"), the post closes immediately, and the refund WAITS 72 hours
--        while every recent spotter is told and may dispute. A dispute upheld
--        (by hand, v1) credits the sighting and the existing payout machinery
--        pays the spotter; rejected or unclaimed, the sweep refunds the owner.
-- WHY:   Until now the two exits (`deactivate-post`, "found it another way")
--        checked ownership and status ONLY. An owner whose car was found by a
--        spotter could take the bounty back with one tap, minus only the card
--        fee, and the spotter never learned it happened — no notification, no
--        surface, no recourse. DOMAIN.md's Disputes section described exactly
--        this protection and none of it existed. The design leans on the
--        evidence that already persists (immutable sighting photos with
--        capture-time GPS, retained chat) and on the `payout_reviews` pattern:
--        a side table for money-under-review, resolved by hand in v1.
--
-- MONEY: nothing here moves money. The escrow payment stays `held` for the
--        length of the hold — "released" is deliberately NOT a column on
--        refund_holds but derived from payments.status, so there is exactly
--        one source of truth and the sweep is idempotent by construction.
--        The sweep (`release-held-refunds`) and the resolving functions do the
--        moving, through the same shared refund/payout implementations as the
--        interactive paths.
--
-- SAFETY: every function below is deny-by-default; the spotter-facing ones
--        answer with ONE refusal token however they refuse (no oracle), and
--        the hold trigger has ONE definition (`recent_uncredited_sightings`)
--        shared by the client pre-flight, both Edge Functions, and the hold
--        creator — two definitions of "recent" would eventually disagree
--        about whose refund waits.
-- LINKS: docs/DOMAIN.md (Disputes); docs/SECURITY_AND_TRUST.md;
--        docs/decisions/ADR-0011-refund-holds-and-disputes.md;
--        supabase/functions/_shared/refundHold.ts (gateExitRefund);
--        supabase/functions/release-held-refunds/index.ts (the sweep);
--        supabase/migrations/20260803140000_payout_collusion_check.sql
--          (payout_reviews — the review-side-table pattern);
--        supabase/migrations/20260802200000_claim_recovery.sql (single-winner
--          index + the credit shape resolve_sighting_dispute mirrors);
--        supabase/tests/refund_hold_verification.sql.
-- =============================================================================


-- =============================================================================
-- 1. refund_holds — one per post, created at the moment an attested exit is
--    accepted with recent sightings outstanding. A POLICY object, not a money
--    state: the payment row stays `held` and payments.status is the one truth
--    about whether the refund has since been released.
-- =============================================================================
create table public.refund_holds (
  post_id      uuid primary key references public.posts (id) on delete restrict,
  owner_id     uuid not null references public.profiles (id) on delete restrict,
  -- Which exit was attempted. Picks BOTH the sweep's idempotency key
  -- (post-refund- vs recovery-refund-) and the terminal RPC
  -- (mark_post_payment_refunded vs mark_post_recovered_no_spotter), so it is
  -- recorded, never re-derived.
  exit_path    text not null check (exit_path in ('deactivate', 'recovery')),
  -- THE ATTESTATION: who confirmed "none of these led me to the car", when,
  -- and exactly which sightings they were shown when they said it.
  attested_at  timestamptz not null default now(),
  sighting_ids uuid[] not null check (cardinality(sighting_ids) > 0),
  created_at   timestamptz not null default now(),
  -- The dispute window. After this, an undisputed hold is swept into the
  -- refund the owner asked for.
  expires_at   timestamptz not null
);

comment on table public.refund_holds is
  'Owner-denial control (DOMAIN.md Disputes): an attested exit-with-refund on a post with recent uncredited sightings. The payment stays held until the sweep releases it (expires_at passed, no open/upheld dispute) — released is DERIVED from payments.status, never stored here. sighting_ids is the attestation evidence: exactly what the owner saw. Written by create_refund_hold only.';

alter table public.refund_holds enable row level security;

-- The owner may see their own hold — it powers the honest "your refund is sent
-- after {date}" line. Nobody else reads it; spotters learn through their push
-- and their dispute, never by browsing holds.
create policy refund_holds_select_own on public.refund_holds
  for select using (owner_id = (select auth.uid()));


-- =============================================================================
-- 2. refund_disputes — one per SIGHTING (several spotters may each file once;
--    the single-winner rule is enforced at RESOLUTION, not at filing).
-- =============================================================================
create table public.refund_disputes (
  id           uuid primary key default gen_random_uuid(),
  post_id      uuid not null references public.posts (id) on delete restrict,
  sighting_id  uuid not null unique references public.sightings (id),
  spotter_id   uuid not null references public.profiles (id) on delete restrict,
  statement    text check (statement is null or char_length(statement) <= 500),
  status       text not null default 'open' check (status in ('open', 'upheld', 'rejected')),
  created_at   timestamptz not null default now(),
  resolved_at  timestamptz,
  check ((status = 'open') = (resolved_at is null)),
  -- Outcome-push claim marker (conditional-update idiom). Server-only.
  outcome_notified_at timestamptz
);

comment on table public.refund_disputes is
  'A spotter''s "my sighting led to this recovery" on a held refund. One per sighting (unique); filed via open_dispute within the hold window; resolved BY HAND in v1 via resolve_sighting_dispute (payout_reviews pattern). An open or upheld dispute blocks the refund sweep. outcome_notified_at is the outcome-push idempotency claim.';

create index refund_disputes_post_idx on public.refund_disputes (post_id);

alter table public.refund_disputes enable row level security;

-- The spotter reads their own dispute — it is their document, and unlike
-- payout_reviews there is no fraud signal to leak: they know they filed it.
create policy refund_disputes_select_own on public.refund_disputes
  for select using (spotter_id = (select auth.uid()));


-- =============================================================================
-- 3. The ONE trigger definition. Everything that asks "does this exit need a
--    hold?" — the client pre-flight, both Edge Functions, create_refund_hold —
--    calls this. 14 days: a recovery usually follows the sighting that caused
--    it quickly; a months-old sighting on a long listing did not cause this
--    one, and holding an honest owner's refund for it would be a small
--    cruelty. `helpful` is included: the owner themselves marked it useful.
-- =============================================================================
create or replace function public.recent_uncredited_sightings(p_post_id uuid)
returns setof uuid
language sql
stable
set search_path = ''
as $$
  select s.id
    from public.sightings s
   where s.post_id = p_post_id
     and s.status in ('unverified', 'helpful')
     and s.created_at > now() - interval '14 days';
$$;

comment on function public.recent_uncredited_sightings(uuid) is
  'THE one definition of "sightings that hold up an exit refund": uncredited (unverified or helpful) and reported within 14 days. Client pre-flight, both exit Edge Functions, and create_refund_hold all route through this — two definitions would disagree about whose refund waits. Not directly grantable; called inside SECURITY DEFINER functions.';

revoke all on function public.recent_uncredited_sightings(uuid) from public;
revoke all on function public.recent_uncredited_sightings(uuid) from anon;
revoke all on function public.recent_uncredited_sightings(uuid) from authenticated;


-- =============================================================================
-- 4. The push claim column for 'closed_uncredited'. Same server-only posture
--    as sightings.notified_at / credited_notified_at.
-- =============================================================================
alter table public.sightings
  add column closed_notified_at timestamptz;

comment on column public.sightings.closed_notified_at is
  'closed_uncredited push idempotency CLAIM. NULL = this spotter has never been told the post closed uncredited. Set exactly once by create_refund_hold via conditional update. Server-only: sightings carries no client write grant.';


-- =============================================================================
-- 5. exit_check — "will this exit need an attestation, and for which
--    sightings?" Two entrances, one implementation: `exit_check_for` takes
--    the owner as an argument for the Edge Functions (they verified the JWT
--    themselves; auth.uid() is empty under the service role), and
--    `exit_check` is the client pre-flight reading auth.uid(). Owner-gated;
--    POST_NOT_FOUND for both "no such post" and "not yours".
-- =============================================================================
create or replace function public.exit_check_for(p_post_id uuid, p_owner_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_ids   uuid[];
begin
  select owner_id into v_owner from public.posts where id = p_post_id;
  if v_owner is null or v_owner <> p_owner_id then
    raise exception 'POST_NOT_FOUND';
  end if;

  select coalesce(array_agg(id), '{}')
    into v_ids
    from public.recent_uncredited_sightings(p_post_id) as t(id);

  return jsonb_build_object(
    'requiresAttestation', cardinality(v_ids) > 0,
    'sightingIds', to_jsonb(v_ids),
    -- Named so the client renders the true numbers, not hardcoded copies.
    'windowDays', 14,
    'holdHours', 72
  );
end $$;

comment on function public.exit_check_for(uuid, uuid) is
  'The exit pre-flight implementation: whether recent uncredited sightings exist (via recent_uncredited_sightings, the one definition) and which, plus the window/hold constants for honest copy. Owner passed by the VERIFIED caller (Edge Functions). SERVICE ROLE ONLY — clients use exit_check.';

revoke all on function public.exit_check_for(uuid, uuid) from public;
revoke all on function public.exit_check_for(uuid, uuid) from anon;
revoke all on function public.exit_check_for(uuid, uuid) from authenticated;
grant execute on function public.exit_check_for(uuid, uuid) to service_role;

create or replace function public.exit_check(p_post_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;
  return public.exit_check_for(p_post_id, v_caller);
end $$;

comment on function public.exit_check(uuid) is
  'Client pre-flight for the two refund exits — exit_check_for with the caller from auth.uid(). POST_NOT_FOUND for missing AND not-owned — no oracle.';

revoke all on function public.exit_check(uuid) from public;
revoke all on function public.exit_check(uuid) from anon;
grant execute on function public.exit_check(uuid) to authenticated, service_role;


-- =============================================================================
-- 6. create_refund_hold — the atomic moment an attested exit is accepted.
--    SERVICE ROLE ONLY: the Edge Functions call it after their own auth,
--    passing the owner they verified. Raises loudly rather than guessing —
--    this is a money path, and a silent wrong branch here either strands a
--    refund or skips the protection entirely.
-- =============================================================================
create or replace function public.create_refund_hold(
  p_post_id      uuid,
  p_owner_id     uuid,
  p_exit_path    text,
  p_attested_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner    uuid;
  v_status   text;
  v_recent   uuid[];
  v_expires  timestamptz;
  v_inserted uuid;
  v_notify   jsonb;
begin
  if p_exit_path not in ('deactivate', 'recovery') then
    raise exception 'BAD_EXIT_PATH';
  end if;

  -- Lock the post: a concurrent second tap must not create two holds, close
  -- the post twice, or race the recompute below.
  select owner_id, status::text into v_owner, v_status
    from public.posts where id = p_post_id for update;

  if v_owner is null or v_owner <> p_owner_id then
    raise exception 'POST_NOT_FOUND';
  end if;

  -- IDEMPOTENCY FIRST, before any status check: the hold itself changes the
  -- post's status (deactivate delists it below), so a retry after a dropped
  -- response arrives with a post that no longer passes the entry checks. The
  -- existing hold IS the answer — and it sends nothing (already claimed).
  select expires_at into v_expires
    from public.refund_holds where post_id = p_post_id;
  if found then
    return jsonb_build_object('held', true, 'expiresAt', v_expires, 'notify', '[]'::jsonb);
  end if;

  if p_exit_path = 'deactivate' and v_status not in ('active', 'pending_verification') then
    raise exception 'POST_NOT_REFUNDABLE';
  end if;
  if p_exit_path = 'recovery' then
    if v_status <> 'recovery_claimed' then
      raise exception 'POST_NOT_CLAIMED';
    end if;
    -- A credited sighting means this money is a spotter's, not refundable.
    if exists (
      select 1 from public.sightings
       where post_id = p_post_id and status = 'credited'
    ) then
      raise exception 'RECOVERY_HAS_CREDITED_SIGHTING';
    end if;
  end if;

  -- Recompute NOW, under the lock — the attestation the client gathered a
  -- moment ago must still cover reality. A sighting reported between the
  -- pre-flight and the confirm is exactly the case ATTESTATION_STALE exists
  -- for: the owner has not seen it, so they cannot have attested to it.
  select coalesce(array_agg(id), '{}')
    into v_recent
    from public.recent_uncredited_sightings(p_post_id) as t(id);

  if cardinality(v_recent) = 0 then
    -- The caller should have refunded immediately. Fail loudly: silently
    -- holding a refund nothing requires would strand the owner's money.
    raise exception 'NO_HOLD_REQUIRED';
  end if;
  if not (v_recent <@ p_attested_ids) then
    raise exception 'ATTESTATION_STALE';
  end if;

  v_expires := now() + interval '72 hours';

  -- Idempotent: a retry after a dropped response falls through to the
  -- existing hold (and sends nothing — the pushes below were already claimed).
  insert into public.refund_holds (post_id, owner_id, exit_path, sighting_ids, expires_at)
  values (p_post_id, p_owner_id, p_exit_path, v_recent, v_expires)
  on conflict (post_id) do nothing
  returning post_id into v_inserted;

  if v_inserted is null then
    select expires_at into v_expires from public.refund_holds where post_id = p_post_id;
    return jsonb_build_object('held', true, 'expiresAt', v_expires, 'notify', '[]'::jsonb);
  end if;

  -- The deactivate path DELISTS NOW: the owner asked for the listing to come
  -- down and that part is theirs unconditionally — only the money waits.
  -- (mark_post_payment_refunded's post update becomes a benign no-op at sweep
  -- time; the payment flip is what matters there.) The recovery path is
  -- already on recovery_claimed, which is precisely "claim recorded, money
  -- not moved", so it stays put.
  if p_exit_path = 'deactivate' then
    update public.posts set status = 'cancelled' where id = p_post_id;
  end if;

  -- Claim + build the pushes in one conditional pass (the claim IS the
  -- idempotency). COPY LIVES HERE, DB-testable: no car, no plate, no owner
  -- name — the spotter knows which sighting was theirs.
  with claimed as (
    update public.sightings
       set closed_notified_at = now()
     where id = any (v_recent)
       and closed_notified_at is null
    returning id, spotter_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'user_id', claimed.spotter_id,
           'sighting_id', claimed.id,
           'title', 'Did your sighting help find it?',
           'body', 'A car you sighted was just closed without crediting anyone. If your sighting led to the recovery, you have 72 hours to tell us.'
         )), '[]'::jsonb)
    into v_notify
    from claimed;

  return jsonb_build_object('held', true, 'expiresAt', v_expires, 'notify', v_notify);
end $$;

comment on function public.create_refund_hold(uuid, uuid, text, uuid[]) is
  'Atomically records an attested exit: verifies owner+status per exit path, recomputes the recent set under lock (ATTESTATION_STALE if the owner attested to less than reality), inserts the hold idempotently, delists a deactivate-path post NOW, and claims+builds the closed_uncredited pushes (copy in SQL). Raises loudly — money path. SERVICE ROLE ONLY.';

revoke all on function public.create_refund_hold(uuid, uuid, text, uuid[]) from public;
revoke all on function public.create_refund_hold(uuid, uuid, text, uuid[]) from anon;
revoke all on function public.create_refund_hold(uuid, uuid, text, uuid[]) from authenticated;
grant execute on function public.create_refund_hold(uuid, uuid, text, uuid[]) to service_role;


-- =============================================================================
-- 7. open_dispute — the spotter's lever. Every gate lives in ONE predicate and
--    every refusal is the IDENTICAL token: whether the sighting is not theirs,
--    the window closed, the money already moved, or the sighting was not among
--    those held — the answer is the same, so nothing about another person's
--    post can be probed from here.
-- =============================================================================
create or replace function public.open_dispute(
  p_sighting_id uuid,
  p_statement   text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller  uuid := auth.uid();
  v_post    uuid;
  v_expires timestamptz;
  v_id      uuid;
begin
  if v_caller is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;
  if p_statement is not null and char_length(p_statement) > 500 then
    raise exception 'STATEMENT_TOO_LONG';
  end if;

  select h.post_id, h.expires_at
    into v_post, v_expires
    from public.sightings s
    join public.refund_holds h on h.post_id = s.post_id
    join public.payments p on p.post_id = h.post_id and p.status = 'held'
   where s.id = p_sighting_id
     and s.spotter_id = v_caller
     and s.status in ('unverified', 'helpful')
     and s.id = any (h.sighting_ids)
     and now() < h.expires_at;

  if v_post is null then
    raise exception 'DISPUTE_NOT_AVAILABLE';
  end if;

  begin
    insert into public.refund_disputes (post_id, sighting_id, spotter_id, statement)
    values (v_post, p_sighting_id, v_caller, nullif(trim(p_statement), ''))
    returning id into v_id;
  exception when unique_violation then
    -- A replay (double tap, retried request). Same token as every other
    -- refusal — their own screen already shows the dispute they filed.
    raise exception 'DISPUTE_NOT_AVAILABLE';
  end;

  return jsonb_build_object('disputeId', v_id, 'windowEndsAt', v_expires);
end $$;

comment on function public.open_dispute(uuid, text) is
  'Spotter files "my sighting led to this recovery" on a held refund. All gates (own sighting, uncredited, listed in the hold, window open, payment still held) in one predicate behind the single token DISPUTE_NOT_AVAILABLE — replays included. One dispute per sighting (unique). Fail-closed.';

revoke all on function public.open_dispute(uuid, text) from public;
revoke all on function public.open_dispute(uuid, text) from anon;
grant execute on function public.open_dispute(uuid, text) to authenticated, service_role;


-- =============================================================================
-- 8. my_dispute_context — what the dispute screen may know. The post is
--    invisible to the spotter once closed (posts RLS is active-or-own), so
--    this hands over the minimum: the car as they knew it, the deadline,
--    their own dispute if filed, and what the bounty share would be. No owner
--    identity, no location, no plate.
-- =============================================================================
create or replace function public.my_dispute_context(p_sighting_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_row    record;
  v_share  integer;
begin
  if v_caller is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select h.expires_at, po.make, po.colour, pay.amount_pence,
         d.status as dispute_status, d.created_at as dispute_created_at
    into v_row
    from public.sightings s
    join public.refund_holds h on h.post_id = s.post_id
    join public.posts po on po.id = s.post_id
    left join public.payments pay on pay.post_id = s.post_id and pay.status = 'held'
    left join public.refund_disputes d on d.sighting_id = s.id
   where s.id = p_sighting_id
     and s.spotter_id = v_caller
     and s.id = any (h.sighting_ids);

  if not found then
    raise exception 'DISPUTE_NOT_AVAILABLE';
  end if;

  if v_row.amount_pence is not null then
    select transfer_pence into v_share from public.payout_split(v_row.amount_pence);
  end if;

  return jsonb_build_object(
    'car', jsonb_build_object('make', v_row.make, 'colour', v_row.colour),
    'windowEndsAt', v_row.expires_at,
    'bountySharePence', v_share,
    'dispute', case when v_row.dispute_status is null then null
      else jsonb_build_object('status', v_row.dispute_status, 'createdAt', v_row.dispute_created_at)
    end
  );
end $$;

comment on function public.my_dispute_context(uuid) is
  'The dispute screen''s read: own sighting on a held post only. Car make/colour (what the spotter already saw), deadline, their dispute if any, and the payout_split share (null once the money moved). No owner identity, no location, no plate. Single refusal token.';

revoke all on function public.my_dispute_context(uuid) from public;
revoke all on function public.my_dispute_context(uuid) from anon;
grant execute on function public.my_dispute_context(uuid) to authenticated, service_role;


-- =============================================================================
-- 9. resolve_sighting_dispute — v1 resolution, run BY HAND with the service
--    role (payout_reviews pattern: the founder reads the sighting trail —
--    photos, GPS, timestamps, chat — and decides).
--
--    UPHELD is the path claim_recovery cannot serve (it accepts `active`
--    only, and this post closed): credit directly, mirroring claim_recovery's
--    shape — single-winner index as the structural backstop, counter
--    increment, spotter<>owner re-check — then move the post to
--    recovery_claimed so the EXISTING release-payout core (collusion gate,
--    post-payout-{id} idempotency, mark_recovery_paid) runs with zero changes.
-- =============================================================================
create or replace function public.resolve_sighting_dispute(
  p_dispute_id uuid,
  p_uphold     boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_d       record;
  v_owner   uuid;
  v_status  text;
begin
  select id, post_id, sighting_id, spotter_id
    into v_d
    from public.refund_disputes
   where id = p_dispute_id and status = 'open'
   for update;

  if v_d.id is null then
    raise exception 'DISPUTE_NOT_OPEN';
  end if;

  if not p_uphold then
    update public.refund_disputes
       set status = 'rejected', resolved_at = now()
     where id = p_dispute_id;
    -- The sweep now sees no blocking dispute: the owner's refund proceeds on
    -- schedule, and the rejected push goes out via the outcome claim.
    return jsonb_build_object('resolved', 'rejected', 'postId', v_d.post_id);
  end if;

  -- UPHELD ------------------------------------------------------------------
  select owner_id, status::text into v_owner, v_status
    from public.posts where id = v_d.post_id for update;

  -- Same money-boundary re-checks as claim_recovery, because this call has
  -- the same power: it turns escrow into someone else's money.
  if v_owner = v_d.spotter_id then
    raise exception 'CANNOT_CREDIT_OWN_SIGHTING';
  end if;
  if exists (
    select 1 from public.sightings
     where post_id = v_d.post_id and status = 'credited'
  ) then
    raise exception 'POST_ALREADY_CREDITED';
  end if;
  if not exists (select 1 from public.refund_holds where post_id = v_d.post_id) then
    -- Only a held post may be resurrected — this function must never turn an
    -- ordinary old cancelled post back into a live recovery.
    raise exception 'NO_HOLD';
  end if;
  if v_status not in ('cancelled', 'recovery_claimed') then
    raise exception 'POST_NOT_RESOLVABLE';
  end if;

  -- The credit, mirroring claim_recovery (the partial unique index
  -- sightings_one_credited_per_post_uidx is the structural backstop).
  update public.sightings
     set status = 'credited'
   where id = v_d.sighting_id;

  update public.profiles
     set recoveries_credited = recoveries_credited + 1
   where id = v_d.spotter_id;

  -- Back onto the money rails: recovery_claimed is exactly "winner decided,
  -- money not moved", and release-payout takes it from there unchanged.
  -- recovered_at only if never stamped (the recovery path stamped it already).
  update public.posts
     set status = 'recovery_claimed',
         recovered_at = coalesce(recovered_at, now())
   where id = v_d.post_id;

  update public.refund_disputes
     set status = 'upheld', resolved_at = now()
   where id = p_dispute_id;

  -- One winner: every other open dispute on this post loses by construction.
  update public.refund_disputes
     set status = 'rejected', resolved_at = now()
   where post_id = v_d.post_id and status = 'open';

  return jsonb_build_object(
    'resolved', 'upheld',
    'postId', v_d.post_id,
    'sightingId', v_d.sighting_id,
    'spotterId', v_d.spotter_id
  );
end $$;

comment on function public.resolve_sighting_dispute(uuid, boolean) is
  'v1 dispute resolution, run BY HAND (service role). Rejected: stamp and stop — the sweep then refunds the owner. Upheld: credit the sighting directly (claim_recovery cannot — the post is closed), mirroring its shape (single-winner index backstop, counter, no self-credit), move the post to recovery_claimed, auto-reject sibling open disputes; the existing release-payout core pays the spotter unchanged. Only posts with a refund hold can be resurrected.';

revoke all on function public.resolve_sighting_dispute(uuid, boolean) from public;
revoke all on function public.resolve_sighting_dispute(uuid, boolean) from anon;
revoke all on function public.resolve_sighting_dispute(uuid, boolean) from authenticated;
grant execute on function public.resolve_sighting_dispute(uuid, boolean) to service_role;

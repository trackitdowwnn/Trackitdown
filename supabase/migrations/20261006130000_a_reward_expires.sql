-- =============================================================================
-- WHAT:  A reward EXPIRES (PR5 of the 60-day reward plan, ADR-0020). When a
--        reward's term ends unrenewed, the hourly sweep claims it and sends it
--        home to its owner — through the ADR-0011 refund hold, so a spotter
--        whose recent sighting found the car keeps every protection — and the
--        listing stays up as "Reward ended" (PR4's columns).
--          1. payments.expiry_claimed_at.
--          2. card_fee_pence — the fixed 1.5% + 20p (ADR-0021), in SQL for
--             the owner's push copy only.
--          3. refund_holds become ONE PER PAYMENT (id, payment_id unique,
--             system_initiated; exit_path gains 'reward_end').
--          4. Every reader of holds restated to look at the CURRENT payment's
--             hold: reward_has_claim, refunds_due, exit_check_for,
--             create_refund_hold (an owner exit UPGRADES a pending system
--             hold), open_dispute, my_dispute_context (+ reason),
--             my_sighting_record, resolve_sighting_dispute (a live post may
--             now be resolved), delete_cancelled_post (snapshot).
--          5. claim_reward_expiries — the claim (service role).
--          6. mark_reward_ended_refunded — the terminal record; and
--             reconcile_payment_refund routes a reward_end refund there.
-- WHY:   Stripe caps funds on the platform balance at 90 days (lead support,
--        2026-10-05); a reward lasts 60 (ADR-0020) and, unrenewed, must go
--        home without anyone asking. ADR-0020 point 4: the automatic refund
--        goes through ADR-0011's machinery — recent uncredited sightings
--        start a 72-hour hold and those spotters may dispute; an open or
--        upheld dispute blocks it; nothing changes while a claim is open.
--
--        WHY HOLDS BECOME PER PAYMENT. refund_holds was keyed on the POST:
--        one hold, forever. A lapsed listing stays live and can take a new
--        reward, so it can need a second hold — and every reader treated "a
--        hold exists" as "a claim is open", so the first lapse would have
--        blocked that listing from EVER taking a reward again. A hold now
--        belongs to the payment it holds; "pending" means its payment is
--        still held.
--
--        AN OWNER EXIT DURING A SYSTEM HOLD UPGRADES IT. Deactivating (or
--        "found it another way") while a reward_end hold runs must still
--        delist / record the exit, and must not shorten the spotters' window.
--        The pending hold's sightings count as the exit's trigger set
--        (hold_trigger_sightings), even past 14 days, so the gate can never
--        answer "refund now" in the middle of a window spotters were told
--        about.
--
--        STALE "FOUND IT ANOTHER WAY". A recovery_claimed listing with no
--        credited sighting and no hold is an exit whose refund never
--        completed (the app died between the claim and the refund). At the
--        end of the term the expiry finishes it as that recovery refund,
--        through the same hold.
--
-- MONEY: the claim moves no money and decides no amount. It stamps the claim,
--        fixes the refund basis ON THE PAYMENT (refund_fee_absorbed :=
--        legacy_term, so every path refunding this payment under its one
--        idempotency key asks Stripe for the same amount — the PR4 security
--        review's M1), and creates the hold. The refund itself is the
--        sweep's Phase 1 (refunds_due -> refundPayment -> the terminal RPC).
--
-- ⚠️ GATED IN THE SWEEP (REWARD_EXPIRY_ENABLED, default off). Deploying this
--        migration ends nothing: claim_reward_expiries is only called when
--        the switch is on.
--
-- SAFETY NOTE ON DESTRUCTIVE STATEMENTS: one primary key is moved
--        (refund_holds: post_id -> id) after every existing hold is linked to
--        its payment — asserted, the migration fails loudly otherwise. Two
--        CHECK constraints on refund_holds are dropped and re-added WIDER
--        (every existing row passes; asserted by re-adding them). No data is
--        deleted. `create or replace` on twelve functions, each restated IN
--        FULL from its latest definition (named in its section).
-- LINKS: docs/decisions/ADR-0020-a-reward-has-a-term.md;
--        docs/decisions/ADR-0011-refund-holds-and-disputes.md;
--        docs/decisions/ADR-0021-a-fixed-card-fee.md;
--        supabase/functions/release-held-refunds/index.ts (the expiry phase);
--        supabase/tests/reward_expiry_verification.sql.
-- =============================================================================


-- =============================================================================
-- 1. payments.expiry_claimed_at
-- =============================================================================
alter table public.payments
  add column expiry_claimed_at timestamptz;

comment on column public.payments.expiry_claimed_at is
  'When the expiry (claim_reward_expiries) claimed this reward at the end of its term — it then has a system hold and is on its way home. Set once; the claim''s idempotency.';


-- =============================================================================
-- 2. card_fee_pence — the fixed card fee (ADR-0021), for push COPY only
-- =============================================================================
-- ⚠️ THE THIRD COPY of 1.5% + 20p (refundEscrow.ts decides the refund;
-- money.ts quotes it). This one only words the owner's push. Integer maths
-- with half-up rounding, exactly as the other two (floor((p×15+500)/1000)).
create or replace function public.card_fee_pence(p_amount_pence integer)
returns integer
language sql
immutable
set search_path = ''
as $$
  select (p_amount_pence * 15 + 500) / 1000 + 20;
$$;

comment on function public.card_fee_pence(integer) is
  'The fixed card fee a refund keeps (ADR-0021): 1.5% of the amount, rounded half-up to the penny, + 20p — integer maths. Mirrors cardFeePence in supabase/functions/_shared/refundEscrow.ts (which decides refunds) and src/shared/lib/money.ts. Used here only to word the owner''s reward_ended push.';

revoke all on function public.card_fee_pence(integer) from public, anon, authenticated;


-- =============================================================================
-- 3. refund_holds: one per PAYMENT
-- =============================================================================
alter table public.refund_holds
  add column id               uuid not null default gen_random_uuid(),
  add column payment_id       uuid references public.payments (id) on delete restrict,
  -- A hold the SYSTEM raised (the expiry), not an owner's attested exit:
  -- attested_at is null and sighting_ids may be empty (nothing to wait for).
  add column system_initiated boolean not null default false;

-- Link every existing hold to the payment it holds: the post's held reward,
-- else the reward that was current when the hold was made (refunded or paid
-- out since). Pre-reshape there was at most one hold per post.
update public.refund_holds h
   set payment_id = coalesce(
     (select p.id from public.payments p
       where p.post_id = h.post_id and p.kind = 'bounty_escrow' and p.status = 'held'
       limit 1),
     (select p.id from public.payments p
       where p.post_id = h.post_id and p.kind = 'bounty_escrow'
         and p.status in ('refunded', 'released', 'superseded')
       order by (coalesce(p.captured_at, p.created_at) <= h.created_at) desc,
                coalesce(p.captured_at, p.created_at) desc
       limit 1)
   );

do $$
begin
  if exists (select 1 from public.refund_holds where payment_id is null) then
    raise exception 'refund_holds: % hold(s) could not be linked to a payment — fix by hand before deploying',
      (select count(*) from public.refund_holds where payment_id is null);
  end if;
  if exists (select payment_id from public.refund_holds group by payment_id having count(*) > 1) then
    raise exception 'refund_holds: two holds link to one payment — fix by hand before deploying';
  end if;
end $$;

alter table public.refund_holds drop constraint refund_holds_pkey;
alter table public.refund_holds
  add primary key (id),
  alter column payment_id set not null,
  add constraint refund_holds_one_per_payment unique (payment_id);
create index refund_holds_post_idx on public.refund_holds (post_id);

-- The exit_path and sighting_ids CHECKs were unnamed in 20260805100000; drop
-- them by what they say, not by a guessed name, then re-add them wider.
do $$
declare
  r record;
begin
  for r in
    select conname from pg_constraint
     where conrelid = 'public.refund_holds'::regclass
       and contype = 'c'
       and (pg_get_constraintdef(oid) like '%exit_path%'
            or pg_get_constraintdef(oid) like '%sighting_ids%')
  loop
    execute format('alter table public.refund_holds drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.refund_holds
  alter column attested_at drop not null,
  add constraint refund_holds_exit_path_chk
    check (exit_path in ('deactivate', 'recovery', 'reward_end')),
  -- An owner's hold is an ATTESTATION over the sightings it was raised on; a
  -- system hold is neither attested nor necessarily about any sighting.
  add constraint refund_holds_attestation_chk
    check (system_initiated or (attested_at is not null and cardinality(sighting_ids) > 0)),
  -- Only the system ends a reward.
  add constraint refund_holds_reward_end_is_system_chk
    check (exit_path <> 'reward_end' or system_initiated);

-- Writers written before payment_id existed (the verification suites insert
-- holds directly) name no payment: link them as the backfill above did. The
-- production writers (create_refund_hold, claim_reward_expiries) always set it.
create or replace function public.refund_holds_link_payment()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.payment_id is null then
    select p.id into new.payment_id
      from public.payments p
     where p.post_id = new.post_id and p.kind = 'bounty_escrow' and p.status = 'held'
     limit 1;
    if new.payment_id is null then
      select p.id into new.payment_id
        from public.payments p
       where p.post_id = new.post_id and p.kind = 'bounty_escrow'
       order by coalesce(p.captured_at, p.created_at) desc
       limit 1;
    end if;
  end if;
  return new;
end $$;

create trigger refund_holds_link_payment
  before insert on public.refund_holds
  for each row execute function public.refund_holds_link_payment();

comment on table public.refund_holds is
  'Owner-denial control (DOMAIN.md Disputes), ONE PER PAYMENT since 20261006130000: an attested exit-with-refund on a post with recent uncredited sightings, or a SYSTEM hold the expiry raised at the end of a reward''s term (exit_path reward_end, or a stale recovery finished as one; system_initiated, attested_at null). The payment stays held until the sweep releases it (expires_at passed, no open/upheld dispute) — released is DERIVED from payments.status, never stored here; a hold is "pending" while its payment is held. sighting_ids: the sightings whose spotters were told and may dispute (an owner hold''s attestation evidence).';


-- =============================================================================
-- 4a. hold_trigger_sightings — the sightings an exit must wait for
-- =============================================================================
-- recent_uncredited_sightings (14 days, ADR-0011), PLUS the sightings a
-- pending hold on the post has already told spotters about — so an owner exit
-- in the middle of a window can never be answered "refund now".
create or replace function public.hold_trigger_sightings(p_post_id uuid)
returns uuid[]
language sql
stable
set search_path = ''
as $$
  select coalesce(array_agg(distinct x.id), '{}')
    from (
      select t.id from public.recent_uncredited_sightings(p_post_id) as t(id)
      union
      select unnest(h.sighting_ids)
        from public.refund_holds h
        join public.payments p on p.id = h.payment_id and p.status = 'held'
       where h.post_id = p_post_id
         and h.expires_at > now()
    ) x;
$$;

comment on function public.hold_trigger_sightings(uuid) is
  'The sightings an owner exit must wait for: recent_uncredited_sightings (ADR-0011''s 14 days) plus those named by a PENDING hold on the post whose window is still open (a reward_end hold''s spotters were told they have 72 hours). Not directly grantable.';

revoke all on function public.hold_trigger_sightings(uuid) from public, anon, authenticated;


-- =============================================================================
-- 4b. reward_has_claim — a hold counts only while its payment is held
-- =============================================================================
-- ⚠️ RESTATED IN FULL from 20261005130000. The ONLY change: the hold branch
-- joins its payment. A settled hold (refunded, paid out) is history, not a
-- claim — read as a claim it blocked a lapsed listing from ever taking a
-- reward again.
create or replace function public.reward_has_claim(p_post_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (select 1 from public.refund_holds h
                   join public.payments p on p.id = h.payment_id and p.status = 'held'
                  where h.post_id = p_post_id)
      or exists (select 1 from public.refund_disputes d
                  where d.post_id = p_post_id and d.status in ('open', 'upheld'))
      or exists (select 1 from public.sightings s
                  where s.post_id = p_post_id and s.status = 'credited')
      or exists (select 1 from public.payout_reviews r
                  where r.post_id = p_post_id and r.resolved_at is null);
$$;

comment on function public.reward_has_claim(uuid) is
  'True while anyone has a claim on a listing''s reward money: a PENDING refund hold (its payment still held — a settled hold is history), an open or upheld dispute, a credited sighting, or an unresolved payout review. Blocks changing, renewing or adding a reward. Not directly grantable.';

revoke all on function public.reward_has_claim(uuid) from public, anon, authenticated;


-- =============================================================================
-- 4c. refunds_due — holds join their OWN payment
-- =============================================================================
-- ⚠️ RESTATED IN FULL from 20261005130000. The ONLY change: the hold branch
-- joins `p.id = h.payment_id` (was the post's held payment), so a hold can
-- only ever release the payment it holds. Reasons: deactivate | recovery |
-- reward_end | superseded.
create or replace function public.refunds_due(p_limit integer default 50, p_post_id uuid default null)
returns table (
  payment_id        uuid,
  payment_intent_id text,
  post_id           uuid,
  reason            text
)
language sql
stable
security definer
set search_path = ''
as $$
  select due.payment_id, due.payment_intent_id, due.post_id, due.reason
    from (
      select p.id                        as payment_id,
             p.stripe_payment_intent_id  as payment_intent_id,
             p.post_id                   as post_id,
             h.exit_path                 as reason,
             h.expires_at                as due_at
        from public.refund_holds h
        join public.payments p
          on p.id     = h.payment_id
         and p.status = 'held'
         and p.kind   = 'bounty_escrow'
       where h.expires_at < now()
         and not exists (
           select 1 from public.refund_disputes d
            where d.post_id = h.post_id
              and d.status in ('open', 'upheld')
         )
      union all
      select p.id, p.stripe_payment_intent_id, p.post_id, 'superseded', p.superseded_at
        from public.payments p
       where p.status = 'superseded'
         and p.kind   = 'bounty_escrow'
         -- SECOND LOCK (see 20261005110000): a renewal-superseded payment
         -- waits only behind a dispute that already existed when it was
         -- superseded; a stray always goes home.
         and (
           p.refund_fee_absorbed
           or not exists (
             select 1 from public.refund_disputes d
              where d.post_id = p.post_id
                and d.status in ('open', 'upheld')
                and d.created_at <= p.superseded_at
           )
         )
    ) due
   where p_post_id is null or due.post_id = p_post_id
   order by due.due_at
   limit greatest(coalesce(p_limit, 50), 0);
$$;

comment on function public.refunds_due(integer, uuid) is
  'THE single definition of a refund that is due now: an expired hold whose OWN payment (refund_holds.payment_id) is still held, with no open/upheld dispute on the post (reason = the hold''s exit_path: deactivate | recovery | reward_end), and superseded reward payments owed back (reason superseded; behind a dispute only if it predates the supersede, unless a stray). Bounty only — listing fees never. Service role.';

revoke all on function public.refunds_due(integer, uuid) from public, anon, authenticated;
grant execute on function public.refunds_due(integer, uuid) to service_role;


-- =============================================================================
-- 4d. exit_check_for — the pre-flight counts a pending hold's sightings
-- =============================================================================
-- ⚠️ RESTATED IN FULL from 20260805100000. The ONLY change: the trigger set is
-- hold_trigger_sightings (recent ∪ a pending hold's), not recent alone.
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

  v_ids := public.hold_trigger_sightings(p_post_id);

  return jsonb_build_object(
    'requiresAttestation', cardinality(v_ids) > 0,
    'sightingIds', to_jsonb(v_ids),
    -- Named so the client renders the true numbers, not hardcoded copies.
    'windowDays', 14,
    'holdHours', 72
  );
end $$;

comment on function public.exit_check_for(uuid, uuid) is
  'The owner-denial pre-flight for the two refund exits, owner passed by the verified caller: requiresAttestation + the sighting ids the owner must attest to — recent uncredited sightings (14 days) plus any a PENDING hold''s window still names (hold_trigger_sightings). POST_NOT_FOUND for missing AND not-owned. Service role (exit_check wraps it for clients).';

revoke all on function public.exit_check_for(uuid, uuid) from public, anon, authenticated;
grant execute on function public.exit_check_for(uuid, uuid) to service_role;


-- =============================================================================
-- 4e. create_refund_hold — per payment; an owner exit upgrades a system hold
-- =============================================================================
-- ⚠️ RESTATED IN FULL from 20260922120000. What changes:
--   * the hold belongs to the post's CURRENT held reward (payment_id);
--   * idempotency looks at THAT payment's hold, not "any hold on the post";
--   * a pending SYSTEM hold (the expiry's) is UPGRADED by an owner exit: it
--     becomes the owner's attested exit (path, attestation, sightings
--     widened), the deactivate path still delists, and the window is kept —
--     or restarted at 72 hours if the exit brings sightings spotters have not
--     yet been told about;
--   * the trigger set is hold_trigger_sightings (a pending hold's sightings
--     count past 14 days).
-- The status checks, ATTESTATION_STALE, the delist and the push copy are the
-- originals.
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
  v_payment  uuid;
  v_hold_id      uuid;
  v_hold_system  boolean;
  v_hold_expires timestamptz;
  v_hold_ids     uuid[];
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

  -- The reward this exit is about: the post's held reward (one at most).
  select id into v_payment
    from public.payments
   where post_id = p_post_id and status = 'held' and kind = 'bounty_escrow';

  if v_payment is not null then
    select id, system_initiated, expires_at, sighting_ids
      into v_hold_id, v_hold_system, v_hold_expires, v_hold_ids
      from public.refund_holds where payment_id = v_payment;
  end if;

  -- IDEMPOTENCY FIRST, before any status check: the hold itself changes the
  -- post's status (deactivate delists it below), so a retry after a dropped
  -- response arrives with a post that no longer passes the entry checks. The
  -- existing OWNER hold IS the answer — and it sends nothing (already
  -- claimed). A SYSTEM hold is not an answer: it is upgraded below.
  if v_hold_id is not null and not v_hold_system then
    return jsonb_build_object('held', true, 'expiresAt', v_hold_expires, 'notify', '[]'::jsonb);
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
  v_recent := public.hold_trigger_sightings(p_post_id);

  if cardinality(v_recent) = 0 then
    -- The caller should have refunded immediately. Fail loudly: silently
    -- holding a refund nothing requires would strand the owner's money.
    raise exception 'NO_HOLD_REQUIRED';
  end if;
  if not (v_recent <@ p_attested_ids) then
    raise exception 'ATTESTATION_STALE';
  end if;

  -- A hold holds a payment: with no held reward there is nothing to hold.
  -- (Checked after the refusals above so their order is the original's.)
  if v_payment is null then
    raise exception 'POST_NOT_REFUNDABLE';
  end if;

  if v_hold_id is not null then
    -- UPGRADE the pending system hold into this owner exit. Spotters already
    -- told keep their window; a sighting they were not told about restarts
    -- it at 72 hours (it is pushed below).
    v_expires := case
                   when v_recent <@ v_hold_ids then v_hold_expires
                   else greatest(v_hold_expires, now() + interval '72 hours')
                 end;
    update public.refund_holds
       set exit_path        = p_exit_path,
           system_initiated = false,
           attested_at      = now(),
           owner_id         = p_owner_id,
           sighting_ids     = (select array_agg(distinct x) from unnest(v_hold_ids || v_recent) as x),
           expires_at       = v_expires
     where id = v_hold_id;
  else
    v_expires := now() + interval '72 hours';

    -- Idempotent: a retry after a dropped response falls through to the
    -- existing hold (and sends nothing — the pushes below were already claimed).
    insert into public.refund_holds (post_id, payment_id, owner_id, exit_path, sighting_ids, expires_at)
    values (p_post_id, v_payment, p_owner_id, p_exit_path, v_recent, v_expires)
    on conflict (payment_id) do nothing
    returning id into v_inserted;

    if v_inserted is null then
      select expires_at into v_expires from public.refund_holds where payment_id = v_payment;
      return jsonb_build_object('held', true, 'expiresAt', v_expires, 'notify', '[]'::jsonb);
    end if;
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
  -- name — the spotter knows which sighting was theirs. A spotter a system
  -- hold already told is already claimed, and is not told twice.
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
           -- ⚠️ THE 72 HOURS STAYS IN WORDS. This push is the only door to
           -- /sighting-dispute, so the deadline is a money right, not a detail.
           'body', 'A car you sighted closed without crediting anyone. You have 72 hours to tell us if it was yours.'
         )), '[]'::jsonb)
    into v_notify
    from claimed;

  return jsonb_build_object('held', true, 'expiresAt', v_expires, 'notify', v_notify);
end $$;

comment on function public.create_refund_hold(uuid, uuid, text, uuid[]) is
  'The atomic moment an attested exit is accepted. SERVICE ROLE ONLY (the Edge Functions pass the owner they verified). The hold belongs to the post''s CURRENT held reward (one per payment, 20261006130000). Idempotent on that payment''s owner hold (checked before status, since the hold delists). A pending SYSTEM hold (the expiry''s) is UPGRADED into the owner''s exit — attested, sightings widened, window kept (or restarted at 72h for sightings spotters were not yet told about), deactivate still delists. Recomputes the trigger set (hold_trigger_sightings) under the post lock: ATTESTATION_STALE if the owner did not see all of it; NO_HOLD_REQUIRED if empty. Claims + returns the closed_uncredited pushes (no car, no plate, no owner).';

revoke execute on function public.create_refund_hold(uuid, uuid, text, uuid[]) from public, anon, authenticated;
grant  execute on function public.create_refund_hold(uuid, uuid, text, uuid[]) to service_role;


-- =============================================================================
-- 4f. open_dispute — the hold of the payment still held
-- =============================================================================
-- ⚠️ RESTATED IN FULL from 20260814100000. The ONLY change: the hold joins
-- its OWN payment (p.id = h.payment_id), so a settled hold on an earlier
-- reward can never open a dispute against the current one.
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
    join public.payments p on p.id = h.payment_id and p.status = 'held'
   where s.id = p_sighting_id
     and s.spotter_id = v_caller
     and s.status <> 'credited'
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
  'Spotter files "my sighting led to this recovery" on a held refund. All gates (own sighting, NOT credited, listed in the hold, window open, the hold''s OWN payment still held) in one predicate behind the single token DISPUTE_NOT_AVAILABLE — replays included. A sighting the owner marked not_mine is still disputable: the owner''s opinion is the thing under dispute. One dispute per sighting (unique). Fail-closed.';

revoke all on function public.open_dispute(uuid, text) from public, anon;
grant execute on function public.open_dispute(uuid, text) to authenticated, service_role;


-- =============================================================================
-- 4g. my_dispute_context — the latest hold naming the sighting, + reason
-- =============================================================================
-- ⚠️ RESTATED IN FULL from 20260805100000. What changes: the hold is the
-- LATEST one naming this sighting (a post can now have several), its payment
-- is read through payment_id, and the screen is told WHY ('reason': the
-- hold's exit_path) — a reward that ended leaves the listing up, and "the
-- listing closed" would be false.
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

  select h.expires_at, h.exit_path, po.make, po.colour, pay.amount_pence,
         d.status as dispute_status, d.created_at as dispute_created_at
    into v_row
    from public.sightings s
    join lateral (
      select hh.expires_at, hh.exit_path, hh.payment_id
        from public.refund_holds hh
       where hh.post_id = s.post_id
         and s.id = any (hh.sighting_ids)
       order by hh.created_at desc
       limit 1
    ) h on true
    join public.posts po on po.id = s.post_id
    left join public.payments pay on pay.id = h.payment_id and pay.status = 'held'
    left join public.refund_disputes d on d.sighting_id = s.id
   where s.id = p_sighting_id
     and s.spotter_id = v_caller;

  if not found then
    raise exception 'DISPUTE_NOT_AVAILABLE';
  end if;

  if v_row.amount_pence is not null then
    select transfer_pence into v_share from public.payout_split(v_row.amount_pence);
  end if;

  return jsonb_build_object(
    'car', jsonb_build_object('make', v_row.make, 'colour', v_row.colour),
    'windowEndsAt', v_row.expires_at,
    -- Why the money is moving: deactivate | recovery | reward_end. The
    -- screen words a reward_end ("the reward is ending") differently from
    -- an owner's exit ("the listing closed").
    'reason', v_row.exit_path,
    'bountySharePence', v_share,
    'dispute', case when v_row.dispute_status is null then null
      else jsonb_build_object('status', v_row.dispute_status, 'createdAt', v_row.dispute_created_at)
    end
  );
end $$;

comment on function public.my_dispute_context(uuid) is
  'The dispute screen''s read: own sighting named by a hold (the LATEST such hold). Car make/colour (what the spotter already saw), deadline, reason (the hold''s exit_path — reward_end means the listing is still up), their dispute if any, and the payout_split share (null once the money moved). No owner identity, no location, no plate. Single refusal token.';

revoke all on function public.my_dispute_context(uuid) from public, anon;
grant execute on function public.my_dispute_context(uuid) to authenticated, service_role;


-- =============================================================================
-- 4h. my_sighting_record — the latest hold naming the sighting
-- =============================================================================
-- ⚠️ RESTATED IN FULL from 20260903110000. The ONLY change: the hold join is
-- the LATEST hold naming the sighting (a lateral), so a post with two holds
-- cannot duplicate a report row.
create or replace function public.my_sighting_record()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_caller uuid := auth.uid();
  v_rows   jsonb;
begin
  if v_caller is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select coalesce(jsonb_agg(r order by r.created_at desc), '[]'::jsonb)
    into v_rows
  from (
    select s.id,
           -- ⚠️ THE POST ID, AND ONLY WHILE THE POST IS ACTIVE (2026-09-03,
           -- review finding #16). My reports showed a verdict and offered
           -- nowhere to go; this is what makes the card openable.
           --
           -- The NULL branch is the privacy rule, unchanged: a closed post is
           -- invisible to a spotter, which is why closed_uncredited routes to
           -- the dispute screen rather than the post. Emitting the id only for
           -- an ACTIVE post gives away nothing — an active post is public and
           -- anon-readable, so the spotter could already reach it by searching.
           -- The wall stays exactly where it was for every closed listing.
           case when p.status = 'active' then s.post_id end as post_id,
           s.created_at,
           s.status,
           s.reviewed_at,
           s.area_label,
           -- Bounded at the source. This RPC hands owner-supplied text to a
           -- DIFFERENT user (the spotter); unbounded, one owner's 4 KB "make"
           -- bloats every row of that spotter's history.
           jsonb_build_object(
             'make',   left(coalesce(nullif(btrim(p.make),   ''), ''), 32),
             'colour', left(coalesce(nullif(btrim(p.colour), ''), ''), 32)
           ) as car,
           -- The door. `available` is exactly my_dispute_context's gate: a hold
           -- on this post that NAMES this sighting. h.expires_at is null
           -- whenever no such hold exists, which is the ordinary case for
           -- almost every report ever filed.
           jsonb_build_object(
             'available',       h.expires_at is not null,
             'status',          d.status,
             'window_ends_at',  h.expires_at
           ) as dispute
      from public.sightings s
      join public.posts p on p.id = s.post_id
      -- ⚠️ THE `s.id = any (hh.sighting_ids)` PREDICATE IS LOAD-BEARING. A hold
      -- covers a payment and names the sightings it was raised over; a spotter
      -- whose sighting is not in that array cannot dispute, and
      -- my_dispute_context refuses them. Joining on post_id alone would light
      -- the door for reports that cannot open it. LATEST hold only (a post
      -- can have several since 20261006130000): one row per report.
      left join lateral (
        select hh.expires_at
          from public.refund_holds hh
         where hh.post_id = s.post_id
           and s.id = any (hh.sighting_ids)
         order by hh.created_at desc
         limit 1
      ) h on true
      -- Their OWN dispute. The spotter predicate is REDUNDANT today and kept
      -- deliberately: `where s.spotter_id = v_caller` below already restricts
      -- this to the caller's sightings, and refund_disputes.sighting_id is
      -- UNIQUE, so there is no second dispute to reach. It is here so that
      -- loosening either of those — a shared-sighting model, a re-file after
      -- rejection — cannot silently turn this join into another user's row.
      left join public.refund_disputes d
             on d.sighting_id = s.id
            and d.spotter_id = v_caller
     where s.spotter_id = v_caller
  ) as r;

  return jsonb_build_object('sightings', v_rows);
end;
$$;

revoke all on function public.my_sighting_record() from public, anon;
grant execute on function public.my_sighting_record() to authenticated, service_role;


-- =============================================================================
-- 4i. resolve_sighting_dispute — a live listing's reward_end may be resolved
-- =============================================================================
-- ⚠️ RESTATED IN FULL from 20260805100000. What changes: NO_HOLD now means
-- "no PENDING hold" (a hold whose payment is still held — a settled hold on
-- an earlier reward can resurrect nothing), and a LIVE post may be resolved:
-- a reward_end hold's listing never closed. Upheld still credits, moves the
-- post to recovery_claimed, and lets the release-payout core pay unchanged.
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
  if not exists (
    select 1 from public.refund_holds h
      join public.payments p on p.id = h.payment_id and p.status = 'held'
     where h.post_id = v_d.post_id
  ) then
    -- Only a post with a PENDING hold may be resurrected — this function must
    -- never turn an ordinary old cancelled post back into a live recovery.
    raise exception 'NO_HOLD';
  end if;
  if v_status not in ('cancelled', 'recovery_claimed', 'active', 'pending_verification') then
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
  'v1 dispute resolution, run BY HAND (service role). Rejected: stamp and stop — the sweep then refunds the owner. Upheld: credit the sighting directly, mirroring claim_recovery (single-winner index backstop, counter, no self-credit), move the post to recovery_claimed, auto-reject sibling open disputes; the existing release-payout core pays the spotter unchanged. Only a post with a PENDING hold (its payment still held) can be resolved — including a LIVE post whose reward_end hold is running (20261006130000).';

revoke all on function public.resolve_sighting_dispute(uuid, boolean) from public, anon, authenticated;
grant execute on function public.resolve_sighting_dispute(uuid, boolean) to service_role;


-- =============================================================================
-- 4j. delete_cancelled_post — the snapshot carries every hold
-- =============================================================================
-- ⚠️ RESTATED IN FULL from 20261005110000. The ONLY change: the snapshot's
-- refund_hold (a scalar subquery — it would raise once a post has two holds)
-- becomes the LATEST hold, and 'refund_holds' carries them all.
create or replace function public.delete_cancelled_post(
  p_post_id              uuid,
  p_owner_id             uuid,
  p_cancelled_intent_ids text[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post     public.posts%rowtype;
  v_snapshot jsonb;
  v_stray    text;
begin
  if p_owner_id is null then
    raise exception 'NOT_OWNER';
  end if;

  -- Lock first: every guard below is decided against state that cannot move
  -- until this transaction ends. record_post_payment_intent takes this same
  -- lock before writing a ledger row, so a row created mid-delete waits; and
  -- the refund path's own posts update queues behind this FOR UPDATE, so the
  -- guards below always read the ledger as of a settled moment, never halfway
  -- through a transition.
  select * into v_post
  from public.posts
  where id = p_post_id
  for update;

  -- Same answer for "no such post" and "not yours" — a post id must never be
  -- an existence oracle.
  if not found or v_post.owner_id is distinct from p_owner_id then
    raise exception 'NOT_OWNER';
  end if;

  if v_post.status <> 'cancelled' then
    raise exception 'NOT_CANCELLED';
  end if;

  -- Escrow still held — a refund hold mid-window, or a refund mid-flight —
  -- or a superseded payment still owed back to the owner.
  if exists (
    select 1 from public.payments
    where post_id = p_post_id
      and status in ('held', 'superseded')
  ) then
    raise exception 'MONEY_IN_FLIGHT';
  end if;

  -- The 72-hour dispute window is still open: the sightings a dispute would
  -- cite cascade from this post, so deleting now destroys the evidence.
  if exists (
    select 1 from public.refund_holds
    where post_id = p_post_id
      and expires_at > now()
  ) then
    raise exception 'MONEY_IN_FLIGHT';
  end if;

  if exists (
    select 1 from public.refund_disputes
    where post_id = p_post_id
      and status in ('open', 'upheld')
  ) then
    raise exception 'DISPUTE_OPEN';
  end if;

  -- Only an UNRESOLVED review blocks. A 'rejected' resolution keeps the
  -- escrow held, so those posts already refused above; an 'approved' one is
  -- finished business and is archived below.
  if exists (
    select 1 from public.payout_reviews
    where post_id = p_post_id
      and resolved_at is null
  ) then
    raise exception 'PAYMENT_REVIEW_OPEN';
  end if;

  -- ⚠️ THE PROOF, copied from delete_draft_post (20260816110000) — read that
  -- header before touching this. Every ledger row where money never moved
  -- ('requires_payment' or 'failed') must name an intent the caller has seen
  -- `canceled` at Stripe; one it never looked at — written after its read, or
  -- skipped as 'failed' — is not in the list, and the delete does not happen.
  -- NULL-SAFE both ways: coalesce on the array ("proved nothing", not "match
  -- everything") and array_remove(..., null) + exists on the elements (one
  -- null element would otherwise mark EVERY row proved).
  select pay.stripe_payment_intent_id into v_stray
  from public.payments pay
  where pay.post_id = p_post_id
    and pay.status in ('requires_payment', 'failed')
    and not exists (
      select 1
      from unnest(array_remove(coalesce(p_cancelled_intent_ids, '{}'), null)) as proved(id)
      where proved.id = pay.stripe_payment_intent_id
    )
  limit 1;

  if v_stray is not null then
    raise exception 'INTENT_NOT_CANCELLED';
  end if;

  -- What the ledger rows keep of the post they are about to lose. The settled
  -- hold/dispute/review rows ride along because they are deleted below and
  -- this is their only afterlife.
  v_snapshot := jsonb_build_object(
    'post_id',         v_post.id,
    'owner_id',        v_post.owner_id,
    'plate',           v_post.plate,
    'make',            v_post.make,
    'model',           v_post.model,
    'colour',          v_post.colour,
    'post_status',     v_post.status,
    'post_created_at', v_post.created_at,
    'post_closed_at',  v_post.closed_at,
    'post_deleted_at', now(),
    'refund_hold',     (select to_jsonb(h) from public.refund_holds h where h.post_id = p_post_id
                         order by h.created_at desc limit 1),
    'refund_holds',    (select jsonb_agg(to_jsonb(h) order by h.created_at) from public.refund_holds h
                         where h.post_id = p_post_id),
    'refund_disputes', (select jsonb_agg(to_jsonb(d)) from public.refund_disputes d where d.post_id = p_post_id),
    'payout_review',   (select to_jsonb(r) from public.payout_reviews r where r.post_id = p_post_id)
  );

  -- Money that never moved, on intents verifiably dead at Stripe: delete,
  -- exactly as delete_draft_post does. There is nothing left that could
  -- capture, so there is nothing a webhook could need this row for.
  delete from public.payments
   where post_id = p_post_id
     and status in ('requires_payment', 'failed');

  -- Money that moved: detach, never delete. Every row left is terminal
  -- (released / refunded / collected), so no state change can ever need to
  -- reach a post through it again — intent-id lookups still find it.
  update public.payments
     set post_id       = null,
         post_snapshot = v_snapshot
   where post_id = p_post_id;

  -- Disputes FIRST: refund_disputes.sighting_id references sightings WITHOUT
  -- cascade, so a surviving dispute row would veto the sightings cascade and
  -- fail the post delete below with a raw FK error. The resolved payout
  -- review must go for the same reason — its FK is ON DELETE RESTRICT.
  delete from public.refund_disputes where post_id = p_post_id;
  delete from public.refund_holds    where post_id = p_post_id;
  delete from public.payout_reviews  where post_id = p_post_id;

  -- Everything else cascades: photos (their triggers queue the storage paths
  -- for the sweep), sightings, chats, watchlist rows, flags, structured data.
  delete from public.posts where id = p_post_id;
end;
$$;

revoke execute on function public.delete_cancelled_post(uuid, uuid, text[]) from public, anon, authenticated;
grant  execute on function public.delete_cancelled_post(uuid, uuid, text[]) to service_role;


-- =============================================================================
-- 5. claim_reward_expiries — the expiry's claim (service role)
-- =============================================================================
-- For each held reward past its term, ONE PAYMENT AT A TIME, post locked
-- first (the money lock order), every condition re-checked under the lock:
--   * held, a bounty, past term_ends_at, not already claimed;
--   * the listing is LIVE (reward_end) — or recovery_claimed with no credited
--     sighting (a stale "found it another way", finished as that refund);
--   * no claim on the money (reward_has_claim: a pending hold, an open or
--     upheld dispute, a credited sighting, a payout review) — those decide
--     where the money goes, not a clock (the 75-day ops alert watches them);
--   * no reward change in flight (an intent made in the last hour for the
--     owner's current choice) — renewing at the last minute must win.
-- Then: stamp expiry_claimed_at; fix the refund basis ON THE PAYMENT
-- (refund_fee_absorbed := legacy_term — a reward from before the term comes
-- back in full, ADR-0020 point 5); create the SYSTEM hold over the trigger
-- set (window 72h if any sightings, else due now); claim + build the pushes.
create or replace function public.claim_reward_expiries(p_limit integer default 50)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_window   constant interval := interval '72 hours';
  c_inflight constant interval := interval '1 hour';
  v_cand     record;
  v_post     record;
  v_pay      record;
  v_path     text;
  v_recent   uuid[];
  v_expires  timestamptz;
  v_back     integer;
  v_notify   jsonb;
  v_owner    jsonb;
  v_out      jsonb := '[]'::jsonb;
begin
  for v_cand in
    select p.id as payment_id, p.post_id
      from public.payments p
     where p.status = 'held'
       and p.kind = 'bounty_escrow'
       and p.term_ends_at is not null
       and p.term_ends_at < now()
       and p.expiry_claimed_at is null
       and p.post_id is not null
     order by p.term_ends_at
     limit greatest(coalesce(p_limit, 50), 0)
  loop
    -- THE POST FIRST, then the payment (every money RPC's lock order).
    select id, owner_id, status, make, model, colour into v_post
      from public.posts where id = v_cand.post_id for update;
    select id, amount_pence, term_ends_at, legacy_term, refund_fee_absorbed,
           status, expiry_claimed_at
      into v_pay
      from public.payments where id = v_cand.payment_id for update;

    -- Re-check everything under the locks; anything off is skipped (and
    -- reconsidered next run if it is still a candidate).
    continue when v_pay.status <> 'held'
               or v_pay.expiry_claimed_at is not null
               or v_pay.term_ends_at >= now();

    if v_post.status in ('active', 'pending_verification') then
      v_path := 'reward_end';
    elsif v_post.status = 'recovery_claimed'
          and not exists (select 1 from public.sightings
                           where post_id = v_post.id and status = 'credited') then
      v_path := 'recovery';
    else
      continue;
    end if;

    continue when public.reward_has_claim(v_post.id);
    continue when exists (
      select 1 from public.payments r
       where r.post_id = v_post.id
         and r.kind = 'bounty_escrow'
         and r.status = 'requires_payment'
         and r.renewal_attempt_id is not null
         and r.created_at > now() - c_inflight
    );

    v_recent := public.hold_trigger_sightings(v_post.id);
    v_expires := case when cardinality(v_recent) > 0 then now() + c_window else now() end;

    update public.payments
       set expiry_claimed_at   = now(),
           refund_fee_absorbed = refund_fee_absorbed or legacy_term
     where id = v_pay.id;

    insert into public.refund_holds
      (post_id, payment_id, owner_id, exit_path, system_initiated, attested_at, sighting_ids, expires_at)
    values
      (v_post.id, v_pay.id, v_post.owner_id, v_path, true, null, v_recent, v_expires);

    -- The spotters: told the reward is ending (or, for a stale recovery, the
    -- usual "closed without crediting") and given the dispute door. Claimed
    -- here; a spotter already told is not told twice. No car, no plate.
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
             -- ⚠️ THE 72 HOURS STAYS IN WORDS (as create_refund_hold's).
             'body', case when v_path = 'reward_end'
                       then 'The reward on a car you sighted is ending. If your sighting led to it being found, you have 72 hours to tell us.'
                       else 'A car you sighted closed without crediting anyone. You have 72 hours to tell us if it was yours.'
                     end
           )), '[]'::jsonb)
      into v_notify
      from claimed;

    -- The owner (reward_end only — a stale recovery is the refund they asked
    -- for). The figure is EXACT (ADR-0021): in full for a reward from before
    -- the term, else the reward minus the fixed card fee.
    v_owner := null;
    if v_path = 'reward_end' then
      v_back := case when v_pay.refund_fee_absorbed or v_pay.legacy_term
                     then v_pay.amount_pence
                     else v_pay.amount_pence - public.card_fee_pence(v_pay.amount_pence) end;
      v_owner := jsonb_build_object(
        'user_id', v_post.owner_id,
        'title',   'Your reward has ended',
        'body',    '£' || case when v_back % 100 = 0
                             then to_char(v_back / 100, 'FM999,999')
                             else to_char(v_back / 100.0, 'FM999,999.00') end
                   || ' is going back to your card'
                   || case when cardinality(v_recent) > 0
                        then ' after ' || to_char(v_expires at time zone 'Europe/London', 'FMDD FMMonth')
                        else '' end
                   || '. Your listing stays up — you can add a new reward any time.'
      );
    end if;

    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'post_id', v_post.id,
      'path',    v_path,
      'owner',   v_owner,
      'spotters', v_notify
    ));
  end loop;

  return v_out;
end $$;

comment on function public.claim_reward_expiries(integer) is
  'The expiry''s claim (ADR-0020, PR5). For each held reward past term_ends_at, post then payment locked, everything re-checked: a LIVE listing (reward_end) or a stale recovery_claimed with no credited sighting (finished as that recovery refund); no claim on the money (reward_has_claim); no reward change in flight (an intent in the last hour). Stamps expiry_claimed_at, sets refund_fee_absorbed for a legacy_term reward (its end-of-term refund is in full — fixed on the payment so every refund path asks for the same amount), and creates the SYSTEM hold over hold_trigger_sightings (72h window if any, else due now). Moves no money: the sweep''s refund phase does (refunds_due). Returns [{post_id, path, owner: {user_id,title,body}|null, spotters: [{user_id,sighting_id,title,body}]}] — claimed, so a replay sends nothing. SERVICE ROLE ONLY; the sweep calls it only when REWARD_EXPIRY_ENABLED=true.';

revoke all on function public.claim_reward_expiries(integer) from public, anon, authenticated;
grant execute on function public.claim_reward_expiries(integer) to service_role;


-- =============================================================================
-- 6a. mark_reward_ended_refunded — the terminal record of a lapse
-- =============================================================================
-- The reward_end twin of mark_post_payment_refunded: the payment moves held ->
-- refunded, and the LISTING STAYS UP with "Reward ended" (PR4): the bounty
-- clears and reward_ended_at / ended_reward_pence are stamped in the SAME
-- statement (the pair CHECK holds them together). Guarded on 'held' — a
-- duplicate, or any later state, is never regressed.
create or replace function public.mark_reward_ended_refunded(
  p_payment_intent_id     text,
  p_refund_id             text,
  p_refunded_amount_pence integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post_id uuid;
  v_amount  integer;
  v_moved   integer;
begin
  select post_id into v_post_id
    from public.payments
   where stripe_payment_intent_id = p_payment_intent_id;

  if not found then
    return;
  end if;

  if v_post_id is not null then
    perform 1 from public.posts where id = v_post_id for update;
  end if;

  update public.payments
     set status                = 'refunded',
         stripe_refund_id      = p_refund_id,
         refunded_amount_pence = p_refunded_amount_pence
   where stripe_payment_intent_id = p_payment_intent_id
     and status = 'held'
  returning amount_pence into v_amount;
  get diagnostics v_moved = row_count;

  if v_moved = 0 or v_post_id is null then
    return;
  end if;

  -- The listing stays up, without a reward, saying so. Only a live listing
  -- (an owner exit during the window upgraded the hold away from reward_end,
  -- so a closed post is never reached here — guarded anyway).
  update public.posts
     set bounty_amount_pence  = null,
         reward_ended_at      = now(),
         ended_reward_pence   = v_amount,
         renewal_amount_pence = null,
         renewal_attempt_id   = null
   where id = v_post_id
     and status in ('active', 'pending_verification');
end $$;

comment on function public.mark_reward_ended_refunded(text, text, integer) is
  'Records the refund of a reward that ended at its term (ADR-0020): payment held -> refunded (guarded, never regressed), and the live listing''s bounty cleared with reward_ended_at + ended_reward_pence stamped together — it stays up as "Reward ended". SERVICE ROLE ONLY (the sweep; reconcile_payment_refund for a webhook that lands first).';

revoke all on function public.mark_reward_ended_refunded(text, text, integer) from public, anon, authenticated;
grant execute on function public.mark_reward_ended_refunded(text, text, integer) to service_role;


-- =============================================================================
-- 6b. reconcile_payment_refund — a reward_end refund never cancels a listing
-- =============================================================================
-- ⚠️ RESTATED IN FULL from 20261005110000. The ONLY change: before the
-- default branch, a held payment whose PENDING hold is a reward_end goes to
-- mark_reward_ended_refunded. Without it a charge.refunded webhook landing
-- before the sweep's own record would CANCEL the live listing.
create or replace function public.reconcile_payment_refund(
  p_payment_intent_id     text,
  p_refund_id             text,
  p_refunded_amount_pence integer
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post_id     uuid;
  v_post_status public.post_status;
  v_status      public.payment_status;
  v_payment_id  uuid;
begin
  select post_id into v_post_id
    from public.payments
   where stripe_payment_intent_id = p_payment_intent_id;

  if not found then
    return 'unknown';
  end if;

  if v_post_id is not null then
    select status into v_post_status
      from public.posts where id = v_post_id
       for update;
  end if;

  select status into v_status
    from public.payments
   where stripe_payment_intent_id = p_payment_intent_id
     for update;

  if not found then
    return 'unknown';
  end if;

  select id into v_payment_id
    from public.payments
   where stripe_payment_intent_id = p_payment_intent_id;

  if v_status = 'superseded' then
    update public.payments
       set status                = 'refunded',
           stripe_refund_id      = coalesce(p_refund_id, stripe_refund_id),
           refunded_amount_pence = p_refunded_amount_pence
     where stripe_payment_intent_id = p_payment_intent_id
       and status = 'superseded';
    return 'superseded_refunded';
  end if;

  if v_status is distinct from 'held' then
    return 'no_change';
  end if;

  -- A reward that ENDED: the listing stays up as "Reward ended".
  if exists (
    select 1 from public.refund_holds
     where payment_id = v_payment_id and exit_path = 'reward_end'
  ) then
    perform public.mark_reward_ended_refunded(
      p_payment_intent_id, p_refund_id, p_refunded_amount_pence);
    return 'reward_ended';
  end if;

  if v_post_status = 'recovery_claimed' then
    if exists (
      select 1 from public.sightings
       where post_id = v_post_id and status = 'credited'
    ) then
      -- A refund of money a credited spotter is owed — only ever issued by
      -- hand from the Stripe dashboard (no code path refunds a credited
      -- recovery). The money has moved, so the ledger must say so; but no
      -- terminal post state is honest here (recovered = the spotter was paid;
      -- recovered_no_spotter = nobody was credited), so the post is left as
      -- it is and the webhook alerts a person to settle it with the spotter.
      update public.payments
         set status                = 'refunded',
             stripe_refund_id      = p_refund_id,
             refunded_amount_pence = p_refunded_amount_pence
       where stripe_payment_intent_id = p_payment_intent_id
         and status = 'held';
      return 'refunded_with_credited_sighting';
    end if;
    perform public.mark_post_recovered_no_spotter(
      p_payment_intent_id, p_refund_id, p_refunded_amount_pence);
    return 'recovered_no_spotter';
  end if;

  perform public.mark_post_payment_refunded(
    p_payment_intent_id, p_refund_id, p_refunded_amount_pence);
  return 'refunded';
end $$;

revoke all on function public.reconcile_payment_refund(text, text, integer) from public, anon, authenticated;
grant execute on function public.reconcile_payment_refund(text, text, integer) to service_role;


-- =============================================================================
-- 7. Assert the grants
-- =============================================================================
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.claim_reward_expiries(integer)',
    'public.mark_reward_ended_refunded(text, text, integer)',
    'public.reconcile_payment_refund(text, text, integer)',
    'public.refunds_due(integer, uuid)',
    'public.create_refund_hold(uuid, uuid, text, uuid[])',
    'public.exit_check_for(uuid, uuid)',
    'public.resolve_sighting_dispute(uuid, boolean)',
    'public.delete_cancelled_post(uuid, uuid, text[])'
  ] loop
    if has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute') then
      raise exception '% is client-executable — it moves or decides money', f;
    end if;
    if not has_function_privilege('service_role', f, 'execute') then
      raise exception '% is not executable by service_role — the sweep/webhook is broken', f;
    end if;
  end loop;
  foreach f in array array[
    'public.open_dispute(uuid, text)',
    'public.my_dispute_context(uuid)',
    'public.my_sighting_record()'
  ] loop
    if has_function_privilege('anon', f, 'execute') or not has_function_privilege('authenticated', f, 'execute') then
      raise exception '% grants are wrong (signed-in only)', f;
    end if;
  end loop;
end $$;


-- =============================================================================
-- END OF MIGRATION
-- =============================================================================

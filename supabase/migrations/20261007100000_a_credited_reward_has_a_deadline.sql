-- =============================================================================
-- WHAT:  A credited reward has a PAYOUT DEADLINE (ADR-0020's last open money
--        case). A spotter credited for a recovery — by the owner, or by
--        winning a dispute — who never finishes setting up payouts gets two
--        reminders, and at the deadline the reward goes back to the owner IN
--        FULL. The listing closes as recovered_no_spotter; the spotter's
--        credit stays on their record.
--          1. payments: payout_reminded_7d_at / _2d_at, payout_started_at,
--             payout_lapse_claimed_at.
--          2. payout_deadline(payment) — capture + 80 days, or 7 days after
--             the credit if later; never past capture + 85.
--          3. Kinds payout_reminder (→ /payouts) and payout_lapsed (→ the
--             spotter's own record), both UNMUTABLE.
--          4. claim_payout_reminders — 7 and 2 days before the deadline.
--          5. begin_payout — the payout core stamps payout_started_at UNDER
--             THE POST LOCK before it creates a transfer, and is refused once
--             a lapse is claimed.
--          6. payouts_past_deadline (read) + claim_payout_lapse (per post,
--             locked): the refund basis is fixed in full on the payment.
--          7. mark_payout_lapsed_refunded — the terminal record.
--          8. reconcile_payment_refund — a lapse refund the webhook sees
--             first is recorded as the lapse (not as a hand refund of a
--             credited spotter's money, which alerts the operator).
-- WHY:   Stripe caps funds on the platform balance at 90 days (2026-10-05).
--        A credited spotter who never onboards strands the reward: it cannot
--        be paid and, until now, nothing ever returned it. The owner's
--        decisions (2026-10-07): refund the owner IN FULL (they did nothing
--        wrong), give a late-credited spotter AT LEAST 7 days, and close the
--        listing as recovered_no_spotter (what the manual runbook already did).
--
-- MONEY — THE ONE RACE THAT MATTERS: the spotter finishes onboarding at the
--        moment the deadline refund runs, and BOTH the payout and the refund
--        go out. Closed three ways:
--          * the sweep tries the PAYOUT FIRST (releasePayoutForPost) — a
--            spotter who just became payable is paid, not refunded;
--          * begin_payout and claim_payout_lapse take the SAME post lock:
--            a transfer cannot start after a lapse is claimed, and a lapse
--            cannot be claimed within an hour of a transfer starting;
--          * before refunding, the sweep asks Stripe for any transfer in the
--            post's transfer_group and refuses (operator alert) if one exists.
--
-- ⚠️ GATED IN THE SWEEP (PAYOUT_DEADLINE_ENABLED, default off): the spotter
--        Terms line ships in the app; nothing is enforced before it can be
--        read. Deploying this changes nothing a user sees.
--
-- SAFETY NOTE ON DESTRUCTIVE STATEMENTS: none dropped except the two kind
--        CHECKs, dropped and re-added WIDER (every existing kind kept —
--        asserted). Four additive nullable columns. `create or replace` on
--        ONE existing function (reconcile_payment_refund, restated IN FULL
--        from 20261006130000, extracted mechanically); eight new ones
--        (pounds_text, payout_deadline, payout_awaiting_payee,
--        claim_payout_reminders, begin_payout, payouts_past_deadline,
--        claim_payout_lapse, mark_payout_lapsed_refunded).
-- LINKS: docs/decisions/ADR-0020-a-reward-has-a-term.md;
--        supabase/functions/_shared/releasePayout.ts (begin_payout);
--        supabase/functions/release-held-refunds/index.ts (the deadline phase);
--        supabase/tests/payout_deadline_verification.sql.
-- =============================================================================


-- =============================================================================
-- 1. Columns
-- =============================================================================
alter table public.payments
  add column payout_reminded_7d_at   timestamptz,
  add column payout_reminded_2d_at   timestamptz,
  add column payout_started_at       timestamptz,
  add column payout_lapse_claimed_at timestamptz;

comment on column public.payments.payout_started_at is
  'When the payout core (begin_payout) last began a transfer for this reward, under the post lock. A lapse cannot be claimed within an hour of it.';
comment on column public.payments.payout_lapse_claimed_at is
  'When the payout deadline claimed this reward for the owner (claim_payout_lapse): no payout may begin after it (begin_payout refuses), and its refund is in full.';


-- =============================================================================
-- 2. payout_deadline — when a credited reward goes back
-- =============================================================================
-- capture + 80 days, or 7 days after the credit (posts.recovered_at — stamped
-- by claim_recovery and by an upheld dispute) if that is later, run to the
-- end of its London day (reward_term_end), and never past capture + 85.
create or replace function public.payout_deadline(p_payment_id uuid)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select least(
           public.reward_term_end(greatest(
             coalesce(p.captured_at, p.created_at) + interval '80 days',
             coalesce(po.recovered_at, now()) + interval '7 days')),
           coalesce(p.captured_at, p.created_at) + interval '85 days')
    from public.payments p
    join public.posts po on po.id = p.post_id
   where p.id = p_payment_id;
$$;

comment on function public.payout_deadline(uuid) is
  'When a credited reward that has not been paid out goes back to its owner: the end of the London day of max(capture + 80d, credit + 7d), never past capture + 85d (Stripe''s 90-day limit). Not directly grantable.';

revoke all on function public.payout_deadline(uuid) from public, anon, authenticated;


-- =============================================================================
-- 3. Kinds — payout_reminder, payout_lapsed (both unmutable)
-- =============================================================================
-- notification_category needs no change: an unlisted kind falls to NULL —
-- UNMUTABLE, deliberately. A reminder that a reward is about to be lost, and
-- the notice that it was, must not be silenceable.
alter table public.notifications drop constraint notifications_kind_chk;
alter table public.notifications add constraint notifications_kind_chk
  check (kind in ('alert','sighting','message','recovery','credited',
                  'credited_no_reward','closed_uncredited','dispute_upheld',
                  'dispute_rejected','payout_sent','not_credited',
                  'sighting_confirmed','still_missing','deletion_soon',
                  'reward_ending','reward_ended',
                  'payout_reminder','payout_lapsed'));

alter table public.push_sends drop constraint push_sends_kind_chk;
alter table public.push_sends add constraint push_sends_kind_chk
  check (kind in ('alert','sighting','message','recovery','credited',
                  'credited_no_reward','closed_uncredited','dispute_upheld',
                  'dispute_rejected','payout_sent','not_credited',
                  'sighting_confirmed','still_missing','deletion_soon',
                  'reward_ending','reward_ended',
                  'payout_reminder','payout_lapsed'));

comment on function public.notification_category(text) is
  'Maps a notification kind to its mutable preference category, or NULL when the kind may not be muted (sighting, closed_uncredited, still_missing, deletion_soon, reward_ending, reward_ended, payout_reminder, payout_lapsed) or is not yet classified. NULL always means "deliver". reward_ending / reward_ended are the notice a reward''s automatic refund must follow (ADR-0020); payout_reminder / payout_lapsed are the notice a credited spotter''s reward is about to go, and went, back to the owner.';


-- =============================================================================
-- Shared predicate: a credited reward awaiting a payee
-- =============================================================================
-- A held bounty on a recovery_claimed post with a credited sighting whose
-- spotter cannot be paid yet, and no payout review in progress (a review
-- decides by hand — collusion is not a clock's call).
create or replace function public.payout_awaiting_payee(p_payment_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
      from public.payments p
      join public.posts po on po.id = p.post_id and po.status = 'recovery_claimed'
      join public.sightings s on s.post_id = po.id and s.status = 'credited'
     where p.id = p_payment_id
       and p.status = 'held'
       and p.kind = 'bounty_escrow'
       and not exists (
         select 1 from public.stripe_connected_accounts a
          where a.profile_id = s.spotter_id and a.payouts_enabled
       )
       and not exists (
         select 1 from public.payout_reviews r
          where r.post_id = po.id and r.resolved_at is null
       )
  );
$$;

revoke all on function public.payout_awaiting_payee(uuid) from public, anon, authenticated;


-- =============================================================================
-- pounds_text — pence as push copy: '£190', '£196.80'
-- =============================================================================
create or replace function public.pounds_text(p_pence integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select '£' || case when p_pence % 100 = 0
                     then to_char(p_pence / 100, 'FM999,999')
                     else to_char(p_pence / 100.0, 'FM999,999.00') end;
$$;

comment on function public.pounds_text(integer) is
  'Integer pence as push copy, the app''s formatPounds in SQL: whole pounds drop the pence (£190), otherwise two places (£196.80). Display only.';

revoke all on function public.pounds_text(integer) from public, anon, authenticated;


-- =============================================================================
-- 4. claim_payout_reminders — 7 and 2 days before the deadline
-- =============================================================================
-- To the credited SPOTTER: the amount they would receive (payout_split) and
-- the date. Never within a day of the credit (the "You've earned" push just
-- went). Claim-before-send (conditional update): a replay sends nothing twice.
create or replace function public.claim_payout_reminders(p_limit integer default 100)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows jsonb;
begin
  with due as (
    -- RIPE rows only, so the limit can never be spent on rows that are not
    -- due yet and starve ones that are.
    select x.id, x.deadline, (x.deadline <= now() + interval '2 days') as last_days
      from (
        select p.id, public.payout_deadline(p.id) as deadline,
               p.payout_reminded_7d_at, p.payout_reminded_2d_at
          from public.payments p
          join public.posts po on po.id = p.post_id
         where p.status = 'held'
           and p.kind = 'bounty_escrow'
           and po.status = 'recovery_claimed'
           and po.recovered_at < now() - interval '1 day'
           and p.payout_lapse_claimed_at is null
           and (p.payout_reminded_7d_at is null or p.payout_reminded_2d_at is null)
           and public.payout_awaiting_payee(p.id)
      ) x
     where x.deadline > now()
       and x.deadline <= now() + interval '7 days'
       and ((x.deadline <= now() + interval '2 days' and x.payout_reminded_2d_at is null)
            or x.payout_reminded_7d_at is null)
     order by x.deadline
     limit greatest(coalesce(p_limit, 100), 0)
  ),
  claimed as (
    update public.payments pay
       set payout_reminded_7d_at = coalesce(pay.payout_reminded_7d_at, now()),
           payout_reminded_2d_at = case when due.last_days then coalesce(pay.payout_reminded_2d_at, now())
                                        else pay.payout_reminded_2d_at end
      from due
     where pay.id = due.id
       -- Re-checked inside the update: two concurrent sweeps cannot both send.
       and ((due.last_days and pay.payout_reminded_2d_at is null)
            or (not due.last_days and pay.payout_reminded_7d_at is null))
    returning pay.id, pay.post_id, pay.amount_pence, due.deadline, due.last_days
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'payment_id', c.id,
           'post_id',    c.post_id,
           'user_id',    s.spotter_id,
           'title',      case when c.last_days
                           then 'Last few days to claim your ' || public.pounds_text(sp.transfer_pence)
                           else 'Your ' || public.pounds_text(sp.transfer_pence) || ' reward is waiting'
                         end,
           'body',       'Add your bank details by '
                         || to_char(c.deadline at time zone 'Europe/London', 'FMDD FMMonth')
                         || case when c.last_days then ', or it goes back to the owner.' else ' to receive it.' end
         )), '[]'::jsonb)
    into v_rows
    from claimed c
    join public.sightings s on s.post_id = c.post_id and s.status = 'credited'
    cross join lateral public.payout_split(c.amount_pence) sp;

  return v_rows;
end $$;

comment on function public.claim_payout_reminders(integer) is
  'Claims the credited spotter''s payout reminders: 7 days and 2 days before payout_deadline (the 2-day one also burns the 7-day rung), only while the reward is held, the post recovery_claimed, the spotter not yet payable, no payout review open, and never within a day of the credit. Returns [{payment_id, post_id, user_id, title, body}] — the amount they would receive and the date; never the plate or the owner. Claim-before-send. SERVICE ROLE ONLY.';

revoke all on function public.claim_payout_reminders(integer) from public, anon, authenticated;
grant execute on function public.claim_payout_reminders(integer) to service_role;


-- =============================================================================
-- 5. begin_payout — a transfer may start only before a lapse is claimed
-- =============================================================================
create or replace function public.begin_payout(p_post_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment uuid;
  v_lapsed  timestamptz;
begin
  -- THE POST LOCK — the same one claim_payout_lapse takes.
  perform 1 from public.posts where id = p_post_id for update;

  select id, payout_lapse_claimed_at into v_payment, v_lapsed
    from public.payments
   where post_id = p_post_id and status = 'held' and kind = 'bounty_escrow'
     for update;

  if v_payment is null then
    raise exception 'NO_HELD_PAYMENT';
  end if;
  if v_lapsed is not null then
    raise exception 'PAYOUT_LAPSED';
  end if;

  update public.payments set payout_started_at = now() where id = v_payment;
end $$;

comment on function public.begin_payout(uuid) is
  'Called by the payout core immediately before it creates a Stripe transfer: under the post lock, refuses PAYOUT_LAPSED once the payout deadline has claimed the reward for the owner, else stamps payout_started_at (which keeps a lapse from being claimed for an hour). SERVICE ROLE ONLY.';

revoke all on function public.begin_payout(uuid) from public, anon, authenticated;
grant execute on function public.begin_payout(uuid) to service_role;


-- =============================================================================
-- 6. payouts_past_deadline + claim_payout_lapse
-- =============================================================================
-- The READ the sweep walks: credited rewards past their deadline, unclaimed.
-- It tries the payout first; only a reward still awaiting its payee is then
-- claimed (below), one post at a time, under the lock.
create or replace function public.payouts_past_deadline(p_limit integer default 20)
returns table (post_id uuid, payment_intent_id text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.post_id, p.stripe_payment_intent_id
    from public.payments p
   where p.status = 'held'
     and p.kind = 'bounty_escrow'
     and p.payout_lapse_claimed_at is null
     and p.post_id is not null
     and public.payout_awaiting_payee(p.id)
     and public.payout_deadline(p.id) < now()
   order by p.captured_at
   limit greatest(coalesce(p_limit, 20), 0);
$$;

revoke all on function public.payouts_past_deadline(integer) from public, anon, authenticated;
grant execute on function public.payouts_past_deadline(integer) to service_role;

create or replace function public.claim_payout_lapse(p_post_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post   record;
  v_pay    record;
  v_spot   record;
begin
  select id, owner_id into v_post from public.posts where id = p_post_id for update;
  select id, stripe_payment_intent_id, amount_pence, payout_started_at, payout_lapse_claimed_at
    into v_pay
    from public.payments
   where post_id = p_post_id and status = 'held' and kind = 'bounty_escrow'
     for update;

  -- Everything re-checked under the lock; any miss is "not now" (null).
  if v_pay.id is null or v_pay.payout_lapse_claimed_at is not null then
    return null;
  end if;
  if not public.payout_awaiting_payee(v_pay.id) or public.payout_deadline(v_pay.id) >= now() then
    return null;
  end if;
  -- A transfer began within the hour: let it land (or fail) first.
  if v_pay.payout_started_at is not null and v_pay.payout_started_at > now() - interval '1 hour' then
    return null;
  end if;

  -- The refund basis, fixed ON THE PAYMENT before any refund can start: in
  -- FULL (the owner's decision — they did nothing wrong).
  update public.payments
     set payout_lapse_claimed_at = now(),
         refund_fee_absorbed     = true
   where id = v_pay.id;

  select s.id, s.spotter_id into v_spot
    from public.sightings s
   where s.post_id = p_post_id and s.status = 'credited';

  return jsonb_build_object(
    'post_id',           p_post_id,
    'payment_intent_id', v_pay.stripe_payment_intent_id,
    -- Sent only AFTER the refund is recorded (the sweep's job).
    'spotter', jsonb_build_object(
      'user_id',     v_spot.spotter_id,
      'sighting_id', v_spot.id,
      'title',       'We couldn''t send your reward',
      'body',        'Your bank details weren''t added in time, so the reward went back to the owner. Your recovery still counts on your record.'
    ),
    'owner', jsonb_build_object(
      'user_id', v_post.owner_id,
      'title',   'Your reward is coming back to you',
      'body',    'The spotter you credited didn''t set up payouts in time, so your full '
                 || public.pounds_text(v_pay.amount_pence)
                 || ' is going back to your card.'
    )
  );
end $$;

comment on function public.claim_payout_lapse(uuid) is
  'Claims ONE credited reward for its owner at the payout deadline, under the post lock (begin_payout''s lock): re-checks it is held, credited, the spotter still not payable, no payout review open, past payout_deadline, and no transfer begun in the last hour; then stamps payout_lapse_claimed_at (no payout can begin after it) and refund_fee_absorbed (the refund is in full). Returns {post_id, payment_intent_id, spotter{…push}, owner{…push}} or null. Moves no money. SERVICE ROLE ONLY.';

revoke all on function public.claim_payout_lapse(uuid) from public, anon, authenticated;
grant execute on function public.claim_payout_lapse(uuid) to service_role;


-- =============================================================================
-- 7. mark_payout_lapsed_refunded — the terminal record
-- =============================================================================
-- Payment held -> refunded (guarded, never regressed); the post closes as
-- recovered_no_spotter — the car WAS recovered, no spotter was paid. The
-- credited sighting STAYS credited: the recovery counts on their record.
-- Idempotent, and also closes the post when the webhook recorded the refund
-- first.
create or replace function public.mark_payout_lapsed_refunded(
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
  v_lapsed  timestamptz;
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

  select payout_lapse_claimed_at into v_lapsed
    from public.payments
   where stripe_payment_intent_id = p_payment_intent_id
     for update;
  -- Only a CLAIMED lapse is recorded here: anything else refunding a credited
  -- spotter's reward is a hand refund, and reconcile alerts the operator.
  if v_lapsed is null then
    raise exception 'PAYOUT_NOT_LAPSED';
  end if;

  update public.payments
     set status                = 'refunded',
         stripe_refund_id      = p_refund_id,
         refunded_amount_pence = p_refunded_amount_pence
   where stripe_payment_intent_id = p_payment_intent_id
     and status = 'held';

  update public.posts
     set status = 'recovered_no_spotter'
   where id = v_post_id
     and status = 'recovery_claimed';
end $$;

comment on function public.mark_payout_lapsed_refunded(text, text, integer) is
  'Records the owner''s refund of a credited reward whose payout deadline passed (claim_payout_lapse): payment held -> refunded (never regressed); the post recovery_claimed -> recovered_no_spotter; the credited sighting stays credited. Refuses PAYOUT_NOT_LAPSED for an unclaimed payment. SERVICE ROLE ONLY.';

revoke all on function public.mark_payout_lapsed_refunded(text, text, integer) from public, anon, authenticated;
grant execute on function public.mark_payout_lapsed_refunded(text, text, integer) to service_role;


-- =============================================================================
-- 8. reconcile_payment_refund — a lapse the webhook sees first
-- =============================================================================
-- ⚠️ RESTATED IN FULL from 20261006130000 (extracted mechanically). The ONLY
-- change: a payment whose payout lapse was CLAIMED goes to
-- mark_payout_lapsed_refunded, before the credited-recovery branch.
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

  -- ⚠️ NEW (20261007100000): a CLAIMED payout lapse — the deadline refund of
  -- a credited reward, recorded here when the webhook lands first. BEFORE the
  -- credited branch below, which would otherwise file it as a hand refund of
  -- a spotter's money and alert the operator.
  if exists (
    select 1 from public.payments
     where id = v_payment_id and payout_lapse_claimed_at is not null
  ) then
    perform public.mark_payout_lapsed_refunded(
      p_payment_intent_id, p_refund_id, p_refunded_amount_pence);
    return 'payout_lapsed';
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

  -- A reward that ENDED on a live listing: it stays up as "Reward ended".
  -- AFTER the recovery branch on purpose (security review of PR5, C1): a
  -- credited spotter's money refunded by hand must still reach the
  -- refunded_with_credited_sighting alert above, never be filed as a lapse.
  if exists (
    select 1 from public.refund_holds
     where payment_id = v_payment_id and exit_path = 'reward_end'
  ) then
    perform public.mark_reward_ended_refunded(
      p_payment_intent_id, p_refund_id, p_refunded_amount_pence);
    return 'reward_ended';
  end if;

  perform public.mark_post_payment_refunded(
    p_payment_intent_id, p_refund_id, p_refunded_amount_pence);
  return 'refunded';
end $$;

revoke all on function public.reconcile_payment_refund(text, text, integer) from public, anon, authenticated;
grant execute on function public.reconcile_payment_refund(text, text, integer) to service_role;


-- =============================================================================
-- 9. Assert the grants and the widened vocabulary
-- =============================================================================
do $$
declare
  f text;
  k text;
begin
  foreach f in array array[
    'public.claim_payout_reminders(integer)',
    'public.begin_payout(uuid)',
    'public.payouts_past_deadline(integer)',
    'public.claim_payout_lapse(uuid)',
    'public.mark_payout_lapsed_refunded(text, text, integer)',
    'public.reconcile_payment_refund(text, text, integer)'
  ] loop
    if has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute') then
      raise exception '% is client-executable — it decides or moves money', f;
    end if;
    if not has_function_privilege('service_role', f, 'execute') then
      raise exception '% is not executable by service_role — the sweep/payout is broken', f;
    end if;
  end loop;

  foreach k in array array['alert','sighting','message','recovery','credited','credited_no_reward',
                           'closed_uncredited','dispute_upheld','dispute_rejected','payout_sent',
                           'not_credited','sighting_confirmed','still_missing','deletion_soon',
                           'reward_ending','reward_ended','payout_reminder','payout_lapsed'] loop
    if position('''' || k || '''' in pg_get_constraintdef(
         (select oid from pg_constraint where conname = 'notifications_kind_chk'
            and connamespace = 'public'::regnamespace and conrelid = 'public.notifications'::regclass))) = 0
       or position('''' || k || '''' in pg_get_constraintdef(
         (select oid from pg_constraint where conname = 'push_sends_kind_chk'
            and connamespace = 'public'::regnamespace and conrelid = 'public.push_sends'::regclass))) = 0 then
      raise exception 'kind % is missing from a kind constraint', k;
    end if;
  end loop;

  if public.notification_category('payout_reminder') is not null
     or public.notification_category('payout_lapsed') is not null then
    raise exception 'payout_reminder / payout_lapsed are mutable — the notice a reward is going back could be silenced';
  end if;
end $$;


-- =============================================================================
-- END OF MIGRATION
-- =============================================================================

-- =============================================================================
-- WHAT:  Every reward gets a 60-day TERM (PR3 of the 60-day reward plan). This
--        migration DATES rewards and TELLS owners; it moves no money.
--          1. payments.term_ends_at (+ the notice and reminder claims).
--          2. mark_post_payment_held stamps term_ends_at = capture + 60 days
--             whenever a bounty becomes a listing's reward (first charge,
--             change/renewal, add).
--          3. claim_reward_term_notices — rewards held BEFORE this shipped get
--             a term with notice: at least 14 days from the notice where the
--             90-day limit allows, never less than 60 days from capture,
--             capped at capture + 80 days, never under 3 days from the notice,
--             and never past capture + 85 days. They are marked legacy_term:
--             their END-OF-TERM refund (PR5) absorbs the card fee — they paid
--             under Terms with no term. No other refund of them changes.
--          Every term ends at the END of its named London day (reward_term_end),
--          so "ends on 4 December" means all of 4 December.
--          4. claim_reward_reminders — "your reward ends on …" 10 days and 3
--             days before the term ends.
--          5. Notification kinds reward_ending (sent here) and reward_ended
--             (sent by the expiry, PR5), both unmutable.
--          6. get_my_reward_status returns termEndsAt.
-- WHY:   Stripe lead support (2026-10-05): funds may not sit on the platform
--        balance beyond 90 days; persistent breach risks offboarding. A reward
--        therefore lasts 60 days, can be renewed any time (PR2's change path
--        at the same amount), and is refunded at the end if it is not (PR5).
--        The term, the notice and the Terms ship BEFORE anything can expire:
--        a term an owner was never told about is not a term they agreed to.
--        docs/decisions/ADR-0020-a-reward-has-a-term.md.
--
-- MONEY: nothing here moves money, and NOTHING HERE CHANGES A REFUND AMOUNT.
--        It writes dates, claim stamps and payments.legacy_term — a marker
--        only the expiry (PR5) reads, when it decides the end-of-term refund
--        absorbs the card fee. An earlier draft set refund_fee_absorbed at
--        notice time instead; that flag is read by EVERY refund path, so it
--        would have made a legacy owner's deactivation and renewal refunds
--        full as well (wider than the owner decided), shifted the amount under
--        a refund already in flight, and doubled as refunds_due's stray marker.
--        A separate, single-purpose column avoids all three.
--
-- ⚠️ THE CLAIMS ARE GATED IN THE SWEEP (REWARD_TERM_NOTICES_ENABLED): the
--        notices promise an automatic refund at the end, which is PR5's, and
--        a renew button only the updated app shows. They must not send before
--        both are live. Dating NEW rewards here is harmless either way.
--
-- SAFETY NOTE ON DESTRUCTIVE STATEMENTS: none dropped. Four additive nullable
--        columns; the two kind constraints dropped and re-added WIDER (every
--        existing kind kept — asserted below); `create or replace` on two
--        existing functions (mark_post_payment_held, restated IN FULL from
--        20261005130000; get_my_reward_status, from the same file) plus two
--        new ones.
-- LINKS: supabase/migrations/20261005130000_a_reward_can_be_changed.sql;
--        supabase/migrations/20260921120000_a_warning_comes_before_the_purge.sql
--          (the claim-then-send pattern, and the kind constraints);
--        supabase/functions/release-held-refunds/index.ts (Phase 1c);
--        docs/decisions/ADR-0020-a-reward-has-a-term.md;
--        supabase/tests/reward_term_verification.sql.
-- =============================================================================


-- =============================================================================
-- 1. Columns
-- =============================================================================
alter table public.payments
  add column term_ends_at    timestamptz,
  add column term_notice_at  timestamptz,
  add column reminded_10d_at timestamptz,
  add column reminded_3d_at  timestamptz,
  add column legacy_term     boolean not null default false;

comment on column public.payments.term_ends_at is
  'When this reward''s 60-day term ends (ADR-0020) — always the END of a London day (reward_term_end). Stamped by mark_post_payment_held when a bounty becomes the reward (capture + 60 days); for rewards held before the term existed, by claim_reward_term_notices. NULL = not yet given a term. Renewal is a new payment with its own term.';
comment on column public.payments.legacy_term is
  'MONEY: true for a reward that was held before rewards had a term and was given one by claim_reward_term_notices. Read ONLY by the expiry (PR5): its end-of-term refund absorbs the card fee (the owner''s decision, 2026-10-05 — they paid under Terms with no term). Every other refund of the payment is unchanged.';
comment on column public.payments.term_notice_at is
  'When the owner was told this reward''s term: at capture for new rewards (the Terms and the change screen disclose it), or when the legacy notice push was claimed. Reminders wait at least a day after it.';
comment on column public.payments.reminded_10d_at is
  'Claim stamp for the "ends in about 10 days" reminder. Server-only.';
comment on column public.payments.reminded_3d_at is
  'Claim stamp for the "ends in about 3 days" reminder. Server-only.';

-- The reminder/notice queries scan held rewards on a timer.
create index payments_held_term_idx
  on public.payments (term_ends_at)
  where status = 'held' and kind = 'bounty_escrow';

-- THE END OF THE NAMED DAY. Owners are told a DATE ("ends on 4 December",
-- printed in London time by the pushes and the app alike), so the term must
-- run to the end of that London day — not to the time of day the card
-- happened to be charged, which could end it at 03:00 on the 4th.
create or replace function public.reward_term_end(p_from timestamptz)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select ((((p_from at time zone 'Europe/London')::date) + 1)::timestamp at time zone 'Europe/London');
$$;

comment on function public.reward_term_end(timestamptz) is
  'The instant a reward term ending on p_from''s London date actually ends: midnight at the START of the next London day. Every term_ends_at goes through this, so the date owners are told is the whole of the last day. Not directly grantable.';

revoke all on function public.reward_term_end(timestamptz) from public, anon, authenticated;


-- =============================================================================
-- 2. The kind vocabulary widens
-- =============================================================================
-- Both constraints together (see 20260921120000). notification_category needs
-- no CASE change: an unlisted kind falls to `else null` — UNMUTABLE. That is
-- the decision, not an omission: these pushes are the notice a refund is
-- required to follow, and a toggle that silenced them would turn the notice
-- back into silence.
alter table public.notifications drop constraint notifications_kind_chk;
alter table public.notifications add constraint notifications_kind_chk
  check (kind in ('alert','sighting','message','recovery','credited',
                  'credited_no_reward','closed_uncredited','dispute_upheld',
                  'dispute_rejected','payout_sent','not_credited',
                  'sighting_confirmed','still_missing','deletion_soon',
                  'reward_ending','reward_ended'));

alter table public.push_sends drop constraint push_sends_kind_chk;
alter table public.push_sends add constraint push_sends_kind_chk
  check (kind in ('alert','sighting','message','recovery','credited',
                  'credited_no_reward','closed_uncredited','dispute_upheld',
                  'dispute_rejected','payout_sent','not_credited',
                  'sighting_confirmed','still_missing','deletion_soon',
                  'reward_ending','reward_ended'));

comment on function public.notification_category(text) is
  'Maps a notification kind to its mutable preference category, or NULL when the kind may not be muted (sighting, closed_uncredited, still_missing, deletion_soon, reward_ending, reward_ended) or is not yet classified. NULL always means "deliver". reward_ending / reward_ended are the notice a reward''s automatic refund must follow (ADR-0020), so they cannot be silenced.';


-- =============================================================================
-- 3. mark_post_payment_held — every new reward is dated
-- =============================================================================
-- ⚠️ RESTATED IN FULL from 20261005130000. The ONLY LOGIC change: each of the
-- three places a bounty becomes the reward (renewal, add, first charge) also
-- stamps term_ends_at = reward_term_end(now() + c_term) and term_notice_at =
-- now(). Strays get no term — they are not anyone's reward and go home within
-- the hour. Diff it. The long ⚠️ rationale on each guard is kept below; the
-- scenarios behind them are told in full in 20261005110000 / 20261005130000.
create or replace function public.mark_post_payment_held(
  p_payment_intent_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- ⚠️ THE TERM (ADR-0020). Moving it is a create-or-replace here AND a
  -- Terms change (legalContent.ts) — never one without the other.
  c_term         constant interval := interval '60 days';
  v_post_id      uuid;
  v_post_status  public.post_status;
  v_post_bounty  integer;
  v_post_renewal integer;
  v_post_attempt uuid;
  v_pay          record;
  v_current      uuid;
  v_current_amt  integer;
  v_is_choice    boolean;
begin
  -- Which post? Read unlocked first: the lock order is POST, then payment.
  select post_id into v_post_id
    from public.payments
   where stripe_payment_intent_id = p_payment_intent_id;

  -- Benign no-op: a success webhook for an intent we never recorded.
  if not found then
    return;
  end if;

  if v_post_id is not null then
    select status, bounty_amount_pence, renewal_amount_pence, renewal_attempt_id
      into v_post_status, v_post_bounty, v_post_renewal, v_post_attempt
      from public.posts where id = v_post_id
       for update;
  end if;

  select id, kind, status, amount_pence, replaces_payment_id, renewal_attempt_id
    into v_pay
    from public.payments
   where stripe_payment_intent_id = p_payment_intent_id
     for update;

  -- The row went between the two reads (a draft deleted with its intents).
  if not found then
    return;
  end if;

  -- NEVER REGRESS: only an uncaptured row advances. A duplicate delivery, or
  -- a late one after the row was released/refunded/collected/superseded, is
  -- a no-op.
  if v_pay.status not in ('requires_payment', 'failed') then
    return;
  end if;

  -- --- A listing fee: ours on capture (ADR-0018) — unchanged -----------------
  -- ⚠️ THE CASTS ARE REQUIRED (see 20260902130000): a bare literal assigned
  -- through CASE resolves to text and fails at runtime, not at create time.
  if v_pay.kind = 'listing_fee' then
    update public.payments
       set status      = 'collected'::public.payment_status,
           captured_at = now()
     where id = v_pay.id;

    update public.posts
       set status = 'active'
     where id = v_post_id
       and status = 'draft';
    return;
  end if;

  -- --- A bounty --------------------------------------------------------------
  -- The reward currently on offer, if any (the unique index: at most one).
  select id, amount_pence into v_current, v_current_amt
    from public.payments
   where post_id = v_post_id
     and status = 'held'
     and id <> v_pay.id;

  -- ⚠️ THE OWNER'S CURRENT CHOICE, AND NOTHING ELSE, MAY CHANGE A LIVE REWARD.
  -- A PaymentIntent never expires and its client secret is enough to confirm
  -- it, so 'the charge was valid when it was created' proves nothing at
  -- capture. A charge may become a live listing's reward only if it was made
  -- for the CURRENT attempt (set_reward_renewal_amount mints a fresh one on
  -- every choice) at exactly the amount chosen. An intent from an earlier
  -- choice — abandoned, or prepared and held back — is a stray, refunded in
  -- full.
  v_is_choice := coalesce(
    v_pay.renewal_attempt_id is not null
      and v_pay.renewal_attempt_id = v_post_attempt
      and v_pay.amount_pence = v_post_renewal,
    false);

  if v_current is not null then
    -- ⚠️ A RENEWAL ONLY ON A LIVE, UNCONTESTED POST, AS THE CURRENT CHOICE —
    -- CHECKED AT CAPTURE, not just when the intent was created: an owner can
    -- open the sheet on a live post, deactivate with a hold (or credit a
    -- spotter), and THEN confirm. Superseding the reward then would refund it
    -- past the dispute window, or hand a credited spotter's reward back.
    -- ⚠️ AND THE LOWERING RULE AGAIN: a sighting can land while the sheet is
    -- open; without this an owner could choose £10, wait for the sighting
    -- that finds the car, confirm, and credit the spotter on the smaller sum.
    if v_pay.replaces_payment_id = v_current
       and v_is_choice
       and v_post_status in ('active', 'pending_verification')
       and not public.reward_has_claim(v_post_id)
       and not (
         v_pay.amount_pence < v_current_amt
         and exists (select 1 from public.recent_uncredited_sightings(v_post_id))
       ) then
      update public.payments
         set status                   = 'superseded'::public.payment_status,
             superseded_at            = now(),
             superseded_by_payment_id = v_pay.id
       where id = v_current;

      -- The renewed reward starts a FRESH term from today.
      update public.payments
         set status         = 'held'::public.payment_status,
             captured_at    = now(),
             term_ends_at   = public.reward_term_end(now() + c_term),
             term_notice_at = now()
       where id = v_pay.id;

      update public.posts
         set bounty_amount_pence  = v_pay.amount_pence,
             renewal_amount_pence = null,
             renewal_attempt_id   = null
       where id = v_post_id;
    else
      -- STRAY: a reward is already held and this charge was not taken (or is
      -- no longer allowed) to replace it. It must not become a second held
      -- row (the index forbids it, and the webhook would then fail forever).
      -- The owner never chose this outcome, so it comes back IN FULL; it was
      -- never anyone's reward, so it gets no term.
      update public.payments
         set status                   = 'superseded'::public.payment_status,
             captured_at              = now(),
             superseded_at            = now(),
             superseded_by_payment_id = v_current,
             refund_fee_absorbed      = true
       where id = v_pay.id;
    end if;
    return;
  end if;

  -- No reward is held on the post.
  -- ADD: a LIVE £5 fee listing takes a reward — but only the owner's current
  -- choice (no draft-era leftover can satisfy it), naming nothing to replace,
  -- while nobody has a claim. The fee is not refunded (ADR-0014).
  if v_post_status in ('active', 'pending_verification')
     and v_post_bounty is null
     and v_pay.replaces_payment_id is null
     and v_is_choice
     and not public.reward_has_claim(v_post_id) then
    update public.payments
       set status         = 'held'::public.payment_status,
           captured_at    = now(),
           term_ends_at   = public.reward_term_end(now() + c_term),
           term_notice_at = now()
     where id = v_pay.id;

    update public.posts
       set bounty_amount_pence  = v_pay.amount_pence,
           renewal_amount_pence = null,
           renewal_attempt_id   = null
     where id = v_post_id;
    return;
  end if;

  -- ⚠️ A CLOSED OR MISSING POST NEVER TAKES A REWARD, AND NEITHER DOES A
  -- CHARGE FOR THE WRONG AMOUNT — each used to be held on a post that could
  -- never pay it out or refund it correctly, stranding money with a 90-day
  -- clock on it. Superseded + absorbed sends it home in full.
  if v_post_status is null
     or v_post_status not in ('draft', 'active', 'pending_verification')
     or v_post_bounty is distinct from v_pay.amount_pence then
    update public.payments
       set status              = 'superseded'::public.payment_status,
           captured_at         = now(),
           superseded_at       = now(),
           refund_fee_absorbed = true
     where id = v_pay.id;
    return;
  end if;

  -- The FIRST reward on a draft (or a live post charged what it offers).
  update public.payments
     set status         = 'held'::public.payment_status,
         captured_at    = now(),
         term_ends_at   = public.reward_term_end(now() + c_term),
         term_notice_at = now()
   where id = v_pay.id;

  -- LIVE-ON-PAYMENT: draft -> ACTIVE. Guarded so a late delivery never pulls a
  -- later lifecycle state backwards.
  update public.posts
     set status = 'active'
   where id = v_post_id
     and status = 'draft';

  -- AUDIT: a money-state-transition audit-log insert belongs here once the
  -- audit_log table exists (SECURITY_AND_TRUST §7). Deferred with moderation.
end;
$$;

comment on function public.mark_post_payment_held(text) is
  'Charge-success webhook handler. SECURITY DEFINER, service-role only. Locks the post, then the payment. A listing fee -> collected (ADR-0018). A bounty -> held on a draft/live post charged what it offers (draft -> active); a RENEWAL (the owner''s current choice naming the held payment, post live, no claim, not a lowering after a recent sighting) -> held, old payment superseded, post re-priced; an ADD (live fee listing, current choice, no claim) -> held. Every new reward is DATED: term_ends_at = capture + 60 days (ADR-0020). A STRAY -> superseded with refund_fee_absorbed, no term. Stamps captured_at. IDEMPOTENT + never-regress. Unknown intent id = benign no-op. NAME IS HISTORICAL (it may write collected or superseded); stripe-webhook calls it by name.';

revoke execute on function public.mark_post_payment_held(text) from public, anon, authenticated;
grant  execute on function public.mark_post_payment_held(text) to service_role;


-- =============================================================================
-- 4. claim_reward_term_notices — rewards held before the term existed
-- =============================================================================
-- Each held reward on a live listing with no term yet is given one, ONCE, and
-- its owner told. The term, rounded to the end of its London day:
--   base = least(capture + 80d, greatest(capture + 60d, now + 14d))
--   term = least(reward_term_end(greatest(base, now + 3d)), capture + 85d)
-- i.e. at least 14 days' notice where the 90-day limit allows it, never
-- shorter than a new reward's 60 days, capped at capture + 80 days (a 72-hour
-- hold and a week to settle a dispute inside 90) — but NEVER under 3 days'
-- notice, so a late deploy cannot hand out a date already gone, and never past
-- capture + 85 days, our hard line (anything that old is also ops' 75-day
-- alert's business). Where the cap means less than 14 days, the copy names the
-- real date. These owners paid under Terms that said nothing would close, so
-- the payment is marked legacy_term: its END-OF-TERM refund (PR5) absorbs the
-- card fee — the owner's decision, 2026-10-05. No other refund changes.
-- Copy is built HERE so its privacy is DB-testable: the car, never the plate,
-- never the amount.
create or replace function public.claim_reward_term_notices(p_limit integer default 200)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_term       constant interval := interval '60 days';
  c_min_notice constant interval := interval '14 days';
  c_legacy_cap constant interval := interval '80 days';
  c_min_floor  constant interval := interval '3 days';
  c_hard_line  constant interval := interval '85 days';
  v_rows       jsonb;
begin
  with due as (
    select p.id
      from public.payments p
      join public.posts po on po.id = p.post_id
     where p.status = 'held'
       and p.kind = 'bounty_escrow'
       and p.term_ends_at is null
       and po.status in ('active', 'pending_verification')
     order by coalesce(p.captured_at, p.created_at)
     limit greatest(coalesce(p_limit, 200), 0)
       for update of p skip locked
  ),
  claimed as (
    update public.payments pay
       set term_ends_at = least(
             public.reward_term_end(greatest(
               least(
                 coalesce(pay.captured_at, pay.created_at) + c_legacy_cap,
                 greatest(coalesce(pay.captured_at, pay.created_at) + c_term, now() + c_min_notice)
               ),
               now() + c_min_floor
             )),
             coalesce(pay.captured_at, pay.created_at) + c_hard_line
           ),
           term_notice_at = now(),
           legacy_term    = true
      from due
     where pay.id = due.id
       and pay.term_ends_at is null
       and pay.status = 'held'
    returning pay.id, pay.post_id, pay.term_ends_at
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'payment_id', c.id,
           'post_id',    c.post_id,
           'user_id',    po.owner_id,
           'title',      'Rewards now run for 60 days',
           'body',       'Your reward on your ' || coalesce(nullif(left(
                            trim(coalesce(po.colour, '') || ' ' ||
                                 coalesce(po.make, '')   || ' ' ||
                                 coalesce(po.model, '')), 48), ''), 'car')
                         || ' listing now ends on '
                         || to_char(c.term_ends_at at time zone 'Europe/London', 'FMDD FMMonth')
                         || '. You can renew it any time from your listing.'
         )), '[]'::jsonb)
    into v_rows
    from claimed c
    join public.posts po on po.id = c.post_id;

  return v_rows;
end $$;

comment on function public.claim_reward_term_notices(integer) is
  'Gives each held reward on a live listing that has no term yet (rewards held before ADR-0020) its term, ONCE: least(capture + 80d, greatest(capture + 60d, now + 14d)), floored at now + 3d, rounded to the end of its London day, never past capture + 85d; marks it legacy_term (only its END-OF-TERM refund absorbs the card fee — read by the expiry alone); returns [{payment_id, post_id, user_id, title, body}] for the owner''s push — the car and the date, never the plate or the amount. Claim-before-send: a replay finds nothing. Service-role only.';

revoke all on function public.claim_reward_term_notices(integer) from public, anon, authenticated;
grant execute on function public.claim_reward_term_notices(integer) to service_role;


-- =============================================================================
-- 5. claim_reward_reminders — 10 days and 3 days before the end
-- =============================================================================
-- One pass claims both rungs. The 3-day reminder also stamps the 10-day one,
-- so a reward that skipped straight into the last 3 days (a short legacy term)
-- is never sent "ends in 10 days" afterwards. Nothing within a day of the
-- term notice itself: the notice already named the date.
create or replace function public.claim_reward_reminders(p_limit integer default 200)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_first  constant interval := interval '10 days';
  c_second constant interval := interval '3 days';
  c_quiet  constant interval := interval '1 day';
  v_rows   jsonb;
begin
  with due as (
    select p.id,
           (p.term_ends_at <= now() + c_second) as last_days
      from public.payments p
      join public.posts po on po.id = p.post_id
     where p.status = 'held'
       and p.kind = 'bounty_escrow'
       and p.term_ends_at is not null
       and p.term_ends_at > now()
       and po.status in ('active', 'pending_verification')
       and (p.term_notice_at is null or p.term_notice_at < now() - c_quiet)
       and (
         (p.term_ends_at <= now() + c_second and p.reminded_3d_at is null)
         or (p.term_ends_at <= now() + c_first and p.reminded_10d_at is null)
       )
     order by p.term_ends_at
     limit greatest(coalesce(p_limit, 200), 0)
       for update of p skip locked
  ),
  claimed as (
    update public.payments pay
       set reminded_10d_at = coalesce(pay.reminded_10d_at, now()),
           reminded_3d_at  = case when due.last_days then coalesce(pay.reminded_3d_at, now())
                                  else pay.reminded_3d_at end
      from due
     where pay.id = due.id
       -- Re-check under the claim: a concurrent sweep must not remind twice.
       and ((due.last_days and pay.reminded_3d_at is null)
            or (not due.last_days and pay.reminded_10d_at is null))
    returning pay.id, pay.post_id, pay.term_ends_at
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'payment_id', c.id,
           'post_id',    c.post_id,
           'user_id',    po.owner_id,
           'title',      'Your ' || coalesce(nullif(left(
                            trim(coalesce(po.colour, '') || ' ' ||
                                 coalesce(po.make, '')   || ' ' ||
                                 coalesce(po.model, '')), 48), ''), 'car')
                         || ' reward ends on '
                         || to_char(c.term_ends_at at time zone 'Europe/London', 'FMDD FMMonth'),
           'body',       'Renew it to keep a reward on your listing. If you don''t, it''s refunded to your card.'
         )), '[]'::jsonb)
    into v_rows
    from claimed c
    join public.posts po on po.id = c.post_id;

  return v_rows;
end $$;

comment on function public.claim_reward_reminders(integer) is
  'Claims the "your reward ends on {date}" reminders: once at 10 days before term_ends_at, once at 3 days (which also burns the 10-day rung), only for held rewards on live listings, never within a day of the term notice. Returns [{payment_id, post_id, user_id, title, body}] — the car and the date, never the plate or the amount. Claim-before-send (conditional update): a replay or a concurrent sweep sends nothing twice. Service-role only.';

revoke all on function public.claim_reward_reminders(integer) from public, anon, authenticated;
grant execute on function public.claim_reward_reminders(integer) to service_role;


-- =============================================================================
-- 6. get_my_reward_status — now with the term
-- =============================================================================
-- ⚠️ RESTATED IN FULL from 20261005130000. The ONLY changes: termEndsAt and
-- legacyTerm.
create or replace function public.get_my_reward_status(p_post_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caller  uuid := auth.uid();
  v_post    record;
  v_current record;
begin
  if v_caller is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;
  select owner_id, status, bounty_amount_pence into v_post
    from public.posts where id = p_post_id;
  if v_post.owner_id is null or v_post.owner_id <> v_caller then
    raise exception 'POST_NOT_FOUND';
  end if;

  select id, amount_pence, captured_at, refund_fee_absorbed, term_ends_at, legacy_term into v_current
    from public.payments
   where post_id = p_post_id and status = 'held' and kind = 'bounty_escrow';

  return jsonb_build_object(
    'postStatus',          v_post.status,
    'mode',                case when v_current.id is null then 'add' else 'change' end,
    -- An opaque token that changes exactly when the reward does — the screen
    -- polls for it after the PaymentSheet closes.
    'rewardId',            v_current.id,
    'amountPence',         v_current.amount_pence,
    'capturedAt',          v_current.captured_at,
    -- When the reward's 60-day term ends (ADR-0020); null until it has one.
    'termEndsAt',          v_current.term_ends_at,
    -- A reward from before the term: its END-OF-TERM refund is in full.
    'legacyTerm',          coalesce(v_current.legacy_term, false),
    'feeAbsorbed',         coalesce(v_current.refund_fee_absorbed, false),
    'hasRecentSightings',  exists (select 1 from public.recent_uncredited_sightings(p_post_id)),
    'block',               public.reward_change_block(p_post_id)
  );
end $$;

comment on function public.get_my_reward_status(uuid) is
  'The owner''s view of their live listing''s reward: mode (change/add), rewardId (changes exactly when the reward does — polled after payment), amount, capture time, termEndsAt (the 60-day term, ADR-0020), whether its refund absorbs the card fee, whether recent uncredited sightings exist (lowering is then refused), and the current block token. Owner from auth.uid(); POST_NOT_FOUND for missing and not-owned alike.';

revoke all on function public.get_my_reward_status(uuid) from public, anon;
grant execute on function public.get_my_reward_status(uuid) to authenticated, service_role;


-- =============================================================================
-- 7. Assert the grants and the widened vocabulary
-- =============================================================================
do $$
declare
  f text;
  k text;
begin
  foreach f in array array[
    'public.mark_post_payment_held(text)',
    'public.claim_reward_term_notices(integer)',
    'public.claim_reward_reminders(integer)'
  ] loop
    if has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute') then
      raise exception '% is client-executable — anyone could date rewards or send owners pushes', f;
    end if;
    if not has_function_privilege('service_role', f, 'execute') then
      raise exception '% is not executable by service_role — the sweep is broken', f;
    end if;
  end loop;
  if has_function_privilege('anon', 'public.get_my_reward_status(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.get_my_reward_status(uuid)', 'execute') then
    raise exception 'get_my_reward_status grants are wrong';
  end if;

  -- Every kind, old and new, in BOTH constraints.
  foreach k in array array['alert','sighting','message','recovery','credited','credited_no_reward',
                           'closed_uncredited','dispute_upheld','dispute_rejected','payout_sent',
                           'not_credited','sighting_confirmed','still_missing','deletion_soon',
                           'reward_ending','reward_ended'] loop
    if position('''' || k || '''' in pg_get_constraintdef(
         (select oid from pg_constraint
           where conname = 'notifications_kind_chk'
             and connamespace = 'public'::regnamespace
             and conrelid = 'public.notifications'::regclass))) = 0
       or position('''' || k || '''' in pg_get_constraintdef(
         (select oid from pg_constraint
           where conname = 'push_sends_kind_chk'
             and connamespace = 'public'::regnamespace
             and conrelid = 'public.push_sends'::regclass))) = 0 then
      raise exception 'kind % is missing from a kind constraint', k;
    end if;
  end loop;
  if public.notification_category('reward_ending') is not null
     or public.notification_category('reward_ended') is not null then
    raise exception 'reward_ending / reward_ended are mutable — the notice a refund must follow could be silenced';
  end if;
  raise notice 'reward term: claims are service-role only; reward kinds are in both constraints and unmutable.';
end $$;

-- =============================================================================
-- END OF MIGRATION
-- =============================================================================

-- =============================================================================
-- WHAT:  The ledger groundwork for a reward with a term (PR1 of the 60-day
--        reward plan). No user-visible change.
--          1. payments learns when it was captured, what it replaces, when it
--             was superseded, whether its refund absorbs the card fee, and
--             when ops were last warned about its age.
--          2. AT MOST ONE `held` PAYMENT PER POST becomes a database rule
--             (a unique partial index), not an assumption.
--          3. mark_post_payment_held learns renewal: a captured charge that
--             names the post's current held payment replaces it (old ->
--             superseded, new -> held). A capture that replaces nothing on a
--             post that already holds a reward, or lands on a closed or
--             deleted post, is a STRAY: it becomes superseded with the fee
--             absorbed, so it is refunded in full rather than held forever.
--          4. reconcile_payment_refund: the charge.refunded webhook's handler.
--             It decides from the ledger, and never cancels a post because an
--             OLD payment was refunded.
--          5. refunds_due: the ONE SQL definition of every refund the sweep
--             owes (expired undisputed holds, superseded payments).
--          6. claim_money_deadline_alerts: any reward money 75+ days old,
--             claimed once a day, so ops hear about it long before day 90
--             (release_money_deadline_alerts re-arms a claim whose email
--             failed).
--          7. delete_cancelled_post counts superseded money as in flight.
-- WHY:   Stripe lead support (2026-10-05): funds may not sit on the platform
--        balance beyond 90 days; persistent breach risks offboarding. Each
--        reward therefore gets a 60-day term with renewal (PR2: the charge
--        path; PR3: the term, notice and Terms; PR5: expiry). All of that
--        stands on these primitives, and every one of them is decided HERE in
--        SQL, because CI's suites can test SQL and nothing tests Deno today.
--
-- MONEY: this migration moves no money. It writes one backfill
--        (captured_at := created_at on rows whose charge was captured — a
--        conservative LOWER bound: an intent is recorded before it captures)
--        and changes which status a FUTURE capture lands in.
--
-- ⚠️ LOCK ORDER IS NOW POST, THEN PAYMENT, in every function HERE that
--        writes both. A renewal touches TWO payments on one post; with the old
--        order (payment, then post) a renewal capture racing a refund on the
--        same post could deadlock. Postgres would abort one and the webhook
--        would retry, so it is not a money bug — but it is a gap worth closing
--        while these bodies are open anyway. NOT SYSTEM-WIDE YET:
--        mark_recovery_paid (20260802220000) still locks payment, then post.
--        A payout racing a webhook refund on one post is therefore still a
--        possible (self-healing) deadlock; it is restated when PR5 next opens
--        the payout path.
--
-- SAFETY NOTE ON DESTRUCTIVE STATEMENTS: no drop, no delete. One bounded
--        UPDATE (the captured_at backfill: only rows in captured states, only
--        the new NULL column, with the updated_at trigger suspended so no
--        other column changes). `create or replace` on four existing functions
--        (mark_post_payment_held, mark_post_payment_refunded,
--        mark_post_recovered_no_spotter, delete_cancelled_post), each restated
--        IN FULL from the file named above it — diff against those — plus four
--        new ones. The unique index is preceded by a check that aborts the
--        migration, rather than half-applying, if production already
--        violates it.
--
-- LINKS: supabase/migrations/20261005100000_payment_status_superseded.sql;
--        supabase/migrations/20260902130000_fee_collected_not_held.sql;
--        supabase/migrations/20260729100000_post_refund_cancel.sql;
--        supabase/migrations/20260802210000_mark_recovered_no_spotter.sql;
--        supabase/migrations/20260921100000_a_cancelled_post_can_be_deleted.sql;
--        supabase/functions/_shared/refundEscrow.ts (refundPayment);
--        supabase/functions/release-held-refunds/index.ts (Phase 1);
--        supabase/functions/stripe-webhook/index.ts (charge.refunded);
--        supabase/tests/reward_ledger_verification.sql.
-- =============================================================================


-- =============================================================================
-- 1. Columns
-- =============================================================================
alter table public.payments
  add column captured_at              timestamptz,
  add column replaces_payment_id      uuid references public.payments (id) on delete restrict,
  add column superseded_at            timestamptz,
  add column superseded_by_payment_id uuid references public.payments (id) on delete restrict,
  add column refund_fee_absorbed      boolean not null default false,
  add column deadline_alerted_at      timestamptz;

comment on column public.payments.captured_at is
  'When Stripe captured this charge (set by mark_post_payment_held for held, superseded and collected rows alike). Rows captured before 2026-10-05 were backfilled from created_at, a conservative lower bound. THE CLOCK for Stripe''s 90-day platform-balance limit: reward money must leave before captured_at + 85 days.';
comment on column public.payments.replaces_payment_id is
  'Renewal link: the held payment this charge was taken to replace. Written when the renewal intent is recorded (PR2). On capture, mark_post_payment_held supersedes the named payment ONLY if it is still the post''s held payment; otherwise this capture is a stray.';
comment on column public.payments.superseded_at is
  'When this payment stopped being the post''s current reward (renewed, or a stray capture). Set exactly when status becomes superseded; kept after the refund for the audit trail.';
comment on column public.payments.superseded_by_payment_id is
  'The payment that replaced this one (renewal), or the reward that was already held when this stray captured. NULL for a stray on a closed or missing post.';
comment on column public.payments.refund_fee_absorbed is
  'MONEY: when true, this payment''s refund returns the FULL amount and the platform absorbs the Stripe fee. True for stray captures (the owner never chose that charge) and, from PR3, for rewards taken under the pre-term Terms. False = the owner bears the non-refundable card fee, as on every owner-chosen exit.';
comment on column public.payments.deadline_alerted_at is
  'Ops-alert claim for claim_money_deadline_alerts: when ops were last emailed that this reward money is 75+ days old. Re-alerts at most daily. Server-only.';

alter table public.payments
  add constraint payments_superseded_is_bounty_chk
    check (status <> 'superseded' or kind = 'bounty_escrow'),
  add constraint payments_superseded_stamped_chk
    check (status <> 'superseded' or superseded_at is not null);

-- The backfill: captured states only, the new column only.
-- ⚠️ THE updated_at TRIGGER IS SUSPENDED AROUND IT. payments has no
-- refunded_at or released_at: updated_at is the only record of WHEN each
-- historical refund or payout happened, and payments_set_updated_at would
-- stamp every captured row with today. Same pattern as 20260722100000 and
-- 20260902140000. Both statements run in this migration's transaction, so
-- the trigger is never off for anything else.
alter table public.payments disable trigger payments_set_updated_at;

update public.payments
   set captured_at = created_at
 where captured_at is null
   and status in ('held', 'released', 'refunded', 'collected');

alter table public.payments enable trigger payments_set_updated_at;


-- =============================================================================
-- 2. AT MOST ONE HELD PAYMENT PER POST — now a rule, not an assumption.
-- =============================================================================
-- refundEscrow.ts, releasePayout.ts and collusion.ts read the held row with
-- .maybeSingle(), which ERRORS on two; several SQL readers use `limit 1`, which
-- silently picks one. A renewal is the first feature that could ever produce
-- two, so the property is enforced before it exists.
do $$
declare
  v_posts integer;
begin
  select count(*) into v_posts
    from (select post_id from public.payments
           where status = 'held' and post_id is not null
           group by post_id having count(*) > 1) dup;
  if v_posts > 0 then
    raise exception
      'ONE-HELD INDEX ABORTED: % post(s) already carry more than one held payment. Resolve them by hand (refund the stray at Stripe; the webhook records it) before applying this migration.',
      v_posts;
  end if;
end $$;

create unique index payments_one_held_per_post_uidx
  on public.payments (post_id)
  where status = 'held';

comment on index public.payments_one_held_per_post_uidx is
  'At most one held payment per post: the reward currently on offer. Renewal supersedes the old payment in the same transaction that holds the new one (mark_post_payment_held). Every .maybeSingle() / limit 1 reader of the held row relies on this.';


-- =============================================================================
-- 3. mark_post_payment_held — renewal, strays, and the capture time
-- =============================================================================
-- ⚠️ RESTATED IN FULL from 20260902130000. What changes:
--   * lock order: post first, then the payment;
--   * captured_at is stamped on every capture;
--   * a bounty capture now has three outcomes instead of one — held (the
--     reward), renewal (held, and the previous reward superseded — only on a
--     live post nobody has a claim on), or stray (superseded with the fee
--     absorbed);
--   * a capture whose amount is not what the post offers, or on a closed or
--     deleted post, is a stray rather than held;
--   * the draft -> active transition happens only when the capture became
--     the post's reward (or a collected fee), never for a stray — and a
--     REDELIVERY no longer re-runs it. The old body ran the post update on
--     every call; that only mattered if a payment could be captured while its
--     draft stayed a draft, and the two updates have always shared one
--     transaction, so they cannot diverge. Returning early on a redelivery is
--     what keeps a stray's redelivery from taking a draft live.
-- What does NOT change: the fee branch (-> collected, post draft -> active),
-- the never-regress guard (only requires_payment/failed advance), the unknown
-- intent no-op, and the correctly priced draft bounty path (CHECK 4/8/11 in
-- post_payment_verification.sql still describe it exactly).
create or replace function public.mark_post_payment_held(
  p_payment_intent_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post_id     uuid;
  v_post_status public.post_status;
  v_post_bounty integer;
  v_pay         record;
  v_current     uuid;
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
    select status, bounty_amount_pence into v_post_status, v_post_bounty
      from public.posts where id = v_post_id
       for update;
  end if;

  select id, kind, status, amount_pence, replaces_payment_id
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
  select id into v_current
    from public.payments
   where post_id = v_post_id
     and status = 'held'
     and id <> v_pay.id;

  if v_current is not null then
    -- ⚠️ A RENEWAL IS ONLY A RENEWAL ON A LIVE, UNCONTESTED POST — CHECKED AT
    -- CAPTURE, not just when the intent was created. The two are separate
    -- events: an owner can open the renewal sheet on a live post, deactivate
    -- with a refund hold (or claim a recovery and credit a spotter), and THEN
    -- confirm the sheet. Superseding the old reward at that point would refund
    -- it within the hour (superseded payments skip the hold), bypassing the
    -- spotters' 72-hour dispute window — or, on a recovery_claimed post with a
    -- credited sighting, hand the reward the spotter earned back to the owner
    -- and pay the spotter 95% of the new amount instead. So the old reward is
    -- only replaced while nothing has a claim on it; otherwise the NEW charge
    -- is the stray, refunded in full, and the old reward stays exactly where
    -- every existing exit expects it.
    if v_pay.replaces_payment_id = v_current
       and v_post_status in ('active', 'pending_verification')
       and not exists (select 1 from public.refund_holds h where h.post_id = v_post_id)
       and not exists (select 1 from public.refund_disputes d
                        where d.post_id = v_post_id and d.status in ('open', 'upheld'))
       and not exists (select 1 from public.sightings s
                        where s.post_id = v_post_id and s.status = 'credited')
       and not exists (select 1 from public.payout_reviews r
                        where r.post_id = v_post_id and r.resolved_at is null) then
      -- RENEWAL: the owner paid for this to replace the current reward. In ONE
      -- transaction the old payment stops being held and the new one starts,
      -- so the post is never without a reward and never has two. The old one
      -- is now owed back to the owner; refunds_due hands it to the sweep, and
      -- the webhook refunds it straight away as a best effort (PR2).
      update public.payments
         set status                   = 'superseded'::public.payment_status,
             superseded_at            = now(),
             superseded_by_payment_id = v_pay.id
       where id = v_current;

      update public.payments
         set status      = 'held'::public.payment_status,
             captured_at = now()
       where id = v_pay.id;

      -- The listing now offers the new amount (renewal may change it).
      update public.posts
         set bounty_amount_pence = v_pay.amount_pence
       where id = v_post_id;
    else
      -- STRAY: a reward is already held and this charge was not taken to
      -- replace it — a late success on an intent that was voided when the
      -- owner changed the amount, a renewal that went stale, or a renewal
      -- confirmed after the post closed or came under a claim. It must not
      -- become a second held row (the index forbids it, and the webhook would
      -- then fail forever). The owner never chose this charge, so it comes
      -- back IN FULL.
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
  -- ⚠️ A CLOSED OR MISSING POST NEVER TAKES A REWARD, AND NEITHER DOES A
  -- CHARGE FOR THE WRONG AMOUNT. Each of these used to be marked held on a
  -- post that could never pay it out or refund it correctly — money stranded
  -- on the platform balance, now with a 90-day clock on it:
  --   * a capture on a cancelled, recovered or deleted post;
  --   * a bounty capture on a FEE-priced post (bounty NULL) — deactivate-post's
  --     "STRANDED ESCROW / ESCROW_NEEDS_REVIEW" branch, which the amount
  --     re-check in 20260820110000 was meant to prevent but which this
  --     project never applied;
  --   * a late success on an old draft intent after the owner changed the
  --     amount — held at the OLD amount while the listing offers the new one.
  -- Superseded + absorbed sends each home in full, and the correctly priced
  -- intent can still capture afterwards. A draft or live post charged the
  -- amount it offers keeps today's behaviour (held); PR2 gives the live case
  -- its own guard when it adds a reward to a live listing.
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

  update public.payments
     set status      = 'held'::public.payment_status,
         captured_at = now()
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
  'Charge-success webhook handler. SECURITY DEFINER, service-role only. Locks the post, then the payment. A listing fee -> collected (ADR-0018). A bounty -> held on a draft/live post with nothing held (draft -> active); a RENEWAL (replaces_payment_id names the post''s held payment) -> held, with the old payment superseded and posts.bounty_amount_pence set to the new amount, in one transaction; a STRAY (a reward already held and not replaced, or a closed/deleted post) -> superseded with refund_fee_absorbed, refunded in full by the sweep. Stamps captured_at. IDEMPOTENT + never-regress: only requires_payment/failed advance. Unknown intent id = benign no-op. NAME IS HISTORICAL (it may write collected or superseded); stripe-webhook calls it by name.';

revoke execute on function public.mark_post_payment_held(text) from public, anon, authenticated;
grant  execute on function public.mark_post_payment_held(text) to service_role;


-- =============================================================================
-- 4. mark_post_payment_refunded — post-first lock; behaviour unchanged
-- =============================================================================
-- ⚠️ RESTATED from 20260729100000 with TWO changes:
--   * lock order: post, then payment;
--   * the post is cancelled ONLY IF THIS CALL MOVED THE PAYMENT. The old body
--     ran its post update unconditionally, which was only safe while a post
--     had one payment. Now: deactivate-post reads held A and refunds it at
--     Stripe; a renewal captures (A -> superseded, B -> held); deactivate-post
--     records A — the payment update matches nothing, and the old post update
--     would cancel the post with B still held and no path that ever refunds
--     it. So a no-op on the payment is a no-op on the post, and if a DIFFERENT
--     payment is the post's held reward the call raises
--     PAYMENT_NOT_CURRENT_REWARD so the caller logs it loudly (the refund of A
--     is still recorded: the charge.refunded webhook reconciles it as
--     superseded). The retry case still works: whoever moved the payment first
--     (this function, via the webhook's reconcile) also cancelled the post.
-- Callers: deactivate-post and the sweep's deactivate path, with the post's
-- held payment. The charge.refunded webhook goes through
-- reconcile_payment_refund (section 6), which only delegates here for a
-- payment that is still the post's held reward.
create or replace function public.mark_post_payment_refunded(
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
  v_moved   integer;
begin
  select post_id into v_post_id
    from public.payments
   where stripe_payment_intent_id = p_payment_intent_id;

  -- Benign no-op: a refund for an intent we never recorded.
  if not found then
    return;
  end if;

  if v_post_id is not null then
    perform 1 from public.posts where id = v_post_id for update;
  end if;
  perform 1 from public.payments
    where stripe_payment_intent_id = p_payment_intent_id
      for update;

  -- Escrow held -> refunded, recording the refund id + amount. Guarded on
  -- 'held' so a duplicate or any later state is NEVER regressed.
  update public.payments
     set status                = 'refunded',
         stripe_refund_id      = p_refund_id,
         refunded_amount_pence = p_refunded_amount_pence
   where stripe_payment_intent_id = p_payment_intent_id
     and status = 'held';
  get diagnostics v_moved = row_count;

  if v_moved = 0 then
    -- Nothing moved: a duplicate (already recorded — the post moved with it),
    -- or this payment stopped being the reward between the read and here.
    if exists (
      select 1 from public.payments
       where post_id = v_post_id
         and status = 'held'
         and stripe_payment_intent_id <> p_payment_intent_id
    ) then
      raise exception 'PAYMENT_NOT_CURRENT_REWARD';
    end if;
    return;
  end if;

  -- The post -> cancelled, only from a refund-eligible paid state.
  update public.posts
     set status = 'cancelled'
   where id = v_post_id
     and status in ('active', 'pending_verification');

  -- AUDIT: deferred with moderation (SECURITY_AND_TRUST §7).
end;
$$;

comment on function public.mark_post_payment_refunded(text, text, integer) is
  'Records an owner-deactivation refund. SECURITY DEFINER, service-role only. Locks the post, then the payment; advances the payment held -> refunded (refund id + amount) and, ONLY IF THAT MOVED, the post active/pending_verification -> cancelled. A no-op on the payment is a no-op on the post; if a different payment is the post''s held reward it raises PAYMENT_NOT_CURRENT_REWARD (the webhook still records this refund as superseded). IDEMPOTENT + never-regress. Unknown intent id = benign no-op. Called by deactivate-post and the sweep''s deactivate path; the charge.refunded webhook goes through reconcile_payment_refund.';

revoke execute on function public.mark_post_payment_refunded(text, text, integer) from public, anon, authenticated;
grant  execute on function public.mark_post_payment_refunded(text, text, integer) to service_role;


-- =============================================================================
-- 5. mark_post_recovered_no_spotter — post-first lock; behaviour unchanged
-- =============================================================================
-- ⚠️ RESTATED from 20260802210000 with the same two changes as section 4: the
-- lock order, and the post moves ONLY IF THIS CALL MOVED THE PAYMENT (raising
-- PAYMENT_NOT_CURRENT_REWARD when a different payment is the held reward).
-- The webhook-first case is unaffected: reconcile_payment_refund calls this
-- for the held reward, so the payment and the post move together there.
create or replace function public.mark_post_recovered_no_spotter(
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
  v_moved   integer;
begin
  select post_id into v_post_id
    from public.payments
   where stripe_payment_intent_id = p_payment_intent_id;

  -- Benign no-op: a refund for an intent we never recorded.
  if not found then
    return;
  end if;

  if v_post_id is not null then
    perform 1 from public.posts where id = v_post_id for update;
  end if;
  perform 1 from public.payments
    where stripe_payment_intent_id = p_payment_intent_id
      for update;

  -- SAFETY: a credited sighting means a spotter is owed this money. Refunding
  -- the owner here would pay the wrong party. Fail loudly — the Edge Function
  -- has already moved money at this point, so a silent no-op would strand a
  -- real Stripe refund with no record of it.
  if exists (
    select 1 from public.sightings
    where post_id = v_post_id and status = 'credited'
  ) then
    raise exception 'RECOVERY_HAS_CREDITED_SIGHTING';
  end if;

  update public.payments
     set status                = 'refunded',
         stripe_refund_id      = p_refund_id,
         refunded_amount_pence = p_refunded_amount_pence
   where stripe_payment_intent_id = p_payment_intent_id
     and status = 'held';
  get diagnostics v_moved = row_count;

  if v_moved = 0 then
    if exists (
      select 1 from public.payments
       where post_id = v_post_id
         and status = 'held'
         and stripe_payment_intent_id <> p_payment_intent_id
    ) then
      raise exception 'PAYMENT_NOT_CURRENT_REWARD';
    end if;
    return;
  end if;

  -- Terminal state, ONLY from recovery_claimed. An allowlist of one: this must
  -- never resolve an active post (that is deactivate-post's job) nor
  -- re-resolve an already-terminal one.
  update public.posts
     set status = 'recovered_no_spotter'
   where id = v_post_id
     and status = 'recovery_claimed';
end $$;

comment on function public.mark_post_recovered_no_spotter(text, text, integer) is
  'Records the refund resolving a recovery where nobody was credited: locks the post then the payment; payments held->refunded and, ONLY IF THAT MOVED, post recovery_claimed->recovered_no_spotter (PAYMENT_NOT_CURRENT_REWARD if a different payment is held). Raises if a credited sighting exists (that post is owed a payout, not a refund). Service-role only.';

revoke all on function public.mark_post_recovered_no_spotter(text, text, integer) from public;
revoke all on function public.mark_post_recovered_no_spotter(text, text, integer) from anon;
revoke all on function public.mark_post_recovered_no_spotter(text, text, integer) from authenticated;
grant execute on function public.mark_post_recovered_no_spotter(text, text, integer) to service_role;


-- =============================================================================
-- 6. reconcile_payment_refund — what a charge.refunded event means
-- =============================================================================
-- Until now the webhook called mark_post_payment_refunded for ANY refunded
-- charge, and that function cancels an active post. Once a post can have had
-- more than one payment, that is wrong: a refund (or a redelivered refund
-- event) for the OLD payment of a renewed post would take the live listing
-- down. So the webhook asks the ledger instead:
--   * superseded  -> refunded; the post is NOT touched (it has a newer reward,
--                    or is closed, either way not this payment's business);
--   * held, post recovery_claimed with no credited sighting
--                 -> the recovery refund (recovered_no_spotter). This also
--                    fixes a strand: if the webhook beat refund-recovery and
--                    that function's own write then failed, the post used to
--                    sit in recovery_claimed with its money already refunded;
--   * held, post recovery_claimed WITH a credited sighting -> recorded as
--                    refunded, post left alone, and the webhook alerts a
--                    person (only a hand-made dashboard refund gets here);
--   * held, anything else -> the old behaviour (refunded + post cancelled):
--                    an owner deactivation whose request died, or a refund
--                    issued by hand from the Stripe dashboard;
--   * any other status -> nothing. In particular an already-refunded payment
--                    never cancels a post on a redelivery. (The old function
--                    ran its post update regardless; that was only ever safe
--                    because a post had one payment.)
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

comment on function public.reconcile_payment_refund(text, text, integer) is
  'charge.refunded webhook handler. Decides from the LEDGER, never from Stripe metadata: superseded -> refunded with the post untouched; held on a recovery_claimed post with no credited sighting -> mark_post_recovered_no_spotter; held on a recovery_claimed post WITH a credited sighting (a dashboard refund of a spotter''s money) -> refunded, post untouched, returns refunded_with_credited_sighting so the webhook alerts a person; held otherwise -> mark_post_payment_refunded (refunded + post cancelled, the pre-2026-10-05 behaviour); any other status -> no change, so a redelivered refund for an old payment can never cancel a live renewed post. Returns what it did. Service-role only.';

revoke all on function public.reconcile_payment_refund(text, text, integer) from public;
revoke all on function public.reconcile_payment_refund(text, text, integer) from anon, authenticated;
grant execute on function public.reconcile_payment_refund(text, text, integer) to service_role;


-- =============================================================================
-- 7. refunds_due — every refund the sweep owes, defined once
-- =============================================================================
-- Replaces the sweep's PostgREST join (refund_holds -> payments!inner), which
-- leaned on PostgREST inferring a relationship between two tables that only
-- share a foreign key to posts. One SQL function is testable, and is the one
-- place that says which money leaves on a timer.
--   * 'deactivate' / 'recovery': an expired refund hold whose post still has
--     a held reward and no open or upheld dispute (an open dispute pauses the
--     refund; an upheld one forecloses it — that money goes to the spotter);
--   * 'superseded': a payment that stopped being the reward. It is owed back
--     at once — no hold: renewal is refused while a hold or dispute is pending
--     (PR2), and a stray was never anyone's reward.
-- ⚠️ BOTH BRANCHES FILTER kind = 'bounty_escrow' as well as the status. A fee
-- is never held or superseded (ADR-0018 + payments_superseded_is_bounty_chk),
-- so the kind test is the second lock — kept because this is the unattended
-- hourly path, where a fee slipping through would be refunded with nobody
-- watching.
create or replace function public.refunds_due(p_limit integer default 50)
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
          on p.post_id = h.post_id
         and p.status  = 'held'
         and p.kind    = 'bounty_escrow'
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
         -- SECOND LOCK. The first is mark_post_payment_held, which only ever
         -- supersedes a REWARD on a live post nobody had a claim on. This
         -- one holds back a renewal-superseded payment only if a dispute that
         -- ALREADY EXISTED when it was superseded is still open or upheld —
         -- i.e. only if the first lock was somehow bypassed. It deliberately
         -- does NOT wait on claims made afterwards: a dispute or a credit
         -- after the renewal is a claim on the NEW reward, and both are
         -- permanent once upheld/credited, so waiting on them would strand
         -- the owner's old payment forever. A stray (refund_fee_absorbed)
         -- was never anyone's reward and always goes home.
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
   order by due.due_at
   limit greatest(coalesce(p_limit, 50), 0);
$$;

comment on function public.refunds_due(integer) is
  'THE list of refunds the hourly sweep owes, oldest first: expired refund holds with a held reward and no open/upheld dispute (reason = the hold''s exit_path), and superseded payments (reason superseded). Both branches filter status AND kind = bounty_escrow — fees never qualify. Read-only; the sweep refunds via refundPayment and records via the reason''s terminal RPC. Service-role only.';

revoke all on function public.refunds_due(integer) from public;
revoke all on function public.refunds_due(integer) from anon, authenticated;
grant execute on function public.refunds_due(integer) to service_role;


-- =============================================================================
-- 8. claim_money_deadline_alerts — ops hear about old money before Stripe does
-- =============================================================================
-- Any reward money (held or superseded) captured 75+ days ago. That covers
-- every way money can get stuck — a legacy reward with no term yet, an open
-- dispute nobody has resolved, a payout review, a credited spotter who never
-- onboards, a recovery the owner never finished — without having to name
-- them: age is the one thing Stripe's limit cares about. Claimed at most once
-- a day per payment (conditional update), so the sweep can email every hour
-- without repeating itself. The rows carry ids and states only: no plate, no
-- name, no amount — the email is a pointer to the dashboard, not a record.
create or replace function public.claim_money_deadline_alerts(p_limit integer default 50)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_alert_after constant interval := interval '75 days';
  c_realert     constant interval := interval '24 hours';
  c_hard_limit  constant interval := interval '85 days';
  v_rows        jsonb;
begin
  with due as (
    select p.id
      from public.payments p
     where p.status in ('held', 'superseded')
       and p.kind = 'bounty_escrow'
       and coalesce(p.captured_at, p.created_at) < now() - c_alert_after
       and (p.deadline_alerted_at is null or p.deadline_alerted_at < now() - c_realert)
     order by coalesce(p.captured_at, p.created_at)
     limit greatest(coalesce(p_limit, 50), 0)
       for update skip locked
  ),
  claimed as (
    update public.payments pay
       set deadline_alerted_at = now()
      from due
     where pay.id = due.id
       -- Re-check under the claim: a concurrent run must not alert twice.
       and (pay.deadline_alerted_at is null or pay.deadline_alerted_at < now() - c_realert)
    returning pay.id, pay.post_id, pay.status, coalesce(pay.captured_at, pay.created_at) as captured
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'paymentId',     c.id,
           'postId',        c.post_id,
           'paymentStatus', c.status,
           'postStatus',    po.status,
           'daysHeld',      floor(extract(epoch from now() - c.captured) / 86400)::int,
           'resolveBy',     c.captured + c_hard_limit,
           'openDisputes',  (select count(*) from public.refund_disputes d
                              where d.post_id = c.post_id and d.status = 'open'),
           -- payout_reviews.post_id is its primary key: at most one row.
           'payoutReview',  (select coalesce(r.resolution, 'pending') from public.payout_reviews r
                              where r.post_id = c.post_id),
           -- max(), not a scalar read: holds become one per PAYMENT when
           -- reward expiry ships, and a scalar subquery would then raise.
           'refundHoldUntil', (select max(h.expires_at) from public.refund_holds h
                              where h.post_id = c.post_id)
         ) order by c.captured), '[]'::jsonb)
    into v_rows
    from claimed c
    left join public.posts po on po.id = c.post_id;

  return v_rows;
end $$;

comment on function public.claim_money_deadline_alerts(integer) is
  'Ops alert claim: reward money (held or superseded bounty_escrow) captured 75+ days ago, stamped deadline_alerted_at at most once per 24h, returned as [{paymentId, postId, paymentStatus, postStatus, daysHeld, resolveBy (captured + 85d), openDisputes, payoutReview, refundHoldUntil}]. Ids and states only — no plate, name or amount. The sweep emails these. Service-role only.';

revoke all on function public.claim_money_deadline_alerts(integer) from public;
revoke all on function public.claim_money_deadline_alerts(integer) from anon, authenticated;
grant execute on function public.claim_money_deadline_alerts(integer) to service_role;

-- The claim is taken BEFORE the email is sent (the conditional-update idiom),
-- so a Resend failure would otherwise cost a whole day of the 10-day window
-- between the first alert (day 75) and the hard line (day 85). If the send
-- fails, the sweep hands the ids back and they are alerted again next hour.
-- Only claims from the last hour are released: an older stamp is a real
-- alert that was delivered, and must not be re-armed by a late failure.
create or replace function public.release_money_deadline_alerts(p_payment_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_released integer;
begin
  update public.payments
     set deadline_alerted_at = null
   where id = any (coalesce(p_payment_ids, '{}'))
     and deadline_alerted_at > now() - interval '1 hour';
  get diagnostics v_released = row_count;
  return v_released;
end $$;

comment on function public.release_money_deadline_alerts(uuid[]) is
  'Undoes this hour''s claim_money_deadline_alerts stamp for the given payments when the alert email failed, so the next sweep alerts again instead of waiting a day. Only stamps from the last hour are cleared. Service-role only.';

revoke all on function public.release_money_deadline_alerts(uuid[]) from public;
revoke all on function public.release_money_deadline_alerts(uuid[]) from anon, authenticated;
grant execute on function public.release_money_deadline_alerts(uuid[]) to service_role;


-- =============================================================================
-- 9. delete_cancelled_post — superseded money is money in flight
-- =============================================================================
-- ⚠️ RESTATED IN FULL from 20260921100000. The ONLY change is the
-- MONEY_IN_FLIGHT ledger guard: `status = 'held'` becomes
-- `status in ('held', 'superseded')`. A superseded payment is captured money
-- still owed back to the owner; detaching it from its post mid-refund would
-- leave the sweep refunding a row whose post is gone. Everything else is
-- byte-identical — diff it.
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
    'refund_hold',     (select to_jsonb(h) from public.refund_holds h where h.post_id = p_post_id),
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

comment on function public.delete_cancelled_post(uuid, uuid, text[]) is
  'Hard-deletes an owner''s own CANCELLED post once its money is settled: terminal ledger rows are DETACHED (post_id nulled, post_snapshot written), never-captured rows are deleted only when named in the caller''s Stripe-verified cancelled-intent list, and settled hold/dispute/review rows are archived into the snapshot and removed. Held OR superseded money blocks it (MONEY_IN_FLIGHT). SERVICE ROLE ONLY (delete-post Edge Function, purge_cancelled_posts). Raises NOT_OWNER / NOT_CANCELLED / MONEY_IN_FLIGHT / DISPUTE_OPEN / PAYMENT_REVIEW_OPEN / INTENT_NOT_CANCELLED.';

revoke all on function public.delete_cancelled_post(uuid, uuid, text[]) from public;
revoke all on function public.delete_cancelled_post(uuid, uuid, text[]) from anon, authenticated;
grant execute on function public.delete_cancelled_post(uuid, uuid, text[]) to service_role;


-- =============================================================================
-- 10. Assert the grants — every money function here is service-role only
-- =============================================================================
-- ⚠️ ALTER DEFAULT PRIVILEGES in this project grants EXECUTE on new functions
-- to anon + authenticated (20260713191000); `revoke from public` does not
-- touch that, which is why every block above revokes from both by name.
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.mark_post_payment_held(text)',
    'public.mark_post_payment_refunded(text, text, integer)',
    'public.mark_post_recovered_no_spotter(text, text, integer)',
    'public.reconcile_payment_refund(text, text, integer)',
    'public.refunds_due(integer)',
    'public.claim_money_deadline_alerts(integer)',
    'public.release_money_deadline_alerts(uuid[])',
    'public.delete_cancelled_post(uuid, uuid, text[])'
  ] loop
    if has_function_privilege('anon', f, 'execute')
       or has_function_privilege('authenticated', f, 'execute') then
      raise exception '% is client-executable — a money transition must be service-role only', f;
    end if;
    if not has_function_privilege('service_role', f, 'execute') then
      raise exception '% is not executable by service_role — the webhook or sweep is broken', f;
    end if;
  end loop;
  raise notice 'reward ledger groundwork: % money functions are service-role only.', 8;
end $$;

-- =============================================================================
-- END OF MIGRATION
-- =============================================================================

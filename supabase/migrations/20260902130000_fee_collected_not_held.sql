-- =============================================================================
-- WHAT:  Makes a captured listing fee land in `collected` instead of `held`,
--        and moves the fee rows already sitting in `held`.
-- WHY:   ADR-0018, accepted 2026-09-02 (recommended set: keep the existing
--        filters, migrate the existing rows, no refund path).
--
--        The £5 fee is non-refundable only because FIVE call sites each
--        remember `kind = 'bounty_escrow'` — refundEscrow, releasePayout, the
--        hourly sweep, the deactivation guard and (added 2026-09-02)
--        claim_credited_notification. ADR-0014 recorded that those filters were
--        missing for four days and an hourly cron refunded fees, and said the
--        structural property was "worth buying back". This buys it: `held` is
--        what every money query selects on, so a fee that is never `held`
--        cannot be reached by any of them, whether or not the next person
--        remembers.
--
-- ⚠️ THE FIVE FILTERS STAY (ADR-0018 Q1). They stop being load-bearing without
--        stopping being true, and removing five correct guards in the same
--        change that alters money states would double what a mistake costs.
--        Each has been re-commented to say it is now a second lock rather than
--        the only one — otherwise the next reader deletes them as dead weight
--        and quietly re-creates the gap.
--
-- ⚠️ THIS MIGRATION WRITES TO REAL PAYMENT ROWS. That is the backfill, and it
--        is the only way the property is actually true afterwards: leaving
--        existing fees in `held` would mean the guarantee holds for future fees
--        and not for the ones already taken, which is the worst of both and
--        impossible to remember later. It is bounded three ways — kind,
--        status, and a raise if the count is not what was counted a statement
--        earlier — and it moves no money: `collected` describes where a
--        captured fee already effectively sat.
--
-- SAFETY NOTE ON DESTRUCTIVE STATEMENTS: one UPDATE over
--        `kind = 'listing_fee' and status = 'held'`. No row is deleted, no
--        amount is altered, and no bounty_escrow row is touched by any
--        statement in this file. `create or replace` on one function, restated
--        in full from 20260730100000.
--
-- LINKS: docs/decisions/ADR-0018-fee-separation-by-construction.md;
--        supabase/migrations/20260902120000_payment_status_collected.sql (the
--          enum value — separate file because a new value cannot be USED in the
--          transaction that adds it);
--        supabase/migrations/20260730100000_live_on_payment.sql (the function
--          body this replaces — diff against THAT file);
--        supabase/tests/fee_collected_verification.sql.
-- =============================================================================


-- =============================================================================
-- 1. mark_post_payment_held — a fee captures to `collected`
-- =============================================================================
-- ⚠️ RESTATED IN FULL from 20260730100000. The ONLY change is the status the
-- payment advances to, which now depends on `kind`. The lock, the not-found
-- no-op, the never-regress guards and the live-on-payment post transition are
-- byte-identical — diff them.
--
-- The NAME is now half-wrong (`_held` for a function that may write
-- `collected`) and is kept anyway: it is called from stripe-webhook and its
-- name is part of that contract, so renaming it is a separate change with its
-- own deploy ordering. Recorded rather than smuggled.
create or replace function public.mark_post_payment_held(
  p_payment_intent_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post_id uuid;
  v_kind    public.payment_kind;
begin
  -- Lock the matched ledger row so the payment + post transition is atomic
  -- against a concurrent redelivery of the same event.
  select post_id, kind
    into v_post_id, v_kind
  from public.payments
  where stripe_payment_intent_id = p_payment_intent_id
  for update;

  -- Benign no-op: a success webhook for an intent we never recorded.
  if not found then
    return;
  end if;

  -- Advance from requires_payment OR failed (decline-then-succeed recovery on
  -- the reused intent). Guarded so a duplicate or a later released/refunded/
  -- collected state is NEVER regressed.
  --
  -- ⚠️ THE TERMINAL STATE DEPENDS ON WHAT WAS BOUGHT. A bounty is held in
  -- escrow for a spotter who may never be found; a fee is ours the moment it
  -- captures and has no second leg. Writing both to `held` is what forced five
  -- separate queries to re-derive the difference from `kind` (ADR-0018).
  update public.payments
     set status = case when v_kind = 'listing_fee' then 'collected' else 'held' end
   where stripe_payment_intent_id = p_payment_intent_id
     and status in ('requires_payment', 'failed');

  -- LIVE-ON-PAYMENT: advance the post draft -> ACTIVE (publicly live) rather than
  -- pending_verification. Guarded on status='draft' so a duplicate/late delivery
  -- never pulls a later lifecycle state backwards.
  update public.posts
     set status = 'active'
   where id = v_post_id
     and status = 'draft';

  -- AUDIT: a money-state-transition audit-log insert belongs here once the
  -- audit_log table exists (SECURITY_AND_TRUST §7). Deferred with moderation.
end;
$$;

comment on function public.mark_post_payment_held(text) is
  'Charge-success webhook handler. SECURITY DEFINER, service-role only. Atomically advances the matched payment requires_payment/failed -> held (bounty_escrow) or -> collected (listing_fee, ours on capture and never refunded — ADR-0018) AND the post draft -> ACTIVE. IDEMPOTENT + never-regress: both updates are guarded so a duplicate or late webhook is a no-op and can never pull a later state backwards. Unknown intent id = benign no-op. NAME IS HISTORICAL: it may now write `collected`; renaming it is a separate change because stripe-webhook calls it by name.';


-- =============================================================================
-- 2. THE BACKFILL — fees already captured
-- =============================================================================
-- ⚠️ THE ONLY STATEMENT IN THIS BRANCH THAT WRITES TO EXISTING MONEY ROWS.
-- Counted first, moved, then counted again: if the two disagree, something
-- matched that should not have and the migration aborts rather than committing
-- a partial reclassification of the ledger.
do $$
declare
  v_before integer;
  v_moved  integer;
  v_after  integer;
begin
  select count(*) into v_before
    from public.payments
   where kind = 'listing_fee' and status = 'held';

  update public.payments
     set status = 'collected'
   where kind = 'listing_fee'
     and status = 'held';
  get diagnostics v_moved = row_count;

  if v_moved <> v_before then
    raise exception
      'FEE BACKFILL ABORTED: counted % fee rows in held, moved % — refusing to commit a partial reclassification',
      v_before, v_moved;
  end if;

  -- ⚠️ AND NOTHING ELSE MOVED. A bounty_escrow row in `collected` would mean
  -- real escrow had just been marked as ours, which is the one outcome this
  -- migration must never produce.
  select count(*) into v_after
    from public.payments
   where kind = 'bounty_escrow' and status = 'collected';
  if v_after <> 0 then
    raise exception
      'FEE BACKFILL ABORTED: % bounty_escrow row(s) are in collected — escrow must never be marked as ours',
      v_after;
  end if;

  raise notice 'Fee backfill: % listing_fee row(s) moved held -> collected.', v_moved;
end $$;


-- =============================================================================
-- 3. The SQL-side filters, re-commented (ADR-0018 Q1: they stay)
-- =============================================================================
-- The deactivation guard in 20260822100000 asks "is there escrow on this post".
-- After this migration `status = 'held'` answers that on its own, because a fee
-- is never held — but the `kind` predicate stays as the second lock. Restated
-- with the reasoning attached so it does not read as redundant and get removed.
comment on function public.cancel_fee_listing(uuid) is
  'Brings a FEE-priced listing down. Refuses with POST_HAS_BOUNTY when escrow exists on the post. ⚠️ That check filters BOTH status = held AND kind = bounty_escrow: since ADR-0018 a listing fee is never `held`, so the status test alone would suffice — the kind test is kept deliberately as a second lock, not because it is still load-bearing. Do not remove it as dead weight.';


-- =============================================================================
-- END OF MIGRATION
-- =============================================================================

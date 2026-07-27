-- =============================================================================
-- WHAT:  Server-side MONEY-STATE functions for the bounty-escrow CHARGE slice
--        (Phase 2 payments — charge only; NOT payout/refunds). Adds four
--        SECURITY DEFINER functions — record_post_payment_intent (creates the
--        escrow PaymentIntent ledger row for a draft post), mark_post_payment_held
--        (webhook success: escrow captured + draft -> pending_verification),
--        mark_post_payment_failed (webhook failure: charge failed, post left as
--        draft), and claim_stripe_event (webhook dedup) — plus one new dedup
--        table public.stripe_webhook_events. All are service-role-only, mirroring
--        the payments ledger.
-- WHY:   The escrow charge is the handoff the posting flow left open: create_post
--        (20260713190000) ONLY ever produces status='draft', and the foundation
--        migration (20260707110712) established that clients can NEVER move
--        posts.status and can NEVER read/write the payments ledger — both are
--        service-role-only. These functions are the trusted server boundary the
--        Stripe Edge Functions call (with the service-role key) to (a) create the
--        PaymentIntent ledger row, and (b) on the escrow-success webhook, atomically
--        flip the ledger to 'held' and advance the post draft -> pending_verification.
--        The charge amount is authoritative from the DB (posts.bounty_amount_pence),
--        never trusted from the caller (BOUNTY_MISMATCH). Webhooks are retried and
--        can be delivered more than once / out of order, so every function is
--        IDEMPOTENT and never regresses a later state.
-- LINKS: docs/DOMAIN.md (post lifecycle: draft -> pending_verification; £50–£5000
--          bounty; integer pence),
--        docs/SECURITY_AND_TRUST.md §4 (financial tables service-role only),
--          §6 (RLS deny-by-default; status server-only via SECURITY DEFINER;
--          money-state written only by the service role),
--        docs/decisions/ADR-0002-stripe-connect.md (separate charges & transfers;
--          charge captured to platform balance = 'held'),
--        supabase/migrations/20260707110712_payments_foundation.sql (posts,
--          post_status/payment_status enums, payments ledger, RLS: payments is
--          RLS-enabled with NO client policies/grants — service-role only),
--        supabase/migrations/20260713190000_post_a_car.sql (create_post: the
--          draft-producing write boundary + the stable-raise-code convention
--          reused here so the Edge Function can map codes to user messages).
--
-- SAFETY (Tier 1 — MONEY-CRITICAL, read before editing anything below):
--   * SERVICE-ROLE ONLY. Every function here and the new table are granted to
--     service_role ONLY (execute revoked from public/anon/authenticated). They are
--     called by the Stripe Edge Functions with the service-role key. Clients must
--     never call them — moving money state or posts.status from a client is exactly
--     what the foundation migration's RLS/column grants forbid.
--   * SERVER-AUTHORITATIVE AMOUNT. record_post_payment_intent charges the post's
--     own bounty_amount_pence; a caller-supplied p_amount_pence that disagrees
--     raises BOUNTY_MISMATCH. The amount is never trusted from the caller.
--   * NEVER REGRESSES. mark_post_payment_held advances a payment from
--     'requires_payment' OR 'failed' -> 'held' (the 'failed' case is the
--     decline-then-succeed recovery on a reused PaymentIntent), and only advances
--     a post that is still 'draft' -> 'pending_verification'. A held/released/
--     refunded payment is never dragged back. A duplicate/late webhook delivery
--     updates 0 rows
--     (a no-op) and can never pull a later post state or a released/refunded payment
--     backwards. mark_post_payment_failed only fails a payment that is still
--     'requires_payment' (a late failure event can never wipe out held escrow) and
--     never touches posts.status.
--   * WEBHOOK DEDUP. claim_stripe_event + stripe_webhook_events let the Edge
--     Function record an event id as processed. The webhook PROCESSES FIRST and
--     records AFTER the state change commits, so a recorded id always means
--     "already applied" and is safe to skip; a crash mid-processing records
--     nothing and Stripe's retry reprocesses cleanly (mark_* are idempotent).
--   * SECURITY DEFINER + set search_path = '' so these run as the (superuser)
--     migration owner and bypass RLS to write the ledger / advance status — the
--     same pattern create_post uses — while auth.uid() is irrelevant here (the
--     caller is always the trusted service role, not an end user).
--
-- SAFETY NOTE ON DESTRUCTIVE STATEMENTS: NONE. Fully additive — one new table
--        (+ RLS + grants) and four new functions (+ grants + comments). No
--        drop / rename / truncate of any existing object.
-- =============================================================================


-- =============================================================================
-- 1. TABLE: stripe_webhook_events  (webhook idempotency / dedup ledger)
-- One row per Stripe event id we have already processed. Lets the Edge Function
-- guarantee at-most-once handling of retried/duplicated webhook deliveries.
-- =============================================================================
create table public.stripe_webhook_events (
  -- The Stripe event id (evt_...). PRIMARY KEY is the dedup key: a second
  -- delivery of the same event conflicts on insert and is skipped.
  event_id     text primary key,
  processed_at timestamptz not null default now()
);
-- RETENTION (deferred): this grows one row per processed event. A periodic purge
-- of rows older than Stripe's retry window (a few days) keeps it bounded; add it
-- with the ops/cron pass. Operational only — no correctness/security impact.

comment on table public.stripe_webhook_events is
  'Webhook idempotency ledger: one row per Stripe event id already processed. Written only by claim_stripe_event (SECURITY DEFINER) / service role. RLS enabled with NO client policies — never client-readable/writable (mirrors the payments ledger, SECURITY_AND_TRUST §4/§6).';

alter table public.stripe_webhook_events enable row level security;

-- SAFETY: financial/operational infrastructure table. RLS is ENABLED with NO
-- policies for anon/authenticated, so ALL client access is denied by default.
-- Only the service role (Edge Functions) touches it; it bypasses RLS but is not
-- auto-granted under this project's config (auto_expose_new_tables unset), so
-- grant its DML explicitly. NO anon/authenticated grant — clients never see it.
grant select, insert, update, delete on public.stripe_webhook_events to service_role;


-- =============================================================================
-- 2. FUNCTION: record_post_payment_intent(post_id, payment_intent_id, amount_pence)
-- =============================================================================
-- Records the escrow PaymentIntent for a post as a 'requires_payment' ledger row.
-- Called by the create-escrow Edge Function right after it creates the Stripe
-- PaymentIntent, so the ledger row and the intent come into being together.
--
-- GUARDS (raise a stable code in the message, matching create_post so the Edge
-- Function can map codes -> user messages):
--   * POST_NOT_DRAFT  — the post does not exist, or is not status='draft'. Escrow
--                       is only ever taken for a draft; a later state already has
--                       (or had) its money leg.
--   * BOUNTY_MISMATCH — p_amount_pence disagrees with the post's authoritative
--                       bounty_amount_pence. The amount is NEVER trusted from the
--                       caller; the DB value is the source of truth.
--
-- IDEMPOTENT + EDIT-SAFE: a retry at the SAME amount reuses the existing live
-- 'requires_payment' row (never a second escrow row); a 'held' row (already
-- captured) is likewise left untouched. If the bounty was EDITED since a prior
-- abandoned attempt, the stale 'requires_payment' row is at a DIFFERENT amount —
-- it is superseded to 'failed' so the new, correctly-priced intent records
-- cleanly (never dropped, which would strand a captured charge with no ledger
-- row). The insert also guards the unique stripe_payment_intent_id with ON
-- CONFLICT DO NOTHING so re-recording the SAME intent id is a no-op.
create or replace function public.record_post_payment_intent(
  p_post_id           uuid,
  p_payment_intent_id text,
  p_amount_pence      integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bounty integer;
  v_status public.post_status;
begin
  -- Lock the post row so concurrent intent-recording for the same post serialises
  -- (belt-and-braces against a double-charge race). Missing row -> NOT FOUND.
  select bounty_amount_pence, status
    into v_bounty, v_status
  from public.posts
  where id = p_post_id
  for update;

  -- Post must exist AND still be a draft.
  if not found or v_status <> 'draft' then
    raise exception 'POST_NOT_DRAFT';
  end if;

  -- MONEY: the charge amount is server-authoritative. A caller-supplied amount
  -- that disagrees with the post's own bounty is rejected outright.
  if p_amount_pence is distinct from v_bounty then
    raise exception 'BOUNTY_MISMATCH';
  end if;

  -- Escrow already captured? A 'held' row shouldn't coexist with a draft post
  -- (mark_post_payment_held advances the post out of draft), but guard
  -- defensively: never open a second escrow row over a captured one.
  if exists (
    select 1 from public.payments where post_id = p_post_id and status = 'held'
  ) then
    return;
  end if;

  -- IDEMPOTENT reuse vs SUPERSEDE-on-edit:
  --   * a live 'requires_payment' row at the SAME amount is the in-flight intent
  --     — reuse it (a retry never opens a second escrow row for the same bounty);
  --   * a live 'requires_payment' row at a DIFFERENT amount means the bounty was
  --     edited since the last attempt — supersede it (-> 'failed') so the new,
  --     correctly-priced intent records cleanly instead of being dropped (which
  --     would leave a captured charge with no ledger row and the post stuck in
  --     draft). create-payment-intent cancels the superseded Stripe intent so no
  --     abandoned intent can later capture escrow at the stale amount.
  if exists (
    select 1 from public.payments
    where post_id = p_post_id
      and status = 'requires_payment'
      and amount_pence = p_amount_pence
  ) then
    return;
  end if;

  update public.payments
     set status = 'failed'
   where post_id = p_post_id
     and status = 'requires_payment'
     and amount_pence <> p_amount_pence;

  -- Insert the escrow ledger row. amount_pence = the authoritative bounty just
  -- validated. ON CONFLICT on the unique stripe_payment_intent_id makes a
  -- re-record of the SAME intent a no-op (double-safe with the reuse guard).
  insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence)
  values (p_post_id, p_payment_intent_id, 'requires_payment', p_amount_pence)
  on conflict (stripe_payment_intent_id) do nothing;
end;
$$;

comment on function public.record_post_payment_intent(uuid, text, integer) is
  'Records the escrow PaymentIntent for a DRAFT post as a requires_payment payments row. SECURITY DEFINER, service-role only. Charge amount is server-authoritative (raises BOUNTY_MISMATCH if p_amount_pence <> posts.bounty_amount_pence; POST_NOT_DRAFT if the post is missing/not draft). IDEMPOTENT + edit-safe: a same-amount retry reuses the live requires_payment row (and a held row is left untouched); a stale requires_payment row at a DIFFERENT amount (bounty edited) is superseded to failed so the new intent records cleanly. ON CONFLICT DO NOTHING on the unique intent id makes re-recording the same intent a no-op.';


-- =============================================================================
-- 3. FUNCTION: mark_post_payment_held(payment_intent_id)
-- =============================================================================
-- The escrow-SUCCESS webhook handler. Atomically (a) advances the matched
-- payments row 'requires_payment' -> 'held' (escrow captured to the platform
-- balance, ADR-0002) and (b) advances its post 'draft' -> 'pending_verification'
-- so the moderator review queue picks it up.
--
-- IDEMPOTENT + NEVER-REGRESS (webhooks are retried and can arrive out of order):
--   * the payments update fires while the row is 'requires_payment' OR 'failed'
--     (the latter is the decline-then-succeed recovery on the reused intent), so
--     a second delivery (already 'held') is a no-op and a later 'released' /
--     'refunded' can never be dragged back to 'held';
--   * the posts update only fires while the post is still 'draft', so a second
--     delivery never regresses a post that has already moved to
--     pending_verification / active / etc.
--   * an UNKNOWN intent id (no matching ledger row) is a benign no-op (returns
--     silently) — a webhook for an intent we never recorded should not error the
--     handler; the event is still marked processed by claim_stripe_event.
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
begin
  -- Lock the matched ledger row so the payment + post transition is atomic
  -- against a concurrent redelivery of the same event.
  select post_id
    into v_post_id
  from public.payments
  where stripe_payment_intent_id = p_payment_intent_id
  for update;

  -- Benign no-op: a success webhook for an intent we never recorded.
  if not found then
    return;
  end if;

  -- Advance escrow -> held from requires_payment OR failed. The 'failed' case is
  -- the decline-then-succeed recovery: one PaymentIntent is reused per post
  -- (create-payment-intent's idempotency key), so a declined attempt fires
  -- payment_failed (row -> 'failed') and a later successful attempt on the SAME
  -- intent fires succeeded — that must capture the escrow, not be skipped and
  -- leave the ledger 'failed' while the post advances. Still guarded so a
  -- duplicate 'held' or a later released/refunded state is NEVER regressed.
  update public.payments
     set status = 'held'
   where stripe_payment_intent_id = p_payment_intent_id
     and status in ('requires_payment', 'failed');

  -- Advance the post draft -> pending_verification. Guarded on status='draft'
  -- so a duplicate/late delivery never pulls a later lifecycle state backwards.
  update public.posts
     set status = 'pending_verification'
   where id = v_post_id
     and status = 'draft';

  -- AUDIT: a money-state-transition audit-log insert belongs here once the
  -- audit_log table exists (SECURITY_AND_TRUST §7). Deferred with moderation.
end;
$$;

comment on function public.mark_post_payment_held(text) is
  'Escrow-success webhook handler. SECURITY DEFINER, service-role only. Atomically advances the matched payment requires_payment/failed -> held AND the post draft -> pending_verification. The failed->held path is the decline-then-succeed recovery on a reused PaymentIntent. IDEMPOTENT + never-regress: both updates are guarded so a duplicate or late webhook is a no-op and can never pull a later payment (held/released/refunded) or post state backwards. Unknown intent id = benign no-op.';


-- =============================================================================
-- 4. FUNCTION: mark_post_payment_failed(payment_intent_id)
-- =============================================================================
-- The escrow-FAILURE webhook handler. Sets the matched payments row to 'failed'
-- and LEAVES the post as 'draft' (the owner can retry the charge from the still-
-- draft post). Deliberately does NOT touch posts.status.
--
-- NEVER-REGRESS: only fails a row still in 'requires_payment', so a late/duplicate
-- payment_failed event can never wipe out escrow that has since been captured
-- ('held') or paid/refunded. Unknown intent id = benign no-op.
create or replace function public.mark_post_payment_failed(
  p_payment_intent_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Fail only a still-pending charge. If it is already held/released/refunded a
  -- stray failure event must NOT regress it (money-safety). No post status change.
  update public.payments
     set status = 'failed'
   where stripe_payment_intent_id = p_payment_intent_id
     and status = 'requires_payment';
end;
$$;

comment on function public.mark_post_payment_failed(text) is
  'Escrow-failure webhook handler. SECURITY DEFINER, service-role only. Sets the matched payment requires_payment -> failed and leaves the post as draft (owner may retry). NEVER-REGRESS: only fails a still-pending charge, so a late failure event cannot wipe out captured/released/refunded escrow. Unknown intent id = benign no-op.';


-- =============================================================================
-- 5. FUNCTION: claim_stripe_event(event_id) -> boolean  (webhook dedup gate)
-- =============================================================================
-- Records an event id as processed. Inserts into stripe_webhook_events and
-- returns TRUE if this call newly inserted it, FALSE if it already existed. The
-- webhook calls this AFTER the state change commits (process-then-record), so it
-- is used insert-only there — the boolean is available for a claim-before-act
-- caller but the current webhook dedups with a prior SELECT instead. The insert
-- is a single ON CONFLICT statement, so concurrent deliveries can't both insert.
create or replace function public.claim_stripe_event(
  p_event_id text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.stripe_webhook_events (event_id)
  values (p_event_id)
  on conflict (event_id) do nothing;

  -- FOUND is true only when the insert actually wrote a row (i.e. no conflict),
  -- i.e. THIS call is the one that claimed the event.
  return found;
end;
$$;

comment on function public.claim_stripe_event(text) is
  'Records a Stripe event id as processed. SECURITY DEFINER, service-role only. Inserts into stripe_webhook_events; returns TRUE if newly inserted, FALSE if already present. The webhook calls this AFTER committing the state change (process-then-record) and uses it insert-only; the boolean supports a claim-before-act caller. Single-statement insert-on-conflict, so concurrent deliveries cannot both insert.';


-- =============================================================================
-- 6. GRANTS  (service-role only — mirrors the payments ledger)
-- =============================================================================
-- SAFETY: functions default to EXECUTE granted to PUBLIC, and this project's
-- ALTER DEFAULT PRIVILEGES additionally auto-grants EXECUTE to anon at CREATE
-- time (see the note in 20260713190000_post_a_car.sql). These are MONEY-STATE
-- transitions called ONLY by the Edge Functions with the service-role key, so we
-- close BOTH gaps: revoke from public (covers authenticated, which only holds the
-- PUBLIC grant) AND explicitly from anon, then grant to service_role ONLY. No
-- client role may ever execute these.
revoke execute on function public.record_post_payment_intent(uuid, text, integer) from public, anon, authenticated;
grant  execute on function public.record_post_payment_intent(uuid, text, integer) to service_role;

revoke execute on function public.mark_post_payment_held(text) from public, anon, authenticated;
grant  execute on function public.mark_post_payment_held(text) to service_role;

revoke execute on function public.mark_post_payment_failed(text) from public, anon, authenticated;
grant  execute on function public.mark_post_payment_failed(text) to service_role;

revoke execute on function public.claim_stripe_event(text) from public, anon, authenticated;
grant  execute on function public.claim_stripe_event(text) to service_role;


-- =============================================================================
-- END OF MIGRATION
-- =============================================================================

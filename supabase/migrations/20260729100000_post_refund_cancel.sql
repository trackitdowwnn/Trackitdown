-- =============================================================================
-- WHAT:  The bounty-escrow REFUND slice (owner deactivates a paid post). Adds
--        two additive columns to public.payments (stripe_refund_id,
--        refunded_amount_pence) and one SECURITY DEFINER function —
--        mark_post_payment_refunded(payment_intent_id, refund_id,
--        refunded_amount_pence) — which atomically flips the matched escrow
--        payment 'held' -> 'refunded' AND its post 'active'/'pending_verification'
--        -> 'cancelled'. Service-role-only, mirroring the CHARGE slice
--        (20260726100000): the Stripe Edge Function / webhook call it with the
--        service-role key after issuing the Stripe refund.
-- WHY:   The charge slice shipped charge-only ("NOT payout/refunds"). DOMAIN.md
--        §lifecycle specifies `cancelled` = "owner cancelled before recovery;
--        bounty refunded", but there was no server boundary for it. This is that
--        boundary — the app's FIRST refund path. Clients can NEVER move
--        posts.status or the payments ledger (foundation migration 20260707110712
--        RLS/grants), so the transition MUST live in a SECURITY DEFINER function
--        the trusted server calls. The Stripe refund itself is issued by the
--        deactivate-post Edge Function (which reads the authoritative amount and
--        the non-recoverable card fee from Stripe); THIS function only records
--        the resulting money-state transition. Webhooks are retried / out of
--        order, so it is IDEMPOTENT and NEVER regresses a later state.
-- LINKS: docs/DOMAIN.md (lifecycle: cancelled/expired -> bounty refunded),
--        docs/SECURITY_AND_TRUST.md §4 (financial tables service-role only),
--          §6 (RLS deny-by-default; status server-only via SECURITY DEFINER),
--        docs/decisions/ADR-0002-stripe-connect.md (escrow captured to platform
--          balance = 'held'; refund returns it to the owner),
--        supabase/migrations/20260726100000_post_payment.sql (the CHARGE-slice
--          siblings record_post_payment_intent / mark_post_payment_held — this
--          mirrors mark_post_payment_held exactly),
--        supabase/migrations/20260707110712_payments_foundation.sql (payments
--          ledger + post_status/payment_status enums; both 'cancelled' and
--          'refunded' already exist — no enum change here),
--        supabase/functions/deactivate-post/index.ts (the caller),
--        supabase/functions/stripe-webhook/index.ts (charge.refunded confirm).
--
-- SAFETY (Tier 1 — MONEY-CRITICAL, read before editing anything below):
--   * SERVICE-ROLE ONLY. The function is granted to service_role ONLY (execute
--     revoked from public/anon/authenticated). Moving money state or posts.status
--     from a client is exactly what the foundation migration's RLS/grants forbid.
--   * NEVER REGRESSES. The payment update fires ONLY while the row is 'held', so
--     a duplicate/late webhook is a no-op and a later state is never dragged back
--     to 'refunded'. The post update fires ONLY while the post is 'active' OR
--     'pending_verification', so it can never pull a 'recovered'/'recovery_claimed'
--     post (or any other later state) backwards to 'cancelled'.
--   * IDEMPOTENT. A second delivery of the same refund updates 0 rows on both
--     statements — safe to call from BOTH the Edge Function (authoritative,
--     synchronous) and the charge.refunded webhook (belt-and-braces confirm).
--   * UNKNOWN INTENT = BENIGN NO-OP. A refund event for an intent we never
--     recorded returns silently (does not error the webhook handler).
--   * SECURITY DEFINER + set search_path = '' so it runs as the migration owner
--     and bypasses RLS to write the ledger / advance status — same pattern as the
--     charge slice. auth.uid() is irrelevant (the caller is the trusted service
--     role); OWNERSHIP is enforced UPSTREAM by the deactivate-post Edge Function
--     before the Stripe refund is issued.
--
-- SAFETY NOTE ON DESTRUCTIVE STATEMENTS: NONE. Fully additive — two new nullable
--        columns on public.payments (no default backfill, no rewrite of existing
--        rows) and one new function (+ grants + comment). No drop / rename /
--        truncate of any existing object.
-- =============================================================================


-- =============================================================================
-- 1. COLUMNS: payments.stripe_refund_id + payments.refunded_amount_pence
-- The refund leg of the escrow ledger. Both nullable — unknown until a refund
-- is issued. The withheld non-recoverable card fee is DERIVABLE as
-- amount_pence - refunded_amount_pence (no separate column needed).
-- =============================================================================
alter table public.payments
  add column stripe_refund_id text unique,
  add column refunded_amount_pence integer
    check (refunded_amount_pence is null or refunded_amount_pence >= 0);

comment on column public.payments.stripe_refund_id is
  'Stripe refund id (re_...) once the bounty is refunded to the owner on deactivation. Null until refunded. Unique: one refund tracked once.';
comment on column public.payments.refunded_amount_pence is
  'MONEY: amount actually refunded to the owner, integer pence GBP (bounty minus the non-recoverable Stripe processing fee). Null until refunded. Withheld fee = amount_pence - refunded_amount_pence.';


-- =============================================================================
-- 2. FUNCTION: mark_post_payment_refunded(payment_intent_id, refund_id, refunded_amount_pence)
-- =============================================================================
-- The refund-SUCCESS handler. Atomically (a) advances the matched payments row
-- 'held' -> 'refunded' (recording the refund id + refunded amount) and (b)
-- advances its post 'active'/'pending_verification' -> 'cancelled'. Called by the
-- deactivate-post Edge Function right after stripe.refunds.create succeeds, and
-- again (idempotently) by the charge.refunded webhook.
--
-- IDEMPOTENT + NEVER-REGRESS (webhooks are retried and can arrive out of order):
--   * the payments update fires only while the row is 'held', so a second
--     delivery (already 'refunded') is a no-op and a released/other state is
--     never dragged to 'refunded';
--   * the posts update fires only while the post is 'active' OR
--     'pending_verification', so a duplicate/late event never regresses a post
--     that has since moved on (e.g. recovery_claimed);
--   * an UNKNOWN intent id (no matching ledger row) is a benign no-op — a refund
--     webhook for an intent we never recorded should not error the handler.
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
begin
  -- Lock the matched ledger row so the payment + post transition is atomic
  -- against a concurrent redelivery of the same event.
  select post_id
    into v_post_id
  from public.payments
  where stripe_payment_intent_id = p_payment_intent_id
  for update;

  -- Benign no-op: a refund webhook for an intent we never recorded.
  if not found then
    return;
  end if;

  -- Advance escrow held -> refunded, recording the refund id + amount. Guarded
  -- on status='held' so a duplicate 'refunded' or any later state is NEVER
  -- regressed (money-safety). ON the same row so refunded_amount_pence /
  -- stripe_refund_id are only ever set on the real held->refunded transition.
  update public.payments
     set status                = 'refunded',
         stripe_refund_id      = p_refund_id,
         refunded_amount_pence = p_refunded_amount_pence
   where stripe_payment_intent_id = p_payment_intent_id
     and status = 'held';

  -- Advance the post -> cancelled, but ONLY from a refund-eligible paid state.
  -- Guarded so a duplicate/late delivery never pulls a later lifecycle state
  -- (recovery_claimed/recovered/...) backwards to cancelled.
  update public.posts
     set status = 'cancelled'
   where id = v_post_id
     and status in ('active', 'pending_verification');

  -- AUDIT: a money-state-transition audit-log insert belongs here once the
  -- audit_log table exists (SECURITY_AND_TRUST §7). Deferred with moderation.
end;
$$;

comment on function public.mark_post_payment_refunded(text, text, integer) is
  'Refund-success handler. SECURITY DEFINER, service-role only. Atomically advances the matched payment held -> refunded (recording refund id + refunded amount) AND its post active/pending_verification -> cancelled. IDEMPOTENT + never-regress: both updates are guarded so a duplicate or late webhook is a no-op and can never pull a later payment/post state backwards. Unknown intent id = benign no-op. Ownership is enforced upstream by the deactivate-post Edge Function.';


-- =============================================================================
-- 3. GRANTS  (service-role only — mirrors the charge-slice functions)
-- =============================================================================
-- SAFETY: functions default to EXECUTE granted to PUBLIC, and this project's
-- ALTER DEFAULT PRIVILEGES additionally auto-grants EXECUTE to anon at CREATE
-- time (see 20260713190000_post_a_car.sql). This is a MONEY-STATE transition
-- called ONLY by the Edge Functions with the service-role key, so close BOTH
-- gaps: revoke from public (covers authenticated) AND explicitly from anon, then
-- grant to service_role ONLY. No client role may ever execute it.
revoke execute on function public.mark_post_payment_refunded(text, text, integer) from public, anon, authenticated;
grant  execute on function public.mark_post_payment_refunded(text, text, integer) to service_role;


-- =============================================================================
-- END OF MIGRATION
-- =============================================================================

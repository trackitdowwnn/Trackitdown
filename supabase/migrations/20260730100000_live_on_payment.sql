-- =============================================================================
-- WHAT:  LIVE-ON-PAYMENT. Redefines public.mark_post_payment_held so the escrow-
--        success webhook advances the post 'draft' -> 'active' (publicly live)
--        instead of 'draft' -> 'pending_verification'. The payment leg is
--        unchanged (escrow still captured to 'held'); only the POST's target
--        status changes.
-- WHY:   For a stolen car, the first hours are what matter — the crowd must be
--        looking within minutes, not after a moderator clears a queue. The
--        pending_verification review gate (and the V5C proof it reviewed) was a
--        blocking pre-publish step; proof-of-ownership collection has been removed
--        from the app, and the product decision is to PUBLISH ON PAYMENT. Safety
--        moves from a blocking pre-check to reactive controls that don't cost the
--        critical window: every post is a paid, card-on-file, non-anonymous
--        account (traceable + costly to abuse), plus a report/flag path
--        (post_flags) and deliberate takedown (reuse the deactivate+refund path).
-- LINKS: docs/DOMAIN.md (lifecycle: draft -> active on payment; the reactive
--          safety model replacing the verification gate),
--        supabase/migrations/20260726100000_post_payment.sql (the original
--          mark_post_payment_held this replaces — everything else there stands),
--        supabase/functions/stripe-webhook/index.ts (calls this on
--          payment_intent.succeeded),
--        supabase/migrations/20260707110712_payments_foundation.sql (post_status
--          enum + the RLS posts_select_active_public policy that makes 'active'
--          the single publicly-visible state),
--        supabase/migrations/20260730110000_post_flags.sql (the report path).
--
-- SAFETY (Tier 1 — MONEY-CRITICAL):
--   * SERVICE-ROLE ONLY (grants unchanged from the original; re-asserted below).
--   * IDEMPOTENT + NEVER-REGRESS. The payment update still fires from
--     'requires_payment' OR 'failed' -> 'held' (decline-then-succeed recovery),
--     and the post update fires ONLY while the post is still 'draft', so a
--     duplicate/late webhook is a no-op and can never pull a later state
--     (active/recovered/cancelled/refunded) backwards. Unknown intent = no-op.
--   * VISIBILITY CHANGE: a post now becomes PUBLICLY VISIBLE ('active') on
--     payment with NO human pre-check. This is a deliberate product decision
--     (see WHY). The anti-abuse posture is documented in DOMAIN.md.
--
-- SAFETY NOTE ON DESTRUCTIVE STATEMENTS: none. CREATE OR REPLACE of one function
--        body (+ re-asserted grants). No table/column/policy/data dropped; the
--        pending_verification enum value remains (now unused by this path).
-- =============================================================================

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

  -- Advance escrow -> held from requires_payment OR failed (decline-then-succeed
  -- recovery on the reused intent). Guarded so a duplicate 'held' or a later
  -- released/refunded state is NEVER regressed.
  update public.payments
     set status = 'held'
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
  'Escrow-success webhook handler. SECURITY DEFINER, service-role only. Atomically advances the matched payment requires_payment/failed -> held AND the post draft -> ACTIVE (live-on-payment; proof-of-ownership + the pending_verification review gate were removed). IDEMPOTENT + never-regress: both updates are guarded so a duplicate or late webhook is a no-op and can never pull a later payment (held/released/refunded) or post state backwards. Unknown intent id = benign no-op.';

-- Re-assert the service-role-only grants (belt-and-braces; unchanged from the
-- original migration — CREATE OR REPLACE keeps existing grants, but state them).
revoke execute on function public.mark_post_payment_held(text) from public, anon, authenticated;
grant  execute on function public.mark_post_payment_held(text) to service_role;

-- =============================================================================
-- END OF MIGRATION
-- =============================================================================

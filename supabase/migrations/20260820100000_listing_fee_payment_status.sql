-- =============================================================================
-- WHAT:  Adds ONE value to the public.payment_status enum: 'collected'. Nothing
--        else. The columns, functions and constraints that use it land in
--        20260820110000_no_bounty_listing_fee.sql.
-- WHY:   A no-bounty listing is paid for with a FIXED PLATFORM FEE (£4.99)
--        instead of a percentage of an escrowed bounty. That fee is revenue the
--        moment it is captured — it is never held in escrow, never transferred
--        to a spotter, and never refunded (ADR-0014). It therefore needs a
--        terminal ledger state of its own.
--
--        WHY A NEW STATUS RATHER THAN REUSING 'held': every refund and payout
--        path in the system selects `payments ... where status = 'held'`
--        (_shared/refundEscrow.ts, _shared/releasePayout.ts,
--        mark_post_payment_refunded, mark_recovery_paid,
--        mark_post_recovered_no_spotter). A fee row that never enters 'held' is
--        invisible to every one of them BY DEFAULT — which is the safe
--        direction. Discriminating on a `kind` column alone would instead
--        require remembering to add a filter in each of those places, on the
--        money path, forever.
--
--        WHY ITS OWN MIGRATION: Postgres will not let an enum value be added and
--        then USED inside the same transaction, and Supabase runs each migration
--        file in one. Splitting is not stylistic — the next migration fails
--        outright if this value is added alongside it.
-- LINKS: docs/decisions/ADR-0014-no-bounty-listings.md (the decision);
--        supabase/migrations/20260707110712_payments_foundation.sql (defines
--          public.payment_status and the payments ledger);
--        supabase/migrations/20260820110000_no_bounty_listing_fee.sql (uses it);
--        docs/DOMAIN.md ("Listing pricing"); docs/SECURITY_AND_TRUST.md §4.
--
-- SAFETY (Tier 1 — MONEY-CRITICAL):
--   * PURELY ADDITIVE. Adding an enum value cannot invalidate an existing row,
--     constraint or function: every payments row keeps the status it had, and no
--     existing code path can produce 'collected' until the next migration adds
--     the function that writes it.
--   * NOT REVERSIBLE. Postgres cannot DROP a value from an enum. This is a
--     one-way door and is accepted deliberately — the alternative (a lookup
--     table) would rewrite the whole ledger's status column for one new state.
--   * ORDER IS NOT SEMANTIC. 'collected' is appended, so it sorts last. Nothing
--     compares payment_status by ordinal (every use is an equality or an IN
--     list); this was checked before appending rather than assumed.
--
-- SAFETY NOTE ON DESTRUCTIVE STATEMENTS: NONE. One ALTER TYPE ... ADD VALUE.
-- =============================================================================

-- IF NOT EXISTS makes a re-run a no-op, matching the idempotent posture of every
-- other money migration here (a partially-applied migration must be safe to
-- replay, and this one cannot be wrapped in the usual create-or-replace).
alter type public.payment_status add value if not exists 'collected';

comment on type public.payment_status is
  'Lifecycle of a single post payment. Two shapes share this ledger. BOUNTY ESCROW (ADR-0002, kind=bounty_escrow): requires_payment -> held -> released (transfer sent to the winning spotter, 95/5) | refunded (returned to the owner). LISTING FEE (ADR-0014, kind=listing_fee): requires_payment -> collected, a TERMINAL state — the fixed fee is platform revenue on capture, is never escrowed, never transferred and never refunded, and deliberately never enters ''held'' so that every refund/payout query (which all filter on held) skips it by construction. ''failed'' is shared by both. Written only by service role / Edge Functions.';


-- =============================================================================
-- END OF MIGRATION
-- =============================================================================

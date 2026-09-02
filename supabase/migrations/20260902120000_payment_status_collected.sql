-- =============================================================================
-- WHAT:  Adds `collected` to public.payment_status. NOTHING ELSE — no function
--        changes, no data changes, no row read.
-- WHY:   ADR-0018. A captured £5 listing fee currently sits in `held`, which is
--        the state every refund, payout, sweep and credited-notification query
--        selects on — so the fee is kept out of them only because five separate
--        call sites each REMEMBER to filter `kind = 'bounty_escrow'`. Those
--        filters were missing for four days once already and an hourly cron
--        refunded fees (ADR-0014's own correction). `collected` lets the ledger
--        say what is true — captured, ours, terminal — so the money queries stop
--        seeing a fee by construction rather than by five acts of memory.
--
-- ⚠️ ITS OWN MIGRATION, AND THAT IS THE ENTIRE REASON THIS FILE EXISTS. Since
--        PostgreSQL 12 `alter type … add value` may run inside a transaction,
--        but the new value CANNOT BE USED until that transaction commits. The
--        function change and the backfill in 20260902130000 both use it, so
--        they must be a separate file — the CLI runs each migration in its own
--        transaction, and that boundary is what makes the value usable.
--
--        Putting them together fails at apply time with "unsafe use of new
--        value of enum type", which would be a loud failure rather than a
--        dangerous one — but it would fail against PRODUCTION on a Deploy run.
--
-- SAFETY NOTE ON DESTRUCTIVE STATEMENTS: none, and this one is genuinely
--        one-way rather than merely irreversible-in-practice: an enum value
--        cannot be dropped once added. It is additive — every existing row and
--        every existing query is unaffected, because nothing produces the value
--        yet.
--
-- LINKS: docs/decisions/ADR-0018-fee-separation-by-construction.md;
--        supabase/migrations/20260902130000_fee_collected_not_held.sql (the
--          half that uses it); ADR-0014 (the property being bought back).
-- =============================================================================

alter type public.payment_status add value if not exists 'collected';

comment on type public.payment_status is
  'Escrow lifecycle for a bounty, plus the terminal state of a listing fee. requires_payment -> held -> released|refunded|failed for a bounty_escrow; requires_payment -> collected for a listing_fee, which is ours on capture and never refunded (ADR-0014, ADR-0018). `collected` exists so refund and payout queries — which all select on `held` — cannot see a fee at all. Written only by service role / Edge Functions.';

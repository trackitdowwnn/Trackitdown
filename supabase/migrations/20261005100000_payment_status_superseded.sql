-- =============================================================================
-- WHAT:  Adds `superseded` to public.payment_status. A superseded payment was
--        captured, is NOT the post's current reward, and is owed back to the
--        owner. The refund sweep returns it, and its refund never touches the
--        post.
-- WHY:   Stripe caps funds held on the platform balance at 90 days (lead
--        support, 2026-10-05), so a reward gets a term and a RENEWAL: a new
--        charge is taken first, then the old one is refunded. For the short
--        time between those two steps the old charge is neither `held` (only
--        one payment per post may be held) nor `refunded` (no money has moved
--        yet). This is that state. It also gives a stray capture (a late
--        success on a voided intent, or a charge landing on a closed post)
--        somewhere honest to go, instead of a second `held` row.
--
-- ⚠️ ITS OWN FILE ON PURPOSE. A new enum value cannot be USED in the
--        transaction that adds it, and every migration runs in one transaction.
--        20261005110000 uses it, so the value must already be committed — the
--        same split as 20260902120000_payment_status_collected.sql.
--
-- SAFETY NOTE ON DESTRUCTIVE STATEMENTS: none. One additive enum value.
-- LINKS: supabase/migrations/20261005110000_a_reward_can_be_replaced.sql;
--        supabase/migrations/20260902120000_payment_status_collected.sql.
-- =============================================================================

alter type public.payment_status add value if not exists 'superseded';

-- =============================================================================
-- END OF MIGRATION
-- =============================================================================

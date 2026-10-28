-- =============================================================================
-- WHAT: A signed-in owner can no longer UPDATE their posts row directly. Every
--       draft edit — the reward included — goes through the SECURITY DEFINER
--       section RPCs (update_post_bounty and siblings), which is all the app
--       has ever used.
--
-- WHY:  20260707110712 gave `authenticated` a column UPDATE grant (re-issued
--       in full by 20260711130000 and 20260802110000) plus the
--       posts_update_own_draft policy, so a raw PostgREST PATCH could rewrite
--       bounty_amount_pence on an own draft. Nothing in src/ or
--       supabase/functions/ writes posts directly (checked 2026-10-28, and no
--       SECURITY INVOKER function on prod updates posts), so the grant was a
--       second, unguarded door to the reward next to update_post_bounty — the
--       server-side half of #255's "draft edits locked while paid".
--       A paid reward still cannot be swapped for a different figure either
--       way: mark_post_payment_held refunds any charge whose amount is not the
--       draft's bounty at capture. This closes the door rather than relying on
--       that refund.
--
-- HOW:  Revoke UPDATE on the table (every column) from anon and authenticated
--       and drop the now-unreachable draft UPDATE policy. INSERT, SELECT and
--       service_role are untouched. The RPCs are SECURITY DEFINER, so they
--       keep writing exactly as before.
-- =============================================================================

revoke update on public.posts from anon, authenticated;

drop policy if exists posts_update_own_draft on public.posts;

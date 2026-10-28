-- =============================================================================
-- WHAT: A signed-in user can no longer INSERT a posts row directly. Every
--       listing is created by create_post, which is all the app has ever used.
--
-- WHY:  20260707110712 gave `authenticated` a column INSERT grant (re-issued in
--       full by 20260711130000 and 20260802110000) plus the
--       posts_insert_own_draft policy, so a raw PostgREST POST could create a
--       draft that skipped every create_post check — plate format and
--       one-live-listing-per-plate, 3–6 own-folder photos, the V5C path, the
--       stolen_from/keys_taken enums — and then be paid for and go live.
--       Nothing in src/ or supabase/functions/ inserts posts directly, and no
--       SECURITY INVOKER function on prod does (checked 2026-10-28). The
--       INSERT twin of 20261028120000.
--
-- HOW:  Revoke INSERT on the table (every column) from anon and authenticated
--       and drop the now-unreachable policy. SELECT and service_role are
--       untouched; create_post is SECURITY DEFINER and keeps working.
-- =============================================================================

revoke insert on public.posts from anon, authenticated;

drop policy if exists posts_insert_own_draft on public.posts;

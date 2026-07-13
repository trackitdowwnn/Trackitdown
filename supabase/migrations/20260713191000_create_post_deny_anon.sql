-- =============================================================================
-- WHAT:  Explicitly revoke EXECUTE on public.create_post(...) from the anon role.
-- WHY:   20260713190000 intended create_post to be callable by authenticated +
--        service_role ONLY (never anon — posting a car needs a real account that
--        owns the post and the V5C). It did `revoke ... from public` + `grant ...
--        to authenticated, service_role`, which is NOT enough on Supabase: the
--        project ships `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE
--        ON FUNCTIONS TO anon, authenticated, service_role`, so a new public
--        function is auto-granted to anon at CREATE time — a grant that
--        `revoke ... from public` does not touch. Verified against the live DB:
--        an anon REST call reached the function body (returned NOT_AUTHENTICATED,
--        the auth.uid() guard) rather than a 42501 permission error.
--
--        create_post stays SAFE either way — its first act is to raise
--        NOT_AUTHENTICATED when auth.uid() is null, so anon can create nothing
--        and read nothing. This migration closes the gap at the GRANT layer too
--        (defense in depth) so the deny matches the function's documented intent
--        and a future edit to the guard can't silently open anon writes.
-- LINKS: supabase/migrations/20260713190000_post_a_car.sql (defines create_post);
--        docs/SECURITY_AND_TRUST.md §6 (RLS/grants deny-by-default; posting
--        requires a signed-in account).
--
-- SAFETY NOTE ON DESTRUCTIVE STATEMENTS: NONE beyond the intended revoke. Only
--        removes anon's EXECUTE; authenticated + service_role grants are
--        untouched. Idempotent (REVOKE of an absent privilege is a no-op).
-- =============================================================================

revoke execute on function public.create_post(
  text, text, text, text, int, text, text, text, text, text, text, text,
  timestamptz, double precision, double precision, text, int, text[], text[], text
) from anon;

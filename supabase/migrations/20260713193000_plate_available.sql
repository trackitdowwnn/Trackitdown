-- =============================================================================
-- WHAT:  public.plate_available(p_plate) -> boolean. True when NO post is
--        already live/in-flight for the plate (space-insensitive canon match
--        against status active / pending_verification / recovery_claimed).
-- WHY:   The post-a-car wizard's plate step gives early feedback ("there's
--        already an active post for this plate") before the owner fills in the
--        rest — the create_post RPC still re-checks at submit (the enforcement).
--        SECURITY DEFINER so the check also covers pending_verification /
--        recovery_claimed posts, which RLS hides from a client SELECT — but it
--        returns ONLY a boolean, never any row, so no hidden post leaks. Mirrors
--        the exact uniqueness predicate in create_post (SECURITY_AND_TRUST §2:
--        one active post per plate).
-- LINKS: supabase/migrations/20260713190000_post_a_car.sql (create_post's
--          matching uniqueness gate); src/features/vehicles/post/api/postApi.ts
--          (checkPlateAvailable). docs/SECURITY_AND_TRUST.md §2/§6.
--
-- SAFETY NOTE ON DESTRUCTIVE STATEMENTS: NONE. One new function + grants. No
--        drop/rename. Read-only (stable) — writes nothing.
-- =============================================================================

create or replace function public.plate_available(p_plate text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (
    select 1
    from public.posts p
    where upper(regexp_replace(coalesce(p.plate, ''),  '[^A-Za-z0-9]', '', 'g'))
        = upper(regexp_replace(coalesce(p_plate, ''),  '[^A-Za-z0-9]', '', 'g'))
      and p.status in ('active', 'pending_verification', 'recovery_claimed')
  );
$$;

comment on function public.plate_available(text) is
  'True when no active/pending_verification/recovery_claimed post exists for the plate (canon, space-insensitive). Early UX check for the post-a-car plate step; create_post re-checks at submit. SECURITY DEFINER (sees RLS-hidden in-flight posts) but returns only a boolean.';

-- SAFETY: signed-in users only (posting needs an account). Revoke the default
-- PUBLIC grant AND anon (Supabase default privileges auto-grant anon on new
-- public functions — same gap as create_post).
revoke execute on function public.plate_available(text) from public, anon;
grant  execute on function public.plate_available(text) to authenticated, service_role;

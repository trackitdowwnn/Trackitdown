-- =============================================================================
-- WHAT:  Verification for 20261028140000_a_draft_is_created_only_through_create_post.sql.
--        NOT a migration.
-- WHY:   A raw POST could create a draft that skipped create_post's checks
--        (plate, photos, V5C path) and then be paid for and go live.
-- CHECKS: 1 ⚠️ no client role holds INSERT on any posts column, and the draft
-- INSERT policy is gone · 2 ⚠️ the owner's direct insert is 42501 and creates
-- nothing. (create_post itself: create_post_verification.sql.)
-- HOW:   Self-asserting, RAISE on failure (CI's db job), inside begin/rollback.
--        Acts as seed user Alex (1111…).
-- LINKS: supabase/migrations/20261028140000_a_draft_is_created_only_through_create_post.sql.
-- =============================================================================

begin;

select set_config('request.jwt.claims',
  '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', true);

-- CHECK 1 — the grants and the policy.
do $$
begin
  if has_any_column_privilege('authenticated', 'public.posts', 'INSERT')
     or has_any_column_privilege('anon', 'public.posts', 'INSERT') then
    raise exception 'CHECK 1 FAILED: a client role can still INSERT a posts column.';
  end if;
  if exists (select 1 from pg_policies
              where schemaname = 'public' and tablename = 'posts'
                and policyname = 'posts_insert_own_draft') then
    raise exception 'CHECK 1 FAILED: posts_insert_own_draft still exists.';
  end if;
  raise notice 'CHECK 1 passed: no client INSERT on posts, draft INSERT policy dropped.';
end $$;

-- CHECK 2 — the owner's own direct insert is refused and creates nothing.
do $$
declare
  v_err text := 'none';
begin
  set local role authenticated;
  begin
    insert into public.posts (owner_id, plate, make, model, colour, bounty_amount_pence)
    values ('11111111-1111-1111-1111-111111111111', 'DI01 AAA', 'Ford', 'Focus', 'Blue', 25000);
  exception when insufficient_privilege then v_err := 'denied'; end;
  reset role;
  if v_err <> 'denied' then
    raise exception 'CHECK 2 FAILED: the owner inserted a post directly.';
  end if;
  if exists (select 1 from public.posts where plate = 'DI01 AAA') then
    raise exception 'CHECK 2 FAILED: a post was created.';
  end if;
  raise notice 'CHECK 2 passed: a direct insert is 42501.';
end $$;

rollback;

-- =============================================================================
-- WHAT:  Verification for 20261028120000_a_draft_is_edited_only_through_its_rpcs.sql.
--        NOT a migration.
-- WHY:   A raw PATCH on an own draft could rewrite the reward next to
--        update_post_bounty (#255's open server half). The RPC must stay the
--        only way in, and must still refuse once the listing is paid.
-- CHECKS: 1 ⚠️ no client role holds UPDATE on any posts column, and the draft
-- UPDATE policy is gone · 2 ⚠️ the owner's direct reward write is 42501 and
-- changes nothing · 3 update_post_bounty still edits an own draft · 4 ⚠️ it
-- still refuses a live (paid) listing.
-- HOW:   Self-asserting, RAISE on failure (CI's db job), inside begin/rollback.
--        Acts as seed user Alex (1111…).
-- LINKS: supabase/migrations/20261028120000_a_draft_is_edited_only_through_its_rpcs.sql,
--        supabase/migrations/20260813120000_bounty_minimum_ten.sql (update_post_bounty).
-- =============================================================================

begin;

insert into public.posts (id, owner_id, status, bounty_amount_pence, plate)
values ('dddd0000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'draft',  25000, 'DR01 AAA'),
       ('dddd0000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'active', 25000, 'DR02 AAA');

select set_config('request.jwt.claims',
  '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', true);

-- CHECK 1 — the grants and the policy.
do $$
begin
  if has_any_column_privilege('authenticated', 'public.posts', 'UPDATE')
     or has_any_column_privilege('anon', 'public.posts', 'UPDATE') then
    raise exception 'CHECK 1 FAILED: a client role can still UPDATE a posts column.';
  end if;
  if exists (select 1 from pg_policies
              where schemaname = 'public' and tablename = 'posts'
                and policyname = 'posts_update_own_draft') then
    raise exception 'CHECK 1 FAILED: posts_update_own_draft still exists.';
  end if;
  raise notice 'CHECK 1 passed: no client UPDATE on posts, draft UPDATE policy dropped.';
end $$;

-- CHECK 2 — the owner's own direct write is refused and leaves the reward alone.
do $$
declare
  v_err text := 'none';
begin
  set local role authenticated;
  begin
    update public.posts set bounty_amount_pence = 100000
     where id = 'dddd0000-0000-0000-0000-000000000001';
  exception when insufficient_privilege then v_err := 'denied'; end;
  reset role;
  if v_err <> 'denied' then
    raise exception 'CHECK 2 FAILED: the owner wrote bounty_amount_pence directly.';
  end if;
  if (select bounty_amount_pence from public.posts
       where id = 'dddd0000-0000-0000-0000-000000000001') <> 25000 then
    raise exception 'CHECK 2 FAILED: the reward changed.';
  end if;
  raise notice 'CHECK 2 passed: a direct reward write is 42501.';
end $$;

-- CHECK 3 — the RPC still edits an own draft.
set local role authenticated;
select public.update_post_bounty('dddd0000-0000-0000-0000-000000000001', 30000);
reset role;
do $$
begin
  if (select bounty_amount_pence from public.posts
       where id = 'dddd0000-0000-0000-0000-000000000001') <> 30000 then
    raise exception 'CHECK 3 FAILED: update_post_bounty no longer edits a draft.';
  end if;
  raise notice 'CHECK 3 passed: update_post_bounty edits an own draft.';
end $$;

-- CHECK 4 — and still refuses a live listing.
do $$
declare
  v_err text := 'none';
begin
  set local role authenticated;
  begin
    perform public.update_post_bounty('dddd0000-0000-0000-0000-000000000002', 100000);
  exception when others then v_err := sqlerrm; end;
  reset role;
  if v_err <> 'POST_NOT_EDITABLE' then
    raise exception 'CHECK 4 FAILED: a live listing''s reward was editable (got %).', v_err;
  end if;
  if (select bounty_amount_pence from public.posts
       where id = 'dddd0000-0000-0000-0000-000000000002') <> 25000 then
    raise exception 'CHECK 4 FAILED: the live reward changed.';
  end if;
  raise notice 'CHECK 4 passed: a live listing''s reward is refused (POST_NOT_EDITABLE).';
end $$;

rollback;

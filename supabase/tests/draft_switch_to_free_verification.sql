-- =============================================================================
-- WHAT:  Verification for 20261028130000_a_draft_can_switch_to_free.sql.
--        NOT a migration.
-- WHY:   The Reward editor's "no reward" sends NULL, which update_post_bounty
--        refused (BOUNTY_OUT_OF_RANGE), so a draft could never become free.
-- CHECKS: 1 ⚠️ NULL makes an own draft free · 2 a reward can be put back ·
-- 3 ⚠️ an out-of-range reward is still refused and changes nothing.
-- HOW:   Self-asserting, RAISE on failure (CI's db job), inside begin/rollback.
--        Acts as seed user Alex (1111…).
-- LINKS: supabase/migrations/20261028130000_a_draft_can_switch_to_free.sql,
--        src/features/vehicles/components/editors/BountyEditor.tsx.
-- =============================================================================

begin;

insert into public.posts (id, owner_id, status, bounty_amount_pence, plate)
values ('dfdf0000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'draft', 25000, 'DF01 AAA');

select set_config('request.jwt.claims',
  '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', true);

-- CHECK 1 — NULL switches the draft to free.
set local role authenticated;
select public.update_post_bounty('dfdf0000-0000-0000-0000-000000000001', null);
reset role;
do $$
begin
  if (select bounty_amount_pence from public.posts
       where id = 'dfdf0000-0000-0000-0000-000000000001') is not null then
    raise exception 'CHECK 1 FAILED: the draft still has a reward.';
  end if;
  raise notice 'CHECK 1 passed: NULL makes an own draft a free listing.';
end $$;

-- CHECK 2 — and back to a reward.
set local role authenticated;
select public.update_post_bounty('dfdf0000-0000-0000-0000-000000000001', 1000);
reset role;
do $$
begin
  if (select bounty_amount_pence from public.posts
       where id = 'dfdf0000-0000-0000-0000-000000000001') is distinct from 1000 then
    raise exception 'CHECK 2 FAILED: the reward was not put back.';
  end if;
  raise notice 'CHECK 2 passed: a free draft can offer a reward again.';
end $$;

-- CHECK 3 — the range still holds.
do $$
declare
  v_err text := 'none';
begin
  set local role authenticated;
  begin
    perform public.update_post_bounty('dfdf0000-0000-0000-0000-000000000001', 999);
  exception when others then v_err := sqlerrm; end;
  reset role;
  if v_err <> 'BOUNTY_OUT_OF_RANGE' then
    raise exception 'CHECK 3 FAILED: £9.99 was accepted (got %).', v_err;
  end if;
  if (select bounty_amount_pence from public.posts
       where id = 'dfdf0000-0000-0000-0000-000000000001') is distinct from 1000 then
    raise exception 'CHECK 3 FAILED: the refused edit changed the reward.';
  end if;
  raise notice 'CHECK 3 passed: an out-of-range reward is still BOUNTY_OUT_OF_RANGE.';
end $$;

rollback;

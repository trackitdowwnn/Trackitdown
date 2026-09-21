-- =============================================================================
-- Deletion-warning verification (NOT a migration — do not place in migrations/).
--
-- SELF-ASSERTING: seeded begin…rollback blocks that RAISE EXCEPTION on
-- failure. Properties (docs/TESTING.md Tier 1): the warning fires once and
-- only once per post, only for cancelled posts past the 27-day fuse, with
-- private copy (the car, never the plate); and the purge structurally cannot
-- delete a post whose warning is missing or under 72 hours old.
--
-- Run against a local DB seeded by supabase/seed.sql:
--     supabase db reset
--     psql -v ON_ERROR_STOP=1 "$DATABASE_URL" -f supabase/tests/deletion_warning_verification.sql
--
-- Functions under test (20260921120000_a_warning_comes_before_the_purge.sql):
-- claim_cancelled_deletion_warnings(p_limit), purge_cancelled_posts().
-- =============================================================================


-- -----------------------------------------------------------------------------
-- CHECK 1-5 — the claim: due posts are returned with honest, private copy;
-- young, active, and already-warned posts are not; a second call claims
-- nothing (idempotence).
-- -----------------------------------------------------------------------------
begin;
do $$
declare
  v_due    uuid := 'de1e1e1e-0000-0000-0000-000000000001';
  v_young  uuid := 'de1e1e1e-0000-0000-0000-000000000002';
  v_active uuid := 'de1e1e1e-0000-0000-0000-000000000003';
  v_owner  uuid := '11111111-1111-1111-1111-111111111111';
  v_rows   jsonb;
  v_row    jsonb;
begin
  -- 28 days closed → due for its warning.
  insert into public.posts
    (id, owner_id, status, bounty_amount_pence, plate, make, model, colour, closed_at)
  values
    (v_due, v_owner, 'cancelled', 25000, 'DW11 ARN', 'Ford', 'Fiesta', 'Blue',
     now() - interval '28 days');
  -- 5 days closed → far from the fuse.
  insert into public.posts (id, owner_id, status, bounty_amount_pence, plate, closed_at)
  values (v_young, v_owner, 'cancelled', 25000, 'DW12 ARN', now() - interval '5 days');
  -- ACTIVE post, old — must never be warned about deletion it is not facing.
  insert into public.posts (id, owner_id, status, bounty_amount_pence, plate)
  values (v_active, v_owner, 'active', 25000, 'DW13 ARN');

  v_rows := public.claim_cancelled_deletion_warnings(500);

  -- CHECK 1: the due post is claimed, addressed to its owner.
  select e into v_row
    from jsonb_array_elements(v_rows) e
   where (e ->> 'post_id')::uuid = v_due;
  if v_row is null then
    raise exception 'CHECK 1 FAILED: a cancelled post 28 days past closing was not warned -- the purge''s precondition never arrives and retention stalls for ever';
  end if;
  if (v_row ->> 'user_id')::uuid <> v_owner then
    raise exception 'CHECK 1 FAILED: the warning is addressed to % rather than the owner', v_row ->> 'user_id';
  end if;

  -- CHECK 2: copy carries the car and never the plate.
  if v_row ->> 'title' not like '%Blue Ford Fiesta%' then
    raise exception 'CHECK 2 FAILED: the title does not name the car (got %) -- an owner with two cancelled posts cannot tell which one this is', v_row ->> 'title';
  end if;
  if (v_row ->> 'title') like '%DW11%' or (v_row ->> 'body') like '%DW11%' then
    raise exception 'CHECK 2 FAILED: the plate leaked into push copy';
  end if;

  -- CHECK 3: the young and the active posts were not claimed.
  if exists (
    select 1 from jsonb_array_elements(v_rows) e
     where (e ->> 'post_id')::uuid in (v_young, v_active)
  ) then
    raise exception 'CHECK 3 FAILED: a young or ACTIVE post was warned about deletion it is not facing';
  end if;
  if (select deletion_warned_at from public.posts where id = v_active) is not null then
    raise exception 'CHECK 3 FAILED: an active post was stamped';
  end if;

  -- CHECK 4: the stamp landed on the claimed post.
  if (select deletion_warned_at from public.posts where id = v_due) is null then
    raise exception 'CHECK 4 FAILED: the claim returned the post but did not stamp it -- every sweep would re-send the warning';
  end if;

  -- CHECK 5: a second call claims nothing for it — one warning per post, ever.
  v_rows := public.claim_cancelled_deletion_warnings(500);
  if exists (
    select 1 from jsonb_array_elements(v_rows) e
     where (e ->> 'post_id')::uuid = v_due
  ) then
    raise exception 'CHECK 5 FAILED: the same post was claimed twice -- the owner would be re-warned every hour';
  end if;

  raise notice 'CHECKS 1-5 passed: claim is due-only, private, stamped, and once-ever';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 6 — the purge waits out the 72 hours: a 31-day post warned 1 hour ago
-- survives the purge; the same post warned 4 days ago goes.
-- -----------------------------------------------------------------------------
begin;
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate, closed_at, deletion_warned_at)
values ('de1e1e1e-0000-0000-0000-000000000004',
        '11111111-1111-1111-1111-111111111111', 'cancelled', 25000, 'DW14 ARN',
        now() - interval '31 days', now() - interval '1 hour');
insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence)
values ('de1e1e1e-0000-0000-0000-000000000004', 'pi_warn_6', 'refunded', 25000);

do $$
begin
  perform public.purge_cancelled_posts();
  if not exists (select 1 from public.posts where id = 'de1e1e1e-0000-0000-0000-000000000004') then
    raise exception 'CHECK 6 FAILED: purged one hour after the warning -- the 72-hour notice window is the whole point of warning at all';
  end if;

  update public.posts
     set deletion_warned_at = now() - interval '4 days'
   where id = 'de1e1e1e-0000-0000-0000-000000000004';

  perform public.purge_cancelled_posts();
  if exists (select 1 from public.posts where id = 'de1e1e1e-0000-0000-0000-000000000004') then
    raise exception 'CHECK 6 FAILED: a warned post past the window was not purged';
  end if;
  raise notice 'CHECK 6 passed: the purge waits 72 hours past the warning, then acts';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 7 — GRANTS: the claim is service_role only. Client-executable would
-- let anyone stamp warnings and start the 72-hour purge clock on posts they
-- do not own.
-- -----------------------------------------------------------------------------
do $$
begin
  if has_function_privilege('authenticated', 'public.claim_cancelled_deletion_warnings(integer)', 'execute')
     or has_function_privilege('anon', 'public.claim_cancelled_deletion_warnings(integer)', 'execute') then
    raise exception 'CHECK 7 FAILED: claim_cancelled_deletion_warnings is client-executable';
  end if;
  if not has_function_privilege('service_role', 'public.claim_cancelled_deletion_warnings(integer)', 'execute') then
    raise exception 'CHECK 7 FAILED: service_role cannot claim deletion warnings -- the sweep is broken';
  end if;
  raise notice 'CHECK 7 passed: claim is service_role only';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 8 — the persist half accepts the kind: a notifications row of kind
-- deletion_soon is writable. (The push_sends side and the client mirror are
-- pinned by supabase/tests/notificationKinds.test.ts, which parses the LATEST
-- push_sends_kind_chk out of the migrations.)
-- -----------------------------------------------------------------------------
begin;
do $$
begin
  insert into public.notifications (user_id, kind, title, body, payload)
  values ('11111111-1111-1111-1111-111111111111', 'deletion_soon', 't', 'b',
          '{"type":"deletion_soon","postId":"de1e1e1e-0000-0000-0000-000000000001"}'::jsonb);
  raise notice 'CHECK 8 passed: deletion_soon is a valid notifications kind';
exception when check_violation then
  raise exception 'CHECK 8 FAILED: deletion_soon rejected by notifications_kind_chk -- the warning would fail at write';
end $$;
rollback;

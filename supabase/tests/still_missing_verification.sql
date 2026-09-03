-- =============================================================================
-- WHAT:  Tier 1 verification for the ADR-0019 liveness check — the two fuses,
--        the cap, the reset, the ownership scope, and the property the whole
--        design rests on: it moves NOTHING. NOT a migration.
-- WHY:   This is the first thing in the system that acts on a CLOCK against a
--        live post, and the reason passive expiry was cut is that a clock which
--        touches strangers' money is not something anyone should trust. So the
--        load-bearing assertion here is not "does it ask" — it is CHECK 7:
--        after a full cycle of asks, `posts.status` and every `payments` row
--        are byte-for-byte what they were.
--
--        The cap is the second: three asks per case, ever. Without CHECK 5 a
--        broken predicate would push at a theft victim every seven days
--        forever, and the person least likely to complain about it is exactly
--        the person who has stopped opening the app.
--
-- CHECKS: 1 the long fuse (14 days) claims, and a young post is left alone ·
-- 2 the claim is idempotent within the window · 3 the short fuse (7 days)
-- re-asks and counts · 4 the copy carries the car and no plate · 5 ⚠️ THE CAP
-- holds at 3 · 6 confirm resets the clock AND the counter · 7 ⚠️ NOTHING MOVED
-- — status and payments unchanged · 8 confirm is owner-scoped, one opaque token
-- · 9 activated_at is frozen once set · 10 grants.
-- LINKS: supabase/migrations/20260902140000_still_missing_check.sql;
--        docs/decisions/ADR-0019-the-abandoned-post.md;
--        supabase/functions/release-held-refunds/index.ts (the only caller).
--
-- SELF-ASSERTING: every check RAISES on failure (ON_ERROR_STOP=1). Everything
-- runs inside begin/rollback, so the seeded posts are never left moved.
-- =============================================================================

begin;
do $$
declare
  -- Two posts of our own rather than seeded ones: this suite needs to control
  -- activated_at exactly, and the trigger FREEZES it after insert — so the only
  -- honest way to set it is to supply it at insert time, which the trigger
  -- honours on INSERT alone.
  v_old      uuid := 'd0d0d0d0-0000-0000-0000-000000000001';
  v_young    uuid := 'd0d0d0d0-0000-0000-0000-000000000002';
  v_owner    uuid := '22222222-2222-2222-2222-222222222222';
  v_stranger uuid := '11111111-1111-1111-1111-111111111111';
  v_rows     jsonb;
  v_row      jsonb;
  v_count    int;
  v_status   text;
  v_pay      text;
  v_asked    timestamptz;
begin
  insert into public.posts
    (id, owner_id, status, bounty_amount_pence, plate, make, model, colour,
     last_seen_at, last_seen_area, activated_at, created_at)
  values
    (v_old, v_owner, 'active', 25000, 'SM19 OLD', 'Ford', 'Fiesta', 'Blue',
     now() - interval '30 days', 'Manchester', now() - interval '30 days',
     now() - interval '30 days'),
    (v_young, v_owner, 'active', 25000, 'SM19 NEW', 'Audi', 'A3', 'White',
     now() - interval '3 days', 'Manchester', now() - interval '3 days',
     now() - interval '3 days');

  -- A payment on the old post, so CHECK 7 has something to prove is untouched.
  insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence, kind)
  values (v_old, 'pi_test_still_missing', 'held', 25000, 'bounty_escrow');

  -- ---------------------------------------------------------------------
  -- CHECK 1 — the long fuse. 30 days silent is due; 3 days is not.
  -- ---------------------------------------------------------------------
  v_rows := public.claim_still_missing_checks(500);

  if not exists (
    select 1 from jsonb_array_elements(v_rows) e
     where (e ->> 'post_id')::uuid = v_old
  ) then
    raise exception 'CHECK 1 FAILED: a post active and unconfirmed for 30 days was not asked -- the 14-day fuse never fires, which is the whole feature';
  end if;

  if exists (
    select 1 from jsonb_array_elements(v_rows) e
     where (e ->> 'post_id')::uuid = v_young
  ) then
    raise exception 'CHECK 1 FAILED: a post live for 3 days was asked -- the fuse is measured wrong, and every new owner would be interrupted on day one';
  end if;

  select still_missing_ask_count, still_missing_asked_at
    into v_count, v_asked
    from public.posts where id = v_old;
  if v_count <> 1 or v_asked is null then
    raise exception 'CHECK 1 FAILED: the claim did not stamp the post (count=%, asked_at=%)', v_count, v_asked;
  end if;

  -- ---------------------------------------------------------------------
  -- CHECK 2 — idempotent within the window. The sweep runs HOURLY; if the
  -- claim did not hold, an abandoned post would be pushed at 24 times a day.
  -- ---------------------------------------------------------------------
  v_rows := public.claim_still_missing_checks(500);
  if exists (
    select 1 from jsonb_array_elements(v_rows) e
     where (e ->> 'post_id')::uuid = v_old
  ) then
    raise exception 'CHECK 2 FAILED: the same post was claimed twice in a row -- the sweep runs hourly, so this is 24 pushes a day at a theft victim';
  end if;

  select still_missing_ask_count into v_count from public.posts where id = v_old;
  if v_count <> 1 then
    raise exception 'CHECK 2 FAILED: a refused claim still moved the counter (count=%)', v_count;
  end if;

  -- ---------------------------------------------------------------------
  -- CHECK 3 — the short fuse. Eight days after an unanswered ask, we re-ask.
  -- ---------------------------------------------------------------------
  update public.posts
     set still_missing_asked_at = now() - interval '8 days'
   where id = v_old;

  v_rows := public.claim_still_missing_checks(500);
  select e into v_row
    from jsonb_array_elements(v_rows) e
   where (e ->> 'post_id')::uuid = v_old;

  if v_row is null then
    raise exception 'CHECK 3 FAILED: an unanswered ask 8 days old was not repeated -- the 7-day re-ask never fires';
  end if;

  select still_missing_ask_count into v_count from public.posts where id = v_old;
  if v_count <> 2 then
    raise exception 'CHECK 3 FAILED: the second ask did not increment the counter (count=%)', v_count;
  end if;

  -- ---------------------------------------------------------------------
  -- CHECK 4 — the copy. The CAR, because an owner with two posts cannot act
  -- on "is your car still missing?"; and NO PLATE, which is personal data
  -- that must never transit push (SECURITY_AND_TRUST §3).
  -- ---------------------------------------------------------------------
  if v_row ->> 'title' not like '%Blue Ford Fiesta%' then
    raise exception 'CHECK 4 FAILED: the title does not name the car (%) -- an owner with two live posts cannot tell which one is being asked about', v_row ->> 'title';
  end if;

  if (v_row ->> 'title') || (v_row ->> 'body') like '%SM19 OLD%' then
    raise exception 'CHECK 4 FAILED: the plate reached the push copy -- personal data, and push is third-party infrastructure';
  end if;

  if (v_row ->> 'user_id')::uuid <> v_owner then
    raise exception 'CHECK 4 FAILED: the ask is addressed to % rather than the owner', v_row ->> 'user_id';
  end if;

  -- ---------------------------------------------------------------------
  -- CHECK 5 — ⚠️ THE CAP. Three asks per case, then silence forever.
  -- ---------------------------------------------------------------------
  update public.posts
     set still_missing_ask_count = 3,
         still_missing_asked_at  = now() - interval '60 days'
   where id = v_old;

  v_rows := public.claim_still_missing_checks(500);
  if exists (
    select 1 from jsonb_array_elements(v_rows) e
     where (e ->> 'post_id')::uuid = v_old
  ) then
    raise exception 'CHECK 5 FAILED: a post at the 3-ask cap was asked again -- uncapped, this pushes at a theft victim every 7 days forever, and they are the least likely person to complain';
  end if;

  -- ---------------------------------------------------------------------
  -- CHECK 6 — the owner answers. Clock reset, counter reset: answering earns
  -- a FULL fresh cycle rather than a shrinking allowance.
  -- ---------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);

  perform public.confirm_still_missing(v_old);

  select still_missing_ask_count, still_missing_asked_at
    into v_count, v_asked
    from public.posts where id = v_old;
  if v_count <> 0 or v_asked is not null then
    raise exception 'CHECK 6 FAILED: confirming did not reset the ask (count=%, asked_at=%)', v_count, v_asked;
  end if;

  if (select still_missing_confirmed_at from public.posts where id = v_old) is null then
    raise exception 'CHECK 6 FAILED: confirming did not stamp still_missing_confirmed_at, so the long fuse would re-fire immediately';
  end if;

  -- A just-confirmed post is not due again for 14 days.
  perform set_config('request.jwt.claims', null, true);
  v_rows := public.claim_still_missing_checks(500);
  if exists (
    select 1 from jsonb_array_elements(v_rows) e
     where (e ->> 'post_id')::uuid = v_old
  ) then
    raise exception 'CHECK 6 FAILED: a post confirmed seconds ago was asked again -- confirming buys nothing';
  end if;

  -- ---------------------------------------------------------------------
  -- CHECK 7 — ⚠️ NOTHING MOVED. The load-bearing one. Three asks and a
  -- confirmation later, the post is still active and the escrow is still
  -- exactly where it was. Passive expiry was cut deliberately (DOMAIN.md:
  -- "every refund is a human act") and this must never quietly reinstate it.
  -- ---------------------------------------------------------------------
  select status::text into v_status from public.posts where id = v_old;
  if v_status <> 'active' then
    raise exception 'CHECK 7 FAILED: the liveness check moved the post to % -- it must change no status, ever', v_status;
  end if;

  select status::text into v_pay
    from public.payments where post_id = v_old and kind = 'bounty_escrow';
  if v_pay <> 'held' then
    raise exception 'CHECK 7 FAILED: the escrow moved to % -- a clock that touches strangers'' money is the exact thing passive expiry was cut to prevent', v_pay;
  end if;

  if exists (select 1 from public.refund_holds where post_id = v_old) then
    raise exception 'CHECK 7 FAILED: a refund hold was created -- the dispute machinery must stay owner-initiated';
  end if;

  -- ---------------------------------------------------------------------
  -- CHECK 8 — confirm is owner-scoped, and refuses with ONE opaque token so
  -- it cannot be used to probe for post ids.
  -- ---------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
  begin
    perform public.confirm_still_missing(v_old);
    raise exception 'CHECK 8 FAILED: a stranger confirmed someone else''s post';
  exception
    when sqlstate 'P0001' then
      if sqlerrm <> 'POST_NOT_FOUND' then
        raise exception 'CHECK 8 FAILED: a stranger got % rather than the opaque POST_NOT_FOUND -- distinct tokens make this an existence oracle', sqlerrm;
      end if;
  end;

  -- A post id that does not exist raises the IDENTICAL token.
  begin
    perform public.confirm_still_missing('d0d0d0d0-0000-0000-0000-0000000000ff');
    raise exception 'CHECK 8 FAILED: confirming a non-existent post succeeded';
  exception
    when sqlstate 'P0001' then
      if sqlerrm <> 'POST_NOT_FOUND' then
        raise exception 'CHECK 8 FAILED: a missing post raised % rather than POST_NOT_FOUND', sqlerrm;
      end if;
  end;

  -- ---------------------------------------------------------------------
  -- CHECK 9 — activated_at is FROZEN. Without this, any later write to a live
  -- post would push the anchor forward and the ask could never come due.
  -- ---------------------------------------------------------------------
  perform set_config('request.jwt.claims', null, true);
  update public.posts
     set activated_at = now(), colour = 'Green'
   where id = v_old;

  if (select activated_at from public.posts where id = v_old) > now() - interval '29 days' then
    raise exception 'CHECK 9 FAILED: activated_at moved -- an owner editing their post would reset the liveness clock indefinitely';
  end if;

  raise notice 'still_missing CHECKS 1-9 passed';
end $$;

-- -----------------------------------------------------------------------------
-- CHECK 10 — grants. The claim is service-role only (it takes no caller and
-- performs no auth.uid() check, so a client grant would let anyone burn every
-- owner's ask allowance). The two owner RPCs are authenticated-only.
-- -----------------------------------------------------------------------------
do $$
declare
  v_service_only text := 'public.claim_still_missing_checks(integer)';
  v_client text[] := array[
    'public.confirm_still_missing(uuid)',
    'public.list_my_open_still_missing_asks()'];
  fn text;
begin
  -- Prove the inventory first: every assertion below would otherwise raise an
  -- opaque "function does not exist" if a signature had drifted.
  foreach fn in array v_client || array[v_service_only] loop
    if to_regprocedure(fn) is null then
      raise exception 'CHECK 10 FAILED: % does not exist -- the migration chain is half-applied or a signature drifted', fn;
    end if;
    if has_function_privilege('anon', fn, 'EXECUTE') then
      raise exception 'CHECK 10 FAILED: anon can EXECUTE %', fn;
    end if;
  end loop;

  if has_function_privilege('authenticated', v_service_only, 'EXECUTE') then
    raise exception 'CHECK 10 FAILED: authenticated can EXECUTE % -- it performs no auth.uid() check, so a client grant lets anyone burn every owner''s three asks', v_service_only;
  end if;
  if not has_function_privilege('service_role', v_service_only, 'EXECUTE') then
    raise exception 'CHECK 10 FAILED: service_role CANNOT EXECUTE % -- the sweep needs it', v_service_only;
  end if;

  foreach fn in array v_client loop
    if not has_function_privilege('authenticated', fn, 'EXECUTE') then
      raise exception 'CHECK 10 FAILED: authenticated CANNOT EXECUTE % -- the in-app door depends on it', fn;
    end if;
  end loop;

  raise notice 'still_missing CHECK 10 passed';
end $$;

rollback;

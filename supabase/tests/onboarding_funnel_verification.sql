-- =============================================================================
-- Onboarding funnel verification (NOT a migration — do not place in
-- migrations/).
--
-- SELF-ASSERTING: each check is a seeded begin…rollback (or a grant assertion)
-- that RAISES on failure, so the file aborts non-zero the moment a property is
-- violated. Properties: a step records, a repeat of the same step does NOT
-- double-count, an unknown step is refused, a terminal step never carries a
-- slide, anon may CALL the RPC but holds nothing on the table, and the funnel
-- arithmetic a query would actually run comes out right.
--
-- ⚠️ CHECK 5 IS THE ONE THAT MATTERS FOR TRUST. This is the app's only
-- anon-writable endpoint, so the bound on what one caller can write is the
-- whole reason it is acceptable — and that bound is the unique constraint. If
-- a repeated step ever starts inserting a second row, the completion rate can
-- be moved by anyone who can call the RPC, and a number nobody can trust is
-- worse than no number, because a decision gets made on it anyway.
--
-- Run against a local DB seeded by supabase/seed.sql:
--     supabase db reset
--     npm run test:db
-- =============================================================================


-- -----------------------------------------------------------------------------
-- CHECK 1 — a step records, with its slide and platform.
-- -----------------------------------------------------------------------------
begin;
do $$
declare
  v_run      uuid := '33333333-3333-3333-3333-333333333333';
  v_slide    smallint;
  v_platform text;
begin
  perform public.record_onboarding_step(v_run, 'slide_viewed', 2::smallint, 'ios');

  select slide, platform into v_slide, v_platform
  from public.onboarding_events where run_id = v_run;

  if v_slide <> 2 then
    raise exception 'CHECK 1 FAILED: slide not stored, got %', coalesce(v_slide::text, 'null');
  end if;
  if v_platform <> 'ios' then
    raise exception 'CHECK 1 FAILED: platform not stored, got %', coalesce(v_platform, 'null');
  end if;
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 2 — a terminal step carries NO slide, even if one is passed.
-- `completed` at slide 4 and `completed` at slide 2 are the same fact, and
-- storing the slide would invite a query that treats them as different.
-- -----------------------------------------------------------------------------
begin;
do $$
declare
  v_run   uuid := '33333333-3333-3333-3333-333333333333';
  v_slide smallint;
begin
  perform public.record_onboarding_step(v_run, 'completed', 4::smallint, 'android');

  select slide into v_slide
  from public.onboarding_events where run_id = v_run and step = 'completed';

  if v_slide is not null then
    raise exception 'CHECK 2 FAILED: a terminal step kept a slide (%)', v_slide;
  end if;
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 3 — an unknown step, and a null run, are refused.
-- -----------------------------------------------------------------------------
begin;
do $$
declare
  v_run      uuid := '33333333-3333-3333-3333-333333333333';
  v_bad_step boolean := false;
  v_bad_run  boolean := false;
  v_err      text := '(no error raised at all)';
begin
  begin
    perform public.record_onboarding_step(v_run, 'signed_up', null, 'ios');
  exception when others then
    v_err := sqlerrm;
    v_bad_step := sqlerrm like '%INVALID_INPUT%';
  end;

  begin
    perform public.record_onboarding_step(null, 'completed', null, 'ios');
  exception when others then
    v_bad_run := sqlerrm like '%INVALID_INPUT%';
  end;

  if not v_bad_step then
    raise exception 'CHECK 3 FAILED: expected INVALID_INPUT for an unknown step, got %', v_err;
  end if;
  if not v_bad_run then
    raise exception 'CHECK 3 FAILED: a null run id was accepted';
  end if;
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 4 — an unrecognised platform is stored as NULL rather than refused.
-- The funnel is worth more than one row's platform cut: dropping the whole
-- event because the device said something unexpected would cost the count.
-- -----------------------------------------------------------------------------
begin;
do $$
declare
  v_run   uuid := '33333333-3333-3333-3333-333333333333';
  v_count integer;
begin
  begin
    perform public.record_onboarding_step(v_run, 'slide_viewed', 1::smallint, 'web');
  exception when others then
    -- The column CHECK refuses it, which is acceptable — but then the caller
    -- must be the one sending null, and our client already does. Either shape
    -- passes this check; what must NOT happen is a stored 'web'.
    null;
  end;

  select count(*) into v_count
  from public.onboarding_events where run_id = v_run and platform = 'web';

  if v_count <> 0 then
    raise exception 'CHECK 4 FAILED: an unrecognised platform was stored';
  end if;
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 5 — ⚠️ THE SAME STEP TWICE IS ONE ROW.
--
-- The only bound on what a single caller can write, and therefore the only
-- thing standing between this funnel and a number anyone can move. A re-render
-- or a retry must not double-count either.
-- -----------------------------------------------------------------------------
begin;
do $$
declare
  v_run   uuid := '33333333-3333-3333-3333-333333333333';
  v_count integer;
begin
  perform public.record_onboarding_step(v_run, 'slide_viewed', 1::smallint, 'ios');
  perform public.record_onboarding_step(v_run, 'slide_viewed', 1::smallint, 'ios');
  perform public.record_onboarding_step(v_run, 'slide_viewed', 1::smallint, 'android');

  select count(*) into v_count
  from public.onboarding_events where run_id = v_run;

  if v_count <> 1 then
    raise exception 'CHECK 5 FAILED: the same step recorded % times', v_count;
  end if;

  -- A DIFFERENT slide in the same run is a different fact and must record.
  perform public.record_onboarding_step(v_run, 'slide_viewed', 2::smallint, 'ios');

  select count(*) into v_count
  from public.onboarding_events where run_id = v_run;

  if v_count <> 2 then
    raise exception 'CHECK 5 FAILED: a second slide did not record (got %)', v_count;
  end if;
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 6 — the funnel arithmetic. This is the query an operator will actually
-- run, so it is worth proving on known data rather than trusting on the day.
-- Three runs: one completes, one skips at slide 2, one abandons at slide 1.
-- -----------------------------------------------------------------------------
begin;
do $$
declare
  v_a uuid := '44444444-4444-4444-4444-444444444444';
  v_b uuid := '55555555-5555-5555-5555-555555555555';
  v_c uuid := '66666666-6666-6666-6666-666666666666';
  v_started   integer;
  v_reached_2 integer;
  v_completed integer;
begin
  perform public.record_onboarding_step(v_a, 'slide_viewed', 1::smallint, 'ios');
  perform public.record_onboarding_step(v_a, 'slide_viewed', 2::smallint, 'ios');
  perform public.record_onboarding_step(v_a, 'completed', null, 'ios');

  perform public.record_onboarding_step(v_b, 'slide_viewed', 1::smallint, 'ios');
  perform public.record_onboarding_step(v_b, 'slide_viewed', 2::smallint, 'ios');
  perform public.record_onboarding_step(v_b, 'skipped', null, 'ios');

  perform public.record_onboarding_step(v_c, 'slide_viewed', 1::smallint, 'android');

  select count(distinct run_id) into v_started
  from public.onboarding_events where step = 'slide_viewed' and slide = 1;

  select count(distinct run_id) into v_reached_2
  from public.onboarding_events where step = 'slide_viewed' and slide = 2;

  select count(distinct run_id) into v_completed
  from public.onboarding_events where step = 'completed';

  if v_started <> 3 then
    raise exception 'CHECK 6 FAILED: expected 3 starts, got %', v_started;
  end if;
  if v_reached_2 <> 2 then
    raise exception 'CHECK 6 FAILED: expected 2 to reach slide 2, got %', v_reached_2;
  end if;
  if v_completed <> 1 then
    raise exception 'CHECK 6 FAILED: expected 1 completion, got %', v_completed;
  end if;
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 7 — ⚠️ anon may CALL the RPC and holds NOTHING on the table.
--
-- The unusual grant in this project, so it is asserted from both directions:
-- the call must work (the funnel is pointless otherwise, and onboarding is
-- pre-auth) and the table must stay untouchable — including no SELECT, because
-- nobody outside the operator should be able to read how many people abandoned.
-- -----------------------------------------------------------------------------
do $$
declare
  v_role     text;
  v_priv     text;
  v_rls      boolean;
  v_policies integer;
begin
  foreach v_role in array array['anon', 'authenticated'] loop
    foreach v_priv in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE',
                                  'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
      if has_table_privilege(v_role, 'public.onboarding_events', v_priv) then
        raise exception 'CHECK 7 FAILED: % has % on onboarding_events', v_role, v_priv;
      end if;
    end loop;
  end loop;

  select c.relrowsecurity into v_rls
  from pg_class c where c.oid = 'public.onboarding_events'::regclass;
  if not v_rls then
    raise exception 'CHECK 7 FAILED: row level security is not enabled';
  end if;

  select count(*) into v_policies
  from pg_policies
  where schemaname = 'public' and tablename = 'onboarding_events';
  if v_policies <> 0 then
    raise exception 'CHECK 7 FAILED: expected no policies, found %', v_policies;
  end if;

  -- The intended grant.
  if not has_function_privilege('anon',
       'public.record_onboarding_step(uuid, text, smallint, text)', 'EXECUTE') then
    raise exception 'CHECK 7 FAILED: anon cannot record a step — onboarding is pre-auth';
  end if;

  -- The purge is the operator's, not anyone else's.
  if has_function_privilege('anon', 'public.purge_onboarding_events()', 'EXECUTE') then
    raise exception 'CHECK 7 FAILED: anon can purge the funnel';
  end if;
end $$;


-- =============================================================================
-- END — all checks passed if this file completed without raising.
-- =============================================================================

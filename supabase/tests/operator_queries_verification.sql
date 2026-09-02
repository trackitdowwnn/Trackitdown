-- =============================================================================
-- Operator query verification (NOT a migration — do not place in migrations/).
--
-- WHAT:  Executes every query in docs/OPERATIONS.md against the real schema.
-- WHY:   ⚠️ A RUNBOOK OF PLAUSIBLE-BUT-BROKEN SQL IS WORSE THAN NO RUNBOOK. It
--        fails at the exact moment somebody needs it — and the moment somebody
--        needs the disputes query is inside a 72-hour window that closes
--        whether or not anyone managed to read it.
--
--        These queries name columns across six tables that no application code
--        touches, so nothing else in the repo would notice them drifting. A
--        column rename anywhere in `bug_reports`, `refund_disputes`,
--        `payout_reviews`, `post_flags`, `flags` or `onboarding_events` breaks
--        the runbook silently. This file is what makes that loud.
--
--        It asserts the queries RUN, not what they return — the tables are
--        empty on a fresh reset and the counts are nobody's business but the
--        operator's. Executing is the property worth pinning: a wrong column
--        name raises, and under ON_ERROR_STOP that fails the run.
--
--        This suite already earned itself: the FIRST execution of these suites
--        (2026-08-24, PR #66) failed on a stale function signature in
--        bug_reports_verification, which nothing else had caught.
--
-- LINKS: docs/OPERATIONS.md — ⚠️ EDIT BOTH TOGETHER. If you change a query
--        there and not here, this file stops guarding the thing it exists for.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- CHECK 1 — §1 Bug reports. The widest query in the runbook: twelve columns
-- across two migrations (the table, then the details that widened it).
-- -----------------------------------------------------------------------------
do $$
declare
  v_count integer;
begin
  select count(*) into v_count from (
    select
      b.created_at, b.severity, b.frequency, b.area, b.message, b.expected,
      b.app_version, b.platform, b.os_version, b.device_model,
      coalesce(array_length(b.screenshot_paths, 1), 0) as screenshots,
      b.breadcrumbs
    from public.bug_reports b
    order by (b.severity = 'lost') desc, b.created_at desc
    limit 50
  ) q;
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 2 — §2 Refund disputes. ⚠️ The 72-hour queue. If any query in the
-- runbook must not be broken, it is this one.
-- -----------------------------------------------------------------------------
do $$
declare
  v_count integer;
begin
  select count(*) into v_count from (
    select
      d.created_at, d.status, d.statement, d.post_id, d.sighting_id,
      d.spotter_id, d.resolved_at
    from public.refund_disputes d
    where d.status = 'open'
    order by d.created_at asc
    limit 50
  ) q;
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 3 — §3 Payout reviews. `reasons` is text[], which reads fine and
-- would break a query that assumed text.
-- -----------------------------------------------------------------------------
do $$
declare
  v_count integer;
begin
  select count(*) into v_count from (
    select r.created_at, r.post_id, r.owner_id, r.spotter_id, r.reasons
    from public.payout_reviews r
    order by r.created_at asc
    limit 50
  ) q;
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 4 — §4 Safety reports, both tables. The generic `flags` table carries
-- target_type/target_id rather than a post_id, and the two are easy to confuse.
-- -----------------------------------------------------------------------------
do $$
declare
  v_count integer;
begin
  select count(*) into v_count from (
    select f.created_at, f.post_id, f.reporter_id, f.reason
    from public.post_flags f
    order by f.created_at desc
    limit 50
  ) q;

  select count(*) into v_count from (
    select f.created_at, f.target_type, f.target_id, f.reporter_id, f.reason
    from public.flags f
    order by f.created_at desc
    limit 50
  ) q;
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 5 — §5 The onboarding funnel, both halves.
-- -----------------------------------------------------------------------------
do $$
declare
  v_count integer;
begin
  select count(*) into v_count from (
    select e.slide, count(distinct e.run_id) as runs
    from public.onboarding_events e
    where e.step = 'slide_viewed'
      and e.at > now() - interval '30 days'
    group by e.slide
    order by e.slide
  ) q;

  select count(*) into v_count from (
    select e.step, e.platform, count(distinct e.run_id) as runs
    from public.onboarding_events e
    where e.step in ('completed', 'skipped')
      and e.at > now() - interval '30 days'
    group by e.step, e.platform
    order by e.step, e.platform
  ) q;
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 6 — the funnel query returns what the runbook claims it does.
--
-- The one place asserting "it runs" is not enough: the completion rate is a
-- RATIO of two of these queries, and a wrong grouping would produce a number
-- that looks reasonable and is false. Seeded, computed, checked, rolled back.
-- -----------------------------------------------------------------------------
begin;
do $$
declare
  v_a uuid := '77777777-7777-7777-7777-777777777777';
  v_b uuid := '88888888-8888-8888-8888-888888888888';
  v_started   integer;
  v_completed integer;
begin
  -- One run finishes, one abandons on slide 1.
  perform public.record_onboarding_step(v_a, 'slide_viewed', 1::smallint, 'ios');
  perform public.record_onboarding_step(v_a, 'completed', null, 'ios');
  perform public.record_onboarding_step(v_b, 'slide_viewed', 1::smallint, 'ios');

  select runs into v_started from (
    select e.slide, count(distinct e.run_id) as runs
    from public.onboarding_events e
    where e.step = 'slide_viewed' and e.at > now() - interval '30 days'
    group by e.slide order by e.slide
  ) q where q.slide = 1;

  select sum(runs) into v_completed from (
    select e.step, e.platform, count(distinct e.run_id) as runs
    from public.onboarding_events e
    where e.step in ('completed', 'skipped') and e.at > now() - interval '30 days'
    group by e.step, e.platform
  ) q where q.step = 'completed';

  if v_started <> 2 then
    raise exception 'CHECK 6 FAILED: the runbook start query counted % of 2 runs', v_started;
  end if;
  if v_completed <> 1 then
    raise exception 'CHECK 6 FAILED: the runbook completion query counted % of 1', v_completed;
  end if;
end $$;
rollback;


-- =============================================================================
-- CHECK 7 — OPERATIONS.md §6, the telemetry funnel.
-- =============================================================================
-- Same contract as CHECK 6: the runbook's queries must actually run and must
-- actually count. A funnel query that silently returns nothing is worse than no
-- query, because the answer "no events" is indistinguishable from "the query is
-- broken" — and that is the reading somebody will act on.
begin;
do $$
declare
  v_session uuid := '11111111-1111-4111-8111-111111111111';
  v_other   uuid := '22222222-2222-4222-8222-222222222222';
  v_events  integer;
  v_errors  integer;
  v_ordered integer;
begin
  perform public.record_telemetry_events(v_session, jsonb_build_array(
    jsonb_build_object('event', 'feed_load', 'feature', 'search-map', 'level', 'info',
                       'props', jsonb_build_object('count', 12), 'platform', 'ios',
                       'app_version', '1.0.0'),
    jsonb_build_object('event', 'gate_shown', 'feature', 'auth', 'level', 'info',
                       'platform', 'ios', 'app_version', '1.0.0'),
    jsonb_build_object('event', 'error_upload_failed', 'feature', 'sightings',
                       'level', 'error', 'platform', 'ios', 'app_version', '1.0.0')
  ));
  perform public.record_telemetry_events(v_other, jsonb_build_array(
    jsonb_build_object('event', 'feed_load', 'feature', 'search-map', 'level', 'info',
                       'platform', 'android', 'app_version', '1.0.0')
  ));

  -- Query 1: which events fire. feed_load is two events across two sessions.
  select sessions into v_events from (
    select t.feature, t.event, count(*) as events, count(distinct t.session_id) as sessions
    from public.telemetry_events t
    where t.level = 'info' and t.at > now() - interval '7 days'
    group by t.feature, t.event
  ) q where q.event = 'feed_load';

  -- Query 2: what is failing.
  select errors into v_errors from (
    select t.feature, t.event, t.app_version, count(*) as errors
    from public.telemetry_events t
    where t.level = 'error' and t.at > now() - interval '7 days'
    group by t.feature, t.event, t.app_version
  ) q where q.event = 'error_upload_failed';

  -- Query 3: one session in order.
  select count(*) into v_ordered from (
    select t.at, t.feature, t.event, t.props
    from public.telemetry_events t
    where t.session_id = v_session
    order by t.at
  ) q;

  if v_events <> 2 then
    raise exception 'CHECK 7 FAILED: the funnel query counted % of 2 sessions', v_events;
  end if;
  if v_errors <> 1 then
    raise exception 'CHECK 7 FAILED: the error query counted % of 1', v_errors;
  end if;
  if v_ordered <> 3 then
    raise exception 'CHECK 7 FAILED: the session query returned % of 3 rows', v_ordered;
  end if;
end $$;
rollback;


-- =============================================================================
-- CHECK 8 — the props contract holds, and one bad event does not lose a batch.
-- =============================================================================
-- ⚠️ THIS IS THE SAFETY CHECK. props is the only place unconstrained data could
-- enter telemetry_events, and on a stolen-car app the thing that must never
-- land there is a coordinate or a plate. The CLIENT applies a key denylist
-- (telemetry.ts), but the client is not the boundary — these are the server's
-- own rules, asserted here because nothing else executes them.
begin;
do $$
declare
  v_session uuid := '33333333-3333-4333-8333-333333333333';
  v_written integer;
  v_rows    integer;
begin
  -- Three of these four are malformed. The valid one must still land: a batch
  -- is fire-and-forget, and one bad event discarding 49 good ones would lose
  -- data silently at exactly the moment something is already wrong.
  select public.record_telemetry_events(v_session, jsonb_build_array(
    -- Valid.
    jsonb_build_object('event', 'feed_load', 'feature', 'search-map', 'level', 'info'),
    -- Nested props: rejected by the trigger.
    jsonb_build_object('event', 'nested_bag', 'feature', 'search-map', 'level', 'info',
                       'props', jsonb_build_object('inner', jsonb_build_object('a', 1))),
    -- Prose event name: rejected by the CHECK constraint.
    jsonb_build_object('event', 'Not An Event Name', 'feature', 'search-map', 'level', 'info'),
    -- Unknown level: rejected by the CHECK constraint.
    jsonb_build_object('event', 'bad_level', 'feature', 'search-map', 'level', 'trace')
  )) into v_written;

  if v_written <> 1 then
    raise exception 'CHECK 8 FAILED: expected 1 of 4 events written, got %', v_written;
  end if;

  select count(*) into v_rows from public.telemetry_events where session_id = v_session;
  if v_rows <> 1 then
    raise exception 'CHECK 8 FAILED: expected 1 row for the session, got %', v_rows;
  end if;

  -- A string over 200 chars is the other way to smuggle a payload in.
  select public.record_telemetry_events(v_session, jsonb_build_array(
    jsonb_build_object('event', 'long_value', 'feature', 'search-map', 'level', 'info',
                       'props', jsonb_build_object('note', repeat('x', 201)))
  )) into v_written;
  if v_written <> 0 then
    raise exception 'CHECK 8 FAILED: a 201-char props value was accepted';
  end if;

  -- More than 8 keys.
  select public.record_telemetry_events(v_session, jsonb_build_array(
    jsonb_build_object('event', 'wide_bag', 'feature', 'search-map', 'level', 'info',
                       'props', jsonb_build_object('a',1,'b',2,'c',3,'d',4,'e',5,'f',6,'g',7,'h',8,'i',9))
  )) into v_written;
  if v_written <> 0 then
    raise exception 'CHECK 8 FAILED: a 9-key props bag was accepted';
  end if;
end $$;
rollback;


-- =============================================================================
-- CHECK 9 — telemetry_events is operator-only for reads.
-- =============================================================================
-- anon may CALL the RPC and must still hold nothing on the table itself. This
-- is the property the migration's explicit `revoke all` exists to create, and
-- the one that silently breaks if somebody adds a per-table grant later.
do $$
declare
  v_grants text;
begin
  select string_agg(distinct privilege_type, ',' order by privilege_type)
    into v_grants
  from information_schema.role_table_grants
  where table_schema = 'public'
    and table_name = 'telemetry_events'
    and grantee in ('anon', 'authenticated');

  if v_grants is not null then
    raise exception 'CHECK 9 FAILED: anon/authenticated hold % on telemetry_events', v_grants;
  end if;
end $$;


-- =============================================================================
-- END — all checks passed if this file completed without raising.
-- =============================================================================


-- =============================================================================
-- CHECK 10 — OPERATIONS.md §7, sweep health. Added 2026-09-02.
-- =============================================================================
-- ⚠️ THIS QUERY IS THE ONLY THING THAT WOULD TELL ANYONE RETENTION HAD STOPPED.
-- release-held-refunds carries four jobs; three of them — the notification
-- purge, the 90-day location purge (a promise published on the website) and
-- orphaned-photo removal (GDPR erasure) — fail in total silence if it stops
-- firing. A broken health query would therefore be worse than none, because it
-- is the thing someone reaches for when they already suspect a problem.
--
-- Both directions are asserted. A check that only proves "healthy when fresh"
-- would pass just as happily if `healthy` were hardcoded true.
begin;
do $$
declare
  v_doc jsonb;
begin
  delete from public.sweep_runs;

  -- (a) Never run. Must be distinguishable from "ran a while ago": it points at
  --     the cron job or its Vault secret, not at the function.
  v_doc := public.sweep_health();
  if v_doc->'last_run_at' <> 'null'::jsonb then
    raise exception 'CHECK 10 FAILED: an empty table did not report last_run_at null';
  end if;
  if (v_doc->>'healthy')::boolean is distinct from false then
    raise exception 'CHECK 10 FAILED: a sweep that has never run reported healthy';
  end if;

  -- (b) A fresh completed run is healthy, and carries its counters back.
  perform public.record_sweep_run(jsonb_build_object('refunded', 2, 'locationsPurged', 7));
  v_doc := public.sweep_health();
  if (v_doc->>'healthy')::boolean is distinct from true then
    raise exception 'CHECK 10 FAILED: a run seconds ago was not healthy';
  end if;
  if (v_doc->'last_summary'->>'locationsPurged') <> '7' then
    raise exception 'CHECK 10 FAILED: the counters did not survive the round trip: %', v_doc;
  end if;

  -- (c) ⚠️ THE THRESHOLD. One missed hour is ordinary and must NOT alarm;
  --     three is a fault. A check that cries wolf is how the SQL suites came to
  --     sit red for a month.
  update public.sweep_runs set ran_at = now() - interval '90 minutes';
  if (public.sweep_health()->>'healthy')::boolean is distinct from true then
    raise exception 'CHECK 10 FAILED: 90 minutes was reported unhealthy — one missed run must not alarm';
  end if;

  update public.sweep_runs set ran_at = now() - interval '4 hours';
  if (public.sweep_health()->>'healthy')::boolean is distinct from false then
    raise exception 'CHECK 10 FAILED: 4 hours was reported healthy — retention could be stopped and nothing would say so';
  end if;

  -- (d) Self-trimming, because a table that proves the scheduler ran must not
  --     depend on the scheduler to stay bounded.
  insert into public.sweep_runs (ran_at, summary)
  values (now() - interval '100 days', '{}'::jsonb);
  perform public.record_sweep_run('{}'::jsonb);
  if exists (select 1 from public.sweep_runs where ran_at < now() - interval '90 days') then
    raise exception 'CHECK 10 FAILED: rows older than 90 days survived a recorded run';
  end if;

  -- (e) A malformed summary must never fail a sweep — the write is monitoring,
  --     and monitoring must not be the thing that breaks a refund.
  perform public.record_sweep_run('"not an object"'::jsonb);
  perform public.record_sweep_run(null);

  raise notice 'CHECK 10 passed: sweep_health distinguishes never-run, fresh, one miss and three; the table self-trims; a bad summary cannot fail a run.';
end $$;
rollback;

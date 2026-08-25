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
-- END — all checks passed if this file completed without raising.
-- =============================================================================

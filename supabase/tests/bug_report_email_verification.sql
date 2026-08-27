-- =============================================================================
-- Bug report EMAIL-CLAIM verification (NOT a migration — do not place in
-- migrations/).
--
-- SELF-ASSERTING: each check is a seeded begin…rollback (or a grant assertion)
-- that RAISES on failure, so the file aborts non-zero the moment a property is
-- violated. Properties: submit_bug_report returns the id of the row it wrote,
-- claim_bug_report_email serves THAT report and no other, never serves it
-- twice, never serves another reporter's, and is executable by the service
-- role alone.
--
-- ⚠️ CHECK 4 IS THE REGRESSION TEST FOR A REAL INCIDENT (2026-08-27). The first
-- design had no id to work with — submit_bug_report returned void — so the
-- claim took the reporter's OLDEST unsent report and assumed that was the one
-- just filed. It was not: two reports from an hour earlier were still unsent,
-- so the operator was emailed those while the new reports sat unsent, and one
-- missed dispatch would have offset every later report permanently. CHECK 4
-- seeds exactly that shape and proves the NEW report is what comes back.
--
-- ⚠️ CHECK 3 IS THE OTHER HALF. The id now arrives FROM A CLIENT, so it is
-- exactly the kind of value a patched client could invent. The claim must serve
-- a row only when its reporter_id is the actor.
--
-- Run against a local DB seeded by supabase/seed.sql:
--     supabase db reset
--     npm run test:db
-- =============================================================================

-- -----------------------------------------------------------------------------
-- CHECK 1 — submit returns the id it wrote, and the claim returns that report.
-- -----------------------------------------------------------------------------
begin;
do $$
declare
  v_id      uuid;
  v_result  jsonb;
  v_emailed timestamptz;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);

  select public.submit_bug_report(
    'the map went blank when I opened it', '1.0.0', 'ios', '18.2', 'iPhone 14',
    'explore', 'blocked', 'always', 'it should show pins',
    array['10:00:00 info map:feed_mounted'], null) into v_id;

  if v_id is null then
    raise exception 'CHECK 1 FAILED: submit_bug_report returned no id';
  end if;
  -- The id must name the row that was actually written, or everything
  -- downstream is naming something else.
  if not exists (select 1 from public.bug_reports b where b.id = v_id
                   and b.message = 'the map went blank when I opened it') then
    raise exception 'CHECK 1 FAILED: the returned id does not name the new report';
  end if;

  v_result := public.claim_bug_report_email(
    '11111111-1111-1111-1111-111111111111', v_id);

  if not (v_result->>'claimed')::boolean then
    raise exception 'CHECK 1 FAILED: a freshly filed report was not claimable';
  end if;
  if (v_result->>'id')::uuid <> v_id then
    raise exception 'CHECK 1 FAILED: the claim returned a different report';
  end if;
  if v_result->>'message' <> 'the map went blank when I opened it' then
    raise exception 'CHECK 1 FAILED: message not returned, got %',
      quote_literal(v_result->>'message');
  end if;
  -- The operator needs the reporter's own words AND the triage fields, or the
  -- email is a notification rather than a report.
  if v_result->>'expected' <> 'it should show pins'
     or v_result->>'severity' <> 'blocked'
     or v_result->>'area' <> 'explore' then
    raise exception 'CHECK 1 FAILED: triage fields missing from the claim';
  end if;

  select b.emailed_at into v_emailed from public.bug_reports b where b.id = v_id;
  if v_emailed is null then
    raise exception 'CHECK 1 FAILED: the claim did not stamp emailed_at';
  end if;

  raise notice 'CHECK 1 passed: submit returns its id and the claim serves that exact report';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 2 — ⚠️ EXACTLY ONCE. A second claim of the same id returns nothing.
-- A retried invoke, or two launches racing, must not put the same report in the
-- inbox twice — and must not re-send one whose screenshots have since been read.
-- -----------------------------------------------------------------------------
begin;
do $$
declare
  v_id     uuid;
  v_first  jsonb;
  v_second jsonb;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);

  select public.submit_bug_report('only once please', '1.0.0', 'ios', '18.2',
    'iPhone 14', null, null, null, null, null, null) into v_id;

  v_first  := public.claim_bug_report_email('11111111-1111-1111-1111-111111111111', v_id);
  v_second := public.claim_bug_report_email('11111111-1111-1111-1111-111111111111', v_id);

  if not (v_first->>'claimed')::boolean then
    raise exception 'CHECK 2 FAILED: the first claim returned nothing';
  end if;
  if (v_second->>'claimed')::boolean then
    raise exception 'CHECK 2 FAILED: the same report was claimed twice';
  end if;

  raise notice 'CHECK 2 passed: a second claim of the same id returns nothing';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 3 — ⚠️ ISOLATION. A reporter cannot claim another reporter's report by
-- naming its id. The id comes from a client; this is the whole defence.
-- -----------------------------------------------------------------------------
begin;
do $$
declare
  v_a_id   uuid;
  v_result jsonb;
begin
  -- User A files a report and we learn its real id.
  perform set_config('request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
  select public.submit_bug_report('A private report from user A', '1.0.0', 'ios',
    '18.2', 'iPhone 14', null, null, null, null, null, null) into v_a_id;

  -- User B names it anyway — the exact forgery the actor check exists for.
  v_result := public.claim_bug_report_email(
    '22222222-2222-2222-2222-222222222222', v_a_id);

  if (v_result->>'claimed')::boolean then
    raise exception 'CHECK 3 FAILED: user B claimed user A''s report — message %',
      quote_literal(v_result->>'message');
  end if;

  -- And it must still be unsent: a foreign claim must not consume it, or A's
  -- report is silently never delivered.
  if not exists (select 1 from public.bug_reports b
                  where b.id = v_a_id and b.emailed_at is null) then
    raise exception 'CHECK 3 FAILED: user B''s claim consumed user A''s report';
  end if;

  raise notice 'CHECK 3 passed: a foreign id claims nothing AND does not consume the report';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 4 — ⚠️ THE INCIDENT. With an OLDER unsent report sitting there, the
-- claim must return the report whose id was given, not the oldest one.
-- This is the exact shape that emailed the operator the wrong report.
-- -----------------------------------------------------------------------------
begin;
do $$
declare
  v_old_id uuid;
  v_new_id uuid;
  v_result jsonb;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);

  select public.submit_bug_report('the older report nobody emailed', '1.0.0',
    'ios', '18.2', 'iPhone 14', null, null, null, null, null, null) into v_old_id;
  -- Force a distinct, genuinely older created_at rather than trusting timing.
  update public.bug_reports set created_at = now() - interval '1 hour'
   where id = v_old_id;

  select public.submit_bug_report('the report just filed', '1.0.0', 'ios',
    '18.2', 'iPhone 14', null, null, null, null, null, null) into v_new_id;

  v_result := public.claim_bug_report_email(
    '11111111-1111-1111-1111-111111111111', v_new_id);

  if v_result->>'message' <> 'the report just filed' then
    raise exception
      'CHECK 4 FAILED: claimed by age, not by id — got %', quote_literal(v_result->>'message');
  end if;
  -- The older one must be untouched, not quietly consumed alongside.
  if not exists (select 1 from public.bug_reports b
                  where b.id = v_old_id and b.emailed_at is null) then
    raise exception 'CHECK 4 FAILED: the older report was consumed too';
  end if;

  raise notice 'CHECK 4 passed: an older unsent report does not displace the one named by id';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 5 — ⚠️ SERVICE ROLE ONLY. The claim returns the full text of a bug
-- report, out of a table that deliberately has NO client select policy. A
-- signed-in client able to execute it would have a read path around that — and
-- one that destroys the row's unsent state on the way past.
-- -----------------------------------------------------------------------------
do $$
declare
  v_bad text;
begin
  select string_agg(grantee, ', ') into v_bad
  from information_schema.routine_privileges
  where specific_schema = 'public'
    and routine_name = 'claim_bug_report_email'
    and privilege_type = 'EXECUTE'
    and grantee in ('PUBLIC', 'anon', 'authenticated');

  if v_bad is not null then
    raise exception 'CHECK 5 FAILED: claim_bug_report_email is executable by %', v_bad;
  end if;

  if not exists (
    select 1 from information_schema.routine_privileges
    where specific_schema = 'public'
      and routine_name = 'claim_bug_report_email'
      and privilege_type = 'EXECUTE'
      and grantee = 'service_role'
  ) then
    raise exception 'CHECK 5 FAILED: service_role cannot execute claim_bug_report_email';
  end if;

  raise notice 'CHECK 5 passed: only service_role may execute claim_bug_report_email';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 6 — ⚠️ THE DROP AND RECREATE DID NOT LOSE submit_bug_report'S GRANTS.
-- Dropping a function drops its grants with it, and the default for a new one
-- is EXECUTE to PUBLIC — so a careless recreate would hand a guest the reporting
-- RPC. The function refuses a guest internally too; this is the outer wall.
-- -----------------------------------------------------------------------------
do $$
declare
  v_bad text;
begin
  select string_agg(grantee, ', ') into v_bad
  from information_schema.routine_privileges
  where specific_schema = 'public'
    and routine_name = 'submit_bug_report'
    and privilege_type = 'EXECUTE'
    and grantee in ('PUBLIC', 'anon');

  if v_bad is not null then
    raise exception 'CHECK 6 FAILED: submit_bug_report is executable by %', v_bad;
  end if;

  if not exists (
    select 1 from information_schema.routine_privileges
    where specific_schema = 'public'
      and routine_name = 'submit_bug_report'
      and privilege_type = 'EXECUTE'
      and grantee = 'authenticated'
  ) then
    raise exception 'CHECK 6 FAILED: authenticated lost EXECUTE on submit_bug_report';
  end if;

  raise notice 'CHECK 6 passed: submit_bug_report kept its grants across the recreate';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 7 — a null actor or a null id claims nothing. The Edge Function refuses
-- both before it gets here, so this is the belt to that braces: neither may be
-- read as "match the first row".
-- -----------------------------------------------------------------------------
begin;
do $$
declare
  v_id     uuid;
  v_result jsonb;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
  select public.submit_bug_report('someone''s words', '1.0.0', 'ios', '18.2',
    'iPhone 14', null, null, null, null, null, null) into v_id;

  v_result := public.claim_bug_report_email(null, v_id);
  if (v_result->>'claimed')::boolean then
    raise exception 'CHECK 7 FAILED: a null actor claimed a report';
  end if;

  v_result := public.claim_bug_report_email('11111111-1111-1111-1111-111111111111', null);
  if (v_result->>'claimed')::boolean then
    raise exception 'CHECK 7 FAILED: a null id claimed a report';
  end if;

  raise notice 'CHECK 7 passed: a null actor or a null id claims nothing';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 8 — the claim carries WHO filed it and how often they have before.
-- The email could not say who sent a report until 2026-08-27, so an operator
-- had nothing to reply to — while the app had been telling that reporter their
-- account travels "so we can reply".
--
-- ⚠️ THE UUID ONLY, NEVER THE ADDRESS. Resolving auth.users here would put a
-- path to every user's email behind a function whose job is bug reports; the
-- sender uses the admin API instead. This check pins that division.
-- -----------------------------------------------------------------------------
begin;
do $$
declare
  v_first  uuid;
  v_second uuid;
  v_result jsonb;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);

  -- One earlier report, so the history line has something to count.
  select public.submit_bug_report('an earlier report', '1.0.0', 'ios', '18.2',
    'iPhone 14', null, null, null, null, null, null) into v_first;
  update public.bug_reports set created_at = now() - interval '2 days'
   where id = v_first;

  select public.submit_bug_report('the one being emailed', '1.0.0', 'ios',
    '18.2', 'iPhone 14', null, null, null, null, null, null) into v_second;

  v_result := public.claim_bug_report_email(
    '11111111-1111-1111-1111-111111111111', v_second);

  if (v_result->>'reporter_id')::uuid <> '11111111-1111-1111-1111-111111111111' then
    raise exception 'CHECK 8 FAILED: reporter_id missing or wrong, got %',
      quote_literal(v_result->>'reporter_id');
  end if;
  -- Excludes the report being sent, so 1 means exactly one OTHER report.
  if (v_result->>'prior_reports')::integer <> 1 then
    raise exception 'CHECK 8 FAILED: prior_reports should be 1, got %',
      v_result->>'prior_reports';
  end if;
  if v_result->>'previous_report_at' is null then
    raise exception 'CHECK 8 FAILED: previous_report_at not returned';
  end if;
  -- ⚠️ No address, and no other report's TEXT. The history is a count and a
  -- date; carrying the earlier report's words into an email about this one
  -- would put three reports in a message about one.
  if v_result::text like '%an earlier report%' then
    raise exception 'CHECK 8 FAILED: the claim leaked another report''s text';
  end if;

  raise notice 'CHECK 8 passed: the claim carries the reporter id and a bare history';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 9 — history is scoped to the reporter. A count that included everybody
-- would tell the operator how busy the whole queue is, on somebody else's row.
-- -----------------------------------------------------------------------------
begin;
do $$
declare
  v_b_id   uuid;
  v_result jsonb;
begin
  -- User A files two reports.
  perform set_config('request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
  perform public.submit_bug_report('A one', '1.0.0', 'ios', '18.2', 'iPhone 14',
    null, null, null, null, null, null);
  perform public.submit_bug_report('A two', '1.0.0', 'ios', '18.2', 'iPhone 14',
    null, null, null, null, null, null);

  -- User B files their first.
  perform set_config('request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
  select public.submit_bug_report('B first', '1.0.0', 'ios', '18.2', 'iPhone 14',
    null, null, null, null, null, null) into v_b_id;

  v_result := public.claim_bug_report_email(
    '22222222-2222-2222-2222-222222222222', v_b_id);

  if (v_result->>'prior_reports')::integer <> 0 then
    raise exception 'CHECK 9 FAILED: B''s first report counted % priors — A''s rows leaked in',
      v_result->>'prior_reports';
  end if;

  raise notice 'CHECK 9 passed: the history counts only the reporter''s own reports';
end $$;
rollback;

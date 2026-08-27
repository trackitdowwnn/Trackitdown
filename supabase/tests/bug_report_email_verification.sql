-- =============================================================================
-- Bug report EMAIL-CLAIM verification (NOT a migration — do not place in
-- migrations/).
--
-- SELF-ASSERTING: each check is a seeded begin…rollback (or a grant assertion)
-- that RAISES on failure, so the file aborts non-zero the moment a property is
-- violated. Properties: claim_bug_report_email hands back a report's content
-- and stamps it sent, NEVER returns the same report twice, NEVER returns a
-- report belonging to somebody else, drains oldest-first, and is executable by
-- the service role ALONE.
--
-- ⚠️ THE ISOLATION CHECK IS THE POINT OF THIS FILE. The sender is invoked BY
-- THE REPORTING CLIENT, so the only thing standing between a patched client and
-- another user's bug report — free text that may name a place, a plate, a
-- person — is this function refusing to serve a row whose reporter_id is not
-- the actor it was given. CHECK 3 is what proves that, and CHECK 5 proves a
-- signed-in client cannot call it at all.
--
-- Run against a local DB seeded by supabase/seed.sql:
--     supabase db reset
--     npm run test:db
-- =============================================================================


-- -----------------------------------------------------------------------------
-- CHECK 1 — a claim returns the report's content and stamps emailed_at.
-- -----------------------------------------------------------------------------
begin;
do $$
declare
  v_result   jsonb;
  v_emailed  timestamptz;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);

  perform public.submit_bug_report(
    'the map went blank when I opened it', '1.0.0', 'ios', '18.2', 'iPhone 14',
    'explore', 'blocked', 'always', 'it should show pins',
    array['10:00:00 info map:feed_mounted'], null);

  v_result := public.claim_bug_report_email('11111111-1111-1111-1111-111111111111');

  if not (v_result->>'claimed')::boolean then
    raise exception 'CHECK 1 FAILED: a freshly filed report was not claimable';
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

  select b.emailed_at into v_emailed
  from public.bug_reports b
  where b.id = (v_result->>'id')::uuid;

  if v_emailed is null then
    raise exception 'CHECK 1 FAILED: the claim did not stamp emailed_at';
  end if;
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 2 — ⚠️ EXACTLY ONCE. A second claim must not return the same report.
-- A retried invoke, or two app launches racing, must not put the same bug
-- report in the inbox twice — and more importantly must not re-send one whose
-- screenshots have since been read.
-- -----------------------------------------------------------------------------
begin;
do $$
declare
  v_first  jsonb;
  v_second jsonb;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);

  perform public.submit_bug_report(
    'only once please', '1.0.0', 'ios', '18.2', 'iPhone 14',
    null, null, null, null, null, null);

  v_first  := public.claim_bug_report_email('11111111-1111-1111-1111-111111111111');
  v_second := public.claim_bug_report_email('11111111-1111-1111-1111-111111111111');

  if not (v_first->>'claimed')::boolean then
    raise exception 'CHECK 2 FAILED: the first claim returned nothing';
  end if;
  if (v_second->>'claimed')::boolean then
    raise exception 'CHECK 2 FAILED: the same report was claimed twice';
  end if;
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 3 — ⚠️ ISOLATION. One reporter's claim must never return another
-- reporter's report. The sender is client-invoked; this is the whole defence.
-- -----------------------------------------------------------------------------
begin;
do $$
declare
  v_result jsonb;
begin
  -- User A files a report.
  perform set_config('request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
  perform public.submit_bug_report(
    'A private report from user A', '1.0.0', 'ios', '18.2', 'iPhone 14',
    null, null, null, null, null, null);

  -- User B claims. There is nothing of theirs to send, and A's report is not
  -- theirs to see.
  v_result := public.claim_bug_report_email('22222222-2222-2222-2222-222222222222');

  if (v_result->>'claimed')::boolean then
    raise exception 'CHECK 3 FAILED: user B claimed a report — message %',
      quote_literal(v_result->>'message');
  end if;

  -- And A's report must still be unsent: B's failed claim must not have
  -- consumed it, or A's report silently never arrives.
  if not exists (
    select 1 from public.bug_reports b
    where b.reporter_id = '11111111-1111-1111-1111-111111111111'
      and b.emailed_at is null
  ) then
    raise exception 'CHECK 3 FAILED: user B''s claim consumed user A''s report';
  end if;
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 4 — oldest first, so a backlog drains in order instead of the oldest
-- report starving while newer ones keep arriving.
-- -----------------------------------------------------------------------------
begin;
do $$
declare
  v_result jsonb;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);

  perform public.submit_bug_report(
    'the older report', '1.0.0', 'ios', '18.2', 'iPhone 14',
    null, null, null, null, null, null);
  -- Force a distinct created_at rather than trusting statement timing.
  update public.bug_reports set created_at = now() - interval '1 hour'
   where reporter_id = '11111111-1111-1111-1111-111111111111';

  perform public.submit_bug_report(
    'the newer report', '1.0.0', 'ios', '18.2', 'iPhone 14',
    null, null, null, null, null, null);

  v_result := public.claim_bug_report_email('11111111-1111-1111-1111-111111111111');

  if v_result->>'message' <> 'the older report' then
    raise exception 'CHECK 4 FAILED: expected the older report, got %',
      quote_literal(v_result->>'message');
  end if;
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 5 — ⚠️ SERVICE ROLE ONLY. This function returns the full text of a bug
-- report, out of a table that deliberately has NO client select policy. If a
-- signed-in client could execute it, it would be a read path around that — and
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
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 6 — a null actor claims nothing. The Edge Function refuses an
-- unauthenticated caller before it gets here, so this is the belt to that
-- braces: a null must never be read as "match the first row".
-- -----------------------------------------------------------------------------
begin;
do $$
declare
  v_result jsonb;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
  perform public.submit_bug_report(
    'someone else''s words', '1.0.0', 'ios', '18.2', 'iPhone 14',
    null, null, null, null, null, null);

  v_result := public.claim_bug_report_email(null);

  if (v_result->>'claimed')::boolean then
    raise exception 'CHECK 6 FAILED: a null actor claimed a report';
  end if;
end $$;
rollback;

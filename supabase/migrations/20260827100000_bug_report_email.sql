-- =============================================================================
-- WHAT:  Lets a bug report be emailed to the operator exactly once —
--        `emailed_at` on public.bug_reports, and claim_bug_report_email(),
--        which hands the report's content to the Edge Function that sends it.
-- WHY:   Until now a bug report landed in a table nobody watches. The owner
--        asked for them to arrive in an inbox.
--
--        ⚠️ THE CLAIM IS THE AUTHORISATION, exactly as claim_sighting_
--        notification is (20260802140000). The Edge Function is invoked BY THE
--        REPORTING CLIENT, so it cannot be trusted to say which report to send:
--        this function ignores any id the caller might offer and serves only
--        reports whose reporter_id IS the actor. A patched client cannot make
--        it email somebody else's report.
--
--        ⚠️ AND IT IS IDEMPOTENT. `emailed_at` is stamped inside the same
--        statement that selects the row, under a FOR UPDATE SKIP LOCKED, so
--        replaying the call — a retried invoke, two launches racing — sends
--        nothing the second time. Without that, the obvious implementation
--        (select, then update) lets two concurrent calls both read a null and
--        both send.
--
--        ⚠️ OLDEST FIRST, NOT NEWEST. submit_bug_report returns void, so the
--        client has no id to pass and this claims by actor alone. Draining the
--        oldest unsent report means a backlog — a report filed while offline,
--        an invoke that never fired because the app died — empties in order as
--        later reports are sent, instead of the oldest starving forever.
--
--        HONEST LIMITATION, stated because the same one is stated on every
--        other notify path in this project: the client invokes the sender, so
--        a report whose app is killed before the call notifies nobody until
--        the NEXT report drains it. Nothing is lost — the row is already
--        committed by then, and this is the only reason the backlog rule above
--        exists. A pg_net trigger on insert would close it properly, and is
--        the right upgrade if bug reports ever matter operationally.
-- LINKS: supabase/functions/notify-bug-report/index.ts (the only caller);
--        supabase/migrations/20260824100000_bug_reports.sql (the table);
--        supabase/migrations/20260824140000_bug_report_details.sql (the
--          screenshot paths this hands over, and the private bucket rule).
-- =============================================================================

alter table public.bug_reports
  add column if not exists emailed_at timestamptz;

comment on column public.bug_reports.emailed_at is
  'When this report was handed to the email sender, or null if it has not been. Stamped by claim_bug_report_email under a row lock, which is what makes sending exactly-once rather than at-least-once.';

-- Partial index: the claim only ever looks for unsent reports by one reporter,
-- and the unsent set is tiny next to the table. A full index on reporter_id
-- would be mostly rows this query can never return.
create index if not exists bug_reports_unsent_idx
  on public.bug_reports (reporter_id, created_at)
  where emailed_at is null;


-- =============================================================================
-- claim_bug_report_email(p_actor uuid)
-- =============================================================================
-- Returns the oldest unsent report belonging to p_actor, stamping it sent in
-- the same breath. Returns `{ "claimed": false }` when there is nothing to
-- send — which is ALSO what a caller gets for a report that is not theirs or
-- does not exist, so this is not an oracle for either.
create or replace function public.claim_bug_report_email(p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_report public.bug_reports;
begin
  if p_actor is null then
    return jsonb_build_object('claimed', false);
  end if;

  -- ⚠️ ONE STATEMENT. The select, the lock and the stamp happen together, so
  -- two concurrent invokes cannot both see emailed_at null. SKIP LOCKED means
  -- the loser takes the next unsent report rather than blocking on this one.
  update public.bug_reports b
     set emailed_at = now()
   where b.id = (
           select c.id
             from public.bug_reports c
            where c.reporter_id = p_actor
              and c.emailed_at is null
            order by c.created_at
            limit 1
              for update skip locked
         )
  returning b.* into v_report;

  if v_report.id is null then
    return jsonb_build_object('claimed', false);
  end if;

  -- The report's own content. The screenshot PATHS travel, never URLs: the
  -- bucket is private and has no client read path, so the sender signs them
  -- with the service role and gives the operator a link that expires.
  return jsonb_build_object(
    'claimed',          true,
    'id',               v_report.id,
    'created_at',       v_report.created_at,
    'message',          v_report.message,
    'expected',         v_report.expected,
    'area',             v_report.area,
    'severity',         v_report.severity,
    'frequency',        v_report.frequency,
    'app_version',      v_report.app_version,
    'platform',         v_report.platform,
    'os_version',       v_report.os_version,
    'device_model',     v_report.device_model,
    'breadcrumbs',      v_report.breadcrumbs,
    'screenshot_paths', v_report.screenshot_paths
  );
end;
$fn$;

comment on function public.claim_bug_report_email(uuid) is
  'Claims the oldest unsent bug report belonging to p_actor and returns its content, stamping emailed_at so it is never sent twice. SECURITY DEFINER; serves only reports whose reporter_id is p_actor, so a client-invoked sender cannot reach anybody else''s report. Returns {"claimed": false} when there is nothing to send. Grants: service_role only.';

-- SAFETY: functions default to EXECUTE granted to PUBLIC. This one returns the
-- full text of a bug report, so it must be reachable ONLY by the service role
-- inside the Edge Function — never by a signed-in client, which could
-- otherwise drain and read its own reports back out of a table that
-- deliberately has no client SELECT policy.
revoke all on function public.claim_bug_report_email(uuid) from public;
revoke all on function public.claim_bug_report_email(uuid) from anon;
revoke all on function public.claim_bug_report_email(uuid) from authenticated;
grant execute on function public.claim_bug_report_email(uuid) to service_role;

-- -----------------------------------------------------------------------------
-- WHAT:  `purge_old_notifications()` — the 90-day feed retention, IN THE REPO,
--        called hourly by the sweep. Plus a corrected comment on
--        posts.recovery_notified_at.
-- WHY:   Security review (2026-08-06): the retention promise lived only in a
--        hand-created dashboard cron job (`purge-old-notifications`, daily) —
--        real, but invisible to the repo, untested, and forgotten the day the
--        project moves environments. This function anchors it: the sweep
--        (`release-held-refunds`, already cron-invoked hourly) calls it as
--        Phase 0, so retention runs wherever the sweep runs. The dashboard
--        job stays as belt — both are idempotent deletes.
--
--        The feed is a per-user activity history including money lines
--        ("You've earned £X"); 90 days matches SECURITY_AND_TRUST's existing
--        retention posture for closed-post sighting history.
--
-- SAFETY: service-role only — retention is the system's duty, never a client
--        verb. Deletes STRICTLY by age; read/unread is irrelevant (an unread
--        90-day-old row is still stale news, not a record we owe anyone).
-- LINKS: supabase/migrations/20260806100000_notification_center.sql;
--        supabase/functions/release-held-refunds/index.ts (the caller);
--        docs/decisions/ADR-0012-notification-center.md (§8).
-- -----------------------------------------------------------------------------

create or replace function public.purge_old_notifications()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  delete from public.notifications
   where created_at < now() - interval '90 days';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end $$;

comment on function public.purge_old_notifications() is
  'The 90-day feed retention (ADR-0012 §8). Called hourly by release-held-refunds (Phase 0) and daily by the dashboard cron job purge-old-notifications — both idempotent. Age-only: read state never extends retention. SERVICE ROLE ONLY.';

revoke all on function public.purge_old_notifications() from public;
revoke all on function public.purge_old_notifications() from anon;
revoke all on function public.purge_old_notifications() from authenticated;
grant execute on function public.purge_old_notifications() to service_role;

-- Correcting an overclaim (same review): posts' SELECT grant is table-level,
-- so this column IS readable on any row RLS exposes. The property that
-- matters — no client can write it, so nobody can suppress or re-fire the
-- announcement — holds via the column-listed INSERT/UPDATE grants.
comment on column public.posts.recovery_notified_at is
  'Recovery-announcement claim marker (claim_recovery_notifications). NULL = watchers have never been told. Client-READABLE like every posts column (table-level SELECT grant) but never client-writable — the write grants are column lists that exclude it, which is the property the claim depends on.';

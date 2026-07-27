-- =============================================================================
-- WHAT:  The REPORT / FLAG capture path. Adds public.post_flags (one row per
--        user-reported post) and public.flag_post(post_id, reason) — a
--        SECURITY DEFINER RPC that records the caller's report. This is the
--        reactive half of the live-on-payment model: posts publish instantly, so
--        abuse is handled after the fact — and a report must be CAPTURED (with
--        who reported it), not logged and forgotten.
-- WHY:   Removing the pre-publish verification gate (live-on-payment) trades a
--        blocking check for reactive controls. The report button on the post
--        detail was a stub (logged + toasted). This makes it real: a durable,
--        attributable flag row is the raw material a moderator/takedown acts on
--        (takedown reuses the deactivate+refund path — set the post cancelled and
--        refund the bounty). Deliberately NO auto-hide on N reports: on a stolen-
--        car app that invites griefers to mass-report a VICTIM's real post to
--        bury it during the critical window — takedown stays a deliberate action.
-- LINKS: docs/DOMAIN.md (reactive safety model; flag -> takedown),
--        supabase/migrations/20260730100000_live_on_payment.sql (why reactive),
--        supabase/migrations/20260722100000_watchlist.sql (the user-owned-row
--          house pattern: profiles FK, RLS, explicit grants),
--        supabase/migrations/20260707110712_payments_foundation.sql (posts,
--          profiles), src/features/vehicles/api/flagApi.ts (the client caller),
--        src/features/vehicles/screens/PostDetailScreen.tsx (the report button).
--
-- SAFETY: post_flags is moderation data — RLS ENABLED with NO client policies, so
--        clients can neither read nor write it directly (a reporter must not see
--        who else flagged a post, and a post owner must NEVER see their flags).
--        Writes go ONLY through flag_post (SECURITY DEFINER, bypasses RLS);
--        reads are service-role (moderator tooling) only. flag_post pins
--        reporter_id to auth.uid() (never client-supplied) and is idempotent
--        (one flag per user per post).
--
-- SAFETY NOTE ON DESTRUCTIVE STATEMENTS: none. Additive — one new table (+ RLS +
--        grants) and one new function (+ grants + comment).
-- =============================================================================


-- =============================================================================
-- 1. TABLE: post_flags  (one row per (reporter, post) report)
-- =============================================================================
create table public.post_flags (
  id          uuid primary key default gen_random_uuid(),

  -- The reported post. ON DELETE CASCADE: a flag is worthless without its post.
  post_id     uuid not null references public.posts (id) on delete cascade,

  -- The reporter. FK to profiles (house convention for user-owned rows; 1:1 with
  -- auth.users). ON DELETE CASCADE: GDPR erasure removes their reports.
  reporter_id uuid not null references public.profiles (id) on delete cascade,

  -- Optional free-text reason (the UI sends none today; kept for a future reason
  -- picker). Length-capped defensively.
  reason      text check (reason is null or char_length(reason) <= 500),

  created_at  timestamptz not null default now(),

  -- One report per user per post — a re-report is a no-op (flag_post ON CONFLICT).
  unique (post_id, reporter_id)
);

comment on table public.post_flags is
  'One row per user-reported post (moderation queue). Written ONLY by flag_post (SECURITY DEFINER) / service role. RLS enabled with NO client policies — never client-readable/writable: a reporter must not learn who else flagged a post and an owner must never see their flags. Read by moderator tooling (service role).';

-- Moderator lookups: flags for a post, and newest-first triage.
create index post_flags_post_id_idx    on public.post_flags (post_id);
create index post_flags_created_at_idx on public.post_flags (created_at desc);

alter table public.post_flags enable row level security;

-- SAFETY: moderation table. RLS ENABLED with NO anon/authenticated policies, so
-- ALL client access is denied by default. Writes go through flag_post (definer,
-- bypasses RLS); reads are service-role only. Grant service_role full DML; grant
-- clients NOTHING here.
grant select, insert, update, delete on public.post_flags to service_role;


-- =============================================================================
-- 2. FUNCTION: flag_post(post_id, reason)
-- =============================================================================
-- Records the CALLER's report of a post. reporter_id is pinned to auth.uid()
-- (never trusted from the client); idempotent (a re-report is a no-op). Requires
-- a signed-in caller (accountability — reports are attributable, not anonymous).
create or replace function public.flag_post(
  p_post_id uuid,
  p_reason  text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  -- Only a PUBLICLY-VISIBLE (active) post can be reported. This mirrors the
  -- watchlist insert's visibility gate: a reporter only ever sees active posts,
  -- and gating here means flag_post is NOT an existence/status oracle for hidden
  -- posts (a bad/deleted/hidden id is a silent no-op, not an FK error).
  if not exists (
    select 1 from public.posts p where p.id = p_post_id and p.status = 'active'
  ) then
    return;
  end if;

  -- Insert the report; a second report of the same post by the same user is a
  -- no-op (ON CONFLICT on the unique (post_id, reporter_id)). reporter_id is the
  -- caller's own id — a client can never attribute a report to someone else.
  insert into public.post_flags (post_id, reporter_id, reason)
  values (p_post_id, v_uid, nullif(btrim(coalesce(p_reason, '')), ''))
  on conflict (post_id, reporter_id) do nothing;
end;
$$;

comment on function public.flag_post(uuid, text) is
  'Records the caller''s report of a post into post_flags. SECURITY DEFINER; reporter_id pinned to auth.uid() (never client-supplied). Only an ACTIVE (publicly-visible) post can be flagged — a hidden/deleted id is a silent no-op (not an existence oracle), mirroring the watchlist insert gate. Idempotent: one flag per (user, post); a re-report is a no-op. Raises NOT_AUTHENTICATED for a guest. Grants: authenticated + service_role only.';

-- SAFETY: functions default to EXECUTE granted to PUBLIC, and this project also
-- auto-grants anon at CREATE time (see 20260713190000_post_a_car.sql). Reporting
-- requires an account (accountability), so revoke public + anon, grant only
-- authenticated (+ service_role).
revoke execute on function public.flag_post(uuid, text) from public, anon;
grant  execute on function public.flag_post(uuid, text) to authenticated, service_role;


-- =============================================================================
-- END OF MIGRATION
-- =============================================================================

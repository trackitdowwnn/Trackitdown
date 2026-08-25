-- =============================================================================
-- WHAT:  The onboarding completion funnel. Adds public.onboarding_events (one
--        row per step reached in one run through the intro) and
--        public.record_onboarding_step(...) — the RPC that writes it.
-- WHY:   Nobody knows whether the intro works. It was redesigned on 2026-08-24
--        on the strength of a reference spec and a judgement call, with no
--        measurement on either side of the change. The question this answers is
--        the plainest one available: of the people who see slide 1, how many
--        reach the end, and which slide loses the rest.
--
--        ⚠️ THIS IS THE FIRST TABLE IN THE APP AN ANONYMOUS CALLER CAN WRITE
--        TO, and that is not a shortcut — it is inherent to the question.
--        Onboarding runs BEFORE sign-in (AuthGate sends a first launch here and
--        lands everyone in the tabs as a guest), so there is no auth.uid() to
--        pin to. Worse, the people worth measuring are exactly the ones who
--        never sign in: buffering events until an account exists would record
--        only the runs that succeeded, which is the one population that cannot
--        answer "why do people leave".
--
--        What that costs, stated plainly rather than hidden behind the RPC:
--          * The endpoint can be spammed. The unique constraint below caps one
--            run at (slides + 2) rows, but nothing stops a script minting fresh
--            run ids. The damage is INFLATED NUMBERS — a data-quality problem,
--            not a disclosure one, because there is nothing here to steal.
--          * ⚠️ Which is its own hazard: a funnel nobody can trust is worse than
--            no funnel, because a decision gets made on it anyway. If these
--            counts ever look implausible, suspect this before believing them.
--        What it does NOT cost: there is no user id, no device id, no IP, no
--        session, nothing that survives the run and nothing that identifies
--        anyone. See the run_id column.
-- LINKS: src/features/auth/lib/onboardingFunnel.ts (the only writer);
--        src/features/auth/screens/OnboardingScreen.tsx (where it is called);
--        supabase/migrations/20260824100000_bug_reports.sql (the operator-only
--          table pattern this follows);
--        docs/design-refs/onboarding/ (what the redesign changed).
--
-- SAFETY: onboarding_events is operator-only for READS — RLS ENABLED with NO
--        client policies, so no client can read it back, and there is no client
--        table grant of any kind. Writes go ONLY through
--        record_onboarding_step, which accepts a closed vocabulary and writes
--        nothing it was not given.
--
-- SAFETY: THERE IS DELIBERATELY NO IDENTIFIER HERE. Not a user id (there is no
--        user), not a device id, not an install id. `run_id` is generated in
--        memory when the intro opens and discarded when it closes — it is never
--        written to disk on the device and never travels with anything else, so
--        two runs by the same person are unlinkable, and a run is unlinkable to
--        the account that person may later create. That is the whole reason
--        this can be collected from someone who has not agreed to anything.
--
-- SAFETY NOTE ON DESTRUCTIVE STATEMENTS: one `revoke all … from anon,
--        authenticated` on the NEW table only — it removes what this project's
--        ALTER DEFAULT PRIVILEGES hands out silently at CREATE TABLE (including
--        TRUNCATE). It touches no existing table and no data.
-- =============================================================================


-- =============================================================================
-- 1. TABLE: onboarding_events
-- =============================================================================
create table public.onboarding_events (
  id bigserial primary key,

  -- ⚠️ EPHEMERAL AND UNLINKABLE. Generated in memory per run, never persisted
  -- on the device. It exists so one run's steps can be counted as one journey
  -- rather than as N unrelated ticks — that is the whole difference between
  -- "40 people saw slide 3" and "40 of the 100 who started got to slide 3".
  --
  -- It is NOT a device id and must never become one. If you ever find yourself
  -- storing this in AsyncStorage, stop: that single change turns an anonymous
  -- counter into tracking of a person who has not signed up for anything.
  run_id uuid not null,

  -- The closed vocabulary. `slide_viewed` carries which one in `slide`;
  -- `completed` and `skipped` are the two ways a run ends.
  step text not null
    check (step in ('slide_viewed', 'completed', 'skipped')),

  -- Which slide — 1-based, null for the terminal steps. Bounded rather than
  -- enumerated so adding a fifth slide is a copy change, not a migration.
  slide smallint
    check (slide is null or slide between 1 and 20),

  -- ⚠️ ios or android ONLY. Included because a funnel that cannot be split by
  -- platform is much weaker — "Android loses everyone on slide 2" is
  -- actionable and "someone loses someone somewhere" is not — and because two
  -- values shared by millions identify nobody. Nothing else about the device
  -- belongs here.
  platform text
    check (platform is null or platform in ('ios', 'android')),

  at timestamptz not null default now(),

  -- Caps one run at (slides + 2) rows and makes the write idempotent, so a
  -- retry or a re-render cannot double-count a step. This is the only bound on
  -- writes that exists; see the header.
  unique (run_id, step, slide)
);

comment on table public.onboarding_events is
  'Onboarding funnel counters. One row per step reached in one run. Deliberately carries NO user, device or install identifier — run_id is generated in memory and never persisted on the device, so runs are unlinkable to each other and to any account. Written by anon (onboarding is pre-auth); read by service_role only.';

-- Funnel queries group by step and slide over a date range.
create index onboarding_events_at_idx on public.onboarding_events (at desc);

alter table public.onboarding_events enable row level security;

-- SAFETY: this project ships `ALTER DEFAULT PRIVILEGES … GRANT ALL ON TABLES TO
-- anon, authenticated`, so CREATE TABLE above has ALREADY handed both roles
-- privileges including TRUNCATE. Per-table grants ADD to that default rather
-- than replacing it, so the revoke has to come first and be explicit. This
-- matters more here than usual: anon can call the RPC, and must still hold
-- nothing on the table itself.
revoke all on public.onboarding_events from anon, authenticated;

grant select, insert, update, delete on public.onboarding_events to service_role;


-- =============================================================================
-- 2. RPC: record_onboarding_step(run_id, step, slide, platform)
-- =============================================================================
-- ⚠️ GRANTED TO anon. The only such write in the app. Everything about the
-- shape above is what makes that acceptable: a closed vocabulary, a bounded
-- slide number, two possible platforms, no free text anywhere, and no column a
-- caller could use to store something of their own.
--
-- Silently does nothing on a duplicate rather than raising: the client is
-- fire-and-forget and must never surface an analytics failure to someone who is
-- just trying to read four slides.
create or replace function public.record_onboarding_step(
  p_run_id   uuid,
  p_step     text,
  p_slide    smallint default null,
  p_platform text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Refused rather than clamped. There is no user here to lose anything, so
  -- the usual "never discard someone's work over a field they did not choose"
  -- reasoning does not apply — a malformed call is a bug in our own client and
  -- should be loud in development rather than quietly recorded as a fact.
  if p_step is null or p_step not in ('slide_viewed', 'completed', 'skipped') then
    raise exception 'INVALID_INPUT';
  end if;

  if p_run_id is null then
    raise exception 'INVALID_INPUT';
  end if;

  insert into public.onboarding_events (run_id, step, slide, platform)
  values (
    p_run_id,
    p_step,
    case when p_step = 'slide_viewed' then p_slide else null end,
    nullif(btrim(coalesce(p_platform, '')), '')
  )
  on conflict (run_id, step, slide) do nothing;
end;
$$;

comment on function public.record_onboarding_step(uuid, text, smallint, text) is
  'Records one onboarding funnel step. Idempotent per (run, step, slide). Granted to anon because onboarding runs before sign-in. Raises INVALID_INPUT for an unknown step or a null run.';

-- SAFETY: functions default to EXECUTE granted to PUBLIC, and this project also
-- auto-grants anon at CREATE time. anon is INTENDED here, so the revoke exists
-- to drop `public` and then re-grant deliberately — the grant should read as a
-- decision, not as something inherited.
revoke execute on function public.record_onboarding_step(uuid, text, smallint, text)
  from public, anon, authenticated;
grant execute on function public.record_onboarding_step(uuid, text, smallint, text)
  to anon, authenticated, service_role;


-- =============================================================================
-- 3. RETENTION
-- =============================================================================
-- These are counters, not history: nothing here is worth keeping once the
-- question it answered has been answered, and an anon-writable table is exactly
-- the one that should not grow without bound.
--
-- ⚠️ NOT SCHEDULED. There is no pg_cron in this project yet — the same
-- deferral push_sends and stripe_webhook_events already carry. The function
-- exists so the ops/cron pass has one thing to schedule rather than one thing
-- to write.
create or replace function public.purge_onboarding_events()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  delete from public.onboarding_events where at < now() - interval '180 days';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

comment on function public.purge_onboarding_events() is
  'Deletes funnel rows older than 180 days. NOT scheduled — no pg_cron in this project yet; attach it in the ops pass.';

revoke execute on function public.purge_onboarding_events() from public, anon, authenticated;
grant execute on function public.purge_onboarding_events() to service_role;


-- =============================================================================
-- END OF MIGRATION
-- =============================================================================

-- =============================================================================
-- WHAT:  The telemetry sink. Adds public.telemetry_events (one row per funnel
--        event or error) and public.record_telemetry_events(jsonb) — a BATCH
--        RPC that writes them.
-- WHY:   ROADMAP critical path item #2. 86 distinct snake_case funnel events
--        are already instrumented across the app as `log.info('event_name',
--        {...})` — gate_shown, feed_load, otp_verified, garage_nudge_shown,
--        center_view and 81 more. Every one of them dies in the Metro console,
--        because `addLogSink` (src/shared/lib/logger.ts:117) has no production
--        caller: its only reference in the whole tree is a test. Until
--        something registers a sink, ROADMAP's own words apply — "every
--        product judgement in this file is a guess".
--
--        This is the destination. Deliberately a table in the database you
--        already have, rather than a new vendor: no account, no SDK, no third
--        party receiving your users' behaviour, and the queries are the SQL
--        you already write. Sentry remains the right answer for CRASHES later
--        (a different job — stack traces, not funnels) and nothing here
--        forecloses it: logger.ts takes any number of sinks.
--
--        ⚠️ THIS IS THE SECOND TABLE AN ANONYMOUS CALLER CAN WRITE TO, after
--        onboarding_events. Same reason and same shape of risk: much of the
--        funnel worth measuring happens before sign-in (AuthGate lands a first
--        launch in the tabs as a guest), and buffering until an account exists
--        would record only the journeys that succeeded — the one population
--        that cannot answer "why do people leave".
--
--        What that costs, stated plainly rather than hidden behind the RPC:
--          * The endpoint can be spammed. `record_telemetry_events` caps ONE
--            CALL at 50 events, but nothing stops repeated calls. The damage is
--            INFLATED NUMBERS — a data-quality problem, not a disclosure one.
--          * ⚠️ Which is its own hazard, exactly as onboarding_events says: a
--            funnel nobody can trust is worse than none, because a decision
--            gets made on it anyway. If these counts ever look implausible,
--            suspect this before believing them.
--
-- SAFETY: THERE IS DELIBERATELY NO user_id COLUMN, and that is a decision
--        rather than an oversight. `session_id` follows onboarding_events'
--        `run_id`: generated in memory when the app starts, never written to
--        disk on the device, discarded on exit. It exists so one run's events
--        can be read as one journey rather than N unrelated ticks, and two runs
--        by the same person are unlinkable — including across sign-in.
--
--        Adding a user id later is one migration. UN-collecting behaviour you
--        already gathered is not possible, so the reversible choice is the
--        default. If you decide per-user funnels are worth it (10 testers you
--        can ask directly is a strong argument that they are NOT), add the
--        column deliberately and say so in SECURITY_AND_TRUST §2 — do not let
--        it arrive as a side effect of some other change.
--
-- SAFETY: THE EVENT NAME IS FORMAT-CHECKED, NOT FREE TEXT. `^[a-z][a-z0-9_]*$`
--        up to 64 chars. A closed `check (event in (...))` vocabulary like
--        onboarding_events' would be better still, but 86 events across 14
--        features would turn every new log line into a migration, and the
--        realistic outcome of that is people stop instrumenting. The format
--        check is what stops the column becoming a place to put a sentence.
--
-- SAFETY: `props` IS THE ONLY PLACE UNCONSTRAINED DATA COULD ENTER, so it is
--        constrained three ways: it must be a JSON OBJECT, at most 8 keys, and
--        every value must be a scalar (no nested objects or arrays). The
--        client applies a key denylist as well (coordinates, plate, email,
--        address, postcode — see telemetry.ts), but the client is not the
--        boundary and these checks do not trust it. On a stolen-car app the
--        thing that must never land here is a location or a plate.
--
-- SAFETY NOTE ON DESTRUCTIVE STATEMENTS: one `revoke all … from anon,
--        authenticated` on the NEW table only — it removes what this project's
--        ALTER DEFAULT PRIVILEGES hands out silently at CREATE TABLE (including
--        TRUNCATE, see 20260802170000). It touches no existing table, no
--        existing policy and no data. Nothing in this file is destructive.
--
-- LINKS: src/shared/lib/telemetry.ts (the only writer);
--        src/shared/lib/logger.ts (addLogSink — the seam this fills);
--        supabase/migrations/20260824190000_onboarding_funnel.sql (the
--          anon-writable counter-table pattern this follows closely);
--        docs/ROADMAP.md (critical path #2); docs/LOGGING.md;
--        docs/SECURITY_AND_TRUST.md §2.
-- =============================================================================


-- =============================================================================
-- 1. TABLE: telemetry_events
-- =============================================================================
create table public.telemetry_events (
  id bigserial primary key,

  -- ⚠️ EPHEMERAL AND UNLINKABLE. Generated in memory at app start, never
  -- persisted on the device. Same contract as onboarding_events.run_id, and the
  -- same warning applies: if you ever find yourself writing this to
  -- AsyncStorage or SecureStore, stop. That single change turns an anonymous
  -- counter into tracking of a person, including one who never signed up.
  session_id uuid not null,

  -- The event name. Format-checked, not enumerated — see the header.
  event text not null
    check (event ~ '^[a-z][a-z0-9_]*$' and length(event) between 3 and 64),

  -- Which feature emitted it: the createLogger() tag, so a funnel can be read
  -- per area of the app. Same format rule.
  feature text not null
    check (feature ~ '^[a-z][a-z0-9_-]*$' and length(feature) between 2 and 40),

  -- 'info' for funnel events, 'error' for failures. warn/debug are not sent:
  -- debug never runs in production, and warn is currently prose rather than
  -- events. Widen this check if that changes.
  level text not null
    check (level in ('info', 'error')),

  -- Scalar-only bag, at most 8 keys. See the header and the trigger below.
  props jsonb not null default '{}'::jsonb
    check (jsonb_typeof(props) = 'object'),

  -- ⚠️ ios or android ONLY, as onboarding_events. Two values shared by
  -- millions identify nobody, and a funnel that cannot be split by platform is
  -- much weaker. Nothing else about the device belongs here.
  platform text
    check (platform is null or platform in ('ios', 'android')),

  -- The app version the event came from, so a regression can be pinned to a
  -- release. Format-checked to keep it a version rather than free text.
  app_version text
    check (app_version is null or app_version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),

  at timestamptz not null default now()
);

comment on table public.telemetry_events is
  'Funnel and error counters from the app. One row per event. Carries NO user, device or install identifier — session_id is generated in memory and never persisted on the device, so runs are unlinkable to each other and to any account. Written by anon and authenticated through record_telemetry_events; readable by service_role only.';

-- The two queries this table exists for: "what happened in the last week"
-- (funnel counts over a date range) and "how did this session go" (one journey
-- in order). Both are covered here.
create index telemetry_events_at_idx on public.telemetry_events (at desc);
create index telemetry_events_event_at_idx on public.telemetry_events (event, at desc);
create index telemetry_events_session_idx on public.telemetry_events (session_id, at);

alter table public.telemetry_events enable row level security;

-- RLS ENABLED WITH NO CLIENT POLICIES: no client can read this back, and there
-- is no client table grant of any kind. Writes go only through the RPC below.
--
-- SAFETY: this project ships `ALTER DEFAULT PRIVILEGES … GRANT ALL ON TABLES TO
-- anon, authenticated`, so CREATE TABLE above has ALREADY handed both roles
-- privileges including TRUNCATE. Per-table grants ADD to that default rather
-- than replacing it, so the revoke must come first and be explicit. That
-- matters more here than usual: anon can call the RPC and must still hold
-- nothing on the table itself.
revoke all on public.telemetry_events from anon, authenticated;

grant select, insert, update, delete on public.telemetry_events to service_role;


-- =============================================================================
-- 2. VALIDATION: props must be a flat bag of scalars
-- =============================================================================
-- A CHECK constraint cannot iterate a jsonb object, so this is a trigger. It is
-- the server-side half of the props rules; the client applies a key denylist
-- too, but the client is not the boundary.
--
-- Rejects rather than truncates. A malformed props bag is a bug in our own
-- client, and the RPC below is fire-and-forget — the raise is swallowed there
-- per event, so one bad event is dropped and the rest of the batch still lands.
create or replace function public.telemetry_props_are_flat()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_key   text;
  v_value jsonb;
  v_count integer := 0;
begin
  for v_key, v_value in select * from jsonb_each(new.props) loop
    v_count := v_count + 1;

    if v_count > 8 then
      raise exception 'TELEMETRY_PROPS_TOO_MANY_KEYS';
    end if;

    -- Nested structure is where an unbounded blob would hide.
    if jsonb_typeof(v_value) in ('object', 'array') then
      raise exception 'TELEMETRY_PROPS_NOT_SCALAR';
    end if;

    -- A long string is the other way to smuggle one. 200 chars is generous for
    -- a label and far too short for a payload.
    if jsonb_typeof(v_value) = 'string' and length(v_value #>> '{}') > 200 then
      raise exception 'TELEMETRY_PROPS_VALUE_TOO_LONG';
    end if;

    if v_key !~ '^[a-z][a-zA-Z0-9_]*$' or length(v_key) > 40 then
      raise exception 'TELEMETRY_PROPS_BAD_KEY';
    end if;
  end loop;

  return new;
end $$;

comment on function public.telemetry_props_are_flat() is
  'Enforces the telemetry_events.props contract: at most 8 keys, scalar values only, strings under 200 chars, snake/camelCase keys. Raises rather than truncating — a malformed bag is a bug in our own client.';

create trigger telemetry_events_props_flat
  before insert or update on public.telemetry_events
  for each row execute function public.telemetry_props_are_flat();

revoke execute on function public.telemetry_props_are_flat() from public, anon, authenticated;


-- =============================================================================
-- 3. RPC: record_telemetry_events(p_session_id, p_events)
-- =============================================================================
-- ⚠️ GRANTED TO anon. The second such write in the app, after
-- record_onboarding_step. What makes it acceptable is everything above: no
-- identifier, a format-checked event name, a scalar-only props bag, two
-- possible platforms, and no column a caller could use to store something of
-- their own.
--
-- BATCHED because the client buffers. One HTTP round trip per flush rather than
-- one per event matters on a phone: 86 event types firing across a session
-- would otherwise be 86 requests competing with the ones the user is waiting
-- for.
--
-- PER-EVENT ERROR SWALLOWING is deliberate. Telemetry is fire-and-forget and
-- must never surface a failure to someone who is trying to use the app, and one
-- malformed event must not discard the 49 valid ones beside it. Returns the
-- number actually written so the client can log a discrepancy in DEV.
create or replace function public.record_telemetry_events(
  p_session_id uuid,
  p_events     jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event   jsonb;
  v_written integer := 0;
  v_seen    integer := 0;
begin
  if p_session_id is null then
    raise exception 'INVALID_INPUT';
  end if;

  if p_events is null or jsonb_typeof(p_events) <> 'array' then
    raise exception 'INVALID_INPUT';
  end if;

  for v_event in select * from jsonb_array_elements(p_events) loop
    v_seen := v_seen + 1;

    -- ⚠️ THE BATCH CAP. The only bound on writes that exists; see the header.
    -- Stop rather than raise: the events before the cap are valid and worth
    -- keeping, and a client that overfills a batch is our bug, not an attack.
    exit when v_seen > 50;

    begin
      insert into public.telemetry_events (session_id, event, feature, level, props, platform, app_version)
      values (
        p_session_id,
        v_event ->> 'event',
        v_event ->> 'feature',
        coalesce(v_event ->> 'level', 'info'),
        coalesce(v_event -> 'props', '{}'::jsonb),
        v_event ->> 'platform',
        v_event ->> 'app_version'
      );
      v_written := v_written + 1;
    exception
      when others then
        -- One bad event is dropped; the batch continues. Nothing is logged
        -- here on purpose: a per-event RAISE NOTICE on a spammable endpoint is
        -- its own volume problem.
        null;
    end;
  end loop;

  return v_written;
end $$;

comment on function public.record_telemetry_events(uuid, jsonb) is
  'Batch-writes up to 50 telemetry events for one in-memory session. Granted to anon because much of the funnel is pre-sign-in. Per-event failures are swallowed so one malformed event cannot discard a batch; returns the number written. Raises INVALID_INPUT for a null session or a non-array payload.';

-- SAFETY: functions default to EXECUTE granted to PUBLIC, and this project also
-- auto-grants anon at CREATE time. anon is INTENDED here, so the revoke exists
-- to drop `public` and then re-grant deliberately — the grant should read as a
-- decision, not as something inherited. Same pattern as
-- record_onboarding_step.
revoke execute on function public.record_telemetry_events(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.record_telemetry_events(uuid, jsonb)
  to anon, authenticated, service_role;


-- =============================================================================
-- 4. RETENTION
-- =============================================================================
-- Counters, not history: nothing here is worth keeping once the question it
-- answered has been answered, and an anon-writable table is exactly the one
-- that should not grow without bound.
--
-- ⚠️ NOT SCHEDULED. There is no pg_cron in this project yet — the same
-- deferral push_sends, stripe_webhook_events and purge_onboarding_events
-- already carry. The function exists so the ops pass has one thing to schedule
-- rather than one thing to write.
--
-- 90 days rather than onboarding's 180: this table takes far more volume per
-- session, and no product question here reaches back a quarter.
create or replace function public.purge_telemetry_events()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  delete from public.telemetry_events where at < now() - interval '90 days';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end $$;

comment on function public.purge_telemetry_events() is
  'Deletes telemetry rows older than 90 days. NOT scheduled — no pg_cron in this project yet; attach it in the ops pass alongside purge_onboarding_events and purge_old_notifications.';

revoke execute on function public.purge_telemetry_events() from public, anon, authenticated;
grant execute on function public.purge_telemetry_events() to service_role;


-- =============================================================================
-- END OF MIGRATION
-- =============================================================================

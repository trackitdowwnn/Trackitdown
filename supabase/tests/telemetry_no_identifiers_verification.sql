-- =============================================================================
-- WHAT:  Verification for 20261028160000_telemetry_carries_no_identifiers.sql.
--        NOT a migration.
-- WHY:   docs/logging-decisions.md §3 — telemetry carries no user id, no post
--        id and no coordinates, even from an app that predates the allow-list.
-- CHECKS: 1 ⚠️ an old-style event (postId, userId, origin, lat, a UUID under
-- `from`/`path`, a coordinate under `index`) is stored with only its counts ·
-- 2 an event whose every key is stripped is still counted, with {} · 3 ⚠️ the
-- purge path: an UPDATE of a pre-migration row strips it the same way.
-- HOW:   Self-asserting, RAISE on failure (CI's db job), inside begin/rollback.
-- LINKS: supabase/migrations/20261028160000_telemetry_carries_no_identifiers.sql,
--        src/shared/lib/telemetry.ts (TELEMETRY_KEYS, the client half).
-- =============================================================================

begin;

-- CHECK 1 + 2 — through the RPC, as the app (anon) calls it.
set local role anon;
select public.record_telemetry_events(
  'aaaaaaaa-0000-4000-8000-000000000001',
  jsonb_build_array(
    jsonb_build_object('event', 'legacy_event', 'feature', 'vehicles', 'level', 'info',
      'props', jsonb_build_object(
        'postId', 'p1', 'userId', 'u1', 'origin', '53.48,-2.24', 'lat', 51.5,
        'from', '6f9619ff-8b86-d011-b42d-00cf4fc964ff', 'index', 53.480759,
        'count', 3, 'to', 'list')),
    jsonb_build_object('event', 'only_an_id', 'feature', 'vehicles', 'level', 'info',
      'props', jsonb_build_object('postId', 'p1', 'path', '11111111-1111-1111-1111-111111111111/a.jpg'))
  ));
reset role;

do $$
declare
  v_props jsonb;
begin
  select props into v_props from public.telemetry_events
   where session_id = 'aaaaaaaa-0000-4000-8000-000000000001' and event = 'legacy_event';
  if v_props is distinct from jsonb_build_object('count', 3, 'to', 'list') then
    raise exception 'CHECK 1 FAILED: stored props were %', v_props;
  end if;
  raise notice 'CHECK 1 passed: ids, places and hidden UUIDs/coordinates are stripped; counts kept.';

  select props into v_props from public.telemetry_events
   where session_id = 'aaaaaaaa-0000-4000-8000-000000000001' and event = 'only_an_id';
  if v_props is distinct from '{}'::jsonb then
    raise exception 'CHECK 2 FAILED: expected the event with {} props, got %', v_props;
  end if;
  raise notice 'CHECK 2 passed: a fully-stripped event is still counted.';
end $$;

-- CHECK 3 — a row written before the migration (trigger off), then the purge's UPDATE.
alter table public.telemetry_events disable trigger telemetry_events_props_flat;
insert into public.telemetry_events (session_id, event, feature, level, props)
values ('aaaaaaaa-0000-4000-8000-000000000002', 'old_row', 'auth', 'info',
        jsonb_build_object('userId', 'u1', 'provider', 'google'));
alter table public.telemetry_events enable trigger telemetry_events_props_flat;

update public.telemetry_events set props = props
 where session_id = 'aaaaaaaa-0000-4000-8000-000000000002';

do $$
begin
  if (select props from public.telemetry_events
       where session_id = 'aaaaaaaa-0000-4000-8000-000000000002')
     is distinct from jsonb_build_object('provider', 'google') then
    raise exception 'CHECK 3 FAILED: the purge did not strip an old row.';
  end if;
  raise notice 'CHECK 3 passed: the purge strips rows written before the migration.';
end $$;

rollback;

-- =============================================================================
-- WHAT: telemetry_events.props can no longer hold an identifier or a location.
--       The props trigger now STRIPS, before its existing checks:
--         * keys that name an id (`id`, `…Id`, `…_id`, plural too);
--         * keys that name a place or contact (lat, lng, coord, origin, plate,
--           email, phone, address, postcode) or a secret;
--         * string values containing a UUID, and numbers shaped like a
--           coordinate (4+ decimals within ±180).
--       Then the rows already stored are put through the same filter.
--
-- WHY:  docs/logging-decisions.md §3 (owner, 2026-10-28): telemetry carries no
--       user id, no post id and no coordinates. The app's denylist missed
--       `userId`, `postId` and a ~1 km `origin` — 2,767 of 5,916 prod rows
--       carried one. The app now sends an allow-list, but an install that has
--       not taken that OTA still sends the old keys, and the client is not the
--       boundary. STRIPPED, not rejected: the old app puts a postId on most
--       events, and rejecting would lose the counts along with the id.
--
-- HOW:  telemetry_props_are_flat() RESTATED IN FULL from 20260830120000; the
--       strip step (marked NEW) is the only change. The purge is an UPDATE
--       that rewrites props to itself, so the BEFORE UPDATE trigger does the
--       stripping — one rule, applied identically to old and new rows. Prod
--       holds test data only (2026-10-28).
-- =============================================================================

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
  -- NEW: no identifier, place or secret survives, whatever the client sent.
  new.props := coalesce((
    select jsonb_object_agg(e.key, e.value)
      from jsonb_each(new.props) as e
     where e.key !~ '(^ids?$|Ids?$|_ids?$)'
       and e.key !~* '(lat|lng|long|coord|origin|plate|email|phone|address|postcode|token|secret|password)'
       and not (jsonb_typeof(e.value) = 'string'
                and (e.value #>> '{}') ~* '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}')
       and not (jsonb_typeof(e.value) = 'number'
                and abs((e.value #>> '{}')::numeric) <= 180
                and (e.value #>> '{}') ~ '\.[0-9]{4,}')
  ), '{}'::jsonb);

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
  'Enforces the telemetry_events.props contract. FIRST strips identifier keys (id/…Id/…_id), place/contact/secret keys, string values containing a UUID and coordinate-shaped numbers (docs/logging-decisions.md §3) — stripped rather than rejected so an old app keeps its counts. THEN, as before: at most 8 keys, scalar values only, strings under 200 chars, snake/camelCase keys, raising on violation.';

revoke execute on function public.telemetry_props_are_flat() from public, anon, authenticated;

-- The rows already stored: rewrite props to itself and let the trigger strip.
update public.telemetry_events
   set props = props
 where exists (
   select 1 from jsonb_each(props) as e
    where e.key ~ '(^ids?$|Ids?$|_ids?$)'
       or e.key ~* '(lat|lng|long|coord|origin|plate|email|phone|address|postcode|token|secret|password)'
       or (jsonb_typeof(e.value) = 'string'
           and (e.value #>> '{}') ~* '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}')
       or (jsonb_typeof(e.value) = 'number'
           and abs((e.value #>> '{}')::numeric) <= 180
           and (e.value #>> '{}') ~ '\.[0-9]{4,}')
 );

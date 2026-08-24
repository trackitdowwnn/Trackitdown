-- =============================================================================
-- Notification preferences verification (NOT a migration — do not place in
-- migrations/).
--
-- SELF-ASSERTING: each check is a seeded begin…rollback (or a grant assertion)
-- that RAISES on failure, so the file aborts non-zero the moment a property is
-- violated. Properties: a missing preferences row means SEND, muting a category
-- removes exactly that category's kinds and nothing else, the two unmutable
-- kinds cannot be silenced by any stored preference, the write RPC refuses an
-- unknown category and a guest, and no client role can read or write the table
-- directly.
--
-- ⚠️ CHECK 4 IS THE ONE THAT MATTERS. `sighting` (someone has seen your stolen
-- car) and `closed_uncredited` (you have 72 hours to contest a bounty decision,
-- and the push is the ONLY door to that screen — docs/ROADMAP.md:129) have no
-- category, so no stored preference can drop them. If that ever stops being
-- true, this is the check that says so.
--
-- Run against a local DB seeded by supabase/seed.sql:
--     supabase db reset
--     npm run test:db
-- =============================================================================


-- -----------------------------------------------------------------------------
-- CHECK 1 — a user with NO preferences row receives everything.
-- The default is expressed twice (the column default and the LEFT JOIN's
-- coalesce) and this asserts the half that runs for someone who has never
-- opened Settings, which is almost everybody.
-- -----------------------------------------------------------------------------
begin;
do $$
declare
  v_uid   uuid := '11111111-1111-1111-1111-111111111111';
  v_kind  text;
  v_count integer;
begin
  delete from public.notification_preferences where user_id = v_uid;

  foreach v_kind in array array['alert', 'message', 'credited', 'recovery',
                                'sighting', 'closed_uncredited'] loop
    select count(*) into v_count
    from public.push_recipients(array[v_uid], v_kind);

    if v_count <> 1 then
      raise exception 'CHECK 1 FAILED: kind % dropped a user with no preferences row', v_kind;
    end if;
  end loop;
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 2 — muting a category removes exactly that category's kinds.
-- -----------------------------------------------------------------------------
begin;
do $$
declare
  v_uid   uuid := '11111111-1111-1111-1111-111111111111';
  v_count integer;
begin
  insert into public.notification_preferences (user_id, alerts_enabled)
  values (v_uid, false)
  on conflict (user_id) do update set alerts_enabled = false;

  select count(*) into v_count from public.push_recipients(array[v_uid], 'alert');
  if v_count <> 0 then
    raise exception 'CHECK 2 FAILED: a muted alert still reached the audience';
  end if;

  -- Everything else is untouched: muting one category must not be a quiet
  -- master switch.
  select count(*) into v_count from public.push_recipients(array[v_uid], 'message');
  if v_count <> 1 then
    raise exception 'CHECK 2 FAILED: muting alerts also silenced messages';
  end if;

  select count(*) into v_count from public.push_recipients(array[v_uid], 'credited');
  if v_count <> 1 then
    raise exception 'CHECK 2 FAILED: muting alerts also silenced money';
  end if;
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 3 — a category covers ALL of its kinds.
-- `my_sightings` and `money` each cover several, and a map that dropped one
-- would leave a switch that half works — the worst kind, because the user
-- believes it is done.
-- -----------------------------------------------------------------------------
begin;
do $$
declare
  v_uid   uuid := '11111111-1111-1111-1111-111111111111';
  v_kind  text;
  v_count integer;
begin
  insert into public.notification_preferences
    (user_id, my_sightings_enabled, money_enabled, watched_enabled, messages_enabled)
  values (v_uid, false, false, false, false)
  on conflict (user_id) do update
    set my_sightings_enabled = false, money_enabled = false,
        watched_enabled = false, messages_enabled = false;

  foreach v_kind in array array['sighting_confirmed', 'not_credited',
                                'credited', 'payout_sent',
                                'dispute_upheld', 'dispute_rejected',
                                'recovery', 'message'] loop
    select count(*) into v_count from public.push_recipients(array[v_uid], v_kind);
    if v_count <> 0 then
      raise exception 'CHECK 3 FAILED: kind % survived its category being muted', v_kind;
    end if;
  end loop;
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 4 — ⚠️ THE UNMUTABLE KINDS SURVIVE EVERY PREFERENCE BEING OFF.
--
-- A sighting of your own stolen car is the one notification this product
-- exists to deliver. `closed_uncredited` opens a 72-hour window to contest a
-- bounty decision and its push is the only route to that screen, so silencing
-- it removes a money right rather than an interruption. Neither has a category,
-- so neither has a column — and this proves it from the outside.
-- -----------------------------------------------------------------------------
begin;
do $$
declare
  v_uid   uuid := '11111111-1111-1111-1111-111111111111';
  v_kind  text;
  v_count integer;
begin
  insert into public.notification_preferences
    (user_id, alerts_enabled, messages_enabled, my_sightings_enabled,
     money_enabled, watched_enabled)
  values (v_uid, false, false, false, false, false)
  on conflict (user_id) do update
    set alerts_enabled = false, messages_enabled = false,
        my_sightings_enabled = false, money_enabled = false,
        watched_enabled = false;

  foreach v_kind in array array['sighting', 'closed_uncredited'] loop
    select count(*) into v_count from public.push_recipients(array[v_uid], v_kind);
    if v_count <> 1 then
      raise exception 'CHECK 4 FAILED: % was silenced — it must never be mutable', v_kind;
    end if;
  end loop;

  -- And an unclassified future kind keeps being delivered rather than being
  -- silently dropped for everyone who muted anything.
  select count(*) into v_count from public.push_recipients(array[v_uid], 'some_future_kind');
  if v_count <> 1 then
    raise exception 'CHECK 4 FAILED: an unclassified kind was dropped';
  end if;
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 5 — the write RPC pins auth.uid(), creates the row, and refuses
-- anything it does not recognise.
-- -----------------------------------------------------------------------------
begin;
do $$
declare
  v_uid       uuid := '11111111-1111-1111-1111-111111111111';
  v_enabled   boolean;
  v_bad       boolean := false;
  v_null      boolean := false;
  v_guest     boolean := false;
  v_err       text := '(no error raised at all)';
begin
  perform set_config('request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);

  delete from public.notification_preferences where user_id = v_uid;

  -- First write creates the row.
  perform public.set_my_notification_preference('messages', false);

  select messages_enabled into v_enabled
  from public.notification_preferences where user_id = v_uid;
  if v_enabled is distinct from false then
    raise exception 'CHECK 5 FAILED: the first write did not create the row';
  end if;

  -- ⚠️ Only the named category moves.
  select alerts_enabled into v_enabled
  from public.notification_preferences where user_id = v_uid;
  if v_enabled is distinct from true then
    raise exception 'CHECK 5 FAILED: writing messages also changed alerts';
  end if;

  -- ⚠️ THE SECOND WRITE IS THE IMPORTANT ONE — it takes the DO UPDATE branch,
  -- and that is the branch that can go wrong. Writing
  -- `excluded.messages_enabled` in the preserve position would read the TRUE
  -- from the VALUES list rather than the stored row, silently un-muting every
  -- category the user had already turned off on their next unrelated toggle.
  -- Only the insert branch was covered before, where "others stay true" is
  -- trivially the VALUES list.
  perform public.set_my_notification_preference('watched', false);

  select messages_enabled into v_enabled
  from public.notification_preferences where user_id = v_uid;
  if v_enabled is distinct from false then
    raise exception 'CHECK 5 FAILED: the second write un-muted the first category';
  end if;

  select watched_enabled into v_enabled
  from public.notification_preferences where user_id = v_uid;
  if v_enabled is distinct from false then
    raise exception 'CHECK 5 FAILED: the conflict branch did not apply the new value';
  end if;

  select money_enabled into v_enabled
  from public.notification_preferences where user_id = v_uid;
  if v_enabled is distinct from true then
    raise exception 'CHECK 5 FAILED: the conflict branch disturbed an untouched category';
  end if;

  begin
    perform public.set_my_notification_preference('sighting', false);
  exception when others then
    v_err := sqlerrm;
    v_bad := sqlerrm like '%INVALID_INPUT%';
  end;

  begin
    perform public.set_my_notification_preference('alerts', null);
  exception when others then
    v_null := sqlerrm like '%INVALID_INPUT%';
  end;

  -- NULL rather than '': current auth.uid() nullifs the empty string, but
  -- older definitions cast ''::json and RAISE — which the handler below would
  -- swallow into a misleading "a guest was allowed to write".
  perform set_config('request.jwt.claims', null, true);
  begin
    perform public.set_my_notification_preference('alerts', false);
  exception when others then
    v_guest := sqlerrm like '%NOT_AUTHENTICATED%';
  end;

  -- ⚠️ Trying to mute an UNMUTABLE kind by passing it as a category must be an
  -- error, not a silent success that changed nothing — a client that gets
  -- "ok" back would show the user a switch that appears to have worked.
  if not v_bad then
    raise exception 'CHECK 5 FAILED: expected INVALID_INPUT for category ''sighting'', got %', v_err;
  end if;
  if not v_null then
    raise exception 'CHECK 5 FAILED: a null enabled value was accepted';
  end if;
  if not v_guest then
    raise exception 'CHECK 5 FAILED: a guest was allowed to write preferences';
  end if;
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 6 — the read RPC returns the defaults for a user with no row, and
-- refuses a guest.
-- -----------------------------------------------------------------------------
begin;
do $$
declare
  v_row     record;
  v_refused boolean := false;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
  delete from public.notification_preferences
  where user_id = '11111111-1111-1111-1111-111111111111';

  select * into v_row from public.get_my_notification_preferences();

  if v_row is null or not (v_row.alerts_enabled and v_row.messages_enabled
      and v_row.my_sightings_enabled and v_row.money_enabled and v_row.watched_enabled) then
    raise exception 'CHECK 6 FAILED: a user with no row did not read as all-on';
  end if;

  perform set_config('request.jwt.claims', null, true);
  begin
    perform public.get_my_notification_preferences();
  exception when others then
    v_refused := sqlerrm like '%NOT_AUTHENTICATED%';
  end;

  if not v_refused then
    raise exception 'CHECK 6 FAILED: a guest could read preferences';
  end if;
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 7 — no client role touches the table, and push_recipients is
-- service-role only. Being able to write another user's row means being able to
-- silence their stolen-car alerts, which is the attack this closes.
-- -----------------------------------------------------------------------------
do $$
declare
  v_role     text;
  v_priv     text;
  v_rls      boolean;
  v_policies integer;
begin
  foreach v_role in array array['anon', 'authenticated'] loop
    -- TRIGGER included: `revoke all` does remove it, but an assertion that
    -- omits it would pass a later accidental re-grant.
    foreach v_priv in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE',
                                  'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
      if has_table_privilege(v_role, 'public.notification_preferences', v_priv) then
        raise exception 'CHECK 7 FAILED: % has % on notification_preferences', v_role, v_priv;
      end if;
    end loop;
  end loop;

  select c.relrowsecurity into v_rls
  from pg_class c where c.oid = 'public.notification_preferences'::regclass;
  if not v_rls then
    raise exception 'CHECK 7 FAILED: row level security is not enabled';
  end if;

  select count(*) into v_policies
  from pg_policies
  where schemaname = 'public' and tablename = 'notification_preferences';
  if v_policies <> 0 then
    raise exception 'CHECK 7 FAILED: expected no policies, found %', v_policies;
  end if;

  -- push_recipients reveals whether a given user has muted something. That is
  -- the send path's business and nobody else's.
  if has_function_privilege('authenticated', 'public.push_recipients(uuid[], text)', 'EXECUTE') then
    raise exception 'CHECK 7 FAILED: authenticated can execute push_recipients';
  end if;
  if has_function_privilege('anon', 'public.push_recipients(uuid[], text)', 'EXECUTE') then
    raise exception 'CHECK 7 FAILED: anon can execute push_recipients';
  end if;

  if has_function_privilege('anon',
       'public.set_my_notification_preference(text, boolean)', 'EXECUTE') then
    raise exception 'CHECK 7 FAILED: anon can execute set_my_notification_preference';
  end if;
  if not has_function_privilege('authenticated',
       'public.set_my_notification_preference(text, boolean)', 'EXECUTE') then
    raise exception 'CHECK 7 FAILED: authenticated cannot write their own preferences';
  end if;
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 8 — push_recipients narrows a MIXED audience rather than answering
-- all-or-nothing. The alert path sends to many spotters at once, so one muted
-- user must not take the others with them.
-- -----------------------------------------------------------------------------
begin;
do $$
declare
  v_muted  uuid := '11111111-1111-1111-1111-111111111111';
  v_open   uuid := '22222222-2222-2222-2222-222222222222';
  v_count  integer;
  v_has    boolean;
begin
  -- Seeded profiles only; skip quietly if the second fixture is absent rather
  -- than failing on something this check does not own.
  if not exists (select 1 from public.profiles where id = v_open) then
    return;
  end if;

  insert into public.notification_preferences (user_id, alerts_enabled)
  values (v_muted, false)
  on conflict (user_id) do update set alerts_enabled = false;
  delete from public.notification_preferences where user_id = v_open;

  select count(*) into v_count
  from public.push_recipients(array[v_muted, v_open], 'alert');
  if v_count <> 1 then
    raise exception 'CHECK 8 FAILED: expected 1 of 2 recipients, got %', v_count;
  end if;

  select exists (
    select 1 from public.push_recipients(array[v_muted, v_open], 'alert') r where r = v_open
  ) into v_has;
  if not v_has then
    raise exception 'CHECK 8 FAILED: the wrong user survived the filter';
  end if;
end $$;
rollback;


-- =============================================================================
-- END — all checks passed if this file completed without raising.
-- =============================================================================

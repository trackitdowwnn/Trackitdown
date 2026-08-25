-- =============================================================================
-- WHAT:  Per-user, per-category push preferences. Adds
--        public.notification_preferences (one row per user, five boolean
--        categories), public.notification_category(kind) — the ONE kind →
--        category map — public.push_recipients(user_ids, kind) which the send
--        path filters through, and the two RPCs the Settings screen reads and
--        writes.
-- WHY:   The app sends eleven kinds of push and offered exactly one control:
--        pausing an individual alert zone. Everything else was all-or-nothing
--        at the OS level, which meant a spotter who wanted fewer chat pings had
--        to deny the app notifications entirely — and thereby lose the sighting
--        pushes the product exists to deliver.
--
--        ⚠️ THIS FILTERS THE PUSH, NEVER THE NOTIFICATIONS ROW. ADR-0012's
--        persist-then-push rule says every notification-worthy event writes a
--        `notifications` row FIRST and then maybe pushes, so the in-app centre
--        is complete even for someone who denied push permission. Muting a
--        category must lose the INTERRUPTION, not the INFORMATION: the row is
--        still written, the Inbox still shows it, and only the buzz is
--        suppressed. `notifyUsers` writes rows before it calls `sendToUsers`,
--        and the filter added here lives inside `sendToUsers` — on purpose, and
--        it must stay on that side of the line.
--
--        ⚠️ TWO KINDS ARE DELIBERATELY NOT MUTABLE, and are absent from the
--        category map rather than present-and-locked, so there is no column for
--        a future UI to accidentally expose:
--          * `sighting` — someone has reported seeing YOUR stolen car. This is
--            the one notification the entire product exists to deliver. A
--            settings screen that lets an owner turn it off is a settings
--            screen that lets them miss the moment they signed up for.
--          * `closed_uncredited` — a post you reported a sighting on closed
--            without crediting you, and you have SEVENTY-TWO HOURS to contest
--            it. docs/ROADMAP.md:129 records that `/sighting-dispute` has no
--            in-app door at all — only the push route — so muting this makes a
--            money right literally unreachable. Until that screen has a door,
--            this push IS the door.
-- LINKS: supabase/migrations/20260802100000_push_infrastructure.sql (push_tokens,
--          push_sends, and the kind whitelist these categories partition),
--        supabase/functions/_shared/push.ts (sendToUsers — the one filter site),
--        src/features/notifications/lib/notificationPreferences.ts (the client
--          mirror; supabase/tests/notificationCategories.test.ts fails if the
--          two drift),
--        docs/decisions/ADR-0012-notification-center.md (persist-then-push).
--
-- SAFETY: notification_preferences is user-owned data with RLS ENABLED and NO
--        client policies. Reads and writes go ONLY through the two SECURITY
--        DEFINER RPCs, both pinned to auth.uid(), so one user can neither read
--        nor silence another's notifications. Silencing someone else's stolen-car
--        alerts would be a genuine attack, which is why there is no client
--        table grant at all.
--
-- SAFETY NOTE ON DESTRUCTIVE STATEMENTS: one `revoke all … from anon,
--        authenticated` on the NEW table only — it removes the privileges this
--        project's ALTER DEFAULT PRIVILEGES hands out silently at CREATE TABLE
--        (including TRUNCATE). It touches no existing table and no data.
--        Nothing else here is destructive.
-- =============================================================================


-- =============================================================================
-- 1. TABLE: notification_preferences  (one row per user, created on first write)
-- =============================================================================
-- Boolean COLUMNS rather than one row per (user, category): the set of
-- categories is closed and small, a row per user reads in one lookup on the
-- send path, and adding a category is a migration rather than a data problem.
create table public.notification_preferences (
  user_id uuid primary key references public.profiles (id) on delete cascade,

  -- Every category defaults to TRUE. A user who has never opened Settings has
  -- no row at all, and push_recipients treats a missing row as "all on" — so
  -- the default is expressed twice, deliberately, and both say send.
  alerts_enabled       boolean not null default true,
  messages_enabled     boolean not null default true,
  my_sightings_enabled boolean not null default true,
  money_enabled        boolean not null default true,
  watched_enabled      boolean not null default true,

  updated_at timestamptz not null default now()
);

comment on table public.notification_preferences is
  'Per-user push categories. Absent row = everything on. Filters the PUSH only — the notifications row is always written (ADR-0012 persist-then-push), so muting loses the interruption and never the information. RLS enabled with NO client policies; reached only through get_my_notification_preferences / set_my_notification_preference.';

alter table public.notification_preferences enable row level security;

-- SAFETY: this project ships `ALTER DEFAULT PRIVILEGES … GRANT ALL ON TABLES TO
-- anon, authenticated`, so CREATE TABLE above has ALREADY handed both roles
-- privileges including TRUNCATE and REFERENCES. Per-table grants ADD to that
-- default rather than replacing it, so the revoke has to come first and be
-- explicit. See 20260802170000_revoke_default_table_privileges.
revoke all on public.notification_preferences from anon, authenticated;

grant select, insert, update, delete on public.notification_preferences to service_role;


-- =============================================================================
-- 2. FUNCTION: notification_category(kind)
-- =============================================================================
-- ⚠️ THE ONE MAP. Every other piece of this feature derives from it: the send
-- filter, the Settings screen's groups, and the client mirror that
-- supabase/tests/notificationCategories.test.ts checks against this file.
--
-- Returns NULL for a kind that is not mutable — which is both `sighting` and
-- `closed_uncredited` (see the header for why), and ALSO any kind added in
-- future that nobody has classified yet. That default is the safe direction: an
-- unclassified kind keeps being delivered until somebody decides otherwise,
-- rather than being silently dropped for everyone who has muted anything.
create or replace function public.notification_category(p_kind text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_kind
    when 'alert'              then 'alerts'
    when 'message'            then 'messages'
    when 'sighting_confirmed' then 'my_sightings'
    when 'not_credited'       then 'my_sightings'
    when 'credited'           then 'money'
    when 'payout_sent'        then 'money'
    when 'dispute_upheld'     then 'money'
    when 'dispute_rejected'   then 'money'
    when 'recovery'           then 'watched'
    else null
  end;
$$;

comment on function public.notification_category(text) is
  'Maps a notification kind to its mutable preference category, or NULL when the kind may not be muted (sighting, closed_uncredited) or is not yet classified. NULL always means "deliver".';

-- Revoked for consistency with push_recipients below rather than because this
-- leaks anything — it is a static map with no user data in it. push_recipients
-- is SECURITY DEFINER and still resolves it.
revoke execute on function public.notification_category(text) from public, anon, authenticated;
grant execute on function public.notification_category(text) to service_role;


-- =============================================================================
-- 3. FUNCTION: push_recipients(user_ids, kind)
-- =============================================================================
-- Narrows an audience to those who have not muted this kind. The send path
-- calls this immediately before looking up device tokens.
--
-- ⚠️ A MISSING ROW MEANS SEND. `coalesce(..., true)` twice over: once for the
-- LEFT JOIN finding no preferences row, once for a NULL category. Both default
-- to delivering, because the failure this feature must never have is a stolen
-- car reported near someone whose phone stayed silent.
create or replace function public.push_recipients(p_user_ids uuid[], p_kind text)
returns setof uuid
language sql
security definer
stable
set search_path = ''
as $$
  -- ⚠️ `coalesce(p_user_ids, '{}')` — the one input that would fail CLOSED.
  -- unnest(NULL) yields zero rows, so a NULL array would silence everybody
  -- rather than nobody, inverting this function's whole policy. Unreachable
  -- from sendToUsers, which always passes an array and returns early when it
  -- is empty, but the fail-open story should have no exceptions in it.
  select u.id
  from unnest(coalesce(p_user_ids, '{}'::uuid[])) as u(id)
  left join public.notification_preferences p on p.user_id = u.id
  where coalesce(
    case public.notification_category(p_kind)
      when 'alerts'       then p.alerts_enabled
      when 'messages'     then p.messages_enabled
      when 'my_sightings' then p.my_sightings_enabled
      when 'money'        then p.money_enabled
      when 'watched'      then p.watched_enabled
      else true
    end,
    true
  );
$$;

comment on function public.push_recipients(uuid[], text) is
  'The subset of p_user_ids who should receive a PUSH of this kind. Absent preferences row or unmutable kind = included. Service-role only: it is called from the Edge Function send path, never by a client.';

-- SAFETY: service-role only. This function reveals whether a given user has
-- muted a category, which is not a client's business — and it is called only
-- from _shared/push.ts, which runs with the service key.
revoke execute on function public.push_recipients(uuid[], text) from public, anon, authenticated;
grant execute on function public.push_recipients(uuid[], text) to service_role;


-- =============================================================================
-- 4. RPC: get_my_notification_preferences()
-- =============================================================================
-- The caller's five booleans. Returns the defaults when no row exists rather
-- than nothing, so the Settings screen has no "never saved" state to render.
create or replace function public.get_my_notification_preferences()
returns table (
  alerts_enabled       boolean,
  messages_enabled     boolean,
  my_sightings_enabled boolean,
  money_enabled        boolean,
  watched_enabled      boolean
)
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  return query
  select
    coalesce(p.alerts_enabled, true),
    coalesce(p.messages_enabled, true),
    coalesce(p.my_sightings_enabled, true),
    coalesce(p.money_enabled, true),
    coalesce(p.watched_enabled, true)
  from (select 1) as one
  left join public.notification_preferences p on p.user_id = v_uid;
end;
$$;

comment on function public.get_my_notification_preferences() is
  'The caller''s push categories, defaulting to all-true when no row exists. auth.uid() pinned.';

revoke execute on function public.get_my_notification_preferences() from public, anon;
grant execute on function public.get_my_notification_preferences() to authenticated, service_role;


-- =============================================================================
-- 5. RPC: set_my_notification_preference(category, enabled)
-- =============================================================================
-- Flips ONE category for the caller, creating their row on first use.
--
-- ⚠️ ONE CATEGORY PER CALL, not a whole-object replace. The Settings screen
-- toggles one switch at a time, and a replace would let a stale client wipe a
-- preference it never knew about — the same reasoning that made
-- `update_my_alert` a full replace a documented annoyance rather than a model.
create or replace function public.set_my_notification_preference(
  p_category text,
  p_enabled  boolean
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

  if p_enabled is null then
    raise exception 'INVALID_INPUT';
  end if;

  -- ⚠️ The category whitelist is repeated here rather than derived from
  -- notification_category(), because that function maps KINDS and this one
  -- takes a CATEGORY. An unrecognised category must be refused, not silently
  -- ignored: a client sending 'sighting' — trying to mute the unmutable —
  -- should get an error rather than a success that did nothing.
  if p_category not in ('alerts', 'messages', 'my_sightings', 'money', 'watched') then
    raise exception 'INVALID_INPUT';
  end if;

  -- ⚠️ ONE STATEMENT, not INSERT … DO NOTHING followed by UPDATE. That pair
  -- reads as atomic and is not: under REPEATABLE READ or SERIALIZABLE the row a
  -- concurrent inserter created is invisible to this snapshot, DO NOTHING skips
  -- it, and the UPDATE then matches nothing — returning success having changed
  -- nothing at all. The client would leave the switch flipped and the user
  -- would be told a mute took effect that did not. An upsert cannot have that
  -- gap.
  insert into public.notification_preferences (
    user_id, alerts_enabled, messages_enabled, my_sightings_enabled,
    money_enabled, watched_enabled
  )
  -- Spelled as CASE rather than `p_category = 'x' and p_enabled or
  -- p_category <> 'x'`. That shorthand is correct — AND binds tighter than OR —
  -- and it is exactly the kind of cleverness a later reader has to stop and
  -- verify. Every category not being written keeps its default of true.
  values (
    v_uid,
    case when p_category = 'alerts'       then p_enabled else true end,
    case when p_category = 'messages'     then p_enabled else true end,
    case when p_category = 'my_sightings' then p_enabled else true end,
    case when p_category = 'money'        then p_enabled else true end,
    case when p_category = 'watched'      then p_enabled else true end
  )
  on conflict (user_id) do update
  set alerts_enabled       = case when p_category = 'alerts'       then p_enabled else public.notification_preferences.alerts_enabled end,
      messages_enabled     = case when p_category = 'messages'     then p_enabled else public.notification_preferences.messages_enabled end,
      my_sightings_enabled = case when p_category = 'my_sightings' then p_enabled else public.notification_preferences.my_sightings_enabled end,
      money_enabled        = case when p_category = 'money'        then p_enabled else public.notification_preferences.money_enabled end,
      watched_enabled      = case when p_category = 'watched'      then p_enabled else public.notification_preferences.watched_enabled end,
      updated_at           = now();
end;
$$;

comment on function public.set_my_notification_preference(text, boolean) is
  'Flips one push category for the caller, creating their preferences row on first use. Raises NOT_AUTHENTICATED for a guest and INVALID_INPUT for an unknown category or a null value. auth.uid() pinned.';

revoke execute on function public.set_my_notification_preference(text, boolean) from public, anon;
grant execute on function public.set_my_notification_preference(text, boolean) to authenticated, service_role;


-- =============================================================================
-- END OF MIGRATION
-- =============================================================================

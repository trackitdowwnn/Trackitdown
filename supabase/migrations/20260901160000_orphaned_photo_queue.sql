-- =============================================================================
-- WHAT:  The orphaned-photo queue. Adds public.orphaned_photos, AFTER DELETE
--        triggers on the four tables that hold a `post-photos` URL, and the two
--        RPCs a sweep uses to drain it (claim_orphaned_photos /
--        forget_orphaned_photos). It deletes NOTHING from storage itself.
-- WHY:   UK GDPR erasure gap, open since 2026-08-01 and recorded in
--        SECURITY_AND_TRUST §3 as "STILL OPEN — delete_vehicle /
--        update_vehicle orphan objects". `delete_vehicle` removes rows;
--        `vehicle_photos` and `vehicle_distinctive_feature` cascade with the
--        vehicle — and the JPEGs stay in the PUBLIC `post-photos` bucket,
--        reachable by URL forever. A person who deletes their car has been told
--        their photographs are gone. They are not.
--
-- ⚠️ WHY THIS IS A QUEUE AND NOT A DELETE. `delete-account`'s header states the
--        rule this project already follows: "the sweep deletes through the
--        STORAGE API, never by deleting rows from storage.objects. A direct row
--        delete removes the DB record but leaves the bytes in the backing
--        store — orphaned files that no longer appear in any listing and so can
--        never be found again. SQL is used only to FIND the paths."
--
--        SQL cannot reach the storage API. So SQL does what it is good for —
--        noticing that a row went away and recording which object it named —
--        and `release-held-refunds` does the removal, beside the two retention
--        purges it already runs.
--
-- ⚠️ THE SHARED-OBJECT HAZARD IS THE WHOLE DIFFICULTY, and it is why the
--        reference check happens at DRAIN time rather than at enqueue.
--        A post created from a garage vehicle SNAPSHOTS the same photo URLs
--        (garage/README.md), so one object is routinely named by both a
--        `vehicle_photos` row and a `post_photos` row. Deleting the object when
--        the vehicle goes would blank the hero image of somebody's LIVE
--        stolen-car listing — the exact failure SECURITY_AND_TRUST warns about:
--        "deleting one blindly would blank the hero image of a live stolen-car
--        listing".
--
--        So a queued path is only ever a CANDIDATE. `claim_orphaned_photos`
--        hands back only paths that no row in any of the four tables still
--        names, and silently drops the rest from the queue — if that object is
--        later orphaned by its own delete, the trigger re-enqueues it.
--
-- ⚠️ TRIGGERS, NOT A CHANGE TO delete_vehicle. Four tables lose photo rows by
--        several routes — cascade from `vehicles`, cascade from `posts`,
--        `update_vehicle` and `update_post_photos` replacing a set — and a
--        check inside one RPC would cover one of them. The same reasoning as
--        20260901150000's block triggers, and the same hazard avoided: a
--        `create or replace` of `delete_vehicle` would mean hand-copying a body
--        to add two lines, which is how the send_message draft silently dropped
--        an advisory lock the same day.
--
-- SAFETY NOTE ON DESTRUCTIVE STATEMENTS: this migration deletes nothing and
--        removes no object. It creates a table, four triggers and two
--        functions. The only deletion it ENABLES is of storage objects that no
--        database row references, performed later, elsewhere, and re-checked
--        at that moment.
--
-- LINKS: supabase/functions/delete-account/index.ts (the storage-API rule, and
--          the chunked `remove` this mirrors);
--        supabase/functions/release-held-refunds/index.ts (the drain);
--        supabase/migrations/20260801100000_garage_vehicles.sql (delete_vehicle,
--          vehicle_photos, and the shared-snapshot note);
--        src/shared/api/photoUpload.ts (the URL shape parsed below);
--        supabase/tests/orphaned_photos_verification.sql;
--        docs/SECURITY_AND_TRUST.md §3.
-- =============================================================================


-- =============================================================================
-- 1. photo_path_from_url — the one place the URL shape is understood
-- =============================================================================
-- uploadOwnFolderPhoto stores at `<userId>/<hash>-<index>.jpg` in the
-- `post-photos` bucket and hands back getPublicUrl's value, which is
-- `<project>/storage/v1/object/public/post-photos/<path>`.
--
-- ⚠️ RETURNS NULL FOR ANYTHING ELSE, and that is load-bearing. A row holding a
-- URL from somewhere else — a seed fixture, a future bucket, a hand-edited
-- value — must produce no queue entry at all rather than a mangled path that a
-- sweep would then try to delete. Fail closed: an object we cannot name is an
-- object we must not remove.
create or replace function public.photo_path_from_url(p_url text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_url is null then null
    when position('/object/public/post-photos/' in p_url) = 0 then null
    else nullif(
      split_part(p_url, '/object/public/post-photos/', 2),
      ''
    )
  end;
$$;

comment on function public.photo_path_from_url(text) is
  'Extracts the storage path from a post-photos public URL, or NULL for anything that is not one. Fail-closed by design: an object we cannot name is one a sweep must never try to delete.';

revoke execute on function public.photo_path_from_url(text) from public, anon, authenticated;
grant execute on function public.photo_path_from_url(text) to service_role;


-- =============================================================================
-- 2. TABLE: orphaned_photos
-- =============================================================================
create table public.orphaned_photos (
  -- The storage path, which IS the identity: the same object queued twice by
  -- two different rows disappearing is one deletion.
  path        text primary key,
  -- When the last row naming it went away. Kept for diagnosis — a path sitting
  -- here for weeks means the sweep is not running, which is exactly the silent
  -- failure the whole-app review flagged about retention generally.
  enqueued_at timestamptz not null default now()
);

comment on table public.orphaned_photos is
  'CANDIDATE storage paths whose last referencing row was deleted. A row here is not proof the object is unreferenced — claim_orphaned_photos re-checks all four photo tables at drain time, because a post created from a garage vehicle snapshots the same URLs. Written only by triggers; read only by the sweep.';

create index orphaned_photos_enqueued_idx on public.orphaned_photos (enqueued_at);

alter table public.orphaned_photos enable row level security;

-- RLS ENABLED WITH NO CLIENT POLICIES, and no client grant. This table names
-- other people's storage paths; a client that could read it would learn object
-- names it was never shown.
--
-- SAFETY: this project's ALTER DEFAULT PRIVILEGES has already handed anon and
-- authenticated privileges including TRUNCATE at CREATE TABLE, so the revoke
-- must be explicit and must come first (20260901130000).
-- anon_role_verification CHECK 13 fails the build if this is forgotten.
revoke all on public.orphaned_photos from anon, authenticated;

grant select, insert, update, delete on public.orphaned_photos to service_role;


-- =============================================================================
-- 3. THE TRIGGERS — one function, four tables
-- =============================================================================
-- ⚠️ ONE FUNCTION READING TWO POSSIBLE COLUMN NAMES, because the four tables
-- disagree: post_photos and vehicle_photos call it `url`, the two
-- distinctive-feature tables call it `photo_url`. A trigger function per table
-- would be four places for the same rule to drift.
create or replace function public.enqueue_orphaned_photo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url  text;
  v_path text;
begin
  -- to_jsonb on OLD lets one function serve both column names without dynamic
  -- SQL. The row is small and this fires once per deleted photo row.
  v_url := coalesce(to_jsonb(old) ->> 'url', to_jsonb(old) ->> 'photo_url');
  v_path := public.photo_path_from_url(v_url);

  if v_path is not null then
    insert into public.orphaned_photos (path)
    values (v_path)
    on conflict (path) do nothing;
  end if;

  return old;
end $$;

comment on function public.enqueue_orphaned_photo() is
  'AFTER DELETE trigger for the four photo tables: queues the deleted row''s storage path as a CANDIDATE orphan. Reads `url` or `photo_url`, whichever the table has. Never deletes anything; never decides whether the object is really unreferenced — claim_orphaned_photos does that.';

revoke execute on function public.enqueue_orphaned_photo() from public, anon, authenticated;

create trigger post_photos_enqueue_orphan
  after delete on public.post_photos
  for each row execute function public.enqueue_orphaned_photo();

create trigger vehicle_photos_enqueue_orphan
  after delete on public.vehicle_photos
  for each row execute function public.enqueue_orphaned_photo();

create trigger post_feature_enqueue_orphan
  after delete on public.post_distinctive_feature
  for each row execute function public.enqueue_orphaned_photo();

create trigger vehicle_feature_enqueue_orphan
  after delete on public.vehicle_distinctive_feature
  for each row execute function public.enqueue_orphaned_photo();


-- =============================================================================
-- 4. claim_orphaned_photos — the drain's read, and the safety gate
-- =============================================================================
-- ⚠️ THIS IS WHERE THE SHARED-OBJECT CHECK LIVES, and it must stay here rather
-- than move to the trigger. At enqueue time the referencing row has only just
-- gone; the question "does anything else still name this object" is one only
-- the whole database can answer, and the answer can change between enqueue and
-- drain.
--
-- A still-referenced path is DROPPED from the queue rather than kept: the
-- object is not an orphan, and if it becomes one later its own delete
-- re-enqueues it. Keeping it would mean re-checking the same live photo every
-- hour forever.
-- Split out so the check is ONE expression rather than a four-branch `or`
-- repeated in two places, and so a test can call it directly.
create or replace function public.orphaned_photo_still_referenced(p_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.post_photos t
                  where public.photo_path_from_url(t.url) = p_path)
      or exists (select 1 from public.vehicle_photos t
                  where public.photo_path_from_url(t.url) = p_path)
      or exists (select 1 from public.post_distinctive_feature t
                  where public.photo_path_from_url(t.photo_url) = p_path)
      or exists (select 1 from public.vehicle_distinctive_feature t
                  where public.photo_path_from_url(t.photo_url) = p_path);
$$;

comment on function public.orphaned_photo_still_referenced(text) is
  'True when any of the four photo tables still names this storage path. The guard that stops a garage deletion blanking the hero image of a live listing, since a post created from a vehicle snapshots the same URLs.';

create or replace function public.claim_orphaned_photos(p_limit integer default 100)
returns setof text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception 'INVALID_INPUT';
  end if;

  -- Not an orphan after all: something still names it.
  delete from public.orphaned_photos o
   where public.orphaned_photo_still_referenced(o.path);

  return query
    select o.path
      from public.orphaned_photos o
     order by o.enqueued_at
     limit p_limit;
end $$;

comment on function public.claim_orphaned_photos(integer) is
  'Returns up to p_limit storage paths that NO photo row still references, oldest first, having first dropped any queued path that turned out to be still in use. Read-only with respect to storage — the caller removes the objects through the storage API and then calls forget_orphaned_photos.';


-- =============================================================================
-- 5. forget_orphaned_photos — called only after a successful removal
-- =============================================================================
-- ⚠️ SEPARATE FROM THE CLAIM ON PURPOSE. If the queue row were deleted at claim
-- time, a storage failure between the two would lose the path permanently and
-- the object would be unreachable forever — precisely the orphan this feature
-- exists to prevent, created by the tool meant to fix it. Claim is idempotent
-- and forget is explicit, so a failed sweep simply retries next hour.
create or replace function public.forget_orphaned_photos(p_paths text[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  if p_paths is null then
    return 0;
  end if;

  delete from public.orphaned_photos where path = any (p_paths);
  get diagnostics v_deleted = row_count;
  return v_deleted;
end $$;

comment on function public.forget_orphaned_photos(text[]) is
  'Removes queue rows for paths whose objects have been deleted. Called ONLY after the storage API confirmed removal: claiming and forgetting are separate so a failure between them retries rather than losing the path forever.';

revoke execute on function public.claim_orphaned_photos(integer) from public, anon, authenticated;
grant execute on function public.claim_orphaned_photos(integer) to service_role;
revoke execute on function public.orphaned_photo_still_referenced(text) from public, anon, authenticated;
grant execute on function public.orphaned_photo_still_referenced(text) to service_role;
revoke execute on function public.forget_orphaned_photos(text[]) from public, anon, authenticated;
grant execute on function public.forget_orphaned_photos(text[]) to service_role;


-- =============================================================================
-- END OF MIGRATION
-- =============================================================================

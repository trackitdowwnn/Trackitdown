-- =============================================================================
-- WHAT: The orphan queue for SIGHTING photos: public.orphaned_sighting_photos,
--       an AFTER DELETE trigger on sighting_photos, and the claim / forget
--       pair the sweep drains it with. Also corrects the false comment on
--       sighting_photos.sighting_id. Deletes NOTHING from storage itself.
--
-- WHY:  20260921100000 makes post deletion ROUTINE — an owner action and an
--       hourly retention job — and sighting_photos rows cascade with the
--       sightings. But the 20260901160000 orphan queue covers only the four
--       tables holding `post-photos` URLs; a sighting photo's bytes live in
--       the PRIVATE `sighting-photos` bucket, its row holds a bare path, and
--       nothing anywhere removed those objects. Every post delete (and every
--       withdraw-sighting delete) would strand spotter-taken JPEGs as bytes
--       findable by nothing — the exact unerasable-orphan anti-pattern
--       SECURITY_AND_TRUST §3 warns about, accumulating unboundedly.
--
--       (sighting_photos.sighting_id's comment claimed "the storage object is
--       removed separately by the retention job" — it never was: the retention
--       job only NULLS the capture-time GPS. Corrected below.)
--
-- ⚠️ A SEPARATE QUEUE, NOT A FIFTH TRIGGER ON THE EXISTING ONE, for two
--       reasons. The existing queue's identity is a path in the `post-photos`
--       bucket and its claim re-checks the four URL-holding tables; wiring a
--       different bucket through it means a bucket column, a composite key,
--       and new signatures on two functions the sweep already calls — churn
--       on a proven money-adjacent path. And the hazards genuinely differ:
--       post-photo objects are CONTENT-SHARED across listings (the whole
--       difficulty over there), while a sighting photo's path is pinned by
--       create_sighting to '<post_id>/<spotter_id>/<filename>.jpg' — owned by
--       one sighting, never snapshotted elsewhere. The claim still re-checks
--       for a surviving reference, but as a cheap assertion, not a load-
--       bearing shared-object gate.
--
-- ⚠️ CLAIM → REMOVE → FORGET, same contract as 20260901160000: the queue row
--       outlives the claim, and is forgotten only after the storage API
--       confirms removal, so a failure in between retries instead of losing
--       the path — an orphan manufactured by the tool meant to prevent them.
--
-- SAFETY NOTE ON DESTRUCTIVE STATEMENTS: this migration deletes nothing and
--       removes no object. One table, one trigger, three functions, one
--       comment correction. The only deletion it ENABLES is of storage
--       objects whose database row is already gone, performed later,
--       elsewhere, and re-checked at that moment.
--
-- LINKS: supabase/migrations/20260901160000_orphaned_photo_queue.sql (the
--          post-photos twin whose contract this copies);
--        supabase/migrations/20260921100000_a_cancelled_post_can_be_deleted.sql
--          (what makes post deletion routine);
--        supabase/migrations/20260714100000_sightings.sql (sighting_photos,
--          the path shape, the private bucket);
--        supabase/functions/release-held-refunds/index.ts (Phase 0c, the
--          drain);
--        docs/SECURITY_AND_TRUST.md §3.
-- =============================================================================


-- =============================================================================
-- 1. Correct the record first.
-- =============================================================================
comment on column public.sighting_photos.sighting_id is
  'Parent sighting. ON DELETE CASCADE: a photo row is wholly owned by its sighting and dies with it. The storage object is queued by sighting_photos_enqueue_orphan on row delete and removed by the hourly sweep (the 90-day retention job only nulls this row''s capture-time GPS — it never touched storage).';


-- =============================================================================
-- 2. TABLE: orphaned_sighting_photos
-- =============================================================================
create table public.orphaned_sighting_photos (
  -- The storage path inside the PRIVATE sighting-photos bucket, which IS the
  -- identity: the same object queued twice is one deletion.
  path        text primary key,
  enqueued_at timestamptz not null default now()
);

comment on table public.orphaned_sighting_photos is
  'CANDIDATE sighting-photos storage paths whose referencing row was deleted. Paths are pinned per sighting (''<post_id>/<spotter_id>/<file>.jpg''), never content-shared, so unlike orphaned_photos the drain-time reference check is an assertion rather than a shared-object gate. Written only by the trigger; read only by the sweep.';

create index orphaned_sighting_photos_enqueued_idx
  on public.orphaned_sighting_photos (enqueued_at);

alter table public.orphaned_sighting_photos enable row level security;

-- RLS ENABLED WITH NO CLIENT POLICIES, and the explicit revoke because this
-- project's ALTER DEFAULT PRIVILEGES hands anon/authenticated table privileges
-- at CREATE TABLE (20260901130000). These paths embed post ids and spotter
-- ids; a client that could read them would learn who reported what.
revoke all on public.orphaned_sighting_photos from anon, authenticated;

grant select, insert, update, delete on public.orphaned_sighting_photos to service_role;


-- =============================================================================
-- 3. The trigger
-- =============================================================================
create or replace function public.enqueue_orphaned_sighting_photo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- The row stores the bare path already (never a URL — the bucket is
  -- private), so unlike enqueue_orphaned_photo there is nothing to parse and
  -- nothing to fail closed on.
  if old.path is not null then
    insert into public.orphaned_sighting_photos (path)
    values (old.path)
    on conflict (path) do nothing;
  end if;

  return old;
end $$;

comment on function public.enqueue_orphaned_sighting_photo() is
  'AFTER DELETE trigger on sighting_photos: queues the deleted row''s storage path as a CANDIDATE orphan. Never deletes anything — the sweep removes the object through the storage API and forgets the row only on confirmed success.';

revoke execute on function public.enqueue_orphaned_sighting_photo() from public, anon, authenticated;

create trigger sighting_photos_enqueue_orphan
  after delete on public.sighting_photos
  for each row execute function public.enqueue_orphaned_sighting_photo();


-- =============================================================================
-- 4. claim / forget — the same two-step the post-photos queue uses
-- =============================================================================
create or replace function public.claim_orphaned_sighting_photos(p_limit integer default 100)
returns setof text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception 'INVALID_INPUT';
  end if;

  -- Should be impossible (paths are per-sighting, and the row just died), but
  -- cheap, and the one property that must hold before deleting bytes: no
  -- surviving row names this object.
  delete from public.orphaned_sighting_photos o
   where exists (select 1 from public.sighting_photos sp where sp.path = o.path);

  return query
    select o.path
      from public.orphaned_sighting_photos o
     order by o.enqueued_at
     limit p_limit;
end $$;

comment on function public.claim_orphaned_sighting_photos(integer) is
  'Returns up to p_limit sighting-photos storage paths that no sighting_photos row still references, oldest first. Read-only with respect to storage — the caller removes the objects through the storage API and then calls forget_orphaned_sighting_photos.';

create or replace function public.forget_orphaned_sighting_photos(p_paths text[])
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

  delete from public.orphaned_sighting_photos where path = any (p_paths);
  get diagnostics v_deleted = row_count;
  return v_deleted;
end $$;

comment on function public.forget_orphaned_sighting_photos(text[]) is
  'Removes queue rows for paths whose objects have been deleted. Called ONLY after the storage API confirmed removal: claiming and forgetting are separate so a failure between them retries rather than losing the path forever.';

revoke execute on function public.claim_orphaned_sighting_photos(integer) from public, anon, authenticated;
grant execute on function public.claim_orphaned_sighting_photos(integer) to service_role;
revoke execute on function public.forget_orphaned_sighting_photos(text[]) from public, anon, authenticated;
grant execute on function public.forget_orphaned_sighting_photos(text[]) to service_role;

-- --- Assert the grants -------------------------------------------------------
do $$
begin
  if has_function_privilege('authenticated', 'public.claim_orphaned_sighting_photos(integer)', 'execute')
     or has_function_privilege('anon', 'public.claim_orphaned_sighting_photos(integer)', 'execute')
     or has_function_privilege('authenticated', 'public.forget_orphaned_sighting_photos(text[])', 'execute')
     or has_function_privilege('anon', 'public.forget_orphaned_sighting_photos(text[])', 'execute') then
    raise exception 'the sighting-photo orphan queue is client-executable — paths embed post and spotter ids';
  end if;
  if not has_function_privilege('service_role', 'public.claim_orphaned_sighting_photos(integer)', 'execute')
     or not has_function_privilege('service_role', 'public.forget_orphaned_sighting_photos(text[])', 'execute') then
    raise exception 'service_role cannot drain the sighting-photo orphan queue — the sweep is broken';
  end if;
end;
$$;

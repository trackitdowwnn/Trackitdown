-- =============================================================================
-- WHAT:  "Download your data" (UK GDPR Art. 15 access / Art. 20 portability).
--        - Private bucket `data-exports` — the JSON files export-my-data
--          writes, at `<uid>/<random>.json`. NO storage policies: only the
--          service role reads or writes it; the user gets a 15-minute signed
--          URL to their own file.
--        - `data_export_requests` — one row per file: the once-a-day limit
--          (a second tap within 24h re-signs the same file) and the audit log.
--          No payload, no URL — ids, path, size, times.
--        - `claim_expired_data_exports` / `forget_data_export` — the hourly
--          sweep deletes files older than 24h through the Storage API, the
--          claim/forget shape of claim_orphaned_photos (a failed removal
--          retries next hour instead of losing the path).
--        - `data_export_points` — the user's listing and alert-zone points
--          as lat/lng (PostgREST returns geography as unreadable hex).
-- WHY:   Owner, 2026-10-23: a Profile option to download your data. Until now
--        the only route was emailing support.
-- LINKS: supabase/functions/export-my-data/index.ts (the writer);
--        supabase/functions/_shared/dataExport.ts (what goes in, what doesn't);
--        supabase/functions/release-held-refunds/index.ts (the sweep);
--        supabase/tests/data_exports_verification.sql;
--        docs/RECORD_OF_PROCESSING.md §4.20.
-- =============================================================================

-- 1 — the bucket ---------------------------------------------------------------
-- SAFETY: private, and deliberately NO storage.objects policy for it — RLS is
-- on with no policy, so anon and authenticated can neither list, read nor
-- write it. An export is everything about a person in one file.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('data-exports', 'data-exports', false, 26214400, array['application/json'])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;


-- 2 — the requests (limit + audit) ----------------------------------------------
create table if not exists public.data_export_requests (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  object_path text not null,
  byte_size   integer not null check (byte_size >= 0),
  created_at  timestamptz not null default now(),
  -- Set once the sweep has removed the file (the row stays as the audit).
  deleted_at  timestamptz
);

comment on table public.data_export_requests is
  'One row per data export file (20261023150000): the once-a-day limit and the audit log. No payload or URL. Service role only (RLS on, no client policy).';

create index if not exists data_export_requests_user_recent_idx
  on public.data_export_requests (user_id, created_at desc);

alter table public.data_export_requests enable row level security;
revoke all on public.data_export_requests from public, anon, authenticated;
grant select, insert, update on public.data_export_requests to service_role;


-- 3 — the sweep's claim / forget ------------------------------------------------
create or replace function public.claim_expired_data_exports(p_limit integer default 100)
returns table (id uuid, object_path text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception 'INVALID_INPUT';
  end if;

  -- Recorded files past 24h — plus any OLD file in the bucket no live request
  -- row names (id null): one uploaded as its account was being deleted (the
  -- row cascaded away), or whose rollback failed. Otherwise those would hold a
  -- whole person's data for ever (security review of #270).
  return query
    (select r.id, r.object_path
       from public.data_export_requests r
      where r.deleted_at is null
        and r.created_at < now() - interval '24 hours'
      order by r.created_at
      limit p_limit)
    union all
    (select null::uuid, o.name
       from storage.objects o
      where o.bucket_id = 'data-exports'
        and o.created_at < now() - interval '25 hours'
        and not exists (select 1 from public.data_export_requests r
                         where r.object_path = o.name and r.deleted_at is null)
      order by o.created_at
      limit p_limit);
end $$;

comment on function public.claim_expired_data_exports(integer) is
  'Export files to remove, oldest first: recorded ones past 24h, and stray files past 25h that no live request names (id null). Read-only — the caller removes the objects through the Storage API, then calls forget_data_export with the non-null ids. SERVICE ROLE ONLY.';

-- ⚠️ Separate from the claim on purpose (as forget_orphaned_photos): marking
-- at claim time would lose a file whose removal then failed.
create or replace function public.forget_data_export(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_marked integer;
begin
  if p_ids is null then
    return 0;
  end if;
  update public.data_export_requests
     set deleted_at = now()
   where id = any (p_ids)
     and deleted_at is null;
  get diagnostics v_marked = row_count;
  return v_marked;
end $$;

comment on function public.forget_data_export(uuid[]) is
  'Marks export files removed. Called ONLY after the Storage API confirmed removal. SERVICE ROLE ONLY.';


-- 4 — points as lat/lng ---------------------------------------------------------
create or replace function public.data_export_points(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'posts', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id',  p.id,
               'lat', public.st_y(p.last_seen_location::public.geometry),
               'lng', public.st_x(p.last_seen_location::public.geometry)))
        from public.posts p
       where p.owner_id = p_user_id
         and p.last_seen_location is not null), '[]'::jsonb),
    'alert_zones', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id',  z.id,
               'lat', public.st_y(z.point::public.geometry),
               'lng', public.st_x(z.point::public.geometry)))
        from public.alert_zones z
       where z.user_id = p_user_id
         and z.point is not null), '[]'::jsonb)
  );
$$;

comment on function public.data_export_points(uuid) is
  'The user''s own listing last-seen points and alert-zone centres as lat/lng, for their data export. SERVICE ROLE ONLY.';

revoke execute on function public.claim_expired_data_exports(integer) from public, anon, authenticated;
grant  execute on function public.claim_expired_data_exports(integer) to service_role;
revoke execute on function public.forget_data_export(uuid[]) from public, anon, authenticated;
grant  execute on function public.forget_data_export(uuid[]) to service_role;
revoke execute on function public.data_export_points(uuid) from public, anon, authenticated;
grant  execute on function public.data_export_points(uuid) to service_role;

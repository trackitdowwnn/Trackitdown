-- =============================================================================
-- WHAT:  The data export becomes a PDF + its machine-readable JSON:
--        - the data-exports bucket also takes application/pdf;
--        - claim_expired_data_exports treats an export as a PAIR — the JSON a
--          request row names and the .pdf beside it — so the stray-file scan
--          doesn't mistake a live export's PDF for an orphan. (The sweep
--          removes both files of a recorded export; see release-held-refunds.)
-- WHY:   Owner, 2026-10-23: phones can't open JSON without another app; every
--        phone opens a PDF. The JSON stays, linked from the PDF, for moving
--        data to another service (Art. 20).
--
--        ⚠️ claim_expired_data_exports is 20261023150000's body EXACTLY except
--        the line marked CHANGED 20261023160000 (deployed the same day; prod =
--        repo).
-- LINKS: supabase/migrations/20261023150000_data_exports.sql;
--        supabase/functions/export-my-data/index.ts;
--        supabase/functions/_shared/dataExportPdf.ts;
--        supabase/tests/data_exports_verification.sql (CHECK 3c).
-- =============================================================================

update storage.buckets
   set allowed_mime_types = array['application/json', 'application/pdf']
 where id = 'data-exports';

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
                         where r.deleted_at is null
                           -- CHANGED 20261023160000: the request names the
                           -- JSON; its PDF is the same path ending .pdf.
                           and o.name in (r.object_path,
                                          regexp_replace(r.object_path, '\.json$', '.pdf')))
      order by o.created_at
      limit p_limit);
end $$;

comment on function public.claim_expired_data_exports(integer) is
  'Export files to remove, oldest first: recorded exports past 24h (the caller removes the JSON named AND its .pdf), and stray files past 25h no live request names as its JSON or PDF (id null). Read-only — the caller removes through the Storage API, then calls forget_data_export with the non-null ids. SERVICE ROLE ONLY.';

revoke execute on function public.claim_expired_data_exports(integer) from public, anon, authenticated;
grant  execute on function public.claim_expired_data_exports(integer) to service_role;

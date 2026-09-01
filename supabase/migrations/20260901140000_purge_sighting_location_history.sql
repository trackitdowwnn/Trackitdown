-- =============================================================================
-- WHAT:  public.purge_sighting_location_history() — nulls the capture-time GPS
--        on photos belonging to sightings whose post closed more than 90 days
--        ago. The photo rows and the images themselves are untouched.
-- WHY:   THE PRIVACY POLICY ALREADY PROMISES THIS AND NOTHING PERFORMED IT.
--        legalContent.ts, "How long we keep it": "The detailed location history
--        attached to a closed listing's sightings is deleted after 90 days."
--        SECURITY_AND_TRUST §3 says the same. The sightings table's own header
--        called it "a separate retention job" on 2026-07-14 — and no such job
--        was ever written.
--
--        Today that is internal drift. It stops being internal the moment those
--        documents are published at trackitdown.co.uk, which is imminent
--        (scripts/export-legal.mjs) — at which point an unkept retention
--        promise about LOCATION DATA ON A STOLEN-CAR APP becomes a public
--        commitment. That is the one category where this is worst, and it is
--        why this landed before the pages went live rather than after.
--
-- ⚠️ WHAT "DETAILED LOCATION HISTORY" ACTUALLY IS, precisely, because getting
--        this wrong either leaves the data or destroys a spotter's own record:
--          * `sighting_photos.lat` / `lng` / `accuracy_m` — the capture-time
--            GPS. This is the detailed history. It is the ONLY place the exact
--            point is kept (sightings.sql:169, SECURITY_AND_TRUST §3), so
--            nulling it here removes it everywhere.
--          * NOT `sightings.area_label`. That is deliberately coarse
--            ("Ancoats, Manchester"), it is what the spotter sees on their own
--            `My reports` via my_sighting_record, and purging it would delete
--            a person's record of their own work to satisfy a promise about
--            precision. The policy says "detailed", and this is not that.
--          * NOT the photographs. The policy's deletion section is explicit
--            that sighting photos survive even ACCOUNT deletion, because they
--            are evidence in someone else's case. A located photo becomes an
--            unlocated photo; it does not disappear.
--
-- ⚠️ ANCHORED ON posts.closed_at, NOT ON A LIST OF CLOSED STATUSES. closed_at
--        is trigger-maintained (posts_set_closed_at) and FROZEN once set, so it
--        is the one fact that cannot drift from the enum. Re-listing
--        'recovered', 'cancelled', … here would be a second copy of a
--        vocabulary that has already grown once.
--
-- ⚠️ SCHEDULING IS STILL THE WEAK LINK, AND THIS DOES NOT FIX IT — but not for
--        the reason half the migrations in this repo give. THERE IS A pg_cron:
--        ADR-0011 set one up by hand in the dashboard, and it invokes
--        `release-held-refunds` hourly with a Vault-held secret
--        (20260805120000_cron_secret_reader.sql). The "there is no pg_cron in
--        this project" comments in 20260802100000, 20260802130000,
--        20260802140000 and 20260802160000 were true when written on 2026-08-02
--        and stopped being true three days later; nothing went back for them.
--        This file nearly inherited that claim by copying it.
--
--        What IS true: pg_cron schedules the Edge Function, not these RPCs. So
--        this purge runs only because `release-held-refunds` calls it —
--        best-effort, errors logged and swallowed — exactly like
--        purge_old_notifications. If that sweep stops firing, retention stops
--        silently and nothing says so.
--
--        The stronger option is a pg_cron entry calling this RPC directly, so
--        retention does not depend on the refund sweep's health. That is a
--        dashboard action rather than a migration (the existing job was created
--        the same way), so it is recorded here rather than done here.
--
-- SAFETY NOTE ON DESTRUCTIVE STATEMENTS: this function DELETES PERSONAL DATA BY
--        DESIGN — that is its entire purpose, and the erasure is irreversible.
--        Three bounds keep it from erasing more than promised: it only ever
--        writes the three location columns, it only touches photos whose post
--        has been CLOSED for over 90 days (an active investigation is never in
--        scope), and it is UPDATE, never DELETE, so no row and no image is
--        removed. The migration itself runs no data change at apply time.
--
-- LINKS: src/features/legal/lib/legalContent.ts ("How long we keep it" — the
--          promise this keeps); docs/SECURITY_AND_TRUST.md §3;
--        supabase/migrations/20260714100000_sightings.sql (the columns, and the
--          comment that first called for this job);
--        supabase/migrations/20260722100000_watchlist.sql (posts.closed_at);
--        supabase/functions/release-held-refunds/index.ts (the only caller);
--        supabase/tests/sightings_verification.sql (the assertion).
-- =============================================================================

create or replace function public.purge_sighting_location_history()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_purged integer;
begin
  update public.sighting_photos p
     set lat        = null,
         lng        = null,
         accuracy_m = null
   where (p.lat is not null or p.lng is not null or p.accuracy_m is not null)
     and exists (
       select 1
         from public.sightings s
         join public.posts po on po.id = s.post_id
        where s.id = p.sighting_id
          and po.closed_at is not null
          and po.closed_at < now() - interval '90 days'
     );

  get diagnostics v_purged = row_count;
  return v_purged;
end $$;

comment on function public.purge_sighting_location_history() is
  'Nulls sighting_photos.lat/lng/accuracy_m for photos whose post closed over 90 days ago, keeping the promise in the privacy policy''s "How long we keep it". Leaves the photo row, the image and the coarse area_label alone. NOT scheduled directly: pg_cron runs release-held-refunds hourly and that function calls this. A pg_cron entry pointing here instead would decouple retention from the refund sweep.';

-- Operator-only, like every other purge: this erases personal data, and no
-- client role has any business invoking it.
revoke execute on function public.purge_sighting_location_history()
  from public, anon, authenticated;
grant execute on function public.purge_sighting_location_history() to service_role;


-- =============================================================================
-- END OF MIGRATION
-- =============================================================================

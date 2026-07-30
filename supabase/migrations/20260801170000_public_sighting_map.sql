-- =============================================================================
-- WHAT:  Public sighting map (ADR-0009), one part:
--          get_public_sighting_entries re-issued (CREATE OR REPLACE) so each
--          entry carries snap_lat/snap_lng — the sighting's first located
--          photo ROUNDED SERVER-SIDE to a 0.01° grid (~1.1 km lat) — or null
--          for un-located sightings. The public map draws the trail's SHAPE
--          from these; no raw coordinate ever enters a public payload.
-- WHY:   ADR-0009 (accepted 2026-07-30, revising ADR-0008): the "Sighting
--        activity" section shows the trail on a map for EVERY viewer. The
--        owner's map keeps exact points from their own payload; the public
--        face gets grid-snapped points so the trail's shape and direction
--        read at city zoom while no pin identifies a real capture point or
--        a spotter's position.
-- LINKS: docs/decisions/ADR-0009-public-sighting-map.md;
--        docs/decisions/ADR-0008-public-sighting-entries.md (still governs
--          everything else about this payload);
--        supabase/migrations/20260801130000_sighting_timeline.sql (the body
--          re-issued here); supabase/tests/sightings_verification.sql
--          (CHECK 15's exact key set updated with this migration).
--
-- SAFETY NOTE: not fully additive in POLICY terms — this widens THE public
--   sighting payload (ADR-0009 is the sign-off). Same signature → CREATE OR
--   REPLACE, no drop, grants (incl. the deliberate anon grant) survive.
--   BYTE-FOR-BYTE CLAIM: the body is 20260801130000's with EXACTLY two
--   changes — (a) the lateral join pulling each sighting's first located
--   photo, (b) the two snap_* keys built from round(…, 2). The 5-entry cap,
--   active-only gate, and empty-shape-no-oracle posture are untouched.
-- =============================================================================

create or replace function public.get_public_sighting_entries(p_post_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_status  public.post_status;
  v_total   bigint;
  v_entries jsonb;
begin
  -- SAFETY: missing and non-active are indistinguishable — same shape, no
  -- error, no oracle.
  select p.status into v_status from public.posts p where p.id = p_post_id;
  if not found or v_status <> 'active' then
    return jsonb_build_object('entries', '[]'::jsonb, 'earlier_count', 0);
  end if;

  select count(*) into v_total
  from public.sightings s
  where s.post_id = p_post_id;

  -- Cap of 5 enforced SERVER-side (ADR-0008): the remainder is a count, not a
  -- list. Served by the existing sightings_post_created_idx.
  -- SAFETY (ADR-0009): snap_lat/snap_lng are ROUNDED HERE, inside the
  -- definer, to a 0.01° grid — the raw photo coordinates never leave this
  -- query. Do not "fix" the rounding away; it is the public location fence.
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'sighted_at', t.created_at,
               'locality',   t.locality,
               'snap_lat',   t.snap_lat,
               'snap_lng',   t.snap_lng)
             order by t.created_at desc),
           '[]'::jsonb)
    into v_entries
  from (
    select s.created_at,
           s.locality,
           (round(p.lat::numeric, 2))::double precision as snap_lat,
           (round(p.lng::numeric, 2))::double precision as snap_lng
    from public.sightings s
    left join lateral (
      select sp.lat, sp.lng
      from public.sighting_photos sp
      where sp.sighting_id = s.id and sp.lat is not null
      order by sp.position
      limit 1
    ) p on true
    where s.post_id = p_post_id
    order by s.created_at desc
    limit 5
  ) t;

  return jsonb_build_object(
    'entries',       v_entries,
    'earlier_count', greatest(v_total - 5, 0));
end;
$$;

comment on function public.get_public_sighting_entries(uuid) is
  'THE one public sighting surface (ADR-0008 + ADR-0009): an ACTIVE post''s 5 most recent sightings, newest-first, as { sighted_at, locality, snap_lat, snap_lng } entries plus earlier_count. snap_* are the first located photo ROUNDED to a 0.01° grid inside this definer (~1km — the public location fence; null for un-located sightings); locality nullable -> time-only. ABSENCE BY CONSTRUCTION: never ids, raw coordinates, photos, spotter fields, notes, status, area_label, or accuracy. Missing and non-active posts return the SAME empty shape (no existence oracle). Granted to anon DELIBERATELY — the only sighting function that is.';

-- SAFETY: CREATE OR REPLACE keeps the existing grants (incl. the deliberate
-- anon grant, ADR-0008); posture re-stated per house style.
revoke execute on function public.get_public_sighting_entries(uuid) from public;
grant  execute on function public.get_public_sighting_entries(uuid)
  to anon, authenticated, service_role;


-- =============================================================================
-- END OF MIGRATION
-- =============================================================================

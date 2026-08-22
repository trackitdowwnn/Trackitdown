-- =============================================================================
-- WHAT: get_post_sightings re-issued to return `reviewed_at` — when the owner
--       marked a sighting helpful or not-theirs.
--
-- WHY:  The owner performs this act and then cannot see when they did it. The
--       column is durable (20260814100000) and is ALREADY returned to the
--       SPOTTER by my_sighting_record — so the person who was judged can see
--       the timestamp and the person who judged cannot. The timeline's card
--       shows "✓ Helpful" with no answer to "when did I do that", which matters
--       on a listing with twenty reports being worked through over days.
--
-- SAFETY: This is the owner's OWN action returned to the owner. The function's
--       visibility gate is unchanged and is still the only one — the caller
--       must own the post or it raises NOT_OWNER before a single row is read.
--       No new row is exposed and no new person can call it.
--
--       ⚠️ reviewed_at ONLY. `counted_at` and `review_flags` sit in the same
--       table and stay where they are: 20260814150000 revoked the client's
--       table-wide SELECT and re-granted an explicit column list omitting both,
--       because naming the signal that caught a colluding pair is a tutorial in
--       evading it. `counted:false` is deliberately indistinguishable from a
--       capped-but-honest confirmation, and adding a timestamp beside it would
--       start to pull those apart.
--
--       ⚠️ The verdict is OVERWRITTEN, not appended: mark_sighting_helpful
--       accepts 'not_mine' as a source so an owner may correct a rejection at
--       no cost, and that correction replaces reviewed_at. The timestamp
--       therefore means "when the CURRENT verdict was set", never "when it was
--       first ruled on" — the UI must not imply a history this column cannot
--       support.
--
--       The body below is otherwise byte-identical to 20260801180000's: it was
--       extracted mechanically and patched only to add the one key.
-- LINKS: supabase/migrations/20260801180000_sighting_photo_source.sql (the
--          version this re-issues);
--        supabase/migrations/20260814100000_sighting_verification.sql
--          (reviewed_at's origin);
--        supabase/migrations/20260814150000_review_flags_are_not_the_spotters_to_read.sql
--          (why its neighbours stay hidden);
--        src/features/sightings/components/SightingTimeline.tsx.
-- =============================================================================


create or replace function public.get_post_sightings(p_post_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_viewer uuid := auth.uid();
  v_owner  uuid;
  v_out    jsonb;
begin
  -- SAFETY: backstop; the grant below already excludes anon.
  if v_viewer is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  -- SAFETY: the ONLY visibility gate — the caller must own the post.
  select p.owner_id into v_owner from public.posts p where p.id = p_post_id;
  if not found or v_owner <> v_viewer then
    raise exception 'NOT_OWNER';
  end if;

  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id',                   s.id,
               'created_at',           s.created_at,
               'status',               s.status,
               -- NEW 2026-08-16: when the OWNER ruled on this sighting.
               -- Their own act, returned to them; see the migration header.
               'reviewed_at',          s.reviewed_at,
               'context_flags',        to_jsonb(s.context_flags),
               'note',                 s.note,
               'area_label',           s.area_label,
               'location_unavailable', s.location_unavailable,
               'parked_likelihood',    s.parked_likelihood,
               'direction',            s.direction,
               'people_presence',      s.people_presence,

               -- Confirmed distinctive marks: {id, description} ONLY (never
               -- photo_url — keep the owner payload lean), ordered by the
               -- feature's display position; [] when none confirmed.
               'confirmed_features', coalesce(
                 (select jsonb_agg(
                           jsonb_build_object(
                             'id',          df.id,
                             'description', df.description)
                           order by df.position)
                    from public.post_distinctive_feature df
                   where df.id = any(s.confirmed_feature_ids)
                     and df.post_id = s.post_id),
                 '[]'::jsonb),

               -- Exact capture GPS to the owner (SECURITY_AND_TRUST §1:
               -- sighting locations shown to owners are exact). source (NEW,
               -- ADR-0003) drives the owner-facing "added from photo library"
               -- label on gallery photos; gallery rows are structurally
               -- location-free (lat/lng/accuracy_m always null).
               'photos', coalesce(
                 (select jsonb_agg(
                           jsonb_build_object(
                             'path',        sp.path,
                             'lat',         sp.lat,
                             'lng',         sp.lng,
                             'accuracy_m',  sp.accuracy_m,
                             'captured_at', sp.captured_at,
                             'source',      sp.source)
                           order by sp.position)
                    from public.sighting_photos sp
                   where sp.sighting_id = s.id),
                 '[]'::jsonb),

               -- SAFETY: spotter identity minimised — first name + reputation
               -- counters + month-coarsened member-since. NO spotter_id, NO
               -- display_name/surname, NO email, NO avatar path.
               'spotter', jsonb_build_object(
                 'first_name',          pr.first_name,
                 'sightings_reported',  pr.sightings_reported,
                 'sightings_helpful',   pr.sightings_helpful,
                 'recoveries_credited', pr.recoveries_credited,
                 'member_since',        date_trunc('month', pr.created_at))
             )
             order by s.created_at desc),
           '[]'::jsonb)
    into v_out
  from public.sightings s
  join public.profiles pr on pr.id = s.spotter_id
  where s.post_id = p_post_id;

  return v_out;
end;
$$;

-- Re-stated, as every prior re-issue of this function does. `create or replace`
-- preserves the ACL so anon was never exposed — but leaving the grants implicit
-- makes the next re-issue's author guess, and the comment would otherwise still
-- describe a payload without reviewed_at.
revoke execute on function public.get_post_sightings(uuid) from public, anon;

grant  execute on function public.get_post_sightings(uuid) to authenticated, service_role;

comment on function public.get_post_sightings(uuid) is
  'Returns every sighting on ONE post for its OWNER. SECURITY DEFINER; the owner check inside the body is the ONLY visibility gate (missing and not-owned are the same NOT_OWNER, so the id is no oracle). Spotter block is first_name + reputation counters + month-grained member_since — never spotter_id, never a surname. Adds (2026-08-16) reviewed_at: WHEN THE OWNER SET THE CURRENT VERDICT — their own act, returned to them; it is overwritten by a correction, so it is not a history. review_flags and counted_at remain absent (20260814150000): naming the signal that caught a colluding pair is a tutorial in evading it.';

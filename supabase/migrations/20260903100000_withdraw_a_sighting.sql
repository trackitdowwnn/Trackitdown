-- =============================================================================
-- WHAT:  A spotter can take back a sighting they got wrong. Adds the
--        `withdrawn` status, withdraw_sighting(), and hides withdrawn rows from
--        the owner's list and the public map.
-- WHY:   Review finding #21: sightings were CREATE-ONLY. A spotter who reported
--        the wrong car — a common enough mistake that the app's own Terms say
--        "a sighting that turns out to be the wrong car is not a failure — it
--        is how this works" — had no way to say so. The report stood forever,
--        the owner might act on it, and the one person who knew it was wrong
--        could do nothing at all.
--
-- ⚠️ ONLY WHILE `unverified`, and that is the whole safety rule. Once the owner
--        has ruled — helpful, not_mine, or credited — withdrawing would erase
--        their verdict, and on `credited` it would erase a decision that moved
--        money. The window is exactly "before anyone acted on it".
--
-- ⚠️ A STATUS, NOT A DELETE. Deleting would cascade the photos the owner may
--        already have seen, break the timeline that references the row, and
--        destroy the only record that a report was ever filed — which is a
--        signal in its own right. It also keeps the rate limit honest (below).
--
-- ⚠️ EXCLUDED FROM THE MONEY PATHS BY CONSTRUCTION, not by a new filter.
--        create_refund_hold's uncredited audience and open_dispute's
--        eligibility both gate on `status in ('unverified','helpful')`, so a
--        withdrawn row simply is not in either set — the same property ADR-0018
--        bought back for the listing fee. Nothing there needed changing, and
--        the verification suite pins it so a future widening cannot quietly
--        re-admit it.
--
-- ⚠️ NOT A RATE-LIMIT BYPASS. create_sighting counts rows in the rolling 24h
--        window by created_at ALONE, regardless of status, so withdrawing does
--        NOT free a slot. File-withdraw-file-withdraw buys nothing. That
--        already held; the suite makes it deliberate rather than lucky.
--
-- ⚠️ THE REPUTATION COUNTER GOES DOWN. profiles.sightings_reported is shown to
--        an OWNER as the spotter's standing (the chat passport), so a retracted
--        report must not inflate it — and without the decrement, filing and
--        withdrawing would be a way to farm it. Floored at 0.
--
-- SAFETY NOTE ON DESTRUCTIVE STATEMENTS: one `drop constraint / add constraint`
--        pair on sightings.status, WIDENING it — every existing row still
--        satisfies the new check. Two `create or replace` on read functions,
--        each restated in full from its current definition and patched
--        programmatically rather than retyped; the only difference in either is
--        the `status <> 'withdrawn'` line. No row is deleted or moved.
--
-- LINKS: supabase/migrations/20260816130000_the_owner_can_see_when_they_ruled.sql
--          (get_post_sightings — the body below is patched from it);
--        supabase/migrations/20260801170000_public_sighting_map.sql
--          (get_public_sighting_entries, likewise);
--        supabase/migrations/20260805100000_refund_holds_and_disputes.sql
--          (the two money gates this relies on);
--        supabase/tests/withdraw_sighting_verification.sql.
-- =============================================================================


-- =============================================================================
-- 1. The status vocabulary widens
-- =============================================================================
alter table public.sightings drop constraint sightings_status_chk;
alter table public.sightings add constraint sightings_status_chk
  check (status in ('unverified', 'helpful', 'not_mine', 'credited', 'withdrawn'));

comment on column public.sightings.status is
  'unverified (filed, nobody has ruled) | helpful | not_mine | credited (the owner''s verdict) | withdrawn (the SPOTTER took it back, 2026-09-03). Only unverified may be withdrawn — after a verdict, withdrawing would erase the owner''s decision, and on credited one that moved money. Withdrawn rows are excluded from get_post_sightings and get_public_sighting_entries, and fall outside the money paths by construction (both gate on unverified|helpful).';


-- =============================================================================
-- 2. withdraw_sighting — the spotter's own retraction
-- =============================================================================
create or replace function public.withdraw_sighting(p_sighting_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller  uuid := auth.uid();
  v_spotter uuid;
begin
  if v_caller is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  -- One conditional update carries the whole rule: yours, and still unruled.
  -- Doing it in the UPDATE rather than SELECT-then-UPDATE closes the race where
  -- the owner rules on the sighting between the two.
  update public.sightings s
     set status = 'withdrawn'
   where s.id = p_sighting_id
     and s.spotter_id = v_caller
     and s.status = 'unverified'
  returning s.spotter_id into v_spotter;

  -- ONE opaque token for "no such sighting", "not yours" and "already ruled
  -- on". A distinct message per case would let anyone probe for sighting ids,
  -- and would leak whether a stranger's report had been credited — the house
  -- rule, and the same one open_dispute follows.
  if v_spotter is null then
    raise exception 'SIGHTING_NOT_WITHDRAWABLE';
  end if;

  -- The spotter's standing is shown to owners; a retracted report must not
  -- count towards it. greatest(0, ...) because a counter that can go negative
  -- is worse than one that is slightly generous.
  update public.profiles p
     set sightings_reported = greatest(0, p.sightings_reported - 1)
   where p.id = v_spotter;

  return jsonb_build_object('sighting_id', p_sighting_id, 'withdrawn', true);
end $$;

comment on function public.withdraw_sighting(uuid) is
  'The spotter takes back their own sighting. SECURITY DEFINER, scoped to auth.uid(), and permitted ONLY while status = ''unverified'' — after the owner has ruled, withdrawing would erase their verdict (and on credited, one that moved money). Sets status=''withdrawn'' in ONE conditional update so an owner ruling concurrently cannot be overwritten, and decrements profiles.sightings_reported (floored at 0) because that counter is the spotter''s standing as an owner sees it. Raises NOT_AUTHENTICATED, or SIGHTING_NOT_WITHDRAWABLE for missing / not-yours / already-ruled alike — one token, no existence oracle. Does NOT free a create_sighting rate-limit slot: that count is by created_at regardless of status.';

revoke execute on function public.withdraw_sighting(uuid) from public, anon;
grant execute on function public.withdraw_sighting(uuid) to authenticated;


-- =============================================================================
-- 3. get_post_sightings — the owner stops seeing it
-- =============================================================================
-- ⚠️ Restated from 20260816130000 and patched programmatically; the ONLY
-- difference is the status exclusion. Diff against that file.
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
  where s.post_id = p_post_id
    -- ⚠️ A WITHDRAWN sighting is gone from every surface but the spotter's
    -- own record. Withdrawing means "I got this wrong, do not act on it" —
    -- leaving it visible to the owner (or on the public map) would keep the
    -- exact claim the spotter retracted in front of the person it misleads.
    and s.status <> 'withdrawn';

  return v_out;
end;
$$;


-- =============================================================================
-- 4. get_public_sighting_entries — and so does the public map
-- =============================================================================
-- Restated from 20260801170000, same treatment, same single difference.
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
  where s.post_id = p_post_id
    -- ⚠️ A WITHDRAWN sighting is gone from every surface but the spotter's
    -- own record. Withdrawing means "I got this wrong, do not act on it" —
    -- leaving it visible to the owner (or on the public map) would keep the
    -- exact claim the spotter retracted in front of the person it misleads.
    and s.status <> 'withdrawn';

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
      and s.status <> 'withdrawn'
    order by s.created_at desc
    limit 5
  ) t;

  return jsonb_build_object(
    'entries',       v_entries,
    'earlier_count', greatest(v_total - 5, 0));
end;
$$;


-- =============================================================================
-- END OF MIGRATION
-- =============================================================================

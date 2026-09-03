-- =============================================================================
-- WHAT:  my_sighting_record gains `post_id` — but only while the post is still
--        active. One line of behaviour; the rest of this file is why.
-- WHY:   Review finding #16: "My reports" is a dead end. The cards render a
--        verdict and nothing is pressable, so a spotter learns what was decided
--        and has nowhere to go with it. The dispute door (2026-09-01) closed
--        the one case where they must ACT; this closes the ordinary case where
--        they simply want to look at the car again.
--
-- ⚠️ THE `active` GATE IS THE WHOLE DESIGN, AND IT IS NOT A COMPROMISE.
--        This RPC's own comment has said since it was written: "no owner, no
--        location, no plate, no post id: a spotter's history is not a back door
--        into listings they were never shown." That rule is why the
--        `closed_uncredited` push routes to the dispute screen rather than to
--        the post — once a listing closes, the spotter cannot see it.
--
--        An ACTIVE post is different in kind, not in degree: it is PUBLIC.
--        get_post_detail serves it to anon, it is on the map, it is in search.
--        Handing a spotter the id of a car they personally photographed and
--        reported, while that car is still publicly listed, gives away nothing
--        they could not reach by typing the make into search.
--
--        A CLOSED post yields NULL, and the wall stands exactly where it stood.
--        The owner's outcome, the recovery, who was credited — none of it
--        becomes reachable. `case when p.status = 'active'` is the entire
--        difference between closing a dead end and opening a back door.
--
-- ⚠️ NOTHING ELSE ABOUT THE PAYLOAD WIDENS. No owner identity, no location, no
--        plate, no bounty, no status of the post itself — only whether there is
--        an id to open. A client that gets NULL renders exactly what it renders
--        today, which is why an older bundle is unaffected.
--
-- SAFETY NOTE ON DESTRUCTIVE STATEMENTS: none. One `create or replace` on a
--        STABLE read function, restated in full from 20260901120000 and patched
--        programmatically rather than retyped — the only difference is the
--        `post_id` select-list entry. Same signature, so no drop, and the
--        grants are untouched. No table, row or policy is changed.
--
-- LINKS: supabase/migrations/20260901120000_my_sighting_record_dispute.sql
--          (the body this is patched from — diff against it);
--        supabase/migrations/20260814110000_sighting_verification_rpcs.sql
--          (my_sighting_record's original PRIVACY note);
--        src/features/sightings/screens/MySightingsScreen.tsx;
--        supabase/tests/my_reports_post_id_verification.sql.
-- =============================================================================


create or replace function public.my_sighting_record()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_caller uuid := auth.uid();
  v_rows   jsonb;
begin
  if v_caller is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select coalesce(jsonb_agg(r order by r.created_at desc), '[]'::jsonb)
    into v_rows
  from (
    select s.id,
           -- ⚠️ THE POST ID, AND ONLY WHILE THE POST IS ACTIVE (2026-09-03,
           -- review finding #16). My reports showed a verdict and offered
           -- nowhere to go; this is what makes the card openable.
           --
           -- The NULL branch is the privacy rule, unchanged: a closed post is
           -- invisible to a spotter, which is why closed_uncredited routes to
           -- the dispute screen rather than the post. Emitting the id only for
           -- an ACTIVE post gives away nothing — an active post is public and
           -- anon-readable, so the spotter could already reach it by searching.
           -- The wall stays exactly where it was for every closed listing.
           case when p.status = 'active' then s.post_id end as post_id,
           s.created_at,
           s.status,
           s.reviewed_at,
           s.area_label,
           -- Bounded at the source. This RPC hands owner-supplied text to a
           -- DIFFERENT user (the spotter); unbounded, one owner's 4 KB "make"
           -- bloats every row of that spotter's history.
           jsonb_build_object(
             'make',   left(coalesce(nullif(btrim(p.make),   ''), ''), 32),
             'colour', left(coalesce(nullif(btrim(p.colour), ''), ''), 32)
           ) as car,
           -- The door. `available` is exactly my_dispute_context's gate: a hold
           -- on this post that NAMES this sighting. h.post_id is null whenever
           -- no such hold exists, which is the ordinary case for almost every
           -- report ever filed.
           jsonb_build_object(
             'available',       h.post_id is not null,
             'status',          d.status,
             'window_ends_at',  h.expires_at
           ) as dispute
      from public.sightings s
      join public.posts p on p.id = s.post_id
      -- ⚠️ THE `s.id = any (h.sighting_ids)` PREDICATE IS LOAD-BEARING. A hold
      -- covers a post and names the sightings it was raised over; a spotter
      -- whose sighting is not in that array cannot dispute, and
      -- my_dispute_context refuses them. Joining on post_id alone would light
      -- the door for reports that cannot open it.
      left join public.refund_holds h
             on h.post_id = s.post_id
            and s.id = any (h.sighting_ids)
      -- Their OWN dispute. The spotter predicate is REDUNDANT today and kept
      -- deliberately: `where s.spotter_id = v_caller` below already restricts
      -- this to the caller's sightings, and refund_disputes.sighting_id is
      -- UNIQUE, so there is no second dispute to reach. It is here so that
      -- loosening either of those — a shared-sighting model, a re-file after
      -- rejection — cannot silently turn this join into another user's row.
      left join public.refund_disputes d
             on d.sighting_id = s.id
            and d.spotter_id = v_caller
     where s.spotter_id = v_caller
  ) as r;

  return jsonb_build_object('sightings', v_rows);
end;
$$;

comment on function public.my_sighting_record() is
  'The spotter''s own sighting record, newest first. Car make/colour only — no owner, no location, no plate. Carries `post_id` ONLY while that post is still ACTIVE (2026-09-03): an active post is public and anon-readable, so handing a spotter the id of a car they themselves reported reveals nothing search would not; a CLOSED post yields NULL and stays unreachable, which is the rule that makes closed_uncredited route to the dispute screen rather than the post. Each row also carries its own dispute standing (available/status/window_ends_at), mirroring my_dispute_context''s gate so My reports can show the in-app door that used to exist only as a push.';


-- =============================================================================
-- END OF MIGRATION
-- =============================================================================

-- =============================================================================
-- WHAT:  Adds a `dispute` object to each row of my_sighting_record(): whether
--        /sighting-dispute will open for that sighting, the spotter's own
--        filing if they have made one, and when the window closes.
-- WHY:   ROADMAP's last open item on the critical path. `/sighting-dispute`
--        had no in-app door — it was reachable ONLY from the `closed_uncredited`
--        push, so a spotter who declined notifications could never contest a
--        denial. `My reports` is the one screen that lists a spotter's own
--        sightings, and it could not show the door because it had no way to
--        know which reports had one.
--
--        ⚠️ THE GATE IS COPIED FROM my_dispute_context, NOT REINVENTED. That
--        function is the authority — the screen re-reads it on arrival and
--        refuses with DISPUTE_NOT_AVAILABLE — and its condition is: the caller
--        owns the sighting, a refund_holds row exists for its post, AND the
--        sighting is named in that hold's `sighting_ids`. All three are
--        reproduced below. If that gate ever changes, this must change with it,
--        or `My reports` will offer a door that the next screen slams.
--
-- SAFETY: THIS DOES NOT WIDEN WHAT A SPOTTER LEARNS ABOUT SOMEBODY ELSE'S POST.
--        The existing payload deliberately carries no owner, no location, no
--        plate and no post id, so a spotter's history cannot become a back door
--        into listings they were never shown (see the RPC's own comment and
--        sightingApi.ts's PRIVACY note). Nothing added here comes from the post:
--        `available` is a boolean about a hold, `status` is the spotter's OWN
--        dispute row, and `window_ends_at` is the deadline they were already
--        told in the push. The hold's existence is not news to this spotter —
--        being told it ONLY by a push was the bug.
--
--        The `d.spotter_id = v_caller` predicate on the refund_disputes join is
--        redundant today — see the note at the join for why it is kept anyway.
--
-- SAFETY NOTE ON DESTRUCTIVE STATEMENTS: none. One `create or replace function`
--        on a function this migration also re-grants exactly as it was. No
--        table, no policy, no data is touched.
--
-- ⚠️ CLIENT FIRST. src/features/sightings/api/sightingApi.ts parses this
--        payload with a `.strict()` zod schema, on purpose, so that a widened
--        server fails loudly rather than reaching an unreviewed screen. That
--        means a bundle WITHOUT the optional `dispute` field breaks `My
--        reports` the moment this migration lands. The client change declaring
--        the field optional shipped first (2026-09-01, OTA) precisely so this
--        ordering is safe in one direction only. Do not reorder them.
--
-- LINKS: 20260805100000_refund_holds_and_disputes.sql (my_dispute_context —
--          the gate this mirrors, and the authority);
--        20260815100000_bound_owner_text_on_applied_migrations.sql (the
--          function being replaced);
--        src/features/sightings/components/ReportCard.tsx (the door);
--        docs/ROADMAP.md; docs/DOMAIN.md (Disputes).
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
  'The spotter''s own sighting record, newest first. Car make/colour only — no owner, no location, no plate, no post id: a spotter''s history is not a back door into listings they were never shown. Each row also carries its own dispute standing (available/status/window_ends_at), mirroring my_dispute_context''s gate so My reports can show the in-app door that used to exist only as a push.';

-- Unchanged from the original; restated so the grant reads as a decision rather
-- than something a `create or replace` happened to preserve.
revoke execute on function public.my_sighting_record() from public, anon;
grant execute on function public.my_sighting_record() to authenticated, service_role;


-- =============================================================================
-- END OF MIGRATION
-- =============================================================================

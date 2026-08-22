-- =============================================================================
-- WHAT: get_post_detail re-issued to return three timestamps it already had in
--       the row and never handed over: recovered_at, closed_at, alerts_sent_at.
--       OWNER-ONLY, merged into the existing owner block so the KEYS are absent
--       from every other payload.
--
-- WHY:  The listing's timeline could say "Recovered 🎉" and not say WHEN. The
--       column has existed since the recovery flow shipped; the terminal node
--       simply had no timestamp field to render, so the moment the whole
--       product exists for was undated on the one surface that narrates it.
--       `closed_at` does the same job for the other three endings, and
--       `alerts_sent_at` gives the arc its missing early beat — the point at
--       which we actually told people to look.
--
-- SAFETY: OWNER-ONLY, and the merge idiom is the one 20260802110000 already
--       established for last_seen_locality — a whole-object merge, so a
--       non-owner's payload does not even carry the key. That is belt and
--       braces rather than strictly necessary: a non-owner can only ever see an
--       ACTIVE post (the v_visible gate above), and an active post has no
--       ending, so recovered_at/closed_at are null on every payload a stranger
--       could receive. Being absent is still better than being null.
--
--       ⚠️ alerts_sent_at IS A TIMESTAMP AND NOTHING ELSE. get_post_stats
--       carries an explicit prohibition on a TIME SERIES over spotters_alerted,
--       because a timestamped reach series reintroduces exactly the delta
--       oracle the watcher count was dropped for. This adds no count, no
--       series, and no second sample: one scalar, to the owner of the post,
--       about their own fan-out. It says WHEN we told people, never HOW MANY —
--       the floored `spotters_alerted` on the stats screen remains the only
--       answer to that, and it is unchanged.
--
--       The function body below is otherwise byte-identical to
--       20260802110000's: it was extracted from that file mechanically and
--       patched only inside the owner block, so the visibility gate, the
--       driveway coarsening, and every SAFETY note are the originals.
-- LINKS: supabase/migrations/20260802110000_post_alert_columns.sql (the version
--          this re-issues, and the owner-merge idiom);
--        src/features/sightings/lib/timelineEvents.ts (what renders them);
--        src/shared/ui/Timeline.tsx.
-- =============================================================================




create or replace function public.get_post_detail(p_post_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_viewer  uuid := auth.uid();
  v_post    public.posts%rowtype;
  v_visible boolean;
  -- Owner block — first_name + member-since ONLY. Never avatar_path (embeds
  -- owner_id), never display_name (surname), never owner_id.
  v_owner_first text;
  v_owner_since timestamptz;
  -- SAFETY: true when the last-seen point must be blurred for this caller —
  -- i.e. a driveway theft (point == victim's HOME) viewed by a non-owner.
  v_coarsen boolean;
begin
  select * into v_post from public.posts p where p.id = p_post_id;
  if not found then
    return jsonb_build_object('found', false);
  end if;

  -- SAFETY: the ONLY visibility gate (RLS is bypassed here).
  v_visible := (v_post.status = 'active')
               or (v_viewer is not null and v_post.owner_id = v_viewer);

  if not v_visible then
    return jsonb_build_object(
      'found', true,
      'visible', false,
      'closedReason',
        case
          when v_post.status in ('recovered', 'recovered_no_spotter')
            then 'recovered'
          else 'unavailable'
        end
    );
  end if;

  select p.first_name, p.created_at
    into v_owner_first, v_owner_since
    from public.profiles p
   where p.id = v_post.owner_id;

  -- SAFETY — home-address coarsening: stolen_from='driveway' means the last-seen
  -- point is the victim's HOME, so it must not be pinpointed to non-owners. The
  -- OWNER always gets the exact point; a non-owner gets the exact point for
  -- non-driveway thefts and a ~1km grid-snapped point for driveway thefts. Snap
  -- reuses the recovered-post idiom ST_SnapToGrid(location::geometry, 0.01).
  v_coarsen := (v_post.stolen_from = 'driveway')
               and not coalesce(v_post.owner_id = v_viewer, false);

  return public.home_feed_post_json(v_post, null::numeric)
    || jsonb_build_object(
         'found',    true,
         'visible',  true,
         'is_owner', coalesce(v_post.owner_id = v_viewer, false),

         'year',                    v_post.year,
         'body_type',               v_post.body_type,
         'distinguishing_features', v_post.distinguishing_features,
         'owner_note',              v_post.owner_note,
         'expires_at',              v_post.expires_at,

         -- Part-2 structured fields (visible branch only).
         'stolen_from',    v_post.stolen_from,
         'keys_taken',     v_post.keys_taken,
         'desc_recognise', v_post.desc_recognise,
         'desc_drives',    v_post.desc_drives,

         -- Feature chips: [{key,label,icon}], ordered by the taxonomy sort_order.
         -- [] when the post has no tags.
         'features', coalesce(
           (select jsonb_agg(
                     jsonb_build_object('key', vf.key, 'label', vf.label, 'icon', vf.icon)
                     order by vf.sort_order)
              from public.post_feature pf
              join public.vehicle_feature vf on vf.key = pf.feature_key
             where pf.post_id = v_post.id),
           '[]'::jsonb),

         -- SAFETY: exact coords for the owner and for non-driveway thefts; a
         -- ~1km grid-snapped point for a driveway theft shown to a non-owner (so
         -- the victim's home is never pinpointed). ST_Y = latitude, ST_X = lng.
         'lat', case
                  when v_post.last_seen_location is null then null
                  when v_coarsen
                    then ST_Y(ST_SnapToGrid(v_post.last_seen_location::geometry, 0.01))
                  else ST_Y(v_post.last_seen_location::geometry)
                end,
         'lng', case
                  when v_post.last_seen_location is null then null
                  when v_coarsen
                    then ST_X(ST_SnapToGrid(v_post.last_seen_location::geometry, 0.01))
                  else ST_X(v_post.last_seen_location::geometry)
                end,

         'photos', coalesce(
           (select jsonb_agg(
                     jsonb_build_object('url', ph.url, 'position', ph.position)
                     order by ph.position)
              from public.post_photos ph
             where ph.post_id = v_post.id),
           '[]'::jsonb),

         -- Distinctive features: [{id, photo_url, description}], the
         -- owner-authored photo+description evidence marks, ordered by position;
         -- [] when none.
         -- SAFETY (visibility — mirrors 'photos' / post_photos exactly): this is
         -- built INSIDE the visible branch, reached only after the active-OR-owner
         -- v_visible gate above — the SAME predicate gating 'photos' and the SAME
         -- one enforced by post_distinctive_feature's RLS SELECT policies
         -- (select_active_public + select_own). Owner sees their marks in any
         -- status; the public sees them only on an active post; never in the
         -- hidden/closed stub. These are CAR photos, so they are NOT coarsened
         -- (coarsening applies only to the driveway last_seen point). 'id' (NEW,
         -- 20260801150000) is the opaque row uuid the report-sighting wizard
         -- submits back as confirmed_feature_ids — same visibility as the
         -- feature itself, no extra data.
         'distinctive_features', coalesce(
           (select jsonb_agg(
                     jsonb_build_object(
                       'id',          df.id,
                       'photo_url',   df.photo_url,
                       'description', df.description)
                     order by df.position)
              from public.post_distinctive_feature df
             where df.post_id = v_post.id),
           '[]'::jsonb),

         -- SAFETY: first_name to signed-in only; member_since coarsened to the
         -- month, to all. NO owner_id-bearing avatar path, NO display_name.
         'owner', jsonb_build_object(
           'member_since', date_trunc('month', v_owner_since),
           'first_name',   case when v_viewer is not null then v_owner_first end
         ),

         -- REAL sighting aggregate (was the dormant {0, null} placeholder).
         -- SAFETY: a SCALAR count + latest timestamp only — never rows, never
         -- locations, never spotter identity (those are owner-only via
         -- get_post_sightings). count(*) over zero rows is 0 and max() is null,
         -- so pre-sighting posts keep the exact previous shape.
         'sighting_stats', (
           select jsonb_build_object(
                    'count',     count(*),
                    'latest_at', max(sg.created_at))
           from public.sightings sg
           where sg.post_id = v_post.id),

         -- Whether the CALLER already has a sighting on this post — gates the
         -- post-detail "Message the owner" affordance (chat is sighting-gated;
         -- DOMAIN.md Chat: "No cold DMs"). true -> the client may open a thread;
         -- false -> route the viewer to report a sighting first.
         -- SAFETY (SECURITY_AND_TRUST §1/§6): scoped to spotter_id = v_viewer, so
         -- it reveals ONLY the caller's OWN state (which they already know) — no
         -- other user's data, no count of others. Distinct from sighting_stats.
         -- anon (v_viewer null) -> false; the post's owner -> always false
         -- (own-post sightings are blocked by create_sighting's OWN_POST gate).
         'viewer_has_sighting', (v_viewer is not null and exists (
           select 1 from public.sightings s
           where s.post_id = v_post.id and s.spotter_id = v_viewer))
       )
    -- SAFETY (20260802110000) — OWNER-ONLY, ABSENT FOR EVERYONE ELSE: the coarse
    -- locality exists so the owner's own draft-edit round-trip doesn't blank it.
    -- Merged as a whole object so a non-owner's payload does not even carry the
    -- KEY. Never widen this to the public branch; nothing public needs it and
    -- the spotter-alert matcher reads the column server-side.
    || case
         when coalesce(v_post.owner_id = v_viewer, false)
           then jsonb_build_object(
             'last_seen_locality', v_post.last_seen_locality,
             -- NEW 2026-08-16 — see this migration's header.
             'recovered_at',       v_post.recovered_at,
             'closed_at',          v_post.closed_at,
             'alerts_sent_at',     v_post.alerts_sent_at)
         else '{}'::jsonb
       end;
end;
$$;

comment on function public.get_post_detail(uuid) is
  'Returns one post''s detail for the post-detail screen. SECURITY DEFINER; the active-OR-owner predicate is the ONLY visibility gate. Adds (2026-08-16) recovered_at / closed_at / alerts_sent_at to the OWNER-ONLY merge block so the listing timeline can date its ending and its alert fan-out; these keys are ABSENT from every non-owner payload. alerts_sent_at is one scalar and never a count or a series — get_post_stats'' prohibition on a timestamped reach series stands.';

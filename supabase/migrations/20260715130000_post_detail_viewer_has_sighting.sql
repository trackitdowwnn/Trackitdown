-- =============================================================================
-- WHAT:  CREATE OR REPLACE public.get_post_detail(uuid) to add ONE field to its
--        VISIBLE branch: 'viewer_has_sighting' — a boolean telling the caller
--        whether THEY THEMSELVES already have a sighting on this post. The rest
--        of the function (visibility gate, hidden/not-found stubs, driveway
--        coarsening, owner block, Part-2 fields, features[], photos[], and the
--        scalar sighting_stats aggregate) is reproduced BYTE-FOR-BYTE from the
--        live 20260714100000 definition — nothing else changes.
-- WHY:   The post-detail page needs a "Message the owner" entry, but chat is
--        SIGHTING-GATED: a thread opens only after the spotter has reported a
--        sighting on the post — "No cold DMs" (DOMAIN.md Chat). The client can
--        only decide whether to show the affordance if it knows whether the
--        current viewer already qualifies. true  -> the client may open a thread
--        (open_thread will succeed); false -> the client routes the viewer to
--        report a sighting first.
-- LINKS: docs/DOMAIN.md Chat ("a thread opens ... only after that spotter has
--          reported a sighting ... No cold DMs"),
--        docs/SECURITY_AND_TRUST.md §1/§6 (spotter privacy; public sees no
--          sightings — see SAFETY below on why this leaks nothing),
--        supabase/migrations/20260714100000_sightings.sql §7 (the CURRENT
--          get_post_detail this CREATE-OR-REPLACEs, reproduced here verbatim
--          plus the one new field; also defines create_sighting whose OWN_POST
--          gate makes viewer_has_sighting always false for the post's owner).
--
-- SAFETY NOTE ON DESTRUCTIVE STATEMENTS: NOTHING dropped or renamed. This is a
--        forward CREATE OR REPLACE of public.get_post_detail(uuid) — SAME name,
--        SAME signature, SAME return type — adding ONE additive key to the
--        visible-branch jsonb and updating the function comment. Grants are
--        re-asserted (revoke from public; grant to anon, authenticated,
--        service_role) so this migration is correct standalone. No table, RLS,
--        or grant posture elsewhere is touched.
--
-- SAFETY (privacy — why the new field leaks nothing, SECURITY_AND_TRUST §1/§6):
--        'viewer_has_sighting' reports ONLY whether the CALLER has their own
--        sighting on this post (spotter_id = v_viewer). The caller already knows
--        their own sightings, so this exposes no other user's data and no count
--        of others' sightings — it is DISTINCT from the public scalar
--        sighting_stats aggregate (which is everyone's count + latest_at).
--          * anon (v_viewer is null) -> false (the exists() short-circuits).
--          * the post's OWNER -> always false: create_sighting's OWN_POST gate
--            blocks own-post sightings, so no such row can exist. That is fine —
--            the client hides the "Message the owner" entry for owners anyway.
--        It appears in the VISIBLE branch ONLY; the hidden/not-found stubs are
--        unchanged.
-- =============================================================================


-- =============================================================================
-- RPC: get_post_detail(post_id) -> jsonb   (CREATE OR REPLACE)
-- =============================================================================
-- Byte-for-byte the 20260714100000 §7 function EXCEPT for the single additive
-- 'viewer_has_sighting' key in the visible branch (documented at that key
-- below). Everything else — visibility gate, hidden stub, driveway coarsening,
-- owner block, features, photos, sighting_stats — is unchanged.
--
-- SAFETY: sighting_stats stays a SCALAR count + latest timestamp ONLY, on posts
-- the caller may already see (active or own). It MUST NEVER be widened to
-- individual sighting rows/locations here — the owner's row-level read is
-- get_post_sightings (SECURITY_AND_TRUST §6: public sees no sightings).
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
       );
end;
$$;

comment on function public.get_post_detail(uuid) is
  'Returns one post''s detail for the post-detail screen. SECURITY DEFINER (bypasses RLS); the active-OR-owner predicate is the ONLY visibility gate. Non-visible -> minimal { found, visible:false, closedReason } stub. Visible -> full detail incl. Part-2 structured fields, features[], ordered photos, is_owner (never owner_id), owner block (first_name/month member_since), a LIVE scalar sighting_stats { count, latest_at } aggregated from public.sightings (scalar only — sighting rows/locations are owner-only via get_post_sightings), and viewer_has_sighting (whether the CALLER themselves already reported a sighting on this post — gates the sighting-gated "Message the owner" affordance; caller-only, leaks no other user''s data; false for anon and for the post''s owner). SAFETY: a driveway theft''s last-seen point is coarsened to a ~1km grid for non-owners.';

-- Same grants as before (anon may browse active posts' detail; both the
-- aggregate and viewer_has_sighting are scalar/caller-only). Re-asserted so this
-- migration is correct standalone.
revoke execute on function public.get_post_detail(uuid) from public;
grant  execute on function public.get_post_detail(uuid)
  to anon, authenticated, service_role;


-- =============================================================================
-- END OF MIGRATION
-- =============================================================================

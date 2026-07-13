-- =============================================================================
-- SECURITY FIX: stop the owner block leaking owner_id (and thus the victim's
-- surname) via the avatar path.
--
-- BUG (in 20260713160000): the owner block returned avatar_path to signed-in
-- viewers. avatar_path is CHECK-pinned to '<profile id>/avatar.jpg' (see
-- 20260710120000), so its first segment IS owner_id. A signed-in viewer could
-- read owner_id off the avatar path/URL, then — because profiles has a
-- permissive `profiles_select_authenticated USING (true)` policy —
-- `select display_name from profiles where id = <owner_id>` recovers the
-- theft victim's full name and correlates all their posts. That defeats the
-- anti-stalking guarantee this block was built to respect.
--
-- FIX: do NOT expose any owner_id-bearing value. The owner block now returns
--   * first_name  — signed-in viewers only (unchanged gating), and
--   * member_since — to all, TRUNCATED to the month (matches the UI's coarse
--     "Member since July 2026" and removes the exact registration instant).
-- No avatar_path / avatar_updated_at. The detail screen shows an initial-letter
-- avatar (no photo). Restoring the real photo safely needs the profiles read
-- path hardened first (a first-name-only public accessor + a non-uid avatar
-- URL) — tracked separately, NOT in this pass.
--
-- Everything else (visibility gate, hidden stub, is_owner, coords-only-visible,
-- expires_at, dormant sighting_stats) is unchanged from 20260713160000.
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

         'lat', case when v_post.last_seen_location is not null
                     then ST_Y(v_post.last_seen_location::geometry) end,
         'lng', case when v_post.last_seen_location is not null
                     then ST_X(v_post.last_seen_location::geometry) end,

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

         'sighting_stats', jsonb_build_object('count', 0, 'latest_at', null)
       );
end;
$$;

revoke execute on function public.get_post_detail(uuid) from public;
grant  execute on function public.get_post_detail(uuid)
  to anon, authenticated, service_role;

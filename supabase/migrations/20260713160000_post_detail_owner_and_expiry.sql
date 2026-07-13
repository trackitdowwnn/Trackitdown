-- =============================================================================
-- Widen get_post_detail: add expires_at + an owner-identity block.
--
-- WHY: the post-detail screen gains a trust block ("Active until <expiry>") and
-- an Airbnb-style owner block. Both need data the RPC didn't return.
--
-- expires_at: already on posts; just surface it (visible branch only).
--
-- Owner block — SAFETY (docs/DOMAIN.md "Owner identity on a post"):
--   * The owner is a THEFT VICTIM, so their name + avatar are shown to
--     SIGNED-IN viewers ONLY; an anonymous viewer gets a de-identified block
--     (member-since only). Gated on v_viewer (auth.uid()).
--   * Only first_name, avatar_path, and the account's created_at (member-since)
--     are exposed — NEVER display_name (surname risk), NEVER owner_id, and no
--     contact path (chat requires a sighting per DOMAIN). Mirrors the
--     fetchPublicProfile allow-list, enforced here in SQL.
--   * SECURITY DEFINER bypasses RLS, so this function can read the owner's
--     profile row regardless of caller — which is exactly why it must hand-pick
--     the safe columns.
--
-- Forward-only CREATE OR REPLACE; the visibility gate, hidden stub, is_owner
-- coalesce, coords-only-when-visible, and dormant sighting_stats are unchanged.
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
  -- Owner block (safe columns only — never display_name / owner_id).
  v_owner_first          text;
  v_owner_avatar         text;
  v_owner_avatar_updated timestamptz;
  v_owner_since          timestamptz;
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

  -- Owner identity — SAFETY: hand-pick the safe columns; never display_name.
  select p.first_name, p.avatar_path, p.updated_at, p.created_at
    into v_owner_first, v_owner_avatar, v_owner_avatar_updated, v_owner_since
    from public.profiles p
   where p.id = v_post.owner_id;

  return public.home_feed_post_json(v_post, null::numeric)
    || jsonb_build_object(
         'found',    true,
         'visible',  true,
         -- SAFETY: expose is_owner, NEVER owner_id. coalesce so anon -> false.
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

         -- SAFETY: name + avatar to signed-in viewers ONLY; member_since (coarse
         -- account age) to all. Never display_name / owner_id.
         'owner', jsonb_build_object(
           'member_since',      v_owner_since,
           'first_name',        case when v_viewer is not null then v_owner_first end,
           'avatar_path',       case when v_viewer is not null then v_owner_avatar end,
           'avatar_updated_at', case when v_viewer is not null then v_owner_avatar_updated end
         ),

         -- DORMANT AGGREGATE (unchanged). SAFETY: scalar count only.
         'sighting_stats', jsonb_build_object('count', 0, 'latest_at', null)
       );
end;
$$;

revoke execute on function public.get_post_detail(uuid) from public;
grant  execute on function public.get_post_detail(uuid)
  to anon, authenticated, service_role;

-- =============================================================================
-- Fix get_post_detail.is_owner for anonymous callers.
--
-- BUG (in 20260713140000): is_owner was computed as
--     (owner_id is not null and owner_id = v_viewer)
-- For an anon caller v_viewer is NULL, so `owner_id = NULL` is SQL NULL and the
-- whole expression is `true and NULL` = NULL. The payload then carried
-- "is_owner": null, and the client zod (z.boolean()) rejected it
-- ("expected boolean, received null"), 500-ing the post-detail screen for every
-- logged-out viewer.
--
-- FIX: coalesce(owner_id = v_viewer, false) — NULL (anon, or no match) -> false;
-- a real match -> true. Forward-only CREATE OR REPLACE (the original migration
-- is already applied); the function body is otherwise identical to 20260713140000.
--
-- SAFETY unchanged: the active-OR-owner visibility gate, the leak-free hidden
-- stub, owner_id never exposed, coords only when visible, and the dormant scalar
-- sighting_stats are all preserved verbatim.
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

  return public.home_feed_post_json(v_post, null::numeric)
    || jsonb_build_object(
         'found',    true,
         'visible',  true,
         -- SAFETY: expose is_owner, NEVER owner_id itself. coalesce so an anon
         -- caller (v_viewer null) gets false, not null.
         'is_owner', coalesce(v_post.owner_id = v_viewer, false),

         'year',                    v_post.year,
         'body_type',               v_post.body_type,
         'distinguishing_features', v_post.distinguishing_features,
         'owner_note',              v_post.owner_note,

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

         -- DORMANT AGGREGATE (unchanged). SAFETY: scalar count only — never
         -- widen to per-sighting rows/locations for a non-owner.
         'sighting_stats', jsonb_build_object('count', 0, 'latest_at', null)
       );
end;
$$;

-- CREATE OR REPLACE preserves grants, but re-assert them so this migration is
-- correct even if it ever defines the function first (idempotent).
revoke execute on function public.get_post_detail(uuid) from public;
grant  execute on function public.get_post_detail(uuid)
  to anon, authenticated, service_role;

-- =============================================================================
-- ⚠️ NO DESTRUCTIVE STATEMENTS. One new SECURITY DEFINER function and its
--    grants. No table, column, row, constraint or existing function is dropped
--    or altered. `create or replace` on a brand-new name.
--
-- WHAT:  `get_notification_feed()` — the notification centre's read, returning
--        exactly what the direct table SELECT returned plus ONE new field:
--        `image_url`, the cover photo of the car the notification is about.
--
-- WHY:   The inbox pass (2026-08-28, docs/design-refs/inbox/) gave conversation
--        rows the Airbnb anatomy — the photograph leads the row, because that
--        is how you recognise which of five silver hatchbacks this one is
--        about. The Notifications face could not follow: `notifications` holds
--        title, body and a payload of ids, and no image at all.
--
--        ⚠️ AND A CLIENT-SIDE JOIN CANNOT FIX IT, which is the whole reason
--        this function exists rather than a second `select`. `post_photos` RLS
--        (20260713140000) lets a client read a photo only while the parent post
--        is 'active', or if it owns the post. By the time the notifications
--        that MATTER arrive — `credited`, `payout_sent`, `not_credited`,
--        `recovery` — the post is recovered and the reader is the spotter, so
--        every one of those rows would come back pictureless. The money
--        notifications would be the only ones with no photo.
--
-- SAFETY: this is a SECURITY DEFINER read, so it must earn every byte it
--        returns. Two fences:
--
--        1. THE FEED ITSELF IS UNCHANGED AND STILL OWN-ROWS-ONLY. The function
--           selects `where user_id = auth.uid()`, the same scope
--           notifications_select_own enforces. It returns no row the caller
--           could not already read.
--
--        2. THE PHOTO IS GATED SEPARATELY AND MORE NARROWLY THAN THE ROW.
--           `image_url` is non-null only when the caller has a real
--           relationship to that post:
--             (a) they own it, or
--             (b) they reported a sighting on it, or
--             (c) it is still 'active' — i.e. anyone could already see it.
--           (a) and (c) are exactly what post_photos RLS already allows. (b) is
--           the ONLY widening, and it is narrow by construction: a spotter
--           reported on that post, which means they saw it while it was active
--           and public. Showing them its photo inside a notification about
--           their own sighting discloses nothing they were not already shown.
--
--        Anything else returns NULL and the client falls back to its icon tile.
--        A notification about someone else's recovered car stays pictureless.
--
--        ⚠️ WHAT THE URL DISCLOSES BESIDES A PICTURE. `post-photos` objects are
--        pathed `<uploader uid>/<hash>-<n>.jpg` in a PUBLIC bucket, so every
--        image_url carries the post owner's user id — which DOMAIN.md lists
--        under "never exposed", and which is exactly why the owner's avatar_path
--        was stripped from get_post_detail (20260713170000). This function does
--        NOT regress that: the identical URL already reaches every anonymous
--        viewer of an active post through get_post_detail, the feed and
--        get_inbox, and a case-(b) spotter necessarily already held it. But it
--        does re-emit that uuid to a spotter mid-dispute, on a post otherwise
--        invisible to them. The real fix is pathing post photos under
--        <post_id>/ (or proxying), which is a project-wide change and is
--        flagged rather than smuggled in here.
--
--        MOSTLY not a live view. `notifications` is deliberately denormalised at
--        write time — "what the user was told, not a live view" (the table
--        comment) — and title, body and payload still are. The PHOTO is not:
--        reordering a post's photos changes the picture on a year-old row, and
--        an active → cancelled transition makes a picture vanish from a row
--        that had one. That is intended (standing is re-checked at read time,
--        so a photo never outlives the right to see it), but it means this one
--        field is a live read inside a frozen row.
--
-- LINKS: 20260806100000_notification_center.sql (the table and its RLS);
--        20260713140000_post_detail.sql (the post_photos policies this reasons
--        about); 20260715120000_chat.sql (get_inbox — the same cover-photo
--        subquery, the same SECURITY DEFINER posture);
--        src/features/notifications/api/notificationsApi.ts (the caller);
--        docs/design-refs/inbox/REFERENCE_SPEC.md.
-- =============================================================================


-- =============================================================================
-- 1. RPC: get_notification_feed() -> jsonb
-- =============================================================================
-- The caller's own feed, newest first, capped at the same 100 the client asked
-- for by hand. Returns a jsonb ARRAY of rows shaped exactly like the old
-- select, plus image_url:
--   { id, kind, title, body, payload, read_at, created_at, image_url }
--
-- Empty session returns '[]' rather than raising: anon holds no EXECUTE, and a
-- torn-down session mid-refresh should not error a feed read (the posture
-- unread_notifications_count() already takes).
create or replace function public.get_notification_feed()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $fn$
  with feed as (
    select n.id,
           n.kind,
           n.title,
           n.body,
           n.payload,
           n.read_at,
           n.created_at,
           -- The post this row is about, if any. Two shapes, because the
           -- payload schemas differ by kind (pushPayload.ts): most carry
           -- postId; the dispute/contest kinds carry sightingId, because the
           -- post is invisible to a spotter once it closes and those screens
           -- key off THEIR sighting.
           --
           -- ⚠️ SHAPE-CHECKED BEFORE CASTING, and the guard is the difference
           -- between one bad row and a dead feed. A bare `::uuid` raises on any
           -- non-uuid text, and this function is all-or-nothing: one malformed
           -- payload would error the RPC, throw in fetchNotifications, and
           -- leave the WHOLE notification centre showing an error state on
           -- every load until the row aged out of 90-day retention. Nothing can
           -- write such a payload today — `notifications` has no client insert
           -- grant and every sender passes a uuid column — but that is an
           -- invariant held in five Edge Functions guarding a total-failure
           -- blast radius, and it costs one `case` to stop depending on it.
           coalesce(
             case
               when n.payload ->> 'postId' ~*
                 '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
               then (n.payload ->> 'postId')::uuid
             end,
             (select s.post_id
                from public.sightings s
               where s.id = case
                              when n.payload ->> 'sightingId' ~*
                                '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                              then (n.payload ->> 'sightingId')::uuid
                            end
                 -- Caller-scoped, so the function does not depend on the
                 -- senders' 1:1 discipline (a sightingId is always written to
                 -- that sighting's own spotter today). A future fan-out sender
                 -- cannot widen the gate through this path.
                 and s.spotter_id = (select auth.uid()))
           ) as post_id
      from public.notifications n
     where n.user_id = (select auth.uid())
     -- id as tiebreaker: rows sharing a created_at would otherwise reorder
     -- between refreshes and flicker at the 100-row cut.
     order by n.created_at desc, n.id desc
     limit 100
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id',         f.id,
        'kind',       f.kind,
        'title',      f.title,
        'body',       f.body,
        'payload',    f.payload,
        'read_at',    f.read_at,
        'created_at', f.created_at,
        -- ⚠️ THE GATE. NULL unless the caller owns the post, reported a
        -- sighting on it, or it is still publicly visible. See the header.
        'image_url',  (
          select ph.url
            from public.post_photos ph
           where ph.post_id = f.post_id
             and exists (
               select 1
                 from public.posts p
                where p.id = f.post_id
                  and (
                        p.owner_id = (select auth.uid())
                     or p.status = 'active'
                     or exists (
                          select 1
                            from public.sightings s2
                           where s2.post_id = p.id
                             and s2.spotter_id = (select auth.uid())
                        )
                      )
             )
           order by ph.position
           limit 1)
      )
      order by f.created_at desc, f.id desc
    ),
    '[]'::jsonb
  )
  from feed f;
$fn$;

comment on function public.get_notification_feed() is
  'The caller''s own notification feed (newest 100), shaped like the table select plus image_url — the cover photo of the car the row is about. Rows are scoped to user_id = auth.uid(), exactly as notifications_select_own allows. image_url is gated MORE narrowly than the row: non-null only when the caller owns that post, reported a sighting on it, or it is still ''active''. The sighting case is the only widening over post_photos RLS, and is narrow by construction — a spotter who reported on a post already saw it while it was public. Everything else returns NULL and the client falls back to an icon.';

-- anon gets nothing: a feed needs an owner. Mirrors the read-marking RPCs.
revoke execute on function public.get_notification_feed() from public, anon;
grant  execute on function public.get_notification_feed() to authenticated, service_role;

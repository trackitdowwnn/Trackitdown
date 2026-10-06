-- =============================================================================
-- WHAT:  The owner's screens learn whether their listing PAID a £5 listing fee,
--        as a fact from the ledger, instead of inferring it (PR4 follow-up).
--          1. get_post_detail: 'has_listing_fee' in the OWNER-ONLY block.
--          2. get_my_reward_status: 'hasListingFee'.
--          3. home_feed_post_json: execute revoked from anon/authenticated.
-- WHY:   Since ADR-0020 a null bounty has two meanings — a £5 fee listing, or
--        a reward that ended — and the app told them apart by elimination
--        ("null bounty and not ended ⇒ paid a fee"). The owner's screens say
--        "your listing fee isn't refunded" on that inference. Any live listing
--        with no held reward that isn't stamped as ended — a row from prod's
--        hand-applied fee schema, a reward listing whose held row went
--        missing — would be told about a fee it never paid. The ledger knows:
--        a listing fee is a payments row of kind listing_fee, `collected` on
--        capture (20260902120000; `held` only on rows from before
--        20260902130000 moved them, accepted here so an un-moved prod row
--        still counts).
--
--        The revoke is hardening (security review of PR4, L5): 20260711130000
--        meant the helper to be internal and revoked it from PUBLIC only, but
--        Supabase grants anon/authenticated directly. Every live caller is a
--        SECURITY DEFINER RPC (get_home_feed, get_nearby_posts, search_posts,
--        get_post_detail, get_my_watchlist, list_my_posts), so it runs as the
--        function owner and the revoke changes nothing for them; no client
--        code calls it.
--
-- PRIVACY: has_listing_fee is OWNER-ONLY — merged into the owner block, so the
--        key is absent from every other payload. A spotter's copy keeps its
--        inference (the ⓘ explainer), which is harmless: it only ever
--        under-promises.
-- MONEY: none. Reads only.
--
-- SAFETY NOTE ON DESTRUCTIVE STATEMENTS: none dropped. `create or replace` on
--        two functions, each restated IN FULL from its latest definition:
--          get_post_detail      — 20260816120000 (extracted mechanically; the
--                                 ONLY change is the has_listing_fee key in
--                                 the owner merge block);
--          get_my_reward_status — 20261006100000 (the ONLY change is
--                                 hasListingFee).
--        One revoke on an internal helper (asserted below).
-- LINKS: supabase/migrations/20261006100000_a_reward_can_end.sql;
--        supabase/migrations/20260816120000_the_timeline_learns_when_things_happened.sql;
--        supabase/tests/reward_ended_verification.sql (CHECK 7);
--        docs/decisions/ADR-0020-a-reward-has-a-term.md.
-- =============================================================================


-- =============================================================================
-- 1. get_post_detail — has_listing_fee, owner-only
-- =============================================================================
-- ⚠️ RESTATED IN FULL from 20260816120000; the visibility gate, the driveway
-- coarsening and every SAFETY note are the originals.
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
             'alerts_sent_at',     v_post.alerts_sent_at,
             -- NEW 2026-10-06 — whether this listing PAID the £5 fee, from the
             -- ledger (20261006110000). The owner's fee sentences rest on it.
             'has_listing_fee',    exists (select 1 from public.payments f
                                            where f.post_id = v_post.id
                                              and f.kind = 'listing_fee'
                                              and f.status in ('collected', 'held')))
         else '{}'::jsonb
       end;
end;
$$;

comment on function public.get_post_detail(uuid) is
  'Returns one post''s detail for the post-detail screen. SECURITY DEFINER; the active-OR-owner predicate is the ONLY visibility gate. The OWNER-ONLY merge block carries last_seen_locality, recovered_at / closed_at / alerts_sent_at (2026-08-16) and has_listing_fee (2026-10-06: whether the listing paid the £5 fee, from the ledger — the owner''s fee sentences rest on it, not on a null bounty); these keys are ABSENT from every non-owner payload. alerts_sent_at is one scalar and never a count or a series — get_post_stats'' prohibition on a timestamped reach series stands.';


-- =============================================================================
-- 2. get_my_reward_status — hasListingFee
-- =============================================================================
-- ⚠️ RESTATED IN FULL from 20261006100000. The ONLY change: hasListingFee.
create or replace function public.get_my_reward_status(p_post_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caller  uuid := auth.uid();
  v_post    record;
  v_current record;
  v_ended   boolean;
begin
  if v_caller is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;
  select owner_id, status, bounty_amount_pence, reward_ended_at, ended_reward_pence into v_post
    from public.posts where id = p_post_id;
  if v_post.owner_id is null or v_post.owner_id <> v_caller then
    raise exception 'POST_NOT_FOUND';
  end if;

  select id, amount_pence, captured_at, refund_fee_absorbed, term_ends_at, legacy_term into v_current
    from public.payments
   where post_id = p_post_id and status = 'held' and kind = 'bounty_escrow';

  v_ended := v_current.id is null
             and v_post.bounty_amount_pence is null
             and v_post.reward_ended_at is not null;

  return jsonb_build_object(
    'postStatus',          v_post.status,
    'mode',                case when v_current.id is null then 'add' else 'change' end,
    -- An opaque token that changes exactly when the reward does — the screen
    -- polls for it after the PaymentSheet closes.
    'rewardId',            v_current.id,
    'amountPence',         v_current.amount_pence,
    'capturedAt',          v_current.captured_at,
    -- When the reward's 60-day term ends (ADR-0020); null until it has one.
    'termEndsAt',          v_current.term_ends_at,
    -- A reward from before the term: its END-OF-TERM refund is in full.
    'legacyTerm',          coalesce(v_current.legacy_term, false),
    'feeAbsorbed',         coalesce(v_current.refund_fee_absorbed, false),
    -- The listing's reward ended unrenewed and went back (PR5); null otherwise.
    'rewardEndedAt',       case when v_ended then v_post.reward_ended_at end,
    'endedRewardPence',    case when v_ended then v_post.ended_reward_pence end,
    -- The listing PAID the £5 fee — the add screen's fee row says so only then.
    'hasListingFee',       exists (select 1 from public.payments f
                                    where f.post_id = p_post_id
                                      and f.kind = 'listing_fee'
                                      and f.status in ('collected', 'held')),
    'hasRecentSightings',  exists (select 1 from public.recent_uncredited_sightings(p_post_id)),
    'block',               public.reward_change_block(p_post_id)
  );
end $$;

comment on function public.get_my_reward_status(uuid) is
  'The owner''s view of their live listing''s reward: mode (change/add), rewardId (changes exactly when the reward does — polled after payment), amount, capture time, termEndsAt (the 60-day term, ADR-0020), whether its refund absorbs the card fee, rewardEndedAt / endedRewardPence (the last reward ended unrenewed and was refunded — only while none is held), hasListingFee (the listing paid the £5 fee, from the ledger), whether recent uncredited sightings exist (lowering is then refused), and the current block token. Owner from auth.uid(); POST_NOT_FOUND for missing and not-owned alike.';

revoke all on function public.get_my_reward_status(uuid) from public, anon;
grant execute on function public.get_my_reward_status(uuid) to authenticated, service_role;


-- =============================================================================
-- 3. home_feed_post_json — internal, as 20260711130000 intended
-- =============================================================================
revoke execute on function public.home_feed_post_json(public.posts, numeric) from public, anon, authenticated;


-- =============================================================================
-- 4. Assert the grants
-- =============================================================================
do $$
begin
  if has_function_privilege('anon', 'public.home_feed_post_json(public.posts, numeric)', 'execute')
     or has_function_privilege('authenticated', 'public.home_feed_post_json(public.posts, numeric)', 'execute') then
    raise exception 'home_feed_post_json is still client-executable';
  end if;
  if not has_function_privilege('anon', 'public.get_post_detail(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.get_post_detail(uuid)', 'execute') then
    raise exception 'get_post_detail lost its client grant — the listing page would break';
  end if;
  if has_function_privilege('anon', 'public.get_my_reward_status(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.get_my_reward_status(uuid)', 'execute') then
    raise exception 'get_my_reward_status grants are wrong';
  end if;
end $$;


-- =============================================================================
-- END OF MIGRATION
-- =============================================================================

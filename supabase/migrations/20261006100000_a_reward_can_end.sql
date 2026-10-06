-- =============================================================================
-- WHAT:  "Reward ended" — the state a listing is in once its reward's 60-day
--        term ran out and the reward went back to the owner (PR4 of the
--        60-day reward plan). This migration gives that state a NAME and every
--        reader a way to SEE it; nothing here ends a reward (the expiry, PR5,
--        is the only writer).
--          1. posts.reward_ended_at + posts.ended_reward_pence — dormant until
--             PR5's expiry records a lapse (both together, or neither).
--          2. home_feed_post_json carries 'reward_ended' — one edit reaches
--             get_home_feed, get_nearby_posts, search_posts (the feed and
--             the map), get_post_detail, get_my_watchlist and list_my_posts.
--          3. list_my_posts carries 'reward_term_ends_at' — the owner's own
--             "Reward ends 12 December" nudge on My listings.
--          4. get_my_reward_status carries rewardEndedAt / endedRewardPence —
--             the owner's listing says "ended, £Z returned, still live".
-- WHY:   ADR-0020 point 3: a reward that isn't renewed is refunded and the
--        LISTING STAYS LIVE. After PR5 nulls its bounty_amount_pence, every
--        reader would show it as "No reward" — and every "no reward" sentence
--        in the app says the owner paid a £5 listing fee instead. That is
--        false for a lapsed listing (the owner paid a reward, and got it
--        back), so the spotter must be told the true thing, and PR5 may not
--        send a single `reward_ended` push before this ships.
--
--        A LAPSE IS RECOGNISED BY BOTH FACTS, NOT THE STAMP ALONE:
--        reward_ended = reward_ended_at is not null AND bounty_amount_pence is
--        null. A listing that ended and then had a reward ADDED again carries
--        a bounty, so it reads as a reward listing whether or not the add path
--        clears the stamp — the readers never depend on a second writer
--        remembering to.
--
-- PRIVACY: 'reward_ended' is a boolean on a listing that is already public —
--        the same fact as the bounty disappearing, said truthfully. The
--        date and the amount stay OWNER-ONLY (get_my_reward_status,
--        list_my_posts — both scoped to auth.uid()).
--
-- MONEY: none. No function here writes, and no refund amount changes.
--
-- SAFETY NOTE ON DESTRUCTIVE STATEMENTS: none dropped. Two additive nullable
--        columns and one check constraint (every existing row passes: both
--        columns are new and null); `create or replace` on three existing
--        functions, each restated IN FULL from its latest definition:
--          home_feed_post_json — 20260806130000_feed_photos.sql;
--          list_my_posts       — 20260924130000_archive_listings.sql;
--          get_my_reward_status — 20261005140000_a_reward_has_a_term.sql.
--        Return types unchanged (jsonb), so no DROP is needed. The new columns
--        are in no client column grant (the posts INSERT/UPDATE grants are an
--        explicit list), so only a definer function can write them.
-- LINKS: docs/decisions/ADR-0020-a-reward-has-a-term.md;
--        src/shared/ui/BountyTag.tsx (REWARD_ENDED_LABEL — the one wording);
--        supabase/tests/reward_ended_verification.sql.
-- =============================================================================


-- =============================================================================
-- 1. Columns — written by the expiry (PR5), read by everything below
-- =============================================================================
alter table public.posts
  add column reward_ended_at    timestamptz,
  add column ended_reward_pence integer,
  -- Both or neither: "ended" without the amount it ended at would leave the
  -- owner's banner unable to say what came back, and an amount without a date
  -- is not a lapse at all.
  add constraint posts_reward_ended_pair_chk
    check ((reward_ended_at is null) = (ended_reward_pence is null)),
  add constraint posts_ended_reward_pence_positive_chk
    check (ended_reward_pence is null or ended_reward_pence > 0);

comment on column public.posts.reward_ended_at is
  'When the refund of this listing''s reward, ended at its 60-day term unrenewed, was RECORDED (ADR-0020) — the same moment bounty_amount_pence is nulled, so the owner''s "we refunded it on <date>" is this date (not the term end, which may be up to 72 hours earlier). Set ONLY by the expiry (PR5). The listing stays live; readers report "reward ended" only while bounty_amount_pence is also null, so a reward added again later wins. Never client-writable.';
comment on column public.posts.ended_reward_pence is
  'The amount of the reward that ended (integer pence) — the owner''s "£Z returned" line. Set with reward_ended_at, never without it. Owner-only in every read.';


-- =============================================================================
-- 2. home_feed_post_json — now says when a listing's reward has ended
-- =============================================================================
-- ⚠️ RESTATED IN FULL from 20260806130000. The ONLY change: 'reward_ended'.
-- Every caller composes `home_feed_post_json(p, …) || …`, so this one key
-- reaches the feed, nearby, search, map pins, detail, watchlist and My
-- listings at once — and a later caller cannot forget it.
create or replace function public.home_feed_post_json(
  p_post           public.posts,
  p_distance_miles numeric
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id',                  p_post.id,
    'plate',               p_post.plate,
    'make',                p_post.make,
    'model',               p_post.model,
    'colour',              p_post.colour,
    'bounty_amount_pence', p_post.bounty_amount_pence,
    -- A lapsed reward (ADR-0020) — distinct from a £5 fee listing, which also
    -- has a null bounty. Both facts, never the stamp alone: see the header.
    'reward_ended',        (p_post.reward_ended_at is not null and p_post.bounty_amount_pence is null),
    'status',              p_post.status,
    'last_seen_at',        p_post.last_seen_at,
    'last_seen_area',      p_post.last_seen_area,
    'distance_miles',      p_distance_miles,   -- null in national mode
    'created_at',          p_post.created_at,
    -- The card thumbnail: first photo by position, shaped as a one-element
    -- array so the client maps it to PostSummary.photos unchanged. A post
    -- with no photos yields NULL from the subquery, coalesced to [] — never
    -- a null key, so the client schema can require an array.
    'photos', coalesce(
      (
        select jsonb_build_array(jsonb_build_object('url', pp.url))
        from public.post_photos pp
        where pp.post_id = p_post.id
        order by pp.position
        limit 1
      ),
      '[]'::jsonb
    )
  );
$$;

comment on function public.home_feed_post_json(public.posts, numeric) is
  'Serialises a post into the client PostSummary shape, including "photos" — the FIRST photo by position as [{url}], or [] (2026-08-06) — and "reward_ended" (2026-10-06, ADR-0020): true when the listing''s reward ran out unrenewed and was refunded while the listing stays live, as opposed to a £5 fee listing (both have a null bounty). Callers appending their own "photos" override this one, since this call sits left of the ||. Does NO status filtering; callers own the safety predicates. STABLE (timestamptz->json depends on the TimeZone GUC), not IMMUTABLE.';


-- =============================================================================
-- 3. list_my_posts — now with the reward's term, for the My listings nudge
-- =============================================================================
-- ⚠️ RESTATED IN FULL from 20260924130000. The ONLY change: 'reward_term_ends_at'
-- — the term end of the listing's HELD reward, or null (no reward, a fee
-- listing, a draft, a closed listing). payments_one_held_per_post_uidx
-- (20261005110000) makes the subquery single-row by rule, not by luck.
--
-- SAFETY (Tier 1 — read before editing): SECURITY DEFINER, so RLS is
--   BYPASSED. The `p.owner_id = v_viewer` predicate is the ONLY thing keeping
--   one user's posts out of another user's hands — never weaken it or rely on
--   RLS to backstop it. No caller identity (anon / missing uid) -> empty
--   array; never fall through to "all rows". The term date is the caller's
--   own payment's, on the caller's own post.
create or replace function public.list_my_posts()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_viewer uuid := auth.uid();
  v_result jsonb;
begin
  -- SAFETY: no caller identity -> nothing. Never fall through to "all rows".
  if v_viewer is null then
    return '[]'::jsonb;
  end if;

  select coalesce(jsonb_agg(t.item order by t.created_at desc), '[]'::jsonb)
    into v_result
  from (
    select
      p.created_at,
      -- Shared PostSummary core (distance is meaningless for an owner's own
      -- list, so pass null), extended with the first-photo array, the
      -- owner's archive stamp and the held reward's term end.
      public.home_feed_post_json(p, null::numeric)
        || jsonb_build_object(
             'photos',
             case
               when ph.url is not null
                 then jsonb_build_array(jsonb_build_object('url', ph.url))
               else '[]'::jsonb
             end,
             'archived_at',
             p.archived_at,
             -- When the held reward's 60-day term ends (ADR-0020), or null.
             'reward_term_ends_at',
             (select pay.term_ends_at
                from public.payments pay
               where pay.post_id = p.id
                 and pay.status = 'held'
                 and pay.kind = 'bounty_escrow')
           ) as item
    from public.posts p
    -- First photo (lowest position) as the card thumbnail; null row when the
    -- post has no photos. Served by post_photos_post_id_position_idx.
    left join lateral (
      select pp.url
      from public.post_photos pp
      where pp.post_id = p.id
      order by pp.position
      limit 1
    ) ph on true
    where p.owner_id = v_viewer   -- SAFETY: caller's OWN posts ONLY. All statuses.
  ) t;

  return v_result;
end;
$$;

comment on function public.list_my_posts() is
  'Returns the caller''s own posts as a JSON array, newest first (created_at desc), across ALL lifecycle statuses. Each element is the home_feed_post_json PostSummary core plus a "photos" array carrying the first photo ([{url}] or []), "archived_at" (timestamptz or null — the owner''s archive stamp, set by set_post_archived) and "reward_term_ends_at" (the held reward''s 60-day term end, ADR-0020, or null). SECURITY DEFINER (bypasses RLS): owner_id = auth.uid() is the only ownership gate. Anon -> [].';

revoke execute on function public.list_my_posts() from public;
revoke execute on function public.list_my_posts() from anon;
grant  execute on function public.list_my_posts()
  to authenticated, service_role;


-- =============================================================================
-- 4. get_my_reward_status — now with the ended state
-- =============================================================================
-- ⚠️ RESTATED IN FULL from 20261005140000. The ONLY changes: rewardEndedAt and
-- endedRewardPence — present only while the listing has NO held reward and no
-- bounty (a reward added again since makes the listing a reward listing, and
-- the banner shows that one instead).
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
    'hasRecentSightings',  exists (select 1 from public.recent_uncredited_sightings(p_post_id)),
    'block',               public.reward_change_block(p_post_id)
  );
end $$;

comment on function public.get_my_reward_status(uuid) is
  'The owner''s view of their live listing''s reward: mode (change/add), rewardId (changes exactly when the reward does — polled after payment), amount, capture time, termEndsAt (the 60-day term, ADR-0020), whether its refund absorbs the card fee, rewardEndedAt / endedRewardPence (the last reward ended unrenewed and was refunded — only while none is held), whether recent uncredited sightings exist (lowering is then refused), and the current block token. Owner from auth.uid(); POST_NOT_FOUND for missing and not-owned alike.';

revoke all on function public.get_my_reward_status(uuid) from public, anon;
grant execute on function public.get_my_reward_status(uuid) to authenticated, service_role;


-- =============================================================================
-- 5. Assert the grants
-- =============================================================================
do $$
declare
  r text;
  c text;
  p text;
begin
  if has_function_privilege('anon', 'public.get_my_reward_status(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.get_my_reward_status(uuid)', 'execute') then
    raise exception 'get_my_reward_status grants are wrong';
  end if;
  if has_function_privilege('anon', 'public.list_my_posts()', 'execute')
     or not has_function_privilege('authenticated', 'public.list_my_posts()', 'execute') then
    raise exception 'list_my_posts grants are wrong';
  end if;
  -- Not writable (anyone could mark a reward ended), and not READABLE either:
  -- the date and amount are owner-only, and the only thing keeping them out
  -- of `GET /rest/v1/posts?select=…` is that the posts SELECT grant is an
  -- explicit column list (20260810180000). A future table-wide re-grant must
  -- fail here, not leak quietly.
  foreach r in array array['anon', 'authenticated'] loop
    foreach c in array array['reward_ended_at', 'ended_reward_pence'] loop
      foreach p in array array['SELECT', 'INSERT', 'UPDATE'] loop
        if has_column_privilege(r, 'public.posts', c, p) then
          raise exception '% has % on posts.% — the ended reward must be written only by the expiry and read only through the owner''s RPCs', r, p, c;
        end if;
      end loop;
    end loop;
  end loop;
end $$;


-- =============================================================================
-- END OF MIGRATION
-- =============================================================================

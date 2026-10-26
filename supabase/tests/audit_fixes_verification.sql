-- =============================================================================
-- WHAT:  Verification for 20261026120000_the_audit_closes_its_leads.sql. NOT a
--        migration.
-- WHY:   Security audit run 1 found seven database leads live in production.
--        Each check below proves one is closed AND that the honest path still
--        works, so a fix cannot pass by simply switching the feature off.
--
-- CHECKS: 1 ⚠️ the feeds are not a membership oracle on a driveway home ·
-- 2 ⚠️ a driveway theft shows its district, never its street; the owner keeps
-- the street · 3 column grants · 4 ⚠️ a profile row is readable by its owner
-- only, and the RPCs still name people · 5 a £5 fee never puts live a draft
-- that now asks for a reward · 6 a shared-device pair keeps the credit, not the
-- public count · 7 Expo tokens only, ten per user.
-- HOW:   Self-asserting, RAISE on failure (CI's db job), inside begin/rollback.
--        Uses seed.sql: Alex (1111…) owns the active driveway post …0006 and
--        the active bounty post …0001; Beth is 2222….
-- LINKS: supabase/migrations/20261026120000_the_audit_closes_its_leads.sql,
--        supabase/tests/search_verification.sql CHECK 19 (the same oracle).
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- CHECK 1 — the radius cannot single out a driveway home.
--
-- An origin ~3 km from the post, on the side AWAY from its snapped point, puts
-- the exact point nearer than the snapped one. A radius between the two is the
-- attacker's probe: on the exact point the post came back, so its presence was
-- a 1-metre bit. Membership now reads the snapped point, so it must not.
-- -----------------------------------------------------------------------------
do $$
declare
  v_post   uuid := 'a1a1a1a1-0000-0000-0000-000000000006';
  v_exact  geometry;
  v_snap   geometry;
  v_olat   double precision;
  v_olng   double precision;
  v_origin geography;
  v_d_exact double precision;
  v_d_snap  double precision;
  v_r      integer;
  v_page   jsonb;
  v_off    integer;
  v_seen   boolean;
  v_feed   jsonb;
begin
  select p.last_seen_location::geometry into v_exact
    from public.posts p
   where p.id = v_post and p.status = 'active' and p.stolen_from = 'driveway';
  if v_exact is null then
    raise exception 'CHECK 1 FAILED: the seeded active driveway post is missing.';
  end if;
  v_snap := ST_SnapToGrid(v_exact, 0.01);

  -- 0.03° of latitude (~3.3 km) beyond the exact point, away from the snap.
  v_olat := ST_Y(v_exact) + 0.03 * sign(ST_Y(v_exact) - ST_Y(v_snap));
  v_olng := ST_X(v_exact);
  v_origin := ST_SetSRID(ST_MakePoint(v_olng, v_olat), 4326)::geography;
  v_d_exact := ST_Distance(v_exact::geography, v_origin);
  v_d_snap  := ST_Distance(v_snap::geography, v_origin);
  if v_d_snap - v_d_exact < 200 then
    raise exception 'CHECK 1 FAILED: fixture — the exact and snapped points are not far '
                    'enough apart from this origin (% m vs % m).', v_d_exact, v_d_snap;
  end if;

  -- The probe: inside on the exact point, outside on the snapped one.
  v_r := ceil(v_d_exact)::integer + 50;

  perform set_config('request.jwt.claims', null, true);
  set local role anon;

  v_seen := false;
  v_off := 0;
  loop
    v_page := public.get_nearby_posts(v_olat, v_olng, v_r, v_off, 25);
    exit when jsonb_array_length(v_page) = 0;
    if exists (select 1 from jsonb_array_elements(v_page) e
                where e->>'id' = v_post::text) then
      v_seen := true;
    end if;
    v_off := v_off + 25;
  end loop;

  v_feed := public.get_home_feed(v_olat, v_olng, v_r);
  reset role;

  if v_seen then
    raise exception 'CHECK 1 FAILED: get_nearby_posts returned the driveway post at a radius '
                    'that holds its EXACT point but not its snapped one — the 1-metre oracle.';
  end if;
  if v_feed::text like '%' || v_post::text || '%' then
    raise exception 'CHECK 1 FAILED: get_home_feed returned the driveway post at a radius '
                    'that holds its EXACT point but not its snapped one.';
  end if;

  -- Sanity: a radius past the snapped point still finds it, or coarsening has
  -- deleted the post from the feed rather than blurred it.
  perform set_config('request.jwt.claims', null, true);
  set local role anon;
  v_seen := false;
  v_off := 0;
  loop
    v_page := public.get_nearby_posts(v_olat, v_olng, ceil(v_d_snap)::integer + 50, v_off, 25);
    exit when jsonb_array_length(v_page) = 0;
    if exists (select 1 from jsonb_array_elements(v_page) e
                where e->>'id' = v_post::text) then
      v_seen := true;
    end if;
    v_off := v_off + 25;
  end loop;
  reset role;

  if not v_seen then
    raise exception 'CHECK 1 FAILED: the driveway post is missing even at a radius past its '
                    'snapped point.';
  end if;

  raise notice 'CHECK 1 passed: feed membership follows the snapped point.';
end $$;

-- -----------------------------------------------------------------------------
-- CHECK 2 — a driveway theft shows its district to others; the owner keeps the
-- street. A non-driveway post is unchanged.
-- -----------------------------------------------------------------------------
do $$
declare
  v_post  uuid := 'a1a1a1a1-0000-0000-0000-000000000006';
  v_other uuid := 'a1a1a1a1-0000-0000-0000-000000000001';
  v_area  text;
  v_mine  jsonb;
begin
  -- No district yet: the public sees NO area, never the street as a fallback.
  update public.posts set last_seen_locality = null where id = v_post;
  perform set_config('request.jwt.claims', null, true);
  set local role anon;
  v_area := public.get_post_detail(v_post) ->> 'last_seen_area';
  reset role;
  if v_area is not null then
    raise exception 'CHECK 2 FAILED: a driveway post with no district showed "%" to anon.', v_area;
  end if;

  update public.posts set last_seen_locality = 'Ancoats' where id = v_post;

  perform set_config('request.jwt.claims', null, true);
  set local role anon;
  v_area := public.get_post_detail(v_post) ->> 'last_seen_area';
  reset role;
  if v_area is distinct from 'Ancoats' then
    raise exception 'CHECK 2 FAILED: anon''s post detail showed "%" for a driveway theft, '
                    'not its district.', v_area;
  end if;

  -- The shared feed card (every feed, search and the watchlist build on it).
  select public.home_feed_post_json(p, null::numeric) ->> 'last_seen_area' into v_area
    from public.posts p where p.id = v_post;
  if v_area is distinct from 'Ancoats' then
    raise exception 'CHECK 2 FAILED: the feed card showed "%" for a driveway theft.', v_area;
  end if;

  -- A signed-in stranger (Beth) sees the district too.
  perform set_config('request.jwt.claims',
    '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}', true);
  set local role authenticated;
  v_area := public.get_post_detail(v_post) ->> 'last_seen_area';
  reset role;
  if v_area is distinct from 'Ancoats' then
    raise exception 'CHECK 2 FAILED: a signed-in stranger saw "%" for a driveway theft.', v_area;
  end if;

  -- The owner (Alex) keeps the street, on the detail page and on My listings.
  perform set_config('request.jwt.claims',
    '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', true);
  set local role authenticated;
  v_area := public.get_post_detail(v_post) ->> 'last_seen_area';
  v_mine := public.list_my_posts();
  reset role;
  if v_area is distinct from 'Manchester' then
    raise exception 'CHECK 2 FAILED: the owner''s post detail showed "%", not their own label.', v_area;
  end if;
  if not exists (select 1 from jsonb_array_elements(v_mine) e
                  where e->>'id' = v_post::text and e->>'last_seen_area' = 'Manchester') then
    raise exception 'CHECK 2 FAILED: the owner''s My listings card lost its own label.';
  end if;

  -- A non-driveway theft is unchanged for everyone.
  perform set_config('request.jwt.claims', null, true);
  set local role anon;
  v_area := public.get_post_detail(v_other) ->> 'last_seen_area';
  reset role;
  if v_area is distinct from 'Manchester' then
    raise exception 'CHECK 2 FAILED: a non-driveway post''s label changed to "%".', v_area;
  end if;

  raise notice 'CHECK 2 passed: driveway thefts show the district; owners keep their label.';
end $$;

-- -----------------------------------------------------------------------------
-- CHECK 3 — PostgREST's direct route to the label and the owner is closed.
-- -----------------------------------------------------------------------------
do $$
begin
  if has_column_privilege('anon', 'public.posts', 'owner_id', 'SELECT') then
    raise exception 'CHECK 3 FAILED: anon can still read posts.owner_id.';
  end if;
  if has_column_privilege('anon', 'public.posts', 'last_seen_area', 'SELECT')
     or has_column_privilege('authenticated', 'public.posts', 'last_seen_area', 'SELECT') then
    raise exception 'CHECK 3 FAILED: a client role can still read posts.last_seen_area.';
  end if;
  if has_column_privilege('anon', 'public.posts', 'last_seen_locality', 'SELECT')
     or has_column_privilege('authenticated', 'public.posts', 'last_seen_locality', 'SELECT') then
    raise exception 'CHECK 3 FAILED: a client role can still read posts.last_seen_locality.';
  end if;
  -- Five RLS policies on other tables read p.owner_id as the signed-in caller.
  if not has_column_privilege('authenticated', 'public.posts', 'owner_id', 'SELECT') then
    raise exception 'CHECK 3 FAILED: authenticated lost posts.owner_id — the owner-side RLS '
                    'policies on post_photos etc. would now fail.';
  end if;

  raise notice 'CHECK 3 passed: owner_id is closed to anon; both labels to every client role.';
end $$;

-- -----------------------------------------------------------------------------
-- CHECK 4 — a profile row is readable by its owner only; the RPCs still name
-- the people they are meant to.
-- -----------------------------------------------------------------------------
do $$
declare
  v_other  integer;
  v_own    integer;
  v_owner  text;
begin
  perform set_config('request.jwt.claims',
    '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}', true);
  set local role authenticated;
  select count(*) into v_other from public.profiles
   where id = '11111111-1111-1111-1111-111111111111';
  select count(*) into v_own from public.profiles
   where id = '22222222-2222-2222-2222-222222222222';
  v_owner := public.get_post_detail('a1a1a1a1-0000-0000-0000-000000000006') -> 'owner' ->> 'first_name';
  reset role;

  if v_other <> 0 then
    raise exception 'CHECK 4 FAILED: a signed-in user can read another user''s profile row '
                    '(display_name may hold a surname).';
  end if;
  if v_own <> 1 then
    raise exception 'CHECK 4 FAILED: a signed-in user can no longer read their OWN profile.';
  end if;
  if v_owner is null then
    raise exception 'CHECK 4 FAILED: get_post_detail lost the owner''s first name.';
  end if;

  raise notice 'CHECK 4 passed: profiles are own-row only; the RPCs still carry first names.';
end $$;

-- -----------------------------------------------------------------------------
-- CHECK 5 — a £5 fee never puts live a draft that now asks for a reward.
-- -----------------------------------------------------------------------------
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate) values
  ('a0d17000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'draft', null, 'AU01 FEE'),
  ('a0d17000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'draft', null, 'AU02 FEE');
insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence, kind) values
  ('a0d17000-0000-0000-0000-000000000001', 'pi_audit_fee_1', 'requires_payment', 500, 'listing_fee'),
  ('a0d17000-0000-0000-0000-000000000002', 'pi_audit_fee_2', 'requires_payment', 500, 'listing_fee');

do $$
begin
  -- The attack: a reward written onto the draft after the fee intent exists.
  update public.posts set bounty_amount_pence = 50000
   where id = 'a0d17000-0000-0000-0000-000000000001';
  perform public.mark_post_payment_held('pi_audit_fee_1');

  if (select status from public.posts where id = 'a0d17000-0000-0000-0000-000000000001') <> 'draft' then
    raise exception 'CHECK 5 FAILED: a £5 fee put live a draft advertising a reward that '
                    'nobody holds.';
  end if;
  if (select status from public.payments where stripe_payment_intent_id = 'pi_audit_fee_1') <> 'collected' then
    raise exception 'CHECK 5 FAILED: the captured fee was not recorded as collected.';
  end if;

  -- The honest path: a free draft still goes live on its fee.
  perform public.mark_post_payment_held('pi_audit_fee_2');
  if (select status from public.posts where id = 'a0d17000-0000-0000-0000-000000000002') <> 'active' then
    raise exception 'CHECK 5 FAILED: a free draft no longer goes live when its fee is paid.';
  end if;

  raise notice 'CHECK 5 passed: the fee activates free drafts only.';
end $$;

-- -----------------------------------------------------------------------------
-- CHECK 6 — a shared-device pair keeps the credit, not the public count.
-- -----------------------------------------------------------------------------
insert into public.sightings (id, post_id, spotter_id, status, area_label, location_unavailable)
values ('a0d17000-0000-0000-0000-0000000000c1', 'a1a1a1a1-0000-0000-0000-000000000001',
        '22222222-2222-2222-2222-222222222222', 'unverified', 'Ancoats', true);
-- Alex's phone handed to Beth: the one-phone-two-accounts signal.
insert into public.device_links (token_hash, from_user_id, to_user_id)
values (encode(extensions.digest('audit-shared-handset', 'sha256'), 'hex'),
        '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222');

do $$
declare
  v_before integer;
begin
  select recoveries_credited into v_before from public.profiles
   where id = '22222222-2222-2222-2222-222222222222';

  perform set_config('request.jwt.claims',
    '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', true);
  set local role authenticated;
  perform public.claim_recovery('a1a1a1a1-0000-0000-0000-000000000001',
                                'a0d17000-0000-0000-0000-0000000000c1');
  reset role;

  if (select status from public.sightings where id = 'a0d17000-0000-0000-0000-0000000000c1') <> 'credited' then
    raise exception 'CHECK 6 FAILED: the flagged pair''s sighting was not credited.';
  end if;
  if (select recoveries_credited from public.profiles
       where id = '22222222-2222-2222-2222-222222222222') <> v_before then
    raise exception 'CHECK 6 FAILED: a shared-device pair still raised the spotter''s public '
                    'recoveries count.';
  end if;

  raise notice 'CHECK 6 passed: a flagged pair keeps the credit, not the count.';
end $$;
rollback;

-- -----------------------------------------------------------------------------
-- CHECK 7 — Expo tokens only, and a user keeps their ten newest.
-- -----------------------------------------------------------------------------
begin;
insert into public.push_tokens (token, user_id, platform, updated_at)
select 'ExponentPushToken[audit-' || i || ']', '11111111-1111-1111-1111-111111111111',
       'android', now() - make_interval(mins => i)
  from generate_series(1, 10) i;

do $$
declare
  v_raised boolean := false;
begin
  perform set_config('request.jwt.claims',
    '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', true);
  set local role authenticated;
  begin
    perform public.register_push_token('not-an-expo-token', 'android');
  exception when others then
    v_raised := sqlerrm like '%INVALID_INPUT%';
  end;
  perform public.register_push_token('ExponentPushToken[audit-new]', 'android');
  reset role;

  if not v_raised then
    raise exception 'CHECK 7 FAILED: register_push_token accepted a non-Expo token.';
  end if;
  if (select count(*) from public.push_tokens
       where user_id = '11111111-1111-1111-1111-111111111111') <> 10 then
    raise exception 'CHECK 7 FAILED: a user holds more than ten push tokens.';
  end if;
  if exists (select 1 from public.push_tokens where token = 'ExponentPushToken[audit-10]') then
    raise exception 'CHECK 7 FAILED: the OLDEST token survived; a newer one was evicted.';
  end if;
  if not exists (select 1 from public.push_tokens where token = 'ExponentPushToken[audit-new]') then
    raise exception 'CHECK 7 FAILED: the new device''s token was not kept.';
  end if;

  raise notice 'CHECK 7 passed: Expo tokens only; ten per user, newest kept.';
end $$;
rollback;

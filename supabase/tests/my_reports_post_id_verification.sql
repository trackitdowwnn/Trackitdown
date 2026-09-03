-- =============================================================================
-- WHAT:  Tier 1 verification for my_sighting_record's `post_id` — that it
--        appears for an ACTIVE post and is NULL for every closed one, and that
--        nothing else about the payload widened. NOT a migration.
-- WHY:   ⚠️ CHECK 2 IS THE POINT OF THIS FILE. `case when p.status = 'active'`
--        is the entire difference between closing a dead end (review #16) and
--        opening a back door into listings a spotter was never shown. That rule
--        is one word in one line, it has no type to protect it, and its failure
--        mode is silent: a spotter would simply start being able to open closed
--        posts, and nothing anywhere would raise.
--
--        The rule matters because a CLOSED post is invisible to a spotter — it
--        is why the `closed_uncredited` push routes to the dispute screen
--        rather than the post. An ACTIVE post is public (get_post_detail serves
--        it to anon), so its id reveals nothing search would not.
--
-- CHECKS: 1 an active post yields its id · 2 ⚠️ EVERY closed status yields NULL
-- · 3 the payload did not otherwise widen (no owner, location or plate) ·
-- 4 still scoped to the caller · 5 grants unchanged.
-- LINKS: supabase/migrations/20260903110000_my_reports_can_open_the_post.sql;
--        supabase/migrations/20260901120000_my_sighting_record_dispute.sql.
--
-- SELF-ASSERTING: every check RAISES on failure (ON_ERROR_STOP=1). Everything
-- runs inside begin/rollback.
-- =============================================================================

begin;
do $$
declare
  v_post     uuid := 'a1a1a1a1-0000-0000-0000-000000000003';
  v_spotter  uuid := '11111111-1111-1111-1111-111111111111';
  v_sight    uuid := 'eeee0000-0000-0000-0000-000000000001';
  v_row      jsonb;
  v_closed   text;
begin
  insert into public.sightings (id, post_id, spotter_id, status, area_label, location_unavailable)
  values (v_sight, v_post, v_spotter, 'unverified', 'Ancoats', true);

  perform set_config('request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);

  -- ---------------------------------------------------------------------
  -- CHECK 1 — an ACTIVE post hands back its id. (The seeded post is active.)
  -- ---------------------------------------------------------------------
  select e into v_row
    from jsonb_array_elements(public.my_sighting_record() -> 'sightings') e
   where (e ->> 'id')::uuid = v_sight;

  if v_row is null then
    raise exception 'CHECK 1 FAILED: the spotter''s own report is missing from their record';
  end if;
  if (v_row ->> 'post_id')::uuid is distinct from v_post then
    raise exception 'CHECK 1 FAILED: post_id is % for an ACTIVE post, expected % — the dead end is not closed', v_row ->> 'post_id', v_post;
  end if;

  -- ---------------------------------------------------------------------
  -- CHECK 2 — ⚠️ EVERY CLOSED STATUS YIELDS NULL. Looped rather than spot-
  -- checked: the guard is `= 'active'`, so a future edit to `<> 'draft'` or
  -- `in (...)` would pass a single-case test and open every closed listing.
  -- ---------------------------------------------------------------------
  foreach v_closed in array array[
    'recovered', 'recovered_no_spotter', 'cancelled', 'expired',
    'recovery_claimed', 'pending_verification', 'draft', 'rejected'
  ] loop
    update public.posts set status = v_closed::public.post_status where id = v_post;

    select e into v_row
      from jsonb_array_elements(public.my_sighting_record() -> 'sightings') e
     where (e ->> 'id')::uuid = v_sight;

    if v_row is null then
      raise exception 'CHECK 2 FAILED: the report vanished entirely at status % — a spotter must keep their own history whatever became of the post', v_closed;
    end if;
    if (v_row ->> 'post_id') is not null then
      raise exception 'CHECK 2 FAILED: post_id was handed out for a % post. A spotter cannot see a closed listing — this is the rule that makes closed_uncredited route to the dispute screen rather than the post, and it just became a back door', v_closed;
    end if;
  end loop;

  update public.posts set status = 'active' where id = v_post;

  -- ---------------------------------------------------------------------
  -- CHECK 3 — nothing ELSE widened. The payload's wall is the whole reason
  -- this RPC exists in its narrow form.
  -- ---------------------------------------------------------------------
  select e into v_row
    from jsonb_array_elements(public.my_sighting_record() -> 'sightings') e
   where (e ->> 'id')::uuid = v_sight;

  if v_row ?| array['owner_id', 'owner', 'lat', 'lng', 'location', 'plate',
                    'last_seen_area', 'bounty_amount_pence', 'post_status'] then
    raise exception 'CHECK 3 FAILED: the record payload widened beyond post_id — keys present: %', (select string_agg(k, ', ') from jsonb_object_keys(v_row) k);
  end if;

  -- The car block stays make/colour only.
  if (select count(*) from jsonb_object_keys(v_row -> 'car')) <> 2 then
    raise exception 'CHECK 3 FAILED: the car block is no longer make+colour only';
  end if;

  -- ---------------------------------------------------------------------
  -- CHECK 4 — still the caller's own rows only.
  -- ---------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);

  if exists (
    select 1 from jsonb_array_elements(public.my_sighting_record() -> 'sightings') e
     where (e ->> 'id')::uuid = v_sight
  ) then
    raise exception 'CHECK 4 FAILED: another user can see this spotter''s report';
  end if;

  raise notice 'my_reports_post_id CHECKS 1-4 passed';
end $$;

-- -----------------------------------------------------------------------------
-- CHECK 5 — grants unchanged by the replace. A `create or replace` keeps them,
-- but this RPC returns one user's history and anon must never reach it.
-- -----------------------------------------------------------------------------
do $$
declare
  v_fn text := 'public.my_sighting_record()';
begin
  if to_regprocedure(v_fn) is null then
    raise exception 'CHECK 5 FAILED: % does not exist', v_fn;
  end if;
  if has_function_privilege('anon', v_fn, 'EXECUTE') then
    raise exception 'CHECK 5 FAILED: anon can EXECUTE % — it returns one user''s reporting history', v_fn;
  end if;
  if not has_function_privilege('authenticated', v_fn, 'EXECUTE') then
    raise exception 'CHECK 5 FAILED: authenticated CANNOT EXECUTE % — My reports would be empty for everyone', v_fn;
  end if;

  raise notice 'my_reports_post_id CHECK 5 passed';
end $$;

rollback;

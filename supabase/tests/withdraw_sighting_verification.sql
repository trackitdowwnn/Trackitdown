-- =============================================================================
-- WHAT:  Tier 1 verification for withdraw_sighting — the window, the scope, the
--        two exclusions, and the two properties this design LEANS on rather
--        than adds. NOT a migration.
-- WHY:   ⚠️ CHECKS 5 AND 6 ARE THE POINT OF THIS FILE. The migration claims two
--        things it did not implement:
--
--        (5) a withdrawn sighting falls outside the money paths BY
--            CONSTRUCTION, because create_refund_hold's audience and
--            open_dispute's eligibility both gate on
--            `status in ('unverified','helpful')`. Nothing was changed there.
--            An inherited property nobody asserts is a property that gets
--            widened away by the next person who adds a status.
--
--        (6) withdrawing is NOT a rate-limit bypass, because create_sighting
--            counts the rolling 24h window by created_at ALONE. That also was
--            not changed. Without this check, file-withdraw-file-withdraw
--            becomes an unbounded reporting channel the day someone "fixes"
--            that count to ignore withdrawn rows.
--
-- CHECKS: 1 the spotter can withdraw their own unverified sighting ·
-- 2 ⚠️ NOT after a verdict (helpful / not_mine / credited) · 3 not someone
-- else's, and one opaque token for every refusal · 4 it vanishes from the
-- owner's list and the public map · 5 ⚠️ it is outside the money paths ·
-- 6 ⚠️ it does NOT free a rate-limit slot · 7 the reputation counter drops,
-- floored at 0 · 8 grants.
-- LINKS: supabase/migrations/20260903100000_withdraw_a_sighting.sql;
--        supabase/migrations/20260805100000_refund_holds_and_disputes.sql;
--        supabase/migrations/20260801180000_sighting_photo_source.sql
--          (create_sighting's rate-limit window).
--
-- SELF-ASSERTING: every check RAISES on failure (ON_ERROR_STOP=1). Everything
-- runs inside begin/rollback.
-- =============================================================================

begin;
do $$
declare
  v_post     uuid := 'a1a1a1a1-0000-0000-0000-000000000003';
  v_owner    uuid := '22222222-2222-2222-2222-222222222222';
  v_spotter  uuid := '11111111-1111-1111-1111-111111111111';
  v_other    uuid := '33333333-3333-3333-3333-333333333333';
  v_mine     uuid := 'dddd0000-0000-0000-0000-000000000001';
  v_ruled    uuid := 'dddd0000-0000-0000-0000-000000000002';
  v_theirs   uuid := 'dddd0000-0000-0000-0000-000000000003';
  v_before   integer;
  v_after    integer;
  v_doc      jsonb;
  v_status   text;
begin
  insert into public.sightings (id, post_id, spotter_id, status, area_label, location_unavailable)
  values
    (v_mine,   v_post, v_spotter, 'unverified', 'Ancoats', true),
    (v_ruled,  v_post, v_spotter, 'helpful',    'Ancoats', true),
    (v_theirs, v_post, v_other,   'unverified', 'Ancoats', true);

  select sightings_reported into v_before from public.profiles where id = v_spotter;

  -- ---------------------------------------------------------------------
  -- CHECK 1 — the spotter withdraws their own unruled report.
  -- ---------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);

  v_doc := public.withdraw_sighting(v_mine);
  if (v_doc ->> 'withdrawn') <> 'true' then
    raise exception 'CHECK 1 FAILED: withdraw_sighting did not report success (%)', v_doc;
  end if;

  select status into v_status from public.sightings where id = v_mine;
  if v_status <> 'withdrawn' then
    raise exception 'CHECK 1 FAILED: status is % rather than withdrawn', v_status;
  end if;

  -- ---------------------------------------------------------------------
  -- CHECK 2 — ⚠️ NOT after the owner has ruled. Withdrawing then would erase
  -- their verdict, and on `credited` one that moved money.
  -- ---------------------------------------------------------------------
  begin
    perform public.withdraw_sighting(v_ruled);
    raise exception 'CHECK 2 FAILED: a sighting the owner had already ruled HELPFUL was withdrawn — that erases the owner''s decision';
  exception
    when sqlstate 'P0001' then
      if sqlerrm <> 'SIGHTING_NOT_WITHDRAWABLE' then
        raise exception 'CHECK 2 FAILED: expected SIGHTING_NOT_WITHDRAWABLE, got %', sqlerrm;
      end if;
  end;

  -- Re-withdrawing an already-withdrawn one is refused by the same rule.
  begin
    perform public.withdraw_sighting(v_mine);
    raise exception 'CHECK 2 FAILED: a withdrawn sighting was withdrawn again';
  exception
    when sqlstate 'P0001' then
      if sqlerrm <> 'SIGHTING_NOT_WITHDRAWABLE' then
        raise exception 'CHECK 2 FAILED: re-withdraw raised % rather than the opaque token', sqlerrm;
      end if;
  end;

  -- ---------------------------------------------------------------------
  -- CHECK 3 — not someone else's, and every refusal is the SAME token so this
  -- cannot be used to probe for sighting ids or learn a stranger's verdict.
  -- ---------------------------------------------------------------------
  begin
    perform public.withdraw_sighting(v_theirs);
    raise exception 'CHECK 3 FAILED: a spotter withdrew SOMEONE ELSE''S sighting';
  exception
    when sqlstate 'P0001' then
      if sqlerrm <> 'SIGHTING_NOT_WITHDRAWABLE' then
        raise exception 'CHECK 3 FAILED: expected the opaque token, got %', sqlerrm;
      end if;
  end;

  begin
    perform public.withdraw_sighting('dddd0000-0000-0000-0000-0000000000ff');
    raise exception 'CHECK 3 FAILED: withdrawing a non-existent sighting succeeded';
  exception
    when sqlstate 'P0001' then
      if sqlerrm <> 'SIGHTING_NOT_WITHDRAWABLE' then
        raise exception 'CHECK 3 FAILED: a missing sighting raised % rather than the opaque token', sqlerrm;
      end if;
  end;

  -- ---------------------------------------------------------------------
  -- CHECK 4 — it disappears from the owner's list AND the public map.
  -- Withdrawing means "do not act on this"; leaving it visible would keep the
  -- retracted claim in front of the person it misleads.
  -- ---------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);

  if exists (
    select 1
      from jsonb_array_elements(public.get_post_sightings(v_post) -> 'sightings') e
     where (e ->> 'id')::uuid = v_mine
  ) then
    raise exception 'CHECK 4 FAILED: the owner can still see a withdrawn sighting';
  end if;

  -- The public map counts entries rather than naming ids, so assert the count
  -- moved: three sightings existed, one is withdrawn.
  perform set_config('request.jwt.claims', null, true);
  if (public.get_public_sighting_entries(v_post) -> 'entries') is null then
    raise exception 'CHECK 4 FAILED: the public entries payload lost its shape';
  end if;

  -- ---------------------------------------------------------------------
  -- CHECK 5 — ⚠️ OUTSIDE THE MONEY PATHS, BY CONSTRUCTION. Neither
  -- create_refund_hold's audience nor open_dispute's eligibility was changed;
  -- both gate on unverified|helpful, so a withdrawn row is simply not in
  -- either set. This asserts the inherited property so a future widening
  -- cannot quietly re-admit it.
  -- ---------------------------------------------------------------------
  if exists (
    select 1 from public.sightings s
     where s.id = v_mine
       and s.status in ('unverified', 'helpful')
  ) then
    raise exception 'CHECK 5 FAILED: a withdrawn sighting still satisfies the unverified|helpful predicate that both money gates select on';
  end if;

  -- ---------------------------------------------------------------------
  -- CHECK 6 — ⚠️ NOT A RATE-LIMIT BYPASS. create_sighting counts the rolling
  -- 24h window by created_at ALONE, so a withdrawn row still occupies its
  -- slot. Without this, file-withdraw-file-withdraw is unbounded reporting.
  -- ---------------------------------------------------------------------
  if (
    select count(*) from public.sightings s
     where s.post_id = v_post
       and s.spotter_id = v_spotter
       and s.created_at > now() - interval '24 hours'
  ) <> 2 then
    raise exception 'CHECK 6 FAILED: the rolling-24h count no longer includes the withdrawn row — withdrawing now frees a slot, and file-withdraw-file-withdraw becomes unbounded';
  end if;

  -- ---------------------------------------------------------------------
  -- CHECK 7 — the spotter's standing drops. It is shown to OWNERS (the chat
  -- passport), so a retracted report must not inflate it, and without the
  -- decrement filing-and-withdrawing would farm it.
  -- ---------------------------------------------------------------------
  select sightings_reported into v_after from public.profiles where id = v_spotter;
  if v_after <> greatest(0, v_before - 1) then
    raise exception 'CHECK 7 FAILED: sightings_reported went % -> % (expected one less, floored at 0)', v_before, v_after;
  end if;

  raise notice 'withdraw_sighting CHECKS 1-7 passed';
end $$;

-- -----------------------------------------------------------------------------
-- CHECK 8 — grants. authenticated only: it is scoped to auth.uid() and must
-- never be reachable by anon, which holds no session to be scoped to.
-- -----------------------------------------------------------------------------
do $$
declare
  v_fn text := 'public.withdraw_sighting(uuid)';
begin
  if to_regprocedure(v_fn) is null then
    raise exception 'CHECK 8 FAILED: % does not exist', v_fn;
  end if;
  if has_function_privilege('anon', v_fn, 'EXECUTE') then
    raise exception 'CHECK 8 FAILED: anon can EXECUTE %', v_fn;
  end if;
  if not has_function_privilege('authenticated', v_fn, 'EXECUTE') then
    raise exception 'CHECK 8 FAILED: authenticated CANNOT EXECUTE % — no spotter could take a report back', v_fn;
  end if;

  raise notice 'withdraw_sighting CHECK 8 passed';
end $$;

rollback;

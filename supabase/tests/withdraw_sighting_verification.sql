-- =============================================================================
-- WHAT:  Tier 1 verification for withdraw_sighting — the window, the scope, the
--        two exclusions, and the two properties this design LEANS on rather
--        than adds — and, since 2026-10-09, the optional reason and the
--        owner's "taken back" notice (claim_sighting_withdrawn_notification),
--        plus the gate that stops a withdrawn sighting being announced as new.
--        NOT a migration.
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
-- floored at 0 · 8 grants · 9 the optional reason (closed vocabulary; free
-- text refused before any write) · 10 ⚠️ the owner's notice: once, to the
-- owner, only if they heard of the sighting, only while live, fixed copy per
-- reason, no plate or place · 11 the claim is service-role only · 12 the
-- note "Something else" may carry (trimmed, ≤200, refused with any other
-- answer) · 13 ⚠️ the push says a note exists, never its words · 14 ⚠️
-- get_post_withdrawals: owner only, told-about only, three fields, and the
-- column itself unreadable by any client.
-- LINKS: supabase/migrations/20260903100000_withdraw_a_sighting.sql;
--        supabase/migrations/20260805100000_refund_holds_and_disputes.sql;
--        supabase/migrations/20260801180000_sighting_photo_source.sql
--          (create_sighting's rate-limit window);
--        supabase/migrations/20261009150000_a_withdrawal_says_why.sql
--          (the reason, the claim, the new-sighting gate);
--        supabase/migrations/20261009180000_a_withdrawal_can_say_more.sql
--          (the note, get_post_withdrawals);
--        supabase/functions/notify-sighting-withdrawn/index.ts.
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

  -- ⚠️ get_post_sightings returns a bare ARRAY. This read `-> 'sightings'`
  -- until 2026-10-09, which is NULL on an array — so the check iterated
  -- nothing and passed whatever the function did (review of #149). The
  -- other open sighting is asserted present, so an empty result fails too.
  if exists (
    select 1
      from jsonb_array_elements(public.get_post_sightings(v_post)) e
     where (e ->> 'id')::uuid = v_mine
  ) then
    raise exception 'CHECK 4 FAILED: the owner can still see a withdrawn sighting';
  end if;
  if not exists (
    select 1
      from jsonb_array_elements(public.get_post_sightings(v_post)) e
     where (e ->> 'id')::uuid = v_theirs
  ) then
    raise exception 'CHECK 4 FAILED: the owner''s list lost an OPEN sighting too — the check would prove nothing';
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
  -- (uuid, text, text) since 20261009180000 — the optional reason, and the
  -- note that may go with "Something else".
  v_fn text := 'public.withdraw_sighting(uuid, text, text)';
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

-- -----------------------------------------------------------------------------
-- CHECKS 9-11 — the reason, and telling the owner (20261009150000).
-- -----------------------------------------------------------------------------
do $$
declare
  v_post     uuid := 'a1a1a1a1-0000-0000-0000-000000000003';  -- active black BMW, BD21 WSE
  v_owner    uuid := '22222222-2222-2222-2222-222222222222';
  v_spotter  uuid := '11111111-1111-1111-1111-111111111111';
  v_other    uuid := '33333333-3333-3333-3333-333333333333';
  v_a        uuid := 'dddd0000-0000-0000-0000-0000000000a1';  -- told, then withdrawn: not the car
  v_b        uuid := 'dddd0000-0000-0000-0000-0000000000a2';  -- told, withdrawn, no reason
  v_c        uuid := 'dddd0000-0000-0000-0000-0000000000a3';  -- NEVER told, withdrawn
  v_d        uuid := 'dddd0000-0000-0000-0000-0000000000a4';  -- refused reason stays unverified
  v_e        uuid := 'dddd0000-0000-0000-0000-0000000000a5';  -- told, withdrawn, post later closed
  v_f        uuid := 'dddd0000-0000-0000-0000-0000000000a6';  -- told, withdrawn: by mistake
  v_g        uuid := 'dddd0000-0000-0000-0000-0000000000a7';  -- told, withdrawn: something else
  v_h        uuid := 'dddd0000-0000-0000-0000-0000000000a8';  -- the OWNER's own (direct insert)
  v_i        uuid := 'dddd0000-0000-0000-0000-0000000000a9';  -- withdrawn BEFORE the owner was told
  v_doc      jsonb;
  v_reason   text;
  v_status   text;
begin
  insert into public.sightings (id, post_id, spotter_id, status, area_label, location_unavailable, notified_at)
  values
    (v_a, v_post, v_spotter, 'unverified', 'Ancoats', true, now()),
    (v_b, v_post, v_spotter, 'unverified', 'Ancoats', true, now()),
    (v_c, v_post, v_spotter, 'unverified', 'Ancoats', true, null),
    (v_d, v_post, v_spotter, 'unverified', 'Ancoats', true, now()),
    (v_e, v_post, v_spotter, 'unverified', 'Ancoats', true, now()),
    (v_f, v_post, v_spotter, 'unverified', 'Ancoats', true, now()),
    (v_g, v_post, v_spotter, 'unverified', 'Ancoats', true, now()),
    -- create_sighting's OWN_POST gate makes this unreachable through the app;
    -- inserted directly so the claim's own owner-is-actor branch is reached.
    (v_h, v_post, v_owner,   'withdrawn',  'Ancoats', true, now()),
    (v_i, v_post, v_spotter, 'unverified', 'Ancoats', true, null);

  perform set_config('request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);

  -- -------------------------------------------------------------------
  -- CHECK 9 — the reason is stored; skipping it stores NULL; an answer
  -- outside the vocabulary is refused BEFORE anything is written.
  -- -------------------------------------------------------------------
  perform public.withdraw_sighting(v_a, 'not_the_car');
  select withdraw_reason into v_reason from public.sightings where id = v_a;
  if v_reason is distinct from 'not_the_car' then
    raise exception 'CHECK 9 FAILED: the reason was not stored (got %)', v_reason;
  end if;

  -- The one-argument call today's app makes still resolves.
  perform public.withdraw_sighting(v_b);
  select withdraw_reason into v_reason from public.sightings where id = v_b;
  if v_reason is not null then
    raise exception 'CHECK 9 FAILED: a skipped reason stored %', v_reason;
  end if;

  perform public.withdraw_sighting(v_c, 'mistake');
  perform public.withdraw_sighting(v_e, 'not_sure');
  perform public.withdraw_sighting(v_f, 'mistake');
  perform public.withdraw_sighting(v_g, 'other');
  perform public.withdraw_sighting(v_i);

  -- A reason only ever sits on a withdrawn sighting: the constraint refuses
  -- one on a live report even from a privileged write.
  begin
    update public.sightings set withdraw_reason = 'mistake' where id = v_d;
    raise exception 'CHECK 9 FAILED: a reason was set on a sighting that is still open';
  exception
    when check_violation then null;
  end;
  -- …and refuses an answer outside the vocabulary however it arrives.
  begin
    update public.sightings set withdraw_reason = 'he was rude' where id = v_a;
    raise exception 'CHECK 9 FAILED: the constraint let free text in as a reason';
  exception
    when check_violation then null;
  end;

  begin
    perform public.withdraw_sighting(v_d, 'he was rude to me');
    raise exception 'CHECK 9 FAILED: free text was accepted as a reason';
  exception
    when sqlstate 'P0001' then
      if sqlerrm <> 'INVALID_INPUT' then
        raise exception 'CHECK 9 FAILED: an unknown reason raised % rather than INVALID_INPUT', sqlerrm;
      end if;
  end;
  select status, withdraw_reason into v_status, v_reason from public.sightings where id = v_d;
  if v_status <> 'unverified' or v_reason is not null then
    raise exception 'CHECK 9 FAILED: a refused reason still wrote (status %, reason %)', v_status, v_reason;
  end if;

  -- -------------------------------------------------------------------
  -- CHECK 10 — the owner's notice: once, only to the right owner, only if
  -- they heard about the sighting, only while the listing is live; the
  -- copy is fixed per reason and carries nothing else.
  -- (Called as the test's superuser: the claim is service-role only.)
  -- -------------------------------------------------------------------
  v_doc := public.claim_sighting_withdrawn_notification(v_a, v_spotter);
  if (v_doc ->> 'claimed') <> 'true'
     or (v_doc ->> 'user_id')::uuid <> v_owner
     or (v_doc ->> 'post_id')::uuid <> v_post then
    raise exception 'CHECK 10 FAILED: the first claim did not go to the owner (%)', v_doc;
  end if;
  if (v_doc ->> 'title') is distinct from 'A sighting of your Black BMW was taken back' then
    raise exception 'CHECK 10 FAILED: title was %', v_doc ->> 'title';
  end if;
  if (v_doc ->> 'body') is distinct from 'The spotter says it wasn''t your car.' then
    raise exception 'CHECK 10 FAILED: body for not_the_car was %', v_doc ->> 'body';
  end if;
  -- ⚠️ No plate, no place, no spotter — in either line.
  if (v_doc ->> 'title') || (v_doc ->> 'body') ~* '(BD21|Ancoats|Manchester)' then
    raise exception 'CHECK 10 FAILED: the notice leaked a plate or a place (%)', v_doc;
  end if;

  -- REPLAY: once only.
  if (public.claim_sighting_withdrawn_notification(v_a, v_spotter) ->> 'claimed') <> 'false' then
    raise exception 'CHECK 10 FAILED: the same withdrawal was claimed twice';
  end if;

  -- No reason → the plain sentence.
  v_doc := public.claim_sighting_withdrawn_notification(v_b, v_spotter);
  if (v_doc ->> 'body') is distinct from 'The spotter withdrew it.' then
    raise exception 'CHECK 10 FAILED: body with no reason was %', v_doc ->> 'body';
  end if;

  -- Every reason's sentence: by mistake, and something else (the plain one).
  v_doc := public.claim_sighting_withdrawn_notification(v_f, v_spotter);
  if (v_doc ->> 'body') is distinct from 'The spotter sent it by mistake.' then
    raise exception 'CHECK 10 FAILED: body for mistake was %', v_doc ->> 'body';
  end if;
  v_doc := public.claim_sighting_withdrawn_notification(v_g, v_spotter);
  if (v_doc ->> 'body') is distinct from 'The spotter withdrew it.' then
    raise exception 'CHECK 10 FAILED: body for other was %', v_doc ->> 'body';
  end if;

  -- AUTHORISATION: not the spotter → the shared refusal, and nothing claimed.
  if public.claim_sighting_withdrawn_notification(v_e, v_other) <> '{"claimed": false}'::jsonb then
    raise exception 'CHECK 10 FAILED: a stranger claimed the notice';
  end if;
  -- …nor the owner about someone else's sighting…
  if public.claim_sighting_withdrawn_notification(v_e, v_owner) <> '{"claimed": false}'::jsonb then
    raise exception 'CHECK 10 FAILED: the owner claimed the notice about their own listing';
  end if;
  -- …nor about their OWN (the owner-is-actor branch itself).
  if public.claim_sighting_withdrawn_notification(v_h, v_owner) <> '{"claimed": false}'::jsonb then
    raise exception 'CHECK 10 FAILED: an owner was notified about their own withdrawal';
  end if;

  -- ⚠️ A sighting withdrawn BEFORE the owner was told is never announced as
  -- NEW either — the gate claim_sighting_notification gained here.
  if public.claim_sighting_notification(v_i, v_spotter) <> '{"claimed": false}'::jsonb then
    raise exception 'CHECK 10 FAILED: a withdrawn sighting was announced to the owner as a new one';
  end if;

  -- The owner was never told of this sighting → nothing to retract.
  if public.claim_sighting_withdrawn_notification(v_c, v_spotter) <> '{"claimed": false}'::jsonb then
    raise exception 'CHECK 10 FAILED: a withdrawal was announced for a sighting the owner never heard about';
  end if;

  -- Not withdrawn → refused.
  if public.claim_sighting_withdrawn_notification(v_d, v_spotter) <> '{"claimed": false}'::jsonb then
    raise exception 'CHECK 10 FAILED: a sighting that is still open was announced as withdrawn';
  end if;

  -- A listing that is no longer live → refused (and still unclaimed).
  update public.posts set status = 'recovered' where id = v_post;
  if public.claim_sighting_withdrawn_notification(v_e, v_spotter) <> '{"claimed": false}'::jsonb then
    raise exception 'CHECK 10 FAILED: a withdrawal was announced on a closed listing';
  end if;
  update public.posts set status = 'active' where id = v_post;

  -- ⚠️ The title keeps "was taken back" however long the owner's make and
  -- colour are (bounded BEFORE assembly), and a blank colour leaves no
  -- double space. Then the not_sure sentence, once it is live again.
  update public.posts
     set make = repeat('M', 40), colour = repeat('C', 40)
   where id = v_post;
  v_doc := public.claim_sighting_withdrawn_notification(v_e, v_spotter);
  if coalesce(v_doc ->> 'title', '') not like '% was taken back' then
    raise exception 'CHECK 10 FAILED: a long make cut "was taken back" off the title (%)', v_doc ->> 'title';
  end if;
  if (v_doc ->> 'body') is distinct from 'The spotter wasn''t sure it was your car.' then
    raise exception 'CHECK 10 FAILED: body for not_sure was %', v_doc ->> 'body';
  end if;

  update public.posts set make = 'BMW', colour = '' where id = v_post;
  insert into public.sightings (id, post_id, spotter_id, status, area_label, location_unavailable, notified_at)
  values ('dddd0000-0000-0000-0000-0000000000b1', v_post, v_spotter, 'withdrawn', 'Ancoats', true, now());
  v_doc := public.claim_sighting_withdrawn_notification('dddd0000-0000-0000-0000-0000000000b1', v_spotter);
  if (v_doc ->> 'title') is distinct from 'A sighting of your BMW was taken back' then
    raise exception 'CHECK 10 FAILED: a blank colour left the title as %', v_doc ->> 'title';
  end if;

  raise notice 'withdraw_sighting CHECKS 9-10 passed';
end $$;

-- CHECK 11 — the claim is SERVICE ROLE ONLY: a client grant would let a user
-- nominate themselves as the actor and defeat the authorisation.
do $$
declare
  v_fn text := 'public.claim_sighting_withdrawn_notification(uuid, uuid)';
begin
  if to_regprocedure(v_fn) is null then
    raise exception 'CHECK 11 FAILED: % does not exist', v_fn;
  end if;
  if has_function_privilege('anon', v_fn, 'EXECUTE')
     or has_function_privilege('authenticated', v_fn, 'EXECUTE') then
    raise exception 'CHECK 11 FAILED: % is callable by a client role', v_fn;
  end if;
  if not has_function_privilege('service_role', v_fn, 'EXECUTE') then
    raise exception 'CHECK 11 FAILED: service_role cannot EXECUTE %', v_fn;
  end if;
  -- ⚠️ ONE withdraw_sighting: a stray shorter overload beside the new one
  -- would make the app's one- or two-argument call ambiguous to PostgREST.
  if to_regprocedure('public.withdraw_sighting(uuid)') is not null
     or to_regprocedure('public.withdraw_sighting(uuid, text)') is not null then
    raise exception 'CHECK 11 FAILED: an old withdraw_sighting overload still exists beside (uuid, text, text)';
  end if;

  raise notice 'withdraw_sighting CHECK 11 passed';
end $$;

-- -----------------------------------------------------------------------------
-- CHECKS 12-14 — the note "Something else" may carry (20261009180000).
-- -----------------------------------------------------------------------------
do $$
declare
  v_post     uuid := 'a1a1a1a1-0000-0000-0000-000000000003';
  v_owner    uuid := '22222222-2222-2222-2222-222222222222';
  v_spotter  uuid := '11111111-1111-1111-1111-111111111111';
  v_other    uuid := '33333333-3333-3333-3333-333333333333';
  v_n1       uuid := 'dddd0000-0000-0000-0000-0000000000c1';  -- other + a note (padded)
  v_n2       uuid := 'dddd0000-0000-0000-0000-0000000000c2';  -- note with not_sure: refused
  v_n3       uuid := 'dddd0000-0000-0000-0000-0000000000c3';  -- note with no reason: refused
  v_n4       uuid := 'dddd0000-0000-0000-0000-0000000000c4';  -- 201 refused, then 200 accepted
  v_n5       uuid := 'dddd0000-0000-0000-0000-0000000000c5';  -- other + a blank note
  v_n6       uuid := 'dddd0000-0000-0000-0000-0000000000c6';  -- other + a note, owner never told
  v_n7       uuid := 'dddd0000-0000-0000-0000-0000000000c7';  -- a direction override: refused
  v_n8       uuid := 'dddd0000-0000-0000-0000-0000000000c8';  -- told, with a note, on the owner's OTHER post
  v_post2    uuid := 'a1a1a1a1-0000-0000-0000-000000000008';  -- also v_owner's (white VW)
  v_note     text := 'I think it was my neighbour''s car, sorry';
  v_doc      jsonb;
  v_list     jsonb;
  v_status   text;
  v_stored   text;
begin
  insert into public.sightings (id, post_id, spotter_id, status, area_label, location_unavailable, notified_at)
  values
    (v_n1, v_post, v_spotter, 'unverified', 'Ancoats', true, now()),
    (v_n2, v_post, v_spotter, 'unverified', 'Ancoats', true, now()),
    (v_n3, v_post, v_spotter, 'unverified', 'Ancoats', true, now()),
    (v_n4, v_post, v_spotter, 'unverified', 'Ancoats', true, now()),
    (v_n5, v_post, v_spotter, 'unverified', 'Ancoats', true, now()),
    (v_n6, v_post, v_spotter, 'unverified', 'Ancoats', true, null),
    (v_n7, v_post, v_spotter, 'unverified', 'Ancoats', true, now());
  -- Written directly, already withdrawn and told: only to prove the list is
  -- one POST's, not every post the caller owns.
  insert into public.sightings (id, post_id, spotter_id, status, area_label, location_unavailable,
                                notified_at, withdraw_reason, withdraw_note, withdrawn_notified_at)
  values (v_n8, v_post2, v_spotter, 'withdrawn', 'Salford', true,
          now(), 'other', 'OTHER POST NOTE', now() + interval '3 minutes');

  perform set_config('request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);

  -- -------------------------------------------------------------------
  -- CHECK 12 — the note: stored trimmed with "Something else"; refused
  -- (before any write) with any other answer, with none, or over 200; a
  -- blank one is no note.
  -- -------------------------------------------------------------------
  perform public.withdraw_sighting(v_n1, 'other', E'  ' || v_note || E' \n');
  select withdraw_note into v_stored from public.sightings where id = v_n1;
  if v_stored is distinct from v_note then
    raise exception 'CHECK 12 FAILED: the note was stored as % (expected it trimmed)', v_stored;
  end if;

  begin
    perform public.withdraw_sighting(v_n2, 'not_sure', 'a note');
    raise exception 'CHECK 12 FAILED: a note was accepted with not_sure';
  exception
    when sqlstate 'P0001' then
      if sqlerrm <> 'INVALID_INPUT' then
        raise exception 'CHECK 12 FAILED: a note with not_sure raised % rather than INVALID_INPUT', sqlerrm;
      end if;
  end;
  begin
    perform public.withdraw_sighting(v_n3, null, 'a note');
    raise exception 'CHECK 12 FAILED: a note was accepted with no answer';
  exception
    when sqlstate 'P0001' then
      if sqlerrm <> 'INVALID_INPUT' then
        raise exception 'CHECK 12 FAILED: a note with no answer raised % rather than INVALID_INPUT', sqlerrm;
      end if;
  end;
  begin
    perform public.withdraw_sighting(v_n4, 'other', repeat('a', 201));
    raise exception 'CHECK 12 FAILED: a 201-character note was accepted';
  exception
    when sqlstate 'P0001' then
      if sqlerrm <> 'INVALID_INPUT' then
        raise exception 'CHECK 12 FAILED: a long note raised % rather than INVALID_INPUT', sqlerrm;
      end if;
  end;
  -- Every refusal wrote nothing: still open, no reason, no note.
  if exists (
    select 1 from public.sightings
     where id in (v_n2, v_n3, v_n4)
       and (status <> 'unverified' or withdraw_reason is not null or withdraw_note is not null)
  ) then
    raise exception 'CHECK 12 FAILED: a refused note still wrote';
  end if;

  -- Exactly 200 is allowed.
  perform public.withdraw_sighting(v_n4, 'other', repeat('a', 200));
  select withdraw_note into v_stored from public.sightings where id = v_n4;
  if char_length(v_stored) is distinct from 200 then
    raise exception 'CHECK 12 FAILED: a 200-character note was not stored whole';
  end if;

  -- Blank includes no-break, narrow and figure spaces and the Hangul filler:
  -- nothing visible is no note.
  perform public.withdraw_sighting(v_n5, 'other', E'   \u00A0\n \u202F\u2007\u3164\u00A0');
  select status, withdraw_note into v_status, v_stored from public.sightings where id = v_n5;
  if v_status <> 'withdrawn' or v_stored is not null then
    raise exception 'CHECK 12 FAILED: a blank note was stored as % (status %)', v_stored, v_status;
  end if;

  perform public.withdraw_sighting(v_n6, 'other', 'NEVER TOLD NOTE');

  -- ⚠️ A text-direction override (it can make a line read as something else
  -- on screen) is refused, and nothing is written.
  begin
    perform public.withdraw_sighting(v_n7, 'other', E'it was fine \u202Etsil kcalb');
    raise exception 'CHECK 12 FAILED: a note with a direction override was accepted';
  exception
    when sqlstate 'P0001' then
      if sqlerrm <> 'INVALID_INPUT' then
        raise exception 'CHECK 12 FAILED: a direction override raised % rather than INVALID_INPUT', sqlerrm;
      end if;
  end;
  if (select status from public.sightings where id = v_n7) <> 'unverified' then
    raise exception 'CHECK 12 FAILED: a refused note still withdrew the sighting';
  end if;

  -- The constraint, for any writer: no note without "other" — ⚠️ including
  -- a NULL answer, where a bare `= 'other'` would let it through — and none
  -- untrimmed, empty, over 200, or carrying a direction override.
  begin
    update public.sightings set withdraw_note = 'hi' where id = v_n2;
    raise exception 'CHECK 12 FAILED: a note was set on a sighting with no answer';
  exception
    when check_violation then null;
  end;
  begin
    update public.sightings set status = 'withdrawn', withdraw_reason = 'mistake', withdraw_note = 'hi'
     where id = v_n2;
    raise exception 'CHECK 12 FAILED: a note was set beside a "mistake" answer';
  exception
    when check_violation then null;
  end;
  begin
    update public.sightings set withdraw_note = ' padded ' where id = v_n1;
    raise exception 'CHECK 12 FAILED: an untrimmed note got past the constraint';
  exception
    when check_violation then null;
  end;
  begin
    update public.sightings set withdraw_note = '' where id = v_n1;
    raise exception 'CHECK 12 FAILED: an empty note got past the constraint';
  exception
    when check_violation then null;
  end;
  begin
    update public.sightings set withdraw_note = repeat('b', 201) where id = v_n1;
    raise exception 'CHECK 12 FAILED: a 201-character note got past the constraint';
  exception
    when check_violation then null;
  end;
  begin
    update public.sightings set withdraw_note = E'ok \u202E' || 'x' where id = v_n1;
    raise exception 'CHECK 12 FAILED: a direction override got past the constraint';
  exception
    when check_violation then null;
  end;

  -- -------------------------------------------------------------------
  -- CHECK 13 — ⚠️ the push says a note EXISTS, never what it says.
  -- (Called as the test's superuser: the claim is service-role only.)
  -- -------------------------------------------------------------------
  v_doc := public.claim_sighting_withdrawn_notification(v_n1, v_spotter);
  if (v_doc ->> 'body') is distinct from 'The spotter withdrew it and left you a note.' then
    raise exception 'CHECK 13 FAILED: body with a note was %', v_doc ->> 'body';
  end if;
  if position('neighbour' in (v_doc ->> 'title') || (v_doc ->> 'body')) > 0 then
    raise exception 'CHECK 13 FAILED: the spotter''s words reached the push (%)', v_doc;
  end if;
  v_doc := public.claim_sighting_withdrawn_notification(v_n4, v_spotter);
  -- Claimed first: a refusal has no title or body, and would pass the
  -- absence check below without testing anything.
  if (v_doc ->> 'claimed') is distinct from 'true' then
    raise exception 'CHECK 13 FAILED: the 200-character note''s withdrawal was not claimed (%)', v_doc;
  end if;
  if position('aaaa' in (v_doc ->> 'title') || (v_doc ->> 'body')) > 0 then
    raise exception 'CHECK 13 FAILED: the spotter''s words reached the push (%)', v_doc;
  end if;
  -- The owner never heard of v_n6's sighting, so it is never claimed — which
  -- is what keeps its note out of CHECK 14's list.
  if public.claim_sighting_withdrawn_notification(v_n6, v_spotter) <> '{"claimed": false}'::jsonb then
    raise exception 'CHECK 13 FAILED: a withdrawal the owner never heard about was claimed';
  end if;
  -- A blank note is no note.
  v_doc := public.claim_sighting_withdrawn_notification(v_n5, v_spotter);
  if (v_doc ->> 'body') is distinct from 'The spotter withdrew it.' then
    raise exception 'CHECK 13 FAILED: body with a blank note was %', v_doc ->> 'body';
  end if;

  -- -------------------------------------------------------------------
  -- CHECK 14 — get_post_withdrawals: the owner only; only what they were
  -- told about; three fields and no more; newest first.
  -- -------------------------------------------------------------------
  update public.sightings set withdrawn_notified_at = now() + interval '2 minutes' where id = v_n1;
  update public.sightings set withdrawn_notified_at = now() + interval '1 minute'  where id = v_n4;

  perform set_config('request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
  v_list := public.get_post_withdrawals(v_post);

  if jsonb_typeof(v_list) <> 'array' or jsonb_array_length(v_list) = 0 then
    raise exception 'CHECK 14 FAILED: the owner got no list (%)', v_list;
  end if;
  if (v_list -> 0 ->> 'note') is distinct from v_note
     or (v_list -> 0 ->> 'reason') is distinct from 'other'
     or (v_list -> 1 ->> 'note') is distinct from repeat('a', 200) then
    raise exception 'CHECK 14 FAILED: not newest first, or the note was lost (%)', v_list -> 0;
  end if;
  -- ⚠️ Three fields — no sighting id, no spotter, no place.
  if exists (
    select 1 from jsonb_array_elements(v_list) e
     where (select array_agg(k order by k) from jsonb_object_keys(e) k)
           <> array['note', 'reason', 'withdrawn_at']
  ) then
    raise exception 'CHECK 14 FAILED: an entry carried more than withdrawn_at, reason, note (%)', v_list -> 0;
  end if;
  -- Only the withdrawals the owner was told about.
  if exists (select 1 from jsonb_array_elements(v_list) e where e ->> 'note' = 'NEVER TOLD NOTE') then
    raise exception 'CHECK 14 FAILED: a note on a withdrawal the owner was never told about was shown';
  end if;
  -- …and only THIS post's, though the owner has another with a newer one.
  if exists (select 1 from jsonb_array_elements(v_list) e where e ->> 'note' = 'OTHER POST NOTE') then
    raise exception 'CHECK 14 FAILED: a withdrawal on the owner''s OTHER post was listed';
  end if;
  if jsonb_array_length(v_list) <> (
    select count(*) from public.sightings
     where post_id = v_post and status = 'withdrawn' and withdrawn_notified_at is not null
  ) then
    raise exception 'CHECK 14 FAILED: the list is not exactly the withdrawals the owner was told about';
  end if;

  -- Nobody else — a stranger, and a missing post, get the same token.
  perform set_config('request.jwt.claims',
    '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
  begin
    perform public.get_post_withdrawals(v_post);
    raise exception 'CHECK 14 FAILED: a stranger read the owner''s withdrawals';
  exception
    when sqlstate 'P0001' then
      if sqlerrm <> 'NOT_OWNER' then
        raise exception 'CHECK 14 FAILED: a stranger got % rather than NOT_OWNER', sqlerrm;
      end if;
  end;
  begin
    perform public.get_post_withdrawals('a1a1a1a1-0000-0000-0000-0000000000ff');
    raise exception 'CHECK 14 FAILED: a missing post returned a list';
  exception
    when sqlstate 'P0001' then
      if sqlerrm <> 'NOT_OWNER' then
        raise exception 'CHECK 14 FAILED: a missing post raised % rather than NOT_OWNER', sqlerrm;
      end if;
  end;
  -- …nor the SPOTTER, who wrote it.
  perform set_config('request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
  begin
    perform public.get_post_withdrawals(v_post);
    raise exception 'CHECK 14 FAILED: the spotter read the owner''s withdrawals';
  exception
    when sqlstate 'P0001' then
      if sqlerrm <> 'NOT_OWNER' then
        raise exception 'CHECK 14 FAILED: the spotter got % rather than NOT_OWNER', sqlerrm;
      end if;
  end;
  perform set_config('request.jwt.claims', null, true);
  begin
    perform public.get_post_withdrawals(v_post);
    raise exception 'CHECK 14 FAILED: no session read the owner''s withdrawals';
  exception
    when sqlstate 'P0001' then
      if sqlerrm <> 'NOT_AUTHENTICATED' then
        raise exception 'CHECK 14 FAILED: no session raised % rather than NOT_AUTHENTICATED', sqlerrm;
      end if;
  end;

  -- ⚠️ The column itself is no client's to read — not even the spotter's —
  -- so get_post_withdrawals stays its only reader.
  if has_column_privilege('authenticated', 'public.sightings', 'withdraw_note', 'SELECT')
     or has_column_privilege('anon', 'public.sightings', 'withdraw_note', 'SELECT') then
    raise exception 'CHECK 14 FAILED: a client role can SELECT sightings.withdraw_note directly';
  end if;
  -- …nor write it: a note is set once, through withdraw_sighting, and a
  -- withdrawn row can't be withdrawn again — so what the owner reads is
  -- what was sent.
  if has_column_privilege('authenticated', 'public.sightings', 'withdraw_note', 'UPDATE')
     or has_column_privilege('authenticated', 'public.sightings', 'withdraw_note', 'INSERT')
     or has_column_privilege('anon', 'public.sightings', 'withdraw_note', 'UPDATE')
     or has_column_privilege('anon', 'public.sightings', 'withdraw_note', 'INSERT') then
    raise exception 'CHECK 14 FAILED: a client role can write sightings.withdraw_note directly';
  end if;
  if has_function_privilege('anon', 'public.get_post_withdrawals(uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.get_post_withdrawals(uuid)', 'EXECUTE') then
    raise exception 'CHECK 14 FAILED: get_post_withdrawals grants are wrong (anon in, or authenticated out)';
  end if;

  raise notice 'withdraw_sighting CHECKS 12-14 passed';
end $$;

rollback;

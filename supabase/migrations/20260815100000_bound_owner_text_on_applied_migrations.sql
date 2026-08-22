-- =============================================================================
-- WHAT:  Re-states `my_sighting_record` and `claim_sighting_confirmed_notification`
--        with owner-supplied `make`/`colour` bounded to 32 characters and made
--        blank-safe. The bodies here are byte-identical to the ones now sitting
--        in 20260814110000 and 20260814130000.
--
-- WHY:   ⚠️ THIS MIGRATION EXISTS BECAUSE TWO ALREADY-APPLIED MIGRATIONS WERE
--        EDITED IN PLACE, WHICH DOES NOTHING.
--
--        A security review on 2026-08-15 found `posts.make` and `posts.colour`
--        — owner-supplied, with no length CHECK anywhere — being interpolated
--        unbounded into a push body and handed to a different user in an RPC.
--        The fix was applied by editing 20260814110000 and 20260814130000
--        directly. Both had ALREADY been pushed to the hosted dev project
--        (confirmed via `supabase migration list --linked`: both carry a remote
--        timestamp). Supabase runs each version exactly once, so `db push` will
--        never re-run them and the hosted database keeps executing the OLD text
--        forever.
--
--        THE FAILURE MODE IS WHAT MAKES THIS WORTH A BANNER. Every local check
--        passed — `npm run test:db`, a fresh `supabase db reset`, the whole
--        SQL suite — because a reset replays the EDITED files. Green tests, an
--        unpatched remote, and nothing anywhere that disagrees. Editing an
--        applied migration does not fail loudly; it fails silently and looks
--        like success.
--
--        RULE: a migration that has been pushed is immutable. Fix it forward.
--        Editing one is only safe before its first push, and there is no way to
--        tell from the file itself which state it is in — `migration list
--        --linked` is the only source of truth.
--
--        The bug being fixed: an owner sets a 4 KB "make", the notifications
--        row persists it (no length constraint on `body`), and Expo rejects the
--        push with MessageTooBig — so the spotter is simply never told their
--        sighting was confirmed. A NULL or blank colour separately renders
--        "the  Ford." or NULLs the whole sentence, since `||` with NULL is NULL.
-- LINKS: supabase/migrations/20260814110000_sighting_verification_rpcs.sql;
--        supabase/migrations/20260814130000_sighting_confirmed_notification.sql;
--        supabase/migrations/20260806120000_not_credited_notification.sql (the
--          sibling this copies its 32/coalesce/nullif/btrim shape from);
--        docs/SECURITY_AND_TRUST.md §3.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. my_sighting_record — the spotter's own history.
-- -----------------------------------------------------------------------------
create or replace function public.my_sighting_record()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_caller uuid := auth.uid();
  v_rows   jsonb;
begin
  if v_caller is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select coalesce(jsonb_agg(r order by r.created_at desc), '[]'::jsonb)
    into v_rows
  from (
    select s.id,
           s.created_at,
           s.status,
           s.reviewed_at,
           s.area_label,
           -- Bounded at the source. This RPC hands owner-supplied text to a
           -- DIFFERENT user (the spotter); unbounded, one owner's 4 KB "make"
           -- bloats every row of that spotter's history.
           jsonb_build_object(
             'make',   left(coalesce(nullif(btrim(p.make),   ''), ''), 32),
             'colour', left(coalesce(nullif(btrim(p.colour), ''), ''), 32)
           ) as car
      from public.sightings s
      join public.posts p on p.id = s.post_id
     where s.spotter_id = v_caller
  ) as r;

  return jsonb_build_object('sightings', v_rows);
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. claim_sighting_confirmed_notification — the push body.
-- -----------------------------------------------------------------------------
create or replace function public.claim_sighting_confirmed_notification(
  p_sighting_id uuid,
  p_actor       uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id      uuid;
  v_spotter uuid;
  v_make    text;
  v_colour  text;
  v_count   integer;
  v_badge   text;
  v_body    text;
begin
  -- A confirmed sighting on a post the ACTOR owns. Bounded and blank-safe at
  -- the SELECT, not at the concatenation — see the banner.
  select s.id,
         s.spotter_id,
         left(coalesce(nullif(btrim(p.make),   ''), ''), 32),
         left(coalesce(nullif(btrim(p.colour), ''), ''), 32)
    into v_id, v_spotter, v_make, v_colour
    from public.sightings s
    join public.posts p on p.id = s.post_id
   where s.id = p_sighting_id
     and s.status = 'helpful'
     and p.owner_id = p_actor;

  if v_id is null then
    return jsonb_build_object('claimed', false);
  end if;

  -- The conditional update IS the idempotency: of two concurrent calls,
  -- exactly one row comes back.
  update public.sightings
     set confirmed_notified_at = now()
   where id = v_id
     and confirmed_notified_at is null
  returning id into v_id;

  if v_id is null then
    return jsonb_build_object('claimed', false);
  end if;

  -- The badge line, derived not asserted. EXACTLY on a rung or nothing:
  -- landing past one (two confirmations racing this claim) says nothing rather
  -- than something wrong. Labels mirror reputation.ts COUNTER_KINDS exactly.
  select sightings_helpful into v_count
    from public.profiles where id = v_spotter;

  v_badge := case v_count
               when 1  then 'First helpful mark'
               when 5  then '5 helpful marks'
               when 25 then '25 helpful marks'
             end;

  -- The car as the spotter already saw it — no owner identity, no location, no
  -- plate. Collapsed so a missing half cannot produce "the  Ford." or "the .";
  -- both blank is a real state, and "the car" is the honest sentence there.
  v_body := btrim(lower(v_colour) || ' ' || v_make);
  if v_body = '' then
    v_body := 'car';
  end if;
  v_body := 'The owner confirmed your sighting of the ' || v_body || '.';
  if v_badge is not null then
    v_body := v_body || ' That earned you "' || v_badge || '".';
  end if;

  return jsonb_build_object(
    'claimed', true,
    'user_id', v_spotter,
    'sighting_id', v_id,
    'title', 'Your sighting was confirmed',
    'body', v_body
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Assert the bound is actually live, on both.
-- -----------------------------------------------------------------------------
do $$
begin
  if pg_get_functiondef('public.my_sighting_record()'::regprocedure)
       not like '%left(coalesce(nullif(btrim(p.make%' then
    raise exception 'my_sighting_record is not bounding make/colour';
  end if;

  if pg_get_functiondef(
       'public.claim_sighting_confirmed_notification(uuid,uuid)'::regprocedure)
       not like '%left(coalesce(nullif(btrim(p.make%' then
    raise exception 'claim_sighting_confirmed_notification is not bounding make/colour';
  end if;

  raise notice 'owner-supplied make/colour bounded to 32 in both functions.';
end $$;

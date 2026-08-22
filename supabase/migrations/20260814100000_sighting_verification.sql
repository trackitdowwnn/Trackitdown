-- =============================================================================
-- WHAT: The owner's verdict on a sighting becomes a real, recordable thing.
--         1. sightings.status gains 'not_mine'  — "that isn't my car"
--         2. sightings.reviewed_at             — WHEN an owner ruled, at last
--         3. recent_uncredited_sightings       — re-stated as "not credited"
--         4. open_dispute                      — same, and for the same reason
--
-- WHY:  Until now the status allowlist held three values and every one of them
--       was POSITIVE: reported, useful, paid. An owner looking at the wrong
--       silver Golf had no way to say so — to us, to the spotter, or to the
--       next owner weighing that spotter's credibility. Worse, 'unverified'
--       meant both "nobody has looked" and "looked, and no" at once, so the
--       one signal a reputation system most needs — was this person RIGHT —
--       could not be recorded even in principle.
--
--       ⚠️ 3 AND 4 ARE NOT TIDYING. THEY CLOSE A MONEY HOLE THIS MIGRATION
--       WOULD OTHERWISE OPEN. Both functions asked `status in ('unverified',
--       'helpful')` — an allowlist of the states that existed, standing in for
--       the idea "not credited yet". Add a fourth state and that phrasing
--       silently changes meaning:
--
--         · recent_uncredited_sightings is, by its own comment, "THE one
--           definition of sightings that hold up an exit refund" — read by the
--           client pre-flight, create_refund_hold, and both exit Edge
--           Functions. A rejected sighting would fall OUT of it, so an owner
--           could tap "not my car" down the list, face no refund hold at all,
--           and walk away with the bounty. The button meant to record an
--           honest opinion would have become the fastest way to cash out.
--         · open_dispute is the spotter's ONLY recourse. Same predicate, so
--           the same tap that cleared the owner's hold would also have taken
--           away the disputing right of every spotter it cleared it against.
--
--       Both are now stated as `status <> 'credited'`, which is what they
--       always meant. That phrasing also cannot rot: a fifth state inherits
--       the right behaviour instead of silently escaping the net.
--
--       WHY BOTH ARE `create or replace` ON EXISTING FUNCTIONS: they keep
--       their OIDs and therefore their ACLs. (20260813120000 learned this the
--       hard way in the other direction — a `create or replace` on a function
--       that had been DROPPED created it fresh with a default ACL and handed
--       anon EXECUTE on a SECURITY DEFINER RPC.) open_dispute's body below was
--       copied mechanically out of 20260805100000:365-413 and passed through a
--       single substitution; it was not retyped. Diff it: the ONLY change is
--       the status predicate.
--
--       NOTHING IS BACKFILLED. Every existing sighting stays 'unverified',
--       which remains the neutral default that neither rewards nor penalises.
--
-- SAFETY: 'not_mine' bumps NO reputation counter, here or anywhere. It is the
--       absence of a confirmation, not a punishment, and the badge engine must
--       never see it. The counters remain append-only — this migration adds no
--       decrement, and none exists in the schema.
-- LINKS: supabase/migrations/20260714100000_sightings.sql (the CHECK widened);
--        supabase/migrations/20260805100000_refund_holds_and_disputes.sql
--          (both functions re-stated here);
--        supabase/migrations/20260814110000_sighting_verification_rpcs.sql
--          (mark_sighting_not_mine, which is the only writer of the new state);
--        src/shared/lib/spotterTrust.ts (why volume is not trust).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. The new state. Named constraint, so it drops by name.
-- -----------------------------------------------------------------------------
alter table public.sightings
  drop constraint sightings_status_chk;

alter table public.sightings
  add constraint sightings_status_chk
  check (status in ('unverified', 'helpful', 'not_mine', 'credited'));

-- -----------------------------------------------------------------------------
-- 2. When the owner ruled. The table has carried four *_notified_at columns
--    about PUSHES since July and not one timestamp about a status change, so
--    a credited sighting cannot say when it was credited. Both owner verdicts
--    stamp this; nothing else writes it.
--
--    No `reviewed_by`: the reviewer is always the post owner and is already
--    reachable through posts.owner_id. A second column would be a second
--    source of truth for the same fact.
-- -----------------------------------------------------------------------------
alter table public.sightings
  add column reviewed_at timestamptz;

comment on column public.sightings.reviewed_at is
  'When the post owner ruled on this sighting (helpful or not_mine). NULL means nobody has ruled — which is the honest reading of "unverified" and must never be presented as a judgement. Server-written only: no client holds an update grant on this table.';

-- -----------------------------------------------------------------------------
-- 3. THE one definition of "holds up an exit refund", re-stated so it survives
--    a fourth state. Body identical to 20260805100000:120-131 apart from the
--    predicate. The 14-day window and its reasoning are unchanged.
--
--    A 'not_mine' sighting STILL holds up the refund, deliberately. The owner
--    saying "not my car" is exactly the claim the 72h hold and the spotter's
--    dispute exist to test — letting the accused party's own say-so dismiss it
--    would make the control decorative.
-- -----------------------------------------------------------------------------
create or replace function public.recent_uncredited_sightings(p_post_id uuid)
returns setof uuid
language sql
stable
set search_path = ''
as $$
  select s.id
    from public.sightings s
   where s.post_id = p_post_id
     and s.status <> 'credited'
     and s.created_at > now() - interval '14 days';
$$;

comment on function public.recent_uncredited_sightings(uuid) is
  'THE one definition of "sightings that hold up an exit refund": NOT credited (unverified, helpful or not_mine) and reported within 14 days. Client pre-flight, both exit Edge Functions, and create_refund_hold all route through this — two definitions would disagree about whose refund waits. Stated as <> credited rather than an allowlist so a new status inherits the safe behaviour instead of silently escaping the hold. Not directly grantable; called inside SECURITY DEFINER functions.';

-- -----------------------------------------------------------------------------
-- 4. open_dispute — the spotter's only lever, and the other half of the hole.
--    Copied mechanically from 20260805100000:365-413; the ONLY change is the
--    status predicate. An owner's "not my car" must not be able to remove the
--    spotter's right to say otherwise.
-- -----------------------------------------------------------------------------
create or replace function public.open_dispute(
  p_sighting_id uuid,
  p_statement   text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller  uuid := auth.uid();
  v_post    uuid;
  v_expires timestamptz;
  v_id      uuid;
begin
  if v_caller is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;
  if p_statement is not null and char_length(p_statement) > 500 then
    raise exception 'STATEMENT_TOO_LONG';
  end if;

  select h.post_id, h.expires_at
    into v_post, v_expires
    from public.sightings s
    join public.refund_holds h on h.post_id = s.post_id
    join public.payments p on p.post_id = h.post_id and p.status = 'held'
   where s.id = p_sighting_id
     and s.spotter_id = v_caller
     and s.status <> 'credited'
     and s.id = any (h.sighting_ids)
     and now() < h.expires_at;

  if v_post is null then
    raise exception 'DISPUTE_NOT_AVAILABLE';
  end if;

  begin
    insert into public.refund_disputes (post_id, sighting_id, spotter_id, statement)
    values (v_post, p_sighting_id, v_caller, nullif(trim(p_statement), ''))
    returning id into v_id;
  exception when unique_violation then
    -- A replay (double tap, retried request). Same token as every other
    -- refusal — their own screen already shows the dispute they filed.
    raise exception 'DISPUTE_NOT_AVAILABLE';
  end;

  return jsonb_build_object('disputeId', v_id, 'windowEndsAt', v_expires);
end $$;

comment on function public.open_dispute(uuid, text) is
  'Spotter files "my sighting led to this recovery" on a held refund. All gates (own sighting, NOT credited, listed in the hold, window open, payment still held) in one predicate behind the single token DISPUTE_NOT_AVAILABLE — replays included. A sighting the owner marked not_mine is still disputable: the owner''s opinion is the thing under dispute. One dispute per sighting (unique). Fail-closed.';

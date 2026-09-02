-- =============================================================================
-- WHAT:  Tier 1 verification for claim_credited_notification — both credited
--        branches, the one-shot claim, and the £5-fee trap. NOT a migration.
-- WHY:   ⚠️ THIS FUNCTION HAD NO SQL COVERAGE AT ALL until 2026-09-02, despite
--        being a one-shot claim that decides whether a spotter is ever told
--        they were credited, and despite reading a PAYMENT to build its copy.
--
--        It also carried a real bug for thirteen days: the claim was stamped
--        BEFORE the amount was read, so on a £5 fee listing — where no bounty
--        exists — it refused to build copy and had already burned the one-shot.
--        The spotter was never told, no Inbox row was written, and a retry
--        could not help. DOMAIN.md carried it as a KNOWN GAP.
--
--        That matters more than a missing push usually would: "recognition is
--        the reward" is the entire basis for keeping fee listings outside the
--        ADR-0011 dispute machinery, and the Terms now promise it in as many
--        words. A reward never delivered does not carry that argument.
--
-- CHECKS: 1 bounty listing → 'credited' with the payout_split amount ·
-- 2 fee listing → 'credited_no_reward', claimed, no amount invented ·
-- 3 ⚠️ the £5 fee is NOT read as a bounty · 4 the claim is one-shot ·
-- 5 ⚠️ a refusal does NOT burn the claim · 6 non-owner gets the same
-- {claimed:false} · 7 grants.
-- LINKS: supabase/migrations/20260902110000_credited_no_reward_notification.sql;
--        supabase/migrations/20260804100000_credited_notification.sql;
--        docs/DOMAIN.md; docs/decisions/ADR-0014-no-bounty-listings.md.
--
-- SELF-ASSERTING: every check RAISES on failure (ON_ERROR_STOP=1). Everything
-- runs inside begin/rollback, so the shared fixture post is never left moved.
-- =============================================================================

begin;
do $$
declare
  v_post    uuid := 'a1a1a1a1-0000-0000-0000-000000000003';
  v_owner   uuid := '22222222-2222-2222-2222-222222222222';
  v_spotter uuid := '11111111-1111-1111-1111-111111111111';
  v_sight   uuid := 'cccc0000-0000-0000-0000-000000000001';
  v_doc     jsonb;
begin
  -- A credited sighting on a post its owner has just claimed recovery on.
  insert into public.sightings (id, post_id, spotter_id, status, area_label, location_unavailable)
  values (v_sight, v_post, v_spotter, 'credited', 'Ancoats', true);
  update public.posts set status = 'recovery_claimed' where id = v_post;

  -- ---------------------------------------------------------------------
  -- CHECK 1 — a BOUNTY listing: the money copy, from payout_split.
  -- ---------------------------------------------------------------------
  insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence, kind)
  values (v_post, 'pi_test_credited_bounty', 'held', 20000, 'bounty_escrow');

  v_doc := public.claim_credited_notification(v_post, v_owner);
  if (v_doc->>'claimed')::boolean is distinct from true then
    raise exception 'CHECK 1 FAILED: a funded credit was not claimed: %', v_doc;
  end if;
  if v_doc->>'kind' <> 'credited' then
    raise exception 'CHECK 1 FAILED: kind is % on a bounty listing', v_doc->>'kind';
  end if;
  -- payout_split(20000) gives the spotter 19000 — the ONE definition of 95/5.
  -- Asserted as the finished sentence, because the amount is the part a wrong
  -- split would quietly change.
  if v_doc->>'title' not like '%190.00' then
    raise exception 'CHECK 1 FAILED: title is "%" — must carry the payout_split share', v_doc->>'title';
  end if;

  -- ---------------------------------------------------------------------
  -- CHECK 4 — one-shot: the second call gets nothing.
  -- ---------------------------------------------------------------------
  v_doc := public.claim_credited_notification(v_post, v_owner);
  if (v_doc->>'claimed')::boolean is distinct from false then
    raise exception 'CHECK 4 FAILED: the claim was not one-shot: %', v_doc;
  end if;

  raise notice 'CHECK 1/4 passed: a bounty credit sends the money copy, once.';
end $$;
rollback;


begin;
do $$
declare
  v_post    uuid := 'a1a1a1a1-0000-0000-0000-000000000003';
  v_owner   uuid := '22222222-2222-2222-2222-222222222222';
  v_spotter uuid := '11111111-1111-1111-1111-111111111111';
  v_sight   uuid := 'cccc0000-0000-0000-0000-000000000002';
  v_doc     jsonb;
begin
  insert into public.sightings (id, post_id, spotter_id, status, area_label, location_unavailable)
  values (v_sight, v_post, v_spotter, 'credited', 'Ancoats', true);
  update public.posts set status = 'recovery_claimed' where id = v_post;

  -- ---------------------------------------------------------------------
  -- CHECK 2/3 — ⚠️ A £5 FEE LISTING. The fee is a payment row too, and reading
  -- it as a bounty would produce "You have earned £4.75" on a listing that says
  -- plainly it carries no reward — inventing exactly the number the original
  -- function refused to invent. The kind filter is what stops that, and
  -- ADR-0014 records those filters going missing elsewhere for four days.
  -- ---------------------------------------------------------------------
  -- ⚠️ SEEDED AT `held`, WHICH ADR-0018 MADE IMPOSSIBLE — AND THAT IS THE
  -- POINT. Since 2026-09-02 a captured fee lands in `collected`, so seeding it
  -- there would make this check pass for the STRUCTURAL reason and stop
  -- exercising the `kind` filter at all. Seeding the impossible state is what
  -- proves the second lock still holds: if a fee ever finds its way back into
  -- `held`, the filter must still keep it out of the money copy.
  insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence, kind)
  values (v_post, 'pi_test_credited_fee', 'held', 500, 'listing_fee');

  v_doc := public.claim_credited_notification(v_post, v_owner);

  if (v_doc->>'claimed')::boolean is distinct from true then
    raise exception 'CHECK 2 FAILED: a rewardless credit was not claimed — the spotter is told nothing, which is the bug this closed: %', v_doc;
  end if;
  if v_doc->>'kind' <> 'credited_no_reward' then
    raise exception 'CHECK 2 FAILED: kind is % on a fee listing', v_doc->>'kind';
  end if;
  if (v_doc->>'title') like '%£%' or (v_doc->>'body') like '%£%' then
    raise exception 'CHECK 3 FAILED: an amount appeared in a rewardless credit — the fee was read as a bounty: %', v_doc;
  end if;

  raise notice 'CHECK 2/3 passed: a fee listing sends the rewardless copy, with no invented amount.';
end $$;
rollback;


begin;
do $$
declare
  v_post    uuid := 'a1a1a1a1-0000-0000-0000-000000000003';
  v_owner   uuid := '22222222-2222-2222-2222-222222222222';
  v_other   uuid := '44444444-4444-4444-4444-444444444444';
  v_spotter uuid := '11111111-1111-1111-1111-111111111111';
  v_sight   uuid := 'cccc0000-0000-0000-0000-000000000003';
  v_doc     jsonb;
  v_stamp   timestamptz;
begin
  insert into public.sightings (id, post_id, spotter_id, status, area_label, location_unavailable)
  values (v_sight, v_post, v_spotter, 'credited', 'Ancoats', true);
  update public.posts set status = 'recovery_claimed' where id = v_post;

  -- ---------------------------------------------------------------------
  -- CHECK 5/6 — ⚠️ THE REGRESSION GUARD. A refusal must NOT consume the
  -- one-shot. The old body stamped credited_notified_at and THEN discovered it
  -- could not build copy, so the refusal was permanent and every retry sent
  -- nothing forever. A stranger is refused here; the claim must survive.
  -- ---------------------------------------------------------------------
  v_doc := public.claim_credited_notification(v_post, v_other);
  if (v_doc->>'claimed')::boolean is distinct from false then
    raise exception 'CHECK 6 FAILED: a non-owner claimed the notification: %', v_doc;
  end if;

  select credited_notified_at into v_stamp from public.sightings where id = v_sight;
  if v_stamp is not null then
    raise exception 'CHECK 5 FAILED: a refused call BURNED the one-shot — the real owner could now never tell the spotter';
  end if;

  -- ...and the owner can still claim afterwards, which is the property that
  -- "a refusal does not burn" actually buys.
  insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence, kind)
  values (v_post, 'pi_test_credited_after', 'held', 20000, 'bounty_escrow');
  v_doc := public.claim_credited_notification(v_post, v_owner);
  if (v_doc->>'claimed')::boolean is distinct from true then
    raise exception 'CHECK 5 FAILED: the owner could not claim after somebody else was refused: %', v_doc;
  end if;

  raise notice 'CHECK 5/6 passed: a refusal is opaque and does not consume the claim.';
end $$;
rollback;


-- -----------------------------------------------------------------------------
-- CHECK 7 — grants. The copy names an amount; no client may mint one.
-- -----------------------------------------------------------------------------
do $$
begin
  if has_function_privilege('authenticated', 'public.claim_credited_notification(uuid, uuid)', 'execute') then
    raise exception 'CHECK 7 FAILED: authenticated can execute claim_credited_notification';
  end if;
  if has_function_privilege('anon', 'public.claim_credited_notification(uuid, uuid)', 'execute') then
    raise exception 'CHECK 7 FAILED: anon can execute claim_credited_notification';
  end if;
  raise notice 'CHECK 7 passed: the claim is service_role only.';
end $$;


select 'credited_notification_verification: ALL CHECKS PASSED' as result;

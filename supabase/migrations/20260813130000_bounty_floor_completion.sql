-- =============================================================================
-- WHAT: The three places the £50 -> £10 floor move MISSED, plus one function it
--       resurrected by accident. Found by review of 20260813120000.
--
--         1. public.update_post — DROPPED AGAIN (it should not exist)
--         2. payments.amount_pence's CHECK        5000 -> 1000
--         3. bounty_recommendations' four CHECKs  5000 -> 1000
--         4. log_bounty_recommendation's guards   5000 -> 1000
--
-- WHY:  20260813120000's banner claims the floor is stated in SEVEN places and
--       moves all seven. The count was wrong. Each miss below is silent — no
--       error at the boundary, no failing test — which is why they are grouped
--       here with the evidence rather than fixed one at a time.
--
--       2 IS A LIVE MONEY-PATH BREAK, and the reason this migration exists.
--       create_post now accepts £10, so a draft is created; then
--       create-payment-intent opens a REAL PaymentIntent at Stripe and calls
--       record_post_payment_intent, whose insert hits payments.amount_pence's
--       untouched £50 CHECK and raises. The owner gets LEDGER_ERROR, the retry
--       fails identically forever, the post is stuck in draft and the Stripe
--       intent is orphaned. Every post between £10 and £49.99 does this.
--
--       1 IS A DENY-BY-DEFAULT REGRESSION. update_post was deliberately dropped
--       by 20260727140000_drop_whole_post_edit.sql:22 ("Leaving two unused
--       money-adjacent SECURITY DEFINER functions in the schema is avoidable
--       attack/audit surface"). Section 4 of 20260813120000 re-created it while
--       moving the literal — and because the function did not exist, `create or
--       replace` CREATED it, so it did NOT inherit the old ACL. The revoke/grant
--       triple and its SAFETY block at 20260727110000:439-455 were not carried
--       across, and 20260802170000 revokes default privileges on TABLES only.
--       Result, confirmed on a fresh reset: anon holds EXECUTE on a SECURITY
--       DEFINER post-write RPC at /rest/v1/rpc/update_post — the only one anon
--       can reach. No data is exposed today (the body's first act is
--       NOT_AUTHENTICATED, and the draft-only + owner + FOR UPDATE gate is
--       intact) and it has ZERO callers in src/. It is the lost control that
--       matters, not a live hole. Dropping is correct rather than re-granting:
--       update_post_bounty carries the £10 guard and is what the UI calls.
--
--       3 AND 4 SILENTLY EXCLUDE THE COHORT THIS BRANCH EXISTS TO MEASURE. The
--       writer returns early rather than raising (deliberately — it is
--       fire-and-forget from the post-success path), so every £10-£49.99 post
--       writes NO analytics row at all. Worse, the table's own header calls the
--       all-NULL rows "the control group", so the misses do not merely lose
--       data, they contaminate what remains: recommendBounty legitimately emits
--       lowPence = 1000 (it clamps to MIN_BOUNTY_PENCE, and the curve's first
--       rung is now 1000), which the old guard discarded to NULL while still
--       recording shown_basis.
--
--       THE FUNCTION BODY IN SECTION 4 WAS COPIED MECHANICALLY out of
--       20260813110000 (lines 116-197) and passed through a substitution of the
--       two guard phrases ONLY. It was not re-typed. Diff it against that file:
--       the only differences are `between 5000` -> `between 1000` on the three
--       shown_* validations and `< 5000` -> `< 1000` on the chosen_pence gate.
--
--       ERRATA FOR 20260813120000, RECORDED HERE RATHER THAN EDITED THERE.
--       That migration is applied to two databases, so its file must keep
--       describing what actually ran; editing it would make a local reset
--       diverge from remote, which is this repo's known drift hazard. Two of
--       its comments are now wrong and this is the correction:
--         · :44-45 and :963-967 justify themselves by "the floor-bounty sheet"
--           and "lowBountyAdvice". Both were deleted before merge.
--         · The £10 rung IS still load-bearing — but for reachBandFrom in
--           bountyRecommendation.ts, which drops any rung outside
--           MIN_BOUNTY_PENCE..MAX_BOUNTY_PENCE, so a curve that does not start
--           at the floor cannot describe the cheapest amount an owner may pick.
--           supabase/tests/bounty_guidance_verification.sql CHECK 9A gates it.
--
-- LINKS: supabase/migrations/20260813120000_bounty_minimum_ten.sql (the move
--          this completes, and whose section 4 is undone here);
--        supabase/migrations/20260727140000_drop_whole_post_edit.sql (the drop
--          this restores);
--        supabase/migrations/20260707110712_payments_foundation.sql:392;
--        supabase/migrations/20260813110000_bounty_recommendation_log.sql;
--        src/features/vehicles/post/lib/bountyBounds.ts (the client mirror).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. update_post — dropped again, restoring 20260727140000's intent.
--
-- Signature copied from the live catalogue (pg_get_function_identity_arguments)
-- rather than retyped, so the drop cannot silently miss. IF EXISTS because a
-- database that never ran 20260813120000 section 4 has no such function.
-- -----------------------------------------------------------------------------
drop function if exists public.update_post(
  p_post_id uuid, p_plate text, p_make text, p_model text, p_colour text,
  p_year integer, p_body_type text, p_distinguishing_features text,
  p_owner_note text, p_desc_recognise text, p_desc_drives text,
  p_stolen_from text, p_keys_taken text, p_last_seen_at timestamp with time zone,
  p_last_seen_lat double precision, p_last_seen_lng double precision,
  p_last_seen_area text, p_bounty_amount_pence integer, p_photo_urls text[],
  p_feature_keys text[], p_verification_path text, p_distinctive_features jsonb
);

-- Post-condition, because `drop function if exists` with a typed signature
-- no-ops SILENTLY on any argument mismatch — and a silent no-op is precisely
-- the failure that produced this migration. Matched on proname alone so an
-- overload cannot slip through. supabase/tests/anon_role_verification.sql
-- CHECK 13 asserts the same thing on every CI run; this one covers the push.
do $$
declare
  v_count integer;
begin
  select count(*) into v_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'update_post';

  if v_count <> 0 then
    raise exception 'update_post still present after the drop (% overload(s)) — signature mismatch?', v_count;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 2. payments.amount_pence — the live break.
--
-- Looked up BY DEFINITION rather than by assumed name, for the same reason
-- 20260813120000 section 1 does it: an inline column CHECK carries a
-- system-generated name that can differ between a local reset and the deployed
-- project. INTO STRICT so more than one match raises rather than dropping an
-- arbitrary one.
-- -----------------------------------------------------------------------------
do $$
declare
  v_name text;
begin
  -- Matched on the CONSTRAINED COLUMN, not on the text of the definition: a
  -- LIKE on '%amount_pence >= %' also matches refunded_amount_pence and
  -- transfer_amount_pence, and INTO STRICT correctly refused all three.
  select c.conname into strict v_name
  from pg_constraint c
  where c.conrelid = 'public.payments'::regclass
    and c.contype = 'c'
    and (
      select array_agg(a.attname::text order by a.attnum)
      from pg_attribute a
      where a.attrelid = c.conrelid and a.attnum = any (c.conkey)
    ) = array['amount_pence'];

  execute format('alter table public.payments drop constraint %I', v_name);
end $$;

-- Named explicitly this time, so the next migration to touch it can say so.
alter table public.payments
  add constraint payments_amount_pence_check
  check (amount_pence between 1000 and 500000);

comment on column public.payments.amount_pence is
  'MONEY: the escrow amount in integer pence, GBP. Mirrors posts.bounty_amount_pence at charge time and carries the SAME 1000-500000 CHECK — a payment outside the range its post may carry is a bug, not data.';

-- -----------------------------------------------------------------------------
-- 3. bounty_recommendations — four CHECKs, all named in their DDL.
-- -----------------------------------------------------------------------------
alter table public.bounty_recommendations
  drop constraint if exists bounty_rec_low_range_chk,
  drop constraint if exists bounty_rec_high_range_chk,
  drop constraint if exists bounty_rec_mid_range_chk,
  drop constraint if exists bounty_rec_chosen_range_chk;

alter table public.bounty_recommendations
  add constraint bounty_rec_low_range_chk
    check (shown_low_pence  is null or shown_low_pence  between 1000 and 500000),
  add constraint bounty_rec_high_range_chk
    check (shown_high_pence is null or shown_high_pence between 1000 and 500000),
  add constraint bounty_rec_mid_range_chk
    check (shown_mid_pence  is null or shown_mid_pence  between 1000 and 500000),
  add constraint bounty_rec_chosen_range_chk
    check (chosen_pence between 1000 and 500000);

comment on column public.bounty_recommendations.chosen_pence is
  'MONEY: integer pence. The bounty the owner actually set, copied from posts.bounty_amount_pence at creation. Same CHECK range as that column (1000-500000).';

-- -----------------------------------------------------------------------------
-- 4. log_bounty_recommendation — the four guards.
--    Body copied mechanically from 20260813110000:116-197; see the banner.
-- -----------------------------------------------------------------------------
create or replace function public.log_bounty_recommendation(
  p_post_id          uuid,
  p_chosen_pence     integer,
  p_shown_low_pence  integer default null,
  p_shown_high_pence integer default null,
  p_shown_mid_pence  integer default null,
  p_shown_basis      text    default null,
  p_local_sample     integer default null
)
returns void
language plpgsql
volatile
security definer
set search_path = public, extensions
as $fn$
declare
  v_lat   double precision;
  v_lng   double precision;
  v_reach integer;
  v_low   integer;
  v_high  integer;
  v_mid   integer;
  v_basis text;
  v_sample integer;
begin
  -- Ownership check AND the coordinate read in one statement. A post the caller
  -- does not own simply yields no row.
  select
    ST_Y(p.last_seen_location::geometry),
    ST_X(p.last_seen_location::geometry)
    into v_lat, v_lng
  from public.posts p
  where p.id = p_post_id
    and p.owner_id = auth.uid();

  -- SILENT on refusal, deliberately, for two independent reasons:
  --   1. An error here would be indistinguishable from "that post exists but is
  --      not yours", making an analytics endpoint into an ownership oracle.
  --   2. This is fire-and-forget from the post-creation success path. Nothing
  --      it does may ever surface to someone who has just paid.
  if not found then
    return;
  end if;

  -- No sanitising of what the client claims was on screen — VALIDATE, then
  -- discard what does not fit. A garbage value must not raise (see reason 2
  -- above) and must not be recorded as though it were real.
  v_low  := case when p_shown_low_pence  between 1000 and 500000 then p_shown_low_pence  end;
  v_high := case when p_shown_high_pence between 1000 and 500000 then p_shown_high_pence end;
  v_mid  := case when p_shown_mid_pence  between 1000 and 500000 then p_shown_mid_pence  end;
  v_basis := case when p_shown_basis in ('reach', 'local', 'reach+local') then p_shown_basis end;
  v_sample := case when p_local_sample >= 0 then p_local_sample end;

  -- chosen_pence is NOT NULL and range-checked. It comes from the same client
  -- as the rest, but unlike the rest it has an authoritative counterpart one
  -- join away (posts.bounty_amount_pence), so a bad value is detectable later
  -- rather than needing to be guessed at now. Out of range = write nothing.
  if p_chosen_pence is null or p_chosen_pence < 1000 or p_chosen_pence > 500000 then
    return;
  end if;

  -- The tamper-proof half. Same function, same floor of 5, same caller
  -- exclusion the owner saw — auth.uid() inside this SECURITY DEFINER is still
  -- the real caller, so the recomputed number is the one they were shown.
  if v_lat is not null and v_lng is not null then
    v_reach := public.get_alert_reach(v_lat, v_lng, p_chosen_pence);
  end if;

  insert into public.bounty_recommendations (
    post_id, shown_low_pence, shown_high_pence, shown_mid_pence,
    shown_basis, chosen_pence, local_sample, server_reach_at_chosen
  )
  values (
    p_post_id, v_low, v_high, v_mid,
    v_basis, p_chosen_pence, v_sample, v_reach
  )
  -- Idempotent: the client may retry, and the FIRST recommendation shown is the
  -- one that could have influenced the choice. A later overwrite would record
  -- advice given after the decision.
  on conflict (post_id) do nothing;
end;
$fn$;

-- -----------------------------------------------------------------------------
-- 5. The prose 20260813120000 left behind on the authoritative column. This is
--    what `\d+ posts` prints, so it is the version people actually read.
-- -----------------------------------------------------------------------------
comment on column public.posts.bounty_amount_pence is
  'MONEY: bounty in integer pence, GBP. CHECK enforces 1000-500000. The 500000 ceiling is a fraud control (DOMAIN.md); the 1000 floor is a product choice (20260813120000).';

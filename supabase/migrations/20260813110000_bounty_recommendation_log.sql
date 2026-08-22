-- =============================================================================
-- WHAT: public.bounty_recommendations — one row per post recording the bounty
--       range we SUGGESTED against the amount the owner actually SET, plus the
--       inputs that produced the suggestion. Written by
--       log_bounty_recommendation(...) after a post is created.
--
-- WHY:  The recommendation this feature ships is built from distribution facts
--       (who a bounty reaches, what neighbours pay) because those are the only
--       inputs we hold. The input we would MOST like — "what bounty levels
--       actually led to a confirmed sighting" — cannot be computed today, not
--       because the schema lacks it (posts.bounty_amount_pence ->
--       sightings.status='credited' -> posts.status='recovered' is complete and
--       structurally enforced by sightings_one_credited_per_post_uidx) but
--       because nothing yet records what we ADVISED. Without that column, a
--       future analysis cannot separate "high bounties recover cars" from "we
--       told people to set high bounties". This table is the missing half.
--
--       It is the cheapest possible thing that makes a v2 recommender possible:
--       nine columns, written once, read by nobody at runtime.
--
-- ⚠️ THIS IS PSEUDONYMOUS, NOT ANONYMOUS. It keys on post_id, which reaches
--   owner_id. That is deliberate and unavoidable: the entire value is joining a
--   suggestion to an OUTCOME, and an outcome lives on the post. Saying
--   "anonymous" here would be untrue. What limits it instead is reach — RLS is
--   on with ZERO client policies, exactly like public.payments, so no user
--   (including the owner) can read a single row through the API. It is
--   analytics for us, invisible to everyone.
--
-- ⚠️ THE shown_* COLUMNS ARE CLIENT-SUPPLIED AND THEREFORE TAMPER-ABLE. They
--   record what was on screen, which only the client knows. server_reach_at_
--   chosen is recomputed here from alert_zones and is not. Both are stored so a
--   later analysis can notice if they ever disagree at scale.
--
-- LINKS: supabase/migrations/20260813100000_bounty_guidance.sql (the inputs);
--        supabase/migrations/20260807120000_alert_reach_count.sql
--          (get_alert_reach — recomputed here);
--        supabase/migrations/20260802200000_claim_recovery.sql
--          (the credited-sighting outcome this table is meant to be joined to);
--        supabase/migrations/20260707110712_payments_foundation.sql
--          (public.payments — the RLS-on/no-policies posture copied here).
-- =============================================================================


-- =============================================================================
-- 1. TABLE
-- =============================================================================
create table if not exists public.bounty_recommendations (
  -- One row per post, and the post is the join key to every outcome. CASCADE:
  -- if the listing is erased (GDPR account deletion cascades through posts),
  -- the analytics row about it goes too. An orphaned suggestion is not data we
  -- have any right to keep.
  post_id uuid primary key references public.posts (id) on delete cascade,

  -- MONEY: integer pence, GBP, all three. NULL is MEANINGFUL and expected — it
  -- records that NO recommendation was shown (no location, too few zones, too
  -- few neighbours). Those rows are the control group and are the reason the
  -- columns are nullable rather than the table being sparse.
  shown_low_pence  integer constraint bounty_rec_low_range_chk
    check (shown_low_pence  is null or shown_low_pence  between 5000 and 500000),
  shown_high_pence integer constraint bounty_rec_high_range_chk
    check (shown_high_pence is null or shown_high_pence between 5000 and 500000),
  shown_mid_pence  integer constraint bounty_rec_mid_range_chk
    check (shown_mid_pence  is null or shown_mid_pence  between 5000 and 500000),

  -- Which signals the range rested on. Mirrors the union in
  -- bountyRecommendation.ts; NULL means nothing was shown.
  shown_basis text constraint bounty_rec_basis_chk
    check (shown_basis is null or shown_basis in ('reach', 'local', 'reach+local')),

  -- MONEY: what the owner actually set. Same bounds as posts.bounty_amount_
  -- pence, deliberately: this is a copy of that column at post time, and a
  -- value outside the range the post itself may carry is a bug, not data.
  chosen_pence integer not null constraint bounty_rec_chosen_range_chk
    check (chosen_pence between 5000 and 500000),

  -- How many nearby listings the local band rested on. NULL = no local band.
  local_sample integer constraint bounty_rec_sample_chk
    check (local_sample is null or local_sample >= 0),

  -- Recomputed server-side at write time. The tamper-proof half.
  server_reach_at_chosen integer constraint bounty_rec_reach_chk
    check (server_reach_at_chosen is null or server_reach_at_chosen >= 0),

  created_at timestamptz not null default now()
);

comment on table public.bounty_recommendations is
  'Analytics only: the bounty range SUGGESTED to an owner versus the amount they SET, with the inputs behind the suggestion. Exists so a future recommender can be trained on outcomes without confusing "high bounties recover cars" with "we advised high bounties" — the outcome side of that join (credited sighting -> recovered) already exists; this is the advice side, which did not. PSEUDONYMOUS, not anonymous: post_id reaches owner_id, unavoidably, because the value is the outcome join. RLS is ON with ZERO policies (the public.payments posture) so no client, including the owner, can read any row. shown_* are client-reported and tamper-able; server_reach_at_chosen is recomputed from alert_zones and is not.';

comment on column public.bounty_recommendations.shown_low_pence is
  'MONEY: integer pence. Low end of the range shown on screen, or NULL if no recommendation was shown at all (no location, or every signal below its floor). The NULL rows are the control group.';

comment on column public.bounty_recommendations.chosen_pence is
  'MONEY: integer pence. The bounty the owner actually set, copied from posts.bounty_amount_pence at creation. Same CHECK range as that column.';

comment on column public.bounty_recommendations.server_reach_at_chosen is
  'get_alert_reach recomputed server-side for the chosen amount at write time. Floored at 5 like every reach count, so 0 means "fewer than 5, or no location". The un-tamperable counterpart to the client-reported shown_* columns.';

-- =============================================================================
-- 2. RLS — ON, with no policies at all.
-- Not an oversight: service_role bypasses RLS, every other role therefore sees
-- nothing. Identical to public.payments, and for the same reason — this is
-- our ledger about users, not a resource users own.
-- =============================================================================
alter table public.bounty_recommendations enable row level security;

-- Belt and braces against the project's ALTER DEFAULT PRIVILEGES, which grants
-- table privileges to anon and authenticated at create time. RLS with no
-- policies already denies, but a table nobody may touch should also not appear
-- to be grantable.
revoke all on table public.bounty_recommendations from public, anon, authenticated;

-- =============================================================================
-- 3. WRITER
-- =============================================================================
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
  v_low  := case when p_shown_low_pence  between 5000 and 500000 then p_shown_low_pence  end;
  v_high := case when p_shown_high_pence between 5000 and 500000 then p_shown_high_pence end;
  v_mid  := case when p_shown_mid_pence  between 5000 and 500000 then p_shown_mid_pence  end;
  v_basis := case when p_shown_basis in ('reach', 'local', 'reach+local') then p_shown_basis end;
  v_sample := case when p_local_sample >= 0 then p_local_sample end;

  -- chosen_pence is NOT NULL and range-checked. It comes from the same client
  -- as the rest, but unlike the rest it has an authoritative counterpart one
  -- join away (posts.bounty_amount_pence), so a bad value is detectable later
  -- rather than needing to be guessed at now. Out of range = write nothing.
  if p_chosen_pence is null or p_chosen_pence < 5000 or p_chosen_pence > 500000 then
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

comment on function public.log_bounty_recommendation(uuid, integer, integer, integer, integer, text, integer) is
  'Records the bounty range shown to an owner against the amount they set, once per post. Verifies the caller owns the post and returns SILENTLY otherwise — an error would make this an ownership oracle, and it is called fire-and-forget from the post-creation success path where nothing may ever surface to someone who has just paid. Client-reported shown_* values are validated and DISCARDED when out of range rather than raising, for the same reason; server_reach_at_chosen is recomputed here via get_alert_reach and cannot be forged. Idempotent on post_id: the FIRST range shown is the one that could have influenced the choice.';

revoke execute on function public.log_bounty_recommendation(uuid, integer, integer, integer, integer, text, integer)
  from public, anon;

grant execute on function public.log_bounty_recommendation(uuid, integer, integer, integer, integer, text, integer)
  to authenticated, service_role;

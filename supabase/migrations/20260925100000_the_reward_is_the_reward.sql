-- =============================================================================
-- WHAT:  "The reward is the reward" (ADR-0020). A reward listing's 5% service
--        fee moves ON TOP of the reward: an owner offering £500 is charged
--        £525, and the credited spotter receives exactly £500. Until now the
--        owner was charged £500 and the spotter received £475 — while every
--        spotter-facing surface said "£500 reward" and the report screen
--        promised "you'll receive the £500 reward".
--
--          1. public.payment_pricing enum: fee_on_top | fee_inside | flat_fee.
--          2. payments gains the split AS CHARGED — pricing, reward_pence,
--             service_fee_pence — plus released_at / refunded_at.
--          3. Backfill: every existing escrow row is fee_inside (it was charged
--             under the old rule and must pay out under it); every fee row is
--             flat_fee.
--          4. Every CHECK on payments.amount_pence is replaced by
--             payments_split_check, one arithmetic rule per pricing, NULLs
--             failing closed.
--          5. payments_fill_legacy_split (BEFORE INSERT): a SETTLED row written
--             without a pricing is legacy-shaped and gets the old split; a NEW
--             escrow charge without one is refused.
--          6. payments_stamp_settled_at (BEFORE UPDATE): released_at /
--             refunded_at are stamped by the status change itself.
--          6b. payments_split_is_fixed (BEFORE UPDATE): the split, and a
--             settlement date once set, can never be rewritten.
--          7. record_post_payment_intent: a reward listing now owes
--             reward + floor(5%), recorded as fee_on_top; a pending row is
--             reused only for the SAME intent (it matched on amount, which
--             could leave a paid intent unrecorded).
--          8. mark_recovery_paid, claim_credited_notification,
--             claim_dispute_outcome_notification, my_pending_credit and
--             my_dispute_context read the STORED split instead of payout_split
--             (mark_recovery_paid also re-derives it independently).
--
-- WHY:   The number a spotter is shown must be the number they are paid. The
--        old model could not make that true without showing spotters "£475
--        reward", which reads as a haircut on someone else's money. Moving the
--        fee on top makes the advertised reward the paid reward, and makes the
--        owner's cost explicit at the one moment they are deciding it.
--
-- MONEY: the split is now a property OF THE PAYMENT ROW, fixed at charge time,
--        not a rule applied at payout time. That is what lets legacy rows
--        (charged at the old rule, in Stripe test mode) keep paying 95/5 while
--        new rows pay the reward in full — and it means no payout path can ever
--        apply the new rule to money charged under the old one.
--
--        The fee is FLOOR(5%): `(reward * 5) / 100` in integer arithmetic. It
--        never charges more than 5%, and every whole-pound reward (all the
--        slider can produce) is exact. A charge is reward + fee EXACTLY — the
--        CHECK below makes any other row unwritable.
--
--        payout_split stays: it is still the definition of the fee_inside rule,
--        and the CHECK below references the same arithmetic.
--
-- SAFETY: additive, apart from one constraint swap (4), which is replaced in
--         the same transaction by a strictly narrower rule for every existing
--         row. No function signature changes, so every ACL survives the
--         `create or replace`s. The function bodies in section 8 are the
--         LATEST definitions, restated with only the split read changed:
--           mark_recovery_paid                  <- 20260802220000_release_payout.sql
--           record_post_payment_intent          <- 20260819100000_a_listing_can_be_free.sql
--           claim_credited_notification         <- 20260922120000_pushes_say_the_news_first.sql
--           claim_dispute_outcome_notification  <- 20260922120000_pushes_say_the_news_first.sql
--           my_pending_credit                   <- 20260804110000_my_pending_credit.sql
--           my_dispute_context                  <- 20260805100000_refund_holds_and_disputes.sql
--
-- LINKS: docs/decisions/ADR-0020-the-reward-is-the-reward.md;
--        docs/decisions/ADR-0002-stripe-connect.md (the transfer math this
--          amends); docs/DOMAIN.md ("Listing pricing", "Bounty rules");
--        supabase/functions/create-payment-intent/index.ts (computes the same
--          charge; this function rejects any other);
--        supabase/functions/_shared/serviceFee.ts (the TypeScript mirror);
--        supabase/functions/_shared/releasePayout.ts (transfers reward_pence);
--        supabase/tests/fee_on_top_verification.sql.
-- =============================================================================

begin;

-- =============================================================================
-- 1. The pricing a charge was made under.
-- =============================================================================
create type public.payment_pricing as enum ('fee_on_top', 'fee_inside', 'flat_fee');

comment on type public.payment_pricing is
  'MONEY: how a payments row''s amount divides. fee_on_top (ADR-0020): the owner paid reward + 5%, the spotter receives the reward in full. fee_inside (ADR-0002, every escrow row charged before 2026-09-25): the owner paid the reward, the spotter receives 95% of it. flat_fee (ADR-0014): the £5 listing fee, no reward.';


-- =============================================================================
-- 2. The split, as charged.
-- =============================================================================
alter table public.payments
  add column pricing           public.payment_pricing,
  add column reward_pence      integer,
  add column service_fee_pence integer,
  add column released_at       timestamptz,
  add column refunded_at       timestamptz;

comment on column public.payments.pricing is
  'MONEY: which rule divides amount_pence (see the payment_pricing type). Fixed when the charge is recorded and never changed: a payout always follows the rule the owner was charged under.';
comment on column public.payments.reward_pence is
  'MONEY: what the credited spotter receives, integer pence. fee_on_top: the reward the owner offered. fee_inside: round(95% of amount_pence). NULL for a flat_fee row, which has no reward.';
comment on column public.payments.service_fee_pence is
  'MONEY: what the platform keeps on a spotter-led recovery, integer pence. fee_on_top: floor(5% of the reward). fee_inside: amount_pence - reward_pence. flat_fee: the whole 500. On a refund the platform keeps none of it (only the card fee is withheld).';
comment on column public.payments.released_at is
  'When the reward was transferred to the spotter (status -> released). Stamped with now() by payments_stamp_settled_at and frozen by payments_split_is_fixed. Recorded now for the owner''s money status and the spotter''s earnings, which will read it.';
comment on column public.payments.refunded_at is
  'When the charge was refunded to the owner (status -> refunded). Stamped with now() by payments_stamp_settled_at and frozen by payments_split_is_fixed. Recorded now for the owner''s money status, which will read it.';


-- =============================================================================
-- 3. Backfill. Every existing row was charged under a rule that already
--    exists: escrow rows under ADR-0002 (fee inside), fee rows under ADR-0014.
--    Settlement dates come from updated_at — the last write to a settled row
--    IS its settlement (never-regress guards make it the final one).
--
--    ⚠️ payments_set_updated_at is DISABLED for the backfill. It fires on
--    every UPDATE and stamps updated_at = now(), so the first backfill
--    statement would overwrite the very dates the settlement stamps read —
--    every historical release and refund would be dated the moment this
--    migration ran, and the originals would be gone for good. One statement
--    also reads updated_at before anything writes it, for the same reason.
-- =============================================================================
alter table public.payments disable trigger payments_set_updated_at;

update public.payments
   set pricing           = case kind when 'listing_fee' then 'flat_fee'::public.payment_pricing
                                     else 'fee_inside'::public.payment_pricing end,
       reward_pence      = case kind when 'listing_fee' then null
                                     else round(amount_pence::numeric * 95 / 100)::integer end,
       service_fee_pence = case kind when 'listing_fee' then 500
                                     else amount_pence - round(amount_pence::numeric * 95 / 100)::integer end,
       released_at       = case when status = 'released' then updated_at end,
       refunded_at       = case when status = 'refunded' then updated_at end;

alter table public.payments enable trigger payments_set_updated_at;

alter table public.payments alter column pricing set not null;
alter table public.payments alter column service_fee_pence set not null;


-- =============================================================================
-- 4. One arithmetic rule per pricing. Written inline rather than through a
--    function so the rule is visible in \d payments and cannot be changed by
--    redefining a helper.
--
--    The old amount rule is dropped BY DEFINITION, not by name. Production's
--    money schema has been hand-applied before (the £5 design reached it
--    outside the migration system), so a check on amount_pence there may not
--    be called payments_amount_pence_check — and one left behind, capped at
--    500000, would refuse every reward above about £4,762 once the fee is on
--    top. Every CHECK on payments that reads the bare amount_pence column is
--    dropped; the refunded_ / transfer_amount_pence checks are left alone
--    (the pattern requires amount_pence NOT to follow a letter or underscore).
-- =============================================================================
do $$
declare
  v_name text;
begin
  for v_name in
    select conname
      from pg_constraint
     where conrelid = 'public.payments'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ~ '(^|[^a-z_])amount_pence'
  loop
    execute format('alter table public.payments drop constraint %I', v_name);
  end loop;
end $$;

-- ⚠️ coalesce(…, false): a CHECK that evaluates to NULL PASSES. Without it a
-- fee_on_top row with a NULL reward would be accepted at any amount at all —
-- every comparison against NULL is NULL, and NULL is not a violation.
alter table public.payments
  add constraint payments_split_check check (coalesce(
    case pricing
      when 'fee_on_top' then
            kind = 'bounty_escrow'
        and reward_pence between 1000 and 500000
        and service_fee_pence = (reward_pence * 5) / 100
        and amount_pence = reward_pence + service_fee_pence
      when 'fee_inside' then
            kind = 'bounty_escrow'
        and amount_pence between 1000 and 500000
        and reward_pence = round(amount_pence::numeric * 95 / 100)::integer
        and service_fee_pence = amount_pence - reward_pence
      when 'flat_fee' then
            kind = 'listing_fee'
        and amount_pence = 500
        and reward_pence is null
        and service_fee_pence = 500
    end,
    false
  ));

comment on column public.payments.amount_pence is
  'MONEY: integer pence GBP, exactly what the owner was charged. fee_on_top: reward + service fee (1050-525000). fee_inside: the reward itself (1000-500000). flat_fee: exactly 500. payments_split_check pins each against its pricing.';


-- =============================================================================
-- 5. A row written without a pricing is a legacy-shaped row.
--    The one production writer, record_post_payment_intent, always states its
--    pricing. This exists for the SQL verification fixtures (about forty
--    `insert into public.payments` statements written before pricing existed),
--    which insert SETTLED-shaped rows (held, refunded, collected…) standing in
--    for money charged under the old rule.
--
--    ⚠️ A NEW ESCROW CHARGE — kind bounty_escrow, status requires_payment,
--    the state every real charge is born in — is REFUSED without a pricing.
--    Filling it would give a future writer that forgot the column a silent
--    95/5 of a fee-on-top charge: the spotter short-paid, the platform
--    over-paid, and nothing erroring. Raised as a check_violation because
--    that is what it is: a row with no stated split.
-- =============================================================================
create or replace function public.payments_fill_legacy_split()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.pricing is null then
    if new.kind = 'bounty_escrow' and new.status = 'requires_payment' then
      raise exception 'PRICING_REQUIRED: a new escrow charge must state its pricing'
        using errcode = 'check_violation';
    end if;
    if new.kind = 'listing_fee' then
      new.pricing           := 'flat_fee';
      new.reward_pence      := null;
      new.service_fee_pence := 500;
    else
      new.pricing           := 'fee_inside';
      new.reward_pence      := round(new.amount_pence::numeric * 95 / 100)::integer;
      new.service_fee_pence := new.amount_pence - new.reward_pence;
    end if;
  end if;
  return new;
end $$;

comment on function public.payments_fill_legacy_split() is
  'BEFORE INSERT on payments: a row with no pricing gets the pre-2026-09-25 split for its kind (fee_inside 95/5, or flat_fee) — except a new escrow charge (bounty_escrow + requires_payment), which is refused with PRICING_REQUIRED (check_violation) so no writer can silently charge under the old rule. Every production writer states pricing explicitly; this keeps legacy-shaped settled inserts (the SQL fixtures) valid under payments_split_check.';

revoke all on function public.payments_fill_legacy_split() from public, anon, authenticated;

create trigger payments_fill_legacy_split
  before insert on public.payments
  for each row execute function public.payments_fill_legacy_split();


-- =============================================================================
-- 6. Settlement dates are stamped by the status change, not by callers.
--    Every writer that settles money (mark_recovery_paid,
--    mark_post_payment_refunded, mark_post_recovered_no_spotter, and any later
--    one) gets the date for free, and none can forget it.
-- =============================================================================
create or replace function public.payments_stamp_settled_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- now(), never a caller's value: "when the money moved" is the database's
  -- to say. Once set, payments_split_is_fixed keeps it from moving.
  if new.status = 'released' and old.status is distinct from 'released' then
    new.released_at := now();
  end if;
  if new.status = 'refunded' and old.status is distinct from 'refunded' then
    new.refunded_at := now();
  end if;
  return new;
end $$;

comment on function public.payments_stamp_settled_at() is
  'BEFORE UPDATE on payments: stamps released_at / refunded_at with now() when status first becomes released / refunded — never a caller-supplied value. Recorded now so the owner''s money status and the spotter''s earnings (the next escrow UX changes) can say when money moved.';

revoke all on function public.payments_stamp_settled_at() from public, anon, authenticated;

create trigger payments_stamp_settled_at
  before update on public.payments
  for each row execute function public.payments_stamp_settled_at();


-- =============================================================================
-- 6b. The split is fixed once written.
--     payments_split_check proves a row's numbers obey ITS pricing; it cannot
--     stop an UPDATE moving a row to a different, equally valid split — a
--     fee_inside row rewritten as fee_on_top would pay its spotter 5% more than
--     was ever charged for them. The charge was made under one rule, and the
--     row may never claim another.
-- =============================================================================
create or replace function public.payments_split_is_fixed()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.pricing           is distinct from old.pricing
     or new.kind              is distinct from old.kind
     or new.amount_pence      is distinct from old.amount_pence
     or new.reward_pence      is distinct from old.reward_pence
     or new.service_fee_pence is distinct from old.service_fee_pence then
    raise exception 'PAYMENT_SPLIT_IMMUTABLE: a charge''s split is fixed when it is recorded'
      using errcode = 'check_violation';
  end if;
  -- A settlement date, once stamped, is history.
  if (old.released_at is not null and new.released_at is distinct from old.released_at)
     or (old.refunded_at is not null and new.refunded_at is distinct from old.refunded_at) then
    raise exception 'PAYMENT_SETTLED_AT_IMMUTABLE: a settlement date cannot be rewritten'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

comment on function public.payments_split_is_fixed() is
  'BEFORE UPDATE on payments: refuses any change to kind, pricing, amount_pence, reward_pence or service_fee_pence (PAYMENT_SPLIT_IMMUTABLE), and any change to a released_at / refunded_at once set (PAYMENT_SETTLED_AT_IMMUTABLE), both as check_violation. The split is fixed at charge time (ADR-0020); a status or settlement write never needs to touch it.';

revoke all on function public.payments_split_is_fixed() from public, anon, authenticated;

create trigger payments_split_is_fixed
  before update on public.payments
  for each row execute function public.payments_split_is_fixed();


-- =============================================================================
-- 7. record_post_payment_intent — a reward listing now owes reward + 5%.
--    Restated from 20260819100000; the signature is unchanged. What changed:
--    the bounty branch's expected amount, and the split recorded with it.
-- =============================================================================
create or replace function public.record_post_payment_intent(
  p_post_id           uuid,
  p_payment_intent_id text,
  p_amount_pence      integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bounty  integer;
  v_status  public.post_status;
  v_kind    public.payment_kind;
  v_pricing public.payment_pricing;
  v_reward  integer;
  v_fee     integer;
  -- MONEY: the flat listing fee, in pence. Mirrors LISTING_FEE_PENCE in
  -- src/shared/lib/money.ts and payments_split_check's 500.
  c_listing_fee constant integer := 500;
begin
  -- Lock the post row so concurrent intent-recording for the same post serialises
  -- (belt-and-braces against a double-charge race). Missing row -> NOT FOUND.
  select bounty_amount_pence, status
    into v_bounty, v_status
  from public.posts
  where id = p_post_id
  for update;

  -- Post must exist AND still be a draft.
  if not found or v_status <> 'draft' then
    raise exception 'POST_NOT_DRAFT';
  end if;

  -- MONEY: the charge amount is server-authoritative, for both prices. A
  -- caller-supplied amount that disagrees with what the POST owes is rejected
  -- outright.
  --
  -- ADR-0020: a reward listing owes the reward PLUS floor(5%) — the reward
  -- itself is what the spotter will receive. The Edge Function computes the
  -- same number (supabase/functions/_shared/serviceFee.ts); this recomputes it
  -- independently, so a caller still charging the bare reward (the pre-ADR-0020
  -- price) is refused rather than recorded under a split it did not charge.
  if v_bounty is null then
    v_kind    := 'listing_fee';
    v_pricing := 'flat_fee';
    v_reward  := null;
    v_fee     := c_listing_fee;
    if p_amount_pence is distinct from c_listing_fee then
      raise exception 'BOUNTY_MISMATCH';
    end if;
  else
    v_kind    := 'bounty_escrow';
    v_pricing := 'fee_on_top';
    v_reward  := v_bounty;
    v_fee     := (v_bounty * 5) / 100;
    if p_amount_pence is distinct from v_reward + v_fee then
      raise exception 'BOUNTY_MISMATCH';
    end if;
  end if;

  -- Escrow already captured? A 'held' row shouldn't coexist with a draft post
  -- (mark_post_payment_held advances the post out of draft), but guard
  -- defensively: never open a second charge row over a captured one.
  if exists (
    select 1 from public.payments where post_id = p_post_id and status = 'held'
  ) then
    return;
  end if;

  -- IDEMPOTENT reuse vs SUPERSEDE — keyed on the INTENT, not the amount:
  --   * a live 'requires_payment' row for THIS intent is the in-flight retry —
  --     Stripe's idempotency key handed back the same intent — so reuse it;
  --   * every OTHER live 'requires_payment' row is superseded (-> 'failed'),
  --     whatever its amount, and this intent is recorded.
  --
  -- ⚠️ This matched on AMOUNT until 2026-09-25, and that stranded money: a
  -- live row at the same amount but a DIFFERENT intent made this return early
  -- without recording the new intent — which the app then paid anyway, and
  -- the webhook, finding no ledger row, ignored. The card was charged, the post
  -- stayed a draft, and nothing recorded the money. Two ways to reach it: a
  -- Stripe idempotency key expiring (~24h) between attempts, and — new with
  -- ADR-0020 — a fee_inside row at X after the reward is edited so that
  -- reward + 5% = X, under the new post-reward- key.
  --
  -- create-payment-intent cancels every superseded intent at Stripe BEFORE
  -- calling this — and refuses outright if any of them has already been paid —
  -- so no abandoned intent can later capture.
  if exists (
    select 1 from public.payments
    where post_id = p_post_id
      and status = 'requires_payment'
      and stripe_payment_intent_id = p_payment_intent_id
  ) then
    return;
  end if;

  update public.payments
     set status = 'failed'
   where post_id = p_post_id
     and status = 'requires_payment'
     and stripe_payment_intent_id <> p_payment_intent_id;

  -- Insert the ledger row with its split stated, never inferred:
  -- payments_fill_legacy_split only fills rows that arrive WITHOUT a pricing.
  insert into public.payments
    (post_id, stripe_payment_intent_id, status, amount_pence, kind,
     pricing, reward_pence, service_fee_pence)
  values
    (p_post_id, p_payment_intent_id, 'requires_payment', p_amount_pence, v_kind,
     v_pricing, v_reward, v_fee)
  on conflict (stripe_payment_intent_id) do nothing;
end;
$$;

comment on function public.record_post_payment_intent(uuid, text, integer) is
  'Records the PaymentIntent for a DRAFT post as a requires_payment payments row. SECURITY DEFINER, service-role only. MONEY: a reward listing owes reward + floor(5%) and records pricing=fee_on_top with reward_pence/service_fee_pence (ADR-0020, 20260925100000); a listing with a NULL bounty owes exactly the flat 500p fee (kind=listing_fee, pricing=flat_fee). The amount is server-authoritative and raises BOUNTY_MISMATCH when it disagrees with what the post owes, POST_NOT_DRAFT if the post is missing/not draft. IDEMPOTENT + edit-safe, keyed on the INTENT (since 20260925100000; it was keyed on the amount, which could leave a paid intent unrecorded): a retry of the SAME intent reuses its live requires_payment row (a held row is left untouched); every OTHER live requires_payment row is superseded to failed and this intent recorded. ON CONFLICT DO NOTHING on the unique intent id makes re-recording the same intent a no-op.';


-- =============================================================================
-- 8a. mark_recovery_paid — the transfer must equal the reward, re-derived.
--     Restated from 20260802220000. The Edge Function reads reward_pence to
--     create the transfer; this re-derives the share from the charge and the
--     pricing and refuses anything else, so the two remain independent
--     derivations that must agree — the property the original was written for.
-- =============================================================================
create or replace function public.mark_recovery_paid(
  p_payment_intent_id     text,
  p_transfer_id           text,
  p_payee_account_id      uuid,
  p_transfer_amount_pence integer,
  p_platform_fee_pence    integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post_id  uuid;
  v_amount   integer;
  v_reward   integer;
  v_fee      integer;
  v_pricing  public.payment_pricing;
  v_expected integer;
begin
  -- Lock the ledger row so payment + post move atomically against a concurrent
  -- redelivery of the same Stripe event.
  select post_id, amount_pence, reward_pence, service_fee_pence, pricing
    into v_post_id, v_amount, v_reward, v_fee, v_pricing
  from public.payments
  where stripe_payment_intent_id = p_payment_intent_id
  for update;

  -- Benign no-op: a transfer for an intent we never recorded.
  if not found then
    return;
  end if;

  -- MONEY: RE-DERIVE the spotter's share from the CHARGE and the row's
  -- pricing, here, independently of the stored reward_pence the Edge Function
  -- read to create the transfer. Comparing only against that stored column
  -- would make this check agree with its caller by construction.
  --   fee_on_top: charge = reward + floor(5% of reward), so the reward is the
  --               charge minus a fee that must itself be 5% of the reward;
  --   fee_inside: the pre-ADR-0020 rule, payout_split's 95%.
  v_expected := case v_pricing
    when 'fee_on_top' then v_reward
    when 'fee_inside' then (select transfer_pence from public.payout_split(v_amount))
  end;
  if v_pricing = 'fee_on_top'
     and (v_reward is null or v_fee is distinct from (v_reward * 5) / 100
          or v_reward + v_fee is distinct from v_amount) then
    v_expected := null;
  end if;

  -- The split recorded at charge time is the only split this payment may be
  -- paid out under, and it must equal the re-derivation above. Raises rather
  -- than no-ops — money has already moved by now, so silently declining to
  -- record it would strand a real transfer.
  if v_expected is null
     or v_reward is distinct from v_expected
     or p_transfer_amount_pence <> v_expected
     or p_platform_fee_pence <> v_amount - v_expected then
    raise exception
      'PAYOUT_SPLIT_MISMATCH: got %/% for a % % charge, expected %/%',
      p_transfer_amount_pence, p_platform_fee_pence, v_amount, v_pricing,
      v_expected, v_amount - v_expected;
  end if;

  -- SAFETY: a payout requires a credited sighting. Without one there is nobody
  -- this money belongs to, and the correct ending is a refund
  -- (mark_post_recovered_no_spotter). The exact inverse of that function's
  -- guard, so the two endings can never be confused for one another.
  if not exists (
    select 1 from public.sightings
    where post_id = v_post_id and status = 'credited'
  ) then
    raise exception 'PAYOUT_WITHOUT_CREDITED_SIGHTING';
  end if;

  -- Escrow held -> released. Guarded on 'held' so a duplicate or late delivery
  -- never regresses a later state or rewrites the recorded transfer.
  -- released_at is stamped by payments_stamp_settled_at.
  update public.payments
     set status                = 'released',
         stripe_transfer_id    = p_transfer_id,
         payee_account_id      = p_payee_account_id,
         transfer_amount_pence = p_transfer_amount_pence,
         platform_fee_pence    = p_platform_fee_pence
   where stripe_payment_intent_id = p_payment_intent_id
     and status = 'held';

  -- Terminal state, ONLY from recovery_claimed. An allowlist of one: this must
  -- never close an active post, nor re-close an already-terminal one.
  update public.posts
     set status = 'recovered'
   where id = v_post_id
     and status = 'recovery_claimed';
end $$;

comment on function public.mark_recovery_paid(text, text, uuid, integer, integer) is
  'Records the reward transfer to a credited spotter: payments held->released, post recovery_claimed->recovered. Re-derives the spotter''s share from the charge and the row''s pricing (fee_on_top: the reward, with the fee re-checked as floor 5%; fee_inside: payout_split''s 95%) and RAISES PAYOUT_SPLIT_MISMATCH unless the stored reward_pence and the transfer both equal it (ADR-0020). Requires a credited sighting (the inverse of mark_post_recovered_no_spotter). Service-role only.';


-- =============================================================================
-- 8b. claim_credited_notification — "You've earned £X" is the stored reward.
--     Restated from 20260922120000; only the amount read changed.
-- =============================================================================
create or replace function public.claim_credited_notification(
  p_post_id uuid,
  p_actor   uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sighting_id uuid;
  v_spotter     uuid;
  v_reward      integer;
  v_kind        text;
  v_title       text;
  v_body        text;
begin
  -- The credited sighting on a post the ACTOR owns. Status may be
  -- recovery_claimed (the normal moment) or recovered (a fast payout finished
  -- first) — both are legitimate times for the spotter to hear the news.
  select s.id, s.spotter_id
    into v_sighting_id, v_spotter
    from public.sightings s
    join public.posts p on p.id = s.post_id
   where s.post_id = p_post_id
     and s.status = 'credited'
     and p.owner_id = p_actor
     and p.status in ('recovery_claimed', 'recovered');

  if v_sighting_id is null then
    return jsonb_build_object('claimed', false);
  end if;

  -- MONEY: the spotter's share is the reward_pence stored on the payment at
  -- charge time — the whole reward on a fee_on_top row, 95% on a fee_inside
  -- one. amount_pence is no longer the number to show: on a fee_on_top row it
  -- includes the service fee, which is never the spotter's.
  --
  -- ⚠️ `kind = 'bounty_escrow'` IS LOAD-BEARING. A £5 listing fee is a payment
  -- row too; reading it here would invent a number on a listing that carries
  -- no reward. (Its reward_pence is NULL as well — a second lock.)
  select p.reward_pence into v_reward
    from public.payments p
   where p.post_id = p_post_id
     and p.status in ('held', 'released')
     and p.kind = 'bounty_escrow'
   limit 1;

  if v_reward is not null then
    -- The COPY, built here so its privacy is DB-testable: an amount and an
    -- instruction. No car, no plate, no location, no owner name.
    v_kind  := 'credited';
    v_title := 'You''ve earned £' || to_char(v_reward / 100.0, 'FM999990.00');
    v_body  := 'Tell us where to send it.';
  else
    -- ⚠️ THE REWARDLESS CREDIT. No amount exists, so the copy must not imply
    -- one — and must not apologise for its absence either.
    v_kind  := 'credited_no_reward';
    v_title := 'Your sighting found the car';
    v_body  := 'The owner credited your report.';
  end if;

  -- ⚠️ THE CLAIM IS LAST. Nothing is consumed unless there is something to
  -- send; two concurrent callers both build copy and exactly one wins.
  update public.sightings
     set credited_notified_at = now()
   where id = v_sighting_id
     and credited_notified_at is null
  returning id into v_sighting_id;

  if v_sighting_id is null then
    return jsonb_build_object('claimed', false);
  end if;

  return jsonb_build_object(
    'claimed', true,
    'user_id', v_spotter,
    'post_id', p_post_id,
    -- The CALLER must send this kind rather than assume 'credited' — the two
    -- branches route to different screens.
    'kind',    v_kind,
    'title',   v_title,
    'body',    v_body
  );
end $$;

comment on function public.claim_credited_notification(uuid, uuid) is
  'One-shot claim for the credited-spotter notification. Verifies the ACTOR owns the post and a credited sighting exists, builds the copy — a bounty_escrow payment gives "You''ve earned £X" from its STORED reward_pence (ADR-0020: the reward in full on fee_on_top, 95% on a legacy fee_inside row), its absence gives the rewardless "your sighting found the car" — and ONLY THEN claims via conditional update on sightings.credited_notified_at. Returns the `kind` to send. Every refusal returns the identical {claimed:false}. SERVICE ROLE ONLY.';


-- =============================================================================
-- 8c. claim_dispute_outcome_notification — the upheld amount is the stored
--     reward. Restated from 20260922120000; only the amount read changed, plus
--     the `kind` filter every other money read carries.
-- =============================================================================
create or replace function public.claim_dispute_outcome_notification(
  p_dispute_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id      uuid;
  v_status  text;
  v_spotter uuid;
  v_post    uuid;
  v_sight   uuid;
  v_reward  integer;
begin
  -- Resolved and unclaimed only. The conditional update IS the idempotency.
  update public.refund_disputes
     set outcome_notified_at = now()
   where id = p_dispute_id
     and status in ('upheld', 'rejected')
     and outcome_notified_at is null
  returning id, status, spotter_id, post_id, sighting_id
    into v_id, v_status, v_spotter, v_post, v_sight;

  if v_id is null then
    return jsonb_build_object('claimed', false);
  end if;

  if v_status = 'rejected' then
    -- Final and calm. No reasons: the evidence was weighed by a person, and
    -- a reasons string would become an argument surface.
    return jsonb_build_object(
      'claimed', true,
      'kind', 'dispute_rejected',
      'user_id', v_spotter,
      'sighting_id', v_sight,
      'title', 'About your sighting',
      'body', 'We looked into it — this reward won''t be coming to you. Thank you for reporting it.'
    );
  end if;

  -- UPHELD: the earn moment, same shape as the credited push. held OR
  -- released — a fast payout may already have beaten this claim.
  select p.reward_pence into v_reward
    from public.payments p
   where p.post_id = v_post
     and p.status in ('held', 'released')
     and p.kind = 'bounty_escrow'
   limit 1;

  if v_reward is null then
    -- An upheld dispute with no funded payment should be impossible. Send no
    -- push rather than inventing a number (the claim stays consumed; the
    -- anomaly is for the logs, not the spotter).
    return jsonb_build_object('claimed', false);
  end if;

  return jsonb_build_object(
    'claimed', true,
    'kind', 'dispute_upheld',
    'user_id', v_spotter,
    'sighting_id', v_sight,
    'title', 'You were right — you''ve earned £' || to_char(v_reward / 100.0, 'FM999990.00'),
    'body', 'Tell us where to send it.'
  );
end $$;

comment on function public.claim_dispute_outcome_notification(uuid) is
  'One-shot claim for a resolved dispute''s outcome push. Conditional update on outcome_notified_at is the idempotency (the sweep retries; the spotter hears once). The upheld amount is the payment''s STORED reward_pence (ADR-0020), mirroring claim_credited_notification. Every refusal returns the identical {claimed:false}. SERVICE ROLE ONLY.';


-- =============================================================================
-- 8d. my_pending_credit — the /payouts context line reads the stored reward.
--     Restated from 20260804110000; the amount read changed, and the join
--     gains the `kind = 'bounty_escrow'` filter every money read carries.
-- =============================================================================
create or replace function public.my_pending_credit()
returns table (post_id uuid, transfer_pence integer)
language sql
security definer
set search_path = ''
as $$
  select s.post_id, p.reward_pence
    from public.sightings s
    join public.posts po on po.id = s.post_id
    join public.payments p on p.post_id = s.post_id
   where s.spotter_id = (select auth.uid())
     and s.status = 'credited'
     and po.status = 'recovery_claimed'
     and p.status = 'held'
     and p.kind = 'bounty_escrow'
   order by s.created_at desc
   limit 1;
$$;

comment on function public.my_pending_credit() is
  'The caller''s credited-but-unpaid reward (post id + the payment''s stored reward_pence — ADR-0020), or no rows. Caller-scoped on auth.uid(); single winner per post and `limit 1` across posts keeps it one row. Powers the "You''ve earned £X" context on /payouts.';


-- =============================================================================
-- 8e. my_dispute_context — the share shown on the dispute screen is the stored
--     reward. Restated from 20260805100000; the amount read changed, and the
--     payment join gains the `kind = 'bounty_escrow'` filter. The availability
--     predicate is untouched here.
-- =============================================================================
create or replace function public.my_dispute_context(p_sighting_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_row    record;
begin
  if v_caller is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select h.expires_at, po.make, po.colour, pay.reward_pence,
         d.status as dispute_status, d.created_at as dispute_created_at
    into v_row
    from public.sightings s
    join public.refund_holds h on h.post_id = s.post_id
    join public.posts po on po.id = s.post_id
    left join public.payments pay
      on pay.post_id = s.post_id
     and pay.status = 'held'
     and pay.kind = 'bounty_escrow'
    left join public.refund_disputes d on d.sighting_id = s.id
   where s.id = p_sighting_id
     and s.spotter_id = v_caller
     and s.id = any (h.sighting_ids);

  if not found then
    raise exception 'DISPUTE_NOT_AVAILABLE';
  end if;

  return jsonb_build_object(
    'car', jsonb_build_object('make', v_row.make, 'colour', v_row.colour),
    'windowEndsAt', v_row.expires_at,
    -- The key keeps its name: renaming it is a client contract change for no
    -- behaviour. The VALUE is now the stored reward, not a payout_split share.
    'bountySharePence', v_row.reward_pence,
    'dispute', case when v_row.dispute_status is null then null
      else jsonb_build_object('status', v_row.dispute_status, 'createdAt', v_row.dispute_created_at)
    end
  );
end $$;

comment on function public.my_dispute_context(uuid) is
  'The dispute screen''s read: own sighting on a held post only. Car make/colour (what the spotter already saw), deadline, their dispute if any, and the payment''s stored reward_pence as bountySharePence (null once the money moved; ADR-0020). No owner identity, no location, no plate. Single refusal token.';


-- =============================================================================
-- 9. payout_split is now the fee_inside rule only.
-- =============================================================================
comment on function public.payout_split(integer) is
  'The fee_inside split (ADR-0002, every escrow row charged before 2026-09-25): 95% to the spotter, the remainder to the platform, integer pence. Since ADR-0020 no payout path calls it — the split is stored on each payments row at charge time — but payments_split_check encodes the same arithmetic for fee_inside rows and the verification suites use it as the reference.';

commit;

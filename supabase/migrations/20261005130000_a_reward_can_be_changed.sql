-- =============================================================================
-- WHAT:  The charge path for changing the reward on a LIVE listing (PR2 of the
--        60-day reward plan):
--          1. posts.renewal_amount_pence — the amount the owner chose for the
--             next charge, written ONLY by set_reward_renewal_amount, so the
--             charge function still never takes an amount from the client.
--          2. reward_has_claim / reward_change_block — the ONE definition of
--             "may this listing's reward be changed right now?".
--          3. set_reward_renewal_amount (owner), reward_charge_context and
--             record_reward_renewal_intent (service role), get_my_reward_status
--             (owner, for the screen and its poll).
--          4. mark_post_payment_held learns ADD: a live listing with no reward
--             (a £5 fee listing) takes one when the capture is exactly the
--             amount the owner chose.
--        Two modes, one path:
--          * CHANGE — a reward is held: a new charge for the chosen amount
--            replaces it (20261005110000's renewal), and the old one is
--            refunded minus the card fee (the owner chose this; disclosed
--            before they pay). Raising, keeping or (without recent sightings)
--            lowering the amount are all a change.
--          * ADD — nothing is held: a fee listing becomes a reward listing.
--            The £5 fee is not refunded (it bought the listing, ADR-0014).
-- WHY:   Stripe caps funds on the platform balance at 90 days (lead support,
--        2026-10-05), so every reward is about to get a 60-day term — and a
--        term is only fair if the owner can renew it. Renewal IS "change the
--        reward to the same amount", so this ships first, standing alone as
--        the long-missing way to raise a reward without deactivate + repost
--        (vehicles/post/README.md; ROADMAP "bounty top-ups").
--
-- SAFETY: ⚠️ A REWARD CANNOT BE LOWERED WHILE RECENT UNCREDITED SIGHTINGS EXIST.
--        Otherwise an owner could cut the reward the moment a spotter's
--        sighting led them to the car, then credit that spotter on the smaller
--        amount. It reuses recent_uncredited_sightings — the same 14-day
--        definition that holds an exit refund (ADR-0011) — so the two rules
--        can never disagree about which sightings count. Raising is always
--        allowed: it only ever gives spotters more.
--        A change is refused outright while anyone has a claim on the money
--        (a refund hold, an open or upheld dispute, a credited sighting, an
--        unresolved payout review) or while the last change's refund is still
--        on its way.
--        ⚠️ ALL OF IT IS CHECKED AGAIN AT CAPTURE. A PaymentIntent never
--        expires and can be confirmed long after it was opened, so
--        mark_post_payment_held re-checks the claims, the post is live, the
--        LOWERING RULE, and that the charge is the owner's CURRENT choice (a
--        fresh renewal_attempt_id per choice, at exactly the chosen amount).
--        A charge that fails any of these becomes a stray, refunded in full,
--        and the reward it would have replaced stays exactly where it was.
--
-- SAFETY NOTE ON DESTRUCTIVE STATEMENTS: none. One additive nullable column;
--        `create or replace` on one existing function (mark_post_payment_held,
--        restated IN FULL from 20261005110000 — diff against it) plus six new
--        functions. No row is written.
--
-- LINKS: supabase/migrations/20261005110000_a_reward_can_be_replaced.sql;
--        supabase/migrations/20260805100000_refund_holds_and_disputes.sql
--          (recent_uncredited_sightings);
--        supabase/functions/create-payment-intent/index.ts (the live branch);
--        supabase/functions/stripe-webhook/index.ts (refunds the old reward);
--        src/features/payments/screens/ChangeRewardScreen.tsx;
--        supabase/tests/reward_change_verification.sql.
-- =============================================================================


-- =============================================================================
-- 1. The owner's chosen next amount
-- =============================================================================
alter table public.posts
  add column renewal_amount_pence integer
    constraint posts_renewal_amount_range_chk
    check (renewal_amount_pence is null or renewal_amount_pence between 1000 and 500000),
  add column renewal_attempt_id uuid;

comment on column public.posts.renewal_amount_pence is
  'MONEY: the reward amount the owner chose for the NEXT charge on a live listing (change, renew or add), in pence. Written only by set_reward_renewal_amount; read by create-payment-intent so the client never sends an amount; cleared when that charge becomes the reward. Not client-readable (posts'' column-enumerated grant).';
comment on column public.posts.renewal_attempt_id is
  'MONEY: a fresh id minted by set_reward_renewal_amount EVERY time the owner chooses an amount. The charge for that choice carries it (payments.renewal_attempt_id) and is keyed by it; at capture, only a charge carrying the CURRENT attempt id may become the reward. An intent from an earlier choice — abandoned, or prepared and held back — can therefore never be confirmed into the reward later (it lands as a stray, refunded in full). Cleared when the attempt''s charge becomes the reward.';

alter table public.payments
  add column renewal_attempt_id uuid;

comment on column public.payments.renewal_attempt_id is
  'For a reward charge on a LIVE listing (change / add): the posts.renewal_attempt_id it was created for. NULL for draft-era and fee charges. mark_post_payment_held requires it to match the post''s current attempt before the charge may become the reward.';


-- =============================================================================
-- 2. The one definition of "may the reward change now?"
-- =============================================================================
-- Someone has a claim on this listing's money. The same four conditions
-- mark_post_payment_held (20261005110000) checks before it lets a renewal
-- supersede a reward — restated there below to call this, so there is one copy.
create or replace function public.reward_has_claim(p_post_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (select 1 from public.refund_holds h where h.post_id = p_post_id)
      or exists (select 1 from public.refund_disputes d
                  where d.post_id = p_post_id and d.status in ('open', 'upheld'))
      or exists (select 1 from public.sightings s
                  where s.post_id = p_post_id and s.status = 'credited')
      or exists (select 1 from public.payout_reviews r
                  where r.post_id = p_post_id and r.resolved_at is null);
$$;

comment on function public.reward_has_claim(uuid) is
  'True while anyone has a claim on a listing''s reward money: a refund hold, an open/upheld dispute, a credited sighting, or an unresolved payout review. The one definition shared by reward_change_block and mark_post_payment_held''s renewal/add branches. Not directly grantable.';

revoke all on function public.reward_has_claim(uuid) from public, anon, authenticated;

-- Why a change is refused right now, as the one refusal token the client maps
-- to copy — or NULL when it may go ahead. p_amount_pence (nullable) adds the
-- lowering rule; omit it to ask "can this listing be changed at all?".
create or replace function public.reward_change_block(p_post_id uuid, p_amount_pence integer default null)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_status  public.post_status;
  v_current integer;
begin
  select status into v_status from public.posts where id = p_post_id;
  if v_status is null or v_status not in ('active', 'pending_verification') then
    return 'POST_NOT_LIVE';
  end if;
  if public.reward_has_claim(p_post_id) then
    return 'REWARD_REVIEW_PENDING';
  end if;
  -- One change at a time: the last change's old payment is still being
  -- refunded. Usually minutes (the webhook refunds it at once; the sweep
  -- within the hour).
  if exists (
    select 1 from public.payments
     where post_id = p_post_id and status = 'superseded' and kind = 'bounty_escrow'
  ) then
    return 'REFUND_PENDING';
  end if;
  if p_amount_pence is not null then
    select amount_pence into v_current
      from public.payments
     where post_id = p_post_id and status = 'held' and kind = 'bounty_escrow';
    if v_current is not null
       and p_amount_pence < v_current
       and exists (select 1 from public.recent_uncredited_sightings(p_post_id)) then
      return 'REWARD_LOWER_BLOCKED';
    end if;
  end if;
  return null;
end $$;

comment on function public.reward_change_block(uuid, integer) is
  'Why a live listing''s reward cannot be changed right now, or NULL: POST_NOT_LIVE, REWARD_REVIEW_PENDING (reward_has_claim), REFUND_PENDING (the last change''s old payment is still being refunded), REWARD_LOWER_BLOCKED (lowering while recent_uncredited_sightings exist — ADR-0011''s 14-day definition). Not directly grantable; called by the reward RPCs below.';

revoke all on function public.reward_change_block(uuid, integer) from public, anon, authenticated;


-- =============================================================================
-- 3. set_reward_renewal_amount — the owner chooses the next amount
-- =============================================================================
-- Mirrors update_post_bounty (the draft-time twin): the client writes the
-- amount here, under its own JWT, and the charge function reads it back from
-- the row — so create-payment-intent still never takes an amount from a
-- request body (SECURITY_AND_TRUST §4).
create or replace function public.set_reward_renewal_amount(
  p_post_id      uuid,
  p_amount_pence integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_owner  uuid;
  v_block  text;
begin
  if v_caller is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select owner_id into v_owner from public.posts where id = p_post_id for update;
  if v_owner is null or v_owner <> v_caller then
    raise exception 'POST_NOT_FOUND';
  end if;

  if p_amount_pence is null or p_amount_pence < 1000 or p_amount_pence > 500000 then
    raise exception 'BOUNTY_OUT_OF_RANGE';
  end if;

  v_block := public.reward_change_block(p_post_id, p_amount_pence);
  if v_block is not null then
    raise exception '%', v_block;
  end if;

  -- A FRESH attempt every time: any intent made for an earlier choice stops
  -- being able to become the reward the moment the owner chooses again.
  update public.posts
     set renewal_amount_pence = p_amount_pence,
         renewal_attempt_id   = gen_random_uuid()
   where id = p_post_id;
  return jsonb_build_object('amountPence', p_amount_pence);
end $$;

comment on function public.set_reward_renewal_amount(uuid, integer) is
  'Owner chooses the amount for the next reward charge on their LIVE listing (change, renew or add). Owner from auth.uid(); POST_NOT_FOUND for missing and not-owned alike; BOUNTY_OUT_OF_RANGE outside £10–£5,000; then reward_change_block''s token (POST_NOT_LIVE / REWARD_REVIEW_PENDING / REFUND_PENDING / REWARD_LOWER_BLOCKED). Writes posts.renewal_amount_pence and a FRESH posts.renewal_attempt_id (so no intent from an earlier choice can later become the reward) — no money moves until the owner pays.';

revoke all on function public.set_reward_renewal_amount(uuid, integer) from public, anon;
grant execute on function public.set_reward_renewal_amount(uuid, integer) to authenticated, service_role;


-- =============================================================================
-- 4. reward_charge_context — what create-payment-intent may charge
-- =============================================================================
create or replace function public.reward_charge_context(p_post_id uuid, p_owner_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_post    record;
  v_current record;
  v_block   text;
begin
  select owner_id, status, renewal_amount_pence, renewal_attempt_id into v_post
    from public.posts where id = p_post_id;
  if v_post.owner_id is null or v_post.owner_id <> p_owner_id then
    raise exception 'POST_NOT_FOUND';
  end if;

  select id, stripe_payment_intent_id, amount_pence into v_current
    from public.payments
   where post_id = p_post_id and status = 'held' and kind = 'bounty_escrow';

  v_block := coalesce(
    public.reward_change_block(p_post_id, v_post.renewal_amount_pence),
    case when v_post.renewal_amount_pence is null or v_post.renewal_attempt_id is null then 'NO_AMOUNT' end
  );

  return jsonb_build_object(
    'mode',                   case when v_current.id is null then 'add' else 'change' end,
    'currentPaymentId',       v_current.id,
    'currentPaymentIntentId', v_current.stripe_payment_intent_id,
    'currentAmountPence',     v_current.amount_pence,
    'renewalAmountPence',     v_post.renewal_amount_pence,
    -- The idempotency key's nonce: one intent per CHOICE. A network retry of
    -- the same choice reuses its intent; a new choice can never be answered
    -- with an earlier one's.
    'attemptId',              v_post.renewal_attempt_id,
    'block',                  v_block
  );
end $$;

comment on function public.reward_charge_context(uuid, uuid) is
  'What create-payment-intent may charge on a LIVE listing: mode (change = a reward is held, add = none), the held payment it would replace, the owner''s chosen renewal_amount_pence and its attemptId (the idempotency key''s nonce), and a block token (reward_change_block, or NO_AMOUNT). Owner passed by the VERIFIED caller. SERVICE ROLE ONLY.';

revoke all on function public.reward_charge_context(uuid, uuid) from public, anon, authenticated;
grant execute on function public.reward_charge_context(uuid, uuid) to service_role;


-- =============================================================================
-- 5. record_reward_renewal_intent — the ledger row for a live-listing charge
-- =============================================================================
-- The live-listing twin of record_post_payment_intent: every guard re-checked
-- UNDER THE POST LOCK, because the context read above and this write are
-- separate requests' worth apart.
create or replace function public.record_reward_renewal_intent(
  p_post_id             uuid,
  p_owner_id            uuid,
  p_payment_intent_id   text,
  p_amount_pence        integer,
  p_replaces_payment_id uuid,
  p_attempt_id          uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post    record;
  v_current uuid;
  v_block   text;
begin
  select owner_id, renewal_amount_pence, renewal_attempt_id into v_post
    from public.posts where id = p_post_id for update;
  if v_post.owner_id is null or v_post.owner_id <> p_owner_id then
    raise exception 'POST_NOT_FOUND';
  end if;

  -- Idempotent: a retry after a dropped response finds its own row.
  if exists (select 1 from public.payments where stripe_payment_intent_id = p_payment_intent_id) then
    return;
  end if;

  v_block := public.reward_change_block(p_post_id, p_amount_pence);
  if v_block is not null then
    raise exception '%', v_block;
  end if;

  -- MONEY: the amount is the one the OWNER chose, read from the row — never
  -- trusted from the caller — and for THIS choice: the owner choosing again
  -- (another device) between the context read and now makes this stale.
  if v_post.renewal_amount_pence is distinct from p_amount_pence then
    raise exception 'BOUNTY_MISMATCH';
  end if;
  if p_attempt_id is null or v_post.renewal_attempt_id is distinct from p_attempt_id then
    raise exception 'RENEWAL_STALE';
  end if;

  select id into v_current
    from public.payments
   where post_id = p_post_id and status = 'held' and kind = 'bounty_escrow';
  if v_current is distinct from p_replaces_payment_id then
    -- The reward changed between the context read and now (another device,
    -- a capture landing). Charging against a stale reward would make this
    -- capture a stray; refuse and let the client start again.
    raise exception 'RENEWAL_STALE';
  end if;

  -- Any other open reward charge on this listing is an abandoned attempt
  -- (create-payment-intent cancels it at Stripe first). 'failed' is what
  -- record_post_payment_intent uses for the same supersede; a late success
  -- on it lands as a stray and is refunded in full.
  update public.payments
     set status = 'failed'
   where post_id = p_post_id
     and status = 'requires_payment'
     and kind = 'bounty_escrow';

  insert into public.payments
    (post_id, stripe_payment_intent_id, status, amount_pence, kind, replaces_payment_id, renewal_attempt_id)
  values
    (p_post_id, p_payment_intent_id, 'requires_payment', p_amount_pence, 'bounty_escrow',
     p_replaces_payment_id, p_attempt_id)
  on conflict (stripe_payment_intent_id) do nothing;
end $$;

comment on function public.record_reward_renewal_intent(uuid, uuid, text, integer, uuid, uuid) is
  'Records the ledger row for a reward charge on a LIVE listing. Under the post lock: owner (POST_NOT_FOUND), idempotent on the intent id, reward_change_block (POST_NOT_LIVE / REWARD_REVIEW_PENDING / REFUND_PENDING / REWARD_LOWER_BLOCKED), amount = posts.renewal_amount_pence (BOUNTY_MISMATCH), attempt = posts.renewal_attempt_id and replaces = the current held payment or NULL for add (RENEWAL_STALE). Stamps the row with the attempt id. Older open reward intents on the post are superseded to failed (create-payment-intent cancels them at Stripe). SERVICE ROLE ONLY.';

revoke all on function public.record_reward_renewal_intent(uuid, uuid, text, integer, uuid, uuid) from public, anon, authenticated;
grant execute on function public.record_reward_renewal_intent(uuid, uuid, text, integer, uuid, uuid) to service_role;


-- =============================================================================
-- 6. get_my_reward_status — what the owner's screen shows, and what it polls
-- =============================================================================
create or replace function public.get_my_reward_status(p_post_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caller  uuid := auth.uid();
  v_post    record;
  v_current record;
begin
  if v_caller is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;
  select owner_id, status, bounty_amount_pence into v_post
    from public.posts where id = p_post_id;
  if v_post.owner_id is null or v_post.owner_id <> v_caller then
    raise exception 'POST_NOT_FOUND';
  end if;

  select id, amount_pence, captured_at, refund_fee_absorbed into v_current
    from public.payments
   where post_id = p_post_id and status = 'held' and kind = 'bounty_escrow';

  return jsonb_build_object(
    'postStatus',          v_post.status,
    'mode',                case when v_current.id is null then 'add' else 'change' end,
    -- An opaque token that changes exactly when the reward does — the screen
    -- polls for it after the PaymentSheet closes.
    'rewardId',            v_current.id,
    'amountPence',         v_current.amount_pence,
    'capturedAt',          v_current.captured_at,
    'feeAbsorbed',         coalesce(v_current.refund_fee_absorbed, false),
    'hasRecentSightings',  exists (select 1 from public.recent_uncredited_sightings(p_post_id)),
    'block',               public.reward_change_block(p_post_id)
  );
end $$;

comment on function public.get_my_reward_status(uuid) is
  'The owner''s view of their live listing''s reward: mode (change/add), rewardId (changes exactly when the reward does — polled after payment), amount, capture time, whether its refund absorbs the card fee, whether recent uncredited sightings exist (lowering is then refused), and the current block token. Owner from auth.uid(); POST_NOT_FOUND for missing and not-owned alike.';

revoke all on function public.get_my_reward_status(uuid) from public, anon;
grant execute on function public.get_my_reward_status(uuid) to authenticated, service_role;


-- =============================================================================
-- 7. mark_post_payment_held — ADD, and the renewal re-check through
--    reward_has_claim
-- =============================================================================
-- ⚠️ RESTATED IN FULL from 20261005110000. What changes:
--   * a charge may change a live reward only if it is the owner's CURRENT
--     choice (v_is_choice: its renewal_attempt_id is the post's current one,
--     at exactly renewal_amount_pence) — so an old or held-back intent can
--     never be confirmed into the reward later;
--   * the renewal branch's four inline claim checks become reward_has_claim
--     (same four conditions, now one copy), it RE-CHECKS THE LOWERING RULE at
--     capture (a sighting can land while the sheet is open), and it clears
--     the choice once the new reward is held;
--   * NEW: the ADD branch. A live listing with no reward and no bounty (a £5
--     fee listing) takes one when the capture names nothing to replace, is
--     exactly posts.renewal_amount_pence, and nobody has a claim. The post now
--     offers that reward. Anything else on a live fee listing is still a stray.
-- Everything else — the lock order, the fee branch, never-regress, strays,
-- the draft path — is byte-identical; diff it.
create or replace function public.mark_post_payment_held(
  p_payment_intent_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post_id      uuid;
  v_post_status  public.post_status;
  v_post_bounty  integer;
  v_post_renewal integer;
  v_post_attempt uuid;
  v_pay          record;
  v_current      uuid;
  v_current_amt  integer;
  v_is_choice    boolean;
begin
  -- Which post? Read unlocked first: the lock order is POST, then payment.
  select post_id into v_post_id
    from public.payments
   where stripe_payment_intent_id = p_payment_intent_id;

  -- Benign no-op: a success webhook for an intent we never recorded.
  if not found then
    return;
  end if;

  if v_post_id is not null then
    select status, bounty_amount_pence, renewal_amount_pence, renewal_attempt_id
      into v_post_status, v_post_bounty, v_post_renewal, v_post_attempt
      from public.posts where id = v_post_id
       for update;
  end if;

  select id, kind, status, amount_pence, replaces_payment_id, renewal_attempt_id
    into v_pay
    from public.payments
   where stripe_payment_intent_id = p_payment_intent_id
     for update;

  -- The row went between the two reads (a draft deleted with its intents).
  if not found then
    return;
  end if;

  -- NEVER REGRESS: only an uncaptured row advances. A duplicate delivery, or
  -- a late one after the row was released/refunded/collected/superseded, is
  -- a no-op.
  if v_pay.status not in ('requires_payment', 'failed') then
    return;
  end if;

  -- --- A listing fee: ours on capture (ADR-0018) — unchanged -----------------
  -- ⚠️ THE CASTS ARE REQUIRED (see 20260902130000): a bare literal assigned
  -- through CASE resolves to text and fails at runtime, not at create time.
  if v_pay.kind = 'listing_fee' then
    update public.payments
       set status      = 'collected'::public.payment_status,
           captured_at = now()
     where id = v_pay.id;

    update public.posts
       set status = 'active'
     where id = v_post_id
       and status = 'draft';
    return;
  end if;

  -- --- A bounty --------------------------------------------------------------
  -- The reward currently on offer, if any (the unique index: at most one).
  select id, amount_pence into v_current, v_current_amt
    from public.payments
   where post_id = v_post_id
     and status = 'held'
     and id <> v_pay.id;

  -- ⚠️ THE OWNER'S CURRENT CHOICE, AND NOTHING ELSE, MAY CHANGE A LIVE REWARD.
  -- A PaymentIntent never expires and its client secret is enough to confirm
  -- it, so "the charge was valid when it was created" proves nothing at
  -- capture. A charge may become a live listing's reward only if it was made
  -- for the CURRENT attempt (set_reward_renewal_amount mints a fresh one on
  -- every choice) at exactly the amount chosen. An intent from an earlier
  -- choice — abandoned when the owner tapped Pay again, or prepared and held
  -- back — is a stray, refunded in full.
  v_is_choice := coalesce(
    v_pay.renewal_attempt_id is not null
      and v_pay.renewal_attempt_id = v_post_attempt
      and v_pay.amount_pence = v_post_renewal,
    false);

  if v_current is not null then
    -- ⚠️ A RENEWAL IS ONLY A RENEWAL ON A LIVE, UNCONTESTED POST — CHECKED AT
    -- CAPTURE, not just when the intent was created (see 20261005110000 for
    -- the scenarios: a deactivation with a hold, or a credited recovery,
    -- between opening the sheet and confirming it). reward_has_claim is the
    -- same four conditions that check spelled out inline.
    -- ⚠️ AND THE LOWERING RULE AGAIN, HERE: a sighting can arrive while the
    -- PaymentSheet is open. Without this an owner could choose £10 with no
    -- sightings, wait for the sighting that finds the car, then confirm —
    -- and credit the spotter on the smaller reward.
    if v_pay.replaces_payment_id = v_current
       and v_is_choice
       and v_post_status in ('active', 'pending_verification')
       and not public.reward_has_claim(v_post_id)
       and not (
         v_pay.amount_pence < v_current_amt
         and exists (select 1 from public.recent_uncredited_sightings(v_post_id))
       ) then
      -- RENEWAL: in ONE transaction the old payment stops being held and the
      -- new one starts, so the post is never without a reward and never has
      -- two. The old one is owed back to the owner (refunds_due; the webhook
      -- refunds it at once as a best effort).
      update public.payments
         set status                   = 'superseded'::public.payment_status,
             superseded_at            = now(),
             superseded_by_payment_id = v_pay.id
       where id = v_current;

      update public.payments
         set status      = 'held'::public.payment_status,
             captured_at = now()
       where id = v_pay.id;

      -- The listing now offers the new amount, and the choice is spent.
      update public.posts
         set bounty_amount_pence  = v_pay.amount_pence,
             renewal_amount_pence = null,
             renewal_attempt_id   = null
       where id = v_post_id;
    else
      -- STRAY: a reward is already held and this charge was not taken to
      -- replace it — a late success on an intent that was voided when the
      -- owner changed the amount, a renewal that went stale, or a renewal
      -- confirmed after the post closed or came under a claim. It must not
      -- become a second held row (the index forbids it, and the webhook would
      -- then fail forever). The owner never chose this charge, so it comes
      -- back IN FULL.
      update public.payments
         set status                   = 'superseded'::public.payment_status,
             captured_at              = now(),
             superseded_at            = now(),
             superseded_by_payment_id = v_current,
             refund_fee_absorbed      = true
       where id = v_pay.id;
    end if;
    return;
  end if;

  -- No reward is held on the post.
  -- ADD: a LIVE listing with no reward at all (a £5 fee listing) takes one —
  -- but only the charge the owner chose (exactly renewal_amount_pence, naming
  -- nothing to replace) and only while nobody has a claim. The fee is not
  -- refunded: it bought the listing (ADR-0014).
  -- v_is_choice also rules out a leftover DRAFT-era intent (no attempt id)
  -- that happens to match the chosen amount.
  if v_post_status in ('active', 'pending_verification')
     and v_post_bounty is null
     and v_pay.replaces_payment_id is null
     and v_is_choice
     and not public.reward_has_claim(v_post_id) then
    update public.payments
       set status      = 'held'::public.payment_status,
           captured_at = now()
     where id = v_pay.id;

    update public.posts
       set bounty_amount_pence  = v_pay.amount_pence,
           renewal_amount_pence = null,
           renewal_attempt_id   = null
     where id = v_post_id;
    return;
  end if;

  -- ⚠️ A CLOSED OR MISSING POST NEVER TAKES A REWARD, AND NEITHER DOES A
  -- CHARGE FOR THE WRONG AMOUNT (see 20261005110000): a capture on a
  -- cancelled, recovered or deleted post; a bounty capture on a fee-priced
  -- post that is not the owner's chosen add; a late success on an old draft
  -- intent after the owner changed the amount. Superseded + absorbed sends
  -- each home in full, and the correctly priced intent can still capture.
  if v_post_status is null
     or v_post_status not in ('draft', 'active', 'pending_verification')
     or v_post_bounty is distinct from v_pay.amount_pence then
    update public.payments
       set status              = 'superseded'::public.payment_status,
           captured_at         = now(),
           superseded_at       = now(),
           refund_fee_absorbed = true
     where id = v_pay.id;
    return;
  end if;

  update public.payments
     set status      = 'held'::public.payment_status,
         captured_at = now()
   where id = v_pay.id;

  -- LIVE-ON-PAYMENT: draft -> ACTIVE. Guarded so a late delivery never pulls a
  -- later lifecycle state backwards.
  update public.posts
     set status = 'active'
   where id = v_post_id
     and status = 'draft';

  -- AUDIT: a money-state-transition audit-log insert belongs here once the
  -- audit_log table exists (SECURITY_AND_TRUST §7). Deferred with moderation.
end;
$$;

comment on function public.mark_post_payment_held(text) is
  'Charge-success webhook handler. SECURITY DEFINER, service-role only. Locks the post, then the payment. A listing fee -> collected (ADR-0018). A bounty -> held on a draft/live post charged what it offers (draft -> active); a RENEWAL (the owner''s CURRENT choice — renewal_attempt_id and amount match the post — naming the post''s held payment, post live, no reward_has_claim, not a lowering after a recent sighting) -> held, old payment superseded, post re-priced, choice cleared; an ADD (live fee listing, the current choice, nothing replaced, no claim) -> held and the post now offers it; a STRAY (anything else that would be a second reward, or a closed/deleted/wrong-amount capture) -> superseded with refund_fee_absorbed, refunded in full by the sweep. Stamps captured_at. IDEMPOTENT + never-regress. Unknown intent id = benign no-op. NAME IS HISTORICAL; stripe-webhook calls it by name.';

revoke execute on function public.mark_post_payment_held(text) from public, anon, authenticated;
grant  execute on function public.mark_post_payment_held(text) to service_role;


-- =============================================================================
-- 8. refunds_due learns p_post_id
-- =============================================================================
-- The webhook refunds the replaced reward the moment a change captures, so it
-- needs THIS post's due refunds — not the system-wide oldest-first 50 the
-- sweep reads, which a backlog of older refunds would fill first. Optional,
-- so the sweep's call is unchanged.
-- ⚠️ DROP + CREATE, not create-or-replace: the signature changes, and a
-- second overload would leave the old one callable with the old semantics.
-- The body is 20261005110000's, byte-identical apart from the post filter.
drop function public.refunds_due(integer);

create function public.refunds_due(p_limit integer default 50, p_post_id uuid default null)
returns table (
  payment_id        uuid,
  payment_intent_id text,
  post_id           uuid,
  reason            text
)
language sql
stable
security definer
set search_path = ''
as $$
  select due.payment_id, due.payment_intent_id, due.post_id, due.reason
    from (
      select p.id                        as payment_id,
             p.stripe_payment_intent_id  as payment_intent_id,
             p.post_id                   as post_id,
             h.exit_path                 as reason,
             h.expires_at                as due_at
        from public.refund_holds h
        join public.payments p
          on p.post_id = h.post_id
         and p.status  = 'held'
         and p.kind    = 'bounty_escrow'
       where h.expires_at < now()
         and not exists (
           select 1 from public.refund_disputes d
            where d.post_id = h.post_id
              and d.status in ('open', 'upheld')
         )
      union all
      select p.id, p.stripe_payment_intent_id, p.post_id, 'superseded', p.superseded_at
        from public.payments p
       where p.status = 'superseded'
         and p.kind   = 'bounty_escrow'
         -- SECOND LOCK (see 20261005110000): a renewal-superseded payment
         -- waits only behind a dispute that already existed when it was
         -- superseded; a stray always goes home.
         and (
           p.refund_fee_absorbed
           or not exists (
             select 1 from public.refund_disputes d
              where d.post_id = p.post_id
                and d.status in ('open', 'upheld')
                and d.created_at <= p.superseded_at
           )
         )
    ) due
   where p_post_id is null or due.post_id = p_post_id
   order by due.due_at
   limit greatest(coalesce(p_limit, 50), 0);
$$;

comment on function public.refunds_due(integer, uuid) is
  'THE list of refunds the hourly sweep owes, oldest first: expired refund holds with a held reward and no open/upheld dispute (reason = the hold''s exit_path), and superseded payments (reason superseded; a renewal''s waits only behind a dispute that predates it, a stray never waits). Both branches filter status AND kind = bounty_escrow — fees never qualify. p_post_id narrows it to one post (the webhook, right after a reward change). Read-only. Service-role only.';

revoke all on function public.refunds_due(integer, uuid) from public;
revoke all on function public.refunds_due(integer, uuid) from anon, authenticated;
grant execute on function public.refunds_due(integer, uuid) to service_role;


-- =============================================================================
-- 9. Assert the grants
-- =============================================================================
-- ⚠️ ALTER DEFAULT PRIVILEGES grants EXECUTE on new functions to anon +
-- authenticated (20260713191000); every block above revokes by name, and this
-- checks it took.
do $$
declare
  f text;
begin
  -- Service role only.
  foreach f in array array[
    'public.reward_charge_context(uuid, uuid)',
    'public.record_reward_renewal_intent(uuid, uuid, text, integer, uuid, uuid)',
    'public.mark_post_payment_held(text)',
    'public.refunds_due(integer, uuid)'
  ] loop
    if has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute') then
      raise exception '% is client-executable — a money path must be service-role only', f;
    end if;
    if not has_function_privilege('service_role', f, 'execute') then
      raise exception '% is not executable by service_role', f;
    end if;
  end loop;
  -- Internal helpers: nobody calls these directly.
  foreach f in array array[
    'public.reward_has_claim(uuid)',
    'public.reward_change_block(uuid, integer)'
  ] loop
    if has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute') then
      raise exception '% is client-executable — it is an internal helper', f;
    end if;
  end loop;
  -- Owner RPCs: signed-in users yes (they check auth.uid()), anon never.
  foreach f in array array[
    'public.set_reward_renewal_amount(uuid, integer)',
    'public.get_my_reward_status(uuid)'
  ] loop
    if has_function_privilege('anon', f, 'execute') then
      raise exception '% is executable by anon', f;
    end if;
    if not has_function_privilege('authenticated', f, 'execute') then
      raise exception '% is not executable by a signed-in owner', f;
    end if;
  end loop;
  raise notice 'reward change path: grants as designed.';
end $$;

-- =============================================================================
-- END OF MIGRATION
-- =============================================================================

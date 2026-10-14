-- -----------------------------------------------------------------------------
-- WHAT:  The last leg of a spotter's money — Stripe's payout from their payee
--        account to their BANK — recorded, so the app can say "arrives Tue"
--        and, when a bank refuses it, ask for new details:
--          1. stripe_connected_accounts gains the latest payout (id, status,
--             amount, arrival date, created, failure code) and
--             bank_replaced_at.
--          2. record_payout_event — the webhook's writer for `payout.*`.
--          3. record_bank_replaced — create-payout-account's RE-BANK stamp.
--          4. claim_payout_failed_notification — one push per failed payout.
--          5. Kind 'payout_failed' — UNMUTABLE.
-- WHY:   2026-10-14 (low-friction payments plan, PR5). The tracker ended at
--        "Sent 13 October — your bank may take a few days": everything after
--        the transfer was Stripe's payout schedule, which nothing here could
--        see. And a payout a bank refuses (closed account, wrong details)
--        returned the money to the payee balance and DISABLED the bank — with
--        nothing telling the spotter, the money sat there.
--
-- SHAPE: per ACCOUNT, not per payment. A Stripe payout pays out a balance and
--        can carry more than one transfer, so there is no honest per-reward
--        link; "the latest payout to your bank" is what the spotter needs and
--        what Stripe gives. The client reads it through the table's existing
--        select-own policy (its own row only), as it reads payouts_enabled.
--
-- ORDER: Stripe does not deliver events in order, and retries for days. So a
--        payout older than the one recorded never replaces it, and the same
--        payout only moves FORWARD (pending < in_transit < paid < failed /
--        canceled — a paid payout can still fail later; a failed one never
--        becomes paid again).
--
-- MONEY: none of this moves money or gates a payout — it is a record of what
--        Stripe already did. Service-role writers only.
-- LINKS: supabase/functions/stripe-webhook/index.ts (payout.* → these);
--        supabase/functions/create-payout-account/index.ts (RE-BANK stamp);
--        20261009150000_a_withdrawal_says_why.sql (the kind lists restated);
--        src/features/payments/lib/payoutProgress.ts (the consumer).
-- -----------------------------------------------------------------------------


-- =============================================================================
-- 1. Columns
-- =============================================================================
alter table public.stripe_connected_accounts
  add column if not exists last_payout_id text,
  add column if not exists last_payout_status text
    constraint stripe_connected_accounts_last_payout_status_chk
    check (last_payout_status in ('pending', 'in_transit', 'paid', 'failed', 'canceled')),
  add column if not exists last_payout_amount_pence integer,
  add column if not exists last_payout_arrival_date date,
  add column if not exists last_payout_created_at timestamptz,
  add column if not exists last_payout_failure_code text,
  add column if not exists payout_failed_notified_id text,
  add column if not exists bank_replaced_at timestamptz;

comment on column public.stripe_connected_accounts.last_payout_status is
  'The latest Stripe payout from this payee account to its bank (2026-10-14): pending → in_transit → paid, or failed/canceled. Written only by record_payout_event from the payout.* webhooks; read by the owner of the row (select-own) for the Payouts tracker.';
comment on column public.stripe_connected_accounts.bank_replaced_at is
  'When the spotter last replaced their bank in our form (create-payout-account RE-BANK). Lets the app tell "a payout failed — add new details" apart from "new details added — resending".';


-- =============================================================================
-- 2. record_payout_event
-- =============================================================================
create or replace function public.record_payout_event(
  p_stripe_account_id text,
  p_payout_id         text,
  p_status            text,
  p_amount_pence      integer,
  p_arrival_date      date,
  p_created_at        timestamptz,
  p_failure_code      text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row   public.stripe_connected_accounts%rowtype;
  v_rank  integer;
  v_was   integer;
begin
  if p_status not in ('pending', 'in_transit', 'paid', 'failed', 'canceled') then
    return jsonb_build_object('applied', false);
  end if;

  select * into v_row
    from public.stripe_connected_accounts
   where stripe_account_id = p_stripe_account_id
   for update;
  if not found then
    -- Not an account we recorded: never guessed at.
    return jsonb_build_object('applied', false);
  end if;

  v_rank := case p_status when 'pending' then 1 when 'in_transit' then 2
                          when 'paid' then 3 else 4 end;
  v_was  := case v_row.last_payout_status when 'pending' then 1 when 'in_transit' then 2
                          when 'paid' then 3 when 'failed' then 4 when 'canceled' then 4
                          else 0 end;

  if v_row.last_payout_id is null
     or (p_payout_id <> v_row.last_payout_id and p_created_at > v_row.last_payout_created_at) then
    -- A newer payout: it replaces the record outright.
    update public.stripe_connected_accounts
       set last_payout_id           = p_payout_id,
           last_payout_status       = p_status,
           last_payout_amount_pence = p_amount_pence,
           last_payout_arrival_date = p_arrival_date,
           last_payout_created_at   = p_created_at,
           last_payout_failure_code = case when p_status = 'failed' then p_failure_code end
     where id = v_row.id;
  elsif p_payout_id = v_row.last_payout_id and v_rank > v_was then
    -- The same payout, moving forward.
    update public.stripe_connected_accounts
       set last_payout_status       = p_status,
           last_payout_arrival_date = coalesce(p_arrival_date, last_payout_arrival_date),
           last_payout_failure_code = case when p_status = 'failed' then p_failure_code end
     where id = v_row.id;
  else
    -- An older payout, or the same one going backwards: a late delivery.
    return jsonb_build_object('applied', false);
  end if;

  return jsonb_build_object(
    'applied',    true,
    'profile_id', v_row.profile_id,
    'failed',     p_status = 'failed');
end;
$$;

revoke all on function public.record_payout_event(text, text, text, integer, date, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.record_payout_event(text, text, text, integer, date, timestamptz, text)
  to service_role;

comment on function public.record_payout_event(text, text, text, integer, date, timestamptz, text) is
  'Records a Stripe payout.* event on its payee account (2026-10-14). A newer payout replaces the record; the same payout only moves forward (pending < in_transit < paid < failed/canceled); anything else is a late delivery and is ignored. Unknown account → applied:false. Returns {applied, profile_id, failed}. Service role only.';


-- =============================================================================
-- 3. record_bank_replaced
-- =============================================================================
create or replace function public.record_bank_replaced(p_stripe_account_id text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.stripe_connected_accounts
     set bank_replaced_at = now()
   where stripe_account_id = p_stripe_account_id;
$$;

revoke all on function public.record_bank_replaced(text) from public, anon, authenticated;
grant execute on function public.record_bank_replaced(text) to service_role;

comment on function public.record_bank_replaced(text) is
  'Stamps bank_replaced_at when a spotter replaces their bank in our form (create-payout-account RE-BANK, 2026-10-14). Service role only.';


-- =============================================================================
-- 4. claim_payout_failed_notification
-- =============================================================================
-- One push per failed payout, ever: claimed against the payout id, and only
-- while that payout is still the recorded, failed one.
create or replace function public.claim_payout_failed_notification(
  p_stripe_account_id text,
  p_payout_id         text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile uuid;
begin
  update public.stripe_connected_accounts
     set payout_failed_notified_id = p_payout_id
   where stripe_account_id = p_stripe_account_id
     and last_payout_id = p_payout_id
     and last_payout_status = 'failed'
     and payout_failed_notified_id is distinct from p_payout_id
  returning profile_id into v_profile;

  if v_profile is null then
    return jsonb_build_object('claimed', false);
  end if;

  -- The copy: what happened and what to do. No amount (a payout can carry
  -- more than one reward), no bank name, no failure reason — the screen it
  -- opens asks for new details, which is the fix for every reason.
  return jsonb_build_object(
    'claimed', true,
    'user_id', v_profile,
    'title',   'Your bank couldn''t accept your reward',
    'body',    'Add your bank details again and we''ll send it.');
end;
$$;

revoke all on function public.claim_payout_failed_notification(text, text) from public, anon, authenticated;
grant execute on function public.claim_payout_failed_notification(text, text) to service_role;

comment on function public.claim_payout_failed_notification(text, text) is
  'Claims the one payout_failed push for a failed payout (2026-10-14): only while that payout is the recorded one and failed, and only once per payout id. Returns {claimed, user_id, title, body} or {claimed:false}. Service role only.';


-- =============================================================================
-- 5. Kind 'payout_failed' — UNMUTABLE
-- =============================================================================
-- notification_category needs no change: an unlisted kind falls to NULL —
-- unmutable, deliberately, as payout_reminder is. Money that cannot reach
-- the spotter until they act must not be silenceable.
alter table public.notifications drop constraint notifications_kind_chk;
alter table public.notifications add constraint notifications_kind_chk
  check (kind in ('alert','sighting','message','recovery','credited',
                  'credited_no_reward','closed_uncredited','dispute_upheld',
                  'dispute_rejected','payout_sent','not_credited',
                  'sighting_confirmed','still_missing','deletion_soon',
                  'reward_ending','reward_ended',
                  'payout_reminder','payout_lapsed',
                  'sighting_withdrawn','payout_failed'));

alter table public.push_sends drop constraint push_sends_kind_chk;
alter table public.push_sends add constraint push_sends_kind_chk
  check (kind in ('alert','sighting','message','recovery','credited',
                  'credited_no_reward','closed_uncredited','dispute_upheld',
                  'dispute_rejected','payout_sent','not_credited',
                  'sighting_confirmed','still_missing','deletion_soon',
                  'reward_ending','reward_ended',
                  'payout_reminder','payout_lapsed',
                  'sighting_withdrawn','payout_failed'));

comment on function public.notification_category(text) is
  'Maps a notification kind to its mutable preference category, or NULL when the kind may not be muted (sighting, sighting_withdrawn, closed_uncredited, still_missing, deletion_soon, reward_ending, reward_ended, payout_reminder, payout_lapsed, payout_failed) or is not yet classified. NULL always means "deliver". reward_ending / reward_ended are the notice a reward''s automatic refund must follow (ADR-0020); payout_reminder / payout_lapsed are the notice a credited spotter''s reward is about to go, and went, back to the owner. sighting_withdrawn (2026-10-09) follows sighting: an owner told about a sighting must be able to learn it was taken back. payout_failed (2026-10-14): a bank refused the spotter''s payout and the money waits on new details.';

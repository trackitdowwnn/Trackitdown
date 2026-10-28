-- =============================================================================
-- WHAT: A draft's reward cannot change while a payment for it could still go
--       through. update_post_bounty refuses with PAYMENT_IN_PROGRESS while the
--       draft has an open ledger row; the new release-draft-intents function
--       cancels those intents at Stripe and, through
--       forget_cancelled_draft_intents, removes the rows it watched die.
--
-- WHY:  An owner who changed the reward in the seconds between paying and
--       going live (or by long-pressing the draft in My listings, which never
--       knew a payment had started) made the charge the wrong amount:
--       mark_post_payment_held refunded it in full, the platform absorbed the
--       card fee, and the listing stayed a draft. The database cannot see
--       Stripe, so it cannot tell an abandoned sheet from a payment in flight —
--       only a cancel at Stripe can, and a cancelled intent can never capture.
--
-- HOW:  The same proof delete_draft_post uses (20260816110000), scoped to the
--       open rows: a row leaves the ledger only if the caller saw its intent
--       `canceled` at Stripe. 'failed' counts as open — mark_post_payment_held
--       advances failed -> held when a retry on the same intent succeeds.
--       Both functions take the post lock that record_post_payment_intent and
--       mark_post_payment_held take, so an intent opened mid-flight is either
--       in the ledger (the edit is refused) or not yet created (it will charge
--       the new amount). A webhook for a forgotten intent finds no row and is a
--       no-op, as for a deleted draft.
--       update_post_bounty is RESTATED IN FULL from 20261028130000; the open-row
--       refusal (marked NEW) is the only change.
-- =============================================================================

create or replace function public.update_post_bounty(
  p_post_id             uuid,
  p_bounty_amount_pence int
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_owner uuid := auth.uid();
  v_post  public.posts%rowtype;
begin
  if v_owner is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  -- SAFETY: DRAFT-ONLY gate. Own + draft + locked, else POST_NOT_EDITABLE.
  select * into v_post
  from public.posts p
  where p.id = p_post_id
    and p.owner_id = v_owner
    and p.status = any(array['draft']::public.post_status[])
  for update;
  if not found then
    raise exception 'POST_NOT_EDITABLE';
  end if;

  -- MONEY: NULL is a free listing (create_post parity); a reward is 1000–500000 pence.
  if p_bounty_amount_pence is not null
     and (p_bounty_amount_pence < 1000 or p_bounty_amount_pence > 500000) then
    raise exception 'BOUNTY_OUT_OF_RANGE';
  end if;

  -- NEW: MONEY: no price change while a charge for the old one could still
  -- succeed. release-draft-intents clears the rows Stripe confirms are dead.
  if exists (
    select 1 from public.payments
     where post_id = p_post_id
       and status in ('requires_payment', 'failed')
  ) then
    raise exception 'PAYMENT_IN_PROGRESS';
  end if;

  -- MONEY: touch ONLY bounty_amount_pence. Nothing else is in this SET list.
  update public.posts set
    bounty_amount_pence = p_bounty_amount_pence
  where id = p_post_id;

  return jsonb_build_object('post_id', p_post_id);
end;
$$;

comment on function public.update_post_bounty(uuid, int) is
  'DRAFT-ONLY per-section edit: writes bounty_amount_pence and NOTHING ELSE on an own draft post (else POST_NOT_EDITABLE). NULL switches the draft to a free listing (the flat fee, derived by create-payment-intent); a number must be 1000–500000 pence (£10–£5000), else BOUNTY_OUT_OF_RANGE. PAYMENT_IN_PROGRESS while the draft has an open (requires_payment/failed) ledger row — release-draft-intents cancels those at Stripe and forgets them first. Never writes status/owner_id/expires_at or any non-money column. Also raises NOT_AUTHENTICATED.';

revoke execute on function public.update_post_bounty(uuid, int) from public;
revoke execute on function public.update_post_bounty(uuid, int) from anon;
grant  execute on function public.update_post_bounty(uuid, int) to authenticated, service_role;


create or replace function public.forget_cancelled_draft_intents(
  p_post_id              uuid,
  p_owner_id             uuid,
  p_cancelled_intent_ids text[]
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post record;
  v_n    integer;
begin
  select owner_id, status into v_post
    from public.posts where id = p_post_id
     for update;
  -- Same answer for "no such post" and "not yours".
  if not found or v_post.owner_id is distinct from p_owner_id then
    raise exception 'NOT_OWNER';
  end if;
  if v_post.status <> 'draft' then
    raise exception 'NOT_DRAFT';
  end if;

  -- ⚠️ ONLY rows whose intent the caller saw `canceled` (nulls stripped, so a
  -- null element proves nothing), ONLY open ones, and never one another row
  -- points at (the RESTRICT keys would abort the whole call).
  delete from public.payments pay
   where pay.post_id = p_post_id
     and pay.status in ('requires_payment', 'failed')
     and pay.stripe_payment_intent_id
         = any(array_remove(coalesce(p_cancelled_intent_ids, '{}'), null))
     and not exists (
       select 1 from public.payments r
        where r.superseded_by_payment_id = pay.id or r.replaces_payment_id = pay.id
     );
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

comment on function public.forget_cancelled_draft_intents(uuid, uuid, text[]) is
  'SERVICE ROLE ONLY (release-draft-intents). On an own draft (else NOT_OWNER / NOT_DRAFT), under the post lock, deletes the open (requires_payment/failed) ledger rows whose intent ids the caller watched turn `canceled` at Stripe, so update_post_bounty will take a new price. Unproven rows stay, and the edit stays refused (PAYMENT_IN_PROGRESS). Returns the number of rows removed.';

revoke all on function public.forget_cancelled_draft_intents(uuid, uuid, text[]) from public, anon, authenticated;
grant execute on function public.forget_cancelled_draft_intents(uuid, uuid, text[]) to service_role;

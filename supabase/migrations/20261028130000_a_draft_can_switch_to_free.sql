-- =============================================================================
-- WHAT: update_post_bounty accepts NULL again, so a draft can switch to a free
--       listing (no reward, the flat fee) from the Reward editor.
--
-- WHY:  BountyEditor sends NULL for "no reward" (ADR-0014), but the RPC still
--       carries 20260813120000's NOT NULL guard: the null-accepting version
--       lived in the £4.99 fee migration that 19f3d57 deleted when the app
--       adopted the hand-applied £5 design. Every switch to free failed with
--       BOUNTY_OUT_OF_RANGE. create_post has accepted NULL since 20260819100000;
--       this is the same rule.
--
-- HOW:  RESTATED IN FULL from 20260813120000; only the range guard changes
--       (NULL passes, a number is still 1000–500000). The fee is never written
--       here — create-payment-intent derives it from a NULL bounty. Grants
--       restated as they have always been.
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

  -- MONEY: touch ONLY bounty_amount_pence. Nothing else is in this SET list.
  update public.posts set
    bounty_amount_pence = p_bounty_amount_pence
  where id = p_post_id;

  return jsonb_build_object('post_id', p_post_id);
end;
$$;

comment on function public.update_post_bounty(uuid, int) is
  'DRAFT-ONLY per-section edit: writes bounty_amount_pence and NOTHING ELSE on an own draft post (else POST_NOT_EDITABLE). NULL switches the draft to a free listing (the flat fee, derived by create-payment-intent); a number must be 1000–500000 pence (£10–£5000), else BOUNTY_OUT_OF_RANGE. A charge made before an edit no longer matches and is refunded at capture (mark_post_payment_held). Never writes status/owner_id/expires_at or any non-money column. Also raises NOT_AUTHENTICATED.';

revoke execute on function public.update_post_bounty(uuid, int) from public;
revoke execute on function public.update_post_bounty(uuid, int) from anon;
grant  execute on function public.update_post_bounty(uuid, int) to authenticated, service_role;

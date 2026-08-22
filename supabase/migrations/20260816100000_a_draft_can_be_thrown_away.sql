-- =============================================================================
-- WHAT: delete_draft_post(p_post_id, p_owner_id) — hard-deletes an owner's own
--       DRAFT listing. Service-role only: NOT granted to authenticated, so the
--       app cannot reach it except through the delete-draft Edge Function.
--
-- WHY:  Until 2026-08-15 a draft was a one-way door. The post-a-car wizard could
--       save one, My Posts listed it, and then there was nothing an owner could
--       do with it: no resume, no publish, no delete. 20260815 gave the listing
--       page a "Post & pay" for its own draft; this closes the other half — the
--       draft they started by mistake, or on a car they have since got back.
--
--       DELETE, not a status change. A draft was never published: nobody has
--       seen it, no spotter is looking for that car, no money moved. Parking it
--       in `cancelled` would leave a permanent row in the owner's own list
--       recording that they once opened a form — which is the clutter they
--       asked to be rid of, wearing a different label.
--
-- SAFETY: THE STRIPE INTENT IS THE WHOLE REASON THIS IS SERVICE-ROLE ONLY.
--       A draft CAN carry a payments row: the owner pressed "Post & pay",
--       create-payment-intent opened a PaymentIntent and wrote the ledger row,
--       and then they dismissed the sheet. That intent is still live at Stripe
--       and anyone holding its client secret can still confirm it. Deleting the
--       ledger row from SQL alone would leave a charge that can succeed into a
--       post that no longer exists, with no row for the webhook to land on.
--
--       So the ordering is fixed and lives in the Edge Function: cancel every
--       open intent AT STRIPE first, and only then call this. Granting this to
--       `authenticated` would hand the client a way to skip that step, which is
--       why the grant below names service_role and nothing else.
--
--       MONEY THAT EVER MOVED BLOCKS THE DELETE. Any payments row that is
--       held / released / refunded, or any payout_review, refund_hold or
--       refund_dispute, raises PAYMENT_EXISTS and the post stands. None of
--       those can legitimately exist on a draft — this is an assertion, not a
--       workflow. It is here because posts.payments is ON DELETE RESTRICT and
--       the raw FK error would be an unreadable 500; a named code lets the
--       function answer honestly.
--
--       STORAGE IS DELIBERATELY NOT SWEPT. Photo objects live at
--       `<user-id>/<hash>-<n>.jpg` — keyed by content, NOT by post — so two
--       listings that used the same photo share one object. Removing it here
--       would blank an image on a DIFFERENT, live listing. The objects stay in
--       the owner's own folder and are swept wholesale by delete-account.
-- LINKS: supabase/functions/delete-draft/index.ts (the only caller);
--        supabase/functions/create-payment-intent/index.ts (what writes the
--          ledger row this may find);
--        supabase/migrations/20260707110712_payments_foundation.sql (the
--          ON DELETE RESTRICT this respects);
--        src/features/vehicles/api/draftApi.ts.
-- =============================================================================


create or replace function public.delete_draft_post(p_post_id uuid, p_owner_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_post public.posts%rowtype;
begin
  if p_owner_id is null then
    raise exception 'NOT_OWNER';
  end if;

  -- Lock first: the owner could be pressing "Post & pay" on another device, and
  -- create-payment-intent's own read must not interleave with the delete.
  select p.* into v_post
  from public.posts p
  where p.id = p_post_id
  for update;

  -- Same answer for "no such post" and "not yours" — never confirm a stranger's
  -- post id exists.
  if not found or v_post.owner_id is distinct from p_owner_id then
    raise exception 'NOT_OWNER';
  end if;

  if v_post.status <> 'draft' then
    raise exception 'NOT_DRAFT';
  end if;

  -- Anything that means money moved, or is queued to move. See SAFETY above.
  if exists (
    select 1 from public.payments
    where post_id = p_post_id
      and status in ('held', 'released', 'refunded')
  ) or exists (
    select 1 from public.payout_reviews where post_id = p_post_id
  ) or exists (
    select 1 from public.refund_holds where post_id = p_post_id
  ) or exists (
    select 1 from public.refund_disputes where post_id = p_post_id
  ) then
    raise exception 'PAYMENT_EXISTS';
  end if;

  -- What is left can only be 'requires_payment' or 'failed': an intent that
  -- never captured, and which the caller has already cancelled at Stripe.
  delete from public.payments where post_id = p_post_id;

  -- post_photos, watchlist entries, alerts and the bounty-recommendation log all
  -- cascade (they are wholly owned by the post and carry no money state).
  delete from public.posts where id = p_post_id;
end;
$$;

comment on function public.delete_draft_post(uuid, uuid) is
  'Hard-deletes an owner''s own DRAFT post. SERVICE ROLE ONLY — the caller must first cancel any open PaymentIntent at Stripe. Raises NOT_OWNER / NOT_DRAFT / PAYMENT_EXISTS.';

-- ⚠️ NO grant to authenticated or anon. `security definer` functions are
-- executable by PUBLIC by default, so the revoke is load-bearing, not tidiness:
-- without it any signed-in client could call this and skip the Stripe
-- cancellation the safety of this whole path depends on.
revoke all on function public.delete_draft_post(uuid, uuid) from public;

revoke all on function public.delete_draft_post(uuid, uuid) from anon, authenticated;

grant execute on function public.delete_draft_post(uuid, uuid) to service_role;

-- --- Assert the grant is what the comment above claims ------------------------
do $$
begin
  if has_function_privilege('authenticated', 'public.delete_draft_post(uuid, uuid)', 'execute') then
    raise exception 'delete_draft_post is executable by authenticated — the Stripe cancellation can be skipped';
  end if;
  if not has_function_privilege('service_role', 'public.delete_draft_post(uuid, uuid)', 'execute') then
    raise exception 'delete_draft_post is not executable by service_role — the Edge Function cannot call it';
  end if;
end;
$$;

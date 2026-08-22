-- =============================================================================
-- WHAT: delete_draft_post gains a third argument — the Stripe intent ids the
--       caller has VERIFIED as `canceled` — and refuses unless every payments
--       row on the post is named in it. The 2-argument version is dropped, so
--       the unproven form cannot be called at all.
--
-- WHY:  20260816100000 shipped a delete that removed ledger rows ON TRUST. It
--       asserted the caller had cancelled the intents; it had no evidence, and
--       two paths through it destroyed a live PaymentIntent's only record.
--
--       ⚠️ 1. A 'failed' ROW IS NOT DEAD. The Edge Function skipped cancelling
--       those, on the reasoning that `failed` is terminal. This schema says
--       otherwise in its own words: mark_post_payment_held advances
--       'failed' -> 'held' deliberately (20260726100000_post_payment.sql:246),
--       because one PaymentIntent is reused per post and a decline followed by
--       a successful retry fires `succeeded` on the SAME intent. A declined
--       intent sits in requires_payment_method at Stripe, fully confirmable.
--       create-payment-intent also writes 'failed' after a BEST-EFFORT cancel
--       that swallows every Stripe error, so a 'failed' row routinely points at
--       an intent nobody cancelled.
--
--       ⚠️ 2. THE LOCK CAME TOO LATE. The Edge Function read `payments`,
--       cancelled what it found, and only then called this function, which took
--       the row lock and deleted every payments row for the post. An intent
--       opened on another device in that window — the owner tapping "Post &
--       pay" while the delete was in flight — was deleted uncancelled, with its
--       client secret already handed to that device.
--
--       Either way the outcome was the same: a confirmable charge, and no row
--       for the webhook to land on. mark_post_payment_held's "benign no-op"
--       branch would swallow the capture and the platform would hold money with
--       nothing recording whose it was.
--
-- SAFETY: The fix is to stop trusting and start checking. The caller now passes
--       the intent ids it has round-tripped through Stripe and seen `canceled`,
--       and this function — INSIDE the same transaction as the row lock —
--       refuses if any payments row carries an id absent from that list. A row
--       written after the caller's read is therefore not in the list, so case 2
--       raises instead of deleting; a 'failed' row the caller skipped is not in
--       the list either, so case 1 raises too.
--
--       The 2-arg overload is DROPPED rather than left beside the new one. An
--       overload that still deletes on trust is the same bug with a longer
--       name, and PostgREST would happily resolve to it.
-- LINKS: supabase/migrations/20260816100000_a_draft_can_be_thrown_away.sql (the
--          version this replaces — its SAFETY notes still stand, this adds the
--          evidence they assumed);
--        supabase/migrations/20260726100000_post_payment.sql (mark_post_payment_
--          held — the failed -> held path that makes case 1 real);
--        supabase/functions/delete-draft/index.ts (the only caller);
--        supabase/tests/delete_draft_verification.sql.
-- =============================================================================


-- Gone, not overloaded. See SAFETY above.
drop function if exists public.delete_draft_post(uuid, uuid);

create or replace function public.delete_draft_post(
  p_post_id              uuid,
  p_owner_id             uuid,
  p_cancelled_intent_ids text[]
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_post   public.posts%rowtype;
  v_stray  text;
begin
  if p_owner_id is null then
    raise exception 'NOT_OWNER';
  end if;

  -- Lock first. Everything below — including the intent proof — is decided
  -- against state that cannot move until this transaction ends, and
  -- record_post_payment_intent takes the same lock on the same row.
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

  -- Anything that means money moved, or is queued to move.
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

  -- ⚠️ THE PROOF. Every surviving ledger row must name an intent the caller has
  -- seen `canceled` at Stripe. A row the caller never looked at — because it
  -- was written after their read, or because they skipped it as 'failed' — is
  -- not in the list, and the delete does not happen.
  --
  -- ⚠️ NULL-SAFE, and both halves are load-bearing.
  --
  -- `coalesce` on the ARRAY so a null argument reads as "proved nothing"
  -- rather than "match everything".
  --
  -- `array_remove(..., null)` + `exists` on the ELEMENTS because
  -- `x = any(array['a', null])` is NULL for every non-matching x — and
  -- `not NULL` is NULL, which a WHERE clause discards. One null element in the
  -- list would therefore mark EVERY row proved and hard-delete the whole
  -- ledger. The caller reads a `not null` column so it cannot happen today, but
  -- this is the last control between a live PaymentIntent and a deleted ledger
  -- row: it must not depend on its caller being correct.
  select pay.stripe_payment_intent_id into v_stray
  from public.payments pay
  where pay.post_id = p_post_id
    and not exists (
      select 1
      from unnest(array_remove(coalesce(p_cancelled_intent_ids, '{}'), null)) as proved(id)
      where proved.id = pay.stripe_payment_intent_id
    )
  limit 1;

  if v_stray is not null then
    raise exception 'INTENT_NOT_CANCELLED';
  end if;

  -- Only now, with every intent on this post verifiably dead at Stripe, is the
  -- ledger row safe to remove: there is nothing left that could capture.
  delete from public.payments where post_id = p_post_id;

  -- post_photos, watchlist entries, alerts and the bounty-recommendation log all
  -- cascade (they are wholly owned by the post and carry no money state).
  -- Storage objects are deliberately NOT swept — photo keys are content hashes
  -- under the owner's folder, so another live listing may share the object.
  delete from public.posts where id = p_post_id;
end;
$$;

comment on function public.delete_draft_post(uuid, uuid, text[]) is
  'Hard-deletes an owner''s own DRAFT post. SERVICE ROLE ONLY. The caller must pass every Stripe intent id it has verified as canceled; any payments row not named there aborts the delete. Raises NOT_OWNER / NOT_DRAFT / PAYMENT_EXISTS / INTENT_NOT_CANCELLED.';

-- ⚠️ NO grant to authenticated or anon. `security definer` functions are
-- executable by PUBLIC by default, and this project ALSO ships ALTER DEFAULT
-- PRIVILEGES granting EXECUTE on new functions to anon + authenticated (see
-- 20260713191000), which a `revoke from public` does not touch — so both
-- revokes below are load-bearing.
revoke all on function public.delete_draft_post(uuid, uuid, text[]) from public;

revoke all on function public.delete_draft_post(uuid, uuid, text[]) from anon, authenticated;

grant execute on function public.delete_draft_post(uuid, uuid, text[]) to service_role;

-- --- Assert the grants, and that the unproven overload is really gone ---------
do $$
begin
  if has_function_privilege('authenticated', 'public.delete_draft_post(uuid, uuid, text[])', 'execute') then
    raise exception 'delete_draft_post is executable by authenticated';
  end if;
  -- anon was missing from the previous migration's assertion, and anon is
  -- exactly the role the default-privileges grant hands EXECUTE to.
  if has_function_privilege('anon', 'public.delete_draft_post(uuid, uuid, text[])', 'execute') then
    raise exception 'delete_draft_post is executable by anon';
  end if;
  if not has_function_privilege('service_role', 'public.delete_draft_post(uuid, uuid, text[])', 'execute') then
    raise exception 'delete_draft_post is not executable by service_role — the Edge Function cannot call it';
  end if;
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'delete_draft_post'
      and pg_get_function_identity_arguments(p.oid) = 'uuid, uuid'
  ) then
    raise exception 'the 2-argument delete_draft_post still exists — it deletes ledger rows without proof';
  end if;
  raise notice 'delete_draft_post: service_role only, 3-arg form only.';
end;
$$;

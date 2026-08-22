-- =============================================================================
-- WHAT: cancel_fee_listing(p_post_id) — takes a FREE LISTING down without
--       refunding anything. Service-role only; the deactivate-post Edge
--       Function is its one caller.
--
-- WHY:  20260819100000 made a listing free-to-post for a flat £5 and stopped
--       there. Nothing was ever written to take one DOWN again, so an owner
--       whose car came home could not remove their own listing: deactivate-post
--       branches on the price columns, sends a fee-priced post here, and this
--       function did not exist. The call 500'd.
--
--       The half that was missing lived in a checkout that no longer exists —
--       the same body of work that never delivered the kind-narrowed refund
--       selectors. This supplies it against the design that actually shipped.
--
-- ⚠️ NO REFUND, AND THAT IS THE POINT. The fee bought a listing and the listing
--       was delivered; ADR-0014 says so and the client discloses it on the
--       pricing step, before payment. This function therefore does NOT touch
--       the payments row at all — it moves the POST and nothing else. The fee
--       stays exactly where it is.
--
-- SAFETY: A FEE ROW MUST NEVER MEET AN ESCROW PATH. `payments` holds both
--       shapes since 20260819100000, and the refund/payout selectors are
--       narrowed to kind='bounty_escrow' in the Edge Functions. This function
--       is the other side of that guarantee: it refuses outright if the post
--       carries HELD escrow (POST_HAS_BOUNTY), because a post that is
--       fee-PRICED but escrow-FUNDED means a stale bounty intent captured
--       against it after a draft pricing switch. Cancelling it here would take
--       the listing down and strand real money with no refund path — so it
--       stops, and deactivate-post routes the owner to support rather than
--       looping them on "Please try again".
--
-- SAFETY NOTE ON DESTRUCTIVE STATEMENTS: none. One new function; no table,
--       column, enum, policy, index or existing function is created, altered or
--       dropped, and no payments row is written or deleted. The only write is
--       posts.status -> 'cancelled' with closed_at stamped, on a locked row the
--       caller owns.
--
-- LINKS: supabase/migrations/20260819100000_a_listing_can_be_free.sql (the
--          design this completes);
--        supabase/functions/deactivate-post/index.ts (the only caller, and the
--          source of the POST_HAS_BOUNTY token);
--        supabase/functions/_shared/refundEscrow.ts (the escrow exit this is
--          deliberately NOT);
--        docs/decisions/ADR-0014-no-bounty-listings.md.
-- =============================================================================

create or replace function public.cancel_fee_listing(p_post_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post public.posts%rowtype;
begin
  -- Lock first: the owner could be paying on another device, and
  -- record_post_payment_intent takes the same lock on the same row.
  select * into v_post
  from public.posts
  where id = p_post_id
  for update;

  if not found then
    raise exception 'POST_NOT_FOUND';
  end if;

  -- Caller bug rather than a user state: deactivate-post only routes here when
  -- bounty_amount_pence is null. A bounty-priced post has an escrow exit and
  -- must use it, or the owner silently loses a refund they are owed.
  if v_post.bounty_amount_pence is not null then
    raise exception 'NOT_FEE_LISTING';
  end if;

  -- Idempotent: a double tap, or a retry after the response was lost.
  if v_post.status = 'cancelled' then
    return;
  end if;

  -- Only a live listing comes down this way. A recovered or expired post has
  -- already ended, and re-labelling it would rewrite its history.
  if v_post.status not in ('active', 'pending_verification') then
    raise exception 'POST_NOT_CANCELLABLE';
  end if;

  -- ⚠️ THE GUARD. See SAFETY above: fee-priced but escrow-funded is real money
  -- with no refund path out of this function, so refuse and let a human look.
  if exists (
    select 1 from public.payments
    where post_id = p_post_id
      and kind = 'bounty_escrow'
      and status = 'held'
  ) then
    raise exception 'POST_HAS_BOUNTY';
  end if;

  -- The post, and only the post. The payments row is left untouched: the fee is
  -- ours on capture and there is nothing to move.
  update public.posts
     set status = 'cancelled',
         closed_at = now()
   where id = p_post_id;
end;
$$;

comment on function public.cancel_fee_listing(uuid) is
  'Takes a FREE LISTING (bounty_amount_pence IS NULL) down to cancelled without refunding: the £5 fee bought a listing and the listing was delivered (ADR-0014). SERVICE ROLE ONLY. Touches the POST only — never the payments row. Idempotent on an already-cancelled post. Raises POST_NOT_FOUND, NOT_FEE_LISTING (a bounty-priced post has an escrow exit and must use it), POST_NOT_CANCELLABLE (already ended), and POST_HAS_BOUNTY when the post is fee-priced but carries HELD escrow — real money with no refund path through here, so it stops and deactivate-post routes the owner to support.';

-- ⚠️ NO grant to authenticated or anon. `security definer` functions are
-- executable by PUBLIC by default, and this project ALSO ships ALTER DEFAULT
-- PRIVILEGES granting EXECUTE on new functions to anon + authenticated
-- (20260713191000), which a `revoke from public` does not touch — so both
-- revokes below are load-bearing, not tidiness. This function performs no
-- ownership check of its own: deactivate-post proves the caller owns the post
-- before it gets here, and that split is only safe while no client can call it.
revoke all on function public.cancel_fee_listing(uuid) from public;

revoke all on function public.cancel_fee_listing(uuid) from anon, authenticated;

grant execute on function public.cancel_fee_listing(uuid) to service_role;

do $$
begin
  if has_function_privilege('authenticated', 'public.cancel_fee_listing(uuid)', 'execute')
     or has_function_privilege('anon', 'public.cancel_fee_listing(uuid)', 'execute') then
    raise exception 'cancel_fee_listing is client-executable — it performs no ownership check of its own';
  end if;
  if not has_function_privilege('service_role', 'public.cancel_fee_listing(uuid)', 'execute') then
    raise exception 'cancel_fee_listing is not executable by service_role — deactivate-post cannot call it';
  end if;
end;
$$;

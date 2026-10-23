-- =============================================================================
-- WHAT:  A live listing with NO money held goes with its owner's account,
--        instead of blocking the deletion. Redefines two functions from
--        20261023120000 — account_deletion_blockers_for and
--        delete_post_for_account — with ONE rule shared by both:
--          LIVE_LISTING = a recovery_claimed listing, or an active /
--          pending_verification listing with a payment 'held' or 'superseded'.
--        MONEY_HELD stops double-counting a live listing's held money.
-- WHY:   Found on prod (2026-10-23): an owner whose live listing had no reward
--        — only two abandoned "add a reward" attempts (failed, and one never
--        paid) — couldn't delete: "You have a live listing. Deactivate it
--        first." with no way there from the delete screen. The block's reason
--        ("a listing must not outlive its owner") died when deletion started
--        deleting listings. Owner's call: deletion takes such a listing down
--        (after they confirm on the screen); a lapsed / refunded reward counts
--        the same. Reward money held and a claimed recovery still block.
--
--        Nothing else changes: the abandoned intents are cancelled at Stripe
--        and PROVED dead by delete-account first (an intent created after that
--        isn't in the proof, so INTENT_NOT_CANCELLED refuses); the fee and any
--        refunded escrow are detached with a post_snapshot (post_status
--        records it was live); sightings, chats, alerts cascade as for any
--        deleted listing.
--
--        ⚠️ Both bodies are 20261023120000's VERBATIM (just deployed, prod =
--        repo) except the blocks marked CHANGED 20261023140000.
-- LINKS: supabase/migrations/20261023120000_an_account_can_be_deleted.sql;
--        supabase/tests/account_deletion_verification.sql (CHECK 6);
--        docs/DOMAIN.md "Account deletion".
-- =============================================================================

-- 1 — the blockers ------------------------------------------------------------

create or replace function public.account_deletion_blockers_for(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('code', b.code, 'count', b.n) order by b.ord), '[]'::jsonb)
  from (
    -- A live listing that can't simply go with the account: one whose
    -- recovery is claimed (a spotter's credit and payout hang on it), or one
    -- still holding reward money (it must come down through its refund
    -- exit). CHANGED 20261023140000: a live listing with NO money held — a
    -- free one, an abandoned "add a reward", a lapsed reward — no longer
    -- counts; deletion takes it down (delete_post_for_account, same rule).
    select 1 as ord, 'LIVE_LISTING' as code, count(*)::int as n
      from public.posts po
     where po.owner_id = p_user_id
       and (po.status = 'recovery_claimed'
            or (po.status in ('active', 'pending_verification')
                and exists (select 1 from public.payments pay
                             where pay.post_id = po.id
                               and pay.status in ('held', 'superseded'))))
    union all
    -- Their money still held: escrow, a superseded payment owed back, or a
    -- refund hold whose dispute window is still open.
    select 2, 'MONEY_HELD', (
      (select count(*) from public.payments pay
         join public.posts po on po.id = pay.post_id
        where po.owner_id = p_user_id
          and pay.status in ('held', 'superseded')
          -- CHANGED 20261023140000: a LIVE listing's held money is already
          -- named by LIVE_LISTING ("deactivate it first"); counting it here
          -- too showed one listing as two reasons.
          and po.status not in ('active', 'pending_verification', 'recovery_claimed'))
      + (select count(*) from public.refund_holds
          where owner_id = p_user_id and expires_at > now())
    )::int
    union all
    -- A reward owed TO them: their sighting is credited on a listing whose
    -- payout hasn't happened yet (payout_awaiting_payee's own test). The
    -- payee is only stamped on a payment as it's RELEASED, so there is no
    -- "held payment to them" state to look for (security review).
    select 3, 'REWARD_ON_ITS_WAY', count(*)::int
      from public.sightings s
      join public.posts po on po.id = s.post_id
     where s.spotter_id = p_user_id
       and s.status = 'credited'
       and po.status = 'recovery_claimed'
    union all
    -- A dispute still being decided, on their listing or by them. ONLY
    -- 'open': 'upheld' is final (nothing moves a dispute on from it), so
    -- counting it blocked anyone who ever won or lost one for ever (security
    -- review H1). An upheld dispute whose money still moves is caught above
    -- (LIVE_LISTING / MONEY_HELD / REWARD_ON_ITS_WAY).
    select 4, 'DISPUTE_OPEN', count(*)::int
      from public.refund_disputes d
      left join public.posts po on po.id = d.post_id
     where d.status = 'open'
       and (d.spotter_id = p_user_id or po.owner_id = p_user_id)
    union all
    -- A payout review not yet resolved, either side.
    select 5, 'REVIEW_OPEN', count(*)::int
      from public.payout_reviews
     where resolved_at is null
       and (spotter_id = p_user_id or owner_id = p_user_id)
  ) b
  where b.n > 0;
$$;

comment on function public.account_deletion_blockers_for(uuid) is
  'Reasons a user can''t delete their account yet, [{code, count}] (empty = none). Changed 20261023140000: LIVE_LISTING counts only a recovery_claimed listing or a live one holding reward money (held/superseded); a live listing with no money held goes with the account. Codes: LIVE_LISTING, MONEY_HELD, REWARD_ON_ITS_WAY, DISPUTE_OPEN, REVIEW_OPEN. SERVICE ROLE ONLY (delete_account_data, delete-account); clients call account_deletion_blockers().';

revoke execute on function public.account_deletion_blockers_for(uuid) from public, anon, authenticated;
grant execute on function public.account_deletion_blockers_for(uuid) to service_role;


-- 2 — one listing, for an account being deleted --------------------------------
-- ⚠️ 20261023120000's body EXACTLY except the block marked CHANGED 20261023140000.
create or replace function public.delete_post_for_account(
  p_post_id              uuid,
  p_owner_id             uuid,
  p_cancelled_intent_ids text[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post     public.posts%rowtype;
  v_snapshot jsonb;
  v_stray    text;
begin
  if p_owner_id is null then
    raise exception 'NOT_OWNER';
  end if;

  -- Lock first: every guard below is decided against state that cannot move
  -- until this transaction ends. record_post_payment_intent takes this same
  -- lock before writing a ledger row, so a row created mid-delete waits; and
  -- the refund path's own posts update queues behind this FOR UPDATE, so the
  -- guards below always read the ledger as of a settled moment, never halfway
  -- through a transition.
  select * into v_post
  from public.posts
  where id = p_post_id
  for update;

  -- Same answer for "no such post" and "not yours" — a post id must never be
  -- an existence oracle.
  if not found or v_post.owner_id is distinct from p_owner_id then
    raise exception 'NOT_OWNER';
  end if;

  -- NEW 20261023120000 (1 of 2), CHANGED 20261023140000 — any listing but
  -- one that can't simply go: a claimed recovery (a spotter's credit and
  -- payout hang on it), or a live listing still holding reward money (it must
  -- come down through its refund exit, which this has no part of). A live
  -- listing with NO money held — free, an abandoned "add a reward", a lapsed
  -- reward — is taken down and deleted with the account: the owner confirmed
  -- that on the delete screen. Decided under the FOR UPDATE above, the lock
  -- record_post_payment_intent also takes, so a reward paid at this moment
  -- either lands first (and refuses here) or waits and finds no listing.
  if v_post.status = 'recovery_claimed'
     or (v_post.status in ('active', 'pending_verification')
         and exists (select 1 from public.payments
                      where post_id = p_post_id
                        and status in ('held', 'superseded'))) then
    raise exception 'LIVE_LISTING';
  end if;

  -- Escrow still held — a refund hold mid-window, or a refund mid-flight —
  -- or a superseded payment still owed back to the owner.
  if exists (
    select 1 from public.payments
    where post_id = p_post_id
      and status in ('held', 'superseded')
  ) then
    raise exception 'MONEY_IN_FLIGHT';
  end if;

  -- The 72-hour dispute window is still open: the sightings a dispute would
  -- cite cascade from this post, so deleting now destroys the evidence.
  if exists (
    select 1 from public.refund_holds
    where post_id = p_post_id
      and expires_at > now()
  ) then
    raise exception 'MONEY_IN_FLIGHT';
  end if;

  -- NEW 20261023120000 (2 of 2) — 'open' only, not ('open', 'upheld'):
  -- 'upheld' is final, so the original guard would refuse a settled listing
  -- for ever (security review H1). Money still moving is refused above.
  if exists (
    select 1 from public.refund_disputes
    where post_id = p_post_id
      and status = 'open'
  ) then
    raise exception 'DISPUTE_OPEN';
  end if;

  -- Only an UNRESOLVED review blocks. A 'rejected' resolution keeps the
  -- escrow held, so those posts already refused above; an 'approved' one is
  -- finished business and is archived below.
  if exists (
    select 1 from public.payout_reviews
    where post_id = p_post_id
      and resolved_at is null
  ) then
    raise exception 'PAYMENT_REVIEW_OPEN';
  end if;

  -- ⚠️ THE PROOF, copied from delete_draft_post (20260816110000) — read that
  -- header before touching this. Every ledger row where money never moved
  -- ('requires_payment' or 'failed') must name an intent the caller has seen
  -- `canceled` at Stripe; one it never looked at — written after its read, or
  -- skipped as 'failed' — is not in the list, and the delete does not happen.
  -- NULL-SAFE both ways: coalesce on the array ("proved nothing", not "match
  -- everything") and array_remove(..., null) + exists on the elements (one
  -- null element would otherwise mark EVERY row proved).
  select pay.stripe_payment_intent_id into v_stray
  from public.payments pay
  where pay.post_id = p_post_id
    and pay.status in ('requires_payment', 'failed')
    and not exists (
      select 1
      from unnest(array_remove(coalesce(p_cancelled_intent_ids, '{}'), null)) as proved(id)
      where proved.id = pay.stripe_payment_intent_id
    )
  limit 1;

  if v_stray is not null then
    raise exception 'INTENT_NOT_CANCELLED';
  end if;

  -- What the ledger rows keep of the post they are about to lose. The settled
  -- hold/dispute/review rows ride along because they are deleted below and
  -- this is their only afterlife.
  v_snapshot := jsonb_build_object(
    'post_id',         v_post.id,
    'owner_id',        v_post.owner_id,
    'plate',           v_post.plate,
    'make',            v_post.make,
    'model',           v_post.model,
    'colour',          v_post.colour,
    'post_status',     v_post.status,
    'post_created_at', v_post.created_at,
    'post_closed_at',  v_post.closed_at,
    'post_deleted_at', now(),
    'refund_hold',     (select to_jsonb(h) from public.refund_holds h where h.post_id = p_post_id
                         order by h.created_at desc limit 1),
    'refund_holds',    (select jsonb_agg(to_jsonb(h) order by h.created_at) from public.refund_holds h
                         where h.post_id = p_post_id),
    'refund_disputes', (select jsonb_agg(to_jsonb(d)) from public.refund_disputes d where d.post_id = p_post_id),
    'payout_review',   (select to_jsonb(r) from public.payout_reviews r where r.post_id = p_post_id)
  );

  -- Money that never moved, on intents verifiably dead at Stripe: delete,
  -- exactly as delete_draft_post does. There is nothing left that could
  -- capture, so there is nothing a webhook could need this row for.
  delete from public.payments
   where post_id = p_post_id
     and status in ('requires_payment', 'failed');

  -- Money that moved: detach, never delete. Every row left is terminal
  -- (released / refunded / collected), so no state change can ever need to
  -- reach a post through it again — intent-id lookups still find it.
  update public.payments
     set post_id       = null,
         post_snapshot = v_snapshot
   where post_id = p_post_id;

  -- Disputes FIRST: refund_disputes.sighting_id references sightings WITHOUT
  -- cascade, so a surviving dispute row would veto the sightings cascade and
  -- fail the post delete below with a raw FK error. The resolved payout
  -- review must go for the same reason — its FK is ON DELETE RESTRICT.
  delete from public.refund_disputes where post_id = p_post_id;
  delete from public.refund_holds    where post_id = p_post_id;
  delete from public.payout_reviews  where post_id = p_post_id;

  -- Everything else cascades: photos (their triggers queue the storage paths
  -- for the sweep), sightings, chats, watchlist rows, flags, structured data.
  delete from public.posts where id = p_post_id;
end;
$$;

comment on function public.delete_post_for_account(uuid, uuid, text[]) is
  'Account deletion (20261023120000): delete_old_closed_post''s body, but for any listing except a recovery_claimed one or a live one holding reward money (raises LIVE_LISTING; 20261023140000 — a live listing with no money held is taken down and deleted) and refusing only an OPEN dispute (upheld is final). Every money guard (MONEY_IN_FLIGHT, DISPUTE_OPEN, PAYMENT_REVIEW_OPEN, INTENT_NOT_CANCELLED); ledger rows detached with a post_snapshot, never deleted. SERVICE ROLE ONLY; called by delete_account_data.';

revoke execute on function public.delete_post_for_account(uuid, uuid, text[]) from public, anon, authenticated;
grant execute on function public.delete_post_for_account(uuid, uuid, text[]) to service_role;

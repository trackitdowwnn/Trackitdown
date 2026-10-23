-- =============================================================================
-- WHAT:  Account deletion that works for people with MONEY HISTORY, and says
--        why when it can't:
--
--        account_deletion_blockers()  — the caller's reasons they can't delete
--          yet, as [{code, count}] (empty = free to go). The ONE definition the
--          app's delete screen shows and the delete-account Edge Function
--          re-checks. Codes: LIVE_LISTING · MONEY_HELD · REWARD_ON_ITS_WAY ·
--          DISPUTE_OPEN · REVIEW_OPEN.
--
--        delete_account_data(user, cancelled_intent_ids) — SERVICE ROLE ONLY,
--          called by delete-account BEFORE it deletes the auth user. Refuses
--          with the blocker codes; otherwise removes everything that ties the
--          person to the money while KEEPING the money records:
--            - every listing they own goes through delete_post_for_account
--              (below): ledger rows DETACHED with a post_snapshot, never
--              deleted; settled holds / disputes / reviews archived into it;
--            - payments paid TO them lose payee_account_id and keep a
--              payee_snapshot (the Stripe account id, for reconciliation);
--            - settled reviews and disputes on OTHER people's listings keep
--              the record but lose the spotter (and the sighting, which goes
--              with the account).
--
-- WHY:   Supabase's advisor triage (2026-10-23) found deletion FAILED for
--        anyone with money history, with only "try again" to show for it:
--          - posts cascade from their owner, but payments.post_id is RESTRICT
--            — so any owner who ever paid (even the £5 fee) was stuck;
--          - payout_reviews.owner_id/spotter_id, refund_disputes.spotter_id
--            (+ sighting_id, NO ACTION), refund_holds.owner_id and
--            payments.payee_account_id are RESTRICT too.
--        That breaks Apple 5.1.1(v), Google Play's deletion policy and UK GDPR
--        Art. 17. The RESTRICTs exist on purpose — money that moved must leave
--        a record (kept ~6 years: HMRC) — so they STAY: this detaches the
--        person explicitly instead, exactly as delete_cancelled_post
--        (20260921100000) already does for one listing.
--
--        ⚠️ delete_post_for_account is delete_old_closed_post (20261022100000)
--        BYTE FOR BYTE except the two blocks marked "NEW 20261023120000":
--        (1) instead of "recovered/expired and a year old", it takes ANY
--        status but a live one; (2) only an 'open' dispute refuses — 'upheld'
--        is final, so the original guard would refuse a settled listing for
--        ever. Diff it against that function; the other money guards, the
--        proof of dead intents and the afterlife are deliberately identical.
--
--        Only the three spotter-side columns become NULLABLE (FKs unchanged):
--        a settled review/dispute on someone else's listing is that owner's
--        record and stays, anonymised. Nothing reads them expecting a person
--        once settled; open ones block the deletion instead.
-- LINKS: supabase/functions/delete-account/index.ts (the caller);
--        supabase/tests/account_deletion_verification.sql;
--        supabase/migrations/20261022100000_retention_rules.sql
--          (delete_old_closed_post — the body copied below);
--        supabase/migrations/20260921100000_a_cancelled_post_can_be_deleted.sql
--          (the afterlife's origin); docs/SECURITY_AND_TRUST.md §3.
-- =============================================================================

-- 1 — schema ------------------------------------------------------------------

-- Who a payment was paid to, after the payout account is gone: the Stripe
-- account id (for reconciling with Stripe's records) and when it was detached.
alter table public.payments add column if not exists payee_snapshot jsonb;

comment on column public.payments.payee_snapshot is
  'Set when the payee''s account is deleted (20261023120000): {stripe_account_id, detached_at}. payee_account_id is then NULL. Keeps money-out records reconcilable with no live link to a person.';

-- Whether their payout account was closed at Stripe after the deletion (null:
-- they had none; false: closing failed — RECORD_OF_PROCESSING §4.17).
alter table public.account_deletions add column if not exists stripe_account_closed boolean;

-- Settled records on someone else's listing outlive the spotter, anonymised.
alter table public.payout_reviews  alter column spotter_id  drop not null;
alter table public.refund_disputes alter column spotter_id  drop not null;
alter table public.refund_disputes alter column sighting_id drop not null;


-- 2 — the blockers ------------------------------------------------------------

create or replace function public.account_deletion_blockers_for(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('code', b.code, 'count', b.n) order by b.ord), '[]'::jsonb)
  from (
    -- A listing still live, being checked, or with a recovery claimed.
    select 1 as ord, 'LIVE_LISTING' as code, count(*)::int as n
      from public.posts
     where owner_id = p_user_id
       and status in ('active', 'pending_verification', 'recovery_claimed')
    union all
    -- Their money still held: escrow, a superseded payment owed back, or a
    -- refund hold whose dispute window is still open.
    select 2, 'MONEY_HELD', (
      (select count(*) from public.payments pay
         join public.posts po on po.id = pay.post_id
        where po.owner_id = p_user_id
          and pay.status in ('held', 'superseded'))
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
  'Reasons a user can''t delete their account yet, [{code, count}] (empty = none): LIVE_LISTING, MONEY_HELD, REWARD_ON_ITS_WAY, DISPUTE_OPEN, REVIEW_OPEN. SERVICE ROLE ONLY (delete_account_data, delete-account); clients call account_deletion_blockers().';

revoke execute on function public.account_deletion_blockers_for(uuid) from public, anon, authenticated;
grant execute on function public.account_deletion_blockers_for(uuid) to service_role;

-- The caller's own — never anyone else's.
create or replace function public.account_deletion_blockers()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;
  return public.account_deletion_blockers_for(auth.uid());
end;
$$;

comment on function public.account_deletion_blockers() is
  'The signed-in user''s reasons they can''t delete their account yet (see account_deletion_blockers_for). Drives the delete screen.';

revoke execute on function public.account_deletion_blockers() from public, anon;
grant execute on function public.account_deletion_blockers() to authenticated;


-- 3 — one listing, for an account being deleted --------------------------------
-- ⚠️ delete_old_closed_post BYTE FOR BYTE except the NEW block (see header).
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

  -- NEW 20261023120000 — THE ONLY CHANGE from delete_old_closed_post: any
  -- listing but a LIVE one (the account is going; its age doesn't matter).
  if v_post.status in ('active', 'pending_verification', 'recovery_claimed') then
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
  'Account deletion (20261023120000): delete_old_closed_post''s body exactly, but for ANY non-live listing (raises LIVE_LISTING for active / pending_verification / recovery_claimed). Every money guard (MONEY_IN_FLIGHT, DISPUTE_OPEN, PAYMENT_REVIEW_OPEN, INTENT_NOT_CANCELLED); ledger rows detached with a post_snapshot, never deleted. SERVICE ROLE ONLY; called by delete_account_data.';

revoke execute on function public.delete_post_for_account(uuid, uuid, text[]) from public, anon, authenticated;
grant execute on function public.delete_post_for_account(uuid, uuid, text[]) to service_role;


-- 4 — the account's data, before its auth row goes ----------------------------
create or replace function public.delete_account_data(
  p_user_id              uuid,
  p_cancelled_intent_ids text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_blockers   jsonb;
  v_post       record;
  v_posts      integer := 0;
  v_payee      integer := 0;
  v_reviews    integer := 0;
  v_disputes   integer := 0;
  v_sightings  integer := 0;
begin
  if p_user_id is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  -- One deletion per account at a time: a double tap, or two devices, must
  -- not interleave.
  perform pg_advisory_xact_lock(hashtextextended('delete_account:' || p_user_id::text, 0));

  -- Every OTHER listing they have a sighting on, locked before the blockers
  -- are read: claim_recovery locks the post FOR UPDATE before it credits, so
  -- an owner can't credit their sighting between the REWARD_ON_ITS_WAY check
  -- and the sightings delete at the end (security review H2). A credit that
  -- got in first is seen by the check; one that comes after finds no sighting.
  perform 1
     from public.posts po
    where po.owner_id <> p_user_id
      and exists (select 1 from public.sightings s
                   where s.post_id = po.id and s.spotter_id = p_user_id)
    order by po.id
    for update;

  -- The same reasons the app showed — re-checked here, where it counts.
  v_blockers := public.account_deletion_blockers_for(p_user_id);
  if jsonb_array_length(v_blockers) > 0 then
    raise exception 'ACCOUNT_BLOCKED:%', v_blockers ->> 0;
  end if;

  -- Their listings: each through the afterlife (ledger detached, never
  -- deleted). Any guard it raises aborts the whole deletion.
  for v_post in
    select id from public.posts where owner_id = p_user_id order by created_at
  loop
    perform public.delete_post_for_account(v_post.id, p_user_id, p_cancelled_intent_ids);
    v_posts := v_posts + 1;
  end loop;

  -- Money paid TO them: keep the record, drop the person. The Stripe account
  -- id stays for reconciling with Stripe's own records.
  update public.payments pay
     set payee_snapshot   = jsonb_build_object(
                              'stripe_account_id', sca.stripe_account_id,
                              'detached_at',       now()),
         payee_account_id = null
    from public.stripe_connected_accounts sca
   where pay.payee_account_id = sca.id
     and sca.profile_id = p_user_id;
  get diagnostics v_payee = row_count;

  -- Settled reviews and disputes on OTHER people's listings: the owner's
  -- record stays, anonymised. (Open ones were refused above; ones on their
  -- own listings went with those listings.) The sighting goes with the
  -- account, so its link is cleared here or it would veto the cascade. The
  -- statement is their own words, so it goes too; the outcome is marked
  -- notified so nothing tries to tell a person who no longer exists.
  update public.payout_reviews
     set spotter_id = null
   where spotter_id = p_user_id;
  get diagnostics v_reviews = row_count;

  update public.refund_disputes
     set spotter_id          = null,
         sighting_id         = null,
         statement           = null,
         outcome_notified_at = coalesce(outcome_notified_at, now())
   where spotter_id = p_user_id;
  get diagnostics v_disputes = row_count;

  -- Their sightings on other listings, NOW, in this transaction — not later
  -- by the auth cascade — while those listings are still locked (above).
  delete from public.sightings where spotter_id = p_user_id;
  get diagnostics v_sightings = row_count;

  return jsonb_build_object(
    'posts_deleted',       v_posts,
    'payments_detached',   v_payee,
    'reviews_anonymised',  v_reviews,
    'disputes_anonymised', v_disputes,
    'sightings_deleted',   v_sightings
  );
end;
$$;

comment on function public.delete_account_data(uuid, text[]) is
  'Account deletion step 1 (20261023120000): refuses ACCOUNT_BLOCKED:{code,count} while account_deletion_blockers_for has reasons; else deletes every listing via delete_post_for_account (ledger detached), detaches payments paid to them (payee_snapshot), anonymises settled reviews/disputes on others'' listings. The auth user is deleted after, by delete-account. SERVICE ROLE ONLY.';

revoke execute on function public.delete_account_data(uuid, text[]) from public, anon, authenticated;
grant execute on function public.delete_account_data(uuid, text[]) to service_role;

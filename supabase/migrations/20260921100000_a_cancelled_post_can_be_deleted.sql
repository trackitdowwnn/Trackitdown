-- =============================================================================
-- WHAT: A cancelled post stops being forever. Two service-role functions:
--
--         delete_cancelled_post(p_post_id, p_owner_id, p_cancelled_intent_ids)
--           — hard-deletes an owner's own CANCELLED listing, on request, the
--           moment its money is settled. Called only by the delete-post Edge
--           Function (and by the purge below).
--
--         purge_cancelled_posts() — deletes every cancelled post whose
--           closed_at is 30+ days old, via the same function. Called only by
--           the hourly sweep (release-held-refunds, Phase 0d). Returns
--           { purged, skipped } so a permanently blocked post is VISIBLE in
--           the sweep summary rather than a notice nobody reads.
--
--       Plus the schema change both need: payments.post_id becomes NULLABLE and
--       payments gains post_snapshot jsonb, so the ledger row can OUTLIVE the
--       post it funded.
--
-- WHY:  Cancelling a listing parked it in My Posts for ever. delete_draft_post
--       (20260816100000) freed drafts with the argument "the clutter they asked
--       to be rid of, wearing a different label" — and a cancelled post is that
--       same clutter with money history attached. The owner asked the car to
--       come down; the app kept a permanent monument to the theft in their own
--       list. Now the owner can delete it at will, and if they don't, retention
--       does it for them at 30 days.
--
--       ⚠️ 30 DAYS, NOT LESS, because DOMAIN.md already promises watchers a
--       30-day TOMBSTONE on a cancelled post (get_my_watchlist). The purge
--       fires only after that window has fully lapsed, so retention can never
--       cut a watcher's tombstone short. An OWNER deleting sooner does end the
--       tombstone early (watchlist_items cascade) — accepted: the owner's right
--       to erase their own theft record outranks a watcher's outcome line.
--
-- ⚠️ THE LEDGER ROW IS DETACHED, NEVER DELETED — when money MOVED. payments is
--       ON DELETE RESTRICT on purpose — "money that moved must leave a record"
--       — and every cancelled post has such a row (a refunded bounty, or a
--       collected fee). The row survives with post_id set NULL and
--       post_snapshot holding what the FK used to reach: the post's identity,
--       its dates, and the settled refund-hold / dispute / payout-review
--       history. The RESTRICT FK itself is unchanged — nothing else may
--       delete a referenced post.
--
--       A row where money NEVER moved ('requires_payment' or 'failed' — a
--       stray intent superseded by a bounty edit, or a decline nobody retried)
--       is DELETED instead, under exactly the proof rule 20260816110000
--       established for drafts: the caller must pass the intent ids it has
--       round-tripped through Stripe and seen `canceled`, and any such row not
--       named in that list raises INTENT_NOT_CANCELLED. A 'failed' row is NOT
--       terminal (that migration's own words: it "routinely points at an
--       intent nobody cancelled", and mark_post_payment_held revives
--       failed -> held), so it can neither be detached — a later capture would
--       land on a row with no post — nor deleted on trust.
--
-- SAFETY: MONEY STILL MOVING BLOCKS THE DELETE.
--         · a payments row in 'held' → MONEY_IN_FLIGHT. On a cancelled post
--           this means escrow waiting behind a refund hold.
--         · an UNEXPIRED refund hold → MONEY_IN_FLIGHT. The 72-hour dispute
--           window is open; the sightings a dispute would cite CASCADE from
--           the post, so deleting now would destroy the evidence mid-window.
--         · an open or upheld dispute → DISPUTE_OPEN. Upheld means the money
--           is going the OTHER way and the post is about to leave `cancelled`.
--         · an UNRESOLVED payout_review → PAYMENT_REVIEW_OPEN. A resolved one
--           does not block (a 'rejected' resolution keeps escrow held, so the
--           'held' guard above already refuses those posts); it is archived
--           into post_snapshot and its row removed — it must be, because its
--           FK is ON DELETE RESTRICT and its post is about to go. The
--           collusion evidence survives on the detached ledger row, the same
--           reasoning device_links uses for evidence outliving accounts.
--       A SETTLED hold (expired, disputes rejected or none) does not block:
--       its rows are archived into post_snapshot and then removed — refund_
--       disputes FIRST, because they reference sightings WITHOUT cascade and
--       would otherwise veto the post's own sightings cascade.
--
--       STORAGE IS DELIBERATELY NOT SWEPT HERE — SQL cannot reach the storage
--       API. post_photos cascade and their trigger (20260901160000) queues the
--       public-bucket paths; sighting_photos cascade and 20260921110000 queues
--       the private-bucket paths; the sweep's Phase 0c removes the bytes for
--       both. Chats, sightings, watchlist rows and flags cascade — they are
--       the post's own record, and erasing the post erases them.
--
-- LINKS: supabase/functions/delete-post/index.ts (the Edge Function: cancels
--          the stray intents AT STRIPE first, exactly as delete-draft does);
--        supabase/functions/release-held-refunds/index.ts (Phase 0d,
--          purge_cancelled_posts' one caller);
--        supabase/migrations/20260816110000_a_draft_delete_must_prove_the_
--          intents_are_dead.sql (the proof rule, copied verbatim);
--        supabase/migrations/20260805100000_refund_holds_and_disputes.sql (the
--          hold/dispute lifecycle the guards respect);
--        supabase/migrations/20260803140000_payout_collusion_check.sql
--          (payout_reviews and its RESTRICT FK);
--        supabase/migrations/20260722100000_watchlist.sql (closed_at — the
--          retention anchor — and the tombstone the 30 days protects);
--        supabase/migrations/20260921110000_sighting_photos_join_the_orphan_
--          queue.sql (the storage half of erasure);
--        supabase/tests/delete_cancelled_post_verification.sql.
-- =============================================================================


-- =============================================================================
-- 1. The ledger learns to outlive its post.
-- =============================================================================
alter table public.payments
  alter column post_id drop not null;

alter table public.payments
  add column post_snapshot jsonb;

comment on column public.payments.post_id is
  'The post whose money this row tracks. NULL once that post has been deleted (delete_cancelled_post detaches terminal rows; rows where money never moved are proof-deleted instead); post_snapshot then holds what this FK used to reach. ON DELETE RESTRICT stands: only the detach inside delete_cancelled_post may separate a ledger row from a live post.';

comment on column public.payments.post_snapshot is
  'Written ONCE, by delete_cancelled_post, at the moment the post is deleted: the post''s identity (id, owner, plate, make/model/colour), its created/closed/deleted dates, and the settled refund-hold + dispute + payout-review rows that were removed with it. NULL while the post still exists. Audit surface — never read by application code.';


-- =============================================================================
-- 2. delete_cancelled_post — the owner's delete.
-- =============================================================================
create or replace function public.delete_cancelled_post(
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

  if v_post.status <> 'cancelled' then
    raise exception 'NOT_CANCELLED';
  end if;

  -- Escrow still held — a refund hold mid-window, or a refund mid-flight.
  if exists (
    select 1 from public.payments
    where post_id = p_post_id
      and status = 'held'
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

  if exists (
    select 1 from public.refund_disputes
    where post_id = p_post_id
      and status in ('open', 'upheld')
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
    'refund_hold',     (select to_jsonb(h) from public.refund_holds h where h.post_id = p_post_id),
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

comment on function public.delete_cancelled_post(uuid, uuid, text[]) is
  'Hard-deletes an owner''s own CANCELLED post once its money is settled: terminal ledger rows are DETACHED (post_id nulled, post_snapshot written), never-captured rows are deleted only when named in the caller''s Stripe-verified cancelled-intent list, and settled hold/dispute/review rows are archived into the snapshot and removed. SERVICE ROLE ONLY (delete-post Edge Function, purge_cancelled_posts). Raises NOT_OWNER / NOT_CANCELLED / MONEY_IN_FLIGHT / DISPUTE_OPEN / PAYMENT_REVIEW_OPEN / INTENT_NOT_CANCELLED.';


-- =============================================================================
-- 3. purge_cancelled_posts — retention at 30 days.
-- =============================================================================
create or replace function public.purge_cancelled_posts()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r         record;
  v_purged  integer := 0;
  v_skipped integer := 0;
begin
  -- 30 days = the watchlist tombstone window (DOMAIN.md), fully lapsed.
  -- closed_at is trigger-frozen at the moment of cancellation, so this is
  -- "30 days since the owner took it down", not since creation. LIMIT bounds
  -- one run's work; the sweep is hourly, so a backlog drains within a day.
  for r in
    select id, owner_id
    from public.posts
    where status = 'cancelled'
      and closed_at is not null
      and closed_at < now() - interval '30 days'
    order by closed_at
    limit 200
  loop
    begin
      -- An empty proof list: SQL cannot talk to Stripe, so a post carrying a
      -- stray requires_payment/failed row raises INTENT_NOT_CANCELLED and is
      -- SKIPPED here — the owner's manual delete (which does cancel intents
      -- at Stripe) remains the way out for those. Counted, not hidden: a
      -- non-zero `skipped` in the sweep summary is the signal to look.
      perform public.delete_cancelled_post(r.id, r.owner_id, '{}'::text[]);
      v_purged := v_purged + 1;
    exception when others then
      -- A guard fired (money in flight, an open dispute, an unproven intent)
      -- or a race. Skip and let the next run retry — one blocked post must
      -- not stop the queue, the same per-item rule as every sweep phase.
      v_skipped := v_skipped + 1;
      raise notice 'purge_cancelled_posts skipped % (%)', r.id, sqlerrm;
    end;
  end loop;

  return jsonb_build_object('purged', v_purged, 'skipped', v_skipped);
end;
$$;

comment on function public.purge_cancelled_posts() is
  'Retention for cancelled posts: deletes (via delete_cancelled_post, so every money guard applies) each one whose closed_at is 30+ days past — the watchlist tombstone window, fully lapsed. Per-item failures are skipped and retried next run; 200 per call. SERVICE ROLE ONLY; called hourly by release-held-refunds Phase 0d. Returns { purged, skipped } — a persistently non-zero skipped means posts the guards keep refusing (e.g. a stray uncaptured intent only the owner''s own delete can clear).';


-- =============================================================================
-- 4. Grants — service_role and nobody else.
-- =============================================================================
-- ⚠️ `security definer` functions are executable by PUBLIC by default, and this
-- project ALSO ships ALTER DEFAULT PRIVILEGES granting EXECUTE on new functions
-- to anon + authenticated (20260713191000), which a `revoke from public` does
-- not touch — so both revokes are load-bearing. delete_cancelled_post performs
-- its own ownership check, but the Edge Function is where "who is asking" is
-- proven from a JWT AND where the intents are cancelled at Stripe — a client
-- reaching the RPC directly could pass a hopeful proof list it never verified.
-- purge_cancelled_posts checks nothing at all.
revoke all on function public.delete_cancelled_post(uuid, uuid, text[]) from public;
revoke all on function public.delete_cancelled_post(uuid, uuid, text[]) from anon, authenticated;
grant execute on function public.delete_cancelled_post(uuid, uuid, text[]) to service_role;

revoke all on function public.purge_cancelled_posts() from public;
revoke all on function public.purge_cancelled_posts() from anon, authenticated;
grant execute on function public.purge_cancelled_posts() to service_role;

-- --- Assert the grants and the schema change --------------------------------
do $$
begin
  if has_function_privilege('authenticated', 'public.delete_cancelled_post(uuid, uuid, text[])', 'execute')
     or has_function_privilege('anon', 'public.delete_cancelled_post(uuid, uuid, text[])', 'execute') then
    raise exception 'delete_cancelled_post is client-executable — the JWT proof and Stripe cancellation in delete-post can be skipped';
  end if;
  if has_function_privilege('authenticated', 'public.purge_cancelled_posts()', 'execute')
     or has_function_privilege('anon', 'public.purge_cancelled_posts()', 'execute') then
    raise exception 'purge_cancelled_posts is client-executable — any signed-in user could mass-delete cancelled posts';
  end if;
  if not has_function_privilege('service_role', 'public.delete_cancelled_post(uuid, uuid, text[])', 'execute')
     or not has_function_privilege('service_role', 'public.purge_cancelled_posts()', 'execute') then
    raise exception 'service_role cannot execute the cancelled-post delete path — Edge Function and sweep are both broken';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'payments'
      and column_name = 'post_id' and is_nullable = 'NO'
  ) then
    raise exception 'payments.post_id is still NOT NULL — the ledger cannot outlive its post';
  end if;
  raise notice 'cancelled-post delete path: service_role only; ledger rows can detach.';
end;
$$;

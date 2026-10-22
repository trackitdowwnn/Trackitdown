-- =============================================================================
-- WHAT:  Retention rules (owner, 2026-10-22), each a service-role function the
--        hourly sweep (release-held-refunds) calls:
--          1. purge_closed_sighting_details() — 90 days after a listing
--             closes: its sightings' street-level area_label and every word a
--             spotter wrote (note, damage_note, missing_parts_note,
--             withdraw_note) are cleared. The photo GPS was already cleared at
--             90 days (purge_sighting_location_history); now the rest of
--             "where, in their words" goes with it.
--          2. delete_old_closed_post() + purge_old_closed_posts() — a listing
--             RECOVERED (or recovered with no spotter, or expired) is deleted
--             12 months after it closed; old_closed_posts_with_stray_intents
--             lists the ones the sweep must first prove clean at Stripe.
--             Cancelled listings already go at 30 days (purge_cancelled_posts).
--          3. purge_stale_push_tokens() — a push token no app has refreshed in
--             270 days (~9 months) is deleted. The app re-registers on every
--             cold start (usePushRegistration), so this is a phone that has
--             not opened the app in nine months.
--          4. purge_old_webhook_events() — Stripe webhook dedup ids older
--             than 30 days are deleted. Stripe retries for 3 days at most.
-- WHY:   docs/RECORD_OF_PROCESSING.md §5 items 3, 4 and 8: the privacy policy
--        said "the detailed location history … is deleted after 90 days" but
--        only photo GPS was; spotters' words had no purge at all; and
--        recovered listings, push tokens and webhook ids were kept forever.
-- LINKS: supabase/functions/release-held-refunds/index.ts (the caller);
--        supabase/migrations/20261006130000_a_reward_expires.sql
--          (delete_cancelled_post — copied byte for byte below, one guard
--          changed); 20260921120000_a_warning_comes_before_the_purge.sql
--          (purge_cancelled_posts — the pattern purge_old_closed_posts
--          follows); supabase/tests/retention_rules_verification.sql;
--        docs/RECORD_OF_PROCESSING.md; docs/SECURITY_AND_TRUST.md §3.
--
-- SAFETY — every purge leaves MONEY alone:
--   * Sighting words on a listing with money still moving (a held or
--     superseded payment, an unresolved payout review, an open dispute, a
--     refund hold still in its window) — or with ANY payment made in the last
--     180 days, which a card chargeback could still reach (the networks allow
--     ~120 days, and chargebacks are not recorded here) — are kept: they may
--     be the evidence.
--   * delete_old_closed_post carries every guard delete_cancelled_post has —
--     money in flight, an open hold window, an open or upheld dispute, an
--     unresolved review, an uncaptured intent nobody has proven dead — and
--     the same afterlife: ledger rows detached with a post_snapshot, never
--     deleted.
--   * Abandoned or declined payment attempts (requires_payment / failed) are
--     routine — a changed amount, a declined card. SQL cannot prove them dead
--     at Stripe, so purge_old_closed_posts takes only listings without them,
--     and old_closed_posts_with_stray_intents hands the rest to the sweep,
--     which cancels each intent at Stripe and passes only the ones Stripe
--     confirms dead — exactly what delete-post does for an owner's delete.
--     One it cannot prove is refused and COUNTED as skipped; nothing is kept
--     silently.
--   * No owner warning before the 12-month delete (unlike the 30-day
--     cancelled purge): the listing has been off public view for 11 months,
--     and the privacy policy states the period. Owner's call, 2026-10-22.
-- =============================================================================


-- =============================================================================
-- 1. purge_closed_sighting_details — 90 days after the listing closes
-- =============================================================================
create or replace function public.purge_closed_sighting_details()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cleared integer;
begin
  update public.sightings s
     set area_label         = null,
         note               = null,
         damage_note        = null,
         missing_parts_note = null,
         withdraw_note      = null
   where (s.area_label is not null
          or s.note is not null
          or s.damage_note is not null
          or s.missing_parts_note is not null
          or s.withdraw_note is not null)
     and exists (
       select 1
         from public.posts po
        where po.id = s.post_id
          and po.closed_at is not null
          and po.closed_at < now() - interval '90 days')
     -- Money still moving on the listing: keep the words, they may be evidence.
     and not exists (
       select 1 from public.payments pay
        where pay.post_id = s.post_id
          and pay.status in ('held', 'superseded'))
     and not exists (
       select 1 from public.payout_reviews r
        where r.post_id = s.post_id
          and r.resolved_at is null)
     and not exists (
       select 1 from public.refund_disputes d
        where d.post_id = s.post_id
          and d.status = 'open')
     and not exists (
       select 1 from public.refund_holds h
        where h.post_id = s.post_id
          and h.expires_at > now())
     -- A payment made in the last 180 days can still be charged back.
     and not exists (
       select 1 from public.payments pay
        where pay.post_id = s.post_id
          and greatest(pay.created_at, coalesce(pay.captured_at, pay.created_at))
              > now() - interval '180 days');

  get diagnostics v_cleared = row_count;
  return v_cleared;
end $$;

comment on function public.purge_closed_sighting_details() is
  'Retention (2026-10-22): 90 days after a listing closes, clears its sightings'' street-level area_label and every free-text field (note, damage_note, missing_parts_note, withdraw_note) — unless money is still moving on the listing (held/superseded payment, unresolved payout review, open dispute, live refund hold) or any payment on it is under 180 days old (chargeback reach). The structured answers, the photos and the row stay; photo GPS is purge_sighting_location_history''s. Returns rows changed. SERVICE ROLE ONLY; called hourly by release-held-refunds.';

revoke execute on function public.purge_closed_sighting_details() from public, anon, authenticated;
grant execute on function public.purge_closed_sighting_details() to service_role;


-- =============================================================================
-- 2. delete_old_closed_post — delete_cancelled_post with one guard changed
-- =============================================================================
-- ⚠️ BYTE FOR BYTE from 20261006130000's delete_cancelled_post (the latest
-- definition) EXCEPT the block marked "NEW 20261022100000": the status guard.
-- Same signature, so it is called exactly as delete_cancelled_post is: by the
-- purge below with an EMPTY proof list (it only takes listings with no stray
-- intent), and by the sweep's Phase 0d2 with the intent ids Stripe confirmed
-- cancelled (old_closed_posts_with_stray_intents). An unproven intent raises
-- INTENT_NOT_CANCELLED. Diff it against delete_cancelled_post.
create or replace function public.delete_old_closed_post(
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

  -- NEW 20261022100000 — THE ONLY CHANGE from delete_cancelled_post: a
  -- listing that was recovered (or expired), closed a year or more ago.
  if v_post.status not in ('recovered', 'recovered_no_spotter', 'expired') then
    raise exception 'NOT_RECOVERED';
  end if;
  if v_post.closed_at is null or v_post.closed_at >= now() - interval '12 months' then
    raise exception 'NOT_DUE';
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

comment on function public.delete_old_closed_post(uuid, uuid, text[]) is
  'Retention (2026-10-22): deletes a RECOVERED / RECOVERED_NO_SPOTTER / EXPIRED listing closed 12+ months ago. delete_cancelled_post''s body exactly, the status guard aside: every money guard (MONEY_IN_FLIGHT, DISPUTE_OPEN, PAYMENT_REVIEW_OPEN, INTENT_NOT_CANCELLED), ledger rows detached with a post_snapshot (never deleted), settled holds/disputes/reviews archived into it; sightings, photos (queued for the sweep), chats and watchers cascade. Raises NOT_RECOVERED / NOT_DUE otherwise. SERVICE ROLE ONLY; called by purge_old_closed_posts.';

revoke execute on function public.delete_old_closed_post(uuid, uuid, text[]) from public, anon, authenticated;
grant execute on function public.delete_old_closed_post(uuid, uuid, text[]) to service_role;


-- =============================================================================
-- 3. purge_old_closed_posts — the hourly caller
-- =============================================================================
create or replace function public.purge_old_closed_posts()
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
  -- Only listings the guards will accept with an empty proof list: none with
  -- money moving, and none with an abandoned or declined intent — those are
  -- old_closed_posts_with_stray_intents', proven at Stripe by the sweep.
  -- Selecting only these keeps `skipped` a true alarm (a race or a guard we
  -- did not foresee) and stops a stuck listing from starving the LIMIT.
  for r in
    select p.id, p.owner_id
      from public.posts p
     where p.status in ('recovered', 'recovered_no_spotter', 'expired')
       and p.closed_at is not null
       and p.closed_at < now() - interval '12 months'
       and not exists (
         select 1 from public.payments pay
          where pay.post_id = p.id
            and pay.status in ('held', 'superseded', 'requires_payment', 'failed'))
       and not exists (
         select 1 from public.payout_reviews rv
          where rv.post_id = p.id
            and rv.resolved_at is null)
       and not exists (
         select 1 from public.refund_disputes d
          where d.post_id = p.id
            and d.status in ('open', 'upheld'))
       and not exists (
         select 1 from public.refund_holds h
          where h.post_id = p.id
            and h.expires_at > now())
     order by p.closed_at
     limit 200
  loop
    begin
      perform public.delete_old_closed_post(r.id, r.owner_id, '{}'::text[]);
      v_purged := v_purged + 1;
    exception when others then
      v_skipped := v_skipped + 1;
      raise notice 'purge_old_closed_posts skipped % (%)', r.id, sqlerrm;
    end;
  end loop;

  return jsonb_build_object('purged', v_purged, 'skipped', v_skipped);
end;
$$;

comment on function public.purge_old_closed_posts() is
  'Retention (2026-10-22): deletes each recovered / recovered_no_spotter / expired listing closed 12+ months ago through delete_old_closed_post (every money guard applies). Selects only listings with no money moving, so a non-zero skipped is an alarm. 200 per call. SERVICE ROLE ONLY; called hourly by release-held-refunds. Returns { purged, skipped }.';

revoke execute on function public.purge_old_closed_posts() from public, anon, authenticated;
grant execute on function public.purge_old_closed_posts() to service_role;


-- =============================================================================
-- 3b. old_closed_posts_with_stray_intents — the ones only Stripe can settle
-- =============================================================================
-- The due listings purge_old_closed_posts leaves out because an abandoned or
-- declined attempt sits on the ledger, with every money guard but that one.
-- Read-only: the sweep cancels each intent at Stripe, then calls
-- delete_old_closed_post with the ids Stripe confirmed — the same proof an
-- owner's own delete (delete-post) supplies.
create or replace function public.old_closed_posts_with_stray_intents(p_limit integer default 50)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
           jsonb_agg(jsonb_build_object(
             'post_id',    c.id,
             'owner_id',   c.owner_id,
             'intent_ids', to_jsonb(c.intent_ids))
           order by c.closed_at),
           '[]'::jsonb)
    from (
      select p.id, p.owner_id, p.closed_at,
             array(select pay.stripe_payment_intent_id
                     from public.payments pay
                    where pay.post_id = p.id
                      and pay.status in ('requires_payment', 'failed')
                    order by pay.created_at) as intent_ids
        from public.posts p
       where p.status in ('recovered', 'recovered_no_spotter', 'expired')
         and p.closed_at is not null
         and p.closed_at < now() - interval '12 months'
         and exists (
           select 1 from public.payments pay
            where pay.post_id = p.id
              and pay.status in ('requires_payment', 'failed'))
         and not exists (
           select 1 from public.payments pay
            where pay.post_id = p.id
              and pay.status in ('held', 'superseded'))
         and not exists (
           select 1 from public.payout_reviews rv
            where rv.post_id = p.id
              and rv.resolved_at is null)
         and not exists (
           select 1 from public.refund_disputes d
            where d.post_id = p.id
              and d.status in ('open', 'upheld'))
         and not exists (
           select 1 from public.refund_holds h
            where h.post_id = p.id
              and h.expires_at > now())
       order by p.closed_at
       limit greatest(coalesce(p_limit, 50), 0)
    ) c;
$$;

comment on function public.old_closed_posts_with_stray_intents(integer) is
  'Retention (2026-10-22): due recovered / recovered_no_spotter / expired listings (closed 12+ months, no money moving) that carry an abandoned or declined intent (requires_payment / failed) — [{post_id, owner_id, intent_ids}], oldest first. Read-only. The sweep (release-held-refunds Phase 0d2) cancels each intent at Stripe and calls delete_old_closed_post with the ids Stripe confirms. SERVICE ROLE ONLY.';

revoke execute on function public.old_closed_posts_with_stray_intents(integer) from public, anon, authenticated;
grant execute on function public.old_closed_posts_with_stray_intents(integer) to service_role;


-- =============================================================================
-- 4. purge_stale_push_tokens — the janitor push_tokens.updated_at was for
-- =============================================================================
create or replace function public.purge_stale_push_tokens()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  delete from public.push_tokens where updated_at < now() - interval '270 days';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end $$;

comment on function public.purge_stale_push_tokens() is
  'Retention (2026-10-22): deletes push tokens not re-registered in 270 days. The app re-registers on every cold start (usePushRegistration), so this is a phone that has not opened the app in ~9 months; opening it again re-registers. SERVICE ROLE ONLY; called hourly by release-held-refunds.';

revoke execute on function public.purge_stale_push_tokens() from public, anon, authenticated;
grant execute on function public.purge_stale_push_tokens() to service_role;


-- =============================================================================
-- 5. purge_old_webhook_events — dedup ids past any retry
-- =============================================================================
create or replace function public.purge_old_webhook_events()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  delete from public.stripe_webhook_events where processed_at < now() - interval '30 days';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end $$;

comment on function public.purge_old_webhook_events() is
  'Retention (2026-10-22): deletes Stripe webhook dedup ids older than 30 days. Stripe retries a delivery for 3 days at most, so an id past 30 days can never dedupe anything again. SERVICE ROLE ONLY; called hourly by release-held-refunds.';

revoke execute on function public.purge_old_webhook_events() from public, anon, authenticated;
grant execute on function public.purge_old_webhook_events() to service_role;


-- =============================================================================
-- END OF MIGRATION
-- =============================================================================

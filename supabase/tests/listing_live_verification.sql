-- =============================================================================
-- WHAT:  Verification for the owner's "your listing is live" claim
--        (20261014120000_an_owner_hears_their_listing_is_live.sql). NOT a
--        migration.
-- WHY:   Two paths now record a capture (the webhook, and sync-post-payment),
--        and both call this claim. It must fire ONCE per listing, and only for
--        the capture that actually took it live — a renewal or a reward added
--        later is a capture on a listing already live, and "your listing is
--        live" there would be news about nothing.
--
-- CHECKS: 1 ⚠️ the first capture of a live post claims, with copy, ONCE ·
-- 2 ⚠️ a later capture (a renewal) on a live post never claims · 3 a post
-- still in draft never claims · 4 an uncaptured intent never claims ·
-- 5 grants, the new kind, and that it cannot be muted.
-- HOW:   Self-asserting, RAISE on failure (CI's db job), inside begin/rollback.
--        Owner 11111111-… (seed profile).
-- LINKS: supabase/migrations/20261014120000_an_owner_hears_their_listing_is_live.sql.
-- =============================================================================

begin;
insert into public.posts (id, owner_id, status, bounty_amount_pence, plate)
values ('ee000000-0000-0000-0000-000000000061', '11111111-1111-1111-1111-111111111111', 'active', 20000, 'LL01 NEW'),
       ('ee000000-0000-0000-0000-000000000062', '11111111-1111-1111-1111-111111111111', 'active', 20000, 'LL01 REN'),
       ('ee000000-0000-0000-0000-000000000063', '11111111-1111-1111-1111-111111111111', 'draft',  20000, 'LL01 DRF'),
       ('ee000000-0000-0000-0000-000000000064', '11111111-1111-1111-1111-111111111111', 'active', 20000, 'LL01 UNC');
insert into public.payments (id, post_id, stripe_payment_intent_id, status, amount_pence, captured_at)
values
  -- Post 61: its one and only capture — the go-live.
  ('ee000061-0000-0000-0000-00000000000a', 'ee000000-0000-0000-0000-000000000061', 'pi_ll_first', 'held', 20000, now()),
  -- Post 62: captured 50 days ago, then renewed today.
  ('ee000062-0000-0000-0000-00000000000a', 'ee000000-0000-0000-0000-000000000062', 'pi_ll_old', 'superseded', 20000, now() - interval '50 days'),
  ('ee000062-0000-0000-0000-00000000000b', 'ee000000-0000-0000-0000-000000000062', 'pi_ll_renew', 'held', 20000, now()),
  -- Post 63: still a draft.
  ('ee000063-0000-0000-0000-00000000000a', 'ee000000-0000-0000-0000-000000000063', 'pi_ll_draft', 'held', 20000, now()),
  -- Post 64: an intent never captured.
  ('ee000064-0000-0000-0000-00000000000a', 'ee000000-0000-0000-0000-000000000064', 'pi_ll_uncaptured', 'requires_payment', 20000, null);

do $$
declare
  v_res jsonb;
begin
  -- CHECK 1 — the first capture claims, with copy, once.
  v_res := public.claim_listing_live_notification('pi_ll_first');
  if not (v_res ->> 'claimed')::boolean
     or (v_res ->> 'user_id')::uuid <> '11111111-1111-1111-1111-111111111111'
     or (v_res ->> 'post_id')::uuid <> 'ee000000-0000-0000-0000-000000000061'
     or v_res ->> 'title' is null or v_res ->> 'body' is null then
    raise exception 'CHECK 1 FAILED: the go-live capture did not claim with copy (%)', v_res;
  end if;
  v_res := public.claim_listing_live_notification('pi_ll_first');
  if (v_res ->> 'claimed')::boolean then
    raise exception 'CHECK 1 FAILED: a second claim won — the webhook and the sync would both push';
  end if;

  -- CHECK 2 — ⚠️ a renewal is not a go-live.
  v_res := public.claim_listing_live_notification('pi_ll_renew');
  if (v_res ->> 'claimed')::boolean then
    raise exception 'CHECK 2 FAILED: a renewal on a live listing claimed "your listing is live"';
  end if;

  -- CHECK 3 — a draft never claims.
  v_res := public.claim_listing_live_notification('pi_ll_draft');
  if (v_res ->> 'claimed')::boolean then
    raise exception 'CHECK 3 FAILED: a post still in draft claimed the live push';
  end if;

  -- CHECK 4 — an intent never captured never claims.
  v_res := public.claim_listing_live_notification('pi_ll_uncaptured');
  if (v_res ->> 'claimed')::boolean then
    raise exception 'CHECK 4 FAILED: an intent never captured claimed the live push';
  end if;

  raise notice 'listing live CHECKS 1-4 passed';
end $$;

-- CHECK 5 — grants, the new kind, and that it cannot be muted.
do $$
begin
  if has_function_privilege('anon', 'public.claim_listing_live_notification(text)', 'execute')
     or has_function_privilege('authenticated', 'public.claim_listing_live_notification(text)', 'execute') then
    raise exception 'CHECK 5 FAILED: a client role can execute claim_listing_live_notification';
  end if;
  if not has_function_privilege('service_role', 'public.claim_listing_live_notification(text)', 'execute') then
    raise exception 'CHECK 5 FAILED: service_role cannot execute claim_listing_live_notification';
  end if;
  insert into public.notifications (user_id, kind, title, body, payload)
  values ('11111111-1111-1111-1111-111111111111', 'listing_live', 't', 'b', '{}'::jsonb);
  if public.notification_category('listing_live') is not null then
    raise exception 'CHECK 5 FAILED: listing_live is mutable';
  end if;
  raise notice 'listing live CHECK 5 passed';
end $$;

rollback;

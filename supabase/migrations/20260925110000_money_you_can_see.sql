-- =============================================================================
-- WHAT:  The reads behind "where's my money" (escrow UX overhaul, PR 2).
--          1. post_money_state(post)      INTERNAL — one listing's money, as a
--                                         state the owner can be shown.
--          2. get_post_money(post)        the owner's read of (1). Owner-only.
--          3. list_my_posts()             gains a compact `money` per listing.
--          4. credit_money_state(sighting) INTERNAL — one credited sighting's
--                                         reward, as a state the spotter can be
--                                         shown.
--          5. my_earnings()               every reward the caller has earned,
--                                         with totals. Caller-only.
--          6. my_sighting_record()        own credited rows gain `money`; the
--                                         dispute door gains `can_file` and
--                                         stops opening after its window.
--          7. my_dispute_context()        the same door rule as (6).
--
-- WHY:   Six payment states exist on the server and until now NO screen could
--        read any of them (ADR-0018 said so in as many words). After an owner
--        paid, the only signals were a one-off toast and a post status badge:
--        "Recovered" looked the same whether the spotter was paid or the owner
--        refunded, a held refund read "Cancelled", and "waiting for the
--        spotter's bank details" vanished when its toast did. A spotter saw one
--        pending credit (`limit 1`), no history, and nothing at all while a
--        payout was being checked. These reads make every one of those states
--        something a screen can show.
--
-- DERIVED, NOT STORED. Every state here is computed from the tables that are
--        already the truth — payments, sightings, payout_reviews,
--        stripe_connected_accounts, refund_holds, refund_disputes. A stored
--        copy would be a second writer that can drift from the money it
--        describes; refund_holds already derives "released" for the same
--        reason. The helpers do indexed lookups on one post / one sighting.
--
-- PRIVACY — what never leaves:
--        * payout_reviews REASONS, and whether a review is pending or was
--          rejected. Both read "being_checked"; a reasons string, or a
--          visible "rejected", would tell a colluding pair which signal fired.
--        * Stripe ids of any kind; other spotters; dispute counts; the
--          spotter's identity or onboarding detail beyond "waiting for their
--          bank details", which the owner's toast already said.
--        * For a spotter: the post id, owner, plate and location of a closed
--          listing (my_sighting_record's standing rule). Their OWN reward
--          amount is theirs — the credited push already told them it.
--
-- THE DISPUTE DOOR. my_sighting_record and my_dispute_context opened the door
--        whenever a hold NAMED the sighting, but open_dispute also refuses once
--        the window has closed or the money has moved. So after 72 hours the
--        card still said "Tell us if this was your sighting" and the tap landed
--        on "Nothing to do here". Both now share one rule: the door is there if
--        the hold names the sighting AND (they already filed — so they can read
--        the outcome — OR it is still fileable: window open, payment held,
--        sighting not credited). `can_file` says which.
--
-- SAFETY NOTE ON DESTRUCTIVE STATEMENTS: none. New functions, and three
--        `create or replace`s restated from their latest definitions with the
--        same signatures, so every grant survives:
--          list_my_posts        <- 20260924130000_archive_listings.sql
--          my_sighting_record   <- 20260903110000_my_reports_can_open_the_post.sql
--          my_dispute_context   <- 20260925100000_the_reward_is_the_reward.sql
--
-- LINKS: docs/decisions/ADR-0020-the-reward-is-the-reward.md;
--        docs/decisions/ADR-0011-refund-holds-and-disputes.md (holds, disputes);
--        supabase/functions/_shared/releasePayout.ts (the payout outcomes these
--          states mirror: paid / awaiting_payee / held_for_review);
--        supabase/tests/money_status_verification.sql.
-- =============================================================================

begin;

-- =============================================================================
-- 1. post_money_state — one listing's money, for its owner.
--
--    States (ordered roughly by the listing's life):
--      fee_paid        a £5 listing: paid, never refunded, nothing more to say
--      held            the charge is held; the listing is live
--      awaiting_payee  a spotter is credited; they have not finished payouts
--      being_checked   a spotter is credited; the payout is held for review
--      sending         a spotter is credited and payable; the transfer is due
--      paid            the reward reached the spotter
--      refund_on_hold  refund waits out the 72h window (until refundHold.expiresAt)
--      refund_paused   a spotter disputed; a person is looking
--      refund_owed     "found it another way" was claimed but its refund never
--                      started — the owner must finish it from the listing
--      refunding       the refund is due and has not landed yet
--      refunded        the refund reached the owner
--    NULL: no captured payment (a draft, or a charge that never succeeded).
-- =============================================================================
create or replace function public.post_money_state(p_post_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  -- Scalars, not records, for everything a branch may never select: reading
  -- a field of a record that was never assigned is an error in PL/pgSQL, and
  -- the £5 branch skips the credited / hold lookups entirely.
  v_post_status  public.post_status;
  v_pay          record;
  v_credited_id  uuid;
  v_spotter_id   uuid;
  v_review       text;     -- 'pending' | 'rejected' | 'approved' | null
  v_payable      boolean;
  v_hold_expires timestamptz;
  v_paused       boolean := false;
  v_state        text;
  v_headline     integer;
begin
  select status into v_post_status from public.posts where id = p_post_id;
  if not found then
    return null;
  end if;

  -- The captured charge. `failed` and `requires_payment` rows are attempts,
  -- not money; the newest captured row is the one this listing runs on (there
  -- is only ever one — create-payment-intent refuses a second).
  select kind, pricing, status, amount_pence, reward_pence, service_fee_pence,
         transfer_amount_pence, refunded_amount_pence, released_at, refunded_at
    into v_pay
    from public.payments
   where post_id = p_post_id
     and status in ('held', 'released', 'refunded', 'collected')
   order by created_at desc
   limit 1;
  if not found then
    return null;
  end if;

  if v_pay.kind = 'listing_fee' then
    v_state    := 'fee_paid';
    v_headline := v_pay.amount_pence;
  elsif v_pay.status = 'released' then
    v_state    := 'paid';
    v_headline := v_pay.transfer_amount_pence;
  elsif v_pay.status = 'refunded' then
    v_state    := 'refunded';
    v_headline := v_pay.refunded_amount_pence;
  else
    -- HELD. Who, if anyone, is this money waiting on?
    select s.id, s.spotter_id into v_credited_id, v_spotter_id
      from public.sightings s
     where s.post_id = p_post_id and s.status = 'credited';

    if v_credited_id is not null then
      select case when r.resolution is null then 'pending' else r.resolution end
        into v_review
        from public.payout_reviews r
       where r.post_id = p_post_id;
      select a.payouts_enabled into v_payable
        from public.stripe_connected_accounts a
       where a.profile_id = v_spotter_id;

      -- ⚠️ pending and rejected read the SAME. A person decides a review; the
      -- owner is told only that the payout is being checked, never the outcome
      -- or the reason (SECURITY_AND_TRUST §5 — no oracle for a colluding pair).
      v_state := case
        when v_review in ('pending', 'rejected') then 'being_checked'
        when coalesce(v_payable, false)            then 'sending'
        else 'awaiting_payee'
      end;
      v_headline := v_pay.reward_pence;
    else
      select h.expires_at into v_hold_expires
        from public.refund_holds h
       where h.post_id = p_post_id;

      if v_hold_expires is not null then
        select exists (
          select 1 from public.refund_disputes d
           where d.post_id = p_post_id and d.status in ('open', 'upheld')
        ) into v_paused;
        v_state := case
          when v_paused              then 'refund_paused'
          when v_hold_expires > now() then 'refund_on_hold'
          else 'refunding'
        end;
      elsif v_post_status in ('cancelled', 'recovered_no_spotter') then
        -- Closed with no hold and the money still held: the refund was issued
        -- at Stripe and its record has not landed yet — the charge.refunded
        -- webhook writes it. In flight.
        v_state := 'refunding';
      elsif v_post_status = 'recovery_claimed' then
        -- ⚠️ "FOUND IT ANOTHER WAY", INTERRUPTED (review 2026-09-25). On a
        -- reward listing claim_recovery's no-spotter answer moves the post to
        -- recovery_claimed and the app then calls refund-recovery. If that
        -- never finished — the app died, or the owner left the attestation —
        -- there is no credited sighting, no hold, and nothing that will ever
        -- retry it. Reading that as `held` told the owner their reward was
        -- waiting to be paid out, after they had said nobody found it. The
        -- owner finishes it from the listing (the app offers "Finish your
        -- refund", which resumes the same refund path).
        v_state := 'refund_owed';
      else
        v_state := 'held';
      end if;
      v_headline := case when v_state = 'held' then v_pay.reward_pence else v_pay.amount_pence end;
    end if;
  end if;

  return jsonb_build_object(
    'kind',                v_pay.kind,
    'pricing',             v_pay.pricing,
    'state',               v_state,
    -- The one figure a compact surface shows beside the state: the reward
    -- while it is held or owed, what was paid or refunded once it moved, the
    -- whole charge while a refund is pending.
    'headlinePence',       v_headline,
    'rewardPence',         v_pay.reward_pence,
    'serviceFeePence',     v_pay.service_fee_pence,
    'chargedPence',        v_pay.amount_pence,
    'hasCreditedSighting', v_credited_id is not null,
    'paid', case when v_pay.status = 'released' then
      jsonb_build_object('pence', v_pay.transfer_amount_pence, 'at', v_pay.released_at) end,
    'refund', case when v_pay.status = 'refunded' then
      jsonb_build_object(
        'pence',        v_pay.refunded_amount_pence,
        'cardFeePence', v_pay.amount_pence - v_pay.refunded_amount_pence,
        'at',           v_pay.refunded_at) end,
    'refundHold', case when v_hold_expires is not null then
      jsonb_build_object('expiresAt', v_hold_expires, 'paused', v_paused) end
  );
end $$;

comment on function public.post_money_state(uuid) is
  'INTERNAL: one listing''s money as an owner-facing state (fee_paid, held, awaiting_payee, being_checked, sending, paid, refund_on_hold, refund_paused, refund_owed, refunding, refunded) plus the amounts behind it; NULL when nothing was captured. Derived from payments, sightings, payout_reviews, stripe_connected_accounts, refund_holds and refund_disputes — never stored. A pending and a rejected payout review both read being_checked; reasons never appear. No ownership check: callable only by the SECURITY DEFINER reads that make one.';

revoke all on function public.post_money_state(uuid) from public, anon, authenticated;


-- =============================================================================
-- 2. get_post_money — the owner's read.
-- =============================================================================
create or replace function public.get_post_money(p_post_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  -- SAFETY: the owner, or nobody. Not-yours and not-found are the same NULL,
  -- so this cannot be used to probe which listings have money moving.
  if not exists (
    select 1 from public.posts
     where id = p_post_id and owner_id = (select auth.uid())
  ) then
    return null;
  end if;
  return public.post_money_state(p_post_id);
end $$;

comment on function public.get_post_money(uuid) is
  'The owner''s money status for one of their listings (see post_money_state for the states). NULL for anyone else, a missing listing, or a listing with no captured payment. Authenticated only.';

revoke all on function public.get_post_money(uuid) from public, anon;
grant execute on function public.get_post_money(uuid) to authenticated;


-- =============================================================================
-- 3. list_my_posts — each listing gains a compact `money`.
--    Restated from 20260924130000; the only change is the `money` key.
-- =============================================================================
create or replace function public.list_my_posts()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_viewer uuid := auth.uid();
  v_result jsonb;
begin
  -- SAFETY: no caller identity -> nothing. Never fall through to "all rows".
  if v_viewer is null then
    return '[]'::jsonb;
  end if;

  select coalesce(jsonb_agg(t.item order by t.created_at desc), '[]'::jsonb)
    into v_result
  from (
    select
      p.created_at,
      -- Shared PostSummary core (distance is meaningless for an owner's own
      -- list, so pass null), extended with the first-photo array, the
      -- owner's archive stamp, and the listing's money in brief.
      public.home_feed_post_json(p, null::numeric)
        || jsonb_build_object(
             'photos',
             case
               when ph.url is not null
                 then jsonb_build_array(jsonb_build_object('url', ph.url))
               else '[]'::jsonb
             end,
             'archived_at',
             p.archived_at,
             -- The card's money line: a state, one figure, and a date when
             -- the state has one. The full breakdown is get_post_money.
             'money',
             case when m.state is null then null else jsonb_build_object(
               'state',       m.state ->> 'state',
               'amountPence', (m.state ->> 'headlinePence')::integer,
               'until',       m.state -> 'refundHold' -> 'expiresAt'
             ) end
           ) as item
    from public.posts p
    -- First photo (lowest position) as the card thumbnail; null row when the
    -- post has no photos. Served by post_photos_post_id_position_idx.
    left join lateral (
      select pp.url
      from public.post_photos pp
      where pp.post_id = p.id
      order by pp.position
      limit 1
    ) ph on true
    left join lateral (
      select public.post_money_state(p.id) as state
    ) m on true
    where p.owner_id = v_viewer   -- SAFETY: caller's OWN posts ONLY. All statuses.
  ) t;

  return v_result;
end;
$$;

comment on function public.list_my_posts() is
  'Returns the caller''s own posts as a JSON array, newest first (created_at desc), across ALL lifecycle statuses. Each element is the home_feed_post_json PostSummary core plus a "photos" array carrying the first photo ([{url}] or []), "archived_at" (the owner''s archive stamp, set by set_post_archived) and "money" ({state, amountPence, until} from post_money_state, or null when nothing was captured — 20260925110000). SECURITY DEFINER (bypasses RLS): owner_id = auth.uid() is the only ownership gate. Anon -> [].';


-- =============================================================================
-- 4. credit_money_state — one credited sighting's reward, for its spotter.
--
--    States:
--      add_details    they have not finished payout setup
--      verifying      details are in; Stripe is still checking them
--      being_checked  the payout is held for review (pending OR rejected)
--      on_its_way     they are payable; the transfer is due or in flight
--      paid           the reward was sent (with when, and how much)
--    NULL: not a credited sighting, or credited on a £5 listing (no cash).
-- =============================================================================
create or replace function public.credit_money_state(p_sighting_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_s       record;
  v_pay     record;
  v_review  text;
  v_account record;
  v_state   text;
begin
  select id, post_id, spotter_id, status into v_s
    from public.sightings where id = p_sighting_id;
  if not found or v_s.status <> 'credited' then
    return null;
  end if;

  -- Rewards only. A credit on a £5 listing carries recognition, not money —
  -- My reports already says so, and a money line would invent one.
  select status, reward_pence, transfer_amount_pence, released_at into v_pay
    from public.payments
   where post_id = v_s.post_id
     and kind = 'bounty_escrow'
     and status in ('held', 'released')
   order by created_at desc
   limit 1;
  if not found then
    return null;
  end if;

  if v_pay.status = 'released' then
    v_state := 'paid';
  else
    select case when r.resolution is null then 'pending' else r.resolution end
      into v_review
      from public.payout_reviews r
     where r.post_id = v_s.post_id;
    select payouts_enabled, details_submitted_at into v_account
      from public.stripe_connected_accounts
     where profile_id = v_s.spotter_id;

    -- ⚠️ pending and rejected read the SAME, exactly as the owner's side: a
    -- spotter is told the payout is being checked, never why or how it ended.
    v_state := case
      when v_review in ('pending', 'rejected')        then 'being_checked'
      when coalesce(v_account.payouts_enabled, false) then 'on_its_way'
      when v_account.details_submitted_at is not null then 'verifying'
      else 'add_details'
    end;
  end if;

  return jsonb_build_object(
    'state',       v_state,
    'rewardPence', v_pay.reward_pence,
    'paidPence',   case when v_state = 'paid' then v_pay.transfer_amount_pence end,
    'paidAt',      case when v_state = 'paid' then v_pay.released_at end
  );
end $$;

comment on function public.credit_money_state(uuid) is
  'INTERNAL: one credited sighting''s reward as a spotter-facing state (add_details, verifying, being_checked, on_its_way, paid) with the reward and, once paid, the amount and date; NULL when not credited or credited on a £5 listing. A pending and a rejected payout review both read being_checked. No ownership check: callable only by the SECURITY DEFINER reads that make one.';

revoke all on function public.credit_money_state(uuid) from public, anon, authenticated;


-- =============================================================================
-- 5. my_earnings — every reward the caller has earned.
-- =============================================================================
create or replace function public.my_earnings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_items  jsonb;
begin
  if v_caller is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select coalesce(jsonb_agg(e.item order by e.sort_at desc), '[]'::jsonb)
    into v_items
  from (
    select
      coalesce((m.state ->> 'paidAt')::timestamptz, s.reviewed_at, s.created_at) as sort_at,
      jsonb_build_object(
        'sightingId', s.id,
        -- The car as the spotter knew it — nothing about the listing beyond
        -- what their own report already showed them. Bounded at the source:
        -- this hands owner-typed text to a different user.
        'car', jsonb_build_object(
          'make',   left(coalesce(nullif(btrim(p.make),   ''), ''), 32),
          'colour', left(coalesce(nullif(btrim(p.colour), ''), ''), 32)
        )
      ) || m.state as item
      from public.sightings s
      join public.posts p on p.id = s.post_id
      cross join lateral (select public.credit_money_state(s.id) as state) m
     where s.spotter_id = v_caller          -- SAFETY: the caller's own, only
       and s.status = 'credited'
       and m.state is not null
  ) e;

  return jsonb_build_object(
    'items', v_items,
    'totals', jsonb_build_object(
      'paidPence', coalesce((
        select sum((i ->> 'paidPence')::integer)
          from jsonb_array_elements(v_items) i
         where i ->> 'state' = 'paid'), 0),
      'pendingPence', coalesce((
        select sum((i ->> 'rewardPence')::integer)
          from jsonb_array_elements(v_items) i
         where i ->> 'state' <> 'paid'), 0)
    )
  );
end $$;

comment on function public.my_earnings() is
  'The caller''s rewards: every credited sighting on a reward listing, newest first, as {sightingId, car {make, colour}, state, rewardPence, paidPence, paidAt} (states from credit_money_state), plus totals {paidPence, pendingPence}. Caller-scoped on auth.uid(); no post id, owner, plate or location. £5-listing credits carry no money and are not here (My reports shows them). Authenticated only.';

revoke all on function public.my_earnings() from public, anon;
grant execute on function public.my_earnings() to authenticated;


-- =============================================================================
-- 6. my_sighting_record — own credited rows gain `money`; the door gains
--    `can_file` and closes after its window.
--    Restated from 20260903110000; the changes are the `money` key and the
--    `dispute` object's `available` / `can_file`.
-- =============================================================================
create or replace function public.my_sighting_record()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_caller uuid := auth.uid();
  v_rows   jsonb;
begin
  if v_caller is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select coalesce(jsonb_agg(r order by r.created_at desc), '[]'::jsonb)
    into v_rows
  from (
    select s.id,
           -- ⚠️ THE POST ID, AND ONLY WHILE THE POST IS ACTIVE (2026-09-03,
           -- review finding #16). The NULL branch is the privacy rule: a closed
           -- post is invisible to a spotter. An ACTIVE post is public and
           -- anon-readable, so emitting its id gives nothing away.
           case when p.status = 'active' then s.post_id end as post_id,
           s.created_at,
           s.status,
           s.reviewed_at,
           s.area_label,
           -- Bounded at the source. This RPC hands owner-supplied text to a
           -- DIFFERENT user (the spotter).
           jsonb_build_object(
             'make',   left(coalesce(nullif(btrim(p.make),   ''), ''), 32),
             'colour', left(coalesce(nullif(btrim(p.colour), ''), ''), 32)
           ) as car,
           -- Their OWN reward on a credited report (20260925110000): state and
           -- amount, from the same helper as my_earnings. NULL for every other
           -- report, and for a credit on a £5 listing (no cash). This is the
           -- spotter's own money — the credited push already told them the
           -- number — so it does not breach "no bounty" for listings they were
           -- merely shown.
           public.credit_money_state(s.id) as money,
           -- The door, under ONE rule shared with my_dispute_context:
           --   the hold names this sighting AND
           --     (they already filed — the outcome stays readable — OR
           --      it is still fileable: window open, payment held, not credited)
           -- `can_file` is the second half alone. Before 2026-09-25 the door
           -- opened on the first clause only, so after 72 hours the card still
           -- invited a dispute that open_dispute would refuse.
           jsonb_build_object(
             'available', h.post_id is not null
                          and (d.id is not null or (h.expires_at > now()
                                                    and pay.post_id is not null
                                                    and s.status <> 'credited')),
             'can_file',  h.post_id is not null
                          and d.id is null
                          and h.expires_at > now()
                          and pay.post_id is not null
                          and s.status <> 'credited',
             'status',          d.status,
             'window_ends_at',  h.expires_at
           ) as dispute
      from public.sightings s
      join public.posts p on p.id = s.post_id
      -- ⚠️ THE `s.id = any (h.sighting_ids)` PREDICATE IS LOAD-BEARING: a
      -- spotter whose sighting the hold does not name cannot dispute.
      left join public.refund_holds h
             on h.post_id = s.post_id
            and s.id = any (h.sighting_ids)
      -- Their OWN dispute. The spotter predicate is redundant today and kept
      -- so loosening either uniqueness rule cannot surface another user's row.
      left join public.refund_disputes d
             on d.sighting_id = s.id
            and d.spotter_id = v_caller
      -- The money a dispute would be about, still held. Same predicate as
      -- open_dispute's "payment still held" gate.
      left join lateral (
        select pm.post_id
          from public.payments pm
         where pm.post_id = s.post_id
           and pm.status = 'held'
           and pm.kind = 'bounty_escrow'
         limit 1
      ) pay on true
     where s.spotter_id = v_caller
  ) as r;

  return jsonb_build_object('sightings', v_rows);
end;
$$;

comment on function public.my_sighting_record() is
  'The spotter''s own sighting record, newest first. Car make/colour only — no owner, no location, no plate. Carries `post_id` ONLY while that post is still ACTIVE; a CLOSED post yields NULL. Each row carries `money` (their OWN reward on a credited report, from credit_money_state, else NULL) and its dispute standing {available, can_file, status, window_ends_at} under the rule shared with my_dispute_context: the hold names the sighting AND (a dispute is already filed OR it is still fileable — window open, payment held, sighting not credited). 20260925110000.';


-- =============================================================================
-- 7. my_dispute_context — the same door rule as my_sighting_record.
--    Restated from 20260925100000; the only change is the availability
--    predicate, so a filed dispute stays readable after the window and an
--    unfiled one closes with it.
-- =============================================================================
create or replace function public.my_dispute_context(p_sighting_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_row    record;
begin
  if v_caller is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select h.expires_at, po.make, po.colour, pay.reward_pence,
         s.status as sighting_status,
         d.id as dispute_id,
         d.status as dispute_status, d.created_at as dispute_created_at
    into v_row
    from public.sightings s
    join public.refund_holds h on h.post_id = s.post_id
    join public.posts po on po.id = s.post_id
    left join public.payments pay
      on pay.post_id = s.post_id
     and pay.status = 'held'
     and pay.kind = 'bounty_escrow'
    left join public.refund_disputes d on d.sighting_id = s.id
   where s.id = p_sighting_id
     and s.spotter_id = v_caller
     and s.id = any (h.sighting_ids);

  -- ONE RULE with my_sighting_record's `available`: filed (the outcome stays
  -- readable), or still fileable (window open, payment held, not credited).
  if not found
     or not (v_row.dispute_id is not null
             or (v_row.expires_at > now()
                 and v_row.reward_pence is not null
                 and v_row.sighting_status <> 'credited')) then
    raise exception 'DISPUTE_NOT_AVAILABLE';
  end if;

  return jsonb_build_object(
    'car', jsonb_build_object('make', v_row.make, 'colour', v_row.colour),
    'windowEndsAt', v_row.expires_at,
    -- The key keeps its name: renaming it is a client contract change for no
    -- behaviour. The VALUE is the stored reward.
    'bountySharePence', v_row.reward_pence,
    'dispute', case when v_row.dispute_status is null then null
      else jsonb_build_object('status', v_row.dispute_status, 'createdAt', v_row.dispute_created_at)
    end
  );
end $$;

comment on function public.my_dispute_context(uuid) is
  'The dispute screen''s read: own sighting named in a refund hold. Available under the rule shared with my_sighting_record — a dispute already filed (its outcome stays readable after the window), or still fileable (window open, payment held, sighting not credited); otherwise DISPUTE_NOT_AVAILABLE. Car make/colour, deadline, their dispute if any, and the payment''s stored reward_pence as bountySharePence (null once the money moved). No owner identity, no location, no plate. 20260925110000.';

commit;

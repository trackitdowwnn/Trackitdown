-- -----------------------------------------------------------------------------
-- WHAT:  `get_my_reward_timeline(p_post_id)` — an owner's view of where their
--        listing's reward money has been: each reward taken (amount, when,
--        its term), whether and when it was paid out or refunded (and the
--        refunded figure), any refund hold and its date, when a sighting was
--        credited, and whether a dispute is open.
-- WHY:   PR4 of the payments UX plan (2026-10-13). An owner could only ever
--        see a reward while it was HELD (get_my_reward_status). Once money
--        moved — to a spotter, back to their card, onto a 72-hour hold — they
--        got a toast, once, and then a closed listing still showing the old £
--        figure. "Your refund is sent after 16 October" lived in a toast and
--        nowhere else. This is the read behind the listing's "Your reward"
--        timeline, which stays on closed listings too.
--
-- SHAPE: { postStatus, rewards: [...], creditedAt, disputeOpen }.
--        rewards are this post's ESCROW payments that were actually taken
--        (held, released, refunded, superseded — never requires_payment or
--        failed), oldest first; a renewal shows as the old one superseded.
--        Listing fees are not rewards and are left out.
--        Times: captured_at, term_ends_at, and the new released_at /
--        refunded_at (20261013110000 — estimates on rows from before it, as
--        that migration says). holdUntil / holdReason: the refund hold on that
--        payment, if one was raised (one per payment, 20261006130000).
--
-- SAFETY: the ledger and refund_holds stay unreadable to clients; this is a
--        narrow security-definer read for the OWNER of the post only —
--        auth.uid() must own it, and missing and not-owned raise the same
--        POST_NOT_FOUND (get_my_reward_status's rule, so neither is an oracle
--        for the other). Nothing about any spotter: no sighting ids, no
--        dispute details or statements, no payee, no transfer split — just
--        when a sighting was credited and whether a dispute is open, which the
--        owner's own actions and get_my_reward_status already reveal.
-- LINKS: supabase/migrations/20261006110000_a_fee_is_a_fact.sql
--          (get_my_reward_status, the live-reward read this complements);
--        supabase/migrations/20261013110000_money_moves_have_a_time.sql;
--        src/features/payments/api/rewardChangeApi.ts (the client);
--        supabase/tests/money_moves_have_a_time_verification.sql.
-- -----------------------------------------------------------------------------

create or replace function public.get_my_reward_timeline(p_post_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_post   record;
begin
  if v_caller is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;
  select owner_id, status into v_post
    from public.posts where id = p_post_id;
  if v_post.owner_id is null or v_post.owner_id <> v_caller then
    raise exception 'POST_NOT_FOUND';
  end if;

  return jsonb_build_object(
    'postStatus', v_post.status,
    'rewards', coalesce((
      select jsonb_agg(jsonb_build_object(
               'status',        p.status,
               'amountPence',   p.amount_pence,
               'capturedAt',    p.captured_at,
               'termEndsAt',    p.term_ends_at,
               'releasedAt',    p.released_at,
               'refundedAt',    p.refunded_at,
               'refundedPence', p.refunded_amount_pence,
               'supersededAt',  p.superseded_at,
               'holdUntil',     h.expires_at,
               'holdReason',    h.exit_path
             ) order by p.captured_at)
        from public.payments p
        left join public.refund_holds h on h.payment_id = p.id
       where p.post_id = p_post_id
         and p.kind = 'bounty_escrow'
         and p.status in ('held', 'released', 'refunded', 'superseded')
         and p.captured_at is not null
    ), '[]'::jsonb),
    'creditedAt', (
      select max(s.credited_at)
        from public.sightings s
       where s.post_id = p_post_id
         and s.status = 'credited'
    ),
    'disputeOpen', exists (
      select 1 from public.refund_disputes d
       where d.post_id = p_post_id
         and d.status = 'open'
    )
  );
end $$;

comment on function public.get_my_reward_timeline(uuid) is
  'The owner''s history of their listing''s reward money: each escrow payment taken (status, amount, capturedAt, termEndsAt, releasedAt, refundedAt, refundedPence, supersededAt, and holdUntil/holdReason from its refund hold), the latest creditedAt, and whether a dispute is open. Owner from auth.uid(); POST_NOT_FOUND for missing and not-owned alike. Nothing that identifies a spotter.';

revoke all on function public.get_my_reward_timeline(uuid) from public, anon;
grant execute on function public.get_my_reward_timeline(uuid) to authenticated;

-- =============================================================================
-- END OF MIGRATION
-- =============================================================================

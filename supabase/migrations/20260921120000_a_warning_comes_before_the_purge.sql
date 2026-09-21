-- =============================================================================
-- WHAT: No cancelled post is auto-deleted unwarned. Three pieces:
--
--         posts.deletion_warned_at — when the owner was told their cancelled
--           post is about to be cleared. NULL = not warned yet.
--
--         claim_cancelled_deletion_warnings(p_limit) — claims every cancelled
--           post 27+ days past closing that has not been warned, stamps it,
--           and returns the push copy. The sweep sends kind `deletion_soon`.
--
--         purge_cancelled_posts (restated) — now also requires
--           deletion_warned_at at least 72 HOURS old, so the automatic purge
--           can never delete a post whose owner was not told first — including
--           the rollout backlog of posts already 30+ days closed, which get
--           warned on the first sweep and deleted three days later, exactly
--           as the push copy says.
--
--       Plus the kind vocabulary widening (`deletion_soon` in both CHECKs).
--
-- WHY:  20260921100000 made retention real: a cancelled post the owner leaves
--       is deleted 30 days after closing. The delete confirm discloses that,
--       but a sentence read once, a month earlier, is not notice — and the
--       posts most likely to still be sitting there belong to exactly the
--       owners who have stopped opening the app. So the system tells them,
--       once, three days ahead: enough time to delete it themselves, screen-
--       shot it, or simply know. It asks nothing — there is no way to keep a
--       cancelled post past 30 days, and copy implying otherwise would be a
--       lever that does not exist.
--
-- ⚠️ THE 72-HOUR WAIT BINDS ONLY THE AUTOMATIC PURGE. The owner's own delete
--       (delete-post) neither needs nor checks a warning — it is the owner
--       acting, not the system. The wait lives in purge_cancelled_posts'
--       SELECT, not in delete_cancelled_post.
--
-- ⚠️ `deletion_soon` IS UNMUTABLE (notification_category returns NULL for it —
--       no CASE change needed; unknown kinds already fall to `else null` =
--       "always deliver"). The company it keeps is still_missing and
--       closed_uncredited: kinds with a consequence attached. This one is a
--       data-retention notice about the owner's OWN content being erased; a
--       toggle that silences it would turn the warning this migration exists
--       to guarantee back into silence. Its protection is the cap built into
--       its shape: exactly ONE send per post, ever (the stamp never clears —
--       the post is deleted days later).
--
-- SAFETY NOTE ON DESTRUCTIVE STATEMENTS: the two constraint DROPs are each
--       immediately re-added one kind wider (the 20260902140000 pattern), and
--       purge_cancelled_posts is create-or-replace'd strictly NARROWER — it
--       deletes a subset of what it deleted before. No table, row, or object
--       is dropped.
--
-- LINKS: supabase/migrations/20260921100000_a_cancelled_post_can_be_deleted.sql
--          (the purge this warns ahead of);
--        supabase/migrations/20260902140000_still_missing_check.sql (the claim
--          idiom and kind-widening pattern, copied here);
--        supabase/functions/release-held-refunds/index.ts (the sender phase);
--        supabase/migrations/20260824170000_notification_preferences.sql
--          (notification_category / push_recipients — NULL category = always);
--        src/features/notifications/lib/* (the client half of the kind);
--        supabase/tests/deletion_warning_verification.sql.
-- =============================================================================


-- =============================================================================
-- 1. The stamp
-- =============================================================================
-- Excluded from client grants automatically: the posts SELECT grant is a
-- column-enumerated list (20260810180000), so a new column is invisible to
-- clients until deliberately added. The sweep reads it via service_role.
alter table public.posts
  add column deletion_warned_at timestamptz;

comment on column public.posts.deletion_warned_at is
  'When the owner was warned their CANCELLED post is about to be auto-deleted (kind deletion_soon, sent by the sweep via claim_cancelled_deletion_warnings at 27 days past closed_at). NULL = not warned. purge_cancelled_posts refuses to delete until this is 72+ hours old, so no post is ever purged unwarned. Never cleared — the post is deleted days after it is set. Server-only: not in the client column grant.';

-- The claim's scan: cancelled, unwarned, oldest first.
create index posts_deletion_warning_due_idx
  on public.posts (closed_at)
  where status = 'cancelled' and deletion_warned_at is null;


-- =============================================================================
-- 2. The kind vocabulary widens
-- =============================================================================
-- Both constraints together: push_sends carries the same kind and a row is
-- written there before the send, so a kind valid in one and not the other
-- fails at delivery rather than at write.
alter table public.notifications drop constraint notifications_kind_chk;
alter table public.notifications add constraint notifications_kind_chk
  check (kind in ('alert','sighting','message','recovery','credited',
                  'credited_no_reward','closed_uncredited','dispute_upheld',
                  'dispute_rejected','payout_sent','not_credited',
                  'sighting_confirmed','still_missing','deletion_soon'));

alter table public.push_sends drop constraint push_sends_kind_chk;
alter table public.push_sends add constraint push_sends_kind_chk
  check (kind in ('alert','sighting','message','recovery','credited',
                  'credited_no_reward','closed_uncredited','dispute_upheld',
                  'dispute_rejected','payout_sent','not_credited',
                  'sighting_confirmed','still_missing','deletion_soon'));

-- notification_category needs no CASE change — an unlisted kind falls to
-- `else null`, which push_recipients reads as "always deliver". Only the
-- function's own documentation moves, so the next reader is not left to infer
-- whether the omission was a decision.
comment on function public.notification_category(text) is
  'Maps a notification kind to its mutable preference category, or NULL when the kind may not be muted (sighting, closed_uncredited, still_missing, deletion_soon) or is not yet classified. NULL always means "deliver". still_missing is capped at three sends per case; deletion_soon at one per post, ever — the stamp never clears and the post is gone days later. The caps are the protection instead of a toggle.';


-- =============================================================================
-- 3. claim_cancelled_deletion_warnings — the sweep's one call
-- =============================================================================
-- SERVICE ROLE ONLY. Selects the due posts, claims them all in ONE conditional
-- update, and returns the copy. Two concurrent sweeps cannot both claim the
-- same post: the update's own WHERE re-checks the due predicate, so the loser
-- returns zero rows for it.
--
-- Copy is built HERE so its privacy is DB-testable. It carries the CAR — the
-- push goes to the owner about their own listing, and an owner with two
-- cancelled posts needs to know which one. It carries no plate, no location,
-- no amount, and no lever: there is nothing to do, and the body says so.
create or replace function public.claim_cancelled_deletion_warnings(p_limit integer default 200)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- ⚠️ THE ONE CONSTANTS BLOCK. 27 days = the purge's 30 minus 3 days of
  -- notice; the "about 3 days" in the body below is this same arithmetic in
  -- words — move one, move both. purge_cancelled_posts' own 72-hour wait (its
  -- guarantee that the notice was ever sent) lives THERE, not here.
  c_warn_after constant interval := interval '27 days';
  v_rows jsonb;
begin
  with due as (
    select p.id
      from public.posts p
     where p.status = 'cancelled'
       and p.deletion_warned_at is null
       and p.closed_at is not null
       and p.closed_at < now() - c_warn_after
     order by p.closed_at
     limit greatest(p_limit, 0)
  ),
  claimed as (
    update public.posts p
       set deletion_warned_at = now()
      from due
     where p.id = due.id
       -- Re-checked inside the update: this is what makes two concurrent
       -- sweeps safe, not the select above.
       and p.status = 'cancelled'
       and p.deletion_warned_at is null
    returning p.id, p.owner_id, p.make, p.model, p.colour
  )
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'post_id', c.id,
               'user_id', c.owner_id,
               -- A cancelled post can be sparse (unlike still_missing's
               -- active ones), so an all-NULL car falls back to 'vehicle'
               -- rather than rendering 'Your cancelled  listing…'.
               'title',   'Your cancelled ' || coalesce(
                            nullif(
                              left(
                                trim(coalesce(c.colour, '') || ' ' ||
                                     coalesce(c.make, '')   || ' ' ||
                                     coalesce(c.model, '')),
                                48
                              ),
                              ''
                            ),
                            'vehicle'
                          ) || ' listing is deleted soon',
               'body',    'Cancelled listings are cleared after 30 days. This one goes for good in about 3 days — nothing you need to do.'
             )
           ),
           '[]'::jsonb
         )
    into v_rows
    from claimed c;

  return v_rows;
end $$;

comment on function public.claim_cancelled_deletion_warnings(integer) is
  'Claims every CANCELLED post 27+ days past closed_at that has not been warned, stamps deletion_warned_at, and returns [{post_id, user_id, title, body}] for the sweep to send as kind deletion_soon. One send per post, ever — the stamp never clears. Concurrent-safe (the claim predicate is re-checked inside the UPDATE). Returns [] when nothing is due. SERVICE ROLE ONLY.';

revoke execute on function public.claim_cancelled_deletion_warnings(integer) from public, anon, authenticated;
grant execute on function public.claim_cancelled_deletion_warnings(integer) to service_role;


-- =============================================================================
-- 4. purge_cancelled_posts — narrower: warned, and warned a while ago
-- =============================================================================
-- Restated in full from 20260921100000; the only change is the
-- deletion_warned_at predicate pair, and the comment sentences about it.
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
  -- "30 days since the owner took it down", not since creation.
  --
  -- ⚠️ AND WARNED, AT LEAST 72 HOURS AGO — the "about 3 days" the push body
  -- promises, made exactly true even for a late-warned post. The warning
  -- (deletion_soon, sent by the sweep at 27 days) is the owner's notice;
  -- requiring it here — rather than trusting the schedules to line up — means
  -- the purge structurally CANNOT delete an unwarned post, whatever the
  -- backlog: a post already 30+ days closed at rollout is warned on the first
  -- sweep and deleted three days later, not in the same run. On-time posts
  -- are unaffected (27d + 72h = the 30-day floor). Posts merely waiting out
  -- those 72 hours are not selected at all, so `skipped` stays a true alarm
  -- (guards refusing), never a countdown.
  --
  -- LIMIT bounds one run's work; the sweep is hourly, so a backlog drains
  -- within a day.
  for r in
    select id, owner_id
    from public.posts
    where status = 'cancelled'
      and closed_at is not null
      and closed_at < now() - interval '30 days'
      and deletion_warned_at is not null
      and deletion_warned_at < now() - interval '72 hours'
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
  'Retention for cancelled posts: deletes (via delete_cancelled_post, so every money guard applies) each one whose closed_at is 30+ days past AND whose deletion_soon warning (deletion_warned_at) is 72+ hours old — the purge structurally cannot delete an unwarned post. Per-item failures are skipped and retried next run; 200 per call. SERVICE ROLE ONLY; called hourly by release-held-refunds Phase 0d. Returns { purged, skipped } — a persistently non-zero skipped means posts the guards keep refusing.';

revoke all on function public.purge_cancelled_posts() from public;
revoke all on function public.purge_cancelled_posts() from anon, authenticated;
grant execute on function public.purge_cancelled_posts() to service_role;


-- --- Assert the grants and the widened vocabulary -----------------------------
do $$
begin
  if has_function_privilege('authenticated', 'public.claim_cancelled_deletion_warnings(integer)', 'execute')
     or has_function_privilege('anon', 'public.claim_cancelled_deletion_warnings(integer)', 'execute') then
    raise exception 'claim_cancelled_deletion_warnings is client-executable — anyone could stamp warnings and start the 72-hour purge clock';
  end if;
  if not has_function_privilege('service_role', 'public.claim_cancelled_deletion_warnings(integer)', 'execute')
     or not has_function_privilege('service_role', 'public.purge_cancelled_posts()', 'execute') then
    raise exception 'service_role cannot run the warning/purge pair — the sweep is broken';
  end if;
  if has_function_privilege('authenticated', 'public.purge_cancelled_posts()', 'execute')
     or has_function_privilege('anon', 'public.purge_cancelled_posts()', 'execute') then
    raise exception 'purge_cancelled_posts is client-executable — any signed-in user could mass-delete cancelled posts';
  end if;
  -- Qualified by table AND schema: a like-named constraint anywhere else
  -- (a partition, an extension schema) would make a bare conname lookup
  -- multi-row and fail this deploy for the wrong reason.
  if position('deletion_soon' in pg_get_constraintdef(
       (select oid from pg_constraint
         where conname = 'notifications_kind_chk'
           and connamespace = 'public'::regnamespace
           and conrelid = 'public.notifications'::regclass))) = 0
     or position('deletion_soon' in pg_get_constraintdef(
       (select oid from pg_constraint
         where conname = 'push_sends_kind_chk'
           and connamespace = 'public'::regnamespace
           and conrelid = 'public.push_sends'::regclass))) = 0 then
    raise exception 'deletion_soon is missing from a kind constraint — the warning would fail at write or at delivery';
  end if;
  raise notice 'deletion warnings: claim is service_role only; purge now requires a 72h-old warning.';
end;
$$;

-- =============================================================================
-- END OF MIGRATION
-- =============================================================================

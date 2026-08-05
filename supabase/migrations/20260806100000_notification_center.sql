-- =============================================================================
-- ⚠️ DESTRUCTIVE STATEMENTS: section 2 DROPs constraint push_sends_kind_chk and
--    immediately re-ADDs it one value wider ('payout_sent') — the established
--    widening idiom (20260804100000, 20260805110000 did exactly this). No table,
--    column, row or function is dropped. Everything else is additive.
--
-- WHAT:  The notification CENTER — a persistent in-app feed (`notifications`),
--        read-marking RPCs, the `payout_sent` push kind, and the two claim
--        functions that were still missing senders: `recovery` (watchers of a
--        recovered post) and `payout_sent` (the credited spotter whose transfer
--        went out).
--
--        THE RULE (going into DOMAIN.md with this feature): every
--        notification-worthy event persists a `notifications` row FIRST, then
--        maybe pushes. The center and the pushes can never disagree — a push a
--        user swiped away is still in the center, and a capped/dropped push
--        still left its row. Chat is the one deliberate exception: `message`
--        stays in the kind whitelist for symmetry with push_sends, but no
--        sender ever writes a `message` feed row — the chat screen IS that
--        history, and duplicating it here would be a second retention surface
--        for content SECURITY_AND_TRUST §3 keeps out of third-party hands.
--
-- WHY:   Until now a notification existed only for the instant it sat on a lock
--        screen. A spotter who swiped away "You've earned £190" had no way to
--        ever see it again; a watcher was never told at all that the car they
--        watched went home. The center is the durable half, and the two new
--        claims close the last silent moments in the lifecycle.
--
-- MONEY: the `payout_sent` title carries the RECORDED payments.transfer_amount_pence
--        — the number mark_recovery_paid wrote when the Stripe transfer was
--        created — NEVER a payout_split recomputation. Recomputing here could
--        drift from what actually moved; the recorded value cannot.
--
-- SAFETY: notifications rows are readable by their owner ONLY (RLS, no other
--        policy); every write path is service-role (the notify utility) or the
--        read-marking RPCs, which scope to the caller. The recovery copy is
--        built IN SQL so its privacy is DB-testable: make/colour only (the same
--        line alert copy draws — DOMAIN.md Notifications payload rules), never
--        the plate, never a location. Both claim functions are the house
--        conditional-update idempotency claim with the identical {claimed:false}
--        on every refusal — no oracle.
--
-- LINKS: docs/DOMAIN.md (Notifications; Disputes; lifecycle 5/6);
--        docs/SECURITY_AND_TRUST.md §1 §3 §6;
--        supabase/migrations/20260804100000_credited_notification.sql (the
--          claim idiom copied here: conditional-update idempotency, copy built
--          in SQL, identical refusals, one-greppable-line kind constraint);
--        supabase/migrations/20260802100000_push_infrastructure.sql (push_sends
--          + the original kind constraint; the grant posture);
--        supabase/migrations/20260802220000_release_payout.sql
--          (mark_recovery_paid — the writer of transfer_amount_pence);
--        supabase/migrations/20260722100000_watchlist.sql (watchlist_items —
--          the recovery claim's audience);
--        src/features/notifications/lib/notificationKinds.ts (mirrors the
--          widened whitelist — notificationKinds.test.ts asserts it; updated to
--          include 'payout_sent' in this same commit);
--        src/features/notifications/lib/pushPayload.ts (parsePushPayload — the
--          payload column stores exactly what it parses);
--        supabase/tests/notification_center_verification.sql (the Tier 1 gate).
-- =============================================================================


-- =============================================================================
-- 1. TABLE: notifications — the persistent in-app feed
-- =============================================================================
create table public.notifications (
  id         uuid primary key default gen_random_uuid(),

  -- Whose feed the row sits in. FK to profiles (house convention for
  -- user-owned rows). ON DELETE CASCADE: feed rows are the USER's, not money
  -- state — GDPR erasure of the account takes their feed with it. (Contrast
  -- payments' ON DELETE RESTRICT: nothing here records where money went; the
  -- payments ledger does.)
  user_id    uuid not null references public.profiles (id) on delete cascade,

  -- Which kind of notification. Same whitelist as push_sends_kind_chk below,
  -- and mirrored by NOTIFICATION_KINDS in notificationKinds.ts. NOTE:
  -- 'message' is allowed for SYMMETRY with push_sends but is NEVER written —
  -- chat is excluded from the center (the thread is its own history; see the
  -- header). No code path writes it, and no client write grant exists at all.
  kind       text not null constraint notifications_kind_chk check (kind in ('alert','sighting','message','recovery','credited','closed_uncredited','dispute_upheld','dispute_rejected','payout_sent')),

  -- Denormalised AT WRITE TIME: what was true THEN. The post may since have
  -- closed, the amount may since have moved — the feed shows what the user was
  -- told, not a live view. Same privacy rules as push copy: no plate, no
  -- location, no message content, no counterpart identity beyond first name.
  title      text not null,
  body       text not null,

  -- The EXACT typed push data blob ({type, postId|threadId|sightingId}) — ids
  -- only, nothing sensitive (pushPayload.ts .strict() is the fence). The
  -- client re-parses with parsePushPayload and routes with pushRouteFor, so a
  -- center tap and a push tap land on the same screen by construction.
  payload    jsonb not null,

  -- NULL = unread. Set only by the read-marking RPCs below (caller-scoped).
  read_at    timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.notifications is
  'The persistent in-app notification feed. THE RULE: every notification-worthy event persists a row here FIRST, then maybe pushes — the center and pushes can never disagree. Written ONLY by the service role (the notify utility); read_at flips only via the mark_* RPCs. A user reads their own rows and nothing else. kind=''message'' is whitelisted for symmetry with push_sends but never written: chat is its own history.';
comment on column public.notifications.payload is
  'The exact typed push data blob ({type, postId|threadId|sightingId}). Ids only — parsed by parsePushPayload, routed by pushRouteFor, so center taps and push taps are the same code path. Never carries a plate, a coordinate, or message content.';
comment on column public.notifications.read_at is
  'NULL = unread. Set only by mark_notification_read / mark_notifications_read_by_payload / mark_all_notifications_read, all scoped to the caller''s own rows.';

-- The feed read: newest first for one user. created_at desc matches the
-- ORDER BY so the feed page is an index range scan.
create index notifications_user_created_idx
  on public.notifications (user_id, created_at desc);

-- The unread badge + the mark-unread scans. Partial: a row leaves the index
-- the moment it is read, so it holds only what the badge counts.
create index notifications_user_unread_idx
  on public.notifications (user_id)
  where read_at is null;

alter table public.notifications enable row level security;

-- SAFETY: this project's ALTER DEFAULT PRIVILEGES hands anon+authenticated
-- GRANT ALL (incl. TRUNCATE, which bypasses RLS — see 20260802170000) at
-- CREATE time. Reset to nothing, then re-grant deliberately: authenticated
-- gets SELECT ONLY (the feed read, RLS-scoped below); all writes are the
-- service role (the notify utility) or the SECURITY DEFINER RPCs. anon gets
-- NOTHING: a feed needs an owner. service_role bypasses RLS but is not
-- auto-granted, so it gets full DML.
revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;
grant select, insert, update, delete on public.notifications to service_role;

-- A user may read ONLY their own feed rows ((select auth.uid()) initplan idiom).
create policy notifications_select_own
  on public.notifications
  for select
  to authenticated
  using (user_id = (select auth.uid()));

-- No insert/update/delete policies (and no such client grant above): writes
-- are service-role, read-marking goes through the RPCs below.


-- =============================================================================
-- 2. The kind whitelist learns 'payout_sent'.  ⚠️ DROP + re-ADD (the widening
--    idiom). Same one-greppable-line format — notificationKinds.test.ts scans
--    migrations for the LATEST definition of this constraint and compares it
--    against the client list, which gains 'payout_sent' in this same commit.
-- =============================================================================
alter table public.push_sends drop constraint push_sends_kind_chk;
alter table public.push_sends
  add constraint push_sends_kind_chk check (kind in ('alert','sighting','message','recovery','credited','closed_uncredited','dispute_upheld','dispute_rejected','payout_sent'));


-- =============================================================================
-- 3. Read-marking RPCs (authenticated). All SECURITY DEFINER with empty
--    search_path; all scope every row they touch to auth.uid(), so "someone
--    else's id" and "no such id" are indistinguishable no-ops — own-row
--    scoping IS the oracle-proofing, no shared refusal token needed.
--    A missing session returns the zero result rather than raising: anon holds
--    no EXECUTE anyway, and a torn-down session mid-tap should not error a
--    read-marking gesture (the unregister_push_token posture).
-- =============================================================================

-- 3a. Mark ONE row read (the feed-row tap).
create or replace function public.mark_notification_read(p_notification_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_id     uuid;
begin
  if v_caller is null or p_notification_id is null then
    return jsonb_build_object('marked', false);
  end if;

  -- Conditional update, own row only: updating someone else's id (or a
  -- read/missing one) simply marks nothing.
  update public.notifications
     set read_at = now()
   where id = p_notification_id
     and user_id = v_caller
     and read_at is null
  returning id into v_id;

  return jsonb_build_object('marked', v_id is not null);
end $$;

comment on function public.mark_notification_read(uuid) is
  'Marks ONE of the caller''s unread notifications read. Conditional update scoped to user_id = auth.uid(): another user''s id, an already-read row and a missing id all return the identical {marked:false} — own-row scoping is the whole oracle-proofing. Returns {marked:true} exactly once per row.';

revoke execute on function public.mark_notification_read(uuid) from public, anon;
grant  execute on function public.mark_notification_read(uuid) to authenticated, service_role;


-- 3b. Mark by kind + payload (the push-tap path). Push data is SHARED across
--     recipients ({type, postId} is the same blob for every watcher), so no
--     row id rides the push — the tap marks whatever the caller's feed holds
--     for that exact kind + payload. jsonb equality, so key order never matters.
create or replace function public.mark_notifications_read_by_payload(
  p_kind    text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_count  integer;
begin
  if v_caller is null or p_kind is null or p_payload is null then
    return jsonb_build_object('marked', 0);
  end if;

  update public.notifications
     set read_at = now()
   where user_id = v_caller
     and read_at is null
     and kind = p_kind
     and payload = p_payload;

  get diagnostics v_count = row_count;
  return jsonb_build_object('marked', v_count);
end $$;

comment on function public.mark_notifications_read_by_payload(text, jsonb) is
  'Marks the CALLER''s unread rows matching kind AND payload (jsonb equality) read — the push-tap path: push data is shared across recipients, so no notification id rides the push. Caller-scoped only; an unknown kind or payload marks 0. Returns {marked: count}.';

revoke execute on function public.mark_notifications_read_by_payload(text, jsonb) from public, anon;
grant  execute on function public.mark_notifications_read_by_payload(text, jsonb) to authenticated, service_role;


-- 3c. Mark everything read (the "mark all read" button).
create or replace function public.mark_all_notifications_read()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_count  integer;
begin
  if v_caller is null then
    return jsonb_build_object('marked', 0);
  end if;

  update public.notifications
     set read_at = now()
   where user_id = v_caller
     and read_at is null;

  get diagnostics v_count = row_count;
  return jsonb_build_object('marked', v_count);
end $$;

comment on function public.mark_all_notifications_read() is
  'Marks ALL of the caller''s unread notifications read. Returns {marked: count}.';

revoke execute on function public.mark_all_notifications_read() from public, anon;
grant  execute on function public.mark_all_notifications_read() to authenticated, service_role;


-- 3d. The unread badge count. Cheap by construction: the partial index
--     notifications_user_unread_idx holds exactly the rows this counts.
create or replace function public.unread_notifications_count()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
    from public.notifications
   where user_id = auth.uid()
     and read_at is null;
$$;

comment on function public.unread_notifications_count() is
  'The caller''s unread-notification count (the badge). Uses the partial unread index; a missing session counts 0.';

revoke execute on function public.unread_notifications_count() from public, anon;
grant  execute on function public.unread_notifications_count() to authenticated, service_role;


-- =============================================================================
-- 4. The `recovery` sender's claim — watchers finally get told.
-- =============================================================================

alter table public.posts
  -- SERVER-ONLY claim marker, same posture as posts.alerts_sent_at /
  -- sightings.credited_notified_at: posts' client grants are explicit column
  -- lists, so this column is excluded by construction. A client-writable value
  -- would let an owner suppress (or re-fire) the watcher announcement.
  add column recovery_notified_at timestamptz;

comment on column public.posts.recovery_notified_at is
  'Watcher recovery-push idempotency CLAIM. NULL = the post''s watchers have never been told it was recovered. Set exactly once by claim_recovery_notifications (SECURITY DEFINER, SERVICE ROLE ONLY) via a conditional update, so replays and concurrent calls send nothing. Server-only: excluded from every client column grant.';

-- The pending scan (which recovered posts still owe their watchers the news).
create index posts_recovery_notify_pending_idx
  on public.posts (id)
  where status in ('recovered', 'recovered_no_spotter') and recovery_notified_at is null;

-- The claim. Recovered states only (both of them: watchers care that the car
-- went home, not whether a spotter was paid). Every refusal — no such post,
-- not recovered, already claimed — returns the IDENTICAL {claimed:false}.
-- An empty audience still returns claimed:true with user_ids [] — the claim is
-- consumed ("we tried"), there is simply nothing to send; a retry must not
-- re-announce later to watchers who since arrived (the claim_post_alerts rule).
create or replace function public.claim_recovery_notifications(p_post_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner  uuid;
  v_colour text;
  v_make   text;
  v_desc   text;
  v_users  jsonb;
begin
  if p_post_id is null then
    return jsonb_build_object('claimed', false);
  end if;

  -- The conditional update IS the idempotency: of two concurrent calls,
  -- exactly one row comes back. Copy inputs are normalised and BOUNDED here
  -- (make/colour are unbounded owner-authored text — the match_alert_zones
  -- rule: bound each field, never truncate the finished sentence).
  update public.posts
     set recovery_notified_at = now()
   where id = p_post_id
     and recovery_notified_at is null
     and status in ('recovered', 'recovered_no_spotter')
  returning owner_id,
            left(coalesce(nullif(btrim(colour), ''), ''), 32),
            left(coalesce(nullif(btrim(make),   ''), ''), 32)
       into v_owner, v_colour, v_make;

  if v_owner is null then
    return jsonb_build_object('claimed', false);
  end if;

  -- The AUDIENCE: everyone watching this post, EXCLUDING the owner (the
  -- watchlist insert policy lets an owner watch their own post, and they do
  -- not need to be told their own good news).
  select coalesce(jsonb_agg(w.user_id), '[]'::jsonb)
    into v_users
    from public.watchlist_items w
   where w.post_id = p_post_id
     and w.user_id <> v_owner;

  -- The COPY, built here so its privacy is DB-testable. Same line the alert
  -- copy draws (DOMAIN.md Notifications payload): make/colour ONLY — NO plate,
  -- NO location (not even district grain: a recovered car's whereabouts are
  -- nobody's business), no owner identity. Falls back to 'car' so it never
  -- reads "The  you were watching".
  v_desc := coalesce(nullif(btrim(concat_ws(' ', nullif(v_colour, ''), nullif(v_make, ''))), ''), 'car');

  return jsonb_build_object(
    'claimed',  true,
    'user_ids', v_users,
    'post_id',  p_post_id,
    'title',    'Good news — a car you were watching was recovered',
    'body',     'The ' || v_desc || ' you were watching is back with its owner. Thank you for keeping an eye out.'
  );
end $$;

comment on function public.claim_recovery_notifications(uuid) is
  'One-shot claim for the watcher recovery announcement. Conditional update on posts.recovery_notified_at (recovered/recovered_no_spotter only) is the idempotency; the audience is watchlist_items minus the post owner; the copy (make/colour only — no plate, no location, mirroring the alert-copy privacy line) is built in SQL. An empty audience still returns claimed:true with user_ids [] — the claim means "we tried", so a retry cannot re-announce later. Every refusal returns the identical {claimed:false}. SERVICE ROLE ONLY.';

revoke execute on function public.claim_recovery_notifications(uuid) from public, anon, authenticated;
grant  execute on function public.claim_recovery_notifications(uuid) to service_role;


-- =============================================================================
-- 5. The `payout_sent` claim — the transfer actually went out.
-- =============================================================================

alter table public.payments
  -- SERVER-ONLY claim marker: payments carries no client write grant at all,
  -- same posture as every notified_at column in this family.
  add column payout_notified_at timestamptz;

comment on column public.payments.payout_notified_at is
  'Payout-sent push idempotency CLAIM. NULL = the credited spotter has never been told their transfer went out. Set exactly once by claim_payout_sent_notification (SECURITY DEFINER, SERVICE ROLE ONLY) via a conditional update. Server-only: payments carries no client write grant.';

-- The pending scan (which released payments still owe the spotter the news).
create index payments_payout_notify_pending_idx
  on public.payments (id)
  where status = 'released' and payout_notified_at is null;

-- The claim. For the credited spotter of a post whose payment is 'released'
-- (mark_recovery_paid requires the credited sighting before releasing, so a
-- released payment always has a spotter to tell — the join re-verifies rather
-- than trusts that). Refusals all identical {claimed:false}.
create or replace function public.claim_payout_sent_notification(p_post_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment  uuid;
  v_transfer integer;
  v_sighting uuid;
  v_spotter  uuid;
begin
  if p_post_id is null then
    return jsonb_build_object('claimed', false);
  end if;

  -- Every gate in ONE predicate: a released payment on this post, its recorded
  -- transfer amount, and the credited sighting that names the recipient.
  select pay.id, pay.transfer_amount_pence, s.id, s.spotter_id
    into v_payment, v_transfer, v_sighting, v_spotter
    from public.payments pay
    join public.sightings s on s.post_id = pay.post_id and s.status = 'credited'
   where pay.post_id = p_post_id
     and pay.status = 'released'
     and pay.transfer_amount_pence is not null
     and pay.payout_notified_at is null
   limit 1;

  if v_payment is null then
    return jsonb_build_object('claimed', false);
  end if;

  -- The conditional update IS the idempotency.
  update public.payments
     set payout_notified_at = now()
   where id = v_payment
     and payout_notified_at is null
  returning id into v_payment;

  if v_payment is null then
    return jsonb_build_object('claimed', false);
  end if;

  -- MONEY: the amount is the RECORDED transfer_amount_pence — what
  -- mark_recovery_paid wrote when the Stripe transfer was created — NEVER a
  -- payout_split recomputation, which could drift from what actually moved.
  -- Formatted exactly as claim_credited_notification formats its amount.
  return jsonb_build_object(
    'claimed',     true,
    'user_id',     v_spotter,
    'sighting_id', v_sighting,
    'post_id',     p_post_id,
    'title',       'On its way — £' || to_char(v_transfer / 100.0, 'FM999990.00'),
    'body',        'Your bounty is heading to your bank account.'
  );
end $$;

comment on function public.claim_payout_sent_notification(uuid) is
  'One-shot claim for the payout-sent push to the credited spotter of a post whose payment is released. Conditional update on payments.payout_notified_at is the idempotency. MONEY: the title carries the RECORDED transfer_amount_pence (written by mark_recovery_paid), never a payout_split recomputation. Every refusal — no such post, payment not released, no recorded amount, no credited sighting, already claimed — returns the identical {claimed:false}. SERVICE ROLE ONLY.';

revoke execute on function public.claim_payout_sent_notification(uuid) from public, anon, authenticated;
grant  execute on function public.claim_payout_sent_notification(uuid) to service_role;


-- =============================================================================
-- END OF MIGRATION
-- =============================================================================

-- =============================================================================
-- WHAT:  Push notification INFRASTRUCTURE — the shared plumbing every push kind
--        rides on, with no feature logic of its own. Creates three tables:
--          * public.push_tokens   — one row per DEVICE (Expo push token), owned
--                                   by whoever is currently signed in on it,
--          * public.push_sends    — the send ledger backing the per-user rolling
--                                   24h cap AND the same-subject dedup,
--          * public.push_receipts — parked Expo ticket ids awaiting the receipt
--                                   drain (Expo's send API is two-phase),
--        plus three SECURITY DEFINER RPCs: register_push_token,
--        unregister_push_token (both client-callable, caller-pinned) and
--        prune_push_token (service-role only, the DeviceNotRegistered cleanup).
-- WHY:   DOMAIN.md "Notifications": when a post goes active, spotters whose
--        alert radius covers its last-seen point get a push. Nothing could send
--        one — there was nowhere to store a device token, no way to cap volume,
--        and no way to retire a dead token. This is that missing layer, shipped
--        as infrastructure so sighting/message/recovery pushes reuse it rather
--        than each growing their own token table. Volume control lives in the
--        DATABASE (push_sends), not in the Edge Function's memory, because the
--        cap is a per-user promise that must survive process restarts and
--        concurrent sends.
-- LINKS: docs/DOMAIN.md (Notifications; alert radius; safety line on every
--          alert), docs/SECURITY_AND_TRUST.md §1 (every alert carries the
--          don't-approach line), §3 (tokens are device identifiers — personal
--          data, cascade on erasure), §6 (RLS deny by default; SECURITY DEFINER
--          hardening; service-role keys only in Edge Function secrets),
--        supabase/migrations/20260730110000_post_flags.sql (the RLS-enabled,
--          no-client-policy moderation-table precedent reused for push_sends /
--          push_receipts, and the revoke-public+anon function grant posture),
--        supabase/migrations/20260722100000_watchlist.sql (user-owned-row
--          pattern: profiles FK, own-rows-only SELECT policy, explicit grants),
--        supabase/migrations/20260726100000_post_payment.sql (text + named
--          CHECK instead of a new enum; service-role-only RPC grants),
--        src/features/notifications/lib/notificationKinds.ts (NOTIFICATION_KINDS
--          — mirrored EXACTLY by push_sends_kind_chk below),
--        src/features/notifications/README.md (why the PK is on token alone).
--
-- SAFETY: push_sends is a RATE-LIMIT ledger. A user must not be able to read it
--        (it would tell them exactly how close they are to the cap) and must
--        never be able to write it (forging rows would either mute themselves
--        or, worse, let them clear their own counter). It therefore has RLS
--        enabled with NO client policies and NO client grants — service role
--        only, exactly like post_flags / stripe_webhook_events. Same for
--        push_receipts (Expo ticket ids are operational data).
--        push_tokens is readable by its owner ONLY (a user may list their own
--        devices) and is NEVER client-writable: registration goes through
--        register_push_token, which pins user_id to auth.uid(), so a caller can
--        never register a token on someone else's behalf (which would redirect
--        that person's pushes to the attacker's phone).
--
-- SAFETY NOTE ON DESTRUCTIVE STATEMENTS: NONE. Fully additive — three new
--        tables (+ indexes + RLS + grants), one new RLS policy and three new
--        functions (+ grants + comments). No drop / rename / truncate of any
--        existing object, and no existing function is replaced.
-- =============================================================================


-- =============================================================================
-- 1. TABLE: push_tokens  (one row per DEVICE, owned by its current user)
-- =============================================================================
create table public.push_tokens (
  -- The Expo push token. PRIMARY KEY ON token ALONE — deliberately NOT
  -- (user_id, token), and this is load-bearing:
  --
  --   An Expo push token identifies a DEVICE, not a session. It survives sign-
  --   out and is re-issued unchanged to whoever signs in next on that phone.
  --   With a composite (user_id, token) key, user A signing out and user B
  --   signing in on the same handset would leave A's row alive alongside B's
  --   new one — and every sighting / message / alert push for A would then be
  --   delivered into B's hands. That is a direct leak of A's post activity and
  --   chat existence to a stranger.
  --
  --   PK-on-token makes re-registration an `on conflict (token) do update set
  --   user_id = excluded.user_id` that MOVES the device to its current owner,
  --   so a token can only ever belong to one person at a time. The one-to-many
  --   direction that IS legitimate — one user holding several tokens (a phone
  --   and a tablet) — is unaffected: those are distinct tokens, hence distinct
  --   rows, and the audience lookup fans out over user_id.
  token      text primary key,

  -- The device's CURRENT owner. FK to profiles (house convention for user-owned
  -- rows; 1:1 with auth.users). ON DELETE CASCADE: UK GDPR erasure of the
  -- account takes their device registrations with it (SECURITY_AND_TRUST §3) —
  -- a token with no user is unaddressable anyway.
  user_id    uuid not null references public.profiles (id) on delete cascade,

  -- Which push service the token belongs to. text + named CHECK rather than a
  -- new Postgres enum (house style since the payments migration): a whitelist
  -- is trivially widened by a migration, an enum value is not removable.
  platform   text not null constraint push_tokens_platform_chk check (platform in ('ios','android')),

  -- Last (re-)registration. Bumped by every register_push_token upsert, so a
  -- future janitor can retire tokens no app has refreshed in N months.
  updated_at timestamptz not null default now()
);

comment on table public.push_tokens is
  'One row per Expo push token (i.e. per DEVICE), owned by whoever is currently signed in on it. PK is the token ALONE, never (user_id, token): a token survives sign-out, so a composite key would leave the previous user''s row alive and deliver their pushes to the phone''s new holder. Written ONLY by register_push_token / unregister_push_token / prune_push_token (SECURITY DEFINER) or the service role — clients hold no insert/update/delete grant. A user may SELECT their own rows (their device list) and nothing else.';
comment on column public.push_tokens.token is
  'Expo push token; PRIMARY KEY. Device-scoped and logout-surviving — re-registration MOVES it to the new owner (on conflict (token) do update set user_id). Never logged (src/features/notifications/README.md, Logging).';
comment on column public.push_tokens.user_id is
  'The device''s CURRENT owner. Re-pointed by register_push_token when a different user signs in on the same handset. ON DELETE CASCADE with the profile.';

-- The audience lookup ("every token for these user_ids") joins on user_id, and
-- it runs on every push fan-out — the hot path for this whole feature. Also
-- serves the FK's delete-cascade scan. The PK covers token lookups.
create index push_tokens_user_id_idx on public.push_tokens (user_id);

alter table public.push_tokens enable row level security;

-- SAFETY: under this project's config (auto_expose_new_tables unset) a new table
-- auto-grants NO data privileges, so the policy below would be dead code without
-- an explicit grant. authenticated gets SELECT ONLY — registration and removal
-- go through the RPCs so user_id is pinned server-side; a client INSERT/UPDATE
-- grant would let anyone register (or re-point) a token to another account and
-- hijack their notifications. anon gets NOTHING: a token needs an owner.
-- service_role bypasses RLS but is not auto-granted, so give it full DML (the
-- Edge Function send path prunes dead tokens through it).
grant select on public.push_tokens to authenticated;
grant select, insert, update, delete on public.push_tokens to service_role;

-- SAFETY: a user may read ONLY their own device registrations (e.g. "you have
-- 2 devices receiving alerts"). Nobody can enumerate another account's devices,
-- which would be a device-fingerprint / co-location oracle over other users.
create policy push_tokens_select_own
  on public.push_tokens
  for select
  to authenticated
  using (user_id = (select auth.uid()));

-- No insert/update/delete policy (and no such grant above): every write path is
-- an RPC below.


-- =============================================================================
-- 2. TABLE: push_sends  (the send ledger: rolling-24h cap + same-subject dedup)
-- =============================================================================
create table public.push_sends (
  id         uuid primary key default gen_random_uuid(),

  -- Who was pushed. ON DELETE CASCADE: the ledger is only meaningful relative to
  -- a live account, and GDPR erasure must not leave per-user send history behind.
  user_id    uuid not null references public.profiles (id) on delete cascade,

  -- Which kind of push. SAFETY / CONTRACT: this whitelist is mirrored EXACTLY —
  -- same four values, same order — by NOTIFICATION_KINDS in
  -- src/features/notifications/lib/notificationKinds.ts, and
  -- notificationKinds.test.ts reads THIS FILE and asserts they match. Keep it on
  -- one greppable line; adding a kind means editing both sides in the same PR.
  kind       text not null constraint push_sends_kind_chk check (kind in ('alert','sighting','message','recovery')),

  -- What the push was ABOUT: the post id for alert/sighting/recovery, the thread
  -- id for message. Deliberately a bare uuid with NO foreign key — the ledger is
  -- a rate-limit record, not a relationship: it must survive the post or thread
  -- being deleted (otherwise deleting a post would silently reset every
  -- recipient's cap) and must never block that delete.
  subject_id uuid not null,

  created_at timestamptz not null default now()
);

comment on table public.push_sends is
  'Append-only ledger of pushes actually sent: backs the per-user rolling-24h volume cap and the "already told this user about this subject" dedup. SAFETY: RLS enabled with NO client policies and NO client grants — a user must not read it (it discloses how close they are to the cap) and must never write it (forged rows would mute them or clear their own counter). Service role only. subject_id is FK-less on purpose so deleting a post cannot reset anyone''s cap.';
comment on column public.push_sends.kind is
  'One of alert|sighting|message|recovery. Mirrors NOTIFICATION_KINDS in src/features/notifications/lib/notificationKinds.ts exactly (asserted by notificationKinds.test.ts, which reads this migration).';
comment on column public.push_sends.subject_id is
  'The post id, or the thread id for kind=''message''. No FK by design (see the table comment).';

-- The rolling-24h cap: "how many pushes of this kind has this user had since
-- now() - interval '24 hours'". created_at trails the equality columns so the
-- window is an index range scan.
create index push_sends_user_kind_created_idx
  on public.push_sends (user_id, kind, created_at);

-- The dedup test: "have we already told this user about this post/thread?" —
-- an exact-match probe, so all three columns are equalities.
create index push_sends_user_kind_subject_idx
  on public.push_sends (user_id, kind, subject_id);

-- RETENTION (deferred): this grows one row per push sent. Only the last 24h
-- matters for the cap and the dedup window is the post's lifetime, so a periodic
-- purge keeps it bounded; add it with the ops/cron pass (there is no pg_cron
-- here yet — see the README's receipt-drain note). Operational only.

alter table public.push_sends enable row level security;

-- SAFETY: rate-limit ledger. RLS ENABLED with NO anon/authenticated policies, so
-- ALL client access is denied by default, and NO client grant exists either
-- (belt and braces — following the post_flags / stripe_webhook_events
-- precedent). Only the send Edge Function (service role) reads and writes it.
grant select, insert, update, delete on public.push_sends to service_role;


-- =============================================================================
-- 3. TABLE: push_receipts  (parked Expo ticket ids awaiting the receipt drain)
-- =============================================================================
-- Expo's send API is TWO-PHASE: POST /send returns a *ticket* per message
-- (accepted for delivery), and the real delivery errors — above all
-- DeviceNotRegistered, the signal to prune a token — only surface later from
-- GET /getReceipts. This table parks ticket ids between the two phases so a dead
-- token is retired on the next drain instead of never.
create table public.push_receipts (
  -- Expo's ticket id, as returned by /send. PRIMARY KEY: re-parking the same
  -- ticket is a conflict, so the drain can be retried without duplicating work.
  ticket_id  text primary key,

  -- The token this ticket was for, so a DeviceNotRegistered receipt can be
  -- traced back to the row to prune. Deliberately NO foreign key to push_tokens:
  -- a token may legitimately be pruned (or moved to another user, or cascaded
  -- away with a deleted account) BEFORE its receipt is read, and parking or
  -- draining a receipt must never error because of that. A dangling token here
  -- simply prunes nothing.
  token      text not null,

  created_at timestamptz not null default now()
);

comment on table public.push_receipts is
  'Expo push ticket ids parked between /send and /getReceipts (Expo''s two-phase API): the drain reads them oldest-first, applies delivery errors, and prunes DeviceNotRegistered tokens via prune_push_token. No FK on token by design — a token may be pruned before its receipt is read and that must not error. RLS enabled with NO client policies and service-role-only grants: operational data, never client-visible.';
comment on column public.push_receipts.token is
  'The push token the ticket was sent to. FK-less on purpose (see the table comment).';

-- The drain reads OLDEST-FIRST (Expo receipts expire, so the backlog is worked
-- in arrival order) and deletes what it has processed.
create index push_receipts_created_at_idx on public.push_receipts (created_at);

alter table public.push_receipts enable row level security;

-- SAFETY: operational infrastructure. RLS ENABLED with NO anon/authenticated
-- policies and NO client grant — ticket ids correlate a device token with a
-- delivery, which is nobody's business but the sender's. Service role only.
grant select, insert, update, delete on public.push_receipts to service_role;


-- =============================================================================
-- 4. FUNCTION: register_push_token(token, platform)
-- =============================================================================
-- The ONLY client write path into push_tokens. Records (or re-points) the
-- CALLER's device token.
--
-- DEVICE MIGRATION — the reason this is an upsert on the token and not an
-- insert: an Expo push token belongs to the handset and survives sign-out. When
-- user B signs in on a phone that user A previously used, the app re-registers
-- the SAME token and the ON CONFLICT branch MOVES the row's user_id from A to B.
-- A therefore stops receiving pushes on a phone they no longer hold, which is
-- the whole point: without this, A's sighting and message notifications would be
-- delivered into B's hands.
--
-- user_id is pinned to auth.uid() and is NOT a parameter — a caller can never
-- register a token on someone else's behalf (which would redirect that person's
-- notifications to the attacker's device).
--
-- Raises: NOT_AUTHENTICATED (guest), INVALID_INPUT (empty/oversized token or an
-- unknown platform).
create or replace function public.register_push_token(
  p_token    text,
  p_platform text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := auth.uid();
  -- Normalised once, then used everywhere: validating one value and storing
  -- another is how whitelists get bypassed.
  v_token    text := btrim(coalesce(p_token, ''));
  v_platform text := lower(btrim(coalesce(p_platform, '')));
begin
  -- A token must belong to an account: no owner, no audience row.
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  -- Bounds the token defensively (Expo tokens are ~40-50 chars; 255 is generous
  -- headroom) so a client cannot pad an unbounded blob into a PRIMARY KEY, and
  -- rejects any platform outside the CHECK whitelist with a stable token rather
  -- than a raw constraint-violation error.
  if v_token = ''
     or char_length(v_token) > 255
     or v_platform not in ('ios', 'android') then
    raise exception 'INVALID_INPUT';
  end if;

  -- Upsert keyed on the token (the device). ON CONFLICT re-points user_id to the
  -- caller — see DEVICE MIGRATION above — and refreshes the platform (a token
  -- cannot change OS, but a re-registration is the honest moment to re-assert
  -- it) and updated_at.
  insert into public.push_tokens (token, user_id, platform, updated_at)
  values (v_token, v_uid, v_platform, now())
  on conflict (token) do update
    set user_id    = excluded.user_id,
        platform   = excluded.platform,
        updated_at = now();
end;
$$;

comment on function public.register_push_token(text, text) is
  'Registers the CALLER''s Expo push token. SECURITY DEFINER; user_id is pinned to auth.uid() and is not a parameter, so a token can never be registered on another user''s behalf. Upserts on the TOKEN (the device): if the token already exists under a DIFFERENT user, the row MOVES to the caller — a device that changes hands stops delivering the previous user''s pushes to the new holder. Idempotent; refreshes platform + updated_at. Raises NOT_AUTHENTICATED (guest) and INVALID_INPUT (empty/>255-char token, or platform not ios|android). Grants: authenticated + service_role only.';

-- SAFETY: functions default to EXECUTE granted to PUBLIC, and this project also
-- ships ALTER DEFAULT PRIVILEGES granting EXECUTE to anon (see
-- 20260713190000_post_a_car.sql), so revoking PUBLIC alone is NOT enough — anon
-- must be named explicitly. A push token needs an owner, so anon gets nothing.
revoke execute on function public.register_push_token(text, text) from public, anon;
grant  execute on function public.register_push_token(text, text) to authenticated, service_role;


-- =============================================================================
-- 5. FUNCTION: unregister_push_token(token)
-- =============================================================================
-- Removes the caller's OWN device registration. Called on sign-out, so the
-- handset stops receiving the departing user's pushes immediately rather than
-- waiting for the next person to sign in and trigger the migration upsert.
--
-- SAFETY: the delete is gated on user_id = auth.uid(). A token belonging to
-- someone else is left untouched and the call still returns cleanly — so a
-- guessed/stolen token cannot be used to silence another account's
-- notifications, and the caller learns NOTHING about whether the token exists.
-- Missing row and not-yours are the same outcome: no error, no oracle.
create or replace function public.unregister_push_token(
  p_token text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_token text := btrim(coalesce(p_token, ''));
begin
  -- No session (or an already-torn-down one, which is realistic on the sign-out
  -- path) -> silent no-op. Deliberately NOT an exception: there is nothing to
  -- delete without a caller identity, and failing here would surface an error
  -- during sign-out for no security gain (anon holds no EXECUTE anyway).
  if v_uid is null or v_token = '' then
    return;
  end if;

  -- Own rows only. No RETURNING / no row-count check: the caller must not be
  -- able to distinguish "deleted", "not yours" and "never existed".
  delete from public.push_tokens
  where token = v_token
    and user_id = v_uid;
end;
$$;

comment on function public.unregister_push_token(text) is
  'Removes the CALLER''s own push token (sign-out path). SECURITY DEFINER; deletes only where user_id = auth.uid(), so another user''s token can never be silenced. Silent no-op when the token is missing, belongs to someone else, blank, or there is no session — missing and not-yours are indistinguishable (no existence oracle). Grants: authenticated + service_role only.';

-- SAFETY: revoke PUBLIC *and* anon (the project's default privileges grant anon
-- EXECUTE at create time); un-registering is an account action.
revoke execute on function public.unregister_push_token(text) from public, anon;
grant  execute on function public.unregister_push_token(text) to authenticated, service_role;


-- =============================================================================
-- 6. FUNCTION: prune_push_token(token)  -- SERVICE ROLE ONLY
-- =============================================================================
-- Deletes a token unconditionally, whoever owns it. Called by the receipt drain
-- when Expo reports DeviceNotRegistered for that token: the device has
-- uninstalled the app or revoked notifications, so the row is dead weight and
-- every future send to it wastes a slot in the 100-message chunk.
--
-- SAFETY: this is the one function here with NO ownership check, so it is the
-- one function no client may call — a public grant would hand any user a
-- one-call mute button for any device token they could obtain. Grants are
-- service_role ONLY (revoked from public, anon AND authenticated), matching the
-- Stripe webhook RPCs' posture: called with the service-role key from an Edge
-- Function, never from the app bundle (SECURITY_AND_TRUST §6).
create or replace function public.prune_push_token(
  p_token text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Unconditional by design: the caller is the trusted receipt drain, which has
  -- already been told by Expo that this exact token is undeliverable. A missing
  -- row is a no-op (the token may have been re-registered elsewhere or cascaded
  -- away with a deleted account since the ticket was parked).
  delete from public.push_tokens
  where token = p_token;
end;
$$;

comment on function public.prune_push_token(text) is
  'Deletes a push token unconditionally, regardless of owner. Called ONLY by the receipt drain when Expo returns DeviceNotRegistered. SECURITY DEFINER with NO ownership check, therefore SERVICE ROLE ONLY — public, anon and authenticated are all revoked, because a client grant would be a mute button for any token an attacker could obtain. A missing token is a silent no-op.';

-- SAFETY: no ownership check inside -> no client may execute. Revoke public,
-- anon AND authenticated (the project's default privileges grant both anon and
-- authenticated EXECUTE at create time), then grant service_role alone.
revoke execute on function public.prune_push_token(text) from public, anon, authenticated;
grant  execute on function public.prune_push_token(text) to service_role;


-- =============================================================================
-- END OF MIGRATION
-- =============================================================================

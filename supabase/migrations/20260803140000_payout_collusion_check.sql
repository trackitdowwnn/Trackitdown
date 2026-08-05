-- -----------------------------------------------------------------------------
-- WHAT:  The collusion check's storage: a review ledger for held payouts, and a
--        device-link ledger recording when a push token changes hands.
-- WHY:   SECURITY_AND_TRUST §5 requires a collusion check before any payout.
--        With the payout wire now closed — and auto-release coming (ADR-0010) —
--        the unchecked path lets an owner post a bounty, report a "sighting"
--        from a second account, credit it, and transfer 95% of their own escrow
--        back to themselves: free money laundering with our card fees as the
--        only cost. The check runs in release-payout; these tables are what it
--        reads and writes.
--
--        WHY A DEVICE **LINK** LEDGER AND NOT A FINGERPRINT TABLE: push_tokens
--        deliberately moves a token to its current owner on re-registration
--        (PK on token; see 20260802100000), so "do these two accounts share a
--        token" can NEVER be true for the classic fraud shape — one phone,
--        two accounts, switching between them. The MOVE is the signal. When
--        register_push_token re-points a token from user A to user B, that is
--        the same physical handset changing accounts, and this ledger records
--        exactly that edge and nothing else.
--
-- SAFETY: both tables are service-role only. No client grant of any kind:
--        review REASONS would teach a fraudster which signal caught them, and
--        device links are a co-location oracle over other users — the same
--        oracle push_tokens' own comments forbid exposing. The client learns
--        only a status word ('held_for_review') from release-payout.
-- LINKS: supabase/functions/release-payout/index.ts (the only reader/writer);
--        supabase/migrations/20260802100000_push_infrastructure.sql
--          (push_tokens, register_push_token — redefined below);
--        docs/SECURITY_AND_TRUST.md §5; docs/decisions/ADR-0010.
-- -----------------------------------------------------------------------------

-- =============================================================================
-- 1. The review ledger. One row per post, created the first time a payout for
--    it trips a signal. `resolution` is written by hand (Supabase console) at
--    v1 volume — the moderation decision on record is "flags can be read in
--    the console until volume justifies a UI".
-- =============================================================================
create table public.payout_reviews (
  -- One review per post, ever: the payout is per-post (one transfer, one
  -- idempotency key), so its review is too. RESTRICT mirrors payments — a
  -- post under money review must not be deletable out from under it.
  post_id     uuid primary key
                references public.posts (id) on delete restrict,

  owner_id    uuid not null references public.profiles (id) on delete restrict,
  spotter_id  uuid not null references public.profiles (id) on delete restrict,

  -- Which signals fired, e.g. {'shared_device','shared_card','matching_email'}.
  -- Machine words only — never free text, never an email, never a token.
  reasons     text[] not null,

  created_at  timestamptz not null default now(),

  -- Written manually. 'approved' lets the next release-payout run proceed;
  -- 'rejected' keeps the money in escrow permanently pending manual action —
  -- deliberately NOT auto-refunded, because in the fraud shape this exists to
  -- catch, the owner asking for the refund is the fraudster.
  resolution  text
                constraint payout_reviews_resolution_chk
                check (resolution in ('approved', 'rejected')),
  resolved_at timestamptz,

  constraint payout_reviews_resolved_pair_chk
    check ((resolution is null) = (resolved_at is null))
);

comment on table public.payout_reviews is
  'Payouts held for manual collusion review (SECURITY_AND_TRUST §5). One row per post, written by release-payout when a signal fires; resolution written BY HAND in the console at v1 volume. Service-role only: reasons would teach a fraudster which signal caught them. resolution=approved unblocks the payout; rejected leaves the escrow held pending manual action.';

-- Service-role only. No authenticated grant, no anon grant, no policies —
-- there is nothing here a client may ever read.
alter table public.payout_reviews enable row level security;
grant select, insert, update on public.payout_reviews to service_role;

-- =============================================================================
-- 2. The device-link ledger. Appended by register_push_token when a token
--    changes owner. Rows are edges: "this handset was signed into A, then B".
-- =============================================================================
create table public.device_links (
  id           uuid primary key default gen_random_uuid(),

  -- The token itself is NOT stored — it is a live push credential, and this
  -- ledger outlives the token's usefulness. A stable hash keys the edges to a
  -- handset without keeping anything a leak could push notifications with.
  token_hash   text not null,

  -- The handover: whose device it was, whose it became. No FK CASCADE to
  -- profiles — fraud evidence must survive account deletion (same reasoning
  -- as account_deletions), so these are bare uuids by design.
  from_user_id uuid not null,
  to_user_id   uuid not null,

  moved_at     timestamptz not null default now()
);

comment on table public.device_links is
  'One row per push-token ownership change: the same physical handset moving between accounts. THE collusion signal for one-phone-two-accounts fraud — push_tokens itself cannot show it, because re-registration moves the row. Token stored only as a hash; user ids are bare uuids so evidence survives account deletion. Service-role only: this is a co-location oracle and must never reach a client.';

create index device_links_from_user_idx on public.device_links (from_user_id);
create index device_links_to_user_idx on public.device_links (to_user_id);

alter table public.device_links enable row level security;
grant select, insert on public.device_links to service_role;

-- =============================================================================
-- 3. register_push_token learns to record the handover. The body below is the
--    20260802100000 original VERBATIM — validation, bounds, normalisation,
--    comment, grants — plus exactly two additions: a pre-read of the previous
--    owner, and the device_links insert when the token moved. Redefining a
--    SECURITY DEFINER function from memory is how validation quietly
--    disappears, so the original was copied, not paraphrased.
--
--    digest() needs pgcrypto, which is NOT yet enabled in this project (only
--    postgis is; gen_random_uuid is core Postgres, not pgcrypto).
-- =============================================================================
create extension if not exists pgcrypto with schema extensions;

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
  -- ADDED 2026-08-03: who held this device before this call, for device_links.
  v_previous uuid;
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

  -- ADDED 2026-08-03: read the current owner BEFORE the upsert re-points it.
  select user_id into v_previous
    from public.push_tokens
   where token = v_token;

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

  -- ADDED 2026-08-03: the handover is THE one-phone-two-accounts collusion
  -- signal (SECURITY_AND_TRUST §5), recorded only when the token actually
  -- moved. Same-user refreshes — every app start — write nothing. Hashed so
  -- the ledger never holds a live push credential.
  if v_previous is not null and v_previous <> v_uid then
    insert into public.device_links (token_hash, from_user_id, to_user_id)
    values (encode(extensions.digest(v_token, 'sha256'), 'hex'), v_previous, v_uid);
  end if;
end;
$$;

comment on function public.register_push_token(text, text) is
  'Registers the CALLER''s Expo push token. SECURITY DEFINER; user_id is pinned to auth.uid() and is not a parameter, so a token can never be registered on another user''s behalf. Upserts on the TOKEN (the device): if the token already exists under a DIFFERENT user, the row MOVES to the caller — a device that changes hands stops delivering the previous user''s pushes to the new holder. Idempotent; refreshes platform + updated_at. Raises NOT_AUTHENTICATED (guest) and INVALID_INPUT (empty/>255-char token, or platform not ios|android). Redefined 2026-08-03: a cross-user move now also records a device_links edge (hashed token) — the same-handset collusion signal. Grants: authenticated + service_role only.';

-- SAFETY: same grant posture as the original — revoke PUBLIC *and* anon (the
-- project's default privileges grant anon EXECUTE at create time).
revoke execute on function public.register_push_token(text, text) from public, anon;
grant  execute on function public.register_push_token(text, text) to authenticated, service_role;

-- =============================================================================
-- 4. The signal reader release-payout calls: do these two accounts share a
--    device history? SQL because the ledger must never leave the database —
--    the function answers yes/no, not "which device, when".
-- =============================================================================
create or replace function public.shared_device_exists(
  p_user_a uuid,
  p_user_b uuid
)
returns boolean
language sql
security definer
set search_path = ''
as $$
  -- Two accounts share a device when any handset (token_hash) appears in BOTH
  -- of their edge sets — this covers the direct A<->B handover and the
  -- indirect A -> C -> B chain (same phone, three accounts) in one shape.
  select exists (
    select 1
      from public.device_links as a_edges
      join public.device_links as b_edges
        on b_edges.token_hash = a_edges.token_hash
     where (a_edges.from_user_id = p_user_a or a_edges.to_user_id = p_user_a)
       and (b_edges.from_user_id = p_user_b or b_edges.to_user_id = p_user_b)
  );
$$;

comment on function public.shared_device_exists(uuid, uuid) is
  'Yes/no: have these two accounts ever been signed into the same handset (per device_links)? Deliberately boolean — the ledger itself never leaves the database. Service-role only; called by release-payout.';

revoke all on function public.shared_device_exists(uuid, uuid) from public;
revoke all on function public.shared_device_exists(uuid, uuid) from anon;
revoke all on function public.shared_device_exists(uuid, uuid) from authenticated;
grant execute on function public.shared_device_exists(uuid, uuid) to service_role;

-- =============================================================================
-- 5. Review bookkeeping for release-payout: record a hold (idempotent), read
--    the current state. Kept as RPCs so the write rule lives in one audited
--    place, mirroring upsert_connected_account.
-- =============================================================================
create or replace function public.flag_payout_for_review(
  p_post_id    uuid,
  p_owner_id   uuid,
  p_spotter_id uuid,
  p_reasons    text[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.payout_reviews (post_id, owner_id, spotter_id, reasons)
  values (p_post_id, p_owner_id, p_spotter_id, p_reasons)
  -- Never overwrite: the FIRST set of reasons is the evidence, and a repeat
  -- attempt must not reset a resolution already written.
  on conflict (post_id) do nothing;
end $$;

revoke all on function public.flag_payout_for_review(uuid, uuid, uuid, text[]) from public;
revoke all on function public.flag_payout_for_review(uuid, uuid, uuid, text[]) from anon;
revoke all on function public.flag_payout_for_review(uuid, uuid, uuid, text[]) from authenticated;
grant execute on function public.flag_payout_for_review(uuid, uuid, uuid, text[]) to service_role;

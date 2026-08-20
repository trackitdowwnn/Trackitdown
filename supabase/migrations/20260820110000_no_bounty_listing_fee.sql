-- =============================================================================
-- WHAT:  No-bounty listings paid for with a FIXED PLATFORM FEE. Adds the
--        payment_kind enum + payments.kind, widens two money CHECKs, makes
--        posts.bounty_amount_pence NULLABLE and adds posts.listing_fee_pence
--        under a mutual-exclusion CHECK, and adds the fee's own charge/capture
--        functions. Redefines create_post, update_post_bounty and claim_recovery
--        to understand the second pricing mode.
-- WHY:   Until now every listing had to carry a £50–£5,000 bounty, so £50 was
--        the price of admission for a theft victim — at the exact moment they
--        are least able to commit money, and in the first hours that decide
--        whether the car is found (DOMAIN.md, live-on-payment / ADR-0007). A
--        no-bounty listing goes live identically (feed, map, search, alerts,
--        sightings, chat); only the money leg differs: a one-off £4.99 fee
--        instead of a percentage of an escrowed bounty. See ADR-0014.
--
--        THE CENTRAL DESIGN CHOICE: a post's pricing mode is NOT a flag — it is
--        WHICH of two money columns is populated, enforced by
--        num_nonnulls(bounty_amount_pence, listing_fee_pence) = 1. There is no
--        separate enum that could drift out of sync with the money it describes,
--        and the invariant is checked by the DATABASE on every row rather than
--        promised by a function.
--
--        WHY NULL RATHER THAN 0 FOR "no bounty": a 0 flows silently through
--        every formatter and renders "£0 bounty" on cards, map pins and push
--        copy. NULL makes the type system stop at each read site and force a
--        decision. The cost is real (see SAFETY) and is accepted deliberately.
-- LINKS: docs/decisions/ADR-0014-no-bounty-listings.md;
--        docs/DOMAIN.md ("Listing pricing", post lifecycle);
--        docs/SECURITY_AND_TRUST.md §4 (server-authoritative amounts);
--        supabase/migrations/20260820100000_listing_fee_payment_status.sql
--          (adds the 'collected' status this migration writes);
--        supabase/migrations/20260707110712_payments_foundation.sql (posts,
--          payments, the CHECKs widened here, the client column grants);
--        supabase/migrations/20260726100000_post_payment.sql
--          (record_post_payment_intent / mark_post_payment_held — hardened here);
--        supabase/migrations/20260802110000_post_alert_columns.sql (the
--          create_post revision this one supersedes);
--        supabase/migrations/20260727130000_edit_post_sections.sql
--          (update_post_bounty, the ONLY money writer);
--        supabase/migrations/20260802200000_claim_recovery.sql;
--        supabase/functions/create-payment-intent, stripe-webhook;
--        supabase/tests/listing_fee_verification.sql.
--
-- SAFETY (Tier 1 — MONEY-CRITICAL, read before editing anything below):
--   * THE BOUNTY ESCROW PATH IS UNCHANGED. Every existing function keeps its
--     behaviour for a bounty-priced post. The 11 checks in
--     post_payment_verification.sql must still pass untouched — that is the
--     evidence, not this comment.
--   * THE TWO PATHS CANNOT CROSS. record_post_payment_intent now REFUSES a
--     fee-priced post and record_listing_fee_intent REFUSES a bounty-priced one,
--     so neither charge function can ever be pointed at the wrong amount.
--   * A LISTING FEE NEVER ENTERS 'held'. It goes requires_payment -> collected.
--     Every refund and payout query in the codebase filters on status = 'held',
--     so all of them skip a fee row BY CONSTRUCTION rather than by remembering
--     to add a filter. This is the single most important property here.
--   * SERVER-AUTHORITATIVE PRICE. listing_fee_pence is stamped by create_post
--     from current_listing_fee_pence() and is NOT in the posts client column
--     grants (deliberately not added to 20260707110712's grant lists), so no
--     client can name its own price. record_listing_fee_intent re-checks the
--     caller's amount against the post's own stamped value (FEE_MISMATCH),
--     exactly as record_post_payment_intent does for the bounty.
--   * WIDENING TWO CHECKS IS THE RISK. payments.amount_pence loses its
--     5000-500000 bound (a 499p fee is otherwise impossible) and gains
--     `> 0`; posts.bounty_amount_pence loses NOT NULL. Both are re-added as
--     NOT VALID + VALIDATE so an existing bad row would surface rather than be
--     silently grandfathered — there are none, and this proves it.
--   * NULLABLE BOUNTY IS LOAD-BEARING AND SHARP. Nine card RPCs and a dozen
--     client modules read bounty_amount_pence. The nullability is what makes the
--     type checker walk a developer to each one. DO NOT "fix" a downstream null
--     with coalesce(..., 0) — that re-creates the "£0 bounty" bug this design
--     exists to prevent, and in match_alert_zones it would make every no-reward
--     post match every minimum-bounty alert.
--
-- SAFETY NOTE ON DESTRUCTIVE STATEMENTS: no table, column or function is
--        dropped. Two CHECK CONSTRAINTS are dropped and immediately re-added in
--        a strictly WIDER form (nothing that was valid becomes invalid), and one
--        NOT NULL is dropped. payments.kind backfills every existing row to
--        'bounty_escrow' via its DEFAULT, which is correct: every payment that
--        exists today is a bounty escrow.
-- =============================================================================


-- =============================================================================
-- 1. ENUM + COLUMN: payments.kind  (which shape of payment this row is)
-- =============================================================================
-- The status column alone would nearly suffice (only a fee reaches 'collected'),
-- but a row is discriminable from the moment it is INSERTed, while still
-- 'requires_payment' — and that matters: create-payment-intent's stale-intent
-- sweep queries requires_payment rows before either kind has a terminal state.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'payment_kind') then
    create type public.payment_kind as enum ('bounty_escrow', 'listing_fee');
  end if;
end $$;

comment on type public.payment_kind is
  'Which shape of payment a payments row is. bounty_escrow (ADR-0002): the owner''s £50–£5,000 bounty, captured to the platform balance and later transferred 95/5 to a credited spotter or refunded. listing_fee (ADR-0014): the fixed fee for a no-bounty listing — platform revenue on capture, never escrowed, never transferred, never refunded.';

alter table public.payments
  add column if not exists kind public.payment_kind not null default 'bounty_escrow';

comment on column public.payments.kind is
  'Which shape of payment this row is (payment_kind). DEFAULT bounty_escrow is the correct backfill for every pre-2026-08-20 row: listing fees did not exist before then. Set explicitly by record_post_payment_intent / record_listing_fee_intent; never updated afterwards.';

-- Composite index (post_id, kind): every fee lookup is "the row of this kind
-- for this post". Deliberately NOT partial — both kinds are queried.
create index if not exists payments_post_kind_idx
  on public.payments (post_id, kind);


-- =============================================================================
-- 2. WIDEN payments.amount_pence  (5000–500000 -> > 0)
-- =============================================================================
-- MONEY: this bound is what currently makes a 499p charge impossible. It was the
-- bounty range copied onto the ledger; with two pricing modes the ledger can no
-- longer carry ONE range, so the range check moves to where the range actually
-- lives (posts.bounty_amount_pence below) and the ledger keeps only the
-- invariant that is true of ALL money: a charge is a positive number of pence.
-- The per-kind amount is re-validated against the post by the record_* functions.
alter table public.payments
  drop constraint if exists payments_amount_pence_check;

alter table public.payments
  add constraint payments_amount_pence_check
  check (amount_pence > 0) not valid;

-- VALIDATE separately: this scans existing rows and FAILS LOUDLY on a bad one
-- rather than grandfathering it in. Every existing row is a 5000–500000 bounty,
-- so this passes — and having it run is what makes that a fact rather than a
-- belief.
alter table public.payments
  validate constraint payments_amount_pence_check;

comment on column public.payments.amount_pence is
  'MONEY: the amount actually charged, integer pence GBP. An immutable snapshot of what was taken. For kind=bounty_escrow this is the full bounty (£50–£5,000, range enforced on posts.bounty_amount_pence); for kind=listing_fee it is the fixed fee stamped on the post. The CHECK here is only `> 0` because the ledger carries both shapes — the per-kind amount is re-validated against the post by record_post_payment_intent / record_listing_fee_intent (BOUNTY_MISMATCH / FEE_MISMATCH).';


-- =============================================================================
-- 3. POSTS: nullable bounty + listing_fee_pence + the mutual-exclusion CHECK
-- =============================================================================
alter table public.posts
  alter column bounty_amount_pence drop not null;

alter table public.posts
  drop constraint if exists posts_bounty_amount_pence_check;

alter table public.posts
  add constraint posts_bounty_amount_pence_check
  check (bounty_amount_pence is null or bounty_amount_pence between 5000 and 500000)
  not valid;

alter table public.posts
  validate constraint posts_bounty_amount_pence_check;

-- MONEY: the fixed listing fee, snapshotted onto the post at create_post time.
-- SNAPSHOTTED, not looked up at charge time: if the price ever changes, a draft
-- created yesterday must still be charged the price its owner was shown. This is
-- the same reason payments.amount_pence is an immutable snapshot.
alter table public.posts
  add column if not exists listing_fee_pence integer;

alter table public.posts
  drop constraint if exists posts_listing_fee_pence_check;

alter table public.posts
  add constraint posts_listing_fee_pence_check
  check (listing_fee_pence is null or listing_fee_pence > 0);

-- THE INVARIANT. Exactly one pricing mode per post, enforced structurally.
-- A row with both set (charged twice) or neither set (live for free) is not a
-- state this product has, so it is not a state the table permits.
alter table public.posts
  drop constraint if exists posts_one_pricing_mode_check;

alter table public.posts
  add constraint posts_one_pricing_mode_check
  check (num_nonnulls(bounty_amount_pence, listing_fee_pence) = 1)
  not valid;

-- Validates against every existing post: all have a bounty and no fee, so all
-- satisfy num_nonnulls(...) = 1. A failure here would mean a pre-existing row
-- violates the model, which we want to hear about immediately.
alter table public.posts
  validate constraint posts_one_pricing_mode_check;

comment on column public.posts.bounty_amount_pence is
  'MONEY: bounty in integer pence, GBP. £50–£5,000 when set. NULLABLE since 2026-08-20 (ADR-0014): NULL means this is a no-bounty listing, paid for with listing_fee_pence instead. NULL rather than 0 ON PURPOSE — a 0 renders as "£0 bounty" on every card and map pin, whereas NULL makes each read site declare what it does. NEVER coalesce this to 0 downstream.';

comment on column public.posts.listing_fee_pence is
  'MONEY: the fixed platform fee for a NO-BOUNTY listing, integer pence GBP, or NULL when the post carries a bounty instead. Stamped by create_post from current_listing_fee_pence() and SNAPSHOTTED, so a price change never re-prices an existing draft. SERVER-CONTROLLED: deliberately absent from the posts INSERT/UPDATE client column grants, so no client can name its own price.';

comment on constraint posts_one_pricing_mode_check on public.posts is
  'ADR-0014: exactly one pricing mode per post — a bounty OR a listing fee, never both (charged twice) and never neither (live for free). The post''s pricing mode IS this invariant; there is no separate flag that could disagree with the money.';


-- =============================================================================
-- 3b. PROVE THE WIDENING ACTUALLY TOOK EFFECT
-- =============================================================================
-- The two constraints dropped above were UNNAMED column CHECKs, so their names
-- were generated by Postgres as {table}_{column}_check. That is deterministic —
-- but `drop constraint IF EXISTS` fails SILENTLY on a name that never matched,
-- and the old bound would then still be live while this migration reported
-- success. The feature would fail much later, at the first £4.99 charge, as an
-- unexplained constraint violation in a Stripe webhook.
--
-- So: assert against the CATALOG that no surviving CHECK still imposes the old
-- lower bound on either column. Deliberately NOT done by inserting a probe row —
-- migrations run BEFORE seed.sql, so `profiles` is empty here and a probe post
-- would have no owner to reference, failing on a foreign key rather than on the
-- constraint under test. Reading pg_constraint needs no fixtures at all.
--
-- A surviving old constraint raises immediately, in the migration that caused
-- it, with the query that finds the real name. Without this the feature would
-- fail much later, at the first £4.99 charge, as an unexplained constraint
-- violation inside a Stripe webhook.
do $$
declare
  v_bad text;
begin
  -- `5000` appears in the OLD bound of both columns and in neither new one.
  select string_agg(c.conname || ' => ' || pg_get_constraintdef(c.oid), '; ')
    into v_bad
  from pg_constraint c
  where c.conrelid = 'public.posts'::regclass
    and c.contype = 'c'
    -- The OLD bound mentions the column and 5000 and does NOT permit NULL. The
    -- new one contains `IS NULL`; posts_one_pricing_mode_check mentions the
    -- column but no bound at all — so requiring 5000 excludes both correctly.
    and pg_get_constraintdef(c.oid) like '%bounty_amount_pence%'
    and pg_get_constraintdef(c.oid) like '%5000%'
    and pg_get_constraintdef(c.oid) not like '%IS NULL%';
  if v_bad is not null then
    raise exception
      'MIGRATION SELF-CHECK FAILED: a CHECK on public.posts still constrains bounty_amount_pence without allowing NULL (%). '
      'The old constraint was not dropped — the name guessed above did not match. Find it with: '
      'select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid = ''public.posts''::regclass and contype = ''c'';',
      v_bad;
  end if;

  select string_agg(c.conname || ' => ' || pg_get_constraintdef(c.oid), '; ')
    into v_bad
  from pg_constraint c
  where c.conrelid = 'public.payments'::regclass
    and c.contype = 'c'
    and pg_get_constraintdef(c.oid) like '%amount_pence%'
    and pg_get_constraintdef(c.oid) like '%5000%';
  if v_bad is not null then
    raise exception
      'MIGRATION SELF-CHECK FAILED: a CHECK on public.payments still bounds an amount at 5000 pence (%), '
      'so the £4.99 listing fee can never be charged. Find it with: '
      'select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid = ''public.payments''::regclass and contype = ''c'';',
      v_bad;
  end if;

  raise notice 'Listing-fee migration self-check passed: no surviving CHECK blocks a NULL bounty or a sub-£50 amount.';
end $$;


-- =============================================================================
-- 4. FUNCTION: current_listing_fee_pence()  (the one place the price lives)
-- =============================================================================
-- MONEY: £4.99. One auditable definition, mirroring how payout_split() owns the
-- 95/5 split (20260802220000). The client mirrors this value for display copy
-- only (src/shared/lib/money.ts LISTING_FEE_PENCE); THIS is authoritative, and
-- record_listing_fee_intent re-checks against the post's stamped snapshot rather
-- than against this function, so a price change cannot retro-price a draft.
create or replace function public.current_listing_fee_pence()
returns integer
language sql
immutable
set search_path = ''
as $$
  select 499;
$$;

comment on function public.current_listing_fee_pence() is
  'MONEY: the current fixed platform fee for a no-bounty listing, integer pence GBP (£4.99, ADR-0014). The single authoritative definition of the price. Read ONLY by create_post, which snapshots the result onto posts.listing_fee_pence — charge-time validation compares against that snapshot, never against this function, so changing the price here never re-prices an existing draft. Mirrored for display copy in src/shared/lib/money.ts.';

revoke execute on function public.current_listing_fee_pence() from public, anon;
grant  execute on function public.current_listing_fee_pence() to authenticated, service_role;


-- =============================================================================
-- 5. FUNCTION: create_post(...)   (REDEFINED — bounty becomes optional)
-- =============================================================================
-- CHANGE FROM 20260802110000, in full — everything else is character-identical:
--   * p_bounty_amount_pence is no longer part of the MISSING_REQUIRED test;
--   * the BOUNTY_OUT_OF_RANGE test now only runs when a bounty was supplied;
--   * the INSERT stamps listing_fee_pence from current_listing_fee_pence() when
--     no bounty was supplied, and NULL when one was.
--
-- THE SIGNATURE IS UNCHANGED. p_bounty_amount_pence was always `int` and already
-- accepted NULL (it was rejected in the body, not by the type), so every one of
-- the ~25 POSITIONAL callers across the SQL verification suites keeps working and
-- no comment/revoke/grant signature list has to change. That is why this reads as
-- a body-only edit despite being a schema-level feature.
--
-- SAFETY (Tier 1 — unchanged from the original and re-stated because this is a
--   full redefinition): SECURITY DEFINER, so it BYPASSES RLS and the posts client
--   column grants. owner_id is pinned to the caller; status is HARD-CODED
--   'draft'; there is NO status parameter and NO alerts_sent_at parameter. ALL
--   validation is a SERVER re-check of untrusted client input. The whole body is
--   one transaction, so the post + photos + feature tags + verification-doc +
--   distinctive features are inserted ATOMICALLY.
--   NEW: listing_fee_pence is likewise not a parameter — the price is read from
--   current_listing_fee_pence(), never from the caller.
create or replace function public.create_post(
  p_plate                   text,
  p_make                    text,
  p_model                   text,
  p_colour                  text,
  p_year                    int,
  p_body_type               text,
  p_distinguishing_features text,
  p_owner_note              text,
  p_desc_recognise          text,
  p_desc_drives             text,
  p_stolen_from             text,
  p_keys_taken              text,
  p_last_seen_at            timestamptz,
  p_last_seen_lat           double precision,
  p_last_seen_lng           double precision,
  p_last_seen_area          text,
  p_bounty_amount_pence     int,
  p_photo_urls              text[],
  p_feature_keys            text[],
  p_verification_path       text,
  p_distinctive_features    jsonb default '[]'::jsonb,
  -- TRAILING and DEFAULTED on purpose, despite reading better beside
  -- p_last_seen_area. The client calls this by NAME (PostgREST sends named
  -- arguments), so position buys it nothing — but every POSITIONAL caller
  -- breaks when a non-defaulted parameter is inserted mid-list, and this
  -- function has ~25 positional callers across the SQL verification suites.
  -- Since scripts/test-db.sh runs them under `set -e`, one 42883 there stops
  -- the run before anon_role_verification.sql — the Tier 1 deny-by-default
  -- CI gate — ever executes. A trailing default keeps every existing call
  -- valid and costs only the pleasing argument order.
  p_last_seen_locality      text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_owner       uuid := auth.uid();
  v_post_id     uuid;
  v_plate       text;
  v_plate_canon text;
  v_photo_count int  := coalesce(array_length(p_photo_urls, 1), 0);
  v_url         text;
  v_photo_url_re text := '^https?://(127\.0\.0\.1(:[0-9]+)?|[a-z0-9-]+\.supabase\.co)'
                         || '/storage/v1/object/public/post-photos/'
                         || v_owner::text || '/[^/]+$';
  -- Distinctive-feature validation scratch vars (20260724100000).
  v_features    jsonb := coalesce(p_distinctive_features, '[]'::jsonb);
  v_feature     jsonb;
  v_feat_desc   text;
  v_feat_url    text;
  -- SAFETY (20260802110000): the coarse alert-facing label. Trimmed; '' -> NULL
  -- so the push falls back to 'your area' rather than emitting "near ".
  v_locality    text := nullif(btrim(p_last_seen_locality), '');
  -- MONEY (ADR-0014): the fee, or NULL when a bounty was supplied. Resolved ONCE
  -- here so the INSERT reads a settled value and the mutual-exclusion CHECK has
  -- exactly one source of truth.
  v_listing_fee int := case when p_bounty_amount_pence is null
                            then public.current_listing_fee_pence()
                            else null end;
begin
  if v_owner is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  -- --- OPTIONAL PLATE: canon first; a plate that strips to nothing is NULL -----
  v_plate_canon := upper(regexp_replace(coalesce(p_plate, ''), '[^A-Za-z0-9]', '', 'g'));
  -- FIX (20260713195000): store NULL whenever the canon is empty (blank,
  -- punctuation-only, or non-ASCII homoglyphs) — those are NOT plates. A non-null
  -- v_plate therefore always passes the {2,8} gate below (also re-bounds length).
  v_plate := case when v_plate_canon = '' then null
                  else upper(trim(coalesce(p_plate, ''))) end;

  -- Format + uniqueness gates apply ONLY when a real plate was provided.
  if v_plate_canon <> '' then
    if v_plate_canon !~ '^[A-Z0-9]{2,8}$' then
      raise exception 'INVALID_PLATE';
    end if;

    if exists (
      select 1
      from public.posts p
      where upper(regexp_replace(coalesce(p.plate, ''), '[^A-Za-z0-9]', '', 'g')) = v_plate_canon
        and p.status in ('active', 'pending_verification', 'recovery_claimed')
    ) then
      raise exception 'PLATE_IN_USE';
    end if;
  end if;

  -- --- Required fields (make/model/colour are the identity, plate or not) ------
  -- NOTE (ADR-0014): p_bounty_amount_pence is NO LONGER in this list. A NULL
  -- bounty is now a legitimate, fully-specified choice — "no reward, pay the
  -- fixed fee" — not a half-filled form. The mutual-exclusion CHECK on the table
  -- is what guarantees the post still ends up with exactly one price.
  if p_make is null or p_model is null or p_colour is null
     or p_last_seen_at is null
     or p_last_seen_lat is null or p_last_seen_lng is null then
    raise exception 'MISSING_REQUIRED';
  end if;

  -- --- MONEY: bounty range (only when a bounty was actually offered) -----------
  if p_bounty_amount_pence is not null
     and (p_bounty_amount_pence < 5000 or p_bounty_amount_pence > 500000) then
    raise exception 'BOUNTY_OUT_OF_RANGE';
  end if;

  -- --- Photo count ------------------------------------------------------------
  if v_photo_count < 3 or v_photo_count > 6 then
    raise exception 'PHOTO_COUNT';
  end if;

  -- --- SAFETY: photo URLs must be our own-folder post-photos objects ----------
  foreach v_url in array p_photo_urls loop
    if v_url is null or char_length(v_url) > 500 or v_url !~ v_photo_url_re then
      raise exception 'INVALID_PHOTO_URL';
    end if;
  end loop;

  -- --- SAFETY: the V5C path must be under the caller's own folder -------------
  if p_verification_path is not null then
    if char_length(p_verification_path) > 300
       or split_part(p_verification_path, '/', 1) <> v_owner::text then
      raise exception 'INVALID_VERIFICATION_PATH';
    end if;
  end if;

  -- --- Distinctive features (owner-authored photo+description evidence pairs) --
  -- Server re-check of the jsonb array of {"photo_url": text, "description": text}
  -- objects. A non-array payload is treated as malformed. At most 8 features;
  -- each description is 3–80 chars trimmed; each photo_url must be an own-folder
  -- post-photos object (SAME check as p_photo_urls above — same §3 vector).
  if jsonb_typeof(v_features) <> 'array' then
    raise exception 'INVALID_DISTINCTIVE_FEATURE';
  end if;
  if jsonb_array_length(v_features) > 8 then
    raise exception 'DISTINCTIVE_FEATURES_COUNT';
  end if;
  for v_feature in select value from jsonb_array_elements(v_features) loop
    v_feat_desc := v_feature ->> 'description';
    v_feat_url  := v_feature ->> 'photo_url';
    if v_feat_desc is null
       or char_length(btrim(v_feat_desc)) < 3
       or char_length(btrim(v_feat_desc)) > 80 then
      raise exception 'INVALID_DISTINCTIVE_FEATURE';
    end if;
    if v_feat_url is null or char_length(v_feat_url) > 500
       or v_feat_url !~ v_photo_url_re then
      raise exception 'INVALID_DISTINCTIVE_PHOTO_URL';
    end if;
  end loop;

  -- --- Constrained enums (null allowed; posts CHECK also enforces) ------------
  if p_stolen_from is not null
     and p_stolen_from not in ('driveway', 'street', 'car_park', 'other') then
    raise exception 'INVALID_STOLEN_FROM';
  end if;
  if p_keys_taken is not null
     and p_keys_taken not in ('yes', 'no', 'unknown') then
    raise exception 'INVALID_KEYS_TAKEN';
  end if;

  -- --- Atomic assembly (single transaction) -----------------------------------
  -- NOTE: alerts_sent_at is NOT in this column list. A new post is a DRAFT and
  -- has never been alerted; the notify-spotters claim sets it later, server-side.
  insert into public.posts (
    owner_id, plate, make, model, colour,
    year, body_type, distinguishing_features, owner_note,
    desc_recognise, desc_drives, stolen_from, keys_taken,
    last_seen_at, last_seen_location, last_seen_area, last_seen_locality,
    bounty_amount_pence, listing_fee_pence, status, expires_at
  )
  values (
    v_owner, v_plate, p_make, p_model, p_colour,
    p_year, p_body_type, p_distinguishing_features, p_owner_note,
    p_desc_recognise, p_desc_drives, p_stolen_from, p_keys_taken,
    p_last_seen_at,
    ST_SetSRID(ST_MakePoint(p_last_seen_lng, p_last_seen_lat), 4326)::geography,
    p_last_seen_area,
    v_locality,
    -- MONEY: exactly one of these two is non-null, by construction of
    -- v_listing_fee above. posts_one_pricing_mode_check re-asserts it.
    p_bounty_amount_pence, v_listing_fee, 'draft', now() + interval '90 days'
  )
  returning id into v_post_id;

  insert into public.post_photos (post_id, url, position)
  select v_post_id, u.url, (u.ord - 1)::int
  from unnest(p_photo_urls) with ordinality as u(url, ord);

  if p_feature_keys is not null and array_length(p_feature_keys, 1) is not null then
    insert into public.post_feature (post_id, feature_key)
    select v_post_id, k
    from unnest(p_feature_keys) as k;
  end if;

  if p_verification_path is not null then
    insert into public.verification_documents (post_id, storage_path)
    values (v_post_id, p_verification_path);
  end if;

  -- Distinctive features: one row per array element, position = ordinality-1 so
  -- the stored order matches the order the wizard sent them (0-based). description
  -- is stored trimmed (the CHECK measures it trimmed; store the clean label).
  insert into public.post_distinctive_feature (post_id, photo_url, description, position)
  select v_post_id,
         elem.value ->> 'photo_url',
         btrim(elem.value ->> 'description'),
         (elem.ord - 1)::int
  from jsonb_array_elements(v_features) with ordinality as elem(value, ord);

  return jsonb_build_object('post_id', v_post_id, 'status', 'draft');
end;
$$;

comment on function public.create_post(
  -- NOTE the trailing `text`: p_last_seen_locality is the LAST parameter, not
  -- mid-list beside p_last_seen_area (see the banner). Postgres resolves
  -- comment/revoke/grant by exact signature, so this list must track the
  -- definition — a stale copy here fails the migration with 42883.
  text, text, text, text, int, text, text, text, text, text, text, text,
  timestamptz, double precision, double precision, text, int, text[], text[], text, jsonb, text
) is
  'The write boundary for the post-a-car wizard. SECURITY DEFINER: pins owner_id to the caller, HARD-CODES status=draft, sets expires_at=now()+90d, and atomically inserts the post + photos + feature tags + verification-doc row + distinctive features. PRICING (ADR-0014, 2026-08-20): p_bounty_amount_pence is now OPTIONAL. Supplied -> a bounty listing, re-validated £50–£5000. NULL -> a NO-BOUNTY listing, and listing_fee_pence is stamped from current_listing_fee_pence() — the price is read server-side and is never a parameter, so no client can name its own. Exactly one of the two is set, asserted by posts_one_pricing_mode_check. Also re-validates plate (optional/format/one-active-per-plate), 3–6 photos, own-folder photo/V5C paths, the stolen_from/keys_taken enums, and up to 8 distinctive features (each: 3–80-char trimmed description + own-folder photo URL). p_last_seen_locality is the COARSE district/city label the spotter-alert push reads — trimmed, empty -> null; deliberately separate from p_last_seen_area, which can be street-grain and must never reach a push. Never writes alerts_sent_at (service-role claim). Raises: NOT_AUTHENTICATED, INVALID_PLATE, PLATE_IN_USE, MISSING_REQUIRED, BOUNTY_OUT_OF_RANGE, PHOTO_COUNT, INVALID_PHOTO_URL, INVALID_VERIFICATION_PATH, DISTINCTIVE_FEATURES_COUNT, INVALID_DISTINCTIVE_FEATURE, INVALID_DISTINCTIVE_PHOTO_URL, INVALID_STOLEN_FROM, INVALID_KEYS_TAKEN. Only ever creates drafts; payment success advances the lifecycle later, server-side.';

-- SAFETY: functions default to EXECUTE granted to PUBLIC, and this project ships
-- ALTER DEFAULT PRIVILEGES that re-grant anon at CREATE time — so naming `anon`
-- in the revoke is REQUIRED, not belt-and-braces, and it must be REPEATED after
-- every CREATE OR REPLACE (which re-runs those default privileges). Granted to
-- authenticated + service_role ONLY (posting a car requires a signed-in account;
-- the function raises NOT_AUTHENTICATED for a null auth.uid() regardless as a
-- backstop). Omitting this block would silently re-open create_post to anon —
-- the exact regression 20260713191000_create_post_deny_anon.sql was written to
-- close.
revoke execute on function public.create_post(
  -- NOTE the trailing `text`: p_last_seen_locality is the LAST parameter, not
  -- mid-list beside p_last_seen_area (see the banner). Postgres resolves
  -- comment/revoke/grant by exact signature, so this list must track the
  -- definition — a stale copy here fails the migration with 42883.
  text, text, text, text, int, text, text, text, text, text, text, text,
  timestamptz, double precision, double precision, text, int, text[], text[], text, jsonb, text
) from public, anon;
grant execute on function public.create_post(
  text, text, text, text, int, text, text, text, text, text, text, text,
  timestamptz, double precision, double precision, text, int, text[], text[], text, jsonb, text
) to authenticated, service_role;


-- =============================================================================
-- 6. FUNCTION: update_post_bounty(...)   (REDEFINED — can switch pricing mode)
-- =============================================================================
-- Still DRAFT-ONLY, still the ONLY money writer, still touches nothing but the
-- two price columns. What changes: a NULL p_bounty_amount_pence now means "switch
-- this draft to a no-bounty listing" instead of raising BOUNTY_OUT_OF_RANGE.
--
-- WHY EXTEND THIS RATHER THAN ADD A SIBLING FUNCTION: the pricing mode IS which
-- money column is populated, so switching mode is a write to the same two columns
-- this function already owns. A second function would mean two money writers on
-- one invariant, and either could leave the pair inconsistent between them. One
-- writer that always sets BOTH columns cannot.
--
-- Safe ONLY because a draft has no payment yet (the charge is taken at Post & pay,
-- which flips draft -> active); the draft-only gate guarantees this can never run
-- on a paid post whose money is settled.
create or replace function public.update_post_bounty(
  p_post_id             uuid,
  p_bounty_amount_pence int
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_owner uuid := auth.uid();
  v_post  public.posts%rowtype;
begin
  if v_owner is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  -- SAFETY: DRAFT-ONLY gate. Own + draft + locked, else POST_NOT_EDITABLE.
  select * into v_post
  from public.posts p
  where p.id = p_post_id
    and p.owner_id = v_owner
    and p.status = any(array['draft']::public.post_status[])
  for update;
  if not found then
    raise exception 'POST_NOT_EDITABLE';
  end if;

  -- MONEY: bounty range (create_post parity). A NULL is NOT an error any more —
  -- it selects the no-bounty pricing mode. A non-null must still be in range.
  if p_bounty_amount_pence is not null
     and (p_bounty_amount_pence < 5000 or p_bounty_amount_pence > 500000) then
    raise exception 'BOUNTY_OUT_OF_RANGE';
  end if;

  -- MONEY: touch ONLY the two price columns, and always BOTH, so the pair can
  -- never be left inconsistent — switching to a fee clears the bounty, and
  -- setting a bounty clears the fee. posts_one_pricing_mode_check re-asserts it.
  -- The fee is re-stamped from current_listing_fee_pence() rather than preserved,
  -- because a draft that switches mode is being priced now.
  update public.posts set
    bounty_amount_pence = p_bounty_amount_pence,
    listing_fee_pence   = case when p_bounty_amount_pence is null
                               then public.current_listing_fee_pence()
                               else null end
  where id = p_post_id;

  return jsonb_build_object('post_id', p_post_id);
end;
$$;

comment on function public.update_post_bounty(uuid, int) is
  'DRAFT-ONLY per-section edit and the ONLY money writer: sets bounty_amount_pence and listing_fee_pence and NOTHING ELSE on an own draft post (else POST_NOT_EDITABLE). Since 2026-08-20 (ADR-0014) a NULL bounty is valid and SWITCHES THE POST TO THE NO-BOUNTY PRICING MODE, stamping the fee from current_listing_fee_pence(); a non-null bounty must be 5000–500000 pence (£50–£5000) or BOUNTY_OUT_OF_RANGE, and clears any fee. Always writes BOTH columns so the pair cannot drift apart; posts_one_pricing_mode_check re-asserts exactly one is set. Safe only because a draft has no payment; the draft-only gate keeps it off paid posts. Never writes status/owner_id/expires_at or any non-money column. Also raises NOT_AUTHENTICATED.';

revoke execute on function public.update_post_bounty(uuid, int) from public;
revoke execute on function public.update_post_bounty(uuid, int) from anon;
grant  execute on function public.update_post_bounty(uuid, int) to authenticated, service_role;


-- =============================================================================
-- 7. FUNCTION: record_listing_fee_intent(post_id, intent_id, amount_pence)
-- =============================================================================
-- The fee twin of record_post_payment_intent (20260726100000). Records the fee
-- PaymentIntent for a DRAFT no-bounty post as a 'requires_payment' ledger row
-- with kind='listing_fee'.
--
-- GUARDS (stable raise codes the Edge Function maps to user messages):
--   * POST_NOT_DRAFT — missing, not draft, OR not a fee-priced post. The last
--                      case is deliberately folded into this code rather than
--                      given its own: a client that reached the fee charge path
--                      for a bounty post has a bug, not a user-facing condition,
--                      and a distinct code would only invite handling it.
--   * FEE_MISMATCH   — p_amount_pence disagrees with the post's own stamped
--                      listing_fee_pence. The amount is NEVER trusted from the
--                      caller (mirrors BOUNTY_MISMATCH exactly).
--
-- IDEMPOTENT: a retry at the same amount reuses the live requires_payment row; a
-- 'collected' row is left untouched. Unlike the bounty path there is no
-- supersede-on-edit branch, because the fee is a fixed server price — a draft
-- cannot be at a different fee than the one stamped on it, so a stale row at a
-- different amount can only mean the post SWITCHED pricing mode. That row is
-- superseded to 'failed' for the same reason the bounty path supersedes: never
-- drop it (which would strand a captured charge with no ledger row).
create or replace function public.record_listing_fee_intent(
  p_post_id           uuid,
  p_payment_intent_id text,
  p_amount_pence      integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fee    integer;
  v_status public.post_status;
begin
  -- Lock the post row so concurrent intent-recording for the same post
  -- serialises (belt-and-braces against a double-charge race).
  select listing_fee_pence, status
    into v_fee, v_status
  from public.posts
  where id = p_post_id
  for update;

  -- Must exist, still be a draft, AND actually be a fee-priced post.
  if not found or v_status <> 'draft' or v_fee is null then
    raise exception 'POST_NOT_DRAFT';
  end if;

  -- MONEY: the charge amount is server-authoritative. A caller-supplied amount
  -- that disagrees with the post's own stamped fee is rejected outright.
  if p_amount_pence is distinct from v_fee then
    raise exception 'FEE_MISMATCH';
  end if;

  -- Already collected? Never open a second fee row over a captured one.
  if exists (
    select 1 from public.payments
    where post_id = p_post_id and status = 'collected'
  ) then
    return;
  end if;

  -- IDEMPOTENT reuse: a live requires_payment row at the SAME amount is the
  -- in-flight intent.
  if exists (
    select 1 from public.payments
    where post_id = p_post_id
      and status = 'requires_payment'
      and amount_pence = p_amount_pence
  ) then
    return;
  end if;

  -- Supersede a live row at a DIFFERENT amount — on this path that means the
  -- draft switched pricing mode since an abandoned attempt (e.g. it had a
  -- bounty). Never dropped: a dropped row could leave a captured charge with no
  -- ledger entry. create-payment-intent cancels the superseded Stripe intent.
  update public.payments
     set status = 'failed'
   where post_id = p_post_id
     and status = 'requires_payment'
     and amount_pence <> p_amount_pence;

  insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence, kind)
  values (p_post_id, p_payment_intent_id, 'requires_payment', p_amount_pence, 'listing_fee')
  on conflict (stripe_payment_intent_id) do nothing;
end;
$$;

comment on function public.record_listing_fee_intent(uuid, text, integer) is
  'Records the fixed-fee PaymentIntent for a DRAFT no-bounty post as a requires_payment payments row with kind=listing_fee. SECURITY DEFINER, service-role only. Charge amount is server-authoritative (FEE_MISMATCH if p_amount_pence <> posts.listing_fee_pence; POST_NOT_DRAFT if the post is missing, not draft, or carries a bounty rather than a fee). IDEMPOTENT: a same-amount retry reuses the live row, a collected row is left untouched, and a live row at a different amount (the draft switched pricing mode) is superseded to failed so the new intent records cleanly. ON CONFLICT DO NOTHING on the unique intent id makes re-recording the same intent a no-op. The fee twin of record_post_payment_intent.';


-- =============================================================================
-- 8. FUNCTION: mark_listing_fee_collected(payment_intent_id)
-- =============================================================================
-- The fee-SUCCESS webhook handler. Atomically (a) advances the matched payments
-- row 'requires_payment' OR 'failed' -> 'collected' and (b) advances its post
-- 'draft' -> 'active' (live-on-payment, exactly as the bounty path does).
--
-- 'collected' is TERMINAL. Nothing in the system moves a payment out of it: the
-- fee is revenue on capture, is never escrowed and is never refunded (ADR-0014).
--
-- IDEMPOTENT + NEVER-REGRESS, for the same reasons as mark_post_payment_held:
--   * the payments update fires only from requires_payment/failed (the latter is
--     the decline-then-succeed recovery on a reused intent), so a redelivery is a
--     no-op;
--   * the posts update fires only while the post is still 'draft', so a late
--     delivery can never pull a recovered/cancelled post back to active;
--   * an UNKNOWN intent id is a benign no-op.
create or replace function public.mark_listing_fee_collected(
  p_payment_intent_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post_id uuid;
  v_kind    public.payment_kind;
  v_amount  integer;
  v_fee     integer;
begin
  select post_id, kind, amount_pence
    into v_post_id, v_kind, v_amount
  from public.payments
  where stripe_payment_intent_id = p_payment_intent_id
  for update;

  -- Benign no-op: a success webhook for an intent we never recorded.
  if not found then
    return;
  end if;

  -- SAFETY: refuse to collect a BOUNTY row. Escrow must reach 'held' so the
  -- payout and refund paths can find it; marking it 'collected' would make the
  -- owner's £50–£5,000 permanently invisible to every refund query — money
  -- silently kept. The paths must not cross, and this is where that is enforced
  -- on the capture side.
  if v_kind <> 'listing_fee' then
    return;
  end if;

  -- SAFETY: the row's kind is not enough. This function accepts a 'failed' row
  -- (the decline-then-succeed recovery), and a row is superseded to 'failed'
  -- when a DRAFT SWITCHES PRICING MODE — while create-payment-intent's cancel of
  -- the stale Stripe intent is best-effort and logs-and-continues on failure. So
  -- a stale £4.99 intent can succeed against a post now priced at £5,000, which
  -- would take the post LIVE advertising a bounty with no escrow behind it.
  -- Re-check the amount against the post's CURRENT price before advancing.
  --
  -- FOR UPDATE: the price must be read under lock. update_post_bounty locks the
  -- post row too, so without this a concurrent draft edit could land between
  -- this read and the status write below and re-open the very window this guard
  -- closes. A deadlock against the record_* lock order is benign — 40P01 is
  -- retryable and Stripe redelivers the event.
  select listing_fee_pence into v_fee
  from public.posts where id = v_post_id for update;

  if v_fee is null or v_fee is distinct from v_amount then
    -- ⚠️ MONEY: refusing here is correct, but the charge has ALREADY been
    -- captured — this is payment_intent.succeeded on an automatic-capture
    -- intent. The row stays 'failed', which every refund query ignores, so the
    -- money is stranded until a human reconciles it. Refuse LOUDLY: a silent
    -- return would lose a real payment with no trace anywhere.
    -- KNOWN RESIDUAL (ADR-0014): there is no operator queue to write this to
    -- yet, so a warning in the Postgres log is the whole alerting story.
    raise warning
      'STRANDED CAPTURE: listing-fee intent % captured % pence but post % is now priced at % — payment left ''failed'' and NOT collected. Reconcile by hand (refund at Stripe or re-point the post).',
      p_payment_intent_id, v_amount, v_post_id, coalesce(v_fee::text, 'a bounty');
    return;
  end if;

  update public.payments
     set status = 'collected'
   where stripe_payment_intent_id = p_payment_intent_id
     and status in ('requires_payment', 'failed');

  update public.posts
     set status = 'active'
   where id = v_post_id
     and status = 'draft';
end;
$$;

comment on function public.mark_listing_fee_collected(text) is
  'Listing-fee success webhook handler. SECURITY DEFINER, service-role only. Atomically advances the matched payment requires_payment/failed -> collected (a TERMINAL state — the fee is revenue on capture and is never refunded, ADR-0014) AND the post draft -> active (live-on-payment). REFUSES a kind=bounty_escrow row outright: marking escrow collected would hide the owner''s bounty from every refund query. IDEMPOTENT + never-regress: both updates are guarded so a duplicate or late webhook is a no-op. Unknown intent id = benign no-op. The fee twin of mark_post_payment_held.';


-- =============================================================================
-- 9. FUNCTION: mark_post_payment_succeeded(payment_intent_id)   (the dispatcher)
-- =============================================================================
-- The single entry point stripe-webhook now calls on payment_intent.succeeded.
-- Reads the ledger row's kind and delegates to the right handler.
--
-- WHY A SQL DISPATCHER RATHER THAN AN `if` IN THE WEBHOOK: the webhook would
-- have to SELECT the kind and then RPC on the result — a read-then-act pair with
-- a window between them. Here the read and the state transition happen inside one
-- function invocation, in one transaction, against a row the delegate locks.
--
-- An unknown intent id is a benign no-op, matching both delegates: a success
-- event for an intent we never recorded must not error the handler (the webhook
-- still records the event as processed).
create or replace function public.mark_post_payment_succeeded(
  p_payment_intent_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind public.payment_kind;
begin
  select kind into v_kind
  from public.payments
  where stripe_payment_intent_id = p_payment_intent_id;

  if not found then
    return;
  end if;

  if v_kind = 'listing_fee' then
    perform public.mark_listing_fee_collected(p_payment_intent_id);
  else
    perform public.mark_post_payment_held(p_payment_intent_id);
  end if;
end;
$$;

comment on function public.mark_post_payment_succeeded(text) is
  'Dispatcher for payment_intent.succeeded — the ONLY function stripe-webhook calls on that event. SECURITY DEFINER, service-role only. Reads payments.kind and delegates: listing_fee -> mark_listing_fee_collected, bounty_escrow -> mark_post_payment_held. Exists so the routing decision and the money transition happen in ONE call rather than a read-then-act pair in the Edge Function. Unknown intent id = benign no-op, matching both delegates. Both delegates remain idempotent and never-regress, so this is too.';


-- =============================================================================
-- 10. HARDENING: the bounty-escrow functions refuse a fee-priced post
-- =============================================================================
-- These two are redefined ONLY to add a guard. Every other line, guard, comment
-- and behaviour is as it was in 20260726100000 — the 11 checks in
-- post_payment_verification.sql must still pass verbatim.
--
-- WHY: without this, a bug (or a crafted call) in the charge path could open a
-- BOUNTY escrow row against a post whose bounty is NULL. record_post_payment_intent
-- would then compare p_amount_pence to a NULL bounty — and `is distinct from`
-- makes that a mismatch, so it happens to raise. "Happens to" is not a guard.
-- State it.
create or replace function public.record_post_payment_intent(
  p_post_id           uuid,
  p_payment_intent_id text,
  p_amount_pence      integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bounty integer;
  v_status public.post_status;
begin
  -- Lock the post row so concurrent intent-recording for the same post serialises
  -- (belt-and-braces against a double-charge race). Missing row -> NOT FOUND.
  select bounty_amount_pence, status
    into v_bounty, v_status
  from public.posts
  where id = p_post_id
  for update;

  -- Post must exist, still be a draft, AND be a BOUNTY-priced post. The last
  -- clause is new (ADR-0014): a no-bounty listing is charged through
  -- record_listing_fee_intent, and the two paths must never cross.
  if not found or v_status <> 'draft' or v_bounty is null then
    raise exception 'POST_NOT_DRAFT';
  end if;

  -- MONEY: the charge amount is server-authoritative. A caller-supplied amount
  -- that disagrees with the post's own bounty is rejected outright.
  if p_amount_pence is distinct from v_bounty then
    raise exception 'BOUNTY_MISMATCH';
  end if;

  -- Escrow already captured? A 'held' row shouldn't coexist with a draft post
  -- (mark_post_payment_held advances the post out of draft), but guard
  -- defensively: never open a second escrow row over a captured one.
  if exists (
    select 1 from public.payments where post_id = p_post_id and status = 'held'
  ) then
    return;
  end if;

  -- IDEMPOTENT reuse vs SUPERSEDE-on-edit:
  --   * a live 'requires_payment' row at the SAME amount is the in-flight intent
  --     — reuse it (a retry never opens a second escrow row for the same bounty);
  --   * a live 'requires_payment' row at a DIFFERENT amount means the bounty was
  --     edited since the last attempt — supersede it (-> 'failed') so the new,
  --     correctly-priced intent records cleanly instead of being dropped (which
  --     would leave a captured charge with no ledger row and the post stuck in
  --     draft). create-payment-intent cancels the superseded Stripe intent so no
  --     abandoned intent can later capture escrow at the stale amount.
  if exists (
    select 1 from public.payments
    where post_id = p_post_id
      and status = 'requires_payment'
      and amount_pence = p_amount_pence
  ) then
    return;
  end if;

  update public.payments
     set status = 'failed'
   where post_id = p_post_id
     and status = 'requires_payment'
     and amount_pence <> p_amount_pence;

  -- Insert the escrow ledger row. amount_pence = the authoritative bounty just
  -- validated. kind is stated explicitly rather than left to the column DEFAULT,
  -- so the two record_* functions read as mirror images of each other.
  insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence, kind)
  values (p_post_id, p_payment_intent_id, 'requires_payment', p_amount_pence, 'bounty_escrow')
  on conflict (stripe_payment_intent_id) do nothing;
end;
$$;

comment on function public.record_post_payment_intent(uuid, text, integer) is
  'Records the escrow PaymentIntent for a DRAFT BOUNTY-priced post as a requires_payment payments row with kind=bounty_escrow. SECURITY DEFINER, service-role only. Charge amount is server-authoritative (raises BOUNTY_MISMATCH if p_amount_pence <> posts.bounty_amount_pence; POST_NOT_DRAFT if the post is missing, not draft, or is a NO-BOUNTY listing — since 2026-08-20 those are charged via record_listing_fee_intent and the two paths must never cross). IDEMPOTENT + edit-safe: a same-amount retry reuses the live requires_payment row (and a held row is left untouched); a stale requires_payment row at a DIFFERENT amount (bounty edited) is superseded to failed so the new intent records cleanly. ON CONFLICT DO NOTHING on the unique intent id makes re-recording the same intent a no-op.';


-- mark_post_payment_held: same as 20260730100000 (draft -> ACTIVE), plus a
-- refusal to touch a listing_fee row. Symmetric with the refusal in
-- mark_listing_fee_collected — neither capture handler can act on the other's
-- rows, from either direction.
create or replace function public.mark_post_payment_held(
  p_payment_intent_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post_id uuid;
  v_kind    public.payment_kind;
  v_amount  integer;
  v_bounty  integer;
begin
  -- Lock the matched ledger row so the payment + post transition is atomic
  -- against a concurrent redelivery of the same event.
  select post_id, kind, amount_pence
    into v_post_id, v_kind, v_amount
  from public.payments
  where stripe_payment_intent_id = p_payment_intent_id
  for update;

  -- Benign no-op: a success webhook for an intent we never recorded.
  if not found then
    return;
  end if;

  -- SAFETY (ADR-0014): never put a listing fee into escrow. 'held' is what the
  -- refund and payout paths look for; a fee that reached it would become
  -- refundable money that was never meant to be refundable.
  if v_kind <> 'bounty_escrow' then
    return;
  end if;

  -- SAFETY: kind alone is not enough — see the mirror of this guard in
  -- mark_listing_fee_collected. This accepts a 'failed' row, and a row is
  -- superseded to 'failed' when a draft switches pricing mode, while the stale
  -- Stripe intent is only cancelled best-effort. Without this, a stale £5,000
  -- bounty intent succeeding after a switch to fee pricing would put REAL escrow
  -- against a post that publicly reads "No reward" — money nothing would ever
  -- refund, because cancel_fee_listing is the exit such a post takes.
  --
  -- FOR UPDATE for the same reason as the mirror: update_post_bounty locks the
  -- post, so an unlocked read here leaves a window for a concurrent draft edit.
  select bounty_amount_pence into v_bounty
  from public.posts where id = v_post_id for update;

  if v_bounty is null or v_bounty is distinct from v_amount then
    -- ⚠️ MONEY: same as the mirror — the charge is ALREADY captured, and a row
    -- left 'failed' is invisible to every refund query. Never refuse silently.
    raise warning
      'STRANDED CAPTURE: bounty intent % captured % pence but post % is now priced at % — escrow left ''failed'' and NOT held. Reconcile by hand (refund at Stripe or re-point the post).',
      p_payment_intent_id, v_amount, v_post_id, coalesce(v_bounty::text, 'a listing fee');
    return;
  end if;

  -- Advance escrow -> held from requires_payment OR failed. The 'failed' case is
  -- the decline-then-succeed recovery: one PaymentIntent is reused per post
  -- (create-payment-intent's idempotency key), so a declined attempt fires
  -- payment_failed (row -> 'failed') and a later successful attempt on the SAME
  -- intent fires succeeded — that must capture the escrow, not be skipped and
  -- leave the ledger 'failed' while the post advances. Still guarded so a
  -- duplicate 'held' or a later released/refunded state is NEVER regressed.
  update public.payments
     set status = 'held'
   where stripe_payment_intent_id = p_payment_intent_id
     and status in ('requires_payment', 'failed');

  -- Advance the post draft -> ACTIVE (live-on-payment, 20260730100000). Guarded
  -- on status='draft' so a duplicate/late delivery never pulls a later lifecycle
  -- state backwards.
  update public.posts
     set status = 'active'
   where id = v_post_id
     and status = 'draft';
end;
$$;

comment on function public.mark_post_payment_held(text) is
  'Escrow-success webhook handler. SECURITY DEFINER, service-role only. Atomically advances the matched payment requires_payment/failed -> held AND the post draft -> ACTIVE (live-on-payment). The failed->held path is the decline-then-succeed recovery on a reused PaymentIntent. REFUSES a kind=listing_fee row (2026-08-20, ADR-0014): a fee must never enter escrow, because held is exactly what the refund/payout paths search for. IDEMPOTENT + never-regress: both updates are guarded so a duplicate or late webhook is a no-op and can never pull a later payment (held/released/refunded) or post state backwards. Unknown intent id = benign no-op. Now reached via mark_post_payment_succeeded rather than called directly by the webhook.';


-- =============================================================================
-- 10a. HARDENING: mark_post_payment_refunded only closes a post it REFUNDED
-- =============================================================================
-- Redefined ONLY to add an early return. Everything else is as it was in
-- 20260729100000.
--
-- THE BUG THIS CLOSES: the payments update is guarded on `status = 'held'`, but
-- the posts update was guarded only on the post's own status — so the two could
-- disagree. Nothing refunded, post cancelled anyway.
--
-- Newly REACHABLE because listing fees exist. A fee row is `collected`, and a
-- goodwill refund of £4.99 issued by hand in the Stripe dashboard fires
-- `charge.refunded` at us. Before this, that silently took the owner's live
-- listing down while the ledger still read `collected` — no refund recorded,
-- Stripe and our ledger disagreeing, and the owner's car no longer being looked
-- for. Now the handler no-ops on any row that was not `held`, which is exactly
-- the set of rows this function is entitled to act on.
create or replace function public.mark_post_payment_refunded(
  p_payment_intent_id     text,
  p_refund_id             text,
  p_refunded_amount_pence integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post_id uuid;
  v_status  public.payment_status;
begin
  -- Lock the matched ledger row so the payment + post transition is atomic
  -- against a concurrent redelivery of the same event.
  select post_id, status
    into v_post_id, v_status
  from public.payments
  where stripe_payment_intent_id = p_payment_intent_id
  for update;

  -- Benign no-op: a refund webhook for an intent we never recorded.
  if not found then
    return;
  end if;

  -- MONEY: only a HELD escrow can be refunded. Anything else — an already
  -- refunded row, a released one, or a `collected` listing fee — means this
  -- event is not ours to act on, and cancelling the post below would close a
  -- listing whose money never moved. Checked ONCE here rather than left to the
  -- two updates independently, so the payment and the post can never disagree.
  if v_status <> 'held' then
    return;
  end if;

  -- Advance escrow held -> refunded, recording the refund id + amount. Still
  -- guarded on status='held' as well: the early return covers it, and a guard
  -- on a money write is not something to remove because it looks redundant.
  update public.payments
     set status                = 'refunded',
         stripe_refund_id      = p_refund_id,
         refunded_amount_pence = p_refunded_amount_pence
   where stripe_payment_intent_id = p_payment_intent_id
     and status = 'held';

  -- Advance the post -> cancelled, but ONLY from a refund-eligible paid state.
  -- Guarded so a duplicate/late delivery never pulls a later lifecycle state
  -- (recovery_claimed/recovered/...) backwards to cancelled.
  update public.posts
     set status = 'cancelled'
   where id = v_post_id
     and status in ('active', 'pending_verification');

  -- AUDIT: a money-state-transition audit-log insert belongs here once the
  -- audit_log table exists (SECURITY_AND_TRUST §7). Deferred with moderation.
end;
$$;

comment on function public.mark_post_payment_refunded(text, text, integer) is
  'Refund-confirmation handler (charge.refunded, and the deactivate/refund-recovery record step). SECURITY DEFINER, service-role only. Advances the matched payment held -> refunded and its post -> cancelled. RETURNS EARLY unless the row is `held` (2026-08-20): the posts update used to fire even when the payments update matched nothing, so a stray refund event — e.g. a goodwill Stripe-dashboard refund of a `collected` listing fee — silently cancelled a live listing with no refund recorded. IDEMPOTENT + never-regress: a duplicate or late delivery is a no-op and cannot pull a later lifecycle state backwards. Unknown intent id = benign no-op.';

revoke execute on function public.mark_post_payment_refunded(text, text, integer) from public, anon, authenticated;
grant  execute on function public.mark_post_payment_refunded(text, text, integer) to service_role;


-- =============================================================================
-- 10b. FUNCTION: cancel_fee_listing(post_id)   (owner takes a fee listing down)
-- =============================================================================
-- The no-refund counterpart of mark_post_payment_refunded. Moves a live NO-BOUNTY
-- post to 'cancelled' and touches NO money, because there is none to move: the
-- fee was revenue on capture and is not refundable (ADR-0014).
--
-- WHY A SEPARATE FUNCTION rather than a branch inside mark_post_payment_refunded:
-- that function's whole contract is "a refund happened, record it" — it takes a
-- refund id and an amount. Threading a no-refund case through it would mean
-- nullable refund arguments on the one function whose job is to prove money went
-- back, and every future reader would have to work out which calls really
-- refunded. Two functions, each of which does exactly one thing, is cheaper.
--
-- WHY NO REFUND HOLD / DISPUTE WINDOW: the ADR-0011 machinery exists to stop an
-- owner denying a spotter the bounty they earned. On a fee listing there is no
-- bounty, so there is nothing to deny and nothing for a spotter to dispute. The
-- listing simply comes down. This is a deliberate omission, not an oversight.
--
-- GUARDS:
--   * POST_NOT_REFUNDABLE — not a live post. Same code as the bounty path so the
--                           client's existing error mapping covers both.
--   * POST_HAS_BOUNTY     — a bounty post reached the no-refund exit. That would
--                           silently keep the owner's escrow, so it raises rather
--                           than proceeding.
-- IDEMPOTENT: the update is guarded on the live statuses, so a retry after a
-- dropped response updates 0 rows and returns cleanly.
create or replace function public.cancel_fee_listing(
  p_post_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fee    integer;
  v_bounty integer;
  v_status public.post_status;
begin
  select listing_fee_pence, bounty_amount_pence, status
    into v_fee, v_bounty, v_status
  from public.posts
  where id = p_post_id
  for update;

  if not found then
    raise exception 'POST_NOT_REFUNDABLE';
  end if;

  -- SAFETY: never let a BOUNTY post exit this way. This path issues no refund,
  -- so taking it with escrow held would keep the owner's £50–£5,000 with no
  -- refund and no record of one — the worst possible silent failure here.
  if v_bounty is not null or v_fee is null then
    raise exception 'POST_HAS_BOUNTY';
  end if;

  -- SAFETY: ...and the price columns are NOT sufficient to prove that. They
  -- describe what the post is priced at NOW; the money is in `payments`. A draft
  -- can carry a live bounty intent, be edited to no-reward, and have that stale
  -- intent capture afterwards if the best-effort Stripe cancel in
  -- create-payment-intent failed — leaving a fee-priced post with REAL escrow
  -- held against it. Cancelling that here would keep the owner's money.
  -- Ask the ledger, not the label.
  if exists (
    select 1 from public.payments
    where post_id = p_post_id and status = 'held'
  ) then
    raise exception 'POST_HAS_BOUNTY';
  end if;

  -- IDEMPOTENT: an already-closed post is a no-op, NOT an error. A retry after a
  -- dropped response must not tell the owner their takedown failed for a listing
  -- that is already down (deactivate-post maps a raise here to a 500). This
  -- returns rather than raising, which is what makes the header's idempotency
  -- claim true; POST_NOT_REFUNDABLE is reserved for a post that was never live.
  if v_status in ('cancelled', 'recovered', 'recovered_no_spotter', 'expired') then
    return;
  end if;

  if v_status not in ('active', 'pending_verification') then
    raise exception 'POST_NOT_REFUNDABLE';
  end if;

  -- posts.closed_at is maintained by the set_post_closed_at trigger on this
  -- transition (20260722100000); it is deliberately not written here.
  update public.posts
     set status = 'cancelled'
   where id = p_post_id
     and status in ('active', 'pending_verification');
end;
$$;

comment on function public.cancel_fee_listing(uuid) is
  'Takes a live NO-BOUNTY listing down: status -> cancelled, and NO money moves (ADR-0014 — the fixed listing fee is revenue on capture and is never refunded). SECURITY DEFINER, service-role only; called by deactivate-post for fee-priced posts, the no-refund counterpart of mark_post_payment_refunded. Raises POST_HAS_BOUNTY on a bounty-priced post AND on any post with a HELD payment — the price columns say what a post is priced at now, but the money is in the ledger, and a stale bounty intent can capture against a draft that has since switched to fee pricing. Taking this no-refund exit over real escrow would silently keep the owner''s money, so it asks the ledger too. POST_NOT_REFUNDABLE if the post is missing or was never live. Deliberately creates NO refund hold and opens NO dispute window: the ADR-0011 machinery exists to stop an owner denying an earned bounty, and there is no bounty here to deny. IDEMPOTENT: an already-closed post RETURNS rather than raising, so a retry after a dropped response is a no-op instead of a 500.';

revoke execute on function public.cancel_fee_listing(uuid) from public, anon, authenticated;
grant  execute on function public.cancel_fee_listing(uuid) to service_role;


-- =============================================================================
-- 10c. HARDENING: claim_credited_notification checks BEFORE it claims
-- =============================================================================
-- Redefined ONLY to move the amount lookup ABOVE the one-shot claim. Every
-- guard, every refusal shape and the copy are byte-identical to 20260804100000.
--
-- THE BUG THIS CLOSES: the conditional `update … credited_notified_at = now()`
-- IS the idempotency claim — it fires once, ever, per sighting. It ran BEFORE
-- the payment lookup, so any call that then failed to find a held/released
-- payment burned the claim and returned {claimed:false}. The push could never
-- be sent again, for that sighting, by anything.
--
-- Newly REACHABLE because of listing fees (ADR-0014): a fee post's payment is
-- `collected`, so it passes the post-status filter, burns the claim, and sends
-- nothing. RecoverPostScreen deliberately does not call this for a fee post for
-- exactly that reason — but "we remembered not to call it" is a convention, and
-- this makes it a property. When the non-money credited push is built, its claim
-- will still be there.
--
-- Order now: find the sighting -> resolve the amount -> ONLY THEN claim.
create or replace function public.claim_credited_notification(
  p_post_id uuid,
  p_actor   uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sighting_id uuid;
  v_spotter     uuid;
  v_bounty      integer;
  v_transfer    integer;
begin
  -- The credited sighting on a post the ACTOR owns. Status may be
  -- recovery_claimed (the normal moment) or recovered (a fast payout finished
  -- first) — both are legitimate times for the spotter to hear the news.
  select s.id, s.spotter_id
    into v_sighting_id, v_spotter
    from public.sightings s
    join public.posts p on p.id = s.post_id
   where s.post_id = p_post_id
     and s.status = 'credited'
     and p.owner_id = p_actor
     and p.status in ('recovery_claimed', 'recovered');

  if v_sighting_id is null then
    return jsonb_build_object('claimed', false);
  end if;

  -- MONEY: the spotter's share via payout_split — the one definition of the
  -- arithmetic. amount_pence is read whatever the payment status: held is the
  -- normal case, released means a fast payout beat the push.
  --
  -- MOVED ABOVE THE CLAIM (2026-08-20). A credit with no funded payment sends
  -- no push rather than inventing a number — and must not spend the one-shot
  -- claim doing so. A no-reward listing (ADR-0014) is exactly that case: its
  -- payment is `collected`, so it lands here and returns without burning
  -- anything, leaving the claim available to a future non-money push.
  select p.amount_pence into v_bounty
    from public.payments p
   where p.post_id = p_post_id
     and p.status in ('held', 'released')
   limit 1;

  if v_bounty is null then
    return jsonb_build_object('claimed', false);
  end if;

  select transfer_pence into v_transfer
    from public.payout_split(v_bounty);

  -- The conditional update IS the idempotency: of two concurrent calls,
  -- exactly one row comes back. Now the LAST gate rather than the first, so it
  -- is only ever spent on a call that can actually produce copy.
  update public.sightings
     set credited_notified_at = now()
   where id = v_sighting_id
     and credited_notified_at is null
  returning id into v_sighting_id;

  if v_sighting_id is null then
    return jsonb_build_object('claimed', false);
  end if;

  -- The COPY, built here so its privacy is DB-testable: an amount and an
  -- instruction. No car, no plate, no location, no owner name — the spotter
  -- knows which sighting was theirs, and the tap lands on /payouts where the
  -- context is money, not the vehicle.
  return jsonb_build_object(
    'claimed', true,
    'user_id', v_spotter,
    'post_id', p_post_id,
    'title', 'You''ve earned £' || to_char(v_transfer / 100.0, 'FM999990.00'),
    'body', 'Your sighting led to a recovery. Tell us where to send it.'
  );
end $$;

comment on function public.claim_credited_notification(uuid, uuid) is
  'One-shot claim for the credited-spotter push. Verifies the ACTOR owns the post and a credited sighting exists, resolves the amount from a held/released payment (payout_split — the one 95/5 definition), and ONLY THEN claims via the conditional update on sightings.credited_notified_at. The order matters (2026-08-20): the claim used to run first, so a call that found no funded payment burned it and sent nothing, permanently. A no-reward listing (ADR-0014) is exactly that case — its payment is `collected` — so it now returns without spending the claim, leaving it for a future non-money credited push. Every refusal returns the identical {claimed:false} — no oracle. SERVICE ROLE ONLY.';

revoke all on function public.claim_credited_notification(uuid, uuid) from public;
revoke all on function public.claim_credited_notification(uuid, uuid) from anon;
revoke all on function public.claim_credited_notification(uuid, uuid) from authenticated;
grant execute on function public.claim_credited_notification(uuid, uuid) to service_role;


-- =============================================================================
-- 11. FUNCTION: claim_recovery(...)   (REDEFINED — fee posts close immediately)
-- =============================================================================
-- CHANGE: a no-bounty post has no money leg, so there is no Edge Function coming
-- along afterwards to resolve it. It therefore lands DIRECTLY on its terminal
-- state and reports nextStep='done'.
--
-- WHY THIS IS NOT OPTIONAL: without it a fee post parks in 'recovery_claimed'
-- forever, waiting on a payout that will never be released. That state is
-- publicly hidden, blocks the owner from ever deleting their account
-- (DOMAIN.md "Account deletion" — deletion is blocked while a post is
-- active/pending_verification/recovery_claimed), and gives the owner no way out.
--
-- The bounty path is untouched: both of its answers still land on
-- 'recovery_claimed' with nextStep 'refund' | 'payout', because for a bounty post
-- the terminal state genuinely is the resolving Edge Function's to set.
create or replace function public.claim_recovery(
  p_post_id     uuid,
  p_sighting_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller     uuid := auth.uid();
  v_owner      uuid;
  v_status     public.post_status;
  v_spotter    uuid;
  v_sighting_post uuid;
  -- MONEY (ADR-0014): NULL bounty = a fee listing = nothing to release or refund.
  v_bounty     integer;
  v_next_step  text;
  v_new_status public.post_status;
begin
  if v_caller is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  -- Lock the post row for the duration. Without this, two taps of "I got it
  -- back" can both read `active` and both proceed; the unique index would stop
  -- a double CREDIT but not a double counter increment.
  select owner_id, status, bounty_amount_pence
    into v_owner, v_status, v_bounty
  from public.posts
  where id = p_post_id
  for update;

  if v_owner is null then
    raise exception 'POST_NOT_FOUND';
  end if;
  -- SAFETY: ownership from the JWT, never from an argument.
  if v_owner <> v_caller then
    raise exception 'NOT_OWNER';
  end if;
  -- SAFETY: `active` only. A draft has no payment to resolve; a cancelled or
  -- expired post has already refunded; an already-claimed post would
  -- double-credit. Deliberately NOT a "not closed" test — an allowlist of one.
  if v_status <> 'active' then
    raise exception 'POST_NOT_ACTIVE';
  end if;

  if p_sighting_id is not null then
    select spotter_id, post_id into v_spotter, v_sighting_post
    from public.sightings
    where id = p_sighting_id;

    if v_spotter is null then
      raise exception 'SIGHTING_NOT_FOUND';
    end if;
    -- SAFETY: a sighting on ANOTHER post must never be creditable — that would
    -- let an owner point their escrow at any sighting in the system.
    if v_sighting_post <> p_post_id then
      raise exception 'SIGHTING_NOT_ON_POST';
    end if;
    -- SAFETY: self-credit is a laundering round-trip — the owner would recover
    -- 95% of their own escrow and pay 5% for the privilege. Blocked here even
    -- though reporting a sighting on your own post is already blocked
    -- upstream: this is the money boundary, so it re-checks. Kept for fee posts
    -- too: there is no money to launder, but crediting yourself would still
    -- inflate your own recoveries_credited counter, and reputation is the thing
    -- a fee listing DOES pay out.
    if v_spotter = v_caller then
      raise exception 'CANNOT_CREDIT_OWN_SIGHTING';
    end if;

    update public.sightings
    set status = 'credited'
    where id = p_sighting_id;

    -- Reputation v1 (DOMAIN.md): server-maintained ONLY — clients hold no
    -- write grant on these columns. Mirrors mark_sighting_helpful. This runs
    -- for BOTH pricing modes: on a no-bounty listing the credit and the
    -- reputation bump ARE the spotter's whole reward (ADR-0014).
    update public.profiles
    set recoveries_credited = recoveries_credited + 1
    where id = v_spotter;
  end if;

  -- Where this post lands, and what the client must do next.
  --
  -- BOUNTY POST: 'recovery_claimed' for both answers. recovered /
  -- recovered_no_spotter are post-MONEY states and belong to the Edge Function
  -- that actually moves the money.
  --
  -- FEE POST: there is no money leg and no Edge Function to follow, so this IS
  -- the resolution — land on the terminal state directly. recovered when a
  -- spotter was credited, recovered_no_spotter when the owner found it another
  -- way, so both terminal states keep meaning exactly what they mean for a
  -- bounty post. posts.closed_at is maintained by the set_post_closed_at
  -- trigger on the status transition, so it needs no explicit write here.
  if v_bounty is null then
    v_new_status := case when p_sighting_id is null
                         then 'recovered_no_spotter'::public.post_status
                         else 'recovered'::public.post_status end;
    v_next_step  := 'done';
  else
    v_new_status := 'recovery_claimed'::public.post_status;
    v_next_step  := case when p_sighting_id is null then 'refund' else 'payout' end;
  end if;

  -- recovered_at is stamped now because it is when the CAR was recovered, which
  -- is what the 30-day public window and the feed's "Recently recovered" section
  -- date from — not when the transfer settles.
  update public.posts
  set status = v_new_status,
      recovered_at = now()
  where id = p_post_id;

  return jsonb_build_object(
    'postId', p_post_id,
    'creditedSightingId', p_sighting_id,
    -- What the client must do next. Named rather than inferred so the app never
    -- has to re-derive the money path from the status — which is also why a fee
    -- post reports 'done' instead of the client learning to check for a null
    -- bounty itself.
    'nextStep', v_next_step
  );
end $$;

comment on function public.claim_recovery(uuid, uuid) is
  'Owner marks their post recovered and credits one sighting or none. Moves no money. Owner-only, active-only, single-winner, no self-credit. BOUNTY POST: lands on recovery_claimed for both answers (recovered/recovered_no_spotter are post-money states set by the resolving Edge Function) and returns nextStep refund|payout. NO-BOUNTY POST (ADR-0014): there is no money leg and no Edge Function to follow, so it lands DIRECTLY on recovered (a sighting was credited) or recovered_no_spotter (found another way) and returns nextStep=done — without this a fee post would sit in recovery_claimed forever waiting on a payout that never comes, which also permanently blocks account deletion. The credited sighting and its recoveries_credited bump happen in BOTH modes: on a fee listing that reputation IS the spotter''s reward.';

-- Deny-by-default then grant. REVOKE FROM PUBLIC first: Postgres grants
-- EXECUTE to PUBLIC on new functions, which on Supabase reaches anon.
revoke all on function public.claim_recovery(uuid, uuid) from public;
revoke all on function public.claim_recovery(uuid, uuid) from anon;
grant execute on function public.claim_recovery(uuid, uuid) to authenticated, service_role;


-- =============================================================================
-- 12. GRANTS  (service-role only — mirrors the payments ledger)
-- =============================================================================
-- SAFETY: functions default to EXECUTE granted to PUBLIC, and this project's
-- ALTER DEFAULT PRIVILEGES additionally auto-grants EXECUTE to anon at CREATE
-- time. These are MONEY-STATE transitions called ONLY by the Edge Functions with
-- the service-role key, so close BOTH gaps: revoke from public (covers
-- authenticated, which only holds the PUBLIC grant) AND explicitly from anon,
-- then grant to service_role ONLY.
revoke execute on function public.record_listing_fee_intent(uuid, text, integer) from public, anon, authenticated;
grant  execute on function public.record_listing_fee_intent(uuid, text, integer) to service_role;

revoke execute on function public.mark_listing_fee_collected(text) from public, anon, authenticated;
grant  execute on function public.mark_listing_fee_collected(text) to service_role;

revoke execute on function public.mark_post_payment_succeeded(text) from public, anon, authenticated;
grant  execute on function public.mark_post_payment_succeeded(text) to service_role;

-- Re-assert on the two redefined functions: CREATE OR REPLACE re-runs the
-- default privileges, so a redefinition silently re-grants anon unless the
-- revoke is repeated here.
revoke execute on function public.record_post_payment_intent(uuid, text, integer) from public, anon, authenticated;
grant  execute on function public.record_post_payment_intent(uuid, text, integer) to service_role;

revoke execute on function public.mark_post_payment_held(text) from public, anon, authenticated;
grant  execute on function public.mark_post_payment_held(text) to service_role;


-- =============================================================================
-- END OF MIGRATION
-- =============================================================================

-- WHAT: A post may now carry NO bounty. Instead of the 5% cut of a reward, the
--       owner pays a flat £5 LISTING FEE. Two ways to list, side by side:
--         bounty listing — unchanged: £10–£5,000 escrowed, 95% to the winning
--           spotter on recovery, 5% ours, refunded (minus card cost) if the car
--           is never found.
--         free listing   — no reward at all, £5 charged once, NOT REFUNDABLE.
--
-- WHY:  Funding a bounty was the price of using the product at all. An owner
--       who did not want to offer a reward, or could not afford £10 on the day
--       their car was stolen, had no way in. Nothing about the rest of the
--       product needs a bounty to work — sightings, alerts, the timeline and
--       recovery all function without one; only the payout does.
--
-- ⚠️ THE DANGEROUS PART IS THE LEDGER, NOT THE PRICE.
--
--       `payments` is an ESCROW ledger. Every refund and payout path in the
--       system finds its rows the same way — by status:
--
--         functions/_shared/refundEscrow.ts        .eq('status','held')
--         functions/deactivate-post/index.ts       owner cancels -> refund
--         functions/release-held-refunds/index.ts  the HOURLY CRON -> refund
--         functions/release-payout/index.ts        95% -> the winning spotter
--
--       A £5 listing fee written into that ledger as an ordinary `held` row is
--       therefore refunded automatically, by a cron, days later, with nobody
--       watching — and `release-payout` could try to transfer 95% of it to a
--       spotter. Neither failure is visible until the money has already moved.
--
--       So the row is DISCRIMINATED here, in the schema, rather than by each
--       caller remembering. `payments.kind` is NOT NULL with a default, so
--       every existing row keeps exactly the meaning it had, and the four
--       selectors above are narrowed to `bounty_escrow` in the same change.
--
-- ⚠️ AND THE CHECK IS CONDITIONAL, NOT WIDENED. £5 is BELOW the £10 bounty
--       floor. Relaxing `amount_pence`'s range to let the fee in would also let
--       a £5 ESCROW row in — a bounty below the floor every other layer
--       enforces. The range is split by `kind` instead: escrow keeps
--       1000–500000, a fee is exactly 500. DOMAIN.md's "Bounty rules" records
--       that the last floor change had to move ~10 restatements and shipped one
--       that rejected every lawful £10 post; adding a bound is the cheap shape,
--       moving one is not.
--
-- LINKS: docs/DOMAIN.md (Bounty rules; Money & fees);
--        src/shared/lib/money.ts (LISTING_FEE_PENCE — the client mirror);
--        supabase/functions/create-payment-intent/index.ts (charges it);
--        supabase/tests/listing_fee_verification.sql (proves the four
--          selectors exclude it).

begin;

-- ---------------------------------------------------------------------------
-- 1. What kind of money a payments row is.
-- ---------------------------------------------------------------------------
create type public.payment_kind as enum (
  'bounty_escrow',  -- held for a spotter; refundable; 95/5 on release
  'listing_fee'     -- ours on capture; never refunded; no payout leg
);

comment on type public.payment_kind is
  'MONEY: which lifecycle a payments row follows. bounty_escrow is held for a winning spotter and refunded if there is none. listing_fee is revenue on capture: never refunded, never transferred, no payout leg. Every refund/payout selector filters on this — a fee row reached by an escrow path is money moving that should not.';

-- DEFAULT + NOT NULL, in that order, so every pre-existing row is backfilled as
-- what it actually is: escrow. There is no other lawful reading of a row that
-- existed before free listings did.
alter table public.payments
  add column kind public.payment_kind not null default 'bounty_escrow';

comment on column public.payments.kind is
  'MONEY: bounty_escrow (held for a spotter, refundable, 95/5 on release) or listing_fee (£5, ours on capture, never refunded, no payout leg). Backfilled to bounty_escrow — every row predating free listings is escrow by definition.';

-- ---------------------------------------------------------------------------
-- 2. The amount CHECK, split by kind.
-- ---------------------------------------------------------------------------
-- Escrow keeps the range every other layer enforces. A fee is exactly 500 —
-- not "<= 500", not a range: there is one price, and a fee row carrying any
-- other number is a bug we want to fail on write rather than discover in a
-- reconciliation.
alter table public.payments
  drop constraint if exists payments_amount_pence_check;

alter table public.payments
  add constraint payments_amount_pence_check check (
    case kind
      when 'bounty_escrow' then amount_pence between 1000 and 500000
      when 'listing_fee'   then amount_pence = 500
    end
  );

comment on column public.payments.amount_pence is
  'MONEY: integer pence, GBP. For bounty_escrow, the full bounty charged to escrow (1000-500000, mirroring posts.bounty_amount_pence). For listing_fee, exactly 500 — the flat £5. The CHECK is conditional on kind so a £5 ESCROW row stays impossible: £5 is below the bounty floor.';

-- ---------------------------------------------------------------------------
-- 3. A post may have no bounty.
-- ---------------------------------------------------------------------------
-- NULL, not 0. Zero is a number and would flow through every sum, min and
-- comparison as one — a "£0 bounty" that sorts, filters and renders. NULL is
-- the absence of a reward, which is what a free listing actually is, and it
-- drops out of aggregates rather than dragging them down.
alter table public.posts
  alter column bounty_amount_pence drop not null;

alter table public.posts
  drop constraint if exists posts_bounty_amount_pence_check;

alter table public.posts
  add constraint posts_bounty_amount_pence_check check (
    bounty_amount_pence is null
    or bounty_amount_pence between 1000 and 500000
  );

comment on column public.posts.bounty_amount_pence is
  'MONEY: integer pence, GBP, £10-£5000 — or NULL for a FREE LISTING, which offers no reward and was paid for with a flat listing fee instead (payments.kind = listing_fee). NULL rather than 0 so an absent reward can never be read, summed or sorted as a zero one.';

-- ---------------------------------------------------------------------------
-- 4. create_post — verbatim from 20260813120000 but for the bounty guard.
-- ---------------------------------------------------------------------------
-- Two changes only, both saying the same thing: a NULL bounty is lawful now.
--   * it leaves the MISSING_REQUIRED list;
--   * BOUNTY_OUT_OF_RANGE applies only when an amount was actually given.
--
-- Everything else — the plate gates, the photo-URL regex, the V5C path check,
-- the distinctive-feature validation, status=draft, expires_at — is copied
-- UNCHANGED, because `create or replace` replaces: anything omitted here is
-- deleted from the database rather than inherited.
--
-- ⚠️ THE FEE IS NOT CHARGED HERE. create_post only ever makes a DRAFT; money
-- happens later and server-side, in create-payment-intent, which reads the
-- post to decide bounty-or-fee. That split predates this change.

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
  -- SAFETY (this migration): the coarse alert-facing label. Trimmed; '' -> NULL
  -- so the push falls back to 'your area' rather than emitting "near ".
  v_locality    text := nullif(btrim(p_last_seen_locality), '');
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
  if p_make is null or p_model is null or p_colour is null
     or p_last_seen_at is null
     or p_last_seen_lat is null or p_last_seen_lng is null
     then
    raise exception 'MISSING_REQUIRED';
  end if;

  -- --- MONEY: bounty range, WHEN THERE IS ONE ---------------------------------
  -- NULL is now lawful and means a FREE LISTING: no reward, and the owner pays a
  -- flat listing fee instead of the 5% cut. The range itself is untouched — this
  -- migration adds a case rather than moving the floor, which DOMAIN.md records
  -- as the expensive shape.
  if p_bounty_amount_pence is not null
     and (p_bounty_amount_pence < 1000 or p_bounty_amount_pence > 500000) then
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
    bounty_amount_pence, status, expires_at
  )
  values (
    v_owner, v_plate, p_make, p_model, p_colour,
    p_year, p_body_type, p_distinguishing_features, p_owner_note,
    p_desc_recognise, p_desc_drives, p_stolen_from, p_keys_taken,
    p_last_seen_at,
    ST_SetSRID(ST_MakePoint(p_last_seen_lng, p_last_seen_lat), 4326)::geography,
    p_last_seen_area,
    v_locality,
    p_bounty_amount_pence, 'draft', now() + interval '90 days'
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
  text, text, text, text, int, text, text, text, text, text, text, text,
  timestamptz, double precision, double precision, text, int, text[], text[], text, jsonb, text
) is
  'The write boundary for the post-a-car wizard. SECURITY DEFINER: pins owner_id to the caller, HARD-CODES status=draft, sets expires_at=now()+90d, and atomically inserts the post + photos + feature tags + verification-doc row + distinctive features. Re-validates plate (optional/format/one-active-per-plate), 3-6 photos, own-folder photo/V5C paths, the stolen_from/keys_taken enums, and up to 8 distinctive features (each: 3-80-char trimmed description + own-folder photo URL). MONEY (20260819100000): p_bounty_amount_pence is now OPTIONAL - NULL means a FREE LISTING, which offers no reward and is paid for with a flat listing fee instead; when a bounty IS given it is still re-validated at 1000-500000 pence. p_last_seen_locality is the COARSE district/city label the spotter-alert push reads. Never writes alerts_sent_at (service-role claim). Raises: NOT_AUTHENTICATED, INVALID_PLATE, PLATE_IN_USE, MISSING_REQUIRED, BOUNTY_OUT_OF_RANGE, PHOTO_COUNT, INVALID_PHOTO_URL, INVALID_VERIFICATION_PATH, DISTINCTIVE_FEATURES_COUNT, INVALID_DISTINCTIVE_FEATURE, INVALID_DISTINCTIVE_PHOTO_URL, INVALID_STOLEN_FROM, INVALID_KEYS_TAKEN. Only ever creates drafts; payment success advances the lifecycle later, server-side.';

-- ---------------------------------------------------------------------------
-- 5. record_post_payment_intent — teach the ledger about the second price.
-- ---------------------------------------------------------------------------
-- ⚠️ THIS GUARD ALREADY CAUGHT THE CHANGE, which is what it is for. The old
-- body raised BOUNTY_MISMATCH whenever `p_amount_pence is distinct from
-- v_bounty` — and on a free listing v_bounty is NULL while the charge is 500,
-- so every free listing would have failed here rather than quietly charging the
-- wrong money. The rule is not being relaxed; it is being stated for both
-- prices:
--
--   bounty listing (v_bounty is not null) -> the amount must equal the bounty
--   free listing   (v_bounty is null)     -> the amount must equal the fee
--
-- Either way the amount is still checked against the POST, never accepted from
-- the caller, and `kind` is derived from the same branch — so the ledger row's
-- lifecycle and its price can never disagree about which kind of money it is.

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
  v_kind   public.payment_kind;
  -- MONEY: the flat listing fee, in pence. Mirrors LISTING_FEE_PENCE in
  -- src/shared/lib/money.ts and payments_amount_pence_check's 500.
  c_listing_fee constant integer := 500;
begin
  -- Lock the post row so concurrent intent-recording for the same post serialises
  -- (belt-and-braces against a double-charge race). Missing row -> NOT FOUND.
  select bounty_amount_pence, status
    into v_bounty, v_status
  from public.posts
  where id = p_post_id
  for update;

  -- Post must exist AND still be a draft.
  if not found or v_status <> 'draft' then
    raise exception 'POST_NOT_DRAFT';
  end if;

  -- MONEY: the charge amount is server-authoritative, for both prices. A
  -- caller-supplied amount that disagrees with what the POST owes is rejected
  -- outright — a free listing cannot be charged a bounty, and a bounty listing
  -- cannot be settled for £5.
  if v_bounty is null then
    v_kind := 'listing_fee';
    if p_amount_pence is distinct from c_listing_fee then
      raise exception 'BOUNTY_MISMATCH';
    end if;
  else
    v_kind := 'bounty_escrow';
    if p_amount_pence is distinct from v_bounty then
      raise exception 'BOUNTY_MISMATCH';
    end if;
  end if;

  -- Escrow already captured? A 'held' row shouldn't coexist with a draft post
  -- (mark_post_payment_held advances the post out of draft), but guard
  -- defensively: never open a second charge row over a captured one.
  if exists (
    select 1 from public.payments where post_id = p_post_id and status = 'held'
  ) then
    return;
  end if;

  -- IDEMPOTENT reuse vs SUPERSEDE-on-edit:
  --   * a live 'requires_payment' row at the SAME amount is the in-flight intent
  --     — reuse it (a retry never opens a second charge row for the same price);
  --   * a live 'requires_payment' row at a DIFFERENT amount means the bounty was
  --     edited since the last attempt — supersede it (-> 'failed') so the new,
  --     correctly-priced intent records cleanly instead of being dropped (which
  --     would leave a captured charge with no ledger row and the post stuck in
  --     draft). create-payment-intent cancels the superseded Stripe intent so no
  --     abandoned intent can later capture at the stale amount.
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

  -- Insert the ledger row. amount_pence = the authoritative price just
  -- validated; kind = which lifecycle it follows, from the same branch. ON
  -- CONFLICT on the unique stripe_payment_intent_id makes a re-record of the
  -- SAME intent a no-op (double-safe with the reuse guard).
  insert into public.payments (post_id, stripe_payment_intent_id, status, amount_pence, kind)
  values (p_post_id, p_payment_intent_id, 'requires_payment', p_amount_pence, v_kind)
  on conflict (stripe_payment_intent_id) do nothing;
end;
$$;

comment on function public.record_post_payment_intent(uuid, text, integer) is
  'Records the PaymentIntent for a DRAFT post as a requires_payment payments row. SECURITY DEFINER, service-role only. MONEY (20260819100000): serves BOTH prices — a post with a bounty owes exactly that bounty (kind=bounty_escrow); a post with a NULL bounty is a free listing and owes exactly the flat 500p listing fee (kind=listing_fee). Either way the amount is server-authoritative and raises BOUNTY_MISMATCH when it disagrees with what the post owes, POST_NOT_DRAFT if the post is missing/not draft. IDEMPOTENT + edit-safe: a same-amount retry reuses the live requires_payment row (and a held row is left untouched); a stale requires_payment row at a DIFFERENT amount is superseded to failed so the new intent records cleanly. ON CONFLICT DO NOTHING on the unique intent id makes re-recording the same intent a no-op.';

commit;

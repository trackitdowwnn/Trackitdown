-- =============================================================================
-- WHAT:  Make the number plate OPTIONAL in create_post. A car can now be
--        reported without a plate (owner doesn't have it) — make/model/colour
--        become the identity instead. When a plate IS given it's still format-
--        validated and uniqueness-checked exactly as before.
-- WHY:   Product decision: some owners don't know / no longer have the plate
--        (e.g. the thief swapped it). posts.plate was already nullable (designed
--        for bare drafts); this lets create_post honour that. Change:
--          * blank/missing plate  -> stored NULL, and the INVALID_PLATE format
--            gate + the PLATE_IN_USE uniqueness gate are SKIPPED.
--          * non-blank plate      -> unchanged: format gate + one-active-post-
--            per-plate uniqueness still enforced (SECURITY_AND_TRUST §2).
--        make/model/colour stay REQUIRED (the MISSING_REQUIRED gate below), so a
--        plate-less post always has a human-readable identity. Uniqueness can't
--        apply without a plate, so duplicate plate-less reports are possible —
--        the mandatory moderation/V5C step is the backstop (as it is for fakes).
--
--        Everything else in create_post is byte-for-byte 20260713192000: the
--        own-folder photo-URL validation, the V5C path check, required-fields,
--        bounty range, photo count, enum checks, and the atomic assembly. Only
--        the plate handling (lines marked "OPTIONAL PLATE") changed.
-- LINKS: supabase/migrations/20260713192000_create_post_validate_paths.sql
--          (prior version); supabase/migrations/20260707110712_payments_foundation.sql
--          (plate column is nullable by design); docs/DOMAIN.md (plate now
--          optional); docs/SECURITY_AND_TRUST.md §2 (one active post per plate —
--          applies only when a plate is present).
--
-- SAFETY NOTE ON DESTRUCTIVE STATEMENTS: NONE. One forward CREATE OR REPLACE
--        (identical signature; only the plate gate is conditionalised + NULL
--        storage). Grants preserved; deny-anon re-asserted at the end.
-- =============================================================================

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
  p_verification_path       text
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
begin
  if v_owner is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  -- --- OPTIONAL PLATE: normalise; NULL when blank -----------------------------
  -- nullif(...,'') so a blank plate is stored as SQL NULL (not '') — that keeps
  -- it out of the canon-'' bucket and lets many plate-less posts coexist.
  v_plate       := nullif(upper(trim(coalesce(p_plate, ''))), '');
  v_plate_canon := upper(regexp_replace(coalesce(p_plate, ''), '[^A-Za-z0-9]', '', 'g'));

  -- Format + uniqueness gates apply ONLY when a plate was actually provided.
  if v_plate_canon <> '' then
    -- Plate FORMAT gate (not DVLA validation).
    if v_plate_canon !~ '^[A-Z0-9]{2,8}$' then
      raise exception 'INVALID_PLATE';
    end if;

    -- Plate UNIQUENESS (SECURITY_AND_TRUST §2 — one active post per plate).
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
     or p_bounty_amount_pence is null then
    raise exception 'MISSING_REQUIRED';
  end if;

  -- --- MONEY: bounty range ----------------------------------------------------
  if p_bounty_amount_pence < 5000 or p_bounty_amount_pence > 500000 then
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
  -- v_plate is NULL for a plate-less post (OPTIONAL PLATE).
  insert into public.posts (
    owner_id, plate, make, model, colour,
    year, body_type, distinguishing_features, owner_note,
    desc_recognise, desc_drives, stolen_from, keys_taken,
    last_seen_at, last_seen_location, last_seen_area,
    bounty_amount_pence, status, expires_at
  )
  values (
    v_owner, v_plate, p_make, p_model, p_colour,
    p_year, p_body_type, p_distinguishing_features, p_owner_note,
    p_desc_recognise, p_desc_drives, p_stolen_from, p_keys_taken,
    p_last_seen_at,
    ST_SetSRID(ST_MakePoint(p_last_seen_lng, p_last_seen_lat), 4326)::geography,
    p_last_seen_area,
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

  return jsonb_build_object('post_id', v_post_id, 'status', 'draft');
end;
$$;

-- Grants preserved by CREATE OR REPLACE; re-assert deny-anon (Supabase default
-- privileges re-grant anon on the recreated function).
revoke execute on function public.create_post(
  text, text, text, text, int, text, text, text, text, text, text, text,
  timestamptz, double precision, double precision, text, int, text[], text[], text
) from anon;

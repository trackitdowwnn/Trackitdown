-- =============================================================================
-- WHAT:  Fix a validation hole introduced by 20260713194000 (optional plate):
--        a plate that is non-blank but canonicalises to EMPTY (punctuation-only
--        like '--', or non-ASCII homoglyphs like Cyrillic 'АВСDЕ', or emoji) was
--        stored VERBATIM as a fake plate — it skipped the format + uniqueness
--        gates (both keyed on the empty canon) yet nullif(trim(...)) kept it
--        non-null. It then rendered via PlateChip and, canon-'', silently
--        defeated one-active-post-per-plate.
-- WHY:   Storage must agree with the gate decision: if the canon is empty the
--        input is NOT a plate, so store NULL (a genuine plate-less post). This
--        also re-bounds posts.plate — a non-null plate has necessarily passed
--        the {2,8} format gate below, so the unbounded-junk path is closed too.
--        Everything else is byte-for-byte 20260713194000; only the v_plate
--        derivation (marked FIX) changed.
-- LINKS: supabase/migrations/20260713194000_create_post_optional_plate.sql
--          (introduced the hole); docs/SECURITY_AND_TRUST.md §2 (one active
--          post per plate); found in code + security review.
--
-- SAFETY NOTE ON DESTRUCTIVE STATEMENTS: NONE. One forward CREATE OR REPLACE
--        (identical signature). Grants preserved; deny-anon re-asserted.
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

revoke execute on function public.create_post(
  text, text, text, text, int, text, text, text, text, text, text, text,
  timestamptz, double precision, double precision, text, int, text[], text[], text
) from anon;

-- =============================================================================
-- WHAT:  Harden create_post: server-side validate the client-supplied photo
--        URLs and the V5C storage path so neither can point outside the caller's
--        own Storage folder / our Storage host.
-- WHY:   20260713190000's create_post stored p_photo_urls and p_verification_path
--        verbatim. Two gaps (found in security review):
--          1. p_photo_urls became post_photos.url rows served as public <img>
--             sources once a post activates (later feature). A crafted RPC call
--             (bypassing the app) could store an ATTACKER-hosted URL and harvest
--             the IP / coarse location of every spotter who views the post — a
--             viewer-tracking bypass of the anti-stalking model that otherwise
--             hides owner_id and coarsens driveway locations.
--          2. p_verification_path became a verification_documents.storage_path
--             pointing anywhere — a post's proof-of-ownership row could reference
--             ANOTHER user's folder namespace, which the moderator queue will
--             later trust.
--        FIX: each photo URL must match our Storage public-object URL for the
--        post-photos bucket UNDER THE CALLER'S OWN FOLDER (host pinned to
--        *.supabase.co or localhost so an arbitrary host is rejected), length-
--        bounded; the V5C path's first segment must equal the caller's uid.
--        New raises: INVALID_PHOTO_URL, INVALID_VERIFICATION_PATH.
--
--        NOTE (EXIF): post photos are re-encoded to JPEG client-side (postApi
--        toJpegBytes), which strips EXIF; with photos now pinned to our own
--        bucket a self-hosted GPS-bearing image can no longer be injected.
--        Server-side EXIF stripping (SECURITY_AND_TRUST §3) remains a tracked,
--        cross-cutting gap (avatars too) for the media-hardening pass — NOT here.
-- LINKS: supabase/migrations/20260713190000_post_a_car.sql (original create_post);
--        src/features/vehicles/post/api/postApi.ts (produces the own-folder
--          URLs/paths these checks accept); docs/SECURITY_AND_TRUST.md §2/§3/§6.
--
-- SAFETY NOTE ON DESTRUCTIVE STATEMENTS: NONE. One forward CREATE OR REPLACE of
--        create_post (identical signature; only added input validation). No
--        drop/rename; grants preserved (deny-anon from …191000 still holds).
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
  -- SAFETY: a photo URL must be OUR Storage public object for the post-photos
  -- bucket, under the caller's OWN folder. Host is pinned to *.supabase.co or
  -- localhost so an attacker-hosted look-alike path is rejected; the folder
  -- segment is the caller's uid; the object is a single trailing segment.
  v_photo_url_re text := '^https?://(127\.0\.0\.1(:[0-9]+)?|[a-z0-9-]+\.supabase\.co)'
                         || '/storage/v1/object/public/post-photos/'
                         || v_owner::text || '/[^/]+$';
begin
  if v_owner is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  -- --- Plate FORMAT gate (not DVLA validation) --------------------------------
  v_plate       := upper(trim(coalesce(p_plate, '')));
  v_plate_canon := upper(regexp_replace(coalesce(p_plate, ''), '[^A-Za-z0-9]', '', 'g'));
  if v_plate_canon !~ '^[A-Z0-9]{2,8}$' then
    raise exception 'INVALID_PLATE';
  end if;

  -- --- Plate UNIQUENESS (SECURITY_AND_TRUST §2 — one active post per plate) ----
  if exists (
    select 1
    from public.posts p
    where upper(regexp_replace(coalesce(p.plate, ''), '[^A-Za-z0-9]', '', 'g')) = v_plate_canon
      and p.status in ('active', 'pending_verification', 'recovery_claimed')
  ) then
    raise exception 'PLATE_IN_USE';
  end if;

  -- --- Required fields --------------------------------------------------------
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
  -- Rejects arbitrary/attacker-hosted URLs that would otherwise be served as
  -- public <img> sources and used to track spotters who view the post.
  foreach v_url in array p_photo_urls loop
    if v_url is null or char_length(v_url) > 500 or v_url !~ v_photo_url_re then
      raise exception 'INVALID_PHOTO_URL';
    end if;
  end loop;

  -- --- SAFETY: the V5C path must be under the caller's own folder -------------
  -- The storage.objects RLS already forces the UPLOAD own-folder, but the RPC
  -- must not record a path pointing at another user's namespace on this post.
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

-- CREATE OR REPLACE preserves grants (authenticated + service_role; anon revoked
-- in …191000). Re-assert deny-anon so this migration is correct standalone.
revoke execute on function public.create_post(
  text, text, text, text, int, text, text, text, text, text, text, text,
  timestamptz, double precision, double precision, text, int, text[], text[], text
) from anon;

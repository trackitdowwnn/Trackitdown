-- =============================================================================
-- WHAT: Closes the last six database leads from security audit run 1:
--
--   9.  Sighting photos with no sighting row outlived the spotter's account.
--   10. A bug-report screenshot path like '<uid>/../<victim>/x.jpg' passed the
--       prefix check, and the service role then SIGNED it — in the operator's
--       email and in the reporter's own "Download your data" export.
--   11. Every reward change re-cancelled every earlier intent at Stripe.
--   13. Photo URLs were accepted from ANY *.supabase.co project.
--   15. Signing out deleted the push token row, so the next account to sign in
--       on that phone left no shared-device edge.
--   17. Uploads to post-photos that no row ever named stayed forever.
--
-- HOW, per lead:
--   10. is_clean_storage_path: own folder first, and no '.', '..', empty
--       segment, '\', '%', '?', '#' or control character anywhere. Used by
--       submit_bug_report, and by create_post / update_post_verification
--       (latent there: nothing signs those paths for anyone else today).
--       Production held no such path (checked 2026-10-26).
--   13. post_photo_url_re: THIS project's storage origin (or the local
--       stack's), the caller's own folder, and a plain file name. All five
--       photo writers use it. Every production photo URL matched (2026-10-26).
--   11. payments.stripe_intent_cancelled_at: create-payment-intent stamps a
--       row once Stripe has cancelled its intent, and never asks again.
--   15. push_token_releases: the last owner of a token that was signed out
--       (hashed, like device_links). register_push_token treats it as the
--       previous owner, so a different account on that phone still records
--       the edge. Purged after 270 days, as push tokens are.
--   9 + 17. enqueue_unreferenced_uploads: hourly, an object older than 48
--       hours, in the app's own naming, that no row names and no queue holds,
--       joins the existing orphan queue. The existing drain re-checks every
--       reference at claim time and removes it through the Storage API.
--       (delete-account also now sweeps a spotter's sighting-photos at once.)
--       First run, approved by the owner 2026-10-26: 64 abandoned post-photo
--       uploads from 25 Jul–16 Aug and 1 sighting photo of a deleted account.
--
-- ⚠️ NEXT EDITOR: the live definitions of every function restated below are
--    THIS file — each verbatim from its previous latest definition
--    (md5-checked against production 2026-10-26), plus the marked edits.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Lead 13 — the one rule for a post-photos URL.
-- -----------------------------------------------------------------------------
create or replace function public.post_photo_url_re(p_owner uuid)
returns text
language sql
immutable
set search_path = ''
as $$
  -- Production's own storage origin, or the local stack's (CI). A custom
  -- domain for the project would be added HERE, nowhere else.
  select '^(https://lbbbxelbembseohxjhkv\.supabase\.co|http://127\.0\.0\.1:54321)'
         || '/storage/v1/object/public/post-photos/'
         || p_owner::text || '/[A-Za-z0-9_-]+\.(jpg|jpeg|png|webp)$';
$$;

comment on function public.post_photo_url_re(uuid) is
  'The regex every post-photos URL must match: this project''s storage origin (or the local stack), the owner''s own folder, a plain file name. Security audit lead 13, 20261026160000.';

revoke all on function public.post_photo_url_re(uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Lead 10 — a storage path inside the caller's own folder, and nothing else.
-- -----------------------------------------------------------------------------
create or replace function public.is_clean_storage_path(p_path text, p_owner uuid)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_path is not null
     and split_part(p_path, '/', 1) = p_owner::text
     and position('/' in p_path) > 0
     and p_path !~ '(^|/)\.{1,2}(/|$)'   -- no '.' or '..' segment
     and p_path !~ '//'                   -- no empty segment
     and p_path !~ '/$'
     and p_path !~ '[\\%?#[:cntrl:]]';
$$;

comment on function public.is_clean_storage_path(text, uuid) is
  'True when a storage path starts with the owner''s folder and holds no dot segment, empty segment, backslash, percent-escape, query/fragment or control character — the forms a signer might resolve outside that folder. Security audit lead 10, 20261026160000.';

revoke all on function public.is_clean_storage_path(text, uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Lead 11 — an intent Stripe has already cancelled is never cancelled again.
-- -----------------------------------------------------------------------------
alter table public.payments
  add column stripe_intent_cancelled_at timestamptz;

comment on column public.payments.stripe_intent_cancelled_at is
  'When create-payment-intent had Stripe cancel this row''s intent (an abandoned reward-change attempt). Rows with it set are never sent to Stripe again. 20261026160000.';

-- -----------------------------------------------------------------------------
-- Lead 15 — who last held a signed-out push token.
-- -----------------------------------------------------------------------------
create table public.push_token_releases (
  -- sha256 of the token, hex — the same form device_links stores, so a live
  -- push credential is never kept once it is released.
  token_hash  text primary key,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  released_at timestamptz not null default now()
);

comment on table public.push_token_releases is
  'The last account that signed a device out (unregister_push_token / forget_my_push_tokens). register_push_token reads it as the previous owner, so a DIFFERENT account signing in on that phone still records a device_links edge. Service role only; purged after 270 days with push tokens. 20261026160000.';

alter table public.push_token_releases enable row level security;
revoke all on public.push_token_releases from anon, authenticated;
grant select, insert, update, delete on public.push_token_releases to service_role;

-- -----------------------------------------------------------------------------
-- Leads 9 + 17 — objects nothing names join the orphan queues.
-- -----------------------------------------------------------------------------
create or replace function public.enqueue_unreferenced_uploads(p_limit integer default 200)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 200), 1), 1000);
  v_post  integer;
  v_sight integer;
begin
  -- post-photos. ⚠️ This starts from the OBJECT and asks whether anything
  -- names it, so a mismatch deletes a live photo. Hence: only the app's own
  -- naming ('<uid>/[mark-]<hash>-<n>.jpg' — never demo or hand-made files),
  -- 48 hours old by its LAST write (a retry re-uploads in place), and
  -- unreferenced by BOTH tests — the drain's own helper and a plain suffix
  -- match across the four photo tables.
  insert into public.orphaned_photos (path)
  select o.name
    from storage.objects o
   where o.bucket_id = 'post-photos'
     and o.name ~ '^[0-9a-f-]{36}/(mark-)?[0-9a-z]+-[0-9]+\.jpg$'
     and greatest(o.created_at, coalesce(o.updated_at, o.created_at)) < now() - interval '48 hours'
     and not exists (select 1 from public.orphaned_photos q where q.path = o.name)
     and not exists (select 1 from public.post_photos t where t.url like '%/post-photos/' || o.name)
     and not exists (select 1 from public.vehicle_photos t where t.url like '%/post-photos/' || o.name)
     and not exists (select 1 from public.post_distinctive_feature t where t.photo_url like '%/post-photos/' || o.name)
     and not exists (select 1 from public.vehicle_distinctive_feature t where t.photo_url like '%/post-photos/' || o.name)
     and not public.orphaned_photo_still_referenced(o.name)
   limit v_limit
  on conflict (path) do nothing;
  get diagnostics v_post = row_count;

  -- sighting-photos: paths are pinned per sighting and stored verbatim, so
  -- an exact match is the whole test ('<post>/<spotter>/<hash>-<n>.jpg').
  insert into public.orphaned_sighting_photos (path)
  select o.name
    from storage.objects o
   where o.bucket_id = 'sighting-photos'
     and o.name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-z]+-[0-9]+\.jpg$'
     and greatest(o.created_at, coalesce(o.updated_at, o.created_at)) < now() - interval '48 hours'
     and not exists (select 1 from public.sighting_photos sp where sp.path = o.name)
     and not exists (select 1 from public.orphaned_sighting_photos q where q.path = o.name)
   limit v_limit
  on conflict (path) do nothing;
  get diagnostics v_sight = row_count;

  return v_post + v_sight;
end $$;

comment on function public.enqueue_unreferenced_uploads(integer) is
  'Hourly (release-held-refunds): queues post-photos and sighting-photos objects older than 48 hours, in the app''s own naming, that no row names — uploads whose submit never landed. The existing drains re-check and remove them through the Storage API. Security audit leads 9 + 17, 20261026160000.';

revoke all on function public.enqueue_unreferenced_uploads(integer) from public, anon, authenticated;
grant execute on function public.enqueue_unreferenced_uploads(integer) to service_role;


-- -----------------------------------------------------------------------------
-- submit_bug_report — Lead 10: screenshot paths must be clean.
-- -----------------------------------------------------------------------------
create or replace function public.submit_bug_report(
  p_message          text,
  p_app_version      text default null,
  p_platform         text default null,
  p_os_version       text default null,
  p_device_model     text default null,
  p_area             text default null,
  p_severity         text default null,
  p_frequency        text default null,
  p_expected         text default null,
  p_breadcrumbs      text[] default null,
  p_screenshot_paths text[] default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid      uuid := auth.uid();
  v_message  text := btrim(coalesce(p_message, ''));
  v_expected text := nullif(btrim(coalesce(p_expected, '')), '');
  v_recent   integer;
  v_path     text;
  v_id       uuid;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  -- The client caps and trims too; this is the authority. An empty report is a
  -- mis-tap, not a submission.
  if v_message = '' or char_length(v_message) > 2000 then
    raise exception 'INVALID_INPUT';
  end if;

  if v_expected is not null and char_length(v_expected) > 2000 then
    raise exception 'INVALID_INPUT';
  end if;

  -- SAFETY: every screenshot path must live under the CALLER's own folder.
  -- The storage policy already stops them WRITING elsewhere, but nothing stops
  -- them naming someone else's existing path here — which would attach another
  -- user's private upload to their own report and surface it in the operator's
  -- queue under the wrong name. Checked here because a CHECK constraint cannot
  -- see auth.uid().
  if p_screenshot_paths is not null then
    if coalesce(array_length(p_screenshot_paths, 1), 0) > 3 then
      raise exception 'INVALID_INPUT';
    end if;
    foreach v_path in array p_screenshot_paths loop
      -- SAFETY (AUDIT 2026-10-26, lead 10): the prefix test let
      -- '<uid>/../<victim>/x.jpg' through, and the service role signs these.
      if not public.is_clean_storage_path(v_path, v_uid) then
        raise exception 'INVALID_INPUT';
      end if;
    end loop;
  end if;

  -- --- RATE_LIMITED: max 3 per reporter per ROLLING 24h ----------------------
  -- Unchanged: create_sighting's advisory-lock idiom, keyed on the caller
  -- alone. The lock serialises one caller's concurrent submissions so two
  -- parallel requests cannot both pass the count; it releases at transaction
  -- end.
  perform pg_advisory_xact_lock(
    hashtextextended('submit_bug_report:' || v_uid::text, 0));

  select count(*) into v_recent
  from public.bug_reports b
  where b.reporter_id = v_uid
    and b.created_at > now() - interval '24 hours';

  if v_recent >= 3 then
    raise exception 'RATE_LIMITED';
  end if;

  -- ⚠️ THE DIAGNOSTICS ARE CLAMPED, NOT VALIDATED. The columns CHECK 40/40/80
  -- characters, and an over-long Device.modelName would otherwise raise a raw
  -- check violation the client can only map to its generic fallback — so the
  -- user retries forever and loses the report over a field they did not type
  -- and cannot change. The message is the payload; the diagnostics are
  -- advisory. Same reasoning now covers `expected`, which IS the user's own
  -- text and so is length-CHECKED above rather than silently truncated.
  --
  -- area / severity / frequency are NOT clamped: they carry value CHECKs, not
  -- length ones, and coercing an unrecognised value to a passing one would put
  -- a fact in the operator's queue that the reporter never chose. Unreachable
  -- from our own client, which types all three as closed unions.
  insert into public.bug_reports (
    reporter_id, message, app_version, platform, os_version, device_model,
    area, severity, frequency, expected, breadcrumbs, screenshot_paths
  )
  values (
    v_uid,
    v_message,
    left(nullif(btrim(coalesce(p_app_version, '')), ''), 40),
    nullif(btrim(coalesce(p_platform, '')), ''),
    left(nullif(btrim(coalesce(p_os_version, '')), ''), 40),
    left(nullif(btrim(coalesce(p_device_model, '')), ''), 80),
    nullif(btrim(coalesce(p_area, '')), ''),
    nullif(btrim(coalesce(p_severity, '')), ''),
    nullif(btrim(coalesce(p_frequency, '')), ''),
    v_expected,
    p_breadcrumbs,
    p_screenshot_paths
  )
  returning id into v_id;

  return v_id;
end;
$fn$;

-- -----------------------------------------------------------------------------
-- update_post_verification — Lead 10: the verification path must be clean.
-- -----------------------------------------------------------------------------
create or replace function public.update_post_verification(
  p_post_id           uuid,
  p_verification_path text
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

  -- SAFETY: the V5C path must be under the caller's OWN folder and <= 300 chars
  -- (create_post parity). Unlike update_post (which keeps the existing doc on a
  -- null path), this dedicated setter requires a real path to replace with.
  if p_verification_path is null
     or char_length(p_verification_path) > 300
     or not public.is_clean_storage_path(p_verification_path, v_owner) then  -- AUDIT lead 10
    raise exception 'INVALID_VERIFICATION_PATH';
  end if;

  -- Full replace, SCOPED to this post (see the SAFETY NOTE at the top).
  delete from public.verification_documents where post_id = p_post_id;
  insert into public.verification_documents (post_id, storage_path)
  values (p_post_id, p_verification_path);

  return jsonb_build_object('post_id', p_post_id);
end;
$$;

-- -----------------------------------------------------------------------------
-- create_post — Leads 10 + 13: clean verification path; this project photo URLs.
-- -----------------------------------------------------------------------------
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
  p_last_seen_locality      text default null,
  -- TRAILING and DEFAULTED for the same reason p_last_seen_locality is: every
  -- positional caller in the SQL verification suites stays valid.
  p_vehicle_id              uuid default null,
  -- TRAILING and DEFAULTED for the same reason again (20261012100000).
  p_colour_finish           text default null
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
  -- AUDIT 2026-10-26 (lead 13): this project's storage origin only.
  v_photo_url_re text := public.post_photo_url_re(v_owner);
  -- Distinctive-feature validation scratch vars (20260724100000).
  v_features    jsonb := coalesce(p_distinctive_features, '[]'::jsonb);
  v_feature     jsonb;
  v_feat_desc   text;
  v_feat_url    text;
  -- SAFETY (this migration): the coarse alert-facing label. Trimmed; '' -> NULL
  -- so the push falls back to 'your area' rather than emitting "near ".
  v_locality    text := nullif(btrim(p_last_seen_locality), '');
  -- The garage vehicle this post came from, AFTER the ownership check below.
  -- Never p_vehicle_id directly: an unverified id must not reach the insert.
  v_vehicle_id  uuid;
  v_finish      text := nullif(btrim(p_colour_finish), '');
begin
  if v_owner is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  -- --- PROVENANCE: the garage vehicle this post was made from ------------------
  -- ⚠️ OWNERSHIP IS CHECKED, NOT TRUSTED. p_vehicle_id arrives from the client,
  -- and posts.vehicle_id feeds delete_vehicle's active-post guard and
  -- list_my_vehicles' is_currently_posted. Accepting an id blindly would let a
  -- caller pin their post to a STRANGER'S vehicle and freeze that stranger's
  -- garage row against deletion.
  --
  -- A vehicle that is not the caller's resolves to NULL rather than raising:
  -- this is provenance, not the point of the call, and failing a whole stolen-car
  -- report because a garage row was deleted mid-flow would be the wrong trade.
  -- NULL is exactly the state every post has had until now.
  if p_vehicle_id is not null then
    -- ⚠️ vehicles.USER_ID, not owner_id. posts uses owner_id and vehicles uses
    -- user_id, and a plpgsql body is not checked for column existence at
    -- CREATE time — so the wrong name here applies cleanly and then throws
    -- "column v.owner_id does not exist" at runtime, on every prefilled post.
    -- CI's db job caught exactly that on the first push of this migration.
    select v.id into v_vehicle_id
      from public.vehicles v
     where v.id = p_vehicle_id
       and v.user_id = v_owner;
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
       or not public.is_clean_storage_path(p_verification_path, v_owner) then  -- AUDIT lead 10
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
  -- Optional paint finish (20261012100000). The column CHECK enforces the set
  -- too; raising here names the fault instead of a bare 23514.
  if v_finish is not null
     and v_finish not in ('metallic', 'matte', 'pearl', 'two_tone_roof') then
    raise exception 'INVALID_COLOUR_FINISH';
  end if;

  -- --- Atomic assembly (single transaction) -----------------------------------
  -- NOTE: alerts_sent_at is NOT in this column list. A new post is a DRAFT and
  -- has never been alerted; the notify-spotters claim sets it later, server-side.
  insert into public.posts (
    owner_id, plate, make, model, colour,
    year, body_type, distinguishing_features, owner_note,
    desc_recognise, desc_drives, stolen_from, keys_taken,
    last_seen_at, last_seen_location, last_seen_area, last_seen_locality,
    bounty_amount_pence, status, vehicle_id, colour_finish
  )
  values (
    v_owner, v_plate, p_make, p_model, p_colour,
    p_year, p_body_type, p_distinguishing_features, p_owner_note,
    p_desc_recognise, p_desc_drives, p_stolen_from, p_keys_taken,
    p_last_seen_at,
    ST_SetSRID(ST_MakePoint(p_last_seen_lng, p_last_seen_lat), 4326)::geography,
    p_last_seen_area,
    v_locality,
    -- ⚠️ expires_at IS NO LONGER STAMPED (review finding #18). It was set to
    -- +90 days and NOTHING has ever acted on it: passive expiry was cut
    -- deliberately, so the date never arrived and the listing never closed —
    -- while post detail counted down to it. Liveness is now a question the
    -- owner is ASKED (ADR-0019), not a clock nobody set. The column stays for
    -- the rows that already carry a value; new posts leave it NULL, which is
    -- what "this listing does not expire" has always actually meant.
    p_bounty_amount_pence, 'draft', v_vehicle_id, v_finish
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

-- -----------------------------------------------------------------------------
-- add_vehicle — Lead 13: this project photo URLs.
-- -----------------------------------------------------------------------------
create or replace function public.add_vehicle(
  p_plate                text,
  p_make                 text,
  p_model                text,
  p_colour               text,
  p_colour_note          text,
  p_year                 int,
  p_body_type            text,
  p_nickname             text,
  p_photo_urls           text[],
  p_distinctive_features jsonb default '[]'::jsonb,
  p_colour_finish        text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_owner        uuid := auth.uid();
  v_vehicle_id   uuid;
  v_plate        text;
  v_plate_canon  text;
  v_nickname     text;
  v_photo_count  int  := coalesce(array_length(p_photo_urls, 1), 0);
  v_url          text;
  -- IDENTICAL own-folder regex to create_post: our Storage host, the post-photos
  -- bucket, and a single path segment under the CALLER's own uuid folder.
  -- AUDIT 2026-10-26 (lead 13): this project's storage origin only.
  v_photo_url_re text := public.post_photo_url_re(v_owner);
  v_features     jsonb := coalesce(p_distinctive_features, '[]'::jsonb);
  v_feature      jsonb;
  v_feat_desc    text;
  v_feat_url     text;
  -- The garage cap. Small on purpose: the garage is a convenience for the cars
  -- you actually own, not a fleet register. It also bounds the blast radius of
  -- an automated abuse loop hammering add_vehicle.
  v_vehicle_cap  int  := 5;
  v_finish       text := nullif(btrim(p_colour_finish), '');
begin
  if v_owner is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  -- --- Required fields (make/model/colour are the identity, plate or not) ------
  if p_make is null or p_model is null or p_colour is null then
    raise exception 'MISSING_REQUIRED';
  end if;

  -- Optional paint finish (20261012100000). The column CHECK enforces the set
  -- too; raising here names the fault instead of a bare 23514.
  if v_finish is not null
     and v_finish not in ('metallic', 'matte', 'pearl', 'two_tone_roof') then
    raise exception 'INVALID_COLOUR_FINISH';
  end if;

  -- --- Garage cap -------------------------------------------------------------
  -- SAFETY: counts the CALLER's rows only (v_owner), so the count can never be a
  -- signal about anyone else's garage.
  if (select count(*) from public.vehicles v where v.user_id = v_owner) >= v_vehicle_cap then
    raise exception 'VEHICLE_LIMIT_REACHED';
  end if;

  -- --- OPTIONAL PLATE: canon first; a plate that strips to nothing is NULL -----
  -- Byte-for-byte create_post's rule (20260713195000): a blank, punctuation-only
  -- or non-ASCII-homoglyph "plate" is NOT a plate and is stored as NULL.
  v_plate_canon := upper(regexp_replace(coalesce(p_plate, ''), '[^A-Za-z0-9]', '', 'g'));
  v_plate := case when v_plate_canon = '' then null
                  else upper(trim(coalesce(p_plate, ''))) end;

  if v_plate_canon <> '' then
    -- Same format gate as create_post, so a saved plate can always be posted.
    if v_plate_canon !~ '^[A-Z0-9]{2,8}$' then
      raise exception 'INVALID_PLATE';
    end if;
    -- Bound the STORED (raw, upper+trimmed) form too: the canon gate above caps
    -- the alphanumerics at 8 but says nothing about padding punctuation, and the
    -- vehicles_plate_len_chk CHECK would otherwise surface as a raw constraint
    -- violation instead of a mapped code.
    if char_length(v_plate) > 15 then
      raise exception 'INVALID_PLATE';
    end if;
    -- SAFETY: PER-USER dedupe only (see vehicles_user_plate_canon_uidx). The
    -- unique index is the real enforcement; this is the friendly, mapped error.
    if exists (
      select 1
      from public.vehicles v
      where v.user_id = v_owner
        and upper(regexp_replace(coalesce(v.plate, ''), '[^A-Za-z0-9]', '', 'g')) = v_plate_canon
    ) then
      raise exception 'PLATE_ALREADY_SAVED';
    end if;
  end if;

  -- --- Nickname: trimmed; an empty box is NULL, not '' ------------------------
  -- Length is enforced by vehicles_nickname_len_chk (the same no-explicit-raise
  -- treatment update_post_car_details gives year).
  v_nickname := nullif(btrim(coalesce(p_nickname, '')), '');

  -- --- Photos: OPTIONAL here (0..6). See the divergence note above. -----------
  if v_photo_count > 6 then
    raise exception 'PHOTO_COUNT';
  end if;

  -- --- SAFETY: photo URLs must be our own-folder post-photos objects ----------
  if v_photo_count > 0 then
    foreach v_url in array p_photo_urls loop
      if v_url is null or char_length(v_url) > 500 or v_url !~ v_photo_url_re then
        raise exception 'INVALID_PHOTO_URL';
      end if;
    end loop;
  end if;

  -- --- Distinctive features: create_post's validation, verbatim ---------------
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

  -- --- Atomic assembly (single transaction) -----------------------------------
  -- SAFETY: user_id pinned to the caller; verification_state deliberately absent
  -- from this INSERT so it takes its 'unverified' default.
  insert into public.vehicles (
    user_id, plate, make, model, colour, colour_note, year, body_type, nickname, colour_finish
  )
  values (
    v_owner, v_plate, p_make, p_model, p_colour, nullif(btrim(p_colour_note), ''),
    p_year, p_body_type, v_nickname, v_finish
  )
  returning id into v_vehicle_id;

  if v_photo_count > 0 then
    insert into public.vehicle_photos (vehicle_id, url, position)
    select v_vehicle_id, u.url, (u.ord - 1)::int
    from unnest(p_photo_urls) with ordinality as u(url, ord);
  end if;

  -- position = ordinality-1 so stored order matches the order the client sent;
  -- description stored TRIMMED (the CHECK measures it trimmed — store it clean).
  insert into public.vehicle_distinctive_feature (vehicle_id, photo_url, description, position)
  select v_vehicle_id,
         elem.value ->> 'photo_url',
         btrim(elem.value ->> 'description'),
         (elem.ord - 1)::int
  from jsonb_array_elements(v_features) with ordinality as elem(value, ord);

  return jsonb_build_object('vehicle_id', v_vehicle_id);
end;
$$;

-- -----------------------------------------------------------------------------
-- update_vehicle — Lead 13: this project photo URLs.
-- -----------------------------------------------------------------------------
create or replace function public.update_vehicle(
  p_vehicle_id           uuid,
  p_plate                text,
  p_make                 text,
  p_model                text,
  p_colour               text,
  p_colour_note          text,
  p_year                 int,
  p_body_type            text,
  p_nickname             text,
  p_photo_urls           text[],
  p_distinctive_features jsonb default '[]'::jsonb,
  p_colour_finish        text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_owner        uuid := auth.uid();
  v_vehicle      public.vehicles%rowtype;
  v_plate        text;
  v_plate_canon  text;
  v_nickname     text;
  v_photo_count  int  := coalesce(array_length(p_photo_urls, 1), 0);
  v_url          text;
  -- AUDIT 2026-10-26 (lead 13): this project's storage origin only.
  v_photo_url_re text := public.post_photo_url_re(v_owner);
  v_features     jsonb := coalesce(p_distinctive_features, '[]'::jsonb);
  v_feature      jsonb;
  v_feat_desc    text;
  v_feat_url     text;
  v_finish       text := nullif(btrim(p_colour_finish), '');
begin
  if v_owner is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  -- SAFETY: own + locked, else ONE opaque code. Absent and not-yours are
  -- indistinguishable to the caller by design.
  select * into v_vehicle
  from public.vehicles v
  where v.id = p_vehicle_id
    and v.user_id = v_owner
  for update;
  if not found then
    raise exception 'VEHICLE_NOT_FOUND';
  end if;

  -- --- Required identity (same rule as add_vehicle / create_post) -------------
  if p_make is null or p_model is null or p_colour is null then
    raise exception 'MISSING_REQUIRED';
  end if;

  -- Optional paint finish (20261012100000). The column CHECK enforces the set
  -- too; raising here names the fault instead of a bare 23514.
  if v_finish is not null
     and v_finish not in ('metallic', 'matte', 'pearl', 'two_tone_roof') then
    raise exception 'INVALID_COLOUR_FINISH';
  end if;

  -- --- OPTIONAL PLATE: identical canon + gates to add_vehicle -----------------
  v_plate_canon := upper(regexp_replace(coalesce(p_plate, ''), '[^A-Za-z0-9]', '', 'g'));
  v_plate := case when v_plate_canon = '' then null
                  else upper(trim(coalesce(p_plate, ''))) end;

  if v_plate_canon <> '' then
    if v_plate_canon !~ '^[A-Z0-9]{2,8}$' then
      raise exception 'INVALID_PLATE';
    end if;
    if char_length(v_plate) > 15 then
      raise exception 'INVALID_PLATE';
    end if;
    -- PER-USER dedupe, EXCLUDING this row (re-saving the same plate on the same
    -- vehicle is a no-op, not a clash).
    if exists (
      select 1
      from public.vehicles v
      where v.user_id = v_owner
        and v.id <> p_vehicle_id
        and upper(regexp_replace(coalesce(v.plate, ''), '[^A-Za-z0-9]', '', 'g')) = v_plate_canon
    ) then
      raise exception 'PLATE_ALREADY_SAVED';
    end if;
  end if;

  v_nickname := nullif(btrim(coalesce(p_nickname, '')), '');

  -- --- Photos: OPTIONAL (0..6), own-folder only -------------------------------
  if v_photo_count > 6 then
    raise exception 'PHOTO_COUNT';
  end if;
  if v_photo_count > 0 then
    foreach v_url in array p_photo_urls loop
      if v_url is null or char_length(v_url) > 500 or v_url !~ v_photo_url_re then
        raise exception 'INVALID_PHOTO_URL';
      end if;
    end loop;
  end if;

  -- --- Distinctive features: create_post's validation, verbatim ---------------
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

  -- --- Apply (one transaction) ------------------------------------------------
  -- SAFETY: the column list names ONLY the editable descriptive fields.
  -- user_id, verification_state, id and created_at are absent and unwritable here.
  update public.vehicles set
    plate       = v_plate,
    make        = p_make,
    model       = p_model,
    colour      = p_colour,
    colour_note = nullif(btrim(p_colour_note), ''),
    colour_finish = v_finish,
    year       = p_year,
    body_type  = p_body_type,
    nickname   = v_nickname,
    updated_at = now()
  where id = p_vehicle_id;

  -- Full replace of the child rows, SCOPED to this vehicle (never a post's rows).
  delete from public.vehicle_photos where vehicle_id = p_vehicle_id;
  if v_photo_count > 0 then
    insert into public.vehicle_photos (vehicle_id, url, position)
    select p_vehicle_id, u.url, (u.ord - 1)::int
    from unnest(p_photo_urls) with ordinality as u(url, ord);
  end if;

  delete from public.vehicle_distinctive_feature where vehicle_id = p_vehicle_id;
  insert into public.vehicle_distinctive_feature (vehicle_id, photo_url, description, position)
  select p_vehicle_id,
         elem.value ->> 'photo_url',
         btrim(elem.value ->> 'description'),
         (elem.ord - 1)::int
  from jsonb_array_elements(v_features) with ordinality as elem(value, ord);

  return jsonb_build_object('vehicle_id', p_vehicle_id);
end;
$$;

-- -----------------------------------------------------------------------------
-- update_post_photos — Lead 13: this project photo URLs.
-- -----------------------------------------------------------------------------
create or replace function public.update_post_photos(
  p_post_id    uuid,
  p_photo_urls text[]
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_owner        uuid := auth.uid();
  v_post         public.posts%rowtype;
  v_photo_count  int  := coalesce(array_length(p_photo_urls, 1), 0);
  v_url          text;
  -- AUDIT 2026-10-26 (lead 13): this project's storage origin only.
  v_photo_url_re text := public.post_photo_url_re(v_owner);
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

  -- Photo count (create_post parity).
  if v_photo_count < 3 or v_photo_count > 6 then
    raise exception 'PHOTO_COUNT';
  end if;

  -- SAFETY: every URL must be one of the caller's OWN-folder post-photos objects
  -- (anti spotter-tracking, §3) and <= 500 chars — same check as create_post.
  foreach v_url in array p_photo_urls loop
    if v_url is null or char_length(v_url) > 500 or v_url !~ v_photo_url_re then
      raise exception 'INVALID_PHOTO_URL';
    end if;
  end loop;

  -- Full replace, SCOPED to this post (see the SAFETY NOTE at the top).
  delete from public.post_photos where post_id = p_post_id;
  insert into public.post_photos (post_id, url, position)
  select p_post_id, u.url, (u.ord - 1)::int
  from unnest(p_photo_urls) with ordinality as u(url, ord);

  return jsonb_build_object('post_id', p_post_id);
end;
$$;

-- -----------------------------------------------------------------------------
-- update_post_distinctive_features — Lead 13: this project photo URLs.
-- -----------------------------------------------------------------------------
create or replace function public.update_post_distinctive_features(
  p_post_id              uuid,
  p_distinctive_features jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_owner        uuid := auth.uid();
  v_post         public.posts%rowtype;
  v_features     jsonb := coalesce(p_distinctive_features, '[]'::jsonb);
  v_feature      jsonb;
  v_feat_desc    text;
  v_feat_url     text;
  -- AUDIT 2026-10-26 (lead 13): this project's storage origin only.
  v_photo_url_re text := public.post_photo_url_re(v_owner);
  -- NEW 20261019100000: the pairing. v_match[i] is the existing row id the
  -- i-th payload element (1-based ordinality) keeps, or NULL for a new mark;
  -- v_kept is the same ids without the NULLs.
  v_ord          bigint;
  v_match        uuid[] := '{}';
  v_kept         uuid[] := '{}';
  v_id           uuid;
begin
  if v_owner is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  -- SAFETY: DRAFT + PENDING_VERIFICATION + ACTIVE gate. Safe on a LIVE post because
  -- the delete/insert below is SCOPED to this post's evidence child rows and never
  -- touches bounty/status/owner/expires. Own + in-gate + locked, else
  -- POST_NOT_EDITABLE.
  select * into v_post
  from public.posts p
  where p.id = p_post_id
    and p.owner_id = v_owner
    and p.status = any(array['draft', 'pending_verification', 'active']::public.post_status[])
  for update;
  if not found then
    raise exception 'POST_NOT_EDITABLE';
  end if;

  -- Server re-check of the jsonb array of {"photo_url","description"} objects —
  -- IDENTICAL to create_post (same raise codes). A non-array payload is malformed.
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

  -- --- NEW 20261019100000: keep ids stable (all SCOPED to this post) -----------
  -- Step 1 — PAIR, before writing anything. Done first and separately so a row
  -- inserted for one element can never be "matched" by a later duplicate URL.
  -- Ties between existing rows sharing a URL go to the lowest position (then
  -- id, for determinism). The FOR UPDATE on the post above serialises
  -- concurrent edits of this post, so the pairing cannot go stale mid-call.
  for v_feature, v_ord in
    select elem.value, elem.ord
    from jsonb_array_elements(v_features) with ordinality as elem(value, ord)
    order by elem.ord
  loop
    select df.id into v_id
    from public.post_distinctive_feature df
    where df.post_id = p_post_id
      and df.photo_url = v_feature ->> 'photo_url'
      and df.id <> all(v_kept)
    order by df.position, df.id
    limit 1;

    -- NULL when unmatched (a new mark); array_append keeps the NULL, so
    -- v_match stays index-aligned with the payload's ordinality.
    v_match := array_append(v_match, v_id);
    if v_id is not null then
      v_kept := array_append(v_kept, v_id);
    end if;
  end loop;

  -- Step 2 — DELETE the marks the owner removed: this post's rows that no
  -- payload element claimed. (`<> all('{}')` is true, so an empty payload
  -- removes every mark — the old full-replace behaviour for that case.)
  delete from public.post_distinctive_feature df
  where df.post_id = p_post_id
    and df.id <> all(v_kept);

  -- Step 3 — UPDATE the kept marks in place: same id, so a sighting's
  -- confirmed_feature_ids / offered_feature_ids keep resolving. description
  -- stored trimmed; position = ordinality-1 (0-based), as before.
  update public.post_distinctive_feature df
  set description = btrim(elem.value ->> 'description'),
      position    = (elem.ord - 1)::int
  from jsonb_array_elements(v_features) with ordinality as elem(value, ord)
  where df.post_id = p_post_id
    and v_match[elem.ord::int] is not null
    and df.id = v_match[elem.ord::int];

  -- Step 4 — INSERT the new marks (no claimed row), exactly as before.
  insert into public.post_distinctive_feature (post_id, photo_url, description, position)
  select p_post_id,
         elem.value ->> 'photo_url',
         btrim(elem.value ->> 'description'),
         (elem.ord - 1)::int
  from jsonb_array_elements(v_features) with ordinality as elem(value, ord)
  where v_match[elem.ord::int] is null;

  return jsonb_build_object('post_id', p_post_id);
end;
$$;

-- -----------------------------------------------------------------------------
-- unregister_push_token — Lead 15: a sign-out leaves who last held the device.
-- -----------------------------------------------------------------------------
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
  -- AUDIT 2026-10-26 (lead 15): remember who held this device, hashed, so a
  -- different account signing in on it next still records a device link.
  insert into public.push_token_releases (token_hash, user_id)
  select encode(extensions.digest(t.token, 'sha256'), 'hex'), t.user_id
    from public.push_tokens t
   where t.token = v_token and t.user_id = v_uid
  on conflict (token_hash) do update
    set user_id = excluded.user_id, released_at = now();

  delete from public.push_tokens
  where token = v_token
    and user_id = v_uid;
end;
$$;

-- -----------------------------------------------------------------------------
-- forget_my_push_tokens — Lead 15: a sign-out leaves who last held each device.
-- -----------------------------------------------------------------------------
create or replace function public.forget_my_push_tokens()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  -- No session -> silent no-op, as unregister_push_token: nothing to delete
  -- without a caller identity, and an error mid-sign-out helps nobody.
  if v_uid is null then
    return;
  end if;

  -- AUDIT 2026-10-26 (lead 15): as unregister_push_token, for every device.
  insert into public.push_token_releases (token_hash, user_id)
  select encode(extensions.digest(t.token, 'sha256'), 'hex'), t.user_id
    from public.push_tokens t
   where t.user_id = v_uid
  on conflict (token_hash) do update
    set user_id = excluded.user_id, released_at = now();

  delete from public.push_tokens
   where user_id = v_uid;
end;
$$;

-- -----------------------------------------------------------------------------
-- register_push_token — Lead 15: a released device counts as a previous owner.
-- -----------------------------------------------------------------------------
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
  -- NEW 20261023130000: the session this JWT was issued for.
  v_session  uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
begin
  -- A token must belong to an account: no owner, no audience row.
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  -- NEW 20261023130000: signed out everywhere — this JWT's session is gone.
  if v_session is not null
     and not exists (select 1 from auth.sessions where id = v_session) then
    return;
  end if;

  -- Bounds the token defensively (Expo tokens are ~40-50 chars; 255 is generous
  -- headroom) so a client cannot pad an unbounded blob into a PRIMARY KEY, and
  -- rejects any platform outside the CHECK whitelist with a stable token rather
  -- than a raw constraint-violation error.
  -- SAFETY (AUDIT 2026-10-26, lead 7): an Expo token or nothing. The send path
  -- batches 100 users' tokens per Expo request, so one planted non-Expo
  -- string could fail the whole request for everyone in it.
  if v_token = ''
     or char_length(v_token) > 255
     or v_token !~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$'
     or v_platform not in ('ios', 'android') then
    raise exception 'INVALID_INPUT';
  end if;

  -- ADDED 2026-08-03: read the current owner BEFORE the upsert re-points it.
  select user_id into v_previous
    from public.push_tokens
   where token = v_token;

  -- AUDIT 2026-10-26 (lead 15): a device signed out by ANOTHER account still
  -- counts as theirs — sign-out deletes the token row, so without this the
  -- one-phone-two-accounts edge below vanished on Log out.
  if v_previous is null then
    select r.user_id into v_previous
      from public.push_token_releases r
     where r.token_hash = encode(extensions.digest(v_token, 'sha256'), 'hex')
       and r.user_id <> v_uid;
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

  -- ADDED 2026-08-03: the handover is THE one-phone-two-accounts collusion
  -- signal (SECURITY_AND_TRUST §5), recorded only when the token actually
  -- moved. Same-user refreshes — every app start — write nothing. Hashed so
  -- the ledger never holds a live push credential.
  if v_previous is not null and v_previous <> v_uid then
    insert into public.device_links (token_hash, from_user_id, to_user_id)
    values (encode(extensions.digest(v_token, 'sha256'), 'hex'), v_previous, v_uid);
  end if;

  -- SAFETY (AUDIT 2026-10-26, lead 7): a user keeps their ten newest devices,
  -- so nobody can stuff the shared fan-out with tokens.
  delete from public.push_tokens t
   where t.user_id = v_uid
     and t.token not in (select k.token
                           from public.push_tokens k
                          where k.user_id = v_uid
                          order by k.updated_at desc, k.token
                          limit 10);
end;
$$;

-- -----------------------------------------------------------------------------
-- purge_stale_push_tokens — Lead 15: releases age out with the tokens.
-- -----------------------------------------------------------------------------
create or replace function public.purge_stale_push_tokens()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  delete from public.push_tokens where updated_at < now() - interval '270 days';
  get diagnostics v_deleted = row_count;
  -- AUDIT 2026-10-26 (lead 15): a release ages out like the token it was.
  delete from public.push_token_releases where released_at < now() - interval '270 days';
  return v_deleted;
end $$;

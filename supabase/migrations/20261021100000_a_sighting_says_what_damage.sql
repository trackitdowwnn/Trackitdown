-- #############################################################################
-- ## ⚠️ DESTRUCTIVE STATEMENT: ONE `DROP FUNCTION`                            ##
-- ##                                                                          ##
-- ##   drop function public.create_sighting(uuid, jsonb, text[], text, text,  ##
-- ##                                text, text, text, text, uuid[], uuid[])   ##
-- ##                                                                          ##
-- ## create_sighting gains a 12th and 13th parameter, both trailing and      ##
-- ## defaulted. A function's identity is its argument types, so CREATE OR    ##
-- ## REPLACE would NOT replace the 11-arg function — it would add a SECOND   ##
-- ## overload, and PostgREST would then refuse every named-arg call that     ##
-- ## omits the new parameters as ambiguous (PGRST203). So the 11-arg         ##
-- ## signature is dropped and the 13-arg one created in the SAME transaction ##
-- ## (a migration is one transaction: no moment exists where neither is      ##
-- ## callable). Because both new parameters default to NULL, every existing  ##
-- ## caller — the shipped app's 11 named args, the suites' positional calls  ##
-- ## — resolves to the new function unchanged. The grants and comment are    ##
-- ## re-applied (a drop takes them with it): EXECUTE to authenticated +      ##
-- ## service_role ONLY, never anon or public — exactly the 20261019100000    ##
-- ## posture.                                                                ##
-- ##                                                                          ##
-- ## No table, column, row or policy is dropped.                             ##
-- #############################################################################
--
-- WHAT:  A spotter who ticked "damage visible" can say WHAT damage they saw,
--        and only the post's OWNER can read it:
--          1. sightings.damage_kinds text[] (nullable) — a closed multi-select:
--             smashed_window | dents_scrapes | broken_lights | missing_wheels
--             | missing_parts | fire_damage. NULL = not asked / not answered.
--          2. sightings.damage_note text (nullable) — the spotter's own words,
--             1-300 characters, trimmed, no hidden characters.
--          3. Three table CHECKs: the kinds whitelist, the note's bounds, and
--             "neither without the damage_visible flag".
--          4. create_sighting gains p_damage_kinds and p_damage_note (trailing,
--             default NULL), validated and stored.
--          5. get_post_sightings returns 'damage_kinds' and 'damage_note'.
-- WHY:   Owner-approved spec (2026-10-21): the report wizard adds a "What
--        damage can you see?" step after the condition step, shown only when
--        the spotter picked damage_visible. "Damage visible" alone tells the
--        owner little; a smashed window or missing wheels changes what they
--        tell the police and their insurer.
-- LINKS: supabase/migrations/20261019100000_a_sighting_remembers_what_it_asked.sql
--          (the create_sighting and get_post_sightings bodies re-issued here);
--        supabase/migrations/20261009180000_a_withdrawal_can_say_more.sql
--          (withdraw_note — the hidden-character set and the blank rule
--          copied here);
--        supabase/migrations/20260814150000_review_flags_are_not_the_spotters_to_read.sql
--          (the client column grant these columns are deliberately left out of);
--        supabase/tests/sighting_damage_verification.sql;
--        docs/DOMAIN.md (Sightings — structured context is owner-only);
--        docs/SECURITY_AND_TRUST.md §1/§6/§7 (owner-only sighting detail;
--          unmoderated free text).
--
-- NOT CHANGED, deliberately:
--   * The client column grant on public.sightings (20260814150000) is NOT
--     widened: damage_kinds and damage_note reach the owner only through
--     get_post_sightings, and no client may read or write either column
--     directly (deny by default; the suite asserts it). Not even the spotter
--     reads their own note back — the same posture as withdraw_note.
--   * The damage note never enters a push. No notification claim reads either
--     column; the words are fetched in the app, by the owner, after the tap.
--   * Every existing create_sighting gate is byte-identical; the new block
--     runs after all of them, so an old client's call takes exactly the old
--     path and stores NULL in both columns.
-- =============================================================================


-- =============================================================================
-- 1. COLUMNS: sightings.damage_kinds, sightings.damage_note
-- =============================================================================
-- Nullable with NO default and NO backfill: every existing row is honestly
-- "not asked" — the question did not exist when those reports were made.
alter table public.sightings
  add column damage_kinds text[] null,
  add column damage_note  text   null;

-- A closed vocabulary, at least one kind (an empty answer is stored as NULL,
-- never '{}'), and no NULL element. Defence in depth against a service-role
-- write as much as a check on the RPC, which normalises before it gets here.
alter table public.sightings add constraint sightings_damage_kinds_chk
  check (damage_kinds is null
         or (damage_kinds <@ array['smashed_window', 'dents_scrapes', 'broken_lights',
                                   'missing_wheels', 'missing_parts', 'fire_damage']::text[]
             and cardinality(damage_kinds) between 1 and 6
             and array_position(damage_kinds, null) is null));

-- Bounded, never blank, and free of control, zero-width and text-direction
-- characters — so what the owner reads is exactly what the RPC accepted. The
-- character set is withdraw_note's (20261009180000), byte for byte.
alter table public.sightings add constraint sightings_damage_note_chk
  check (damage_note is null
         or (char_length(btrim(damage_note)) between 1 and 300
             and damage_note = btrim(damage_note)
             and damage_note !~ '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F\u00AD\u061C\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]'));

-- Damage detail only ever beside the damage_visible flag: a report that says
-- nothing about damage cannot carry a damage answer. context_flags is NOT
-- NULL and its own CHECK refuses NULL elements, so `= any` here is never NULL
-- (a NULL would make the CHECK pass silently).
alter table public.sightings add constraint sightings_damage_needs_flag_chk
  check ((damage_kinds is null and damage_note is null)
         or 'damage_visible' = any(context_flags));

comment on column public.sightings.damage_kinds is
  'What damage the spotter could see (2026-10-21), from a closed list: smashed_window | dents_scrapes | broken_lights | missing_wheels | missing_parts | fire_damage. NULL = not asked or not answered (older app, older report, or nothing picked) — never "no damage". Deduped, at least one kind, stored in the list''s own order, only ever beside context_flags ''damage_visible'' (sightings_damage_needs_flag_chk). Written only by create_sighting. Not in the client column grant — read by the post owner through get_post_sightings only.';

comment on column public.sightings.damage_note is
  'The spotter''s own words about the damage (2026-10-21): 1-300 characters, trimmed, no control / zero-width / text-direction characters, only ever beside context_flags ''damage_visible''. NULL when none. Read ONLY by the post owner, in the app, through get_post_sightings — granted to no client role (not even the spotter), and never put in a push. Unmoderated: SECURITY_AND_TRUST §7.';


-- =============================================================================
-- 2. RPC: create_sighting  (DROP the 11-arg signature, CREATE the 13-arg one)
-- =============================================================================
-- ⚠️ DESTRUCTIVE — see the banner at the top of this file.
drop function public.create_sighting(
  uuid, jsonb, text[], text, text, text, text, text, text, uuid[], uuid[]
);

-- Tier 1 SAFETY: the body is 20261019100000's byte-for-byte with EXACTLY these
-- changes, all marked "NEW 20261021100000" below:
--   (a) the trailing parameters p_damage_kinds text[] default null and
--       p_damage_note text default null;
--   (b) three declares (v_damage_kind_list, v_damage_kinds, v_damage_note);
--   (c) the damage block after the offered-ids block;
--   (d) damage_kinds, damage_note in the sightings INSERT column/value lists.
-- Every existing gate — auth, active-post, OWN_POST, advisory-lock rate limit,
-- photo checks, path pinning, ADR-0003 rules, flag/text bounds, the
-- confirmed-ids guard, the offered-ids rules — is unchanged. Diff it against
-- 20261019100000.
create function public.create_sighting(
  p_post_id              uuid,
  p_photos               jsonb,
  p_context_flags        text[],
  p_note                 text,
  p_area_label           text,
  p_locality             text default null,
  p_parked_likelihood    text default null,
  p_direction            text default null,
  p_people_presence      text default null,
  p_confirmed_feature_ids uuid[] default null,
  -- NEW 20261019100000 (a). Trailing + defaulted so every older caller keeps
  -- resolving here unchanged and stores NULL, meaning unknown.
  p_offered_feature_ids  uuid[] default null,
  -- NEW 20261021100000 (a). Trailing + defaulted for the same reason: an
  -- older app sends neither, and both columns stay NULL ("not asked").
  p_damage_kinds         text[] default null,
  p_damage_note          text   default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_spotter              uuid := auth.uid();
  v_owner                uuid;
  v_post_status          public.post_status;
  v_recent               int;
  v_photo_count          int;
  v_elem                 jsonb;
  v_path                 text;
  v_captured             timestamptz;
  v_lat                  double precision;
  v_lng                  double precision;
  v_acc                  double precision;
  v_source               text;
  v_any_located          boolean := false;
  v_any_live             boolean := false;
  v_flags                text[]  := coalesce(p_context_flags, '{}');
  v_locality             text    := nullif(btrim(p_locality), '');
  v_parked_likelihood    text    := nullif(btrim(p_parked_likelihood), '');
  v_direction            text    := nullif(btrim(p_direction), '');
  v_people_presence      text    := nullif(btrim(p_people_presence), '');
  v_confirmed            uuid[]  := coalesce(p_confirmed_feature_ids, '{}');
  -- NEW 20261019100000 (b). NOT coalesced: NULL ("unknown") and '{}' ("asked,
  -- nothing to show") are different facts and both are stored as given.
  v_offered              uuid[]  := p_offered_feature_ids;
  -- NEW 20261021100000 (b). The SAME list, in the SAME order, as
  -- sightings_damage_kinds_chk; the order is also the stored order.
  v_damage_kind_list     constant text[] := array['smashed_window', 'dents_scrapes',
                                                  'broken_lights', 'missing_wheels',
                                                  'missing_parts', 'fire_damage']::text[];
  v_damage_kinds         text[]  := p_damage_kinds;
  -- Trimmed here so the stored note always satisfies the CHECK; a note of
  -- only spaces is no note (withdraw_sighting's rule, 20261009180000).
  v_damage_note          text    := nullif(btrim(p_damage_note, E' \t\r\n'), '');
  v_sighting_id          uuid;
begin
  -- SAFETY: must be signed in (execute is granted to authenticated +
  -- service_role only, never anon — this is a belt-and-braces backstop).
  if v_spotter is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  -- --- POST_NOT_ACTIVE: sightings only on live posts (DOMAIN.md) --------------
  -- A missing post and a non-active post give the SAME token, so this RPC is
  -- not an existence oracle for hidden (draft/pending/closed) posts.
  select p.owner_id, p.status into v_owner, v_post_status
  from public.posts p
  where p.id = p_post_id;
  if not found or v_post_status <> 'active' then
    raise exception 'POST_NOT_ACTIVE';
  end if;

  -- --- OWN_POST: collusion hygiene (SECURITY_AND_TRUST §5) --------------------
  -- An owner "spotting" their own car would let them feed their own reputation
  -- and grease a self-credit; blocked outright.
  if v_owner = v_spotter then
    raise exception 'OWN_POST';
  end if;

  -- --- RATE_LIMITED: max 3 per spotter per post per ROLLING 24h ---------------
  -- (DOMAIN.md / §5). Advisory xact lock serialises concurrent calls for the
  -- same (post, spotter) so parallel requests cannot both pass the count and
  -- land a 4th row; the lock releases automatically at transaction end.
  perform pg_advisory_xact_lock(
    hashtextextended('create_sighting:' || p_post_id::text || ':' || v_spotter::text, 0));
  select count(*) into v_recent
  from public.sightings s
  where s.post_id = p_post_id
    and s.spotter_id = v_spotter
    and s.created_at > now() - interval '24 hours';
  if v_recent >= 3 then
    raise exception 'RATE_LIMITED';
  end if;

  -- --- INVALID_PHOTOS: 1..3 well-formed photo objects -------------------------
  if p_photos is null or jsonb_typeof(p_photos) <> 'array' then
    raise exception 'INVALID_PHOTOS: photos must be a json array';
  end if;
  v_photo_count := jsonb_array_length(p_photos);
  if v_photo_count < 1 or v_photo_count > 3 then
    raise exception 'INVALID_PHOTOS: expected 1..3 photos, got %', v_photo_count;
  end if;

  for v_elem in select e.value from jsonb_array_elements(p_photos) e loop
    if jsonb_typeof(v_elem) <> 'object' then
      raise exception 'INVALID_PHOTOS: each photo must be an object';
    end if;

    -- Any unparseable field (bad timestamp, non-numeric lat/lng/accuracy) is a
    -- malformed photo, not a raw cast error surfaced to the client.
    begin
      v_path     := v_elem ->> 'path';
      v_captured := (v_elem ->> 'captured_at')::timestamptz;
      v_lat      := (v_elem ->> 'lat')::double precision;
      v_lng      := (v_elem ->> 'lng')::double precision;
      v_acc      := (v_elem ->> 'accuracy_m')::double precision;
    exception when others then
      raise exception 'INVALID_PHOTOS: malformed photo field';
    end;

    -- ADR-0003 provenance: absent/blank source means 'live' — pre-hybrid
    -- clients send no source, and their captures ARE live in-app captures.
    v_source := coalesce(nullif(btrim(v_elem ->> 'source'), ''), 'live');
    if v_source not in ('live', 'gallery') then
      raise exception 'INVALID_PHOTOS: source must be live or gallery';
    end if;

    if v_captured is null then
      raise exception 'INVALID_PHOTOS: captured_at is required';
    end if;

    -- Capture-time GPS: both-or-neither; accuracy only on a located photo.
    -- Range/sign checks are extra hardening under the same token.
    if (v_lat is null) <> (v_lng is null) then
      raise exception 'INVALID_PHOTOS: lat/lng must both be set or both be null';
    end if;
    if v_acc is not null and v_lat is null then
      raise exception 'INVALID_PHOTOS: accuracy_m only allowed on a located photo';
    end if;
    if v_lat is not null
       and (v_lat < -90 or v_lat > 90 or v_lng < -180 or v_lng > 180
            or (v_acc is not null and v_acc < 0)) then
      raise exception 'INVALID_PHOTOS: lat/lng/accuracy_m out of range';
    end if;

    -- ADR-0003 rule 3 (payout blindness, STRUCTURAL): a gallery photo must
    -- carry NO location — its EXIF is stripped client-side and never read as
    -- evidence, and this guard makes a located gallery row IMPOSSIBLE rather
    -- than merely discouraged. Only live captures can ever bear GPS.
    if v_source = 'gallery'
       and (v_lat is not null or v_lng is not null or v_acc is not null) then
      raise exception 'INVALID_PHOTOS: gallery photos carry no location';
    end if;

    -- SAFETY (path pinning — same split_part technique as create_post's V5C
    -- check, 20260713192000): the object name must be exactly
    -- '<p_post_id>/<caller uid>/<filename>' — this post, the CALLER's folder,
    -- one trailing filename segment, length-bounded. The storage INSERT policy
    -- already forces uploads there; this stops the DB row pointing anywhere
    -- else (another user's evidence, another post's folder).
    if v_path is null
       or char_length(v_path) > 300
       or split_part(v_path, '/', 1) <> p_post_id::text
       or split_part(v_path, '/', 2) <> v_spotter::text
       or split_part(v_path, '/', 3) = ''
       or split_part(v_path, '/', 4) <> '' then
      raise exception 'INVALID_PHOTOS: path must be <post_id>/<own uid>/<filename>';
    end if;

    if v_lat is not null then
      v_any_located := true;
    end if;
    if v_source = 'live' then
      v_any_live := true;
    end if;
  end loop;

  -- ADR-0003 rule 1, server-enforced (never client-only): gallery photos are
  -- SUPPLEMENTARY — every sighting still requires at least one live in-app
  -- capture. A gallery-only submission is unfalsifiable and is rejected.
  if not v_any_live then
    raise exception 'INVALID_PHOTOS: at least one live in-app capture is required';
  end if;

  -- --- INVALID_INPUT: flags whitelist + bounded text ---------------------------
  -- Same bounds as the table CHECKs; re-checked here so the client gets a clean
  -- mappable token instead of a raw constraint violation.
  -- Whitelist expanded to the v2 chip set — the SAME list as the table CHECK
  -- re-created in part 1 (the 20260801140000/20260714100000 drift is why that
  -- bugfix exists).
  if not (v_flags <@ array['parked', 'driving', 'being_loaded',
                           'people_nearby', 'plate_changed',
                           'damage_visible', 'being_stripped',
                           'looks_intact']::text[]) then
    raise exception 'INVALID_INPUT: unknown context flag';
  end if;
  -- At most ONE vehicle-state flag (parked/driving/being_loaded): the states
  -- are mutually exclusive facts (DOMAIN.md). Enforced here for NEW rows only
  -- — the table CHECK cannot (legacy multi-select rows may hold both).
  if (select count(*)
      from unnest(v_flags) f
      where f in ('parked', 'driving', 'being_loaded')) > 1 then
    raise exception 'INVALID_INPUT: conflicting vehicle-state flags';
  end if;
  if p_note is not null and char_length(p_note) > 500 then
    raise exception 'INVALID_INPUT: note too long';
  end if;
  if p_area_label is not null and char_length(p_area_label) > 120 then
    raise exception 'INVALID_INPUT: area_label too long';
  end if;
  if v_locality is not null and char_length(v_locality) > 80 then
    raise exception 'INVALID_INPUT: locality too long';
  end if;
  if v_parked_likelihood is not null
     and v_parked_likelihood not in ('settled', 'street', 'moving') then
    raise exception 'INVALID_INPUT: parked_likelihood must be settled/street/moving';
  end if;
  if v_direction is not null
     and v_direction not in ('N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW') then
    raise exception 'INVALID_INPUT: direction must be N/NE/E/SE/S/SW/W/NW';
  end if;
  if v_people_presence is not null
     and v_people_presence not in ('nobody', 'nearby', 'in_vehicle') then
    raise exception 'INVALID_INPUT: people_presence must be nobody/nearby/in_vehicle';
  end if;
  -- Confirmed features: bounded, deduped, then every id must belong to THIS
  -- post's distinctive features. There is no array-element FK in Postgres, so
  -- this check IS the referential guard for confirmed_feature_ids. The length
  -- bound is checked BEFORE dedupe so a padded payload fails cheaply.
  if array_ndims(v_confirmed) > 1 or cardinality(v_confirmed) > 8 then
    raise exception 'INVALID_INPUT: too many confirmed features';
  end if;
  select coalesce(array_agg(distinct fid), '{}')
    into v_confirmed
  from unnest(v_confirmed) as fid;
  -- SAFETY: one opaque token whichever id is bad — do not reveal WHICH id
  -- failed (no probing another post's feature ids through error detail).
  if exists (
       select 1
       from unnest(v_confirmed) as fid
       where not exists (
         select 1
         from public.post_distinctive_feature df
         where df.id = fid
           and df.post_id = p_post_id)) then
    raise exception 'INVALID_INPUT: unknown feature id';
  end if;

  -- --- NEW 20261019100000 (c): offered features ---------------------------------
  -- The marks the wizard SHOWED the spotter. Skipped entirely when NULL: an
  -- older client said nothing, so we store NULL ("unknown") and apply none of
  -- the rules below — old clients keep working exactly as before.
  if v_offered is not null then
    -- A MALFORMED payload is still a hard reject: same bound (8 = the post's
    -- mark cap), same before-dedupe order, same ndims guard as confirmed.
    if array_ndims(v_offered) > 1 or cardinality(v_offered) > 8 then
      raise exception 'INVALID_INPUT: too many offered features';
    end if;

    -- A STALE id is silently DROPPED, not rejected. The owner can edit their
    -- marks while a spotter is mid-report; offered_feature_ids is display
    -- metadata for the owner, and a mark deleted under the spotter must never
    -- make the whole report — the evidence — fail to send. Intersecting with
    -- THIS post's marks is also the referential guard: no other post's id,
    -- and no made-up id, is ever stored. Nothing is revealed either way (the
    -- call succeeds identically), so this is no oracle. Deduped like
    -- confirmed; '{}' stays '{}' ("asked, nothing to show"), never NULL.
    select coalesce(array_agg(distinct fid), '{}')
      into v_offered
    from unnest(v_offered) as fid
    where exists (
      select 1
      from public.post_distinctive_feature df
      where df.id = fid
        and df.post_id = p_post_id);

    -- A real wizard only confirms marks it showed, so confirmed must be a
    -- subset of offered. Its OWN token rather than the opaque 'unknown
    -- feature id', because it cannot leak anything: by this point every
    -- confirmed id has ALREADY been proven to be one of this post's marks
    -- (else 'unknown feature id' was raised above), and both arrays are the
    -- caller's own input. A distinct token names the client bug precisely.
    -- (The intersection above cannot cause this: it removes only ids that are
    -- not this post's marks, and every confirmed id is one.)
    if not (v_confirmed <@ v_offered) then
      raise exception 'INVALID_INPUT: confirmed feature not offered';
    end if;
  end if;

  -- --- NEW 20261021100000 (c): what damage the spotter could see ---------------
  -- Both answers are optional; an older client sends neither and every rule
  -- below is skipped (both NULL). Each refusal is INVALID_INPUT, BEFORE any
  -- write — the table CHECKs would catch the same rows, but as raw constraint
  -- violations rather than a token the client already maps.
  if v_damage_kinds is not null then
    -- Malformed payloads first, cheaply: a 2-D array, or more entries than
    -- there are kinds (bounded BEFORE dedupe, as confirmed/offered are).
    if array_ndims(v_damage_kinds) > 1 or cardinality(v_damage_kinds) > 6 then
      raise exception 'INVALID_INPUT: too many damage kinds';
    end if;

    -- Every entry, trimmed, must be one of the six. A NULL or blank entry is
    -- refused too: it is no kind at all, and silently dropping it would store
    -- something other than what the spotter's app sent.
    if exists (
         select 1
         from unnest(v_damage_kinds) as k
         where k is null
            or btrim(k) <> all (v_damage_kind_list)) then
      raise exception 'INVALID_INPUT: unknown damage kind';
    end if;

    -- Trimmed, deduped, and stored in the list's own order (so two reports of
    -- the same damage store the same array). '{}' aggregates to NULL: an
    -- empty answer is no answer, never "no damage".
    select array_agg(d.k order by array_position(v_damage_kind_list, d.k))
      into v_damage_kinds
    from (select distinct btrim(x) as k
          from unnest(v_damage_kinds) as x) as d;
  end if;

  -- A note with nothing visible in it (only spaces of any kind — no-break,
  -- figure and narrow ones are named, since [:space:] may not cover them
  -- under every locale — or the blank-looking Hangul filler) is no note.
  -- Same rule as withdraw_sighting (20261009180000).
  if v_damage_note !~ '[^[:space:]\u00A0\u2007\u202F\u3164]' then
    v_damage_note := null;
  end if;

  -- Bounded — refused, not silently cut, so the spotter is never told the
  -- owner got words they didn't.
  if v_damage_note is not null and char_length(v_damage_note) > 300 then
    raise exception 'INVALID_INPUT: damage note too long';
  end if;

  -- SAFETY: no control characters (C0 bar tab and line breaks, and C1), no
  -- soft hyphens, zero-width characters or joiners, and no text-direction
  -- marks. Unmoderated words shown to a theft victim must read as what they
  -- are; a direction override can make a line say something else on screen.
  -- withdraw_note's set, byte for byte, written as escapes for review.
  if v_damage_note ~ '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F\u00AD\u061C\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]' then
    raise exception 'INVALID_INPUT: damage note has hidden characters';
  end if;

  -- Damage detail only beside the damage_visible flag (v_flags has passed the
  -- whitelist above, so it holds no NULL element; @> is NULL-safe anyway).
  -- Checked AFTER normalisation: an empty kinds array and a blank note are
  -- no answer, so a client sending them without the flag is not refused.
  if (v_damage_kinds is not null or v_damage_note is not null)
     and not (v_flags @> array['damage_visible']::text[]) then
    raise exception 'INVALID_INPUT: damage without damage_visible';
  end if;

  -- --- Atomic assembly (single transaction) ------------------------------------
  -- SAFETY: spotter_id pinned to the caller; status HARD-CODED 'unverified';
  -- location_unavailable derived (true only when NO photo carried GPS). The
  -- derivation is UNCHANGED by ADR-0003: gallery photos can never be located
  -- (rejected above), so only live captures can set v_any_located — exactly
  -- the ADR posture: location evidence comes from live capture only.
  -- NEW 20261019100000 (d): offered_feature_ids — NULL when not sent.
  -- NEW 20261021100000 (d): damage_kinds, damage_note — NULL when not sent.
  insert into public.sightings (
    post_id, spotter_id, status, context_flags, note, area_label, locality,
    parked_likelihood, direction, people_presence, confirmed_feature_ids,
    location_unavailable, offered_feature_ids, damage_kinds, damage_note
  )
  values (
    p_post_id, v_spotter, 'unverified', v_flags, p_note, p_area_label, v_locality,
    v_parked_likelihood, v_direction, v_people_presence, v_confirmed,
    not v_any_located, v_offered, v_damage_kinds, v_damage_note
  )
  returning id into v_sighting_id;

  -- Photos: one row per payload element, position = array order (0-based, as
  -- sighting_photos/post_photos expect). source persists the ADR-0003
  -- provenance flag (same absent/blank -> 'live' rule the loop validated).
  insert into public.sighting_photos (
    sighting_id, path, lat, lng, accuracy_m, captured_at, position, source
  )
  select
    v_sighting_id,
    e.value ->> 'path',
    (e.value ->> 'lat')::double precision,
    (e.value ->> 'lng')::double precision,
    (e.value ->> 'accuracy_m')::double precision,
    (e.value ->> 'captured_at')::timestamptz,
    (e.ord - 1)::smallint,
    coalesce(nullif(btrim(e.value ->> 'source'), ''), 'live')
  from jsonb_array_elements(p_photos) with ordinality as e(value, ord);

  -- Reputation v1 (DOMAIN.md): sightings_reported is server-maintained ONLY
  -- (no client grant); this SECURITY DEFINER path is its increment point.
  update public.profiles
  set sightings_reported = sightings_reported + 1
  where id = v_spotter;

  -- AUDIT: a sighting-created audit-log insert belongs here once the audit_log
  -- table exists (SECURITY_AND_TRUST §7). Deferred with the moderation feature.

  return jsonb_build_object('sighting_id', v_sighting_id);
end;
$$;

comment on function public.create_sighting(uuid, jsonb, text[], text, text, text, text, text, text, uuid[], uuid[], text[], text) is
  'The write boundary for reporting a sighting. SECURITY DEFINER: pins spotter_id to the caller, HARD-CODES status=unverified, derives location_unavailable, atomically inserts the sighting + photos and increments profiles.sightings_reported. Gates: active post only, not the caller''s own post, max 3 per rolling 24h per (post, spotter), 1..3 photos each pinned to <post_id>/<own uid>/<filename> with parseable captured_at and both-or-neither GPS, whitelisted context flags (v2 chip set), bounded note/area_label/locality. ADR-0003 gallery hybrid: each photo carries source live/gallery (absent -> live); at least ONE live in-app capture is required per sighting (gallery-only rejected), and a gallery photo may carry NO lat/lng/accuracy_m (payout blindness by construction) — so location_unavailable still derives from live captures only. p_locality (optional) is the coarse PUBLIC place grain (ADR-0008). p_parked_likelihood (optional, settled/street/moving) is captured when parked flag is set. p_direction (optional, N/NE/E/SE/S/SW/W/NW) is captured when driving flag is set. p_people_presence (optional, nobody/nearby/in_vehicle) is the 3-way people observation. p_confirmed_feature_ids (optional, max 8, deduped) must all belong to the post''s distinctive features — this check is the array''s referential guard. p_offered_feature_ids (optional, 20261019100000; max 8, deduped) = the marks the wizard SHOWED: NULL stores NULL (unknown) and skips every offered rule; otherwise ids that are not this post''s marks are silently DROPPED (a mark edited away mid-report must not fail the report), ''{}'' is stored as ''{}'', and confirmed must be a subset of it (INVALID_INPUT: confirmed feature not offered). p_damage_kinds (optional, 20261021100000) = what damage the spotter saw: 1-D, at most 6 entries before dedupe, each (trimmed) one of smashed_window/dents_scrapes/broken_lights/missing_wheels/missing_parts/fire_damage, else INVALID_INPUT; stored deduped in that order, ''{}'' stored as NULL. p_damage_note (optional, 20261021100000) = the spotter''s words: trimmed, blank stored as NULL, over 300 characters or carrying a control / zero-width / text-direction character is INVALID_INPUT. Either one non-NULL without context flag damage_visible is INVALID_INPUT. Raises: NOT_AUTHENTICATED, POST_NOT_ACTIVE, OWN_POST, RATE_LIMITED, INVALID_PHOTOS, INVALID_INPUT.';

-- SAFETY: functions default to EXECUTE for PUBLIC, and Supabase's default
-- privileges re-grant anon at CREATE time — a freshly CREATEd function (unlike
-- a replaced one) starts open. Lock it down, then grant deliberately. Same
-- posture as 20261019100000.
revoke execute on function public.create_sighting(uuid, jsonb, text[], text, text, text, text, text, text, uuid[], uuid[], text[], text)
  from public, anon;
-- Who: signed-in users (to report a sighting) and the service role. Never anon.
grant execute on function public.create_sighting(uuid, jsonb, text[], text, text, text, text, text, text, uuid[], uuid[], text[], text)
  to authenticated, service_role;


-- =============================================================================
-- 3. RPC: get_post_sightings(post_id) -> jsonb   (CREATE OR REPLACE)
-- =============================================================================
-- Restated from 20261019100000 (nothing later redefines it). The ONLY
-- differences are the 'damage_kinds' and 'damage_note' keys: JSON null when
-- not answered. The owner-only gate, the withdrawn filter, the spotter
-- minimisation, confirmed_features and offered_feature_ids are byte-identical.
-- The shipped app's owner schema is a non-strict z.object at row level, so
-- older bundles strip the two new keys rather than failing the parse.
create or replace function public.get_post_sightings(p_post_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_viewer uuid := auth.uid();
  v_owner  uuid;
  v_out    jsonb;
begin
  -- SAFETY: backstop; the grant below already excludes anon.
  if v_viewer is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  -- SAFETY: the ONLY visibility gate — the caller must own the post.
  select p.owner_id into v_owner from public.posts p where p.id = p_post_id;
  if not found or v_owner <> v_viewer then
    raise exception 'NOT_OWNER';
  end if;

  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id',                   s.id,
               'created_at',           s.created_at,
               'status',               s.status,
               -- NEW 2026-08-16: when the OWNER ruled on this sighting.
               -- Their own act, returned to them; see the migration header.
               'reviewed_at',          s.reviewed_at,
               'context_flags',        to_jsonb(s.context_flags),
               'note',                 s.note,
               'area_label',           s.area_label,
               'location_unavailable', s.location_unavailable,
               'parked_likelihood',    s.parked_likelihood,
               'direction',            s.direction,
               'people_presence',      s.people_presence,

               -- Confirmed distinctive marks: {id, description} ONLY (never
               -- photo_url — keep the owner payload lean), ordered by the
               -- feature's display position; [] when none confirmed.
               'confirmed_features', coalesce(
                 (select jsonb_agg(
                           jsonb_build_object(
                             'id',          df.id,
                             'description', df.description)
                           order by df.position)
                    from public.post_distinctive_feature df
                   where df.id = any(s.confirmed_feature_ids)
                     and df.post_id = s.post_id),
                 '[]'::jsonb),

               -- NEW 20261019100000: the marks the spotter was SHOWN. JSON
               -- null = unknown (older report) — the client must not read
               -- that as "not seen"; [] = asked, no marks to show.
               'offered_feature_ids',  to_jsonb(s.offered_feature_ids),

               -- NEW 20261021100000: what damage the spotter saw. Both JSON
               -- null when not answered — never "no damage". The note is the
               -- spotter's own, unmoderated words (SECURITY_AND_TRUST §7):
               -- returned here, to the owner, and nowhere else.
               'damage_kinds',         to_jsonb(s.damage_kinds),
               'damage_note',          s.damage_note,

               -- Exact capture GPS to the owner (SECURITY_AND_TRUST §1:
               -- sighting locations shown to owners are exact). source (NEW,
               -- ADR-0003) drives the owner-facing "added from photo library"
               -- label on gallery photos; gallery rows are structurally
               -- location-free (lat/lng/accuracy_m always null).
               'photos', coalesce(
                 (select jsonb_agg(
                           jsonb_build_object(
                             'path',        sp.path,
                             'lat',         sp.lat,
                             'lng',         sp.lng,
                             'accuracy_m',  sp.accuracy_m,
                             'captured_at', sp.captured_at,
                             'source',      sp.source)
                           order by sp.position)
                    from public.sighting_photos sp
                   where sp.sighting_id = s.id),
                 '[]'::jsonb),

               -- SAFETY: spotter identity minimised — first name + reputation
               -- counters + month-coarsened member-since. NO spotter_id, NO
               -- display_name/surname, NO email, NO avatar path.
               'spotter', jsonb_build_object(
                 'first_name',          pr.first_name,
                 'sightings_reported',  pr.sightings_reported,
                 'sightings_helpful',   pr.sightings_helpful,
                 'recoveries_credited', pr.recoveries_credited,
                 'member_since',        date_trunc('month', pr.created_at))
             )
             order by s.created_at desc),
           '[]'::jsonb)
    into v_out
  from public.sightings s
  join public.profiles pr on pr.id = s.spotter_id
  where s.post_id = p_post_id
    -- ⚠️ A WITHDRAWN sighting is gone from every surface but the spotter's
    -- own record. Withdrawing means "I got this wrong, do not act on it" —
    -- leaving it visible to the owner (or on the public map) would keep the
    -- exact claim the spotter retracted in front of the person it misleads.
    and s.status <> 'withdrawn';

  return v_out;
end;
$$;

comment on function public.get_post_sightings(uuid) is
  'Returns every sighting on ONE post for its OWNER. SECURITY DEFINER; the owner check inside the body is the ONLY visibility gate (missing and not-owned are the same NOT_OWNER, so the id is no oracle). Spotter block is first_name + reputation counters + month-grained member_since — never spotter_id, never a surname. Adds (2026-08-16) reviewed_at: WHEN THE OWNER SET THE CURRENT VERDICT — their own act, returned to them; it is overwritten by a correction, so it is not a history. review_flags and counted_at remain absent (20260814150000): naming the signal that caught a colluding pair is a tutorial in evading it. Withdrawn sightings are excluded (20260903100000). Adds (2026-10-19) offered_feature_ids: the mark ids the spotter was SHOWN — JSON null when unknown (older report; never "not seen"), [] when asked with no marks, else uuids that may include marks since deleted (they simply do not resolve). Adds (2026-10-21) damage_kinds (closed-list array) and damage_note (the spotter''s own unmoderated words, ≤300): JSON null when not answered, never "no damage"; this RPC is their ONLY reader (no client column grant).';

-- SAFETY: CREATE OR REPLACE keeps the ACL; re-stated per house style.
-- Who: the post's owner, signed in (the body enforces ownership). Never anon.
revoke execute on function public.get_post_sightings(uuid) from public, anon;
grant  execute on function public.get_post_sightings(uuid) to authenticated, service_role;


-- =============================================================================
-- END OF MIGRATION
-- =============================================================================

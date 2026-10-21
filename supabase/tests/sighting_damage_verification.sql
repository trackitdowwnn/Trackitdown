-- =============================================================================
-- WHAT:  Verification for "what damage the spotter could see"
--        (20261021100000_a_sighting_says_what_damage.sql). NOT a migration.
-- WHY:   The report wizard asks "What damage can you see?" only after the
--        spotter picked damage_visible. The answer — a closed multi-select and
--        a short free-text note — is the spotter's account for the OWNER
--        alone: it must be stored exactly as validated, never without the
--        flag, never readable straight off the table, and an older app that
--        sends neither must keep reporting exactly as before.
--
-- CHECKS: 1 valid kinds + note are stored (note trimmed, kinds in the list's
-- own order) · 2 duplicate / padded kinds are deduped and trimmed · 3 '{}'
-- kinds and a blank note (only spaces, incl. no-break) are stored as NULL —
-- and, being no answer, need no damage_visible flag · 4 ⚠️ an old client's 11
-- NAMED-arg call (no damage args) still works and stores NULL in both · 5 a
-- note of exactly 300 characters is accepted · 6 refusals, all
-- INVALID_INPUT before any write: unknown / blank / NULL kind, > 6 entries
-- (counted before dedupe), 2-D array, kinds or note without damage_visible,
-- a 301-character note, a direction override, a zero-width space · 7
-- get_post_sightings returns damage_kinds + damage_note to the owner (values,
-- and JSON null when not answered) · 8 a non-owner gets NOT_OWNER · 9 ⚠️ no
-- client role can read or write either column directly · 10 ⚠️ exactly ONE
-- create_sighting, 15 since 20261021120000 (10 defaulted, the damage args
-- 12th and 13th), the 11- and 13-arg signatures gone, grants authenticated/service_role only · 11 the three
-- table CHECKs reject a direct bad write as service_role (constraint names
-- asserted), and a direct good write passes.
-- HOW:   Self-asserting, RAISE on failure (CI's db job, ON_ERROR_STOP=1),
--        everything inside begin/rollback. The suite creates its OWN active
--        post (owner 66666666-…) so other suites' leftovers on seed posts
--        cannot interfere. Spotters 11111111-… and 22222222-… report (≤ 3
--        each: the rate limit); 33333333-… only probes, and every probe
--        raises before inserting. Hidden characters are built with chr(), so
--        no invisible character sits in this file.
-- LINKS: supabase/migrations/20261021100000_a_sighting_says_what_damage.sql;
--        supabase/tests/sighting_marks_offered_verification.sql (the harness
--          this follows);
--        supabase/tests/sighting_missing_parts_verification.sql (CHECK 10 here
--          pins the 15-arg signature since 20261021120000);
--        supabase/tests/withdraw_sighting_verification.sql (CHECK 12 — the
--          same hidden-character set on withdraw_note).
-- =============================================================================

begin;

-- Ids handed between blocks. Dropped by the rollback at the end.
create temp table _dm (k text primary key, v uuid not null);


-- -----------------------------------------------------------------------------
-- SETUP — an active post of the suite's own.
-- -----------------------------------------------------------------------------
do $$
declare
  v_base text := 'http://127.0.0.1:54321/storage/v1/object/public/post-photos/66666666-6666-6666-6666-666666666666/';
  v_doc  jsonb;
  v_post uuid;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"66666666-6666-6666-6666-666666666666","role":"authenticated"}', true);

  v_doc := public.create_post(
    'SD19 DMG', 'Skoda', 'Fabia', 'Green', 2019, 'Hatchback', null, null, null, null,
    null, null, now() - interval '1 day', 53.4808, -2.2426, 'Manchester', 25000,
    array[v_base || 'p0.jpg', v_base || 'p1.jpg', v_base || 'p2.jpg'],
    null, null, '[]'::jsonb);
  v_post := (v_doc ->> 'post_id')::uuid;

  -- A sighting needs a LIVE post; forced directly, as the other suites do.
  update public.posts set status = 'active' where id = v_post;

  insert into _dm (k, v) values ('post', v_post);

  raise notice 'SETUP: active post for the damage suite';
end $$;


-- -----------------------------------------------------------------------------
-- CHECKS 1-3 — spotter 1111 files three reports (their whole 24h allowance).
-- -----------------------------------------------------------------------------
do $$
declare
  v_post  uuid := (select v from _dm where k = 'post');
  v_doc   jsonb;
  v_kinds text[];
  v_note  text;
  v_n1    boolean;
  v_n2    boolean;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);

  -- CHECK 1 — two kinds (sent out of the list's order) and a padded note.
  v_doc := public.create_sighting(
    p_post_id       => v_post,
    p_photos        => jsonb_build_array(jsonb_build_object(
                         'path', v_post::text || '/11111111-1111-1111-1111-111111111111/dm-1.jpg',
                         'captured_at', (now() - interval '3 minutes')::text)),
    p_context_flags => array['parked', 'damage_visible']::text[],
    p_note          => null,
    p_area_label    => 'Ancoats',
    p_damage_kinds  => array['dents_scrapes', 'smashed_window']::text[],
    p_damage_note   => '  Rear window smashed, glass on the road  ');
  insert into _dm values ('s1', (v_doc ->> 'sighting_id')::uuid);

  select damage_kinds, damage_note into v_kinds, v_note
  from public.sightings where id = (v_doc ->> 'sighting_id')::uuid;
  if v_kinds is distinct from array['smashed_window', 'dents_scrapes']::text[] then
    raise exception 'CHECK 1 FAILED: damage_kinds should be {smashed_window,dents_scrapes} (the list''s order), got %', v_kinds;
  end if;
  if v_note is distinct from 'Rear window smashed, glass on the road' then
    raise exception 'CHECK 1 FAILED: damage_note should be stored trimmed, got "%"', v_note;
  end if;

  -- CHECK 2 — duplicates and padding: four entries, two kinds.
  v_doc := public.create_sighting(
    p_post_id       => v_post,
    p_photos        => jsonb_build_array(jsonb_build_object(
                         'path', v_post::text || '/11111111-1111-1111-1111-111111111111/dm-2.jpg',
                         'captured_at', (now() - interval '2 minutes')::text)),
    p_context_flags => array['damage_visible']::text[],
    p_note          => null,
    p_area_label    => null,
    p_damage_kinds  => array[' fire_damage', 'smashed_window', 'fire_damage', 'smashed_window ']::text[]);
  insert into _dm values ('s2', (v_doc ->> 'sighting_id')::uuid);

  select damage_kinds, damage_note into v_kinds, v_note
  from public.sightings where id = (v_doc ->> 'sighting_id')::uuid;
  if v_kinds is distinct from array['smashed_window', 'fire_damage']::text[] then
    raise exception 'CHECK 2 FAILED: duplicates should be trimmed + deduped to {smashed_window,fire_damage}, got %', v_kinds;
  end if;
  if v_note is not null then
    raise exception 'CHECK 2 FAILED: no note was sent, but "%" was stored', v_note;
  end if;

  -- CHECK 3 — '{}' kinds and a note of only spaces (one a no-break space)
  -- are NO answer: both stored NULL, and so no damage_visible flag is needed.
  v_doc := public.create_sighting(
    p_post_id       => v_post,
    p_photos        => jsonb_build_array(jsonb_build_object(
                         'path', v_post::text || '/11111111-1111-1111-1111-111111111111/dm-3.jpg',
                         'captured_at', (now() - interval '1 minute')::text)),
    p_context_flags => array['parked']::text[],
    p_note          => null,
    p_area_label    => null,
    p_damage_kinds  => '{}'::text[],
    p_damage_note   => '   ' || chr(160) || '  ');
  insert into _dm values ('s3', (v_doc ->> 'sighting_id')::uuid);

  select damage_kinds is null, damage_note is null into v_n1, v_n2
  from public.sightings where id = (v_doc ->> 'sighting_id')::uuid;
  if not v_n1 then
    raise exception 'CHECK 3 FAILED: ''{}'' damage kinds must be stored as NULL — an empty answer is no answer';
  end if;
  if not v_n2 then
    raise exception 'CHECK 3 FAILED: a blank damage note must be stored as NULL';
  end if;

  raise notice 'CHECKS 1-3 passed: kinds + note stored (trimmed, list order); duplicates deduped; ''{}'' and blank stored NULL';
end $$;


-- -----------------------------------------------------------------------------
-- CHECKS 4-5 — spotter 2222: the old app's call, and the note's upper bound.
-- -----------------------------------------------------------------------------
do $$
declare
  v_post uuid := (select v from _dm where k = 'post');
  v_doc  jsonb;
  v_n1   boolean;
  v_n2   boolean;
  v_note text;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);

  -- CHECK 4 — ⚠️ the shipped app's call: the 11 NAMED args PostgREST sends,
  -- no p_damage_kinds / p_damage_note. Must resolve (no ambiguity) and store
  -- NULL in both columns, even with damage_visible ticked.
  v_doc := public.create_sighting(
    p_post_id               => v_post,
    p_photos                => jsonb_build_array(jsonb_build_object(
                                 'path', v_post::text || '/22222222-2222-2222-2222-222222222222/dm-4.jpg',
                                 'captured_at', (now() - interval '2 minutes')::text)),
    p_context_flags         => array['parked', 'damage_visible']::text[],
    p_note                  => null,
    p_area_label            => 'Ancoats',
    p_locality              => null,
    p_parked_likelihood     => null,
    p_direction             => null,
    p_people_presence       => null,
    p_confirmed_feature_ids => null,
    p_offered_feature_ids   => null);
  if (v_doc ->> 'sighting_id') is null then
    raise exception 'CHECK 4 FAILED: the old 11-arg call did not report a sighting: %', v_doc;
  end if;
  insert into _dm values ('s4', (v_doc ->> 'sighting_id')::uuid);

  select damage_kinds is null, damage_note is null into v_n1, v_n2
  from public.sightings where id = (v_doc ->> 'sighting_id')::uuid;
  if not (v_n1 and v_n2) then
    raise exception 'CHECK 4 FAILED: an old client''s report must store damage_kinds and damage_note NULL';
  end if;

  -- CHECK 5 — exactly 300 characters (multi-byte, to prove it counts
  -- characters, not bytes): accepted, a note alone with no kinds.
  v_doc := public.create_sighting(
    p_post_id       => v_post,
    p_photos        => jsonb_build_array(jsonb_build_object(
                         'path', v_post::text || '/22222222-2222-2222-2222-222222222222/dm-5.jpg',
                         'captured_at', (now() - interval '1 minute')::text)),
    p_context_flags => array['damage_visible']::text[],
    p_note          => null,
    p_area_label    => null,
    p_damage_note   => repeat(chr(233), 300));
  insert into _dm values ('s5', (v_doc ->> 'sighting_id')::uuid);

  select damage_note into v_note
  from public.sightings where id = (v_doc ->> 'sighting_id')::uuid;
  if v_note is null or char_length(v_note) <> 300 then
    raise exception 'CHECK 5 FAILED: a 300-character note should be stored whole, got % characters', char_length(v_note);
  end if;

  raise notice 'CHECKS 4-5 passed: the old 11 named-arg call stores NULL; a 300-character note is accepted';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 6 — what IS refused. Spotter 3333 probes; each call raises before any
-- insert, so 3333 must end with zero rows on the post.
-- -----------------------------------------------------------------------------
do $$
declare
  v_post  uuid := (select v from _dm where k = 'post');
  v_probe jsonb;
  v_dv    text[] := array['damage_visible']::text[];
  v_hits  int := 0;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
  v_probe := jsonb_build_array(jsonb_build_object(
    'path', v_post::text || '/33333333-3333-3333-3333-333333333333/dm-probe.jpg',
    'captured_at', now()::text));

  -- (a) a kind that is not on the list.
  begin
    perform public.create_sighting(p_post_id => v_post, p_photos => v_probe,
      p_context_flags => v_dv, p_note => null, p_area_label => null,
      p_damage_kinds => array['smashed_window', 'graffiti']::text[]);
    raise exception 'CHECK 6a FAILED: an unknown damage kind was accepted';
  exception when others then
    if sqlerrm like 'INVALID_INPUT: unknown damage kind%' then v_hits := v_hits + 1;
    else raise exception 'CHECK 6a FAILED: expected INVALID_INPUT: unknown damage kind, got: %', sqlerrm; end if;
  end;

  -- (b) a blank entry is no kind.
  begin
    perform public.create_sighting(p_post_id => v_post, p_photos => v_probe,
      p_context_flags => v_dv, p_note => null, p_area_label => null,
      p_damage_kinds => array['smashed_window', '  ']::text[]);
    raise exception 'CHECK 6b FAILED: a blank damage kind was accepted';
  exception when others then
    if sqlerrm like 'INVALID_INPUT: unknown damage kind%' then v_hits := v_hits + 1;
    else raise exception 'CHECK 6b FAILED: expected INVALID_INPUT: unknown damage kind, got: %', sqlerrm; end if;
  end;

  -- (c) a NULL entry is no kind.
  begin
    perform public.create_sighting(p_post_id => v_post, p_photos => v_probe,
      p_context_flags => v_dv, p_note => null, p_area_label => null,
      p_damage_kinds => array['smashed_window', null]::text[]);
    raise exception 'CHECK 6c FAILED: a NULL damage kind was accepted';
  exception when others then
    if sqlerrm like 'INVALID_INPUT: unknown damage kind%' then v_hits := v_hits + 1;
    else raise exception 'CHECK 6c FAILED: expected INVALID_INPUT: unknown damage kind, got: %', sqlerrm; end if;
  end;

  -- (d) 7 copies of ONE real kind -> refused: bounded BEFORE dedupe.
  begin
    perform public.create_sighting(p_post_id => v_post, p_photos => v_probe,
      p_context_flags => v_dv, p_note => null, p_area_label => null,
      p_damage_kinds => array_fill('smashed_window'::text, array[7]));
    raise exception 'CHECK 6d FAILED: 7 padded copies of one kind were accepted (bound applied after dedupe)';
  exception when others then
    if sqlerrm like 'INVALID_INPUT: too many damage kinds%' then v_hits := v_hits + 1;
    else raise exception 'CHECK 6d FAILED: expected INVALID_INPUT: too many damage kinds, got: %', sqlerrm; end if;
  end;

  -- (e) a 2-D array (4 valid kinds, under the bound) -> refused on ndims.
  begin
    perform public.create_sighting(p_post_id => v_post, p_photos => v_probe,
      p_context_flags => v_dv, p_note => null, p_area_label => null,
      p_damage_kinds => array[array['smashed_window', 'dents_scrapes'],
                              array['broken_lights', 'fire_damage']]::text[]);
    raise exception 'CHECK 6e FAILED: a 2-D damage kinds array was accepted';
  exception when others then
    if sqlerrm like 'INVALID_INPUT: too many damage kinds%' then v_hits := v_hits + 1;
    else raise exception 'CHECK 6e FAILED: expected INVALID_INPUT: too many damage kinds, got: %', sqlerrm; end if;
  end;

  -- (f) ⚠️ kinds without the damage_visible flag.
  begin
    perform public.create_sighting(p_post_id => v_post, p_photos => v_probe,
      p_context_flags => array['parked']::text[], p_note => null, p_area_label => null,
      p_damage_kinds => array['smashed_window']::text[]);
    raise exception 'CHECK 6f FAILED: damage kinds were accepted without damage_visible';
  exception when others then
    if sqlerrm like 'INVALID_INPUT: damage without damage_visible%' then v_hits := v_hits + 1;
    else raise exception 'CHECK 6f FAILED: expected INVALID_INPUT: damage without damage_visible, got: %', sqlerrm; end if;
  end;

  -- (g) ⚠️ a note without the damage_visible flag (no flags at all).
  begin
    perform public.create_sighting(p_post_id => v_post, p_photos => v_probe,
      p_context_flags => null, p_note => null, p_area_label => null,
      p_damage_note => 'Dent in the driver''s door');
    raise exception 'CHECK 6g FAILED: a damage note was accepted without damage_visible';
  exception when others then
    if sqlerrm like 'INVALID_INPUT: damage without damage_visible%' then v_hits := v_hits + 1;
    else raise exception 'CHECK 6g FAILED: expected INVALID_INPUT: damage without damage_visible, got: %', sqlerrm; end if;
  end;

  -- (h) 301 characters (after trimming) -> refused, not cut.
  begin
    perform public.create_sighting(p_post_id => v_post, p_photos => v_probe,
      p_context_flags => v_dv, p_note => null, p_area_label => null,
      p_damage_note => '  ' || repeat('a', 301) || '  ');
    raise exception 'CHECK 6h FAILED: a 301-character damage note was accepted';
  exception when others then
    if sqlerrm like 'INVALID_INPUT: damage note too long%' then v_hits := v_hits + 1;
    else raise exception 'CHECK 6h FAILED: expected INVALID_INPUT: damage note too long, got: %', sqlerrm; end if;
  end;

  -- (i) a right-to-left override (U+202E) inside the note.
  begin
    perform public.create_sighting(p_post_id => v_post, p_photos => v_probe,
      p_context_flags => v_dv, p_note => null, p_area_label => null,
      p_damage_note => 'Wheels ' || chr(8238) || 'gone');
    raise exception 'CHECK 6i FAILED: a direction override in the damage note was accepted';
  exception when others then
    if sqlerrm like 'INVALID_INPUT: damage note has hidden characters%' then v_hits := v_hits + 1;
    else raise exception 'CHECK 6i FAILED: expected INVALID_INPUT: damage note has hidden characters, got: %', sqlerrm; end if;
  end;

  -- (j) a trailing zero-width space (U+200B) — not trimmed, so refused.
  begin
    perform public.create_sighting(p_post_id => v_post, p_photos => v_probe,
      p_context_flags => v_dv, p_note => null, p_area_label => null,
      p_damage_note => 'Scraped bumper' || chr(8203));
    raise exception 'CHECK 6j FAILED: a zero-width space in the damage note was accepted';
  exception when others then
    if sqlerrm like 'INVALID_INPUT: damage note has hidden characters%' then v_hits := v_hits + 1;
    else raise exception 'CHECK 6j FAILED: expected INVALID_INPUT: damage note has hidden characters, got: %', sqlerrm; end if;
  end;

  if v_hits <> 10 then
    raise exception 'CHECK 6 FAILED: expected 10 refusals, got %', v_hits;
  end if;
  if exists (select 1 from public.sightings
              where post_id = v_post
                and spotter_id = '33333333-3333-3333-3333-333333333333') then
    raise exception 'CHECK 6 FAILED: a refused probe left a sighting row behind';
  end if;

  raise notice 'CHECK 6 passed: unknown/blank/NULL kind, >6 (pre-dedupe), 2-D, no flag (kinds, note), 301 chars and hidden characters all refused';
end $$;


-- -----------------------------------------------------------------------------
-- CHECKS 7-8 — get_post_sightings: both keys to the OWNER; NOT_OWNER to anyone
-- else.
-- -----------------------------------------------------------------------------
do $$
declare
  v_post uuid := (select v from _dm where k = 'post');
  v_doc  jsonb;
  v_row  jsonb;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"66666666-6666-6666-6666-666666666666","role":"authenticated"}', true);
  v_doc := public.get_post_sightings(v_post);

  if jsonb_array_length(v_doc) <> 5 then
    raise exception 'CHECK 7 FAILED: expected the 5 reports from CHECKS 1-5, got %', jsonb_array_length(v_doc);
  end if;

  -- CHECK 1's row: the kinds as a JSON array, the note as a string.
  select e into v_row from jsonb_array_elements(v_doc) e
   where (e ->> 'id')::uuid = (select v from _dm where k = 's1');
  if (v_row -> 'damage_kinds') is distinct from '["smashed_window", "dents_scrapes"]'::jsonb then
    raise exception 'CHECK 7 FAILED: damage_kinds should be ["smashed_window","dents_scrapes"], got %', v_row -> 'damage_kinds';
  end if;
  if (v_row ->> 'damage_note') is distinct from 'Rear window smashed, glass on the road' then
    raise exception 'CHECK 7 FAILED: damage_note not returned to the owner as stored, got %', v_row -> 'damage_note';
  end if;

  -- CHECK 4's row: both keys PRESENT and JSON null — "not answered".
  select e into v_row from jsonb_array_elements(v_doc) e
   where (e ->> 'id')::uuid = (select v from _dm where k = 's4');
  if not (v_row ? 'damage_kinds' and v_row ? 'damage_note') then
    raise exception 'CHECK 7 FAILED: a key is missing on an old report — keys: %', (select string_agg(k, ', ') from jsonb_object_keys(v_row) k);
  end if;
  if (v_row -> 'damage_kinds') <> 'null'::jsonb or (v_row -> 'damage_note') <> 'null'::jsonb then
    raise exception 'CHECK 7 FAILED: an old report should carry JSON null for both, got % / %', v_row -> 'damage_kinds', v_row -> 'damage_note';
  end if;

  -- CHECK 8 — a spotter on this post (2222) is not its owner.
  perform set_config('request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
  begin
    perform public.get_post_sightings(v_post);
    raise exception 'CHECK 8 FAILED: a non-owner read the post''s sightings (and their damage notes)';
  exception when others then
    if sqlerrm <> 'NOT_OWNER' then
      raise exception 'CHECK 8 FAILED: expected NOT_OWNER, got: %', sqlerrm;
    end if;
  end;

  raise notice 'CHECKS 7-8 passed: the owner gets damage_kinds/damage_note (values, or JSON null); a non-owner gets NOT_OWNER';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 9 — ⚠️ no client role reaches either column directly. Privileges
-- first, then a real SELECT as the spotter who wrote the row (RLS would show
-- them their own sighting — the column grant is what must stop it).
-- -----------------------------------------------------------------------------
do $$
declare
  v_s1     uuid := (select v from _dm where k = 's1');
  v_role   text;
  v_priv   text;
  v_col    text;
  v_kinds  text[];
  v_note   text;
  v_denied int := 0;
begin
  foreach v_role in array array['anon', 'authenticated'] loop
    foreach v_col in array array['damage_kinds', 'damage_note'] loop
      foreach v_priv in array array['SELECT', 'INSERT', 'UPDATE'] loop
        if has_column_privilege(v_role, 'public.sightings', v_col, v_priv) then
          raise exception 'CHECK 9 FAILED: % holds % on sightings.% — it is written by create_sighting and read through get_post_sightings only', v_role, v_priv, v_col;
        end if;
      end loop;
    end loop;
  end loop;

  perform set_config('request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);

  begin
    set local role authenticated;
    select damage_kinds into v_kinds from public.sightings where id = v_s1;
    reset role;
    raise exception 'CHECK 9 FAILED: authenticated SELECTed sightings.damage_kinds directly (got %)', v_kinds;
  exception when insufficient_privilege then
    v_denied := v_denied + 1;  -- 42501; sub-block rollback also reverts the role
  end;

  begin
    set local role authenticated;
    select damage_note into v_note from public.sightings where id = v_s1;
    reset role;
    raise exception 'CHECK 9 FAILED: authenticated SELECTed sightings.damage_note directly (got "%")', v_note;
  exception when insufficient_privilege then
    v_denied := v_denied + 1;
  end;

  if v_denied <> 2 then
    raise exception 'CHECK 9 FAILED: expected 2 grant denials, got %', v_denied;
  end if;

  raise notice 'CHECK 9 passed: anon/authenticated hold no SELECT/INSERT/UPDATE on either column; a direct read is 42501';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 10 — ⚠️ exactly ONE create_sighting, 15 args (13 here; 20261021120000
-- appended p_missing_parts, p_missing_parts_note). A surviving 11-arg
-- overload would make every PostgREST call that omits the damage args
-- ambiguous; the grants must not have come back open after the drop/create.
-- -----------------------------------------------------------------------------
do $$
declare
  -- 15 args since 20261021120000 (the missing-parts args appended).
  v_fn       text := 'public.create_sighting(uuid, jsonb, text[], text, text, text, text, text, text, uuid[], uuid[], text[], text, text[], text)';
  v_n        int;
  v_nargs    int;
  v_defaults int;
  v_names    text[];
begin
  select count(*), max(p.pronargs), max(p.pronargdefaults)
    into v_n, v_nargs, v_defaults
  from pg_proc p
  where p.proname = 'create_sighting'
    and p.pronamespace = 'public'::regnamespace;
  if v_n <> 1 then
    raise exception 'CHECK 10 FAILED: % create_sighting functions exist — an overload makes PostgREST calls ambiguous', v_n;
  end if;
  if v_nargs <> 15 then
    raise exception 'CHECK 10 FAILED: create_sighting should take 15 args (20261021120000), takes %', v_nargs;
  end if;
  -- p_locality onward (10 params) defaulted: every older named-arg call — 5,
  -- 10, 11 or 13 args — must still bind.
  if v_defaults <> 10 then
    raise exception 'CHECK 10 FAILED: create_sighting should have 10 defaulted params, has %', v_defaults;
  end if;
  select p.proargnames into v_names
  from pg_proc p
  where p.proname = 'create_sighting'
    and p.pronamespace = 'public'::regnamespace;
  -- Element by element: array equality also compares lower bounds.
  if v_names[12] is distinct from 'p_damage_kinds'
     or v_names[13] is distinct from 'p_damage_note' then
    raise exception 'CHECK 10 FAILED: the last two params should be p_damage_kinds, p_damage_note (the names the app sends), got %, %', v_names[12], v_names[13];
  end if;
  if to_regprocedure('public.create_sighting(uuid, jsonb, text[], text, text, text, text, text, text, uuid[], uuid[])') is not null then
    raise exception 'CHECK 10 FAILED: the old 11-arg signature still exists';
  end if;
  if to_regprocedure('public.create_sighting(uuid, jsonb, text[], text, text, text, text, text, text, uuid[], uuid[], text[], text)') is not null then
    raise exception 'CHECK 10 FAILED: the 13-arg signature (this suite''s migration) still exists beside the 15-arg one';
  end if;
  if to_regprocedure(v_fn) is null then
    raise exception 'CHECK 10 FAILED: % does not exist', v_fn;
  end if;

  if has_function_privilege('anon', v_fn, 'EXECUTE')
     or has_function_privilege('public', v_fn, 'EXECUTE') then
    raise exception 'CHECK 10 FAILED: anon/PUBLIC can EXECUTE % — the drop/create re-opened it', v_fn;
  end if;
  if not has_function_privilege('authenticated', v_fn, 'EXECUTE')
     or not has_function_privilege('service_role', v_fn, 'EXECUTE') then
    raise exception 'CHECK 10 FAILED: authenticated/service_role cannot EXECUTE % — nobody could report a sighting', v_fn;
  end if;
  if has_function_privilege('anon', 'public.get_post_sightings(uuid)', 'EXECUTE') then
    raise exception 'CHECK 10 FAILED: anon can EXECUTE get_post_sightings';
  end if;

  raise notice 'CHECK 10 passed: one create_sighting, 15 args (10 defaulted, damage 12-13), no 11- or 13-arg overload, authenticated/service_role only';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 11 — the table CHECKs, for any writer: direct writes as service_role
-- (which bypasses RLS and holds INSERT/UPDATE on the table). Each bad write
-- must fail on the NAMED constraint; one good write must pass, so the CHECKs
-- are not simply refusing everything.
-- -----------------------------------------------------------------------------
do $$
declare
  -- Read BEFORE the role switch: service_role cannot see this session's temp
  -- table, which postgres owns.
  v_post uuid := (select v from _dm where k = 'post');
  v_s1   uuid := (select v from _dm where k = 's1');   -- damage_visible, kinds + note
  v_s4   uuid := (select v from _dm where k = 's4');   -- damage_visible, nothing stored
  v_s3   uuid := (select v from _dm where k = 's3');   -- parked only, no flag
  v_con  text;
  v_hits int := 0;
  v_id   uuid;
begin
  -- The first suite to write AS service_role (the others only check its
  -- grants). Supabase grants service_role to postgres; if a future image
  -- stops doing that, say so and run as the session user instead — a CHECK
  -- binds every writer alike, so the assertions below still hold.
  if pg_has_role(current_user, 'service_role', 'MEMBER') then
    set local role service_role;
  else
    raise notice 'CHECK 11: % cannot SET ROLE service_role — writing as % instead', current_user, current_user;
  end if;

  -- (a) INSERT with a kind that is not on the list.
  begin
    insert into public.sightings (post_id, spotter_id, status, context_flags, area_label,
                                  location_unavailable, damage_kinds)
    values (v_post, '22222222-2222-2222-2222-222222222222', 'unverified',
            array['damage_visible'], 'Ancoats', true, array['graffiti']);
    raise exception 'CHECK 11a FAILED: a row with an unknown damage kind was inserted';
  exception when check_violation then
    get stacked diagnostics v_con = constraint_name;
    if v_con = 'sightings_damage_kinds_chk' then v_hits := v_hits + 1;
    else raise exception 'CHECK 11a FAILED: expected sightings_damage_kinds_chk, got %', v_con; end if;
  end;

  -- (b) '{}' — an empty answer must be NULL, not an empty array.
  begin
    update public.sightings set damage_kinds = '{}' where id = v_s4;
    raise exception 'CHECK 11b FAILED: empty damage_kinds was stored';
  exception when check_violation then
    get stacked diagnostics v_con = constraint_name;
    if v_con = 'sightings_damage_kinds_chk' then v_hits := v_hits + 1;
    else raise exception 'CHECK 11b FAILED: expected sightings_damage_kinds_chk, got %', v_con; end if;
  end;

  -- (c) a NULL element.
  begin
    update public.sightings set damage_kinds = array['smashed_window', null] where id = v_s4;
    raise exception 'CHECK 11c FAILED: a NULL damage kind element was stored';
  exception when check_violation then
    get stacked diagnostics v_con = constraint_name;
    if v_con = 'sightings_damage_kinds_chk' then v_hits := v_hits + 1;
    else raise exception 'CHECK 11c FAILED: expected sightings_damage_kinds_chk, got %', v_con; end if;
  end;

  -- (d) a blank note.
  begin
    update public.sightings set damage_note = '   ' where id = v_s4;
    raise exception 'CHECK 11d FAILED: a blank damage note was stored';
  exception when check_violation then
    get stacked diagnostics v_con = constraint_name;
    if v_con = 'sightings_damage_note_chk' then v_hits := v_hits + 1;
    else raise exception 'CHECK 11d FAILED: expected sightings_damage_note_chk, got %', v_con; end if;
  end;

  -- (e) 301 characters.
  begin
    update public.sightings set damage_note = repeat('b', 301) where id = v_s4;
    raise exception 'CHECK 11e FAILED: a 301-character damage note was stored';
  exception when check_violation then
    get stacked diagnostics v_con = constraint_name;
    if v_con = 'sightings_damage_note_chk' then v_hits := v_hits + 1;
    else raise exception 'CHECK 11e FAILED: expected sightings_damage_note_chk, got %', v_con; end if;
  end;

  -- (f) a direction override.
  begin
    update public.sightings set damage_note = 'ok ' || chr(8238) || 'x' where id = v_s4;
    raise exception 'CHECK 11f FAILED: a direction override in the damage note was stored';
  exception when check_violation then
    get stacked diagnostics v_con = constraint_name;
    if v_con = 'sightings_damage_note_chk' then v_hits := v_hits + 1;
    else raise exception 'CHECK 11f FAILED: expected sightings_damage_note_chk, got %', v_con; end if;
  end;

  -- (g) kinds on a row with no damage_visible flag.
  begin
    update public.sightings set damage_kinds = array['smashed_window'] where id = v_s3;
    raise exception 'CHECK 11g FAILED: damage kinds were stored without damage_visible';
  exception when check_violation then
    get stacked diagnostics v_con = constraint_name;
    if v_con = 'sightings_damage_needs_flag_chk' then v_hits := v_hits + 1;
    else raise exception 'CHECK 11g FAILED: expected sightings_damage_needs_flag_chk, got %', v_con; end if;
  end;

  -- (h) a note on a row with no damage_visible flag.
  begin
    update public.sightings set damage_note = 'Dented door' where id = v_s3;
    raise exception 'CHECK 11h FAILED: a damage note was stored without damage_visible';
  exception when check_violation then
    get stacked diagnostics v_con = constraint_name;
    if v_con = 'sightings_damage_needs_flag_chk' then v_hits := v_hits + 1;
    else raise exception 'CHECK 11h FAILED: expected sightings_damage_needs_flag_chk, got %', v_con; end if;
  end;

  -- (i) taking the flag away from a row that HAS damage detail.
  begin
    update public.sightings set context_flags = array['parked'] where id = v_s1;
    raise exception 'CHECK 11i FAILED: damage_visible was removed from a row carrying damage detail';
  exception when check_violation then
    get stacked diagnostics v_con = constraint_name;
    if v_con = 'sightings_damage_needs_flag_chk' then v_hits := v_hits + 1;
    else raise exception 'CHECK 11i FAILED: expected sightings_damage_needs_flag_chk, got %', v_con; end if;
  end;

  -- Positive control: a well-formed direct write passes.
  insert into public.sightings (post_id, spotter_id, status, context_flags, area_label,
                                location_unavailable, damage_kinds, damage_note)
  values (v_post, '22222222-2222-2222-2222-222222222222', 'unverified',
          array['damage_visible'], 'Ancoats', true,
          array['missing_wheels', 'missing_parts'], 'On bricks, both front wheels gone')
  returning id into v_id;

  reset role;

  if v_hits <> 9 then
    raise exception 'CHECK 11 FAILED: expected 9 constraint refusals, got %', v_hits;
  end if;
  if v_id is null then
    raise exception 'CHECK 11 FAILED: a well-formed direct write was refused';
  end if;

  raise notice 'CHECK 11 passed: the kinds, note and needs-flag CHECKs each refuse a direct bad write; a good one passes';
end $$;

rollback;

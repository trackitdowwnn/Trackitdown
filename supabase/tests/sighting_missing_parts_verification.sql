-- =============================================================================
-- WHAT:  Verification for "which parts are missing"
--        (20261021120000_a_sighting_says_what_is_missing.sql). NOT a migration.
-- WHY:   The report wizard asks "What's missing?" only after the spotter
--        ticked "Missing panels or parts" on the damage step. The answer — a
--        closed multi-select and a short free-text note — is for the OWNER
--        alone: stored exactly as validated, never without the missing_parts
--        damage kind, never readable straight off the table, and the app in
--        testers' hands today (13 named args) must keep reporting unchanged.
--
-- CHECKS: 1 valid parts + note are stored (note trimmed, parts in the list's
-- own order) · 2 duplicate / padded parts are deduped and trimmed · 3 '{}'
-- parts and a blank note are stored as NULL — and, being no answer, need no
-- missing_parts kind · 4 ⚠️ today's app's 13 NAMED-arg call (no parts args)
-- still works, with missing_parts ticked, and stores NULL in both · 5 a note
-- of exactly 300 characters is accepted, alone · 6 refusals, all
-- INVALID_INPUT before any write: unknown (incl. 'wheels') / blank / NULL
-- part, > 6 entries (counted before dedupe), 2-D array, parts or a note
-- without the missing_parts kind (incl. ⚠️ with NO damage kinds at all — the
-- NULL case), a 301-character note, a direction override, a zero-width space
-- · 7 get_post_sightings returns missing_parts + missing_parts_note to the
-- owner (values, and JSON null when not answered) · 8 a non-owner gets
-- NOT_OWNER · 9 ⚠️ no client role can read or write either column directly ·
-- 10 ⚠️ exactly ONE create_sighting, 15 args (10 defaulted, the two new ones
-- last), the 13-arg signature gone, grants authenticated/service_role only ·
-- 11 the three table CHECKs reject a direct bad write as service_role
-- (constraint names asserted, incl. ⚠️ parts beside NULL damage_kinds), and a
-- direct good write passes.
-- HOW:   Self-asserting, RAISE on failure (CI's db job, ON_ERROR_STOP=1),
--        everything inside begin/rollback. The suite creates its OWN active
--        post (owner 66666666-…). Spotters 11111111-… and 22222222-… report
--        (≤ 3 each: the rate limit); 33333333-… only probes, and every probe
--        raises before inserting. Hidden characters are built with chr(), so
--        no invisible character sits in this file. The older 11-arg call is
--        still proven by sighting_damage_verification.sql CHECK 4, which runs
--        against this signature.
-- LINKS: supabase/migrations/20261021120000_a_sighting_says_what_is_missing.sql;
--        supabase/tests/sighting_damage_verification.sql (the harness this
--          follows).
-- =============================================================================

begin;

-- Ids handed between blocks. Dropped by the rollback at the end.
create temp table _mp (k text primary key, v uuid not null);


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
    'SD19 MSP', 'Skoda', 'Octavia', 'Grey', 2019, 'Estate', null, null, null, null,
    null, null, now() - interval '1 day', 53.4808, -2.2426, 'Manchester', 25000,
    array[v_base || 'p0.jpg', v_base || 'p1.jpg', v_base || 'p2.jpg'],
    null, null, '[]'::jsonb);
  v_post := (v_doc ->> 'post_id')::uuid;

  -- A sighting needs a LIVE post; forced directly, as the other suites do.
  update public.posts set status = 'active' where id = v_post;

  insert into _mp (k, v) values ('post', v_post);

  raise notice 'SETUP: active post for the missing-parts suite';
end $$;


-- -----------------------------------------------------------------------------
-- CHECKS 1-3 — spotter 1111 files three reports (their whole 24h allowance).
-- -----------------------------------------------------------------------------
do $$
declare
  v_post  uuid := (select v from _mp where k = 'post');
  v_doc   jsonb;
  v_parts text[];
  v_note  text;
  v_n1    boolean;
  v_n2    boolean;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);

  -- CHECK 1 — two parts (sent out of the list's order) and a padded note.
  v_doc := public.create_sighting(
    p_post_id            => v_post,
    p_photos             => jsonb_build_array(jsonb_build_object(
                              'path', v_post::text || '/11111111-1111-1111-1111-111111111111/mp-1.jpg',
                              'captured_at', (now() - interval '3 minutes')::text)),
    p_context_flags      => array['parked', 'damage_visible']::text[],
    p_note               => null,
    p_area_label         => 'Ancoats',
    p_damage_kinds       => array['missing_parts', 'smashed_window']::text[],
    p_missing_parts      => array['doors', 'bumpers']::text[],
    p_missing_parts_note => '  Both front doors off, rear bumper too  ');
  insert into _mp values ('s1', (v_doc ->> 'sighting_id')::uuid);

  select missing_parts, missing_parts_note into v_parts, v_note
  from public.sightings where id = (v_doc ->> 'sighting_id')::uuid;
  if v_parts is distinct from array['bumpers', 'doors']::text[] then
    raise exception 'CHECK 1 FAILED: missing_parts should be {bumpers,doors} (the list''s order), got %', v_parts;
  end if;
  if v_note is distinct from 'Both front doors off, rear bumper too' then
    raise exception 'CHECK 1 FAILED: missing_parts_note should be stored trimmed, got "%"', v_note;
  end if;

  -- CHECK 2 — duplicates and padding: four entries, two parts.
  v_doc := public.create_sighting(
    p_post_id       => v_post,
    p_photos        => jsonb_build_array(jsonb_build_object(
                         'path', v_post::text || '/11111111-1111-1111-1111-111111111111/mp-2.jpg',
                         'captured_at', (now() - interval '2 minutes')::text)),
    p_context_flags => array['damage_visible']::text[],
    p_note          => null,
    p_area_label    => null,
    p_damage_kinds  => array['missing_parts']::text[],
    p_missing_parts => array[' lights', 'bonnet', 'lights', 'bonnet ']::text[]);
  insert into _mp values ('s2', (v_doc ->> 'sighting_id')::uuid);

  select missing_parts, missing_parts_note into v_parts, v_note
  from public.sightings where id = (v_doc ->> 'sighting_id')::uuid;
  if v_parts is distinct from array['bonnet', 'lights']::text[] then
    raise exception 'CHECK 2 FAILED: duplicates should be trimmed + deduped to {bonnet,lights}, got %', v_parts;
  end if;
  if v_note is not null then
    raise exception 'CHECK 2 FAILED: no note was sent, but "%" was stored', v_note;
  end if;

  -- CHECK 3 — '{}' parts and a note of only spaces (one a no-break space) are
  -- NO answer: both stored NULL, so no missing_parts kind is needed.
  v_doc := public.create_sighting(
    p_post_id            => v_post,
    p_photos             => jsonb_build_array(jsonb_build_object(
                              'path', v_post::text || '/11111111-1111-1111-1111-111111111111/mp-3.jpg',
                              'captured_at', (now() - interval '1 minute')::text)),
    p_context_flags      => array['damage_visible']::text[],
    p_note               => null,
    p_area_label         => null,
    p_damage_kinds       => array['smashed_window']::text[],
    p_missing_parts      => '{}'::text[],
    p_missing_parts_note => '   ' || chr(160) || '  ');
  insert into _mp values ('s3', (v_doc ->> 'sighting_id')::uuid);

  select missing_parts is null, missing_parts_note is null into v_n1, v_n2
  from public.sightings where id = (v_doc ->> 'sighting_id')::uuid;
  if not v_n1 then
    raise exception 'CHECK 3 FAILED: ''{}'' missing parts must be stored as NULL — an empty answer is no answer';
  end if;
  if not v_n2 then
    raise exception 'CHECK 3 FAILED: a blank missing-parts note must be stored as NULL';
  end if;

  raise notice 'CHECKS 1-3 passed: parts + note stored (trimmed, list order); duplicates deduped; ''{}'' and blank stored NULL';
end $$;


-- -----------------------------------------------------------------------------
-- CHECKS 4-5 — spotter 2222: today's app's call, and the note's upper bound.
-- -----------------------------------------------------------------------------
do $$
declare
  v_post uuid := (select v from _mp where k = 'post');
  v_doc  jsonb;
  v_n1   boolean;
  v_n2   boolean;
  v_note text;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);

  -- CHECK 4 — ⚠️ the shipped app's call: the 13 NAMED args PostgREST sends,
  -- no p_missing_parts / p_missing_parts_note. Must resolve (no ambiguity) and
  -- store NULL in both columns, even with missing_parts ticked.
  v_doc := public.create_sighting(
    p_post_id               => v_post,
    p_photos                => jsonb_build_array(jsonb_build_object(
                                 'path', v_post::text || '/22222222-2222-2222-2222-222222222222/mp-4.jpg',
                                 'captured_at', (now() - interval '2 minutes')::text)),
    p_context_flags         => array['parked', 'damage_visible']::text[],
    p_note                  => null,
    p_area_label            => 'Ancoats',
    p_locality              => null,
    p_parked_likelihood     => null,
    p_direction             => null,
    p_people_presence       => null,
    p_confirmed_feature_ids => null,
    p_offered_feature_ids   => null,
    p_damage_kinds          => array['missing_parts']::text[],
    p_damage_note           => null);
  if (v_doc ->> 'sighting_id') is null then
    raise exception 'CHECK 4 FAILED: the 13-arg call did not report a sighting: %', v_doc;
  end if;
  insert into _mp values ('s4', (v_doc ->> 'sighting_id')::uuid);

  select missing_parts is null, missing_parts_note is null into v_n1, v_n2
  from public.sightings where id = (v_doc ->> 'sighting_id')::uuid;
  if not (v_n1 and v_n2) then
    raise exception 'CHECK 4 FAILED: today''s app''s report must store missing_parts and missing_parts_note NULL';
  end if;

  -- CHECK 5 — exactly 300 characters (multi-byte, to prove it counts
  -- characters, not bytes): accepted, a note alone with no parts.
  v_doc := public.create_sighting(
    p_post_id            => v_post,
    p_photos             => jsonb_build_array(jsonb_build_object(
                              'path', v_post::text || '/22222222-2222-2222-2222-222222222222/mp-5.jpg',
                              'captured_at', (now() - interval '1 minute')::text)),
    p_context_flags      => array['damage_visible']::text[],
    p_note               => null,
    p_area_label         => null,
    p_damage_kinds       => array['missing_parts']::text[],
    p_missing_parts_note => repeat(chr(233), 300));
  insert into _mp values ('s5', (v_doc ->> 'sighting_id')::uuid);

  select missing_parts_note into v_note
  from public.sightings where id = (v_doc ->> 'sighting_id')::uuid;
  if v_note is null or char_length(v_note) <> 300 then
    raise exception 'CHECK 5 FAILED: a 300-character note should be stored whole, got % characters', char_length(v_note);
  end if;

  raise notice 'CHECKS 4-5 passed: the 13 named-arg call stores NULL; a 300-character note is accepted';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 6 — what IS refused. Spotter 3333 probes; each call raises before any
-- insert, so 3333 must end with zero rows on the post.
-- -----------------------------------------------------------------------------
do $$
declare
  v_post  uuid := (select v from _mp where k = 'post');
  v_probe jsonb;
  v_dv    text[] := array['damage_visible']::text[];
  v_mp    text[] := array['missing_parts']::text[];
  v_hits  int := 0;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
  v_probe := jsonb_build_array(jsonb_build_object(
    'path', v_post::text || '/33333333-3333-3333-3333-333333333333/mp-probe.jpg',
    'captured_at', now()::text));

  -- (a) a part that is not on the list — wheels are a damage kind, not a part.
  begin
    perform public.create_sighting(p_post_id => v_post, p_photos => v_probe,
      p_context_flags => v_dv, p_note => null, p_area_label => null,
      p_damage_kinds => v_mp, p_missing_parts => array['doors', 'wheels']::text[]);
    raise exception 'CHECK 6a FAILED: an unknown part was accepted';
  exception when others then
    if sqlerrm like 'INVALID_INPUT: unknown missing part%' then v_hits := v_hits + 1;
    else raise exception 'CHECK 6a FAILED: expected INVALID_INPUT: unknown missing part, got: %', sqlerrm; end if;
  end;

  -- (b) a blank entry is no part.
  begin
    perform public.create_sighting(p_post_id => v_post, p_photos => v_probe,
      p_context_flags => v_dv, p_note => null, p_area_label => null,
      p_damage_kinds => v_mp, p_missing_parts => array['doors', '  ']::text[]);
    raise exception 'CHECK 6b FAILED: a blank part was accepted';
  exception when others then
    if sqlerrm like 'INVALID_INPUT: unknown missing part%' then v_hits := v_hits + 1;
    else raise exception 'CHECK 6b FAILED: expected INVALID_INPUT: unknown missing part, got: %', sqlerrm; end if;
  end;

  -- (c) a NULL entry is no part.
  begin
    perform public.create_sighting(p_post_id => v_post, p_photos => v_probe,
      p_context_flags => v_dv, p_note => null, p_area_label => null,
      p_damage_kinds => v_mp, p_missing_parts => array['doors', null]::text[]);
    raise exception 'CHECK 6c FAILED: a NULL part was accepted';
  exception when others then
    if sqlerrm like 'INVALID_INPUT: unknown missing part%' then v_hits := v_hits + 1;
    else raise exception 'CHECK 6c FAILED: expected INVALID_INPUT: unknown missing part, got: %', sqlerrm; end if;
  end;

  -- (d) 7 copies of ONE real part -> refused: bounded BEFORE dedupe.
  begin
    perform public.create_sighting(p_post_id => v_post, p_photos => v_probe,
      p_context_flags => v_dv, p_note => null, p_area_label => null,
      p_damage_kinds => v_mp, p_missing_parts => array_fill('doors'::text, array[7]));
    raise exception 'CHECK 6d FAILED: 7 padded copies of one part were accepted (bound applied after dedupe)';
  exception when others then
    if sqlerrm like 'INVALID_INPUT: too many missing parts%' then v_hits := v_hits + 1;
    else raise exception 'CHECK 6d FAILED: expected INVALID_INPUT: too many missing parts, got: %', sqlerrm; end if;
  end;

  -- (e) a 2-D array (4 valid parts, under the bound) -> refused on ndims.
  begin
    perform public.create_sighting(p_post_id => v_post, p_photos => v_probe,
      p_context_flags => v_dv, p_note => null, p_area_label => null,
      p_damage_kinds => v_mp,
      p_missing_parts => array[array['doors', 'bonnet'], array['lights', 'bumpers']]::text[]);
    raise exception 'CHECK 6e FAILED: a 2-D missing parts array was accepted';
  exception when others then
    if sqlerrm like 'INVALID_INPUT: too many missing parts%' then v_hits := v_hits + 1;
    else raise exception 'CHECK 6e FAILED: expected INVALID_INPUT: too many missing parts, got: %', sqlerrm; end if;
  end;

  -- (f) ⚠️ parts beside damage kinds that do NOT include missing_parts.
  begin
    perform public.create_sighting(p_post_id => v_post, p_photos => v_probe,
      p_context_flags => v_dv, p_note => null, p_area_label => null,
      p_damage_kinds => array['smashed_window']::text[],
      p_missing_parts => array['doors']::text[]);
    raise exception 'CHECK 6f FAILED: parts were accepted without the missing_parts kind';
  exception when others then
    if sqlerrm like 'INVALID_INPUT: missing parts without missing_parts%' then v_hits := v_hits + 1;
    else raise exception 'CHECK 6f FAILED: expected INVALID_INPUT: missing parts without missing_parts, got: %', sqlerrm; end if;
  end;

  -- (g) ⚠️ a note with NO damage kinds at all (NULL) — the case a bare
  -- `not (NULL @> …)` would have let through.
  begin
    perform public.create_sighting(p_post_id => v_post, p_photos => v_probe,
      p_context_flags => v_dv, p_note => null, p_area_label => null,
      p_missing_parts_note => 'Front bumper gone');
    raise exception 'CHECK 6g FAILED: a missing-parts note was accepted with no damage kinds';
  exception when others then
    if sqlerrm like 'INVALID_INPUT: missing parts without missing_parts%' then v_hits := v_hits + 1;
    else raise exception 'CHECK 6g FAILED: expected INVALID_INPUT: missing parts without missing_parts, got: %', sqlerrm; end if;
  end;

  -- (h) ⚠️ parts on a report with no damage at all (no flag, no kinds).
  begin
    perform public.create_sighting(p_post_id => v_post, p_photos => v_probe,
      p_context_flags => array['parked']::text[], p_note => null, p_area_label => null,
      p_missing_parts => array['bonnet']::text[]);
    raise exception 'CHECK 6h FAILED: parts were accepted on a report with no damage';
  exception when others then
    if sqlerrm like 'INVALID_INPUT: missing parts without missing_parts%' then v_hits := v_hits + 1;
    else raise exception 'CHECK 6h FAILED: expected INVALID_INPUT: missing parts without missing_parts, got: %', sqlerrm; end if;
  end;

  -- (i) 301 characters (after trimming) -> refused, not cut.
  begin
    perform public.create_sighting(p_post_id => v_post, p_photos => v_probe,
      p_context_flags => v_dv, p_note => null, p_area_label => null,
      p_damage_kinds => v_mp, p_missing_parts_note => '  ' || repeat('a', 301) || '  ');
    raise exception 'CHECK 6i FAILED: a 301-character missing-parts note was accepted';
  exception when others then
    if sqlerrm like 'INVALID_INPUT: missing parts note too long%' then v_hits := v_hits + 1;
    else raise exception 'CHECK 6i FAILED: expected INVALID_INPUT: missing parts note too long, got: %', sqlerrm; end if;
  end;

  -- (j) a right-to-left override (U+202E) inside the note.
  begin
    perform public.create_sighting(p_post_id => v_post, p_photos => v_probe,
      p_context_flags => v_dv, p_note => null, p_area_label => null,
      p_damage_kinds => v_mp, p_missing_parts_note => 'Doors ' || chr(8238) || 'gone');
    raise exception 'CHECK 6j FAILED: a direction override in the missing-parts note was accepted';
  exception when others then
    if sqlerrm like 'INVALID_INPUT: missing parts note has hidden characters%' then v_hits := v_hits + 1;
    else raise exception 'CHECK 6j FAILED: expected INVALID_INPUT: missing parts note has hidden characters, got: %', sqlerrm; end if;
  end;

  -- (k) a trailing zero-width space (U+200B) — not trimmed, so refused.
  begin
    perform public.create_sighting(p_post_id => v_post, p_photos => v_probe,
      p_context_flags => v_dv, p_note => null, p_area_label => null,
      p_damage_kinds => v_mp, p_missing_parts_note => 'No bonnet' || chr(8203));
    raise exception 'CHECK 6k FAILED: a zero-width space in the missing-parts note was accepted';
  exception when others then
    if sqlerrm like 'INVALID_INPUT: missing parts note has hidden characters%' then v_hits := v_hits + 1;
    else raise exception 'CHECK 6k FAILED: expected INVALID_INPUT: missing parts note has hidden characters, got: %', sqlerrm; end if;
  end;

  if v_hits <> 11 then
    raise exception 'CHECK 6 FAILED: expected 11 refusals, got %', v_hits;
  end if;
  if exists (select 1 from public.sightings
              where post_id = v_post
                and spotter_id = '33333333-3333-3333-3333-333333333333') then
    raise exception 'CHECK 6 FAILED: a refused probe left a sighting row behind';
  end if;

  raise notice 'CHECK 6 passed: unknown/blank/NULL part, >6 (pre-dedupe), 2-D, no missing_parts kind (incl. NULL kinds, no damage), 301 chars and hidden characters all refused';
end $$;


-- -----------------------------------------------------------------------------
-- CHECKS 7-8 — get_post_sightings: both keys to the OWNER; NOT_OWNER to anyone
-- else.
-- -----------------------------------------------------------------------------
do $$
declare
  v_post uuid := (select v from _mp where k = 'post');
  v_doc  jsonb;
  v_row  jsonb;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"66666666-6666-6666-6666-666666666666","role":"authenticated"}', true);
  v_doc := public.get_post_sightings(v_post);

  if jsonb_array_length(v_doc) <> 5 then
    raise exception 'CHECK 7 FAILED: expected the 5 reports from CHECKS 1-5, got %', jsonb_array_length(v_doc);
  end if;

  -- CHECK 1's row: the parts as a JSON array, the note as a string.
  select e into v_row from jsonb_array_elements(v_doc) e
   where (e ->> 'id')::uuid = (select v from _mp where k = 's1');
  if (v_row -> 'missing_parts') is distinct from '["bumpers", "doors"]'::jsonb then
    raise exception 'CHECK 7 FAILED: missing_parts should be ["bumpers","doors"], got %', v_row -> 'missing_parts';
  end if;
  if (v_row ->> 'missing_parts_note') is distinct from 'Both front doors off, rear bumper too' then
    raise exception 'CHECK 7 FAILED: missing_parts_note not returned to the owner as stored, got %', v_row -> 'missing_parts_note';
  end if;

  -- CHECK 4's row: both keys PRESENT and JSON null — "not answered".
  select e into v_row from jsonb_array_elements(v_doc) e
   where (e ->> 'id')::uuid = (select v from _mp where k = 's4');
  if not (v_row ? 'missing_parts' and v_row ? 'missing_parts_note') then
    raise exception 'CHECK 7 FAILED: a key is missing on a 13-arg report — keys: %', (select string_agg(k, ', ') from jsonb_object_keys(v_row) k);
  end if;
  if (v_row -> 'missing_parts') <> 'null'::jsonb or (v_row -> 'missing_parts_note') <> 'null'::jsonb then
    raise exception 'CHECK 7 FAILED: a 13-arg report should carry JSON null for both, got % / %', v_row -> 'missing_parts', v_row -> 'missing_parts_note';
  end if;

  -- CHECK 8 — a spotter on this post (2222) is not its owner.
  perform set_config('request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
  begin
    perform public.get_post_sightings(v_post);
    raise exception 'CHECK 8 FAILED: a non-owner read the post''s sightings (and their missing-parts notes)';
  exception when others then
    if sqlerrm <> 'NOT_OWNER' then
      raise exception 'CHECK 8 FAILED: expected NOT_OWNER, got: %', sqlerrm;
    end if;
  end;

  raise notice 'CHECKS 7-8 passed: the owner gets missing_parts/missing_parts_note (values, or JSON null); a non-owner gets NOT_OWNER';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 9 — ⚠️ no client role reaches either column directly. Privileges
-- first, then a real SELECT as the spotter who wrote the row (RLS would show
-- them their own sighting — the column grant is what must stop it).
-- -----------------------------------------------------------------------------
do $$
declare
  v_s1     uuid := (select v from _mp where k = 's1');
  v_role   text;
  v_priv   text;
  v_col    text;
  v_parts  text[];
  v_note   text;
  v_denied int := 0;
begin
  foreach v_role in array array['anon', 'authenticated'] loop
    foreach v_col in array array['missing_parts', 'missing_parts_note'] loop
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
    select missing_parts into v_parts from public.sightings where id = v_s1;
    reset role;
    raise exception 'CHECK 9 FAILED: authenticated SELECTed sightings.missing_parts directly (got %)', v_parts;
  exception when insufficient_privilege then
    v_denied := v_denied + 1;  -- 42501; sub-block rollback also reverts the role
  end;

  begin
    set local role authenticated;
    select missing_parts_note into v_note from public.sightings where id = v_s1;
    reset role;
    raise exception 'CHECK 9 FAILED: authenticated SELECTed sightings.missing_parts_note directly (got "%")', v_note;
  exception when insufficient_privilege then
    v_denied := v_denied + 1;
  end;

  if v_denied <> 2 then
    raise exception 'CHECK 9 FAILED: expected 2 grant denials, got %', v_denied;
  end if;

  raise notice 'CHECK 9 passed: anon/authenticated hold no SELECT/INSERT/UPDATE on either column; a direct read is 42501';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 10 — ⚠️ exactly ONE create_sighting, 15 args. A surviving 13-arg
-- overload would make every PostgREST call from today's app ambiguous; the
-- grants must not have come back open after the drop/create.
-- -----------------------------------------------------------------------------
do $$
declare
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
    raise exception 'CHECK 10 FAILED: create_sighting should take 15 args, takes %', v_nargs;
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
  if v_names[14] is distinct from 'p_missing_parts'
     or v_names[15] is distinct from 'p_missing_parts_note' then
    raise exception 'CHECK 10 FAILED: the last two params should be p_missing_parts, p_missing_parts_note (the names the app sends), got %, %', v_names[14], v_names[15];
  end if;
  if to_regprocedure('public.create_sighting(uuid, jsonb, text[], text, text, text, text, text, text, uuid[], uuid[], text[], text)') is not null then
    raise exception 'CHECK 10 FAILED: the old 13-arg signature still exists';
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

  raise notice 'CHECK 10 passed: one create_sighting, 15 args (10 defaulted, missing parts last), no 13-arg overload, authenticated/service_role only';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 11 — the table CHECKs, for any writer: direct writes as service_role.
-- Each bad write must fail on the NAMED constraint; one good write must pass.
-- -----------------------------------------------------------------------------
do $$
declare
  -- Read BEFORE the role switch: service_role cannot see this session's temp
  -- table, which postgres owns.
  v_post uuid := (select v from _mp where k = 'post');
  v_s1   uuid := (select v from _mp where k = 's1');   -- missing_parts kind, parts + note
  v_s3   uuid := (select v from _mp where k = 's3');   -- damage kinds without missing_parts
  v_s4   uuid := (select v from _mp where k = 's4');   -- missing_parts kind, nothing stored
  v_con  text;
  v_hits int := 0;
  v_id   uuid;
begin
  if pg_has_role(current_user, 'service_role', 'MEMBER') then
    set local role service_role;
  else
    raise notice 'CHECK 11: % cannot SET ROLE service_role — writing as % instead', current_user, current_user;
  end if;

  -- (a) INSERT with a part that is not on the list.
  begin
    insert into public.sightings (post_id, spotter_id, status, context_flags, area_label,
                                  location_unavailable, damage_kinds, missing_parts)
    values (v_post, '22222222-2222-2222-2222-222222222222', 'unverified',
            array['damage_visible'], 'Ancoats', true, array['missing_parts'], array['wheels']);
    raise exception 'CHECK 11a FAILED: a row with an unknown part was inserted';
  exception when check_violation then
    get stacked diagnostics v_con = constraint_name;
    if v_con = 'sightings_missing_parts_chk' then v_hits := v_hits + 1;
    else raise exception 'CHECK 11a FAILED: expected sightings_missing_parts_chk, got %', v_con; end if;
  end;

  -- (b) '{}' — an empty answer must be NULL, not an empty array.
  begin
    update public.sightings set missing_parts = '{}' where id = v_s4;
    raise exception 'CHECK 11b FAILED: empty missing_parts was stored';
  exception when check_violation then
    get stacked diagnostics v_con = constraint_name;
    if v_con = 'sightings_missing_parts_chk' then v_hits := v_hits + 1;
    else raise exception 'CHECK 11b FAILED: expected sightings_missing_parts_chk, got %', v_con; end if;
  end;

  -- (c) a NULL element.
  begin
    update public.sightings set missing_parts = array['doors', null] where id = v_s4;
    raise exception 'CHECK 11c FAILED: a NULL part element was stored';
  exception when check_violation then
    get stacked diagnostics v_con = constraint_name;
    if v_con = 'sightings_missing_parts_chk' then v_hits := v_hits + 1;
    else raise exception 'CHECK 11c FAILED: expected sightings_missing_parts_chk, got %', v_con; end if;
  end;

  -- (d) a blank note.
  begin
    update public.sightings set missing_parts_note = '   ' where id = v_s4;
    raise exception 'CHECK 11d FAILED: a blank missing-parts note was stored';
  exception when check_violation then
    get stacked diagnostics v_con = constraint_name;
    if v_con = 'sightings_missing_parts_note_chk' then v_hits := v_hits + 1;
    else raise exception 'CHECK 11d FAILED: expected sightings_missing_parts_note_chk, got %', v_con; end if;
  end;

  -- (e) 301 characters.
  begin
    update public.sightings set missing_parts_note = repeat('b', 301) where id = v_s4;
    raise exception 'CHECK 11e FAILED: a 301-character missing-parts note was stored';
  exception when check_violation then
    get stacked diagnostics v_con = constraint_name;
    if v_con = 'sightings_missing_parts_note_chk' then v_hits := v_hits + 1;
    else raise exception 'CHECK 11e FAILED: expected sightings_missing_parts_note_chk, got %', v_con; end if;
  end;

  -- (f) a direction override.
  begin
    update public.sightings set missing_parts_note = 'ok ' || chr(8238) || 'x' where id = v_s4;
    raise exception 'CHECK 11f FAILED: a direction override in the missing-parts note was stored';
  exception when check_violation then
    get stacked diagnostics v_con = constraint_name;
    if v_con = 'sightings_missing_parts_note_chk' then v_hits := v_hits + 1;
    else raise exception 'CHECK 11f FAILED: expected sightings_missing_parts_note_chk, got %', v_con; end if;
  end;

  -- (g) parts on a row whose damage kinds lack missing_parts.
  begin
    update public.sightings set missing_parts = array['doors'] where id = v_s3;
    raise exception 'CHECK 11g FAILED: parts were stored without the missing_parts kind';
  exception when check_violation then
    get stacked diagnostics v_con = constraint_name;
    if v_con = 'sightings_missing_parts_need_kind_chk' then v_hits := v_hits + 1;
    else raise exception 'CHECK 11g FAILED: expected sightings_missing_parts_need_kind_chk, got %', v_con; end if;
  end;

  -- (h) ⚠️ parts beside NULL damage_kinds — `= any(NULL)` would have passed.
  begin
    insert into public.sightings (post_id, spotter_id, status, context_flags, area_label,
                                  location_unavailable, missing_parts)
    values (v_post, '22222222-2222-2222-2222-222222222222', 'unverified',
            array['damage_visible'], 'Ancoats', true, array['doors']);
    raise exception 'CHECK 11h FAILED: parts were stored beside NULL damage_kinds';
  exception when check_violation then
    get stacked diagnostics v_con = constraint_name;
    if v_con = 'sightings_missing_parts_need_kind_chk' then v_hits := v_hits + 1;
    else raise exception 'CHECK 11h FAILED: expected sightings_missing_parts_need_kind_chk, got %', v_con; end if;
  end;

  -- (i) taking missing_parts away from a row that HAS parts.
  begin
    update public.sightings set damage_kinds = array['smashed_window'] where id = v_s1;
    raise exception 'CHECK 11i FAILED: missing_parts was removed from a row carrying parts';
  exception when check_violation then
    get stacked diagnostics v_con = constraint_name;
    if v_con = 'sightings_missing_parts_need_kind_chk' then v_hits := v_hits + 1;
    else raise exception 'CHECK 11i FAILED: expected sightings_missing_parts_need_kind_chk, got %', v_con; end if;
  end;

  -- Positive control: a well-formed direct write passes.
  insert into public.sightings (post_id, spotter_id, status, context_flags, area_label,
                                location_unavailable, damage_kinds, missing_parts,
                                missing_parts_note)
  values (v_post, '22222222-2222-2222-2222-222222222222', 'unverified',
          array['damage_visible'], 'Ancoats', true,
          array['missing_parts'], array['wing_mirrors', 'number_plates'], 'Both mirrors gone')
  returning id into v_id;

  reset role;

  if v_hits <> 9 then
    raise exception 'CHECK 11 FAILED: expected 9 constraint refusals, got %', v_hits;
  end if;
  if v_id is null then
    raise exception 'CHECK 11 FAILED: a well-formed direct write was refused';
  end if;

  raise notice 'CHECK 11 passed: the parts, note and need-kind CHECKs each refuse a direct bad write; a good one passes';
end $$;

rollback;

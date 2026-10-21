-- =============================================================================
-- WHAT:  Verification for "which marks the spotter was asked about, and which
--        they saw" (20261019100000_a_sighting_remembers_what_it_asked.sql).
--        NOT a migration.
-- WHY:   The owner's sighting page lists every mark on the listing and ticks
--        the ones the spotter could see. That is only honest if (a) we know
--        which marks the spotter was SHOWN — unknown must never read as "not
--        seen" — and (b) a mark keeps its id when the owner edits the
--        listing, so a confirmation made last week still points at it.
--
-- CHECKS: 1 offered ids are stored, deduped · 2 ⚠️ an old client's 10
-- named-arg call still works and stores NULL (unknown), with no subset rule
-- · 3 '{}' is stored as '{}', never NULL · 4 ⚠️ a STALE offered id (another
-- post's mark, a deleted / made-up id) is dropped and the report still sends;
-- all-stale stores '{}' · 5 malformed / inconsistent payloads are refused:
-- confirmed not offered, > 8 ids (counted before dedupe), 2-D arrays; and a
-- foreign CONFIRMED id is still a hard reject · 6 get_post_sightings returns
-- offered_feature_ids to the owner (null / [] / ids) · 7 ⚠️ an edit that
-- keeps the same photos keeps the SAME ids, so confirmed_features still
-- resolve, and queues no photo as an orphan · 8 a description-only edit keeps
-- the id · 9 a reorder moves positions, not ids · 10 removing a mark deletes
-- it, adding one inserts a new id; a duplicated URL claims the old row once
-- · 11 ⚠️ exactly ONE create_sighting exists (no overload — PostgREST would
-- call it ambiguous) · 12 grants, and the column is unreadable/unwritable by
-- any client.
-- HOW:   Self-asserting, RAISE on failure (CI's db job, ON_ERROR_STOP=1),
--        everything inside begin/rollback. The suite creates its OWN active
--        post (owner 66666666-…) so other suites' leftovers on seed posts
--        cannot interfere; the decoy mark sits on seed post a1a1a1a1-…0005.
--        Spotters 11111111-…, 22222222-… report (≤ 3 each: the rate limit);
--        33333333-… only probes, and every probe raises before inserting.
-- LINKS: supabase/migrations/20261019100000_a_sighting_remembers_what_it_asked.sql;
--        supabase/tests/sightings_verification.sql (CHECK 21/22 — the
--          confirmed-ids rules this leaves unchanged);
--        supabase/tests/edit_post_sections_verification.sql (CHECK 6 — the
--          marks edit's validation and trimming).
-- =============================================================================

begin;

-- Ids handed between blocks (marks by letter, sightings by check). Dropped by
-- the rollback at the end.
create temp table _om (k text primary key, v uuid not null);


-- -----------------------------------------------------------------------------
-- SETUP — an active post with three marks A/B/C, and a decoy mark on another
-- post. Marks are written through update_post_distinctive_features itself, as
-- the owner, so the setup also exercises the insert path.
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
    'SM19 OFR', 'Skoda', 'Fabia', 'Green', 2019, 'Hatchback', null, null, null, null,
    null, null, now() - interval '1 day', 53.4808, -2.2426, 'Manchester', 25000,
    array[v_base || 'p0.jpg', v_base || 'p1.jpg', v_base || 'p2.jpg'],
    null, null, '[]'::jsonb);
  v_post := (v_doc ->> 'post_id')::uuid;

  -- A sighting needs a LIVE post; forced directly, as the other suites do.
  update public.posts set status = 'active' where id = v_post;

  perform public.update_post_distinctive_features(v_post, jsonb_build_array(
    jsonb_build_object('photo_url', v_base || 'om-a.jpg', 'description', 'Cracked nearside mirror'),
    jsonb_build_object('photo_url', v_base || 'om-b.jpg', 'description', 'Bee sticker on the boot'),
    jsonb_build_object('photo_url', v_base || 'om-c.jpg', 'description', 'Roof bars')));

  insert into _om (k, v) values ('post', v_post);
  insert into _om (k, v)
  select chr(ascii('A') + df.position), df.id
  from public.post_distinctive_feature df
  where df.post_id = v_post;

  if (select count(*) from _om where k in ('A', 'B', 'C')) <> 3 then
    raise exception 'SETUP FAILED: expected marks A/B/C at positions 0-2';
  end if;

  -- The decoy: a real mark on a DIFFERENT post (seed post …0005).
  delete from public.post_distinctive_feature where id = 'dfa20000-0000-0000-0000-0000000000ff';
  insert into public.post_distinctive_feature (id, post_id, photo_url, description, position)
  values ('dfa20000-0000-0000-0000-0000000000ff', 'a1a1a1a1-0000-0000-0000-000000000005',
          'https://example.test/storage/v1/object/public/post-photos/decoy.jpg',
          'Another car''s mark', 0);

  raise notice 'SETUP: active post with marks A/B/C, decoy mark on another post';
end $$;


-- -----------------------------------------------------------------------------
-- CHECKS 1-3 — spotter 1111 files three reports (their whole 24h allowance).
-- -----------------------------------------------------------------------------
do $$
declare
  v_post uuid := (select v from _om where k = 'post');
  v_a    uuid := (select v from _om where k = 'A');
  v_b    uuid := (select v from _om where k = 'B');
  v_doc  jsonb;
  v_off  uuid[];
  v_conf uuid[];
  v_null boolean;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);

  -- CHECK 1 — offered [A, B, A] + confirmed [A]: stored deduped, accepted.
  v_doc := public.create_sighting(
    v_post,
    jsonb_build_array(jsonb_build_object(
      'path', v_post::text || '/11111111-1111-1111-1111-111111111111/om-1.jpg',
      'captured_at', (now() - interval '3 minutes')::text)),
    null, null, null, null, null, null, null,
    array[v_a]::uuid[],
    array[v_a, v_b, v_a]::uuid[]);
  insert into _om values ('s1', (v_doc ->> 'sighting_id')::uuid);

  select offered_feature_ids, confirmed_feature_ids into v_off, v_conf
  from public.sightings where id = (v_doc ->> 'sighting_id')::uuid;
  if v_off is null or cardinality(v_off) <> 2
     or not (v_off @> array[v_a, v_b]) then
    raise exception 'CHECK 1 FAILED: offered_feature_ids should be {A, B} deduped, got %', v_off;
  end if;
  if v_conf is distinct from array[v_a] then
    raise exception 'CHECK 1 FAILED: confirmed_feature_ids should be {A}, got %', v_conf;
  end if;

  -- CHECK 2 — ⚠️ the shipped app's call: the 10 NAMED args PostgREST sends,
  -- no p_offered_feature_ids. Must resolve (no ambiguity), store NULL, and
  -- skip the subset rule (confirmed B with nothing "offered" is fine).
  v_doc := public.create_sighting(
    p_post_id               => v_post,
    p_photos                => jsonb_build_array(jsonb_build_object(
                                 'path', v_post::text || '/11111111-1111-1111-1111-111111111111/om-2.jpg',
                                 'captured_at', (now() - interval '2 minutes')::text)),
    p_context_flags         => array['parked']::text[],
    p_note                  => null,
    p_area_label            => 'Ancoats',
    p_locality              => null,
    p_parked_likelihood     => null,
    p_direction             => null,
    p_people_presence       => null,
    p_confirmed_feature_ids => array[v_b]::uuid[]);
  insert into _om values ('s2', (v_doc ->> 'sighting_id')::uuid);

  select offered_feature_ids is null, confirmed_feature_ids into v_null, v_conf
  from public.sightings where id = (v_doc ->> 'sighting_id')::uuid;
  if not v_null then
    raise exception 'CHECK 2 FAILED: an old client''s report must store offered_feature_ids NULL (unknown)';
  end if;
  if v_conf is distinct from array[v_b] then
    raise exception 'CHECK 2 FAILED: the old call''s confirmed ids were not stored as sent, got %', v_conf;
  end if;

  -- CHECK 3 — '{}' means "asked, but no marks to show": kept as '{}'.
  v_doc := public.create_sighting(
    v_post,
    jsonb_build_array(jsonb_build_object(
      'path', v_post::text || '/11111111-1111-1111-1111-111111111111/om-3.jpg',
      'captured_at', (now() - interval '1 minute')::text)),
    null, null, null, null, null, null, null,
    null,
    '{}'::uuid[]);
  insert into _om values ('s3', (v_doc ->> 'sighting_id')::uuid);

  select offered_feature_ids into v_off
  from public.sightings where id = (v_doc ->> 'sighting_id')::uuid;
  if v_off is null then
    raise exception 'CHECK 3 FAILED: ''{}'' was stored as NULL — "asked, nothing shown" became "unknown"';
  end if;
  if cardinality(v_off) <> 0 then
    raise exception 'CHECK 3 FAILED: expected ''{}'', got %', v_off;
  end if;

  raise notice 'CHECKS 1-3 passed: offered stored deduped; old 10-arg call stores NULL; ''{}'' stays ''{}''';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 4 — ⚠️ STALE offered ids are dropped and the report still sends. The
-- owner may edit marks while a spotter is mid-report; the evidence must not
-- be lost over display metadata. (Spotter 2222, two reports.)
-- -----------------------------------------------------------------------------
do $$
declare
  v_post uuid := (select v from _om where k = 'post');
  v_a    uuid := (select v from _om where k = 'A');
  v_doc  jsonb;
  v_off  uuid[];
begin
  perform set_config('request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);

  -- (a) A + another post's mark + an id that never existed (a deleted mark
  -- looks exactly like this) -> only A survives; confirmed A still accepted.
  v_doc := public.create_sighting(
    v_post,
    jsonb_build_array(jsonb_build_object(
      'path', v_post::text || '/22222222-2222-2222-2222-222222222222/om-4.jpg',
      'captured_at', (now() - interval '2 minutes')::text)),
    null, null, null, null, null, null, null,
    array[v_a]::uuid[],
    array[v_a, 'dfa20000-0000-0000-0000-0000000000ff',
          'deaddead-dead-dead-dead-deaddeaddead']::uuid[]);
  if (v_doc ->> 'sighting_id') is null then
    raise exception 'CHECK 4 FAILED: a report with stale offered ids did not send: %', v_doc;
  end if;
  select offered_feature_ids into v_off
  from public.sightings where id = (v_doc ->> 'sighting_id')::uuid;
  if v_off is distinct from array[v_a] then
    raise exception 'CHECK 4 FAILED: stale offered ids should be dropped leaving {A}, got % — another post''s mark id must never be stored', v_off;
  end if;

  -- (b) ALL stale -> '{}' (asked; nothing current was shown), not NULL.
  v_doc := public.create_sighting(
    v_post,
    jsonb_build_array(jsonb_build_object(
      'path', v_post::text || '/22222222-2222-2222-2222-222222222222/om-5.jpg',
      'captured_at', (now() - interval '1 minute')::text)),
    null, null, null, null, null, null, null,
    null,
    array['dfa20000-0000-0000-0000-0000000000ff']::uuid[]);
  select offered_feature_ids into v_off
  from public.sightings where id = (v_doc ->> 'sighting_id')::uuid;
  if v_off is null or cardinality(v_off) <> 0 then
    raise exception 'CHECK 4 FAILED: all-stale offered ids should store ''{}'', got %', coalesce(v_off::text, 'NULL');
  end if;

  raise notice 'CHECK 4 passed: stale offered ids dropped, the report still sends; all-stale stores ''{}''';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 5 — what IS refused. Spotter 3333 probes; each call raises before any
-- insert, so 3333 must end with zero rows on the post.
-- -----------------------------------------------------------------------------
do $$
declare
  v_post  uuid := (select v from _om where k = 'post');
  v_a     uuid := (select v from _om where k = 'A');
  v_b     uuid := (select v from _om where k = 'B');
  v_probe jsonb;
  v_hits  int := 0;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
  v_probe := jsonb_build_array(jsonb_build_object(
    'path', v_post::text || '/33333333-3333-3333-3333-333333333333/om-probe.jpg',
    'captured_at', now()::text));

  -- (a) confirmed B, but only A was offered.
  begin
    perform public.create_sighting(v_post, v_probe, null, null, null, null, null, null, null,
      array[v_b]::uuid[], array[v_a]::uuid[]);
    raise exception 'CHECK 5a FAILED: a confirmed mark that was never offered was accepted';
  exception when others then
    if sqlerrm like 'INVALID_INPUT: confirmed feature not offered%' then v_hits := v_hits + 1;
    else raise exception 'CHECK 5a FAILED: expected INVALID_INPUT: confirmed feature not offered, got: %', sqlerrm; end if;
  end;

  -- (b) a stale offered id cannot smuggle a confirmation through: offered
  -- [decoy] intersects to '{}', so confirmed A is not offered.
  begin
    perform public.create_sighting(v_post, v_probe, null, null, null, null, null, null, null,
      array[v_a]::uuid[], array['dfa20000-0000-0000-0000-0000000000ff']::uuid[]);
    raise exception 'CHECK 5b FAILED: confirmed A was accepted with only a stale id offered';
  exception when others then
    if sqlerrm like 'INVALID_INPUT: confirmed feature not offered%' then v_hits := v_hits + 1;
    else raise exception 'CHECK 5b FAILED: expected INVALID_INPUT: confirmed feature not offered, got: %', sqlerrm; end if;
  end;

  -- (c) 9 offered ids -> refused (a malformed payload, not a stale one).
  begin
    perform public.create_sighting(v_post, v_probe, null, null, null, null, null, null, null,
      null, (select array_agg(gen_random_uuid()) from generate_series(1, 9)));
    raise exception 'CHECK 5c FAILED: 9 offered ids were accepted';
  exception when others then
    if sqlerrm like 'INVALID_INPUT: too many offered features%' then v_hits := v_hits + 1;
    else raise exception 'CHECK 5c FAILED: expected INVALID_INPUT: too many offered features, got: %', sqlerrm; end if;
  end;

  -- (d) 9 copies of ONE real id -> still refused: bounded BEFORE dedupe.
  begin
    perform public.create_sighting(v_post, v_probe, null, null, null, null, null, null, null,
      null, array_fill(v_a, array[9]));
    raise exception 'CHECK 5d FAILED: 9 padded copies of one id were accepted (bound applied after dedupe)';
  exception when others then
    if sqlerrm like 'INVALID_INPUT: too many offered features%' then v_hits := v_hits + 1;
    else raise exception 'CHECK 5d FAILED: expected INVALID_INPUT: too many offered features, got: %', sqlerrm; end if;
  end;

  -- (e) a 2-D array (4 elements, under the bound) -> refused on ndims.
  begin
    perform public.create_sighting(v_post, v_probe, null, null, null, null, null, null, null,
      null, array[array[v_a, v_b], array[v_b, v_a]]::uuid[]);
    raise exception 'CHECK 5e FAILED: a 2-D offered array was accepted';
  exception when others then
    if sqlerrm like 'INVALID_INPUT: too many offered features%' then v_hits := v_hits + 1;
    else raise exception 'CHECK 5e FAILED: expected INVALID_INPUT: too many offered features, got: %', sqlerrm; end if;
  end;

  -- (f) UNCHANGED: a foreign CONFIRMED id is still the hard, opaque reject,
  -- even when it is also offered (the offered leniency must not leak into it).
  begin
    perform public.create_sighting(v_post, v_probe, null, null, null, null, null, null, null,
      array['dfa20000-0000-0000-0000-0000000000ff']::uuid[],
      array['dfa20000-0000-0000-0000-0000000000ff']::uuid[]);
    raise exception 'CHECK 5f FAILED: another post''s mark was accepted as CONFIRMED';
  exception when others then
    if sqlerrm like 'INVALID_INPUT: unknown feature id%' then v_hits := v_hits + 1;
    else raise exception 'CHECK 5f FAILED: expected INVALID_INPUT: unknown feature id, got: %', sqlerrm; end if;
  end;

  if v_hits <> 6 then
    raise exception 'CHECK 5 FAILED: expected 6 refusals, got %', v_hits;
  end if;
  if exists (select 1 from public.sightings
              where post_id = v_post
                and spotter_id = '33333333-3333-3333-3333-333333333333') then
    raise exception 'CHECK 5 FAILED: a refused probe left a sighting row behind';
  end if;

  raise notice 'CHECK 5 passed: not-offered, >8 (pre-dedupe), 2-D and foreign-confirmed all refused';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 6 — get_post_sightings hands offered_feature_ids to the OWNER: an id
-- array, JSON null (unknown — key present, value null) and [].
-- -----------------------------------------------------------------------------
do $$
declare
  v_post uuid := (select v from _om where k = 'post');
  v_a    uuid := (select v from _om where k = 'A');
  v_b    uuid := (select v from _om where k = 'B');
  v_doc  jsonb;
  v_row  jsonb;
  v_ids  uuid[];
begin
  perform set_config('request.jwt.claims',
    '{"sub":"66666666-6666-6666-6666-666666666666","role":"authenticated"}', true);
  v_doc := public.get_post_sightings(v_post);

  if jsonb_array_length(v_doc) <> 5 then
    raise exception 'CHECK 6 FAILED: expected the 5 reports from CHECKS 1-4, got %', jsonb_array_length(v_doc);
  end if;

  -- CHECK 1's row: the two offered ids.
  select e into v_row from jsonb_array_elements(v_doc) e
   where (e ->> 'id')::uuid = (select v from _om where k = 's1');
  if jsonb_typeof(v_row -> 'offered_feature_ids') is distinct from 'array' then
    raise exception 'CHECK 6 FAILED: offered_feature_ids should be an array, got %', v_row -> 'offered_feature_ids';
  end if;
  select array_agg(x::uuid) into v_ids
  from jsonb_array_elements_text(v_row -> 'offered_feature_ids') x;
  if cardinality(v_ids) <> 2 or not (v_ids @> array[v_a, v_b]) then
    raise exception 'CHECK 6 FAILED: offered_feature_ids should be [A, B], got %', v_row -> 'offered_feature_ids';
  end if;

  -- CHECK 2's row: the key is PRESENT and JSON null — "unknown".
  select e into v_row from jsonb_array_elements(v_doc) e
   where (e ->> 'id')::uuid = (select v from _om where k = 's2');
  if not (v_row ? 'offered_feature_ids') then
    raise exception 'CHECK 6 FAILED: the key is missing on an old report — the client cannot tell unknown from absent';
  end if;
  if (v_row -> 'offered_feature_ids') <> 'null'::jsonb then
    raise exception 'CHECK 6 FAILED: an old report should carry JSON null, got %', v_row -> 'offered_feature_ids';
  end if;

  -- CHECK 3's row: [].
  select e into v_row from jsonb_array_elements(v_doc) e
   where (e ->> 'id')::uuid = (select v from _om where k = 's3');
  if (v_row -> 'offered_feature_ids') <> '[]'::jsonb then
    raise exception 'CHECK 6 FAILED: an "asked, nothing shown" report should carry [], got %', v_row -> 'offered_feature_ids';
  end if;

  raise notice 'CHECK 6 passed: the owner gets offered_feature_ids as ids / null / []';
end $$;


-- -----------------------------------------------------------------------------
-- CHECKS 7-10 — update_post_distinctive_features keeps ids stable.
-- -----------------------------------------------------------------------------
do $$
declare
  v_base text := 'http://127.0.0.1:54321/storage/v1/object/public/post-photos/66666666-6666-6666-6666-666666666666/';
  v_post uuid := (select v from _om where k = 'post');
  v_a    uuid := (select v from _om where k = 'A');
  v_b    uuid := (select v from _om where k = 'B');
  v_c    uuid := (select v from _om where k = 'C');
  v_id   uuid;
  v_pos  int;
  v_desc text;
  v_n    int;
  v_doc  jsonb;
  v_cf   jsonb;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"66666666-6666-6666-6666-666666666666","role":"authenticated"}', true);

  -- CHECK 7 — ⚠️ the same three photos re-sent (what the edit screen sends
  -- when the owner saves without changing anything): the SAME three ids.
  perform public.update_post_distinctive_features(v_post, jsonb_build_array(
    jsonb_build_object('photo_url', v_base || 'om-a.jpg', 'description', 'Cracked nearside mirror'),
    jsonb_build_object('photo_url', v_base || 'om-b.jpg', 'description', 'Bee sticker on the boot'),
    jsonb_build_object('photo_url', v_base || 'om-c.jpg', 'description', 'Roof bars')));
  if (select array_agg(id order by position) from public.post_distinctive_feature where post_id = v_post)
     is distinct from array[v_a, v_b, v_c] then
    raise exception 'CHECK 7 FAILED: an unchanged save re-created the marks — ids were %, now %',
      array[v_a, v_b, v_c],
      (select array_agg(id order by position) from public.post_distinctive_feature where post_id = v_post);
  end if;

  -- ...so CHECK 1's confirmation still resolves.
  v_doc := public.get_post_sightings(v_post);
  select e -> 'confirmed_features' into v_cf from jsonb_array_elements(v_doc) e
   where (e ->> 'id')::uuid = (select v from _om where k = 's1');
  if jsonb_array_length(v_cf) <> 1 or (v_cf -> 0 ->> 'id')::uuid is distinct from v_a then
    raise exception 'CHECK 7 FAILED: after an edit, confirmed_features should still resolve to A, got %', v_cf;
  end if;

  -- ...and no kept photo was queued for deletion as an orphan.
  if exists (select 1 from public.orphaned_photos o
              where o.path in (public.photo_path_from_url(v_base || 'om-a.jpg'),
                               public.photo_path_from_url(v_base || 'om-b.jpg'),
                               public.photo_path_from_url(v_base || 'om-c.jpg'))) then
    raise exception 'CHECK 7 FAILED: a kept mark''s photo was queued as an orphan — the edit still deletes rows it keeps';
  end if;

  -- CHECK 8 — description-only edit of A: same id, new caption (trimmed),
  -- and the owner's sighting page shows the NEW caption on the old tick.
  perform public.update_post_distinctive_features(v_post, jsonb_build_array(
    jsonb_build_object('photo_url', v_base || 'om-a.jpg', 'description', '  Cracked offside mirror  '),
    jsonb_build_object('photo_url', v_base || 'om-b.jpg', 'description', 'Bee sticker on the boot'),
    jsonb_build_object('photo_url', v_base || 'om-c.jpg', 'description', 'Roof bars')));
  select id, description into v_id, v_desc
  from public.post_distinctive_feature where post_id = v_post and position = 0;
  if v_id is distinct from v_a then
    raise exception 'CHECK 8 FAILED: a caption edit changed the mark''s id (% -> %)', v_a, v_id;
  end if;
  if v_desc is distinct from 'Cracked offside mirror' then
    raise exception 'CHECK 8 FAILED: description not updated + trimmed, got "%"', v_desc;
  end if;
  v_doc := public.get_post_sightings(v_post);
  select e -> 'confirmed_features' into v_cf from jsonb_array_elements(v_doc) e
   where (e ->> 'id')::uuid = (select v from _om where k = 's1');
  if (v_cf -> 0 ->> 'description') is distinct from 'Cracked offside mirror' then
    raise exception 'CHECK 8 FAILED: the confirmed mark should now read the new caption, got %', v_cf;
  end if;

  -- CHECK 9 — reorder to C, A, B: positions move, ids do not.
  perform public.update_post_distinctive_features(v_post, jsonb_build_array(
    jsonb_build_object('photo_url', v_base || 'om-c.jpg', 'description', 'Roof bars'),
    jsonb_build_object('photo_url', v_base || 'om-a.jpg', 'description', 'Cracked offside mirror'),
    jsonb_build_object('photo_url', v_base || 'om-b.jpg', 'description', 'Bee sticker on the boot')));
  if (select array_agg(id order by position) from public.post_distinctive_feature where post_id = v_post)
     is distinct from array[v_c, v_a, v_b] then
    raise exception 'CHECK 9 FAILED: reorder should give C, A, B by position with the same ids, got %',
      (select jsonb_agg(jsonb_build_object('id', id, 'position', position) order by position)
         from public.post_distinctive_feature where post_id = v_post);
  end if;
  if (select array_agg(position order by position) from public.post_distinctive_feature where post_id = v_post)
     is distinct from array[0, 1, 2] then
    raise exception 'CHECK 9 FAILED: positions should be 0, 1, 2 after a reorder';
  end if;

  -- CHECK 10a — remove B and C, add D: B/C rows gone, A kept at position 0,
  -- D a NEW id at position 1.
  perform public.update_post_distinctive_features(v_post, jsonb_build_array(
    jsonb_build_object('photo_url', v_base || 'om-a.jpg', 'description', 'Cracked offside mirror'),
    jsonb_build_object('photo_url', v_base || 'om-d.jpg', 'description', 'Scuffed rear bumper')));
  select count(*) into v_n from public.post_distinctive_feature where post_id = v_post;
  if v_n <> 2 then
    raise exception 'CHECK 10a FAILED: expected 2 marks after remove/add, got %', v_n;
  end if;
  if exists (select 1 from public.post_distinctive_feature where id in (v_b, v_c)) then
    raise exception 'CHECK 10a FAILED: removed marks B/C still exist';
  end if;
  select id into v_id from public.post_distinctive_feature where post_id = v_post and position = 0;
  if v_id is distinct from v_a then
    raise exception 'CHECK 10a FAILED: kept mark A should be position 0 with its old id, got %', v_id;
  end if;
  select id, description into v_id, v_desc
  from public.post_distinctive_feature where post_id = v_post and position = 1;
  if v_id is null or v_id in (v_a, v_b, v_c) or v_desc <> 'Scuffed rear bumper' then
    raise exception 'CHECK 10a FAILED: added mark D should be a NEW id at position 1, got % "%"', v_id, v_desc;
  end if;

  -- A removed mark simply stops resolving: CHECK 2 confirmed B -> now [].
  -- CHECK 1 confirmed A -> still resolves.
  v_doc := public.get_post_sightings(v_post);
  select e -> 'confirmed_features' into v_cf from jsonb_array_elements(v_doc) e
   where (e ->> 'id')::uuid = (select v from _om where k = 's2');
  if v_cf <> '[]'::jsonb then
    raise exception 'CHECK 10a FAILED: a deleted mark should no longer resolve, got %', v_cf;
  end if;
  select e -> 'confirmed_features' into v_cf from jsonb_array_elements(v_doc) e
   where (e ->> 'id')::uuid = (select v from _om where k = 's1');
  if jsonb_array_length(v_cf) <> 1 or (v_cf -> 0 ->> 'id')::uuid is distinct from v_a then
    raise exception 'CHECK 10a FAILED: A should still resolve after B/C were removed, got %', v_cf;
  end if;

  -- CHECK 10b — the same URL twice: the existing row is claimed ONCE (first
  -- by ordinality, so A keeps its id at position 0) and the second copy
  -- inserts as new. D's URL left the payload, so D is deleted.
  perform public.update_post_distinctive_features(v_post, jsonb_build_array(
    jsonb_build_object('photo_url', v_base || 'om-a.jpg', 'description', 'Cracked offside mirror'),
    jsonb_build_object('photo_url', v_base || 'om-a.jpg', 'description', 'Same photo, second mark')));
  select count(*) into v_n from public.post_distinctive_feature where post_id = v_post;
  if v_n <> 2 then
    raise exception 'CHECK 10b FAILED: expected 2 marks for a duplicated URL, got %', v_n;
  end if;
  select id into v_id from public.post_distinctive_feature where post_id = v_post and position = 0;
  if v_id is distinct from v_a then
    raise exception 'CHECK 10b FAILED: the first copy should keep A''s id, got %', v_id;
  end if;
  select id, description into v_id, v_desc
  from public.post_distinctive_feature where post_id = v_post and position = 1;
  if v_id is null or v_id = v_a or v_desc <> 'Same photo, second mark' then
    raise exception 'CHECK 10b FAILED: the second copy should be a NEW row, got % "%"', v_id, v_desc;
  end if;

  -- CHECK 10c — an empty payload still clears every mark (unchanged).
  perform public.update_post_distinctive_features(v_post, '[]'::jsonb);
  if exists (select 1 from public.post_distinctive_feature where post_id = v_post) then
    raise exception 'CHECK 10c FAILED: an empty payload should remove every mark';
  end if;

  raise notice 'CHECKS 7-10 passed: unchanged/caption/reorder edits keep ids; remove deletes, add inserts; duplicates claim once';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 11 — ⚠️ exactly ONE create_sighting. A surviving 10-arg overload would
-- make every PostgREST call that omits p_offered_feature_ids ambiguous.
-- Since 20261021100000 it takes 13 args (p_damage_kinds, p_damage_note
-- appended), so the 11-arg signature this migration created must be gone too.
-- -----------------------------------------------------------------------------
do $$
declare
  v_n     int;
  v_nargs int;
begin
  select count(*), max(p.pronargs) into v_n, v_nargs
  from pg_proc p
  where p.proname = 'create_sighting'
    and p.pronamespace = 'public'::regnamespace;
  if v_n <> 1 then
    raise exception 'CHECK 11 FAILED: % create_sighting functions exist — an overload makes PostgREST calls ambiguous', v_n;
  end if;
  if v_nargs <> 13 then
    raise exception 'CHECK 11 FAILED: create_sighting should take 13 args (20261021100000), takes %', v_nargs;
  end if;
  if to_regprocedure('public.create_sighting(uuid, jsonb, text[], text, text, text, text, text, text, uuid[])') is not null then
    raise exception 'CHECK 11 FAILED: the old 10-arg signature still exists';
  end if;
  if to_regprocedure('public.create_sighting(uuid, jsonb, text[], text, text, text, text, text, text, uuid[], uuid[])') is not null then
    raise exception 'CHECK 11 FAILED: the 11-arg signature (this suite''s migration) still exists beside the 13-arg one';
  end if;

  raise notice 'CHECK 11 passed: one create_sighting, 13 args, no 10- or 11-arg overload';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 12 — grants. The re-created function must not have come back open to
-- PUBLIC/anon; the column must not be reachable by any client directly.
-- -----------------------------------------------------------------------------
do $$
declare
  -- The 13-arg signature since 20261021100000 (damage args appended).
  v_fn   text := 'public.create_sighting(uuid, jsonb, text[], text, text, text, text, text, text, uuid[], uuid[], text[], text)';
  v_role text;
  v_priv text;
begin
  if has_function_privilege('anon', v_fn, 'EXECUTE')
     or has_function_privilege('public', v_fn, 'EXECUTE') then
    raise exception 'CHECK 12 FAILED: anon/PUBLIC can EXECUTE % — the drop/create re-opened it', v_fn;
  end if;
  if not has_function_privilege('authenticated', v_fn, 'EXECUTE')
     or not has_function_privilege('service_role', v_fn, 'EXECUTE') then
    raise exception 'CHECK 12 FAILED: authenticated/service_role cannot EXECUTE % — nobody could report a sighting', v_fn;
  end if;
  if has_function_privilege('anon', 'public.get_post_sightings(uuid)', 'EXECUTE') then
    raise exception 'CHECK 12 FAILED: anon can EXECUTE get_post_sightings';
  end if;

  foreach v_role in array array['anon', 'authenticated'] loop
    foreach v_priv in array array['SELECT', 'INSERT', 'UPDATE'] loop
      if has_column_privilege(v_role, 'public.sightings', 'offered_feature_ids', v_priv) then
        raise exception 'CHECK 12 FAILED: % holds % on sightings.offered_feature_ids — it is written by create_sighting and read through get_post_sightings only', v_role, v_priv;
      end if;
    end loop;
  end loop;

  raise notice 'CHECK 12 passed: create_sighting authenticated/service_role only; the column is client-unreachable';
end $$;

rollback;

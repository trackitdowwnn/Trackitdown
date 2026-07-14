-- =============================================================================
-- WHAT:  anon-role GRANT + RLS verification (NOT a migration — do not place in
--        migrations/). Probes what the LITERAL `anon` Postgres role can and
--        cannot reach: the four public read RPCs, the public read surface
--        (posts / post_photos / vehicle_feature / post_feature under RLS), and
--        the deny-by-default walls (payments, verification_documents,
--        stripe_connected_accounts, profiles, create_post, plate_available,
--        direct INSERTs).
-- WHY:   The sibling suites (home_feed / post_detail / create_post) simulate
--        anon only via NULL JWT claims while executing as postgres — which
--        BYPASSES the GRANT layer entirely. The 20260713191000 incident (a
--        default-privilege EXECUTE auto-granted to anon) is exactly the class
--        of gap only a real `SET ROLE anon` can catch. Deny-by-default is a
--        Tier 1 property (docs/SECURITY_AND_TRUST.md §6); this file GATES CI,
--        it is not for eyeballing. On success each block emits a NOTICE.
-- LINKS: docs/SECURITY_AND_TRUST.md §6, docs/TESTING.md,
--        supabase/migrations/20260707110712_payments_foundation.sql (grants),
--        20260713191000_create_post_deny_anon.sql,
--        20260713193000_plate_available.sql, supabase/seed.sql (fixtures).
--
-- TECHNIQUE: runs as the postgres superuser. Each probe clears the JWT claims
-- (set_config('request.jwt.claims', NULL, true)) and wraps SET LOCAL ROLE anon
-- ... RESET ROLE around the query, so both the GRANT layer and RLS apply for
-- real. Two denial shapes are deliberately told apart:
--   * insufficient_privilege (SQLSTATE 42501, "permission denied ...") — the
--     GRANT layer refused. Expected wherever anon holds NO privilege at all
--     (financial tables, profiles, create_post, plate_available, INSERTs).
--   * zero rows — the grant exists and RLS filtered. Expected ONLY on the
--     public read surface (posts, post_photos, post_feature); on a financial
--     table a silent zero-row result would mean a grant exists that shouldn't,
--     so it FAILS those checks.
-- SET LOCAL ROLE is transaction-scoped and each DO block is its own
-- transaction, so a raised failure can never leave the session stuck as anon.
--
-- Run against a local DB seeded by supabase/seed.sql:
--     supabase db reset            # applies migrations + seed
--     psql -v ON_ERROR_STOP=1 "$DATABASE_URL" -f supabase/tests/anon_role_verification.sql
--
-- (ON_ERROR_STOP=1 makes psql exit non-zero on the first RAISE.)
-- =============================================================================


-- -----------------------------------------------------------------------------
-- CHECK 1 — anon CAN execute all four public read RPCs. Each must return
-- without error and non-NULL (the RPCs are the entire logged-out browse
-- surface; a missing grant here would blank the app for logged-out users).
-- Detail id a1a1a1a1-...0001 is the seeded ACTIVE 'MA19 XKL' post.
-- -----------------------------------------------------------------------------
do $$
declare
  v_home     jsonb;
  v_nearby   jsonb;
  v_viewport jsonb;
  v_detail   jsonb;
begin
  perform set_config('request.jwt.claims', null, true);
  set local role anon;

  v_home     := public.get_home_feed(53.4808, -2.2426, 15000);
  v_nearby   := public.get_nearby_posts(53.4808, -2.2426, 15000, 0, 25);
  v_viewport := public.get_posts_in_viewport(53.47, -2.26, 53.49, -2.23, 100);
  v_detail   := public.get_post_detail('a1a1a1a1-0000-0000-0000-000000000001');

  reset role;

  if v_home is null or v_nearby is null or v_viewport is null or v_detail is null then
    raise exception 'CHECK 1 FAILED: a read RPC returned NULL for anon (home null=%, nearby null=%, viewport null=%, detail null=%)',
      v_home is null, v_nearby is null, v_viewport is null, v_detail is null;
  end if;
  raise notice 'CHECK 1 passed: anon can execute get_home_feed / get_nearby_posts / get_posts_in_viewport / get_post_detail';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 2 — MONEY. anon SELECT on payments is denied at the GRANT layer
-- (42501). The escrow ledger has NO client grant at all — a zero-row RLS
-- result here would mean a grant exists that shouldn't, so it fails too.
-- -----------------------------------------------------------------------------
do $$
declare
  v_denied boolean := false;
  v_rows   integer;
begin
  perform set_config('request.jwt.claims', null, true);
  begin
    set local role anon;
    select count(*) into v_rows from public.payments;
    reset role;
  exception when insufficient_privilege then
    v_denied := true;  -- 42501; sub-block rollback also reverts the role
  end;
  if not v_denied then
    raise exception 'CHECK 2 FAILED: anon SELECT on payments was NOT grant-denied — it ran and saw % row(s) (0 means RLS is standing in for a missing revoke)', v_rows;
  end if;
  raise notice 'CHECK 2 passed: anon SELECT on payments denied at the GRANT layer (42501)';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 3 — SAFETY. anon SELECT on verification_documents (V5C proof paths)
-- is denied at the GRANT layer (42501).
-- -----------------------------------------------------------------------------
do $$
declare
  v_denied boolean := false;
  v_rows   integer;
begin
  perform set_config('request.jwt.claims', null, true);
  begin
    set local role anon;
    select count(*) into v_rows from public.verification_documents;
    reset role;
  exception when insufficient_privilege then
    v_denied := true;
  end;
  if not v_denied then
    raise exception 'CHECK 3 FAILED: anon SELECT on verification_documents was NOT grant-denied — it ran and saw % row(s)', v_rows;
  end if;
  raise notice 'CHECK 3 passed: anon SELECT on verification_documents denied at the GRANT layer (42501)';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 4 — MONEY. anon SELECT on stripe_connected_accounts (payout/KYC state)
-- is denied at the GRANT layer (42501). The SELECT grant is authenticated-only.
-- -----------------------------------------------------------------------------
do $$
declare
  v_denied boolean := false;
  v_rows   integer;
begin
  perform set_config('request.jwt.claims', null, true);
  begin
    set local role anon;
    select count(*) into v_rows from public.stripe_connected_accounts;
    reset role;
  exception when insufficient_privilege then
    v_denied := true;
  end;
  if not v_denied then
    raise exception 'CHECK 4 FAILED: anon SELECT on stripe_connected_accounts was NOT grant-denied — it ran and saw % row(s)', v_rows;
  end if;
  raise notice 'CHECK 4 passed: anon SELECT on stripe_connected_accounts denied at the GRANT layer (42501)';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 5 — SAFETY. anon SELECT on profiles is denied at the GRANT layer
-- (42501): display names require a login to read (the grant is
-- authenticated-only — 20260707110712).
-- -----------------------------------------------------------------------------
do $$
declare
  v_denied boolean := false;
  v_rows   integer;
begin
  perform set_config('request.jwt.claims', null, true);
  begin
    set local role anon;
    select count(*) into v_rows from public.profiles;
    reset role;
  exception when insufficient_privilege then
    v_denied := true;
  end;
  if not v_denied then
    raise exception 'CHECK 5 FAILED: anon SELECT on profiles was NOT grant-denied — it ran and saw % row(s)', v_rows;
  end if;
  raise notice 'CHECK 5 passed: anon SELECT on profiles denied at the GRANT layer (42501)';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 6 — SAFETY (anti-stalking). anon SELECT on posts succeeds (the grant
-- exists) but RLS posts_select_active_public shows ONLY status='active' rows:
-- the anon-visible count equals the true active count and zero rows in any
-- other status leak (the seed plants 7 non-active traps + 5 recovered rows).
-- -----------------------------------------------------------------------------
do $$
declare
  v_truth_active   integer;
  v_truth_total    integer;
  v_anon_total     integer;
  v_anon_nonactive integer;
begin
  select count(*) filter (where status = 'active'), count(*)
    into v_truth_active, v_truth_total
  from public.posts;

  if v_truth_total <= v_truth_active then
    raise exception 'CHECK 6 FAILED: seed provides no non-active trap posts to hide (active=%, total=%)', v_truth_active, v_truth_total;
  end if;

  perform set_config('request.jwt.claims', null, true);
  set local role anon;
  select count(*), count(*) filter (where status <> 'active')
    into v_anon_total, v_anon_nonactive
  from public.posts;
  reset role;

  if v_anon_nonactive > 0 then
    raise exception 'CHECK 6 FAILED: % non-active post(s) visible to the anon role', v_anon_nonactive;
  end if;
  if v_anon_total <> v_truth_active then
    raise exception 'CHECK 6 FAILED: anon sees % post(s) but % are active — RLS does not match posts_select_active_public', v_anon_total, v_truth_active;
  end if;
  raise notice 'CHECK 6 passed: anon sees exactly the % active post(s); all % non-active row(s) filtered by RLS', v_truth_active, v_truth_total - v_truth_active;
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 7 — SAFETY. anon SELECT on post_photos returns ONLY photos of ACTIVE
-- posts (post_photos_select_active_public). The seed gives recovered posts
-- photos too, so there ARE hidden rows to prove the filter against.
-- -----------------------------------------------------------------------------
do $$
declare
  v_truth_active_photos integer;
  v_truth_total_photos  integer;
  v_anon_photos         integer;
begin
  select count(*) filter (where p.status = 'active'), count(*)
    into v_truth_active_photos, v_truth_total_photos
  from public.post_photos ph
  join public.posts p on p.id = ph.post_id;

  if v_truth_total_photos <= v_truth_active_photos then
    raise exception 'CHECK 7 FAILED: seed provides no photos on non-active posts to hide (active=%, total=%)', v_truth_active_photos, v_truth_total_photos;
  end if;

  perform set_config('request.jwt.claims', null, true);
  set local role anon;
  select count(*) into v_anon_photos from public.post_photos;
  reset role;

  if v_anon_photos <> v_truth_active_photos then
    raise exception 'CHECK 7 FAILED: anon sees % photo(s) but % belong to active posts — non-active posts'' photos are leaking (or active ones are hidden)', v_anon_photos, v_truth_active_photos;
  end if;
  raise notice 'CHECK 7 passed: anon sees exactly the % photo(s) of active posts; % non-active-post photo(s) filtered', v_truth_active_photos, v_truth_total_photos - v_truth_active_photos;
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 8 — SAFETY. anon CANNOT execute create_post (the 20260713191000 revoke
-- closed the default-privilege auto-grant) and CANNOT execute plate_available
-- (20260713193000: authenticated-only, no logged-out plate-existence oracle).
-- Any error OTHER than 42501 means the function body/validation actually ran —
-- i.e. anon holds EXECUTE — and fails the check.
-- -----------------------------------------------------------------------------
do $$
declare
  v_create_denied boolean := false;
  v_plate_denied  boolean := false;
begin
  perform set_config('request.jwt.claims', null, true);

  begin
    set local role anon;
    perform public.create_post(
      'ZZ99 ZZZ', 'Ford', 'Focus', 'Blue', 2019, null, null, null, null, null,
      null, null, now() - interval '1 day', 53.4808, -2.2426, 'Manchester',
      25000,
      array['https://example.test/anon/0.jpg',
            'https://example.test/anon/1.jpg',
            'https://example.test/anon/2.jpg'],
      null, null);
    reset role;
  exception
    when insufficient_privilege then
      v_create_denied := true;
    when others then
      raise exception 'CHECK 8 FAILED: create_post as anon raised "%" (SQLSTATE %) — its body ran, so anon still holds EXECUTE (expected 42501)', sqlerrm, sqlstate;
  end;

  begin
    set local role anon;
    perform public.plate_available('MA19 XKL');
    reset role;
  exception
    when insufficient_privilege then
      v_plate_denied := true;
    when others then
      raise exception 'CHECK 8 FAILED: plate_available as anon raised "%" (SQLSTATE %) — its body ran, so anon still holds EXECUTE (expected 42501)', sqlerrm, sqlstate;
  end;

  if not v_create_denied then
    raise exception 'CHECK 8 FAILED: anon EXECUTE on create_post was NOT denied (20260713191000 revoke regressed?)';
  end if;
  if not v_plate_denied then
    raise exception 'CHECK 8 FAILED: anon EXECUTE on plate_available was NOT denied (a logged-out plate-existence oracle is open)';
  end if;
  raise notice 'CHECK 8 passed: anon EXECUTE denied (42501) on both create_post and plate_available';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 9 — SAFETY. anon direct INSERTs into posts and profiles are denied at
-- the GRANT layer (42501 "permission denied ..."), BEFORE any RLS policy or
-- constraint runs. An RLS-shaped 42501 ("new row violates row-level security")
-- would mean an INSERT grant exists that shouldn't, so it fails too.
-- -----------------------------------------------------------------------------
do $$
declare
  v_posts_denied    boolean := false;
  v_profiles_denied boolean := false;
begin
  perform set_config('request.jwt.claims', null, true);

  begin
    set local role anon;
    insert into public.posts (owner_id, bounty_amount_pence)
    values ('11111111-1111-1111-1111-111111111111', 25000);
    reset role;
  exception
    when insufficient_privilege then
      if sqlerrm like 'permission denied%' then
        v_posts_denied := true;
      else
        raise exception 'CHECK 9 FAILED: anon INSERT into posts stopped by RLS ("%"), not by the GRANT layer — an INSERT grant exists that should not', sqlerrm;
      end if;
    when others then
      raise exception 'CHECK 9 FAILED: anon INSERT into posts raised "%" (SQLSTATE %) — it got past the GRANT layer (expected 42501 permission denied)', sqlerrm, sqlstate;
  end;

  begin
    set local role anon;
    insert into public.profiles (id, display_name)
    values ('99999999-9999-9999-9999-999999999999', 'Anon Probe');
    reset role;
  exception
    when insufficient_privilege then
      if sqlerrm like 'permission denied%' then
        v_profiles_denied := true;
      else
        raise exception 'CHECK 9 FAILED: anon INSERT into profiles stopped by RLS ("%"), not by the GRANT layer — an INSERT grant exists that should not', sqlerrm;
      end if;
    when others then
      raise exception 'CHECK 9 FAILED: anon INSERT into profiles raised "%" (SQLSTATE %) — it got past the GRANT layer (expected 42501 permission denied)', sqlerrm, sqlstate;
  end;

  if not v_posts_denied then
    raise exception 'CHECK 9 FAILED: anon INSERT into posts was NOT denied';
  end if;
  if not v_profiles_denied then
    raise exception 'CHECK 9 FAILED: anon INSERT into profiles was NOT denied';
  end if;
  raise notice 'CHECK 9 passed: anon INSERT into posts and profiles both denied at the GRANT layer (42501)';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 10 — the public taxonomy surface. anon SELECT succeeds on
-- vehicle_feature (whole taxonomy: using(true)) and on post_feature limited to
-- ACTIVE posts' tags. All seeded tags sit on active posts, so a trap tag is
-- planted on the seeded DRAFT post (MA99 DRF) first to prove the filter; it is
-- removed on success and rolled back automatically on failure.
-- -----------------------------------------------------------------------------
do $$
declare
  v_truth_vf        integer;
  v_truth_pf_active integer;
  v_anon_vf         integer;
  v_anon_pf         integer;
begin
  -- Plant the hidden-tag trap on the draft post (superuser bypasses RLS).
  insert into public.post_feature (post_id, feature_key)
  values ('a1a1a1a1-0000-0000-0000-00000000001b', 'dashcam')
  on conflict (post_id, feature_key) do nothing;

  select count(*) into v_truth_vf from public.vehicle_feature;
  select count(*)
    into v_truth_pf_active
  from public.post_feature pf
  join public.posts p on p.id = pf.post_id
  where p.status = 'active';

  if v_truth_vf < 1 then
    raise exception 'CHECK 10 FAILED: vehicle_feature taxonomy is empty (migration seed missing?)';
  end if;

  perform set_config('request.jwt.claims', null, true);
  set local role anon;
  select count(*) into v_anon_vf from public.vehicle_feature;
  select count(*) into v_anon_pf from public.post_feature;
  reset role;

  -- Remove the trap (a failed RAISE below rolls this whole block back anyway).
  delete from public.post_feature
  where post_id = 'a1a1a1a1-0000-0000-0000-00000000001b'
    and feature_key = 'dashcam';

  if v_anon_vf <> v_truth_vf then
    raise exception 'CHECK 10 FAILED: anon sees % of % vehicle_feature row(s) — the taxonomy should be fully public', v_anon_vf, v_truth_vf;
  end if;
  if v_anon_pf <> v_truth_pf_active then
    raise exception 'CHECK 10 FAILED: anon sees % post_feature row(s), expected % (active posts only — the draft-post trap tag leaked or active tags are hidden)', v_anon_pf, v_truth_pf_active;
  end if;
  raise notice 'CHECK 10 passed: anon reads the full taxonomy (% row(s)) and only active posts'' % feature tag(s)', v_truth_vf, v_truth_pf_active;
end $$;

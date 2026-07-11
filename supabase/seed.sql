-- =============================================================================
-- Trackitdown DEV seed — home-feed (Explore tab) sample data.
--
-- WHAT: 6 fake owners (auth.users + public.profiles) and ~33 posts across four
--       Greater Manchester localities (Manchester, Salford, Stockport, Bury):
--       22 active + 4 recently-recovered (within the 30-day public window) +
--       7 "trap" posts in non-visible states (draft/pending/claimed/cancelled/
--       expired/rejected and one recovered OUTSIDE the 30-day window) that MUST
--       NOT surface in either RPC.
-- WHY:  Exercises get_home_feed / get_nearby_posts locally and gives the
--       verification queries (supabase/tests/home_feed_verification.sql)
--       negative cases to prove no non-active/out-of-window post escapes.
--
-- DEV ONLY. Loaded by `supabase db reset` per config.toml [db.seed]
-- (sql_paths = ["./seed.sql"]). Runs as the postgres superuser, so it bypasses
-- RLS and the client column grants and may set status/recovered_at directly.
-- Idempotent: fixed UUIDs + ON CONFLICT DO NOTHING, safe to re-run.
--
-- NOTE on auth.users: these rows exist only to satisfy the profiles ->
-- auth.users FK. encrypted_password is '' — they are NOT real login accounts.
-- Token columns are set to '' (not NULL) to keep GoTrue admin queries happy.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 0. DEV-ONLY SEATBELT
-- Refuse to run against anything that does not look like a local Supabase
-- stack, so a mistaken `psql "$HOSTED_DB_URL" -f seed.sql` aborts LOUDLY before
-- writing fake cars into production. Signal: the local stack ships the
-- well-known demo JWT secret; a hosted project has a real, different one. We
-- only raise on POSITIVE evidence of a non-demo secret, and fail OPEN when the
-- GUC is absent so `supabase db reset` still seeds. (Heuristic seatbelt, not a
-- security boundary — production writes are governed by RLS/roles, not this.)
-- -----------------------------------------------------------------------------
do $$
declare
  v_secret text := current_setting('app.settings.jwt_secret', true);
begin
  if v_secret is not null
     and v_secret <> 'super-secret-jwt-token-with-at-least-32-characters-long' then
    raise exception
      'REFUSING to run seed.sql: DEV-ONLY seed, and the connected database does not look local (non-demo JWT secret detected). Aborting to protect production data.';
  end if;
end $$;


-- ST_* (PostGIS) and any extension funcs must resolve whether they live in
-- public or the extensions schema.
set search_path = public, extensions;


-- -----------------------------------------------------------------------------
-- 1. Fake owners: auth.users
-- -----------------------------------------------------------------------------
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change, email_change_token_new
)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'seed-owner-1@trackitdown.test', '', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'seed-owner-2@trackitdown.test', '', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '33333333-3333-3333-3333-333333333333', 'authenticated', 'authenticated', 'seed-owner-3@trackitdown.test', '', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '44444444-4444-4444-4444-444444444444', 'authenticated', 'authenticated', 'seed-owner-4@trackitdown.test', '', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '55555555-5555-5555-5555-555555555555', 'authenticated', 'authenticated', 'seed-owner-5@trackitdown.test', '', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '66666666-6666-6666-6666-666666666666', 'authenticated', 'authenticated', 'seed-owner-6@trackitdown.test', '', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', '', '', '', '')
on conflict (id) do nothing;


-- -----------------------------------------------------------------------------
-- 2. Fake owners: public.profiles (1:1 with auth.users)
-- -----------------------------------------------------------------------------
insert into public.profiles (id, display_name, first_name, created_at)
values
  ('11111111-1111-1111-1111-111111111111', 'Alex Mercer',   'Alex',  now() - interval '120 days'),
  ('22222222-2222-2222-2222-222222222222', 'Beth Sanders',  'Beth',  now() - interval '110 days'),
  ('33333333-3333-3333-3333-333333333333', 'Carl Thomas',   'Carl',  now() - interval '100 days'),
  ('44444444-4444-4444-4444-444444444444', 'Dana Brook',    'Dana',  now() - interval '90 days'),
  ('55555555-5555-5555-5555-555555555555', 'Evan Reid',     'Evan',  now() - interval '80 days'),
  ('66666666-6666-6666-6666-666666666666', 'Farah Khan',    'Farah', now() - interval '70 days')
on conflict (id) do nothing;


-- -----------------------------------------------------------------------------
-- 3. Posts
-- Coordinates are (lng, lat) — ST_MakePoint takes longitude first.
-- bounty_amount_pence is within the £50–£5000 check (5000–500000).
-- -----------------------------------------------------------------------------
insert into public.posts (
  id, owner_id, status, bounty_amount_pence, plate, make, model, colour,
  last_seen_at, last_seen_area, last_seen_location, recovered_at, expires_at,
  created_at
)
values
  -- ---- Manchester (7 active) --------------------------------------------------
  ('a1a1a1a1-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'active',  25000,  'MA19 XKL', 'Ford',        'Fiesta',     'Blue',   now() - interval '2 days',  'Manchester', ST_SetSRID(ST_MakePoint(-2.2426, 53.4808), 4326)::geography, null, now() + interval '88 days', now() - interval '2 days'),
  ('a1a1a1a1-0000-0000-0000-000000000002', '55555555-5555-5555-5555-555555555555', 'active',  50000,  'VO68 RTP', 'Vauxhall',    'Corsa',      'Silver', now() - interval '5 days',  'Manchester', ST_SetSRID(ST_MakePoint(-2.2402, 53.4835), 4326)::geography, null, now() + interval '85 days', now() - interval '5 days'),
  ('a1a1a1a1-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222', 'active',  15000,  'BD21 WSE', 'BMW',         '3 Series',   'Black',  now() - interval '1 days',  'Manchester', ST_SetSRID(ST_MakePoint(-2.2455, 53.4791), 4326)::geography, null, now() + interval '89 days', now() - interval '1 days'),
  ('a1a1a1a1-0000-0000-0000-000000000004', '66666666-6666-6666-6666-666666666666', 'active',  120000, 'MN17 PLA', 'Audi',        'A3',         'White',  now() - interval '8 days',  'Manchester', ST_SetSRID(ST_MakePoint(-2.2380, 53.4820), 4326)::geography, null, now() + interval '82 days', now() - interval '8 days'),
  ('a1a1a1a1-0000-0000-0000-000000000005', '33333333-3333-3333-3333-333333333333', 'active',  7500,   'MC70 GHN', 'Toyota',      'Yaris',      'Red',    now() - interval '3 days',  'Manchester', ST_SetSRID(ST_MakePoint(-2.2500, 53.4776), 4326)::geography, null, now() + interval '87 days', now() - interval '3 days'),
  ('a1a1a1a1-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'active',  300000, 'AK19 TRV', 'Land Rover',  'Range Rover Evoque', 'Grey', now() - interval '6 days', 'Manchester', ST_SetSRID(ST_MakePoint(-2.2350, 53.4850), 4326)::geography, null, now() + interval '84 days', now() - interval '6 days'),
  ('a1a1a1a1-0000-0000-0000-000000000007', '44444444-4444-4444-4444-444444444444', 'active',  40000,  'MP22 KDR', 'Nissan',      'Qashqai',    'Blue',   now() - interval '4 days',  'Manchester', ST_SetSRID(ST_MakePoint(-2.2478, 53.4802), 4326)::geography, null, now() + interval '86 days', now() - interval '4 days'),

  -- ---- Salford (6 active) -----------------------------------------------------
  ('a1a1a1a1-0000-0000-0000-000000000008', '22222222-2222-2222-2222-222222222222', 'active',  60000,  'SF19 KDR', 'Volkswagen',  'Golf',       'White',  now() - interval '2 days',  'Salford',    ST_SetSRID(ST_MakePoint(-2.2901, 53.4875), 4326)::geography, null, now() + interval '88 days', now() - interval '2 days'),
  ('a1a1a1a1-0000-0000-0000-000000000009', '55555555-5555-5555-5555-555555555555', 'active',  20000,  'SA68 LMN', 'Honda',       'Civic',      'Grey',   now() - interval '7 days',  'Salford',    ST_SetSRID(ST_MakePoint(-2.2870, 53.4890), 4326)::geography, null, now() + interval '83 days', now() - interval '7 days'),
  ('a1a1a1a1-0000-0000-0000-00000000000a', '33333333-3333-3333-3333-333333333333', 'active',  90000,  'SF21 WPR', 'Mercedes-Benz','A-Class',   'Black',  now() - interval '3 days',  'Salford',    ST_SetSRID(ST_MakePoint(-2.2930, 53.4860), 4326)::geography, null, now() + interval '87 days', now() - interval '3 days'),
  ('a1a1a1a1-0000-0000-0000-00000000000b', '66666666-6666-6666-6666-666666666666', 'active',  12000,  'SL70 TNE', 'Ford',        'Focus',      'Blue',   now() - interval '9 days',  'Salford',    ST_SetSRID(ST_MakePoint(-2.2850, 53.4905), 4326)::geography, null, now() + interval '81 days', now() - interval '9 days'),
  ('a1a1a1a1-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111', 'active',  250000, 'SF17 XRT', 'BMW',         'X5',         'Black',  now() - interval '5 days',  'Salford',    ST_SetSRID(ST_MakePoint(-2.2960, 53.4848), 4326)::geography, null, now() + interval '85 days', now() - interval '5 days'),
  ('a1a1a1a1-0000-0000-0000-00000000000d', '44444444-4444-4444-4444-444444444444', 'active',  35000,  'SA22 GDN', 'Kia',         'Sportage',   'Red',    now() - interval '1 days',  'Salford',    ST_SetSRID(ST_MakePoint(-2.2915, 53.4882), 4326)::geography, null, now() + interval '89 days', now() - interval '1 days'),

  -- ---- Stockport (5 active) ---------------------------------------------------
  ('a1a1a1a1-0000-0000-0000-00000000000e', '33333333-3333-3333-3333-333333333333', 'active',  45000,  'SK19 PLT', 'Vauxhall',    'Astra',      'Silver', now() - interval '4 days',  'Stockport',  ST_SetSRID(ST_MakePoint(-2.1575, 53.4106), 4326)::geography, null, now() + interval '86 days', now() - interval '4 days'),
  ('a1a1a1a1-0000-0000-0000-00000000000f', '22222222-2222-2222-2222-222222222222', 'active',  80000,  'ST68 KDR', 'Audi',        'Q3',         'Grey',   now() - interval '6 days',  'Stockport',  ST_SetSRID(ST_MakePoint(-2.1550, 53.4120), 4326)::geography, null, now() + interval '84 days', now() - interval '6 days'),
  ('a1a1a1a1-0000-0000-0000-000000000010', '55555555-5555-5555-5555-555555555555', 'active',  18000,  'SK21 WNE', 'Ford',        'Fiesta',     'White',  now() - interval '2 days',  'Stockport',  ST_SetSRID(ST_MakePoint(-2.1600, 53.4090), 4326)::geography, null, now() + interval '88 days', now() - interval '2 days'),
  ('a1a1a1a1-0000-0000-0000-000000000011', '66666666-6666-6666-6666-666666666666', 'active',  500000, 'SK17 GTR', 'Nissan',      'GT-R',       'Blue',   now() - interval '10 days', 'Stockport',  ST_SetSRID(ST_MakePoint(-2.1525, 53.4135), 4326)::geography, null, now() + interval '80 days', now() - interval '10 days'),
  ('a1a1a1a1-0000-0000-0000-000000000012', '11111111-1111-1111-1111-111111111111', 'active',  22000,  'SP22 LRE', 'Toyota',      'Corolla',    'Black',  now() - interval '3 days',  'Stockport',  ST_SetSRID(ST_MakePoint(-2.1620, 53.4078), 4326)::geography, null, now() + interval '87 days', now() - interval '3 days'),

  -- ---- Bury (4 active) --------------------------------------------------------
  ('a1a1a1a1-0000-0000-0000-000000000013', '44444444-4444-4444-4444-444444444444', 'active',  30000,  'BU19 KDR', 'Volkswagen',  'Polo',       'Red',    now() - interval '5 days',  'Bury',       ST_SetSRID(ST_MakePoint(-2.2966, 53.5933), 4326)::geography, null, now() + interval '85 days', now() - interval '5 days'),
  ('a1a1a1a1-0000-0000-0000-000000000014', '33333333-3333-3333-3333-333333333333', 'active',  70000,  'BY68 MNP', 'BMW',         '1 Series',   'White',  now() - interval '2 days',  'Bury',       ST_SetSRID(ST_MakePoint(-2.2940, 53.5950), 4326)::geography, null, now() + interval '88 days', now() - interval '2 days'),
  ('a1a1a1a1-0000-0000-0000-000000000015', '22222222-2222-2222-2222-222222222222', 'active',  16000,  'BU21 TRE', 'Ford',        'Ka',         'Silver', now() - interval '7 days',  'Bury',       ST_SetSRID(ST_MakePoint(-2.2990, 53.5915), 4326)::geography, null, now() + interval '83 days', now() - interval '7 days'),
  ('a1a1a1a1-0000-0000-0000-000000000016', '55555555-5555-5555-5555-555555555555', 'active',  110000, 'BY17 XKL', 'Audi',        'A4',         'Grey',   now() - interval '4 days',  'Bury',       ST_SetSRID(ST_MakePoint(-2.2915, 53.5968), 4326)::geography, null, now() + interval '86 days', now() - interval '4 days'),

  -- ---- Recently recovered (within 30-day public window) -----------------------
  ('a1a1a1a1-0000-0000-0000-000000000017', '11111111-1111-1111-1111-111111111111', 'recovered',            40000, 'MA18 RCV', 'Ford',     'Fiesta', 'Blue',  now() - interval '20 days', 'Manchester', ST_SetSRID(ST_MakePoint(-2.2410, 53.4815), 4326)::geography, now() - interval '3 days',  null, now() - interval '20 days'),
  ('a1a1a1a1-0000-0000-0000-000000000018', '22222222-2222-2222-2222-222222222222', 'recovered_no_spotter', 55000, 'SF18 RCV', 'Volkswagen','Golf',  'Black', now() - interval '25 days', 'Salford',    ST_SetSRID(ST_MakePoint(-2.2890, 53.4870), 4326)::geography, now() - interval '8 days',  null, now() - interval '25 days'),
  ('a1a1a1a1-0000-0000-0000-000000000019', '33333333-3333-3333-3333-333333333333', 'recovered',            65000, 'SK18 RCV', 'Audi',     'A3',     'White', now() - interval '18 days', 'Stockport',  ST_SetSRID(ST_MakePoint(-2.1560, 53.4110), 4326)::geography, now() - interval '12 days', null, now() - interval '18 days'),
  ('a1a1a1a1-0000-0000-0000-00000000001a', '44444444-4444-4444-4444-444444444444', 'recovered_no_spotter', 28000, 'BU18 RCV', 'Nissan',   'Micra',  'Red',   now() - interval '22 days', 'Bury',       ST_SetSRID(ST_MakePoint(-2.2950, 53.5940), 4326)::geography, now() - interval '20 days', null, now() - interval '22 days'),

  -- ---- Traps: MUST NOT surface in any RPC. All placed in Manchester so that
  --      the radius filter would INCLUDE them — proving it is the STATUS
  --      predicate (not distance) that keeps them out. ------------------------
  ('a1a1a1a1-0000-0000-0000-00000000001b', '11111111-1111-1111-1111-111111111111', 'draft',                25000, 'MA99 DRF', 'Ford',     'Fiesta',   'Blue',  now() - interval '1 days',  'Manchester', ST_SetSRID(ST_MakePoint(-2.2420, 53.4805), 4326)::geography, null, null, now() - interval '1 days'),
  ('a1a1a1a1-0000-0000-0000-00000000001c', '22222222-2222-2222-2222-222222222222', 'pending_verification', 30000, 'MA99 PND', 'Volkswagen','Golf',    'White', now() - interval '1 days',  'Manchester', ST_SetSRID(ST_MakePoint(-2.2430, 53.4810), 4326)::geography, null, null, now() - interval '1 days'),
  ('a1a1a1a1-0000-0000-0000-00000000001d', '33333333-3333-3333-3333-333333333333', 'recovery_claimed',     45000, 'MA99 RCL', 'Audi',     'A3',       'Black', now() - interval '2 days',  'Manchester', ST_SetSRID(ST_MakePoint(-2.2440, 53.4812), 4326)::geography, null, null, now() - interval '2 days'),
  ('a1a1a1a1-0000-0000-0000-00000000001e', '44444444-4444-4444-4444-444444444444', 'cancelled',            20000, 'MA99 CAN', 'Toyota',   'Yaris',    'Red',   now() - interval '3 days',  'Manchester', ST_SetSRID(ST_MakePoint(-2.2415, 53.4800), 4326)::geography, null, null, now() - interval '3 days'),
  ('a1a1a1a1-0000-0000-0000-00000000001f', '55555555-5555-5555-5555-555555555555', 'expired',              15000, 'MA99 EXP', 'Ford',     'Ka',       'Silver',now() - interval '95 days', 'Manchester', ST_SetSRID(ST_MakePoint(-2.2425, 53.4807), 4326)::geography, null, null, now() - interval '95 days'),
  ('a1a1a1a1-0000-0000-0000-000000000020', '66666666-6666-6666-6666-666666666666', 'rejected',             50000, 'MA99 REJ', 'BMW',      '3 Series', 'Grey',  now() - interval '4 days',  'Manchester', ST_SetSRID(ST_MakePoint(-2.2435, 53.4809), 4326)::geography, null, null, now() - interval '4 days'),
  -- Recovered but OUTSIDE the 30-day window (recovered 45 days ago) -> excluded
  -- from recently_recovered by the recovered_at predicate.
  ('a1a1a1a1-0000-0000-0000-000000000021', '11111111-1111-1111-1111-111111111111', 'recovered',            40000, 'MA99 OLD', 'Vauxhall', 'Corsa',    'Blue',  now() - interval '60 days', 'Manchester', ST_SetSRID(ST_MakePoint(-2.2422, 53.4806), 4326)::geography, now() - interval '45 days', null, now() - interval '60 days')
on conflict (id) do nothing;

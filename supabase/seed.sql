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


-- =============================================================================
-- 4. Post-detail fields (migration 20260713140000_post_detail)
-- Backfills the four descriptive columns for the visible (active + recovered)
-- seed posts so the post-detail screen renders realistic content. Traps are
-- left null (they never reach a visible detail view). Idempotent: a plain
-- UPDATE keyed by id, safe to re-run.
-- =============================================================================
update public.posts p set
  year                    = v.year,
  body_type               = v.body_type,
  distinguishing_features = v.distinguishing_features,
  owner_note              = v.owner_note
from (values
  -- id, year, body_type, distinguishing_features, owner_note
  ('a1a1a1a1-0000-0000-0000-000000000001'::uuid, 2019, 'Hatchback', 'Small dent on the rear offside door and a faded parking-permit sticker in the windscreen.', 'This was my daily commuter and the only way I get my kids to school. Please keep an eye out around south Manchester - any sighting helps.'),
  ('a1a1a1a1-0000-0000-0000-000000000002'::uuid, 2018, 'Hatchback', 'Silver Corsa with black alloys and a cracked nearside wing mirror held on with tape.', 'Taken from outside my flat overnight. It has my late fathers keyring on the mirror - I would love to get it back.'),
  ('a1a1a1a1-0000-0000-0000-000000000003'::uuid, 2021, 'Saloon', 'Black 3 Series with tinted rear windows and a small Manchester City sticker in the back window.', 'Still on finance and my only transport for work. Any photos of it on the road would mean a lot.'),
  ('a1a1a1a1-0000-0000-0000-000000000004'::uuid, 2017, 'Hatchback', 'White A3 with a roof bike-rack still fitted and a scuff on the front bumper.', 'Gone from the station car park. The bike rack makes it fairly distinctive - please report if you spot it.'),
  ('a1a1a1a1-0000-0000-0000-000000000005'::uuid, 2020, 'Hatchback', 'Bright red Yaris with a dealer plate surround and a child seat in the back.', 'This is my mums car and she is heartbroken. We just want it home safe.'),
  ('a1a1a1a1-0000-0000-0000-000000000006'::uuid, 2019, 'SUV', 'Grey Range Rover Evoque with a private-plate-style spacing and black contrast roof.', 'High-value vehicle taken from the driveway. Do NOT approach - just note the location and report it here.'),
  ('a1a1a1a1-0000-0000-0000-000000000007'::uuid, 2022, 'SUV', 'Blue Qashqai with a towbar fitted and a National Trust sticker on the rear windscreen.', 'Taken while I was at work. It has a dog guard in the boot - please report any sighting.'),
  ('a1a1a1a1-0000-0000-0000-000000000008'::uuid, 2019, 'Hatchback', 'White Golf with aftermarket alloys and a small crack in the top of the windscreen.', 'Disappeared from the retail-park car park in Salford. Any dashcam footage would be a huge help.'),
  ('a1a1a1a1-0000-0000-0000-000000000009'::uuid, 2018, 'Hatchback', 'Grey Civic with a rear spoiler and a faint key scratch along the drivers door.', 'My first car that I saved two years for. Please keep an eye out around Salford.'),
  ('a1a1a1a1-0000-0000-0000-00000000000a'::uuid, 2021, 'Hatchback', 'Black A-Class with red brake calipers and a phone-holder still on the dash.', 'Taken overnight from a permit bay. Reporting a location here is the safest way to help.'),
  ('a1a1a1a1-0000-0000-0000-00000000000b'::uuid, 2020, 'Hatchback', 'Blue Focus estate-shape with a roof box and a small dent on the tailgate.', 'It has my work tools in the boot - I rely on it for my livelihood. Thank you for looking.'),
  ('a1a1a1a1-0000-0000-0000-00000000000c'::uuid, 2017, 'SUV', 'Black X5 with privacy glass and a tow bar; nearside alloy is kerbed.', 'Please do not approach the vehicle or anyone with it - just log where and when you saw it.'),
  ('a1a1a1a1-0000-0000-0000-00000000000d'::uuid, 2022, 'SUV', 'Red Sportage with roof bars and a baby-on-board sign in the rear window.', 'Family car taken from outside our home. Any sighting near Salford would be gratefully received.'),
  ('a1a1a1a1-0000-0000-0000-00000000000e'::uuid, 2019, 'Hatchback', 'Silver Astra with a dented rear bumper and a faded blue disabled badge holder on the dash.', 'Belongs to my elderly dad. We just want it found - please report anything you see.'),
  ('a1a1a1a1-0000-0000-0000-00000000000f'::uuid, 2018, 'SUV', 'Grey Q3 with black roof rails and a small Audi-dealer sticker in the rear window.', 'Taken from the multi-storey in Stockport. Dashcam clips from that evening would help enormously.'),
  ('a1a1a1a1-0000-0000-0000-000000000010'::uuid, 2021, 'Hatchback', 'White Fiesta with a learner-plate residue mark and a scuffed nearside alloy.', 'My daughters first car. Please keep an eye out around Stockport town centre.'),
  ('a1a1a1a1-0000-0000-0000-000000000011'::uuid, 2017, 'Coupe', 'Blue GT-R with aftermarket exhaust and a distinctive carbon rear wing.', 'Extremely high-value and very recognisable. Do not approach - report the location to us and the police.'),
  ('a1a1a1a1-0000-0000-0000-000000000012'::uuid, 2022, 'Saloon', 'Black Corolla hybrid with a taxi-style phone mount and a small dent on the offside sill.', 'This is my only way to get to work. Any sighting near Stockport would mean the world.'),
  ('a1a1a1a1-0000-0000-0000-000000000013'::uuid, 2019, 'Hatchback', 'Red Polo with a cracked front grille and a gym-membership sticker in the windscreen.', 'Taken overnight from our street in Bury. Please report anything, however small.'),
  ('a1a1a1a1-0000-0000-0000-000000000014'::uuid, 2018, 'Hatchback', 'White 1 Series with M-Sport badging and a small chip on the bonnet.', 'On finance and uninsured for theft - I really need it back. Thank you for looking out.'),
  ('a1a1a1a1-0000-0000-0000-000000000015'::uuid, 2021, 'Hatchback', 'Silver Ford Ka with a dented rear arch and a fluffy dice hanging from the mirror.', 'My teenage son saved for this himself. Any sighting around Bury would be amazing.'),
  ('a1a1a1a1-0000-0000-0000-000000000016'::uuid, 2017, 'Saloon', 'Grey A4 with a private-style plate and a roof aerial that has been snapped short.', 'Taken from the driveway overnight. Please just note where you saw it and report here.'),
  -- Recently recovered (owner can still open the detail view) --------------------
  ('a1a1a1a1-0000-0000-0000-000000000017'::uuid, 2018, 'Hatchback', 'Blue Fiesta with a rear-window sticker and a scuffed nearside bumper.', 'Recovered safely thanks to a spotter - thank you to everyone who kept an eye out!'),
  ('a1a1a1a1-0000-0000-0000-000000000018'::uuid, 2018, 'Hatchback', 'Black Golf with aftermarket alloys and a small crack in the windscreen.', 'Found abandoned a few miles away. Grateful to this community for the support.'),
  ('a1a1a1a1-0000-0000-0000-000000000019'::uuid, 2018, 'Hatchback', 'White A3 with a roof rack and a faded parking permit in the windscreen.', 'Recovered within a couple of weeks - proof that reporting sightings really works.'),
  ('a1a1a1a1-0000-0000-0000-00000000001a'::uuid, 2018, 'Hatchback', 'Red Micra with a dented tailgate and a small teddy on the parcel shelf.', 'Back home safe. Thank you to the spotter who reported the location.')
) as v(id, year, body_type, distinguishing_features, owner_note)
where p.id = v.id;


-- -----------------------------------------------------------------------------
-- 5. Post photos (hero carousel)
-- Three reachable Unsplash car photos per VISIBLE (active + recovered) post so
-- the on-device carousel renders real images. Deterministic + idempotent:
--   * id = md5(post_id || position)::uuid  -> stable across runs (ON CONFLICT).
--   * each post gets 3 photos from a shared pool, rotated by a hash of its id so
--     different cars show different images.
-- These are placeholder stock photos, NOT the actual seeded vehicles. Traps are
-- excluded (their photos would never be publicly visible anyway).
-- -----------------------------------------------------------------------------
insert into public.post_photos (id, post_id, url, position)
select
  md5(p.id::text || pos::text)::uuid                                    as id,
  p.id                                                                  as post_id,
  -- Rotate the pool by a hash of the post id (abs-free, negative-modulo-safe).
  pool[1 + (((hashtext(p.id::text) % array_length(pool, 1))
             + array_length(pool, 1) + pos) % array_length(pool, 1))]  as url,
  pos                                                                   as position
from public.posts p
cross join generate_series(0, 2) as pos
cross join (
  select array[
    'https://images.unsplash.com/photo-1503376780353-7e6692767b70?w=1200&q=80&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1552519507-da3b142c6e3d?w=1200&q=80&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1541348263662-e068662d82af?w=1200&q=80&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1550355291-bbee04a92027?w=1200&q=80&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1494976388531-d1058494cdd8?w=1200&q=80&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1517672651691-24622a91b550?w=1200&q=80&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1583121274602-3e2820c69888?w=1200&q=80&auto=format&fit=crop',
    'https://images.unsplash.com/photo-1502877338535-766e1452684a?w=1200&q=80&auto=format&fit=crop'
  ]::text[] as pool
) pl
where p.status in ('active', 'recovered', 'recovered_no_spotter')
on conflict (id) do nothing;


-- -----------------------------------------------------------------------------
-- 6. Part-2 structured fields (migration 20260713180000_post_detail_structured_data)
-- Backfills stolen_from / keys_taken / desc_recognise / desc_drives on a few
-- VISIBLE posts so the post-detail structured block renders. Two posts are set
-- to stolen_from='driveway' (their last-seen point is the "home" address) to
-- exercise the non-owner coarsening in get_post_detail — see
-- supabase/tests/post_detail_verification.sql CHECK 12. Idempotent UPDATE by id.
-- -----------------------------------------------------------------------------
update public.posts p set
  stolen_from    = v.stolen_from,
  keys_taken     = v.keys_taken,
  desc_recognise = v.desc_recognise,
  desc_drives    = v.desc_drives
from (values
  -- id, stolen_from, keys_taken, desc_recognise, desc_drives
  ('a1a1a1a1-0000-0000-0000-000000000001'::uuid, 'street',   'no',      'Blue Fiesta, small dent on the rear offside door and a faded parking-permit sticker.', 'Drives fine but the clutch bites high and the nearside indicator sometimes sticks.'),
  ('a1a1a1a1-0000-0000-0000-000000000004'::uuid, 'car_park', 'unknown', 'White A3 with a roof bike-rack still fitted and a scuffed front bumper.', 'Pulls slightly to the left under braking; there is a rattle from the boot over bumps.'),
  -- DRIVEWAY theft (home address) — owner 11111111. Coarsened to non-owners.
  ('a1a1a1a1-0000-0000-0000-000000000006'::uuid, 'driveway', 'yes',     'Grey Range Rover Evoque, black contrast roof and a private-plate-style spacing.', 'Keyless entry, so likely a relay theft; the tailgate is slow to open.'),
  ('a1a1a1a1-0000-0000-0000-000000000008'::uuid, 'street',   'no',      'White Golf, aftermarket alloys and a small crack in the top of the windscreen.', 'Slight judder in first gear; the passenger window is slow to wind up.'),
  ('a1a1a1a1-0000-0000-0000-000000000011'::uuid, 'street',   'unknown', 'Blue Nissan GT-R with an aftermarket exhaust and a carbon rear wing — very loud.', 'Extremely quick and unmistakable at idle; the exhaust drone is distinctive.'),
  -- Another DRIVEWAY theft (owner_note already mentions the driveway) — owner 55555555.
  ('a1a1a1a1-0000-0000-0000-000000000016'::uuid, 'driveway', 'yes',     'Grey Audi A4 with a private-style plate and a snapped-short roof aerial.', 'Runs quietly; there is a faint knocking from the front suspension over potholes.')
) as v(id, stolen_from, keys_taken, desc_recognise, desc_drives)
where p.id = v.id;


-- -----------------------------------------------------------------------------
-- 7. Post features (vehicle_feature join)
-- Tags a few VISIBLE posts with taxonomy features so the detail-screen chip grid
-- renders. Post ...0001 is deliberately left UNtagged so the tests can assert an
-- empty features array. Idempotent: fixed (post_id, feature_key) PK + ON CONFLICT.
-- -----------------------------------------------------------------------------
insert into public.post_feature (post_id, feature_key) values
  -- Range Rover Evoque (driveway) — three chips.
  ('a1a1a1a1-0000-0000-0000-000000000006'::uuid, 'private_plate'),
  ('a1a1a1a1-0000-0000-0000-000000000006'::uuid, 'roof_rack'),
  ('a1a1a1a1-0000-0000-0000-000000000006'::uuid, 'tinted_windows'),
  -- VW Golf.
  ('a1a1a1a1-0000-0000-0000-000000000008'::uuid, 'aftermarket_alloys'),
  ('a1a1a1a1-0000-0000-0000-000000000008'::uuid, 'cracked_windscreen'),
  -- Nissan GT-R.
  ('a1a1a1a1-0000-0000-0000-000000000011'::uuid, 'modified_exhaust'),
  ('a1a1a1a1-0000-0000-0000-000000000011'::uuid, 'body_kit'),
  ('a1a1a1a1-0000-0000-0000-000000000011'::uuid, 'aftermarket_alloys'),
  -- Audi A4 (driveway).
  ('a1a1a1a1-0000-0000-0000-000000000016'::uuid, 'private_plate')
on conflict (post_id, feature_key) do nothing;

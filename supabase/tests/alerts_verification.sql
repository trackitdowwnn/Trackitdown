-- =============================================================================
-- WHAT:  Spotter-ALERT + push-notification verification (NOT a migration -- do
--        not place in migrations/). Covers the six migrations that make up the
--        notification stack: push infrastructure, the alert zone, the PostGIS
--        matcher, the two per-row notification claims, the MULTI-ALERT v2
--        rework (up to FIVE named, filtered alerts per user) and the
--        case-insensitive criteria matcher.
-- WHY:   Four Tier 1 properties live in these functions and nowhere else:
--          1. THE VICTIM MUST NOT BE ALERTED ABOUT THEIR OWN THEFT. The owner
--             exclusion in match_alert_zones is one predicate; CHECK 6 is the
--             only thing standing between a bug there and pushing "a car was
--             reported stolen near you" to the person who just reported it.
--          2. THE PUSH BODY IS BUILT IN SQL SO ITS PRIVACY IS TESTABLE. The
--             copy must never carry the plate, never carry coordinates, never
--             carry street-grain posts.last_seen_area, and must ALWAYS carry the
--             don't-approach clause (SECURITY_AND_TRUST.md §1). CHECKs 17-21 are
--             the ABSENCE assertions that make those promises real -- they are
--             the reason the strings are formatted in the database at all.
--          3. APPROXIMATE MODE IS A SERVER GUARANTEE, NOT A CLIENT PROMISE.
--             create_my_alert AND update_my_alert snap the point to the ~1km
--             grid BEFORE storage, so the database never holds a user's home.
--             CHECKs 7-11 and 31 assert the STORED value, not the submitted one
--             -- including that the coarsening does not silently break matching
--             at the 1-mile minimum radius (CHECK 10), which is how a privacy
--             measure quietly turns into a broken feature. The EDIT path gets
--             its own check (31) because an update that skipped the snap would
--             make "rename your alert" a one-call way to launder an exact home
--             address into a row still flagged approximate = true.
--          4. FIVE ALERTS MUST STILL PRODUCE ONE PUSH. Since 20260802150000 a
--             user may hold up to five alerts, and several of them can
--             legitimately cover the same post ("Zephyrs near home", "anything
--             near work", "high-bounty anything"). Everything that collapses
--             that to a single notification is USER-keyed, never alert-keyed:
--             select distinct z.user_id, the (user_id, kind, subject_id) dedup,
--             and the rolling-24h cap. The distinct is now LOAD-BEARING -- the
--             unique index that used to make it belt-and-braces is gone. CHECK
--             43 is that property: three matching alerts, ONE entry in
--             user_ids, ONE push_sends row.
--        Plus the two things that are cheap to get wrong and expensive to ship:
--        the cross-account push leak (CHECK 26 -- push_tokens is keyed on the
--        TOKEN precisely so a handset changing hands cannot deliver the previous
--        user's pushes to its new holder), and the service-role-only grant
--        posture on every function that trusts its caller (CHECK 30).
-- LINKS: supabase/migrations/20260802100000_push_infrastructure.sql,
--        supabase/migrations/20260802110000_post_alert_columns.sql,
--        supabase/migrations/20260802120000_alert_zones.sql,
--        supabase/migrations/20260802130000_alert_matching.sql,
--        supabase/migrations/20260802140000_notification_claims.sql,
--        supabase/migrations/20260802150000_multi_alert.sql (MULTI-ALERT v2:
--          label -> name NOT NULL, the six NULLABLE criteria columns, the
--          DROPPED one-zone-per-user unique index, and the five id-scoped RPCs
--          that replace the three v1 ones),
--        supabase/migrations/20260802160000_alert_criteria_matching.sql
--          (match_alert_zones honours the criteria, compared lower(btrim(...))
--          on BOTH sides; search_posts agrees with it),
--        docs/DOMAIN.md (Notifications -- alert radius 1-50 miles, the PostGIS
--          fan-out when a post goes active; Sighting rules; Chat),
--        docs/SECURITY_AND_TRUST.md §1 (report don't approach on EVERY alert;
--          minimisation), §2 (anti-stalking; ~1km coarsening), §3 (message
--          CONTENT never transits third-party infrastructure), §6 (RLS
--          deny-by-default; service-role keys only in Edge Function secrets),
--        scripts/test-db.sh (this file is in its suite list).
--
-- SELF-ASSERTING: every check is a DO block that RAISES EXCEPTION on failure,
-- so the whole file aborts non-zero the moment a property is violated
-- (psql -v ON_ERROR_STOP=1). On success each block emits a NOTICE.
--
-- Run against a local DB seeded by supabase/seed.sql:
--     supabase db reset
--     psql -v ON_ERROR_STOP=1 "$DATABASE_URL" -f supabase/tests/alerts_verification.sql
--
-- Fixtures. Users are the seed profiles (supabase/seed.sql); every POST, ALERT,
-- TOKEN, LEDGER ROW, SIGHTING, THREAD and MESSAGE below is created BY THIS FILE
-- and removed again in housekeeping:
--   OWNER   Alex  11111111-... -- owns every c1c1c1c1 post; also the CHECK 6
--                                 owner-exclusion subject (he holds an alert
--                                 covering his own post's last-seen point).
--   SPOT_A  Beth  22222222-... -- primary spotter; the capped user in CHECK 12;
--                                 in CHECKs 36-44 she is the user whose alert
--                                 carries the criterion under test.
--   SPOT_B  Carl  33333333-... -- second spotter; the 25h-ago user in CHECK 12;
--                                 the "every criterion NULL = ANY" CONTROL in
--                                 CHECKs 36-42; the stranger in CHECK 33.
--   SPOT_C  Dana  44444444-... -- the alert-RPC subject (CHECKs 7-11, 31-35).
--   SPOT_D  Evan  55555555-... -- token-lifecycle second account (CHECK 26) and
--                                 the second account in CHECK 32, which proves
--                                 the five-alert cap counts ONLY the caller.
--   Posts (all owned by Alex). The first fixture block uses make 'Zephyr' /
--   model 'Zodiac' / colour 'Chartreuse' -- words no seed row uses, so no body
--   or criteria assertion can ever pass on someone else's car:
--     ...0001 IN post,  5 miles east of the alert centre; plate 'ZZ11 PLT',
--             last_seen_area 'Shenley Rd, Hemel Hempstead, HP2 7RJ' and
--             last_seen_locality 'Hemel Hempstead' -- the street-vs-district
--             pair CHECK 19 turns on.
--     ...0002 OUT post, 20 miles east.
--     ...0003 BOUNDARY-IN post   (repositioned inside CHECK 3 to exactly
--             radius_m metres from the centre).
--     ...0004 BOUNDARY-OUT post  (repositioned to radius_m + 50 metres).
--     ...0005 NULL last_seen_location (CHECK 5).
--     ...0006 DRAFT post (CHECK 16 -- claim_post_alerts must refuse it).
--     ...0007 locality NULL (CHECK 20 -- the 'your area' fallback).
--     ...0008 claim happy path (CHECK 15).
--     ...0009 cap post (CHECK 12).
--     ...000a dedup post (CHECK 13).
--     ...000b ledger post (CHECK 14).
--     ...000c / ...000d the SAME point, 800m from Dana's picked point: one
--             matched before snapping and one after (CHECK 10).
--     ...000e notification-claims post (CHECKs 22-25) -- carries the sighting,
--             the thread and the two messages.
--   The CRITERIA posts (the second fixture block, CHECKs 36-44) keep exactly the
--   same discipline -- distinctive words, so "did not match" is never an
--   accident of shared vocabulary:
--     ...0010 SATISFIES every criterion: Zephyr / Zodiac / Chartreuse /
--             body_type 'Fastback' / bounty 250000 / last seen 1 hour ago.
--     ...0011 SATISFIES NONE of them: Nimbus / Nomad / Vermilion / 'Dropside' /
--             bounty 5000 / last seen 30 days ago. ONE post pair therefore
--             drives all six criterion checks, each isolated by an alert that
--             sets exactly ONE criterion and leaves the rest NULL.
--     ...0012 / ...0013 / ...0014 make 'BMW' / 'bmw' / '  BMW ' -- the
--             case-and-whitespace trio (CHECK 42). 'BMW' is deliberately NOT a
--             private word: those are PRESENCE assertions on posts addressed by
--             id, so a seed row sharing the make cannot make them pass.
--     ...0015 the ONE-PUSH post (CHECK 43); ...0017 / ...0018 its two extra
--             probe posts, identical to ...0010, used to prove each of the three
--             alerts matches ON ITS OWN before they are matched together.
--     ...0016 the per-alert enabled/paused post (CHECK 44).
--   Tokens: 'ExponentPushToken[tid-verif-...]' (prefix-deleted in housekeeping).
--
-- EXPLICIT SETUP PER BLOCK -- and WHY this note changed. Until 20260802150000,
-- alert_zones carried a UNIQUE index on user_id, so "one row per fixture user"
-- was a SCHEMA guarantee and a block could lean on it. That index is DROPPED:
-- many rows per user is now the normal case, and nothing about the table
-- constrains what an earlier block left behind. So every matching block deletes
-- the fixture users' alerts AND their ledger rows up front and then inserts
-- EXACTLY the rows it asserts on, each named after its own check; every RPC
-- block deletes its subject's alerts first and then identifies the row it
-- created BY ID, never as "the user's alert". Nothing depends on the block
-- before it.
--
-- auth.uid() reads the request.jwt.claims GUC; client-facing checks additionally
-- SET LOCAL ROLE authenticated / anon so the GRANT layer applies for real (the
-- technique from anon_role_verification.sql). The SERVICE-ROLE-ONLY functions
-- (claim_post_alerts, match_alert_zones, the two notification claims,
-- prune_push_token) are called under the file's default superuser role -- their
-- grant posture is asserted from the catalogs in CHECK 30 instead.
--
-- IDEMPOTENCY: everything this file creates is deleted up-front AND at the end.
--
-- CHECKS: 1 in-radius · 2 out-of-radius · 3 INCLUSIVE boundary · 4 disabled
-- alert · 5 null point · 6 OWNER EXCLUSION · 7 create_my_alert snaps BEFORE
-- storage · 8 snap offset bounded · 9 exact mode stores the exact point ·
-- 10 snapping does not break matching at the 1-mile minimum · 11 create_my_alert
-- and list_my_alerts return the STORED point · 12 rolling-24h cap · 13
-- same-subject dedup · 14 one ledger row per user · 15/16 claim idempotence +
-- non-active refusal · 17 no plate in the body · 18 no coordinates · 19 locality
-- not street · 20 'your area' fallback · 21 the don't-approach clause · 22/23
-- sighting claim authorisation + replay · 24 system messages never push · 25
-- first name + post context, never content · 26 the cross-account token leak ·
-- 27 unregister is a silent no-op · 28/29/30 ABSENCE (grants on the four tables;
-- every RPC, the five NEW alert ones included; and the three v1 alert RPCs are
-- GONE) · 31 update_my_alert snaps too · 32 the FIVE-alert cap, counted per
-- caller · 33 ownership on every id-scoped write · 34 the schema delta (name
-- NOT NULL, no label, no one-per-user unique index) · 35 name validation ·
-- 36-41 ONE criterion each (make · model · colour · body_type ·
-- min_bounty_pence · recency_days), each with the NULL = ANY control ·
-- 42 case-insensitive, trimmed matching · 43 THREE MATCHING ALERTS, ONE PUSH ·
-- 44 disabled alerts excluded PER ALERT.
-- =============================================================================


-- ST_* (PostGIS) must resolve whether the extension lives in public or
-- extensions -- the same line seed.sql opens with.
set search_path = public, extensions;


-- -----------------------------------------------------------------------------
-- Clean up any leftovers from a previous run of this file. Posts go LAST: the
-- sighting, thread and message fixtures cascade from them.
-- -----------------------------------------------------------------------------
delete from public.push_sends
where user_id in ('11111111-1111-1111-1111-111111111111',
                  '22222222-2222-2222-2222-222222222222',
                  '33333333-3333-3333-3333-333333333333',
                  '44444444-4444-4444-4444-444444444444',
                  '55555555-5555-5555-5555-555555555555');
delete from public.alert_zones
where user_id in ('11111111-1111-1111-1111-111111111111',
                  '22222222-2222-2222-2222-222222222222',
                  '33333333-3333-3333-3333-333333333333',
                  '44444444-4444-4444-4444-444444444444',
                  '55555555-5555-5555-5555-555555555555');
delete from public.push_tokens where token like 'ExponentPushToken[tid-verif-%';
delete from public.posts where id::text like 'c1c1c1c1-%';


-- -----------------------------------------------------------------------------
-- FIXTURE POSTS. All owned by Alex; make/model/colour are deliberately words no
-- seed row uses, so a body assertion can never pass on someone else's car.
-- Coordinates are built with ST_Project (geodesic, TRUE metres) from one centre,
-- so "5 miles away" means five miles on the spheroid rather than a hand-picked
-- decimal that drifts with latitude. ST_MakePoint takes LONGITUDE first.
-- -----------------------------------------------------------------------------
insert into public.posts (
  id, owner_id, status, bounty_amount_pence, plate, make, model, colour,
  last_seen_at, last_seen_area, last_seen_locality, last_seen_location,
  expires_at, created_at
)
select v.id,
       '11111111-1111-1111-1111-111111111111',
       v.status::public.post_status,
       25000,
       v.plate, 'Zephyr', 'Zodiac', 'Chartreuse',
       now() - interval '1 hour',
       v.area, v.locality, v.loc,
       now() + interval '89 days',
       now() - interval '1 hour'
from (values
  -- IN: 5 miles due east of the centre (10-mile zone -> must match).
  ('c1c1c1c1-0000-0000-0000-000000000001'::uuid, 'active', 'ZZ11 PLT',
   'Shenley Rd, Hemel Hempstead, HP2 7RJ', 'Hemel Hempstead',
   ST_Project(ST_SetSRID(ST_MakePoint(-2.2426, 53.4808), 4326)::geography, 8046.72, radians(90))),
  -- OUT: 20 miles due east (same 10-mile zone -> must NOT match).
  ('c1c1c1c1-0000-0000-0000-000000000002'::uuid, 'active', 'ZZ12 OUT',
   'Shenley Rd, Hemel Hempstead, HP2 7RJ', 'Hemel Hempstead',
   ST_Project(ST_SetSRID(ST_MakePoint(-2.2426, 53.4808), 4326)::geography, 32186.88, radians(90))),
  -- BOUNDARY pair: placeholders, repositioned exactly inside CHECK 3.
  ('c1c1c1c1-0000-0000-0000-000000000003'::uuid, 'active', 'ZZ13 BIN',
   null, 'Hemel Hempstead',
   ST_SetSRID(ST_MakePoint(-2.2426, 53.4808), 4326)::geography),
  ('c1c1c1c1-0000-0000-0000-000000000004'::uuid, 'active', 'ZZ14 BUT',
   null, 'Hemel Hempstead',
   ST_SetSRID(ST_MakePoint(-2.2426, 53.4808), 4326)::geography),
  -- NULL last-seen point: matches nobody, must not error (CHECK 5).
  ('c1c1c1c1-0000-0000-0000-000000000005'::uuid, 'active', 'ZZ15 NUL',
   null, 'Hemel Hempstead', null::geography),
  -- DRAFT: claim_post_alerts must refuse it (CHECK 16).
  ('c1c1c1c1-0000-0000-0000-000000000006'::uuid, 'draft', 'ZZ16 DRF',
   null, 'Hemel Hempstead',
   ST_SetSRID(ST_MakePoint(-2.2426, 53.4808), 4326)::geography),
  -- locality NULL -> the body must fall back to the literal 'your area'.
  ('c1c1c1c1-0000-0000-0000-000000000007'::uuid, 'active', 'ZZ17 FBK',
   'Shenley Rd, Hemel Hempstead, HP2 7RJ', null,
   ST_SetSRID(ST_MakePoint(-2.2426, 53.4808), 4326)::geography),
  -- claim happy path / cap / dedup / ledger posts, all at the centre.
  ('c1c1c1c1-0000-0000-0000-000000000008'::uuid, 'active', 'ZZ18 CLM',
   null, 'Hemel Hempstead',
   ST_SetSRID(ST_MakePoint(-2.2426, 53.4808), 4326)::geography),
  ('c1c1c1c1-0000-0000-0000-000000000009'::uuid, 'active', 'ZZ19 CAP',
   null, 'Hemel Hempstead',
   ST_SetSRID(ST_MakePoint(-2.2426, 53.4808), 4326)::geography),
  ('c1c1c1c1-0000-0000-0000-00000000000a'::uuid, 'active', 'ZZ20 DUP',
   null, 'Hemel Hempstead',
   ST_SetSRID(ST_MakePoint(-2.2426, 53.4808), 4326)::geography),
  ('c1c1c1c1-0000-0000-0000-00000000000b'::uuid, 'active', 'ZZ21 LDG',
   null, 'Hemel Hempstead',
   ST_SetSRID(ST_MakePoint(-2.2426, 53.4808), 4326)::geography),
  -- CHECK 10's pair: the SAME point, 800m east of Dana's picked location, so
  -- one can be matched with an exact zone and the other with the snapped one
  -- without the same-subject dedup hiding the second result.
  ('c1c1c1c1-0000-0000-0000-00000000000c'::uuid, 'active', 'ZZ22 SNA',
   null, 'Hemel Hempstead',
   ST_Project(ST_SetSRID(ST_MakePoint(-2.2449, 53.4849), 4326)::geography, 800, radians(90))),
  ('c1c1c1c1-0000-0000-0000-00000000000d'::uuid, 'active', 'ZZ23 SNB',
   null, 'Hemel Hempstead',
   ST_Project(ST_SetSRID(ST_MakePoint(-2.2449, 53.4849), 4326)::geography, 800, radians(90))),
  -- The notification-claims post (CHECKs 22-25).
  ('c1c1c1c1-0000-0000-0000-00000000000e'::uuid, 'active', 'ZZ24 NTF',
   null, 'Hemel Hempstead',
   ST_SetSRID(ST_MakePoint(-2.2426, 53.4808), 4326)::geography)
) as v(id, status, plate, area, locality, loc);


-- -----------------------------------------------------------------------------
-- CRITERIA FIXTURE POSTS (CHECKs 36-44). All active, all at the alert centre, so
-- geography is never what decides these blocks -- only the criteria are.
--
-- ...0010 satisfies EVERY criterion an alert can carry and ...0011 satisfies
-- NONE of them, which is what lets one post pair drive all six criterion checks:
-- each block sets exactly ONE criterion on the alert, so the pair differs in the
-- only field that block is about. The values keep the file's discipline (Nimbus
-- / Nomad / Vermilion / Dropside are words no seed row uses), with the single
-- deliberate exception of the 'BMW' trio -- see the header.
-- -----------------------------------------------------------------------------
insert into public.posts (
  id, owner_id, status, bounty_amount_pence, plate, make, model, colour,
  body_type, last_seen_at, last_seen_area, last_seen_locality,
  last_seen_location, expires_at, created_at
)
select v.id,
       '11111111-1111-1111-1111-111111111111',
       'active'::public.post_status,
       v.bounty,                                     -- MONEY: integer pence, GBP
       v.plate, v.make, v.model, v.colour, v.body_type,
       v.seen,
       null, 'Hemel Hempstead',
       ST_SetSRID(ST_MakePoint(-2.2426, 53.4808), 4326)::geography,
       now() + interval '89 days',
       now() - interval '1 hour'
from (values
  -- Satisfies every criterion: make/model/colour/body_type, a 2500 GBP bounty
  -- (well over the 1000 GBP filter CHECK 40 sets) and seen an hour ago.
  ('c1c1c1c1-0000-0000-0000-000000000010'::uuid, 'ZZ30 CYE',
   'Zephyr', 'Zodiac', 'Chartreuse', 'Fastback', 250000, now() - interval '1 hour'),
  -- Satisfies none: every attribute differs, the bounty is the 50 GBP minimum,
  -- and it was last seen 30 days ago (outside CHECK 41's 3-day window).
  ('c1c1c1c1-0000-0000-0000-000000000011'::uuid, 'ZZ31 CNO',
   'Nimbus', 'Nomad', 'Vermilion', 'Dropside', 5000, now() - interval '30 days'),
  -- The case-and-whitespace trio (CHECK 42): the SAME make, stored three ways,
  -- because posts.make carries no CHECK and no normalisation.
  ('c1c1c1c1-0000-0000-0000-000000000012'::uuid, 'ZZ32 CIU',
   'BMW', 'Zodiac', 'Chartreuse', 'Fastback', 25000, now() - interval '1 hour'),
  ('c1c1c1c1-0000-0000-0000-000000000013'::uuid, 'ZZ33 CIL',
   'bmw', 'Zodiac', 'Chartreuse', 'Fastback', 25000, now() - interval '1 hour'),
  ('c1c1c1c1-0000-0000-0000-000000000014'::uuid, 'ZZ34 CIP',
   '  BMW ', 'Zodiac', 'Chartreuse', 'Fastback', 25000, now() - interval '1 hour'),
  -- The one-push post and its two probe twins (CHECK 43): identical to ...0010,
  -- so each of the three alerts can be shown to match ON ITS OWN, on its own
  -- post, without the same-subject dedup being mistaken for a matching failure.
  ('c1c1c1c1-0000-0000-0000-000000000015'::uuid, 'ZZ35 ONE',
   'Zephyr', 'Zodiac', 'Chartreuse', 'Fastback', 250000, now() - interval '1 hour'),
  ('c1c1c1c1-0000-0000-0000-000000000017'::uuid, 'ZZ37 PRB',
   'Zephyr', 'Zodiac', 'Chartreuse', 'Fastback', 250000, now() - interval '1 hour'),
  ('c1c1c1c1-0000-0000-0000-000000000018'::uuid, 'ZZ38 PRB',
   'Zephyr', 'Zodiac', 'Chartreuse', 'Fastback', 250000, now() - interval '1 hour'),
  -- The per-alert enabled/paused post (CHECK 44).
  ('c1c1c1c1-0000-0000-0000-000000000016'::uuid, 'ZZ36 DIS',
   'Zephyr', 'Zodiac', 'Chartreuse', 'Fastback', 25000, now() - interval '1 hour')
) as v(id, plate, make, model, colour, body_type, bounty, seen);


-- -----------------------------------------------------------------------------
-- CHECK 1 -- IN. A 10-mile zone matches a post ~5 miles away. The base case: if
-- this fails, nothing else in the file means anything.
-- -----------------------------------------------------------------------------
do $$
declare
  v_doc jsonb;
  v_ids jsonb;
begin
  -- Hermetic: rebuild the zone set and clear the ledger (see the header).
  delete from public.push_sends where user_id in (
    '11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222',
    '33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444',
    '55555555-5555-5555-5555-555555555555');
  delete from public.alert_zones where user_id in (
    '11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222',
    '33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444',
    '55555555-5555-5555-5555-555555555555');

  -- Beth: ONE enabled alert at the centre, radius 10 miles (16093 m), with no
  -- criteria at all -- the v1 shape, which must still behave exactly as it did.
  insert into public.alert_zones (user_id, name, point, radius_m, enabled, approximate)
  values ('22222222-2222-2222-2222-222222222222', 'CHECK 1 in-radius',
          ST_SetSRID(ST_MakePoint(-2.2426, 53.4808), 4326)::geography,
          16093, true, false);

  v_doc := public.match_alert_zones('c1c1c1c1-0000-0000-0000-000000000001');
  v_ids := v_doc -> 'user_ids';

  if not (v_ids ? '22222222-2222-2222-2222-222222222222') then
    raise exception 'CHECK 1 FAILED: a 10-mile zone did NOT match a post 5 miles away: %', v_doc;
  end if;
  raise notice 'CHECK 1 passed: a 10-mile alert zone matches a post ~5 miles away';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 2 -- OUT. The SAME zone does not match a post ~20 miles away. Paired
-- with CHECK 1 deliberately: one zone, two posts, so a matcher that simply
-- returns everybody cannot pass both.
-- -----------------------------------------------------------------------------
do $$
declare
  v_doc jsonb;
begin
  delete from public.push_sends where user_id in (
    '11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222',
    '33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444',
    '55555555-5555-5555-5555-555555555555');
  delete from public.alert_zones where user_id in (
    '11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222',
    '33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444',
    '55555555-5555-5555-5555-555555555555');

  insert into public.alert_zones (user_id, name, point, radius_m, enabled, approximate)
  values ('22222222-2222-2222-2222-222222222222', 'CHECK 2 out-of-radius',
          ST_SetSRID(ST_MakePoint(-2.2426, 53.4808), 4326)::geography,
          16093, true, false);

  v_doc := public.match_alert_zones('c1c1c1c1-0000-0000-0000-000000000002');

  if jsonb_array_length(v_doc -> 'user_ids') <> 0 then
    raise exception 'CHECK 2 FAILED: a 10-mile zone matched a post 20 miles away: %', v_doc;
  end if;
  -- ...and no ledger row was written for a user who was never matched.
  if exists (select 1 from public.push_sends
              where subject_id = 'c1c1c1c1-0000-0000-0000-000000000002') then
    raise exception 'CHECK 2 FAILED: a push_sends row exists for an unmatched post';
  end if;
  raise notice 'CHECK 2 passed: the same zone does NOT match a post ~20 miles away';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 3 -- A POST ON THE RIM STILL MATCHES. A spotter one metre outside a
-- 10-mile circle is not meaningfully further away than one metre inside it, so
-- the rim must not be a cliff: this is what catches a unit slip (miles compared
-- against metres) or a radius arithmetic error, either of which would move the
-- edge by kilometres.
--
-- ⚠️ THIS DELIBERATELY DOES NOT ASSERT "<= RATHER THAN <" AT EXACT EQUALITY.
-- An earlier version did, and it FAILED -- not because match_alert_zones is
-- wrong (it uses ST_DWithin, asserted below), but because the premise is
-- untestable. ST_DWithin does not compare against ST_Distance's answer; it runs
-- its own geodesic, and the two disagree in the last bit. Measured on PostGIS
-- 3.3 / PostgreSQL 17, at this latitude:
--
--     ST_Distance(c, p)                     -> 16093.0 exactly
--     ST_DWithin(c, p, 16093)               -> FALSE
--     ST_DWithin(c, p, ST_Distance(c, p))   -> FALSE   <-- the giveaway
--
-- So no integer radius_m exists at which a projected point sits provably "on"
-- the boundary, and a test demanding one asserts a property of floating-point
-- geodesics rather than of our code. That distinction is worth nothing to a
-- user (sub-millimetre at 16 km) and would fail again on any PostGIS upgrade
-- that retunes either function.
--
-- HOW THE FIXTURE IS BUILT: fix the radius, then project the in-post half a
-- metre INSIDE it -- the finest an integer-metre column can express -- and
-- assert it is genuinely within the last metre (distance > radius_m - 1) so a
-- future edit cannot quietly move it somewhere comfortable. The out-post is
-- 50 m beyond the rim. CHECK 3b pins the operator itself from the catalogue,
-- which is what actually guards against the hand-rolled-comparison swap.
-- -----------------------------------------------------------------------------
do $$
declare
  v_centre geography := ST_SetSRID(ST_MakePoint(-2.2426, 53.4808), 4326)::geography;
  v_in     geography;
  v_out    geography;
  v_dist   double precision;
  v_radius int;
  v_doc    jsonb;
begin
  delete from public.push_sends where user_id in (
    '11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222',
    '33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444',
    '55555555-5555-5555-5555-555555555555');
  delete from public.alert_zones where user_id in (
    '11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222',
    '33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444',
    '55555555-5555-5555-5555-555555555555');

  v_radius := 16093;                                        -- 10 miles, to the metre
  v_in     := ST_Project(v_centre, v_radius - 0.5, radians(45));
  v_out    := ST_Project(v_centre, v_radius + 50, radians(45));
  v_dist   := ST_Distance(v_centre, v_in);

  -- Setup assertion: the in-post really is ON the rim (inside the last metre),
  -- not merely somewhere within it.
  if v_dist <= v_radius - 1 then
    raise exception 'CHECK 3 SETUP FAILED: the boundary post is % m inside a % m radius, not on the rim',
      v_radius - v_dist, v_radius;
  end if;

  update public.posts set last_seen_location = v_in
   where id = 'c1c1c1c1-0000-0000-0000-000000000003';
  update public.posts set last_seen_location = v_out
   where id = 'c1c1c1c1-0000-0000-0000-000000000004';

  insert into public.alert_zones (user_id, name, point, radius_m, enabled, approximate)
  values ('22222222-2222-2222-2222-222222222222', 'CHECK 3 boundary',
          v_centre, v_radius, true, false);

  -- ON THE RIM (within the last metre): matches.
  v_doc := public.match_alert_zones('c1c1c1c1-0000-0000-0000-000000000003');
  if not (v_doc -> 'user_ids' ? '22222222-2222-2222-2222-222222222222') then
    raise exception 'CHECK 3 FAILED: a post ON the rim (% m of a % m radius) did NOT match',
      v_dist, v_radius;
  end if;

  -- ...and radius_m + 50 does not.
  v_doc := public.match_alert_zones('c1c1c1c1-0000-0000-0000-000000000004');
  if jsonb_array_length(v_doc -> 'user_ids') <> 0 then
    raise exception 'CHECK 3 FAILED: a post 50 m OUTSIDE radius_m (% m) matched: %', v_radius, v_doc;
  end if;

  raise notice 'CHECK 3 passed: a post on the rim (% m of % m) matches; radius_m + 50 does not', v_dist, v_radius;
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 3b -- the matcher uses ST_DWithin, not a hand-rolled distance
-- comparison. THIS is the guard CHECK 3 used to attempt through behaviour and
-- could not (see its header): the difference between ST_DWithin and
-- `ST_Distance(...) < radius` is invisible at every distance a test can
-- construct, so it is asserted from the catalogue instead.
--
-- It also matters for SPEED, not just semantics: ST_DWithin is the only form
-- the GiST index on alert_zones.point can answer. A hand-rolled ST_Distance
-- comparison is not sargable, so it would silently become a full scan of every
-- alert in the country on every activated post -- correct, and progressively
-- slower, which is the failure mode nobody notices until launch.
-- -----------------------------------------------------------------------------
do $$
declare
  v_src text;
begin
  select prosrc into v_src from pg_proc where proname = 'match_alert_zones';

  if v_src !~* 'ST_DWithin' then
    raise exception 'CHECK 3b FAILED: match_alert_zones no longer calls ST_DWithin -- the GiST index cannot answer whatever replaced it';
  end if;

  if v_src ~* 'ST_Distance\s*\([^;]*?\)\s*[<>]' then
    raise exception 'CHECK 3b FAILED: match_alert_zones compares ST_Distance with an inequality -- not index-answerable, and it changes the boundary';
  end if;

  raise notice 'CHECK 3b passed: matching goes through ST_DWithin (GiST-answerable), with no hand-rolled distance comparison';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 4 -- a DISABLED zone never matches. "Pause my alerts" is a promise the
-- matcher keeps, not the client: the zone row survives (disabled is not deleted)
-- and must simply never appear in an audience.
-- -----------------------------------------------------------------------------
do $$
declare
  v_doc jsonb;
begin
  delete from public.push_sends where user_id in (
    '11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222',
    '33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444',
    '55555555-5555-5555-5555-555555555555');
  delete from public.alert_zones where user_id in (
    '11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222',
    '33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444',
    '55555555-5555-5555-5555-555555555555');

  -- Beth's alert is identical to CHECK 1's -- which matched -- except enabled.
  insert into public.alert_zones (user_id, name, point, radius_m, enabled, approximate)
  values ('22222222-2222-2222-2222-222222222222', 'CHECK 4 paused',
          ST_SetSRID(ST_MakePoint(-2.2426, 53.4808), 4326)::geography,
          16093, false, false);

  v_doc := public.match_alert_zones('c1c1c1c1-0000-0000-0000-000000000001');
  if jsonb_array_length(v_doc -> 'user_ids') <> 0 then
    raise exception 'CHECK 4 FAILED: a DISABLED zone was alerted: %', v_doc;
  end if;

  -- The alert must still EXIST -- pausing keeps the area (see the enabled column
  -- comment in 20260802150000; per-alert since v2, but the rule is unchanged).
  if not exists (select 1 from public.alert_zones
                  where user_id = '22222222-2222-2222-2222-222222222222'
                    and name = 'CHECK 4 paused') then
    raise exception 'CHECK 4 FAILED: the disabled alert row disappeared';
  end if;

  raise notice 'CHECK 4 passed: enabled = false never matches, and the alert survives';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 5 -- a post with a NULL last_seen_location matches NOBODY, and does not
-- error. ST_DWithin(null, ...) is null so this would fall out anyway; the point
-- is that "no location" can never become "matches everyone" -- the worst possible
-- direction for this bug, since it would push every spotter in the country.
-- -----------------------------------------------------------------------------
do $$
declare
  v_doc jsonb;
begin
  delete from public.push_sends where user_id in (
    '11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222',
    '33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444',
    '55555555-5555-5555-5555-555555555555');
  delete from public.alert_zones where user_id in (
    '11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222',
    '33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444',
    '55555555-5555-5555-5555-555555555555');

  -- A 50-mile alert (the maximum) at the centre for two users, with no criteria
  -- to narrow anything: as wide an audience as the product allows, so an
  -- "everyone" bug has every chance to show itself.
  insert into public.alert_zones (user_id, name, point, radius_m, enabled, approximate)
  values ('22222222-2222-2222-2222-222222222222', 'CHECK 5 wide beth',
          ST_SetSRID(ST_MakePoint(-2.2426, 53.4808), 4326)::geography,
          80467, true, false),
         ('33333333-3333-3333-3333-333333333333', 'CHECK 5 wide carl',
          ST_SetSRID(ST_MakePoint(-2.2426, 53.4808), 4326)::geography,
          80467, true, false);

  -- Must not raise.
  v_doc := public.match_alert_zones('c1c1c1c1-0000-0000-0000-000000000005');

  if v_doc is null or not (v_doc ? 'user_ids') then
    raise exception 'CHECK 5 FAILED: a null-location post did not return the standard shape: %', v_doc;
  end if;
  if jsonb_array_length(v_doc -> 'user_ids') <> 0 then
    raise exception 'CHECK 5 FAILED: a post with NO last-seen point matched % user(s): %',
      jsonb_array_length(v_doc -> 'user_ids'), v_doc;
  end if;
  if exists (select 1 from public.push_sends
              where subject_id = 'c1c1c1c1-0000-0000-0000-000000000005') then
    raise exception 'CHECK 5 FAILED: a null-location post wrote ledger rows';
  end if;

  raise notice 'CHECK 5 passed: a null last_seen_location matches nobody and does not error';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 6 -- OWNER EXCLUSION. Alex owns the post AND holds an enabled zone that
-- covers its last-seen point. He must NOT be in user_ids. A victim receiving
-- "a stolen car was reported near you" about their own theft, minutes after
-- reporting it, is the single worst bug this feature could ship -- so the check
-- also proves the audience is non-empty, i.e. that the exclusion is doing the
-- work rather than the whole match silently returning nothing.
-- -----------------------------------------------------------------------------
do $$
declare
  v_doc jsonb;
  v_ids jsonb;
begin
  delete from public.push_sends where user_id in (
    '11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222',
    '33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444',
    '55555555-5555-5555-5555-555555555555');
  delete from public.alert_zones where user_id in (
    '11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222',
    '33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444',
    '55555555-5555-5555-5555-555555555555');

  -- IDENTICAL alerts for the owner and a bystander, so the only difference
  -- between them is ownership of the post.
  insert into public.alert_zones (user_id, name, point, radius_m, enabled, approximate)
  values ('11111111-1111-1111-1111-111111111111',   -- Alex: the post's OWNER
          'CHECK 6 owner',
          ST_SetSRID(ST_MakePoint(-2.2426, 53.4808), 4326)::geography,
          16093, true, false),
         ('22222222-2222-2222-2222-222222222222',   -- Beth: an ordinary spotter
          'CHECK 6 bystander',
          ST_SetSRID(ST_MakePoint(-2.2426, 53.4808), 4326)::geography,
          16093, true, false);

  v_doc := public.match_alert_zones('c1c1c1c1-0000-0000-0000-000000000001');
  v_ids := v_doc -> 'user_ids';

  if v_ids ? '11111111-1111-1111-1111-111111111111' then
    raise exception 'CHECK 6 FAILED: the post OWNER is in the alert audience for their OWN theft: %', v_doc;
  end if;
  if not (v_ids ? '22222222-2222-2222-2222-222222222222') then
    raise exception 'CHECK 6 FAILED: the bystander with the IDENTICAL zone did not match, so the owner exclusion was not what removed the owner: %', v_doc;
  end if;
  -- ...and the owner got no ledger row either (no silently-consumed cap slot).
  if exists (select 1 from public.push_sends
              where user_id = '11111111-1111-1111-1111-111111111111'
                and subject_id = 'c1c1c1c1-0000-0000-0000-000000000001') then
    raise exception 'CHECK 6 FAILED: a push_sends row was written for the post owner';
  end if;

  raise notice 'CHECK 6 passed: the owner is excluded from their own post''s audience while an identical bystander zone matches';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 7 -- create_my_alert SNAPS BEFORE STORAGE (Tier 1 SAFETY). With
-- p_approximate := true the row must hold ST_SnapToGrid(input, 0.01) -- the
-- ~1km cell -- and NOT the point the user actually picked. Asserted against the
-- STORED column, because that is the only thing that matters: the promise is
-- "the database never holds your home", not "the client sent us a rounded one".
--
-- This property carried over UNCHANGED from v1's upsert_my_alert_zone, which
-- 20260802150000 dropped. It now has TWO write paths and both must snap:
-- create_my_alert here, update_my_alert in CHECK 31.
-- -----------------------------------------------------------------------------
do $$
declare
  -- Deliberately OFF-GRID and close to a cell edge (x.xx49), so the snap moves
  -- the point a long way -- a near-worst-case offset rather than a flattering one.
  v_lat      double precision := 53.4849;
  v_lng      double precision := -2.2449;
  v_input    geography := ST_SetSRID(ST_MakePoint(-2.2449, 53.4849), 4326)::geography;
  v_expected geometry  := ST_SnapToGrid(ST_SetSRID(ST_MakePoint(-2.2449, 53.4849), 4326), 0.01);
  v_doc      jsonb;
  v_id       uuid;
  v_stored   geography;
  v_n        int;
begin
  -- EXPLICIT SETUP: Dana starts with no alerts. Nothing guarantees one row per
  -- user any more, so the block creates exactly the row it asserts on and then
  -- addresses it BY ID.
  delete from public.alert_zones where user_id = '44444444-4444-4444-4444-444444444444';

  perform set_config('request.jwt.claims',
    '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}', true);
  set local role authenticated;
  -- (name, lat, lng, radius_m, approximate, enabled, then the six criteria --
  -- NOTE the v2 order: approximate comes BEFORE enabled, the reverse of v1's
  -- upsert_my_alert_zone.)
  v_doc := public.create_my_alert('Home', v_lat, v_lng, 16093, true, true,
                                  null, null, null, null, null, null);
  reset role;

  v_id := (v_doc ->> 'id')::uuid;
  if v_id is null then
    raise exception 'CHECK 7 FAILED: create_my_alert returned no id: %', v_doc;
  end if;

  select count(*) into v_n
  from public.alert_zones where user_id = '44444444-4444-4444-4444-444444444444';
  if v_n <> 1 then
    raise exception 'CHECK 7 FAILED: one create wrote % row(s)', v_n;
  end if;

  select z.point into v_stored from public.alert_zones z where z.id = v_id;
  if v_stored is null then
    raise exception 'CHECK 7 FAILED: create_my_alert stored no alert';
  end if;

  -- (a) the stored point IS the snapped point, coordinate for coordinate.
  if ST_X(v_stored::geometry) <> ST_X(v_expected)
     or ST_Y(v_stored::geometry) <> ST_Y(v_expected) then
    raise exception 'CHECK 7 FAILED: stored point (%, %) is not ST_SnapToGrid(input, 0.01) = (%, %)',
      ST_X(v_stored::geometry), ST_Y(v_stored::geometry), ST_X(v_expected), ST_Y(v_expected);
  end if;

  -- (b) ...and it is NOT the point the user picked. This is the assertion that
  -- fails the day the snap is moved to read time (or to the client).
  if ST_Distance(v_stored, v_input) <= 0 then
    raise exception 'CHECK 7 FAILED: the EXACT point the user picked was stored (distance to input is 0) despite approximate = true';
  end if;

  -- (c) the row records what was done to the point.
  if not exists (select 1 from public.alert_zones where id = v_id and approximate) then
    raise exception 'CHECK 7 FAILED: the row is not flagged approximate';
  end if;

  raise notice 'CHECK 7 passed: create_my_alert stores the ~1km grid cell, not the picked point (offset % m)',
    round(ST_Distance(v_stored, v_input)::numeric, 1);
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 8 -- the snap offset is BOUNDED. A 0.01-degree cell is ~1.1km of
-- latitude and ~0.66km of longitude at UK latitudes, so the worst-case
-- half-cell displacement is well under 800 m. Guards the other direction from
-- CHECK 7: coarsening that wandered kilometres would not be privacy, it would
-- be a broken alert (and CHECK 10 would start failing for real users).
-- -----------------------------------------------------------------------------
do $$
declare
  v_input  geography := ST_SetSRID(ST_MakePoint(-2.2449, 53.4849), 4326)::geography;
  v_doc    jsonb;
  v_stored geography;
  v_offset double precision;
begin
  -- Self-contained rather than reading CHECK 7's row: with many alerts per user
  -- possible, "the user's alert" is no longer a thing a block may reach for.
  delete from public.alert_zones where user_id = '44444444-4444-4444-4444-444444444444';

  perform set_config('request.jwt.claims',
    '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}', true);
  set local role authenticated;
  v_doc := public.create_my_alert('Home', 53.4849, -2.2449, 16093, true, true,
                                  null, null, null, null, null, null);
  reset role;

  select z.point into v_stored
  from public.alert_zones z where z.id = (v_doc ->> 'id')::uuid;
  if v_stored is null then
    raise exception 'CHECK 8 SETUP FAILED: no alert was stored';
  end if;

  v_offset := ST_Distance(v_stored, v_input);

  if v_offset <= 0 or v_offset >= 800 then
    raise exception 'CHECK 8 FAILED: snap offset is % m -- expected 0 < offset < 800 at UK latitudes', v_offset;
  end if;

  raise notice 'CHECK 8 passed: the approximate-mode offset is % m (0 < offset < 800)',
    round(v_offset::numeric, 1);
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 9 -- with p_approximate := false the stored point IS the input. The
-- toggle has to be a real choice in both directions: a user who opts into an
-- exact alert (say a village where the ~1km cell would push their radius over
-- the next town) must get one, or "approximate" is not a setting, it is a lie.
-- -----------------------------------------------------------------------------
do $$
declare
  v_lat    double precision := 53.4849;
  v_lng    double precision := -2.2449;
  v_input  geography := ST_SetSRID(ST_MakePoint(-2.2449, 53.4849), 4326)::geography;
  v_doc    jsonb;
  v_id     uuid;
  v_stored geography;
begin
  delete from public.alert_zones where user_id = '44444444-4444-4444-4444-444444444444';

  perform set_config('request.jwt.claims',
    '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}', true);
  set local role authenticated;
  v_doc := public.create_my_alert('Home exact', v_lat, v_lng, 16093, false, true,
                                  null, null, null, null, null, null);
  reset role;

  v_id := (v_doc ->> 'id')::uuid;
  select z.point into v_stored from public.alert_zones z where z.id = v_id;

  if ST_X(v_stored::geometry) <> v_lng or ST_Y(v_stored::geometry) <> v_lat then
    raise exception 'CHECK 9 FAILED: exact mode stored (%, %) instead of the submitted (%, %)',
      ST_X(v_stored::geometry), ST_Y(v_stored::geometry), v_lng, v_lat;
  end if;
  if ST_Distance(v_stored, v_input) <> 0 then
    raise exception 'CHECK 9 FAILED: exact mode moved the point by % m', ST_Distance(v_stored, v_input);
  end if;
  if exists (select 1 from public.alert_zones where id = v_id and approximate) then
    raise exception 'CHECK 9 FAILED: the row is flagged approximate after an exact write';
  end if;

  raise notice 'CHECK 9 passed: p_approximate = false stores the submitted point exactly';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 10 -- SNAPPING MUST NOT BREAK MATCHING. A post in range of the exact
-- alert is still in range after the SAME alert is re-saved in approximate mode,
-- at the 1-MILE MINIMUM radius (1609 m) -- the tightest circle the product
-- allows, where a ~650 m displacement has the most room to do damage. A privacy
-- measure that silently stops alerting people is worse than no privacy measure:
-- it fails invisibly, and the user still believes they are covered.
--
-- Two posts at the IDENTICAL point are used rather than one matched twice, so
-- the same-subject dedup cannot be mistaken for a matching failure. The re-save
-- goes through update_my_alert on the SAME alert id (v2 has no upsert), which is
-- also how a real user edits one.
-- -----------------------------------------------------------------------------
do $$
declare
  v_doc    jsonb;
  v_id     uuid;
  v_before jsonb;
  v_after  jsonb;
begin
  delete from public.push_sends where user_id = '44444444-4444-4444-4444-444444444444';
  delete from public.alert_zones where user_id in (
    '11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222',
    '33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444',
    '55555555-5555-5555-5555-555555555555');

  perform set_config('request.jwt.claims',
    '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}', true);

  -- (a) EXACT alert, 1-mile radius -> the post 800 m away is in range.
  set local role authenticated;
  v_doc := public.create_my_alert('Home', 53.4849, -2.2449, 1609, false, true,
                                  null, null, null, null, null, null);
  reset role;
  v_id := (v_doc ->> 'id')::uuid;

  v_before := public.match_alert_zones('c1c1c1c1-0000-0000-0000-00000000000c');
  if not (v_before -> 'user_ids' ? '44444444-4444-4444-4444-444444444444') then
    raise exception 'CHECK 10 SETUP FAILED: the post is not in range of the EXACT 1-mile alert: %', v_before;
  end if;

  -- (b) the SAME alert, same centre, re-saved in approximate mode -> still in range.
  set local role authenticated;
  perform public.update_my_alert(v_id, 'Home', 53.4849, -2.2449, 1609, true, true,
                                 null, null, null, null, null, null);
  reset role;

  v_after := public.match_alert_zones('c1c1c1c1-0000-0000-0000-00000000000d');
  if not (v_after -> 'user_ids' ? '44444444-4444-4444-4444-444444444444') then
    raise exception 'CHECK 10 FAILED: grid-snapping dropped a post that was in range before, at the 1-mile MINIMUM radius -- the privacy measure silently broke matching: %', v_after;
  end if;

  raise notice 'CHECK 10 passed: a post in range before snapping is still in range after, at the 1-mile minimum radius';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 11 -- the RPCs RETURN THE STORED POINT, not the submitted one. The
-- client pins its map on this payload, so echoing the input back would show the
-- user a pin on their doorstep while the database held a grid cell -- claiming a
-- precision that is not there, and hiding the coarsening the toggle promised.
-- list_my_alerts must agree with create_my_alert: they are ONE contract (the
-- shared element shape), and the settings list is rendered from the former after
-- being written by the latter.
--
-- ⚠️ COMPARED WITH A TOLERANCE, NOT FOR BIT EQUALITY -- and that is not
-- laziness. The point travels back as JSONB, and to_jsonb(float8) renders via
-- float8out, which honours the `extra_float_digits` GUC. Supabase ships it at
-- 0, where the output is the ROUNDED short form rather than the shortest
-- round-trip form, so the value parses back one ULP away from what is stored:
--
--     stored   ST_Y  -> 404abd70a3d70a3e
--     returned lat   -> 404abd70a3d70a3d      (7.1e-15 deg, ~8 nanometres)
--
-- An earlier version demanded equality and failed on exactly that. Bit-exact
-- agreement across a JSONB round-trip is a property of a server GUC, not of our
-- code, and the client parses into a float64 anyway. So assert what is worth
-- asserting: the returned point is the SNAPPED one to within 1e-9 degrees
-- (~0.1 mm) -- six orders of magnitude tighter than the 0.01 deg (~1 km) grid,
-- so it still cannot pass if the function echoes the submitted point back.
-- -----------------------------------------------------------------------------
do $$
declare
  v_lat    double precision := 53.4849;
  v_lng    double precision := -2.2449;
  v_doc    jsonb;
  v_list   jsonb;
  v_elem   jsonb;
  v_id     uuid;
  v_stored geography;
begin
  delete from public.alert_zones where user_id = '44444444-4444-4444-4444-444444444444';

  perform set_config('request.jwt.claims',
    '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}', true);
  set local role authenticated;
  v_doc := public.create_my_alert('Home', v_lat, v_lng, 16093, true, true,
                                  null, null, null, null, null, null);
  reset role;

  v_id := (v_doc ->> 'id')::uuid;
  select z.point into v_stored from public.alert_zones z where z.id = v_id;

  -- (a) the returned pair IS the stored (snapped) pair, to 1e-9 deg (~0.1 mm).
  if abs((v_doc ->> 'lat')::double precision - ST_Y(v_stored::geometry)) > 1e-9
     or abs((v_doc ->> 'lng')::double precision - ST_X(v_stored::geometry)) > 1e-9 then
    raise exception 'CHECK 11 FAILED: returned (%, %) is not the STORED (%, %)',
      v_doc ->> 'lat', v_doc ->> 'lng',
      ST_Y(v_stored::geometry), ST_X(v_stored::geometry);
  end if;

  -- (b) ...and it is NOT the submitted pair. Asserted as a REAL distance, not
  -- an inequality: an echo of the input differs from the snapped cell by up to
  -- half a grid step (~0.005 deg), so anything under 1e-4 means no snap
  -- happened. `<>` would also "pass" on a 1-ULP difference, which is precisely
  -- the failure this clause exists to catch.
  if abs((v_doc ->> 'lat')::double precision - v_lat) < 1e-4
     or abs((v_doc ->> 'lng')::double precision - v_lng) < 1e-4 then
    raise exception 'CHECK 11 FAILED: create_my_alert echoed the SUBMITTED coordinates back (%, % vs submitted %, %) -- the client pin would claim a precision the row does not have',
      v_doc ->> 'lat', v_doc ->> 'lng', v_lat, v_lng;
  end if;

  -- (c) list_my_alerts must agree -- an ARRAY now, with no v1 { found } key.
  set local role authenticated;
  v_list := public.list_my_alerts();
  reset role;

  if jsonb_typeof(v_list) <> 'array' then
    raise exception 'CHECK 11 FAILED: list_my_alerts did not return a jsonb ARRAY: %', v_list;
  end if;
  if jsonb_array_length(v_list) <> 1 then
    raise exception 'CHECK 11 FAILED: list_my_alerts returned % element(s) for a user with exactly one alert: %',
      jsonb_array_length(v_list), v_list;
  end if;

  select e into v_elem from jsonb_array_elements(v_list) as t(e) limit 1;
  if (v_elem ->> 'id')::uuid <> v_id then
    raise exception 'CHECK 11 FAILED: list_my_alerts returned a different alert id: %', v_elem;
  end if;
  -- Same tolerance, same reason (JSONB float rendering) — see the header.
  if abs((v_elem ->> 'lat')::double precision - ST_Y(v_stored::geometry)) > 1e-9
     or abs((v_elem ->> 'lng')::double precision - ST_X(v_stored::geometry)) > 1e-9 then
    raise exception 'CHECK 11 FAILED: list_my_alerts disagrees with the stored point: %', v_elem;
  end if;
  -- The v1 single-object shape is gone: a stray { found } key would mean a
  -- client still branching on it silently reads "no alerts".
  if v_elem ? 'found' then
    raise exception 'CHECK 11 FAILED: a v1 "found" key survives in the element shape: %', v_elem;
  end if;

  raise notice 'CHECK 11 passed: create_my_alert and list_my_alerts both return the STORED, snapped point';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 12 -- the cap is a ROLLING 24-HOUR WINDOW, not a midnight reset. A user
-- with 3 alert sends inside 24h is excluded; a user whose 3 sends are 25h old is
-- included. A midnight reset would let someone be woken 3 times at 23:50 and 3
-- more at 00:10 -- exactly the pattern that gets notifications turned off for
-- good, which costs the next victim their audience.
-- -----------------------------------------------------------------------------
do $$
declare
  v_doc jsonb;
  v_ids jsonb;
begin
  delete from public.push_sends where user_id in (
    '11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222',
    '33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444',
    '55555555-5555-5555-5555-555555555555');
  delete from public.alert_zones where user_id in (
    '11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222',
    '33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444',
    '55555555-5555-5555-5555-555555555555');

  insert into public.alert_zones (user_id, name, point, radius_m, enabled, approximate)
  values ('22222222-2222-2222-2222-222222222222', 'CHECK 12 capped',
          ST_SetSRID(ST_MakePoint(-2.2426, 53.4808), 4326)::geography,
          16093, true, false),
         ('33333333-3333-3333-3333-333333333333', 'CHECK 12 stale sends',
          ST_SetSRID(ST_MakePoint(-2.2426, 53.4808), 4326)::geography,
          16093, true, false);

  -- Beth: 3 alert sends 1 hour ago -> AT the default cap of 3.
  -- Carl: 3 alert sends 25 hours ago -> outside the window, so 0 counted.
  -- subject_id is a throwaway uuid in every row: these must exercise the CAP,
  -- not the same-subject dedup (which is CHECK 13).
  insert into public.push_sends (user_id, kind, subject_id, created_at)
  select '22222222-2222-2222-2222-222222222222', 'alert', gen_random_uuid(),
         now() - interval '1 hour'
  from generate_series(1, 3);
  insert into public.push_sends (user_id, kind, subject_id, created_at)
  select '33333333-3333-3333-3333-333333333333', 'alert', gen_random_uuid(),
         now() - interval '25 hours'
  from generate_series(1, 3);

  v_doc := public.match_alert_zones('c1c1c1c1-0000-0000-0000-000000000009');
  v_ids := v_doc -> 'user_ids';

  if v_ids ? '22222222-2222-2222-2222-222222222222' then
    raise exception 'CHECK 12 FAILED: a user with 3 alert sends inside 24h was alerted again: %', v_doc;
  end if;
  if not (v_ids ? '33333333-3333-3333-3333-333333333333') then
    raise exception 'CHECK 12 FAILED: a user whose 3 sends are 25h old was NOT alerted -- the window is not rolling: %', v_doc;
  end if;

  raise notice 'CHECK 12 passed: the 24h cap is a rolling window (3 sends at -1h excludes; 3 sends at -25h does not)';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 13 -- SAME-SUBJECT DEDUP. Two calls for the SAME post return the user
-- once. The Edge Function's caller is a Stripe retry away from invoking this
-- twice, and being told about one theft twice is the fastest way to teach
-- someone to swipe alerts away unread.
-- -----------------------------------------------------------------------------
do $$
declare
  v_first  jsonb;
  v_second jsonb;
begin
  delete from public.push_sends where user_id in (
    '11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222',
    '33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444',
    '55555555-5555-5555-5555-555555555555');
  delete from public.alert_zones where user_id in (
    '11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222',
    '33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444',
    '55555555-5555-5555-5555-555555555555');

  insert into public.alert_zones (user_id, name, point, radius_m, enabled, approximate)
  values ('22222222-2222-2222-2222-222222222222', 'CHECK 13 dedup',
          ST_SetSRID(ST_MakePoint(-2.2426, 53.4808), 4326)::geography,
          16093, true, false);

  v_first  := public.match_alert_zones('c1c1c1c1-0000-0000-0000-00000000000a');
  v_second := public.match_alert_zones('c1c1c1c1-0000-0000-0000-00000000000a');

  if not (v_first -> 'user_ids' ? '22222222-2222-2222-2222-222222222222') then
    raise exception 'CHECK 13 SETUP FAILED: the first call did not match the spotter: %', v_first;
  end if;
  if jsonb_array_length(v_second -> 'user_ids') <> 0 then
    raise exception 'CHECK 13 FAILED: a second call for the SAME post returned the user again: %', v_second;
  end if;
  -- The ledger holds exactly one row for the pair, so the dedup is a fact about
  -- the data rather than a coincidence of ordering.
  if (select count(*) from public.push_sends
       where user_id = '22222222-2222-2222-2222-222222222222'
         and kind = 'alert'
         and subject_id = 'c1c1c1c1-0000-0000-0000-00000000000a') <> 1 then
    raise exception 'CHECK 13 FAILED: the ledger does not hold exactly one row for (user, post)';
  end if;

  raise notice 'CHECK 13 passed: a second match for the same post returns the user zero times';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 14 -- exactly ONE push_sends row per returned user. The ledger is the
-- cap and the dedup; a duplicate row would spend two of someone's three daily
-- slots on one notification, and a missing row would let the next invocation
-- push the same theft again.
-- -----------------------------------------------------------------------------
do $$
declare
  v_doc     jsonb;
  v_matched int;
  v_rows    int;
  v_maxdup  int;
begin
  delete from public.push_sends where user_id in (
    '11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222',
    '33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444',
    '55555555-5555-5555-5555-555555555555');
  delete from public.alert_zones where user_id in (
    '11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222',
    '33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444',
    '55555555-5555-5555-5555-555555555555');

  insert into public.alert_zones (user_id, name, point, radius_m, enabled, approximate)
  values ('22222222-2222-2222-2222-222222222222', 'CHECK 14 ledger beth',
          ST_SetSRID(ST_MakePoint(-2.2426, 53.4808), 4326)::geography,
          16093, true, false),
         ('33333333-3333-3333-3333-333333333333', 'CHECK 14 ledger carl',
          ST_SetSRID(ST_MakePoint(-2.2426, 53.4808), 4326)::geography,
          16093, true, false),
         ('55555555-5555-5555-5555-555555555555', 'CHECK 14 ledger evan',
          ST_SetSRID(ST_MakePoint(-2.2426, 53.4808), 4326)::geography,
          16093, true, false);

  v_doc     := public.match_alert_zones('c1c1c1c1-0000-0000-0000-00000000000b');
  v_matched := jsonb_array_length(v_doc -> 'user_ids');

  if v_matched <> 3 then
    raise exception 'CHECK 14 SETUP FAILED: expected 3 matched spotters, got %: %', v_matched, v_doc;
  end if;

  select count(*) into v_rows
  from public.push_sends
  where kind = 'alert' and subject_id = 'c1c1c1c1-0000-0000-0000-00000000000b';

  select coalesce(max(n), 0) into v_maxdup
  from (select count(*) as n
        from public.push_sends
        where kind = 'alert' and subject_id = 'c1c1c1c1-0000-0000-0000-00000000000b'
        group by user_id) g;

  if v_rows <> v_matched then
    raise exception 'CHECK 14 FAILED: % matched user(s) but % ledger row(s)', v_matched, v_rows;
  end if;
  if v_maxdup <> 1 then
    raise exception 'CHECK 14 FAILED: a user has % ledger rows for one post (expected exactly 1)', v_maxdup;
  end if;

  raise notice 'CHECK 14 passed: exactly one push_sends row per returned user (% users, % rows)', v_matched, v_rows;
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 15 -- claim_post_alerts is an idempotent CLAIM. An active, never-alerted
-- post returns claimed:true once; the immediate second call returns
-- claimed:false. stripe-webhook records its dedupe row AFTER the handler
-- commits, so a Stripe retry re-runs the whole thing -- without this compare-
-- and-set, a retry fans a second push out to every spotter within 50 miles.
--
-- Also asserted here: the payload carries NO COORDINATES. For a driveway theft
-- the last-seen point IS the victim's home, and match_alert_zones re-reads the
-- point itself, so the exact pair must never enter an Edge Function's memory,
-- logs or crash reports. (This shape changed after the migration was first
-- written -- the keys are asserted here, not assumed.)
-- -----------------------------------------------------------------------------
do $$
declare
  v_first  jsonb;
  v_second jsonb;
begin
  v_first := public.claim_post_alerts('c1c1c1c1-0000-0000-0000-000000000008');

  if (v_first ->> 'claimed') <> 'true' then
    raise exception 'CHECK 15 FAILED: an active, never-alerted post was not claimed: %', v_first;
  end if;
  if (v_first ->> 'owner_id') <> '11111111-1111-1111-1111-111111111111' then
    raise exception 'CHECK 15 FAILED: wrong owner_id in the claim payload: %', v_first;
  end if;
  if (v_first ->> 'locality') <> 'Hemel Hempstead'
     or (v_first ->> 'make')   <> 'Zephyr'
     or (v_first ->> 'model')  <> 'Zodiac'
     or (v_first ->> 'colour') <> 'Chartreuse' then
    raise exception 'CHECK 15 FAILED: the claim payload lost a copy field: %', v_first;
  end if;

  -- ABSENCE: no coordinates, under any spelling.
  if v_first ? 'lat' or v_first ? 'lng' or v_first ? 'point'
     or v_first ? 'last_seen_location' or v_first ? 'location' then
    raise exception 'CHECK 15 FAILED: claim_post_alerts returned COORDINATES -- a driveway theft''s point is the victim''s home: %', v_first;
  end if;

  -- The claim was burned: an immediate retry gets nothing.
  v_second := public.claim_post_alerts('c1c1c1c1-0000-0000-0000-000000000008');
  if (v_second ->> 'claimed') <> 'false' then
    raise exception 'CHECK 15 FAILED: the SECOND claim on the same post also won: %', v_second;
  end if;
  -- ...and the refusal carries nothing else (no oracle, no partial copy).
  if v_second <> jsonb_build_object('claimed', false) then
    raise exception 'CHECK 15 FAILED: the refusal payload is not the bare { claimed: false }: %', v_second;
  end if;

  if not exists (select 1 from public.posts
                  where id = 'c1c1c1c1-0000-0000-0000-000000000008'
                    and alerts_sent_at is not null) then
    raise exception 'CHECK 15 FAILED: alerts_sent_at was not stamped by the winning claim';
  end if;

  raise notice 'CHECK 15 passed: first claim wins (no coordinates in the payload), second returns claimed:false';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 16 -- a NON-ACTIVE post is never claimed. A draft has not been paid for
-- and is not public; alerting on one would push a car nobody can look up. The
-- refusal is byte-identical to "already claimed", so this is no status oracle.
-- -----------------------------------------------------------------------------
do $$
declare
  v_doc jsonb;
begin
  if not exists (select 1 from public.posts
                  where id = 'c1c1c1c1-0000-0000-0000-000000000006' and status = 'draft') then
    raise exception 'CHECK 16 SETUP FAILED: the draft fixture is missing or no longer a draft';
  end if;

  v_doc := public.claim_post_alerts('c1c1c1c1-0000-0000-0000-000000000006');

  if v_doc <> jsonb_build_object('claimed', false) then
    raise exception 'CHECK 16 FAILED: a DRAFT post was claimable: %', v_doc;
  end if;
  if exists (select 1 from public.posts
              where id = 'c1c1c1c1-0000-0000-0000-000000000006'
                and alerts_sent_at is not null) then
    raise exception 'CHECK 16 FAILED: a refused claim still stamped alerts_sent_at';
  end if;

  raise notice 'CHECK 16 passed: a non-active (draft) post returns claimed:false and is not stamped';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 17 -- ABSENCE: the body carries NO PLATE (Tier 1 SAFETY). A registration
-- in a push notification is the one string that turns "keep an eye out" into a
-- crowd-sourced ANPR feed -- and it lands on lock screens, in notification
-- history, and in whatever the OS backs those up to. The fixture plate is
-- 'ZZ11 PLT', checked spaced, unspaced and as a bare prefix.
-- -----------------------------------------------------------------------------
do $$
declare
  v_body  text;
  v_plate text;
begin
  v_body := public.match_alert_zones('c1c1c1c1-0000-0000-0000-000000000001') ->> 'body';
  select plate into v_plate from public.posts
   where id = 'c1c1c1c1-0000-0000-0000-000000000001';

  if v_body is null then
    raise exception 'CHECK 17 FAILED: no body was returned at all';
  end if;
  if v_body like '%' || v_plate || '%' then
    raise exception 'CHECK 17 FAILED: the push body contains the PLATE (%): %', v_plate, v_body;
  end if;
  if v_body like '%' || replace(v_plate, ' ', '') || '%' then
    raise exception 'CHECK 17 FAILED: the push body contains the unspaced plate: %', v_body;
  end if;
  if v_body like '%ZZ11%' then
    raise exception 'CHECK 17 FAILED: the push body contains a plate fragment: %', v_body;
  end if;

  raise notice 'CHECK 17 passed: the alert body contains no plate (body: %)', v_body;
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 18 -- ABSENCE: the body carries NO COORDINATES (Tier 1 SAFETY). Checked
-- at 1 through 4 decimal places, for latitude and longitude, signed and
-- unsigned: 4 dp is ~11 m (a house), and 1 dp is still enough to say which side
-- of a town someone's car -- or, on a driveway theft, their home -- is on.
-- -----------------------------------------------------------------------------
do $$
declare
  v_body text;
  v_lat  double precision;
  v_lng  double precision;
  v_d    int;
  v_frag text;
begin
  v_body := public.match_alert_zones('c1c1c1c1-0000-0000-0000-000000000001') ->> 'body';

  select ST_Y(last_seen_location::geometry), ST_X(last_seen_location::geometry)
    into v_lat, v_lng
  from public.posts where id = 'c1c1c1c1-0000-0000-0000-000000000001';

  if v_lat is null or v_lng is null then
    raise exception 'CHECK 18 SETUP FAILED: the fixture post has no last-seen point';
  end if;

  for v_d in 1..4 loop
    v_frag := round(v_lat::numeric, v_d)::text;
    if v_body like '%' || v_frag || '%' then
      raise exception 'CHECK 18 FAILED: the body contains the LATITUDE to % dp (%): %', v_d, v_frag, v_body;
    end if;

    v_frag := round(v_lng::numeric, v_d)::text;              -- signed, e.g. -2.24
    if v_body like '%' || v_frag || '%' then
      raise exception 'CHECK 18 FAILED: the body contains the LONGITUDE to % dp (%): %', v_d, v_frag, v_body;
    end if;

    v_frag := round(abs(v_lng)::numeric, v_d)::text;         -- unsigned, e.g. 2.24
    if v_body like '%' || v_frag || '%' then
      raise exception 'CHECK 18 FAILED: the body contains the unsigned longitude to % dp (%): %', v_d, v_frag, v_body;
    end if;
  end loop;

  raise notice 'CHECK 18 passed: the alert body contains neither coordinate at 1-4 decimal places';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 19 -- ABSENCE: the body reads last_seen_LOCALITY, never last_seen_AREA.
-- The fixture makes them differ on purpose: the area is the LocationPicker's raw
-- reverse-geocoded label, street-grain right down to the postcode
-- ('Shenley Rd, Hemel Hempstead, HP2 7RJ' -- a real string from that picker's
-- own tests), while the locality is the district 'Hemel Hempstead'. A street in
-- a feed carousel is one thing; the same street pushed to every spotter within
-- 50 miles -- on a driveway theft, i.e. the victim's home address -- is another.
-- -----------------------------------------------------------------------------
do $$
declare
  v_body text;
begin
  v_body := public.match_alert_zones('c1c1c1c1-0000-0000-0000-000000000001') ->> 'body';

  -- Sanity: the fixture really does carry two different labels.
  if not exists (
    select 1 from public.posts
     where id = 'c1c1c1c1-0000-0000-0000-000000000001'
       and last_seen_area = 'Shenley Rd, Hemel Hempstead, HP2 7RJ'
       and last_seen_locality = 'Hemel Hempstead') then
    raise exception 'CHECK 19 SETUP FAILED: the street/district fixture pair is not in place';
  end if;

  if v_body not like '%Hemel Hempstead%' then
    raise exception 'CHECK 19 FAILED: the body does not carry the district-grain locality: %', v_body;
  end if;
  if v_body like '%Shenley%' then
    raise exception 'CHECK 19 FAILED: the body carries the STREET from last_seen_area: %', v_body;
  end if;
  if v_body like '%HP2%' or v_body like '%7RJ%' then
    raise exception 'CHECK 19 FAILED: the body carries the POSTCODE from last_seen_area: %', v_body;
  end if;

  raise notice 'CHECK 19 passed: the body carries the locality and not the street/postcode (body: %)', v_body;
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 20 -- with a NULL locality the body falls back to the literal
-- 'your area'. Not "near ", not "near null", and above all not a quiet reach for
-- last_seen_area to fill the gap -- which is precisely how a street label would
-- get into the push through the back door.
-- -----------------------------------------------------------------------------
do $$
declare
  v_body text;
begin
  if not exists (
    select 1 from public.posts
     where id = 'c1c1c1c1-0000-0000-0000-000000000007'
       and last_seen_locality is null
       and last_seen_area = 'Shenley Rd, Hemel Hempstead, HP2 7RJ') then
    raise exception 'CHECK 20 SETUP FAILED: the null-locality fixture is not in place';
  end if;

  v_body := public.match_alert_zones('c1c1c1c1-0000-0000-0000-000000000007') ->> 'body';

  if v_body not like '%your area%' then
    raise exception 'CHECK 20 FAILED: a null locality did not fall back to ''your area'': %', v_body;
  end if;
  if v_body like '%null%' or v_body like '%Shenley%' or v_body like '%HP2%' then
    raise exception 'CHECK 20 FAILED: the fallback body leaked null or the street label: %', v_body;
  end if;

  raise notice 'CHECK 20 passed: a null locality falls back to the literal ''your area'' (body: %)', v_body;
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 21 -- EVERY alert body carries the don't-approach clause (DOMAIN.md /
-- SECURITY_AND_TRUST.md §1). This is the one line standing between "your
-- neighbour's car is round the corner" and somebody confronting a car thief.
-- Asserted on both body shapes (with a locality and with the fallback), asserted
-- to be at the END, and asserted within the 150-char bound -- the body is
-- left(..., 150)-truncated, so unbounded make/model/locality text would eat the
-- safety line off the end first.
-- -----------------------------------------------------------------------------
do $$
declare
  v_with     text;
  v_fallback text;
begin
  v_with     := public.match_alert_zones('c1c1c1c1-0000-0000-0000-000000000001') ->> 'body';
  v_fallback := public.match_alert_zones('c1c1c1c1-0000-0000-0000-000000000007') ->> 'body';

  if v_with not like '%don''t approach%' then
    raise exception 'CHECK 21 FAILED: the alert body has no don''t-approach clause: %', v_with;
  end if;
  if v_fallback not like '%don''t approach%' then
    raise exception 'CHECK 21 FAILED: the ''your area'' body has no don''t-approach clause: %', v_fallback;
  end if;
  -- At the END, not merely present somewhere.
  if v_with not like '%don''t approach.' then
    raise exception 'CHECK 21 FAILED: the body does not END with the safety clause (truncated?): %', v_with;
  end if;
  if char_length(v_with) > 150 or char_length(v_fallback) > 150 then
    raise exception 'CHECK 21 FAILED: a body exceeded the 150-char push bound (% / %)',
      char_length(v_with), char_length(v_fallback);
  end if;

  raise notice 'CHECK 21 passed: every alert body ends with the don''t-approach clause, within 150 chars';
end $$;


-- -----------------------------------------------------------------------------
-- Fixtures for CHECKs 22-25: one sighting by Beth on the notification post, one
-- thread between Alex (owner) and Beth (spotter), and two messages -- the
-- automatic kind='system' safety message and a real one from Beth whose content
-- is a canary string no correct push body may ever contain.
-- -----------------------------------------------------------------------------
insert into public.sightings (id, post_id, spotter_id, location_unavailable)
values ('c2c2c2c2-0000-0000-0000-000000000001',
        'c1c1c1c1-0000-0000-0000-00000000000e',
        '22222222-2222-2222-2222-222222222222',
        true);

insert into public.threads (id, post_id, owner_id, spotter_id)
values ('c3c3c3c3-0000-0000-0000-000000000001',
        'c1c1c1c1-0000-0000-0000-00000000000e',
        '11111111-1111-1111-1111-111111111111',
        '22222222-2222-2222-2222-222222222222');

insert into public.messages (id, thread_id, sender_id, kind, content)
values
  -- The platform-authored safety message: sender_id is NULL by CHECK constraint.
  ('c4c4c4c4-0000-0000-0000-000000000001',
   'c3c3c3c3-0000-0000-0000-000000000001', null, 'system',
   'Safety first: never meet alone and never approach the vehicle.'),
  -- A real message. The content is a canary: CHECK 25 asserts it never appears.
  ('c4c4c4c4-0000-0000-0000-000000000002',
   'c3c3c3c3-0000-0000-0000-000000000001',
   '22222222-2222-2222-2222-222222222222', 'user',
   'ARTICHOKE-CANARY-9271 it is parked behind the old mill, I can meet you at 4pm');


-- -----------------------------------------------------------------------------
-- CHECK 22 -- AUTHORISATION: claim_sighting_notification with the WRONG actor
-- returns claimed:false. The Edge Function cannot trust its caller, so holding
-- (or guessing) a sighting id must never be enough -- otherwise anyone can spam
-- an arbitrary post owner's phone with "someone reported seeing your car".
-- -----------------------------------------------------------------------------
do $$
declare
  v_doc jsonb;
begin
  -- Carl did not write this sighting; Beth did.
  v_doc := public.claim_sighting_notification(
             'c2c2c2c2-0000-0000-0000-000000000001',
             '33333333-3333-3333-3333-333333333333');

  if v_doc <> jsonb_build_object('claimed', false) then
    raise exception 'CHECK 22 FAILED: a non-spotter actor claimed the sighting notification: %', v_doc;
  end if;
  -- The refusal must not burn the claim either -- otherwise a stranger could
  -- suppress the genuine notification simply by calling first.
  if exists (select 1 from public.sightings
              where id = 'c2c2c2c2-0000-0000-0000-000000000001'
                and notified_at is not null) then
    raise exception 'CHECK 22 FAILED: a refused claim still stamped notified_at -- a stranger can suppress the owner''s push';
  end if;

  raise notice 'CHECK 22 passed: the wrong actor gets claimed:false and does not burn the claim';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 23 -- REPLAY: the right actor wins exactly ONCE. The second call returns
-- the identical refusal, so invoking the Edge Function in a loop cannot buzz the
-- owner forever.
-- -----------------------------------------------------------------------------
do $$
declare
  v_first  jsonb;
  v_second jsonb;
begin
  v_first := public.claim_sighting_notification(
               'c2c2c2c2-0000-0000-0000-000000000001',
               '22222222-2222-2222-2222-222222222222');

  if (v_first ->> 'claimed') <> 'true' then
    raise exception 'CHECK 23 SETUP FAILED: the genuine spotter could not claim: %', v_first;
  end if;
  if (v_first ->> 'user_id') <> '11111111-1111-1111-1111-111111111111' then
    raise exception 'CHECK 23 FAILED: the sighting push is addressed to someone other than the post owner: %', v_first;
  end if;
  -- SAFETY: the owner's copy names neither the spotter nor the plate (§1).
  if (v_first ->> 'body') like '%Beth%' or (v_first ->> 'body') like '%ZZ24%' then
    raise exception 'CHECK 23 FAILED: the sighting body names the spotter or the plate: %', v_first ->> 'body';
  end if;
  if (v_first ->> 'body') not like '%don''t approach%' then
    raise exception 'CHECK 23 FAILED: the sighting body has no don''t-approach clause: %', v_first ->> 'body';
  end if;

  v_second := public.claim_sighting_notification(
                'c2c2c2c2-0000-0000-0000-000000000001',
                '22222222-2222-2222-2222-222222222222');

  if v_second <> jsonb_build_object('claimed', false) then
    raise exception 'CHECK 23 FAILED: a replayed claim by the right actor won again: %', v_second;
  end if;

  raise notice 'CHECK 23 passed: the genuine actor claims once; the replay returns claimed:false';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 24 -- a kind='system' message NEVER pushes. The automatic safety-first
-- message is written by open_thread inside the RECIPIENT'S OWN action, so a push
-- for it would buzz someone about something they just did themselves.
--
-- HONEST LIMITATION: this asserts the OUTCOME, not which predicate produced it.
-- A system row's sender_id is NULL by messages_kind_sender_chk, so no actor
-- value can ever match it and the `kind <> 'system'` predicate is unreachable
-- belt-and-braces. Isolating that predicate would need a system message WITH a
-- sender -- which the schema deliberately makes unrepresentable.
-- -----------------------------------------------------------------------------
do $$
declare
  v_doc jsonb;
begin
  v_doc := public.claim_message_notification(
             'c4c4c4c4-0000-0000-0000-000000000001',
             '22222222-2222-2222-2222-222222222222');
  if v_doc <> jsonb_build_object('claimed', false) then
    raise exception 'CHECK 24 FAILED: a kind=''system'' message was claimable for a push: %', v_doc;
  end if;

  -- The other participant cannot claim it either.
  v_doc := public.claim_message_notification(
             'c4c4c4c4-0000-0000-0000-000000000001',
             '11111111-1111-1111-1111-111111111111');
  if v_doc <> jsonb_build_object('claimed', false) then
    raise exception 'CHECK 24 FAILED: the owner could claim a system message: %', v_doc;
  end if;

  if exists (select 1 from public.messages
              where id = 'c4c4c4c4-0000-0000-0000-000000000001'
                and notified_at is not null) then
    raise exception 'CHECK 24 FAILED: a system message was stamped notified_at';
  end if;

  raise notice 'CHECK 24 passed: the automatic system message never pushes';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 25 -- the message push carries the sender's FIRST NAME and the post
-- context, and NEVER the message CONTENT. Content would cross Expo and then
-- FCM/APNs -- third-party infrastructure -- which SECURITY_AND_TRUST.md §3
-- forbids outright. The fixture content opens with a canary token, so this
-- ABSENCE assertion cannot pass by accident.
-- -----------------------------------------------------------------------------
do $$
declare
  v_doc  jsonb;
  v_body text;
begin
  v_doc  := public.claim_message_notification(
              'c4c4c4c4-0000-0000-0000-000000000002',
              '22222222-2222-2222-2222-222222222222');
  v_body := v_doc ->> 'body';

  if (v_doc ->> 'claimed') <> 'true' then
    raise exception 'CHECK 25 SETUP FAILED: the genuine sender could not claim the message push: %', v_doc;
  end if;
  -- The recipient is the OTHER participant, derived server-side from the thread.
  if (v_doc ->> 'user_id') <> '11111111-1111-1111-1111-111111111111' then
    raise exception 'CHECK 25 FAILED: the message push is addressed to the wrong side of the thread: %', v_doc;
  end if;
  if (v_doc ->> 'thread_id') <> 'c3c3c3c3-0000-0000-0000-000000000001' then
    raise exception 'CHECK 25 FAILED: wrong thread_id in the payload: %', v_doc;
  end if;

  -- PRESENT: first name + post context (colour + make).
  if v_body not like '%Beth%' then
    raise exception 'CHECK 25 FAILED: the body does not name the sender''s first name: %', v_body;
  end if;
  if v_body not like '%Zephyr%' or v_body not like '%Chartreuse%' then
    raise exception 'CHECK 25 FAILED: the body carries no post context (colour/make): %', v_body;
  end if;

  -- ABSENT: the content, the surname, the plate.
  if v_body like '%ARTICHOKE%' or v_body like '%9271%'
     or v_body like '%old mill%' or v_body like '%4pm%' then
    raise exception 'CHECK 25 FAILED: the message CONTENT reached the push body: %', v_body;
  end if;
  if v_body like '%Sanders%' then
    raise exception 'CHECK 25 FAILED: the body carries the sender''s SURNAME: %', v_body;
  end if;
  if v_body like '%ZZ24%' then
    raise exception 'CHECK 25 FAILED: the body carries the plate: %', v_body;
  end if;

  raise notice 'CHECK 25 passed: first name + post context only, never the message content (body: %)', v_body;
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 26 -- THE CROSS-ACCOUNT PUSH LEAK. An Expo push token identifies a
-- DEVICE and survives sign-out: it is re-issued unchanged to whoever signs in
-- next on that handset. Registering the same token as user A and then as user B
-- must leave exactly ONE row, owned by B, with A holding nothing -- which is the
-- entire reason push_tokens is keyed on the token alone. Under a composite
-- (user_id, token) key A's row would live on beside B's, and every sighting,
-- message and alert push for A would be delivered into a stranger's hands.
-- Driven through the REAL authenticated role so the grant layer applies.
-- -----------------------------------------------------------------------------
do $$
declare
  v_token text := 'ExponentPushToken[tid-verif-shared]';
  v_owner uuid;
  v_n     int;
begin
  delete from public.push_tokens where token like 'ExponentPushToken[tid-verif-%';

  -- User A (Beth) signs in on the handset.
  perform set_config('request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
  set local role authenticated;
  perform public.register_push_token(v_token, 'android');
  reset role;

  select count(*) into v_n from public.push_tokens
   where token = v_token and user_id = '22222222-2222-2222-2222-222222222222';
  if v_n <> 1 then
    raise exception 'CHECK 26 SETUP FAILED: the first registration did not land (% row(s))', v_n;
  end if;

  -- A signs out; user B (Evan) signs in on the SAME handset and re-registers.
  perform set_config('request.jwt.claims',
    '{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated"}', true);
  set local role authenticated;
  perform public.register_push_token(v_token, 'android');
  reset role;

  select count(*) into v_n from public.push_tokens where token = v_token;
  if v_n <> 1 then
    raise exception 'CHECK 26 FAILED: % rows exist for ONE token -- the device is registered to two accounts at once (PUSH LEAK)', v_n;
  end if;

  select user_id into v_owner from public.push_tokens where token = v_token;
  if v_owner <> '55555555-5555-5555-5555-555555555555' then
    raise exception 'CHECK 26 FAILED: the token still belongs to % after the new user registered it', v_owner;
  end if;

  select count(*) into v_n from public.push_tokens
   where user_id = '22222222-2222-2222-2222-222222222222'
     and token like 'ExponentPushToken[tid-verif-%';
  if v_n <> 0 then
    raise exception 'CHECK 26 FAILED: the PREVIOUS user still holds % token row(s) -- their pushes would land on the new holder''s phone', v_n;
  end if;

  raise notice 'CHECK 26 passed: re-registering a token MOVES the device to its new owner (one row; the previous owner holds none)';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 27 -- unregister_push_token for a token the caller does NOT own is a
-- SILENT NO-OP: the row survives and nothing is raised. Two properties at once --
-- a guessed or stolen token cannot be used to silence another account's
-- notifications, and "not yours" is indistinguishable from "never existed", so
-- the call is no existence oracle over device tokens.
-- -----------------------------------------------------------------------------
do $$
declare
  v_token   text := 'ExponentPushToken[tid-verif-shared]';   -- Evan's, from CHECK 26
  v_unknown text := 'ExponentPushToken[tid-verif-never-existed]';
  v_owner   uuid;
  v_n       int;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);

  -- Beth tries to unregister Evan's token. Must not raise.
  set local role authenticated;
  perform public.unregister_push_token(v_token);
  -- ...and a token that never existed behaves identically (no oracle).
  perform public.unregister_push_token(v_unknown);
  reset role;

  select count(*) into v_n from public.push_tokens where token = v_token;
  if v_n <> 1 then
    raise exception 'CHECK 27 FAILED: another user''s token was deleted -- a stolen token would be a mute button for that account';
  end if;
  select user_id into v_owner from public.push_tokens where token = v_token;
  if v_owner <> '55555555-5555-5555-5555-555555555555' then
    raise exception 'CHECK 27 FAILED: the token changed owner during a foreign unregister (now %)', v_owner;
  end if;

  -- The OWNER can still remove it (the no-op is not a broken function).
  perform set_config('request.jwt.claims',
    '{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated"}', true);
  set local role authenticated;
  perform public.unregister_push_token(v_token);
  reset role;

  select count(*) into v_n from public.push_tokens where token = v_token;
  if v_n <> 0 then
    raise exception 'CHECK 27 FAILED: the token''s OWNER could not unregister it';
  end if;

  raise notice 'CHECK 27 passed: a foreign unregister is a silent no-op; the owner''s own still works';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 28 -- ABSENCE (grants): anon holds NO privilege on any of the four
-- tables. A guest has no device, no alerts, no send history and no receipts;
-- every one of these rows needs an owner. alert_zones in particular is the
-- single worst table in this schema to leak -- it is a home-location oracle over
-- the entire user base, and since 20260802150000 it holds up to FIVE rows per
-- person plus the criteria describing what they watch for. Also asserts RLS is
-- ENABLED on all four: a grant-only defence is one stray `grant`
-- away from being no defence at all.
--
-- TRUNCATE AND TRIGGER ARE IN THE LIST DELIBERATELY, and were added after this
-- check FAILED on its first ever run (2026-07-31): the project's ALTER DEFAULT
-- PRIVILEGES had been handing anon REFERENCES + TRIGGER + TRUNCATE on every new
-- table, and `set local role anon; truncate public.alert_zones;` really did
-- empty it. TRUNCATE IS NOT SUBJECT TO RLS — it is checked before any policy
-- runs — so it walks straight past every protection this schema has. See
-- 20260802170000_revoke_default_table_privileges.sql.
--
-- The same list is checked for AUTHENTICATED below (minus the SELECTs it is
-- supposed to have): an ordinary signed-in user must not be able to erase every
-- spotter's alerts either.
-- -----------------------------------------------------------------------------
do $$
declare
  v_tables text[] := array['public.alert_zones', 'public.push_tokens',
                           'public.push_sends',  'public.push_receipts'];
  v_priv   text[] := array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'REFERENCES',
                           'TRUNCATE', 'TRIGGER'];
  t        text;
  p        text;
  v_n      int;
begin
  foreach t in array v_tables loop
    foreach p in array v_priv loop
      if has_table_privilege('anon', t, p) then
        raise exception 'CHECK 28 FAILED: anon holds % on %', p, t;
      end if;
    end loop;

    select count(*) into v_n
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = split_part(t, '.', 2)
      and c.relrowsecurity;
    if v_n <> 1 then
      raise exception 'CHECK 28 FAILED: row level security is NOT enabled on %', t;
    end if;
  end loop;

  -- The two service-role-only tables carry NO policies at all: denied by default
  -- for every client role, with nothing there to widen by accident.
  select count(*) into v_n from pg_policies
   where schemaname = 'public' and tablename in ('push_sends', 'push_receipts');
  if v_n <> 0 then
    raise exception 'CHECK 28 FAILED: % policy(ies) exist on push_sends/push_receipts -- they must have none', v_n;
  end if;

  raise notice 'CHECK 28 passed: anon holds nothing on the four tables; RLS on for all four; no policies on the ledger tables';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 29 -- ABSENCE (grants): authenticated holds NO insert/update/delete on
-- any of the four tables. This is what makes the approximate-mode snap a SERVER
-- guarantee rather than a client promise: if a client could write alert_zones
-- directly, an old build, a replayed request, or a curl with the anon key and a
-- valid JWT could store an EXACT home point on a row still flagged
-- approximate = true -- and, since v2, could also mint a sixth alert straight
-- past create_my_alert's cap. The same wall keeps push_tokens un-hijackable and the
-- push_sends rate-limit ledger unreadable and unforgeable.
--
-- TRUNCATE, TRIGGER and REFERENCES are in the list for the reason spelled out
-- in CHECK 28: they arrive by default on every new table, and TRUNCATE ignores
-- RLS. An ordinary signed-in user erasing every spotter's alerts in one
-- statement is strictly worse than the write grants this check was written for,
-- since `authenticated` is a role anyone can obtain by signing up.
-- -----------------------------------------------------------------------------
do $$
declare
  v_tables text[] := array['public.alert_zones', 'public.push_tokens',
                           'public.push_sends',  'public.push_receipts'];
  v_write  text[] := array['INSERT', 'UPDATE', 'DELETE',
                           'REFERENCES', 'TRUNCATE', 'TRIGGER'];
  t        text;
  p        text;
begin
  foreach t in array v_tables loop
    foreach p in array v_write loop
      if has_table_privilege('authenticated', t, p) then
        raise exception 'CHECK 29 FAILED: authenticated holds % on % -- every write must go through an RPC', p, t;
      end if;
    end loop;
  end loop;

  -- The reads that SHOULD exist (so this check cannot be "passed" by revoking
  -- everything and quietly breaking the settings screen)...
  if not has_table_privilege('authenticated', 'public.alert_zones', 'SELECT') then
    raise exception 'CHECK 29 FAILED: authenticated lost SELECT on alert_zones -- own-alert reads are broken';
  end if;
  if not has_table_privilege('authenticated', 'public.push_tokens', 'SELECT') then
    raise exception 'CHECK 29 FAILED: authenticated lost SELECT on push_tokens -- the device list is broken';
  end if;
  -- ...and the reads that must NOT: the ledger tells a user exactly how close
  -- they are to the cap, and the receipts correlate a device with a delivery.
  if has_table_privilege('authenticated', 'public.push_sends', 'SELECT') then
    raise exception 'CHECK 29 FAILED: authenticated can READ push_sends -- the rate-limit ledger is not client-visible';
  end if;
  if has_table_privilege('authenticated', 'public.push_receipts', 'SELECT') then
    raise exception 'CHECK 29 FAILED: authenticated can READ push_receipts';
  end if;

  raise notice 'CHECK 29 passed: authenticated holds no write on any of the four tables (and reads only its own alerts/devices)';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 30 -- ABSENCE (function grants) + the SIGNATURE INVENTORY. Three rules,
-- all proven from the catalogs:
--   (a) anon holds EXECUTE on NONE of the twelve RPCs in this feature. Functions
--       default to EXECUTE for PUBLIC *and* this project ships ALTER DEFAULT
--       PRIVILEGES granting anon (and authenticated) at CREATE time, so every one
--       of these needed an explicit revoke -- the 20260713191000 incident class.
--       A missed revoke never fails loudly; it just quietly works for guests.
--   (b) BOTH anon and authenticated are denied on the five functions that trust
--       their caller instead of checking auth.uid(): claim_post_alerts (a client
--       grant is a one-call button that PERMANENTLY silences any post's fan-out
--       during the hours that matter), match_alert_zones (it writes the
--       rate-limit ledger and returns other users' ids with their implied
--       location -- a stalking oracle over strangers), the two notification
--       claims (the actor is a PARAMETER, so a client could nominate itself and
--       defeat the very check they exist to make), and prune_push_token (no
--       ownership check at all -- a mute button for any token an attacker holds).
--   (c) THE MIGRATION LANDED WHOLE. The five id-scoped alert RPCs exist, and the
--       three v1 ones (get_my_alert_zone / upsert_my_alert_zone /
--       set_my_alert_zone_enabled) are GONE. This pair is the cheapest possible
--       guard against a HALF-APPLIED 20260802150000: if the drops ran but the
--       creates did not (or vice versa) every other alert check would fail with
--       a confusing "function does not exist", whereas this one names the
--       problem. upsert_my_alert_zone in particular must not survive -- its
--       ON CONFLICT (user_id) infers an index that no longer exists, so it would
--       be a button that raises 42P10 on every single call.
-- The positive assertions are deliberate: a revoke-everything "fix" would
-- otherwise sail through this check while breaking the whole feature.
-- -----------------------------------------------------------------------------
do $$
declare
  v_service_only text[] := array[
    'public.claim_post_alerts(uuid)',
    'public.match_alert_zones(uuid, int)',
    'public.claim_sighting_notification(uuid, uuid)',
    'public.claim_message_notification(uuid, uuid)',
    'public.prune_push_token(text)'];
  v_client text[] := array[
    'public.register_push_token(text, text)',
    'public.unregister_push_token(text)',
    -- The five multi-alert RPCs (20260802150000), spelled out in full: revoke,
    -- grant and has_function_privilege all resolve by EXACT signature.
    'public.list_my_alerts()',
    'public.create_my_alert(text, double precision, double precision, int, boolean, boolean, text, text, text, text, int, int)',
    'public.update_my_alert(uuid, text, double precision, double precision, int, boolean, boolean, text, text, text, text, int, int)',
    'public.delete_my_alert(uuid)',
    'public.set_my_alert_enabled(uuid, boolean)'];
  -- The v1 signatures. These must NOT resolve at all, so they can never be fed
  -- to has_function_privilege (which raises on an unknown function) -- they are
  -- checked with to_regprocedure, which returns NULL instead.
  v_dropped text[] := array[
    'public.get_my_alert_zone()',
    'public.upsert_my_alert_zone(double precision, double precision, int, boolean, boolean, text)',
    'public.set_my_alert_zone_enabled(boolean)'];
  fn text;
begin
  -- (c) first: every later assertion below would raise an opaque "function does
  -- not exist" if a signature were missing, so prove the inventory before using it.
  foreach fn in array v_service_only || v_client loop
    if to_regprocedure(fn) is null then
      raise exception 'CHECK 30 FAILED: % does not exist -- the migration chain is half-applied or a signature drifted', fn;
    end if;
  end loop;
  foreach fn in array v_dropped loop
    if to_regprocedure(fn) is not null then
      raise exception 'CHECK 30 FAILED: the v1 RPC % still exists -- 20260802150000 dropped it, and upsert_my_alert_zone in particular now raises 42P10 on every call (its ON CONFLICT arbiter index is gone)', fn;
    end if;
  end loop;

  -- (a) anon: nothing, anywhere in this feature. service_role: everything.
  foreach fn in array v_service_only || v_client loop
    if has_function_privilege('anon', fn, 'EXECUTE') then
      raise exception 'CHECK 30 FAILED: anon can EXECUTE % (the revoke must name anon explicitly)', fn;
    end if;
    if not has_function_privilege('service_role', fn, 'EXECUTE') then
      raise exception 'CHECK 30 FAILED: service_role CANNOT EXECUTE % -- the Edge Functions need it', fn;
    end if;
  end loop;

  -- (b) the caller-trusting five: authenticated denied too.
  foreach fn in array v_service_only loop
    if has_function_privilege('authenticated', fn, 'EXECUTE') then
      raise exception 'CHECK 30 FAILED: authenticated can EXECUTE % -- it performs NO auth.uid() check, so a client grant defeats the check it exists to make', fn;
    end if;
  end loop;

  -- ...and the client-facing seven still work for signed-in users.
  foreach fn in array v_client loop
    if not has_function_privilege('authenticated', fn, 'EXECUTE') then
      raise exception 'CHECK 30 FAILED: authenticated lost EXECUTE on % -- registration / the alerts settings screen is broken', fn;
    end if;
  end loop;

  raise notice 'CHECK 30 passed: anon denied on all 12 RPCs; anon AND authenticated denied on the 5 service-role-only ones; the client 7 granted; the 3 v1 alert RPCs are gone';
end $$;



-- -----------------------------------------------------------------------------
-- CHECK 31 -- update_my_alert SNAPS TOO (Tier 1 SAFETY). CHECK 7 proves the
-- create path coarsens; this proves the EDIT path does, which is the one that
-- would otherwise become a laundering route: create an exact alert, then "edit"
-- it and have the server store the exact point on a row flagged
-- approximate = true. The alert starts EXACT here on purpose, so the row really
-- does hold the picked point before the edit -- otherwise a no-op update would
-- pass this check.
-- -----------------------------------------------------------------------------
do $$
declare
  v_lat      double precision := 53.4849;
  v_lng      double precision := -2.2449;
  v_input    geography := ST_SetSRID(ST_MakePoint(-2.2449, 53.4849), 4326)::geography;
  v_expected geometry  := ST_SnapToGrid(ST_SetSRID(ST_MakePoint(-2.2449, 53.4849), 4326), 0.01);
  v_doc      jsonb;
  v_id       uuid;
  v_stored   geography;
begin
  delete from public.alert_zones where user_id = '44444444-4444-4444-4444-444444444444';

  perform set_config('request.jwt.claims',
    '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}', true);

  set local role authenticated;
  v_doc := public.create_my_alert('Exact first', v_lat, v_lng, 16093, false, true,
                                  null, null, null, null, null, null);
  reset role;
  v_id := (v_doc ->> 'id')::uuid;

  select z.point into v_stored from public.alert_zones z where z.id = v_id;
  if ST_Distance(v_stored, v_input) <> 0 then
    raise exception 'CHECK 31 SETUP FAILED: the exact create did not store the picked point, so the edit below would prove nothing';
  end if;

  -- (a) edit the SAME alert into approximate mode, same coordinates.
  set local role authenticated;
  v_doc := public.update_my_alert(v_id, 'Now approximate', v_lat, v_lng, 16093, true, true,
                                  null, null, null, null, null, null);
  reset role;

  select z.point into v_stored from public.alert_zones z where z.id = v_id;
  if ST_X(v_stored::geometry) <> ST_X(v_expected)
     or ST_Y(v_stored::geometry) <> ST_Y(v_expected) then
    raise exception 'CHECK 31 FAILED: after the edit the stored point (%, %) is not ST_SnapToGrid(input, 0.01) = (%, %)',
      ST_X(v_stored::geometry), ST_Y(v_stored::geometry), ST_X(v_expected), ST_Y(v_expected);
  end if;
  if ST_Distance(v_stored, v_input) <= 0 then
    raise exception 'CHECK 31 FAILED: update_my_alert stored the EXACT picked point -- editing an alert launders a home address into a row flagged approximate';
  end if;
  if not exists (select 1 from public.alert_zones where id = v_id and approximate) then
    raise exception 'CHECK 31 FAILED: the row is not flagged approximate after an approximate edit';
  end if;

  -- ...and the payload is the STORED point, exactly as create_my_alert's is.
  -- Tolerances, not equality, and for the same reason — see CHECK 11's header:
  -- the point returns through JSONB, whose float rendering follows the
  -- `extra_float_digits` GUC and lands one ULP off what is stored. 1e-9 deg is
  -- ~0.1 mm; the grid it must prove was applied is 0.01 deg (~1 km).
  if abs((v_doc ->> 'lat')::double precision - ST_Y(v_stored::geometry)) > 1e-9
     or abs((v_doc ->> 'lng')::double precision - ST_X(v_stored::geometry)) > 1e-9 then
    raise exception 'CHECK 31 FAILED: update_my_alert returned (%, %), not the STORED point',
      v_doc ->> 'lat', v_doc ->> 'lng';
  end if;
  if abs((v_doc ->> 'lat')::double precision - v_lat) < 1e-4
     or abs((v_doc ->> 'lng')::double precision - v_lng) < 1e-4 then
    raise exception 'CHECK 31 FAILED: update_my_alert echoed the SUBMITTED coordinates back (%, % vs submitted %, %)',
      v_doc ->> 'lat', v_doc ->> 'lng', v_lat, v_lng;
  end if;

  -- (b) ...and back again: the toggle is a real choice in both directions on the
  -- edit path too, not a one-way trip.
  set local role authenticated;
  perform public.update_my_alert(v_id, 'Exact again', v_lat, v_lng, 16093, false, true,
                                 null, null, null, null, null, null);
  reset role;

  select z.point into v_stored from public.alert_zones z where z.id = v_id;
  if ST_Distance(v_stored, v_input) <> 0 then
    raise exception 'CHECK 31 FAILED: an exact edit did not restore the submitted point (moved % m)',
      ST_Distance(v_stored, v_input);
  end if;

  raise notice 'CHECK 31 passed: update_my_alert applies the SAME ~1km snap as create_my_alert, both ways';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 32 -- THE FIVE-ALERT CAP is enforced SERVER-side, and it counts ONLY the
-- caller's rows. The client cap is a kindness; this is the enforcement. Without
-- it there is nothing left to bound the table at all -- 20260802150000 dropped
-- the unique index, so "how many alerts may a user have" is now a count-then-
-- raise inside create_my_alert and nothing else.
--
-- The second half matters just as much: a cap that counted every row in the
-- table would lock the whole product at five alerts between all users, and a cap
-- that leaked another user's count would be a (small) oracle over strangers.
-- Evan creating his fifth while Dana already holds five proves it is per-caller.
-- -----------------------------------------------------------------------------
do $$
declare
  v_ok     boolean := false;
  v_leaked int := 0;
  v_i      int;
  v_n      int;
begin
  delete from public.alert_zones
   where user_id in ('44444444-4444-4444-4444-444444444444',
                    '55555555-5555-5555-5555-555555555555');

  -- Dana fills all five slots.
  perform set_config('request.jwt.claims',
    '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}', true);
  set local role authenticated;
  for v_i in 1..5 loop
    perform public.create_my_alert('CHECK 32 dana ' || v_i, 53.4808, -2.2426, 16093,
                                   true, true, null, null, null, null, null, null);
  end loop;

  begin
    perform public.create_my_alert('CHECK 32 dana overflow', 53.4808, -2.2426, 16093,
                                   true, true, null, null, null, null, null, null);
    v_leaked := v_leaked + 1;          -- reached ONLY if the sixth create succeeded
  exception when others then
    if sqlerrm like '%ALERT_LIMIT_REACHED%' then v_ok := true;
    else raise exception 'CHECK 32 FAILED: wrong error on the 6th alert: %', sqlerrm; end if;
  end;
  reset role;

  if v_leaked <> 0 or not v_ok then
    raise exception 'CHECK 32 FAILED: a 6th alert was created -- the cap is not enforced server-side';
  end if;

  select count(*) into v_n
  from public.alert_zones where user_id = '44444444-4444-4444-4444-444444444444';
  if v_n <> 5 then
    raise exception 'CHECK 32 FAILED: Dana holds % alert(s) after the refused create (expected exactly 5)', v_n;
  end if;

  -- The cap counts the CALLER's rows only: Evan creates four and then a fifth
  -- while Dana is already full. Ten rows exist in the table at this point.
  perform set_config('request.jwt.claims',
    '{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated"}', true);
  set local role authenticated;
  for v_i in 1..4 loop
    perform public.create_my_alert('CHECK 32 evan ' || v_i, 53.4808, -2.2426, 16093,
                                   true, true, null, null, null, null, null, null);
  end loop;
  -- The fifth: a user with four MUST succeed, whatever anybody else holds.
  perform public.create_my_alert('CHECK 32 evan 5', 53.4808, -2.2426, 16093,
                                 true, true, null, null, null, null, null, null);
  reset role;

  select count(*) into v_n
  from public.alert_zones where user_id = '55555555-5555-5555-5555-555555555555';
  if v_n <> 5 then
    raise exception 'CHECK 32 FAILED: Evan holds % alert(s) after five creates -- the cap counted somebody else''s rows', v_n;
  end if;

  raise notice 'CHECK 32 passed: the 6th alert raises ALERT_LIMIT_REACHED; the cap counts only the caller (Dana 5 + Evan 5)';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 33 -- OWNERSHIP on every id-scoped write. update_my_alert,
-- delete_my_alert and set_my_alert_enabled all take an alert id, so holding (or
-- guessing) one must never be enough. Three properties in one block:
--   (a) a stranger's call raises ALERT_NOT_FOUND -- and the row is UNCHANGED
--       afterwards, field for field, which is the part that would actually hurt:
--       a silent partial write (moving someone's alert, muting it, renaming it)
--       is worse than an error, because nothing tells the owner.
--       HONEST LIMITATION: a call that RAISES has its writes rolled back with
--       its own subtransaction, so the unchanged-row assertion is only truly
--       load-bearing for a call that SUCCEEDS -- which is what v_leaked counts,
--       and which is exactly the regression it exists to catch (an ownership
--       predicate dropped from a WHERE clause, or a refusal that silently
--       degrades into a no-op instead of raising).
--   (b) a uuid that never existed raises THE SAME token. Distinguishing "not
--       yours" from "no such alert" would let anyone probe alert ids -- and an
--       alert id maps to a person's approximate home.
--   (c) the OWNER can still do all three, so a revoke-everything "fix" cannot
--       pass this check while breaking the settings screen.
-- -----------------------------------------------------------------------------
do $$
declare
  v_id       uuid;
  v_ghost    uuid := 'c9c9c9c9-9999-9999-9999-999999999999';
  v_doc      jsonb;
  v_notfound int := 0;
  v_leaked   int := 0;
  v_name     text;   v_name2     text;
  v_radius   int;    v_radius2   int;
  v_enabled  boolean; v_enabled2 boolean;
  v_approx   boolean; v_approx2  boolean;
  v_lat      double precision; v_lat2 double precision;
  v_lng      double precision; v_lng2 double precision;
  v_upd      timestamptz;      v_upd2 timestamptz;
  v_n        int;
begin
  delete from public.alert_zones
   where user_id in ('33333333-3333-3333-3333-333333333333',
                    '44444444-4444-4444-4444-444444444444');

  -- Dana's alert. Exact mode so the stored coordinates are predictable and any
  -- movement by a stranger's write shows up immediately.
  perform set_config('request.jwt.claims',
    '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}', true);
  set local role authenticated;
  v_doc := public.create_my_alert('CHECK 33 dana', 53.4808, -2.2426, 16093, false, true,
                                  'Zephyr', null, null, null, null, null);
  reset role;
  v_id := (v_doc ->> 'id')::uuid;

  select z.name, z.radius_m, z.enabled, z.approximate,
         ST_Y(z.point::geometry), ST_X(z.point::geometry), z.updated_at
    into v_name, v_radius, v_enabled, v_approx, v_lat, v_lng, v_upd
  from public.alert_zones z where z.id = v_id;
  if v_name is null then
    raise exception 'CHECK 33 SETUP FAILED: Dana''s alert was not created';
  end if;

  -- (a) + (b): Carl, a stranger, tries all three writes on Dana's alert id and
  -- then all three on an id that has never existed. Six calls, ONE token.
  perform set_config('request.jwt.claims',
    '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
  set local role authenticated;

  begin
    perform public.update_my_alert(v_id, 'HIJACKED', 51.5074, -0.1278, 80467, false, false,
                                   'Nimbus', 'Nomad', 'Vermilion', 'Dropside', 500000, 1);
    v_leaked := v_leaked + 1;
  exception when others then
    if sqlerrm like '%ALERT_NOT_FOUND%' then v_notfound := v_notfound + 1;
    else raise exception 'CHECK 33 FAILED: wrong error from update_my_alert on a stranger''s alert: %', sqlerrm; end if;
  end;

  begin
    perform public.delete_my_alert(v_id);
    v_leaked := v_leaked + 1;
  exception when others then
    if sqlerrm like '%ALERT_NOT_FOUND%' then v_notfound := v_notfound + 1;
    else raise exception 'CHECK 33 FAILED: wrong error from delete_my_alert on a stranger''s alert: %', sqlerrm; end if;
  end;

  begin
    perform public.set_my_alert_enabled(v_id, false);
    v_leaked := v_leaked + 1;
  exception when others then
    if sqlerrm like '%ALERT_NOT_FOUND%' then v_notfound := v_notfound + 1;
    else raise exception 'CHECK 33 FAILED: wrong error from set_my_alert_enabled on a stranger''s alert: %', sqlerrm; end if;
  end;

  begin
    perform public.update_my_alert(v_ghost, 'GHOST', 51.5074, -0.1278, 16093, true, true,
                                   null, null, null, null, null, null);
    v_leaked := v_leaked + 1;
  exception when others then
    if sqlerrm like '%ALERT_NOT_FOUND%' then v_notfound := v_notfound + 1;
    else raise exception 'CHECK 33 FAILED: a non-existent id gave a DIFFERENT error from update_my_alert (an existence oracle): %', sqlerrm; end if;
  end;

  begin
    perform public.delete_my_alert(v_ghost);
    v_leaked := v_leaked + 1;
  exception when others then
    if sqlerrm like '%ALERT_NOT_FOUND%' then v_notfound := v_notfound + 1;
    else raise exception 'CHECK 33 FAILED: a non-existent id gave a DIFFERENT error from delete_my_alert (an existence oracle): %', sqlerrm; end if;
  end;

  begin
    perform public.set_my_alert_enabled(v_ghost, false);
    v_leaked := v_leaked + 1;
  exception when others then
    if sqlerrm like '%ALERT_NOT_FOUND%' then v_notfound := v_notfound + 1;
    else raise exception 'CHECK 33 FAILED: a non-existent id gave a DIFFERENT error from set_my_alert_enabled (an existence oracle): %', sqlerrm; end if;
  end;

  reset role;

  if v_leaked <> 0 then
    raise exception 'CHECK 33 FAILED: % of the six foreign/ghost calls SUCCEEDED -- an alert id is enough to edit, mute or delete somebody else''s alert', v_leaked;
  end if;
  if v_notfound <> 6 then
    raise exception 'CHECK 33 FAILED: only % of 6 calls raised ALERT_NOT_FOUND', v_notfound;
  end if;

  -- The row must be untouched, field for field -- including updated_at, because
  -- a trigger bump would mean the UPDATE reached the row before failing.
  select z.name, z.radius_m, z.enabled, z.approximate,
         ST_Y(z.point::geometry), ST_X(z.point::geometry), z.updated_at
    into v_name2, v_radius2, v_enabled2, v_approx2, v_lat2, v_lng2, v_upd2
  from public.alert_zones z where z.id = v_id;

  if v_name2 is null then
    raise exception 'CHECK 33 FAILED: a stranger DELETED the alert';
  end if;
  if v_name2 <> v_name or v_radius2 <> v_radius or v_enabled2 <> v_enabled
     or v_approx2 <> v_approx or v_lat2 <> v_lat or v_lng2 <> v_lng
     or v_upd2 <> v_upd then
    raise exception 'CHECK 33 FAILED: the alert CHANGED after the refused calls (name %/%, radius %/%, enabled %/%, approximate %/%, lat %/%, lng %/%, updated_at %/%)',
      v_name, v_name2, v_radius, v_radius2, v_enabled, v_enabled2,
      v_approx, v_approx2, v_lat, v_lat2, v_lng, v_lng2, v_upd, v_upd2;
  end if;

  -- (c) the OWNER can still do all three.
  perform set_config('request.jwt.claims',
    '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}', true);
  set local role authenticated;
  v_doc := public.set_my_alert_enabled(v_id, false);
  if (v_doc ->> 'enabled')::boolean then
    raise exception 'CHECK 33 FAILED: the owner''s own set_my_alert_enabled did not pause the alert: %', v_doc;
  end if;
  v_doc := public.update_my_alert(v_id, 'CHECK 33 dana renamed',
                                 53.4808, -2.2426, 16093, false, true,
                                 null, null, null, null, null, null);
  if (v_doc ->> 'name') <> 'CHECK 33 dana renamed' then
    raise exception 'CHECK 33 FAILED: the owner''s own update_my_alert did not apply: %', v_doc;
  end if;
  perform public.delete_my_alert(v_id);
  reset role;

  select count(*) into v_n from public.alert_zones where id = v_id;
  if v_n <> 0 then
    raise exception 'CHECK 33 FAILED: the owner''s own delete_my_alert left the row behind';
  end if;

  raise notice 'CHECK 33 passed: foreign and ghost ids both raise ALERT_NOT_FOUND and change nothing; the owner''s own three calls still work';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 34 -- THE SCHEMA DELTA of 20260802150000, asserted from the catalogs.
-- Cheap, and it turns three otherwise-baffling failure modes into one clear
-- message: (1) name must exist and be NOT NULL -- an unnamed row in a list of
-- five is an unusable row, and it is what the per-alert toggle points at;
-- (2) the label column must be GONE, because the migration RENAMED the column rather than
-- adding a second one (a surviving label would mean the data was copied, and one
-- of the two is now stale); (3) the one-zone-per-user UNIQUE index must be gone
-- and the plain btree that replaced it must be present -- that index carried TWO
-- jobs, and dropping it without the replacement silently downgrades the RLS
-- policy, the list read, the cap count and every id-scoped write to a sequential
-- scan (a change that passes every other test in this file).
-- -----------------------------------------------------------------------------
do $$
declare
  v_n int;
begin
  select count(*) into v_n
  from information_schema.columns
  where table_schema = 'public' and table_name = 'alert_zones'
    and column_name = 'name' and is_nullable = 'NO';
  if v_n <> 1 then
    raise exception 'CHECK 34 FAILED: alert_zones.name is missing or still nullable';
  end if;

  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'alert_zones'
                and column_name = 'label') then
    raise exception 'CHECK 34 FAILED: alert_zones.label still exists -- name was supposed to BE that column, renamed';
  end if;

  -- The six criteria columns exist and are ALL nullable: NULL is the neutral
  -- element ("any"), and a NOT NULL among them would break every v1 row.
  select count(*) into v_n
  from information_schema.columns
  where table_schema = 'public' and table_name = 'alert_zones'
    and column_name in ('make', 'model', 'colour', 'body_type',
                        'min_bounty_pence', 'recency_days')
    and is_nullable = 'YES';
  if v_n <> 6 then
    raise exception 'CHECK 34 FAILED: expected 6 NULLABLE criteria columns on alert_zones, found %', v_n;
  end if;

  if exists (select 1 from pg_indexes
              where schemaname = 'public' and tablename = 'alert_zones'
                and indexname = 'alert_zones_one_per_user_uidx') then
    raise exception 'CHECK 34 FAILED: alert_zones_one_per_user_uidx still exists -- a user cannot hold five alerts';
  end if;
  -- ...and no unique index on user_id survives under ANY name (the pkey is on
  -- id, so this pattern cannot match it).
  if exists (select 1 from pg_indexes
              where schemaname = 'public' and tablename = 'alert_zones'
                and indexdef like 'CREATE UNIQUE INDEX%(user_id)') then
    raise exception 'CHECK 34 FAILED: a UNIQUE index on alert_zones (user_id) survives under another name';
  end if;
  if not exists (select 1 from pg_indexes
                  where schemaname = 'public' and tablename = 'alert_zones'
                    and indexname = 'alert_zones_user_idx') then
    raise exception 'CHECK 34 FAILED: alert_zones_user_idx is missing -- the RLS policy, list_my_alerts, the cap count and every id-scoped write lost their index';
  end if;
  -- The GiST index is the fan-out's driver and must survive the rework.
  if not exists (select 1 from pg_indexes
                  where schemaname = 'public' and tablename = 'alert_zones'
                    and indexname = 'alert_zones_point_gix') then
    raise exception 'CHECK 34 FAILED: alert_zones_point_gix is missing -- ST_DWithin has no spatial index';
  end if;

  raise notice 'CHECK 34 passed: name is NOT NULL, label is gone, the six criteria are nullable, the unique index is replaced by alert_zones_user_idx';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 35 -- THE NAME IS REQUIRED, BOUNDED AND STORED TRIMMED. The column CHECK
-- bounds LENGTH only, so a whitespace-only name would satisfy both NOT NULL and
-- <= 80: non-blankness lives in create_my_alert / update_my_alert, which are the
-- ONLY write paths (clients hold no DML grant). That makes this block the only
-- thing standing between the settings list and a row the user cannot tell apart
-- from any other -- and, with a five-alert cap, an unnameable row is a slot they
-- can never confidently reuse.
-- -----------------------------------------------------------------------------
do $$
declare
  v_doc     jsonb;
  v_id      uuid;
  v_name    text;
  v_bad     int := 0;
  v_leaked  int := 0;
begin
  delete from public.alert_zones where user_id = '44444444-4444-4444-4444-444444444444';

  perform set_config('request.jwt.claims',
    '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}', true);
  set local role authenticated;

  -- Blank.
  begin
    perform public.create_my_alert('', 53.4808, -2.2426, 16093, true, true,
                                   null, null, null, null, null, null);
    v_leaked := v_leaked + 1;
  exception when others then
    if sqlerrm like '%INVALID_INPUT%' then v_bad := v_bad + 1;
    else raise exception 'CHECK 35 FAILED: wrong error for a blank name: %', sqlerrm; end if;
  end;

  -- Whitespace only -- blank AFTER trimming, which is the value that would be
  -- stored. This is the one the CHECK constraint cannot catch.
  begin
    perform public.create_my_alert('   ', 53.4808, -2.2426, 16093, true, true,
                                   null, null, null, null, null, null);
    v_leaked := v_leaked + 1;
  exception when others then
    if sqlerrm like '%INVALID_INPUT%' then v_bad := v_bad + 1;
    else raise exception 'CHECK 35 FAILED: wrong error for a whitespace-only name: %', sqlerrm; end if;
  end;

  -- Over the 80-char bound.
  begin
    perform public.create_my_alert(repeat('n', 81), 53.4808, -2.2426, 16093, true, true,
                                   null, null, null, null, null, null);
    v_leaked := v_leaked + 1;
  exception when others then
    if sqlerrm like '%INVALID_INPUT%' then v_bad := v_bad + 1;
    else raise exception 'CHECK 35 FAILED: wrong error for an 81-char name: %', sqlerrm; end if;
  end;

  -- Exactly 80 is FINE: the bound is the documented one, not a stricter guess.
  perform public.create_my_alert(repeat('n', 80), 53.4808, -2.2426, 16093, true, true,
                                 null, null, null, null, null, null);

  -- ...and a padded name is STORED trimmed, not merely accepted.
  v_doc := public.create_my_alert('   Mum''s street   ', 53.4808, -2.2426, 16093, true, true,
                                  null, null, null, null, null, null);
  reset role;

  if v_leaked <> 0 then
    raise exception 'CHECK 35 FAILED: % unnamed/over-long alert(s) were created', v_leaked;
  end if;
  if v_bad <> 3 then
    raise exception 'CHECK 35 FAILED: only % of 3 bad names raised INVALID_INPUT', v_bad;
  end if;

  v_id := (v_doc ->> 'id')::uuid;
  select z.name into v_name from public.alert_zones z where z.id = v_id;
  if v_name <> 'Mum''s street' then
    raise exception 'CHECK 35 FAILED: the stored name is [%], not the trimmed [Mum''s street]', v_name;
  end if;
  if (v_doc ->> 'name') <> v_name then
    raise exception 'CHECK 35 FAILED: the returned name [%] disagrees with the stored one [%]', v_doc ->> 'name', v_name;
  end if;

  -- update_my_alert applies the IDENTICAL rule -- an edit is not a way round it.
  set local role authenticated;
  begin
    perform public.update_my_alert(v_id, '   ', 53.4808, -2.2426, 16093, true, true,
                                   null, null, null, null, null, null);
    v_leaked := v_leaked + 1;
  exception when others then
    if sqlerrm not like '%INVALID_INPUT%' then
      raise exception 'CHECK 35 FAILED: wrong error for a whitespace-only name on update: %', sqlerrm;
    end if;
  end;
  reset role;

  if v_leaked <> 0 then
    raise exception 'CHECK 35 FAILED: update_my_alert accepted a whitespace-only name';
  end if;

  select z.name into v_name from public.alert_zones z where z.id = v_id;
  if v_name <> 'Mum''s street' then
    raise exception 'CHECK 35 FAILED: the refused edit still changed the name to [%]', v_name;
  end if;

  raise notice 'CHECK 35 passed: blank / whitespace / 81-char names are refused, 80 is allowed, and the stored name is trimmed';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 36 -- CRITERION: make. A spotter who narrows an alert to the one make
-- they can actually recognise is spending one of their three daily push slots
-- deliberately. Matching must honour that in both directions -- tell them
-- about the Zephyr, and do NOT spend the slot on the Nimbus.
--
-- Beth's alert sets make and NOTHING else, so the only thing that can differ
-- between the two posts is that column. Carl's CONTROL alert sets no criteria at
-- all -- NULL means ANY -- so he must match BOTH posts. Without that control a
-- non-match would prove nothing: it could be the geography, the cap or the
-- ledger rather than the criterion.
-- -----------------------------------------------------------------------------
do $$
declare
  v_yes jsonb;
  v_no  jsonb;
begin
  -- EXPLICIT SETUP (see the header): delete the fixture users' alerts AND their
  -- ledger rows, then insert exactly the rows this block asserts on.
  delete from public.push_sends where user_id in (
    '11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222',
    '33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444',
    '55555555-5555-5555-5555-555555555555');
  delete from public.alert_zones where user_id in (
    '11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222',
    '33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444',
    '55555555-5555-5555-5555-555555555555');

  insert into public.alert_zones (user_id, name, point, radius_m, enabled,
                                  approximate, make)
  values ('22222222-2222-2222-2222-222222222222', 'CHECK 36 make',
          ST_SetSRID(ST_MakePoint(-2.2426, 53.4808), 4326)::geography,
          16093, true, false, 'Zephyr');
  insert into public.alert_zones (user_id, name, point, radius_m, enabled, approximate)
  values ('33333333-3333-3333-3333-333333333333', 'CHECK 36 any',
          ST_SetSRID(ST_MakePoint(-2.2426, 53.4808), 4326)::geography,
          16093, true, false);

  v_yes := public.match_alert_zones('c1c1c1c1-0000-0000-0000-000000000010');  -- make Zephyr
  v_no  := public.match_alert_zones('c1c1c1c1-0000-0000-0000-000000000011');  -- make Nimbus

  if not (v_yes -> 'user_ids' ? '22222222-2222-2222-2222-222222222222') then
    raise exception 'CHECK 36 FAILED: an alert with make = Zephyr did NOT match the post that satisfies it (make Zephyr): %', v_yes;
  end if;
  if v_no -> 'user_ids' ? '22222222-2222-2222-2222-222222222222' then
    raise exception 'CHECK 36 FAILED: an alert with make = Zephyr matched a post that does NOT satisfy it (make Nimbus): %', v_no;
  end if;
  if not (v_yes -> 'user_ids' ? '33333333-3333-3333-3333-333333333333')
     or not (v_no -> 'user_ids' ? '33333333-3333-3333-3333-333333333333') then
    raise exception 'CHECK 36 FAILED: a NULL make (= ANY) did not match BOTH posts -- NULL is supposed to be the neutral element: % / %', v_yes, v_no;
  end if;

  raise notice 'CHECK 36 passed: make narrows the audience (make Zephyr in, make Nimbus out) and NULL make matches either';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 37 -- CRITERION: model. The narrower sibling of make: "any Zephyr" and
-- "a Zephyr Zodiac" are different alerts, and the second must not quietly
-- behave like the first.
--
-- Beth's alert sets model and NOTHING else, so the only thing that can differ
-- between the two posts is that column. Carl's CONTROL alert sets no criteria at
-- all -- NULL means ANY -- so he must match BOTH posts. Without that control a
-- non-match would prove nothing: it could be the geography, the cap or the
-- ledger rather than the criterion.
-- -----------------------------------------------------------------------------
do $$
declare
  v_yes jsonb;
  v_no  jsonb;
begin
  -- EXPLICIT SETUP (see the header): delete the fixture users' alerts AND their
  -- ledger rows, then insert exactly the rows this block asserts on.
  delete from public.push_sends where user_id in (
    '11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222',
    '33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444',
    '55555555-5555-5555-5555-555555555555');
  delete from public.alert_zones where user_id in (
    '11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222',
    '33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444',
    '55555555-5555-5555-5555-555555555555');

  insert into public.alert_zones (user_id, name, point, radius_m, enabled,
                                  approximate, model)
  values ('22222222-2222-2222-2222-222222222222', 'CHECK 37 model',
          ST_SetSRID(ST_MakePoint(-2.2426, 53.4808), 4326)::geography,
          16093, true, false, 'Zodiac');
  insert into public.alert_zones (user_id, name, point, radius_m, enabled, approximate)
  values ('33333333-3333-3333-3333-333333333333', 'CHECK 37 any',
          ST_SetSRID(ST_MakePoint(-2.2426, 53.4808), 4326)::geography,
          16093, true, false);

  v_yes := public.match_alert_zones('c1c1c1c1-0000-0000-0000-000000000010');  -- model Zodiac
  v_no  := public.match_alert_zones('c1c1c1c1-0000-0000-0000-000000000011');  -- model Nomad

  if not (v_yes -> 'user_ids' ? '22222222-2222-2222-2222-222222222222') then
    raise exception 'CHECK 37 FAILED: an alert with model = Zodiac did NOT match the post that satisfies it (model Zodiac): %', v_yes;
  end if;
  if v_no -> 'user_ids' ? '22222222-2222-2222-2222-222222222222' then
    raise exception 'CHECK 37 FAILED: an alert with model = Zodiac matched a post that does NOT satisfy it (model Nomad): %', v_no;
  end if;
  if not (v_yes -> 'user_ids' ? '33333333-3333-3333-3333-333333333333')
     or not (v_no -> 'user_ids' ? '33333333-3333-3333-3333-333333333333') then
    raise exception 'CHECK 37 FAILED: a NULL model (= ANY) did not match BOTH posts -- NULL is supposed to be the neutral element: % / %', v_yes, v_no;
  end if;

  raise notice 'CHECK 37 passed: model narrows the audience (model Zodiac in, model Nomad out) and NULL model matches either';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 38 -- CRITERION: colour. Colour is the field a bystander actually
-- notices from across a car park, which is exactly why it is worth filtering
-- on -- and exactly why a broken colour predicate would be invisible in the
-- UI.
--
-- Beth's alert sets colour and NOTHING else, so the only thing that can differ
-- between the two posts is that column. Carl's CONTROL alert sets no criteria at
-- all -- NULL means ANY -- so he must match BOTH posts. Without that control a
-- non-match would prove nothing: it could be the geography, the cap or the
-- ledger rather than the criterion.
-- -----------------------------------------------------------------------------
do $$
declare
  v_yes jsonb;
  v_no  jsonb;
begin
  -- EXPLICIT SETUP (see the header): delete the fixture users' alerts AND their
  -- ledger rows, then insert exactly the rows this block asserts on.
  delete from public.push_sends where user_id in (
    '11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222',
    '33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444',
    '55555555-5555-5555-5555-555555555555');
  delete from public.alert_zones where user_id in (
    '11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222',
    '33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444',
    '55555555-5555-5555-5555-555555555555');

  insert into public.alert_zones (user_id, name, point, radius_m, enabled,
                                  approximate, colour)
  values ('22222222-2222-2222-2222-222222222222', 'CHECK 38 colour',
          ST_SetSRID(ST_MakePoint(-2.2426, 53.4808), 4326)::geography,
          16093, true, false, 'Chartreuse');
  insert into public.alert_zones (user_id, name, point, radius_m, enabled, approximate)
  values ('33333333-3333-3333-3333-333333333333', 'CHECK 38 any',
          ST_SetSRID(ST_MakePoint(-2.2426, 53.4808), 4326)::geography,
          16093, true, false);

  v_yes := public.match_alert_zones('c1c1c1c1-0000-0000-0000-000000000010');  -- colour Chartreuse
  v_no  := public.match_alert_zones('c1c1c1c1-0000-0000-0000-000000000011');  -- colour Vermilion

  if not (v_yes -> 'user_ids' ? '22222222-2222-2222-2222-222222222222') then
    raise exception 'CHECK 38 FAILED: an alert with colour = Chartreuse did NOT match the post that satisfies it (colour Chartreuse): %', v_yes;
  end if;
  if v_no -> 'user_ids' ? '22222222-2222-2222-2222-222222222222' then
    raise exception 'CHECK 38 FAILED: an alert with colour = Chartreuse matched a post that does NOT satisfy it (colour Vermilion): %', v_no;
  end if;
  if not (v_yes -> 'user_ids' ? '33333333-3333-3333-3333-333333333333')
     or not (v_no -> 'user_ids' ? '33333333-3333-3333-3333-333333333333') then
    raise exception 'CHECK 38 FAILED: a NULL colour (= ANY) did not match BOTH posts -- NULL is supposed to be the neutral element: % / %', v_yes, v_no;
  end if;

  raise notice 'CHECK 38 passed: colour narrows the audience (colour Chartreuse in, colour Vermilion out) and NULL colour matches either';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 39 -- CRITERION: body_type. The DOMAIN.md case for filtered alerts is
-- the person who only recognises, say, vans. body_type is that filter, and it
-- is the one criterion whose post-side column is nullable in practice, so it
-- also proves an unknown value cannot satisfy a specific filter.
--
-- Beth's alert sets body_type and NOTHING else, so the only thing that can differ
-- between the two posts is that column. Carl's CONTROL alert sets no criteria at
-- all -- NULL means ANY -- so he must match BOTH posts. Without that control a
-- non-match would prove nothing: it could be the geography, the cap or the
-- ledger rather than the criterion.
-- -----------------------------------------------------------------------------
do $$
declare
  v_yes jsonb;
  v_no  jsonb;
begin
  -- EXPLICIT SETUP (see the header): delete the fixture users' alerts AND their
  -- ledger rows, then insert exactly the rows this block asserts on.
  delete from public.push_sends where user_id in (
    '11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222',
    '33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444',
    '55555555-5555-5555-5555-555555555555');
  delete from public.alert_zones where user_id in (
    '11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222',
    '33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444',
    '55555555-5555-5555-5555-555555555555');

  insert into public.alert_zones (user_id, name, point, radius_m, enabled,
                                  approximate, body_type)
  values ('22222222-2222-2222-2222-222222222222', 'CHECK 39 body_type',
          ST_SetSRID(ST_MakePoint(-2.2426, 53.4808), 4326)::geography,
          16093, true, false, 'Fastback');
  insert into public.alert_zones (user_id, name, point, radius_m, enabled, approximate)
  values ('33333333-3333-3333-3333-333333333333', 'CHECK 39 any',
          ST_SetSRID(ST_MakePoint(-2.2426, 53.4808), 4326)::geography,
          16093, true, false);

  v_yes := public.match_alert_zones('c1c1c1c1-0000-0000-0000-000000000010');  -- body_type Fastback
  v_no  := public.match_alert_zones('c1c1c1c1-0000-0000-0000-000000000011');  -- body_type Dropside

  if not (v_yes -> 'user_ids' ? '22222222-2222-2222-2222-222222222222') then
    raise exception 'CHECK 39 FAILED: an alert with body_type = Fastback did NOT match the post that satisfies it (body_type Fastback): %', v_yes;
  end if;
  if v_no -> 'user_ids' ? '22222222-2222-2222-2222-222222222222' then
    raise exception 'CHECK 39 FAILED: an alert with body_type = Fastback matched a post that does NOT satisfy it (body_type Dropside): %', v_no;
  end if;
  if not (v_yes -> 'user_ids' ? '33333333-3333-3333-3333-333333333333')
     or not (v_no -> 'user_ids' ? '33333333-3333-3333-3333-333333333333') then
    raise exception 'CHECK 39 FAILED: a NULL body_type (= ANY) did not match BOTH posts -- NULL is supposed to be the neutral element: % / %', v_yes, v_no;
  end if;

  raise notice 'CHECK 39 passed: body_type narrows the audience (body_type Fastback in, body_type Dropside out) and NULL body_type matches either';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 40 -- CRITERION: min_bounty_pence. MONEY: integer pence, GBP implied,
-- on BOTH sides -- never a float and never rounded. An alert asking for at
-- least 1000 GBP must match the 2500 GBP post and not the 50 GBP one. The
-- column carries the same 5000..500000 CHECK as posts.bounty_amount_pence, so
-- this filter can never be set to a value no post could satisfy.
--
-- Beth's alert sets min_bounty_pence and NOTHING else, so the only thing that can differ
-- between the two posts is that column. Carl's CONTROL alert sets no criteria at
-- all -- NULL means ANY -- so he must match BOTH posts. Without that control a
-- non-match would prove nothing: it could be the geography, the cap or the
-- ledger rather than the criterion.
-- -----------------------------------------------------------------------------
do $$
declare
  v_yes jsonb;
  v_no  jsonb;
begin
  -- EXPLICIT SETUP (see the header): delete the fixture users' alerts AND their
  -- ledger rows, then insert exactly the rows this block asserts on.
  delete from public.push_sends where user_id in (
    '11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222',
    '33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444',
    '55555555-5555-5555-5555-555555555555');
  delete from public.alert_zones where user_id in (
    '11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222',
    '33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444',
    '55555555-5555-5555-5555-555555555555');

  insert into public.alert_zones (user_id, name, point, radius_m, enabled,
                                  approximate, min_bounty_pence)
  values ('22222222-2222-2222-2222-222222222222', 'CHECK 40 min_bounty_pence',
          ST_SetSRID(ST_MakePoint(-2.2426, 53.4808), 4326)::geography,
          16093, true, false, 100000);
  insert into public.alert_zones (user_id, name, point, radius_m, enabled, approximate)
  values ('33333333-3333-3333-3333-333333333333', 'CHECK 40 any',
          ST_SetSRID(ST_MakePoint(-2.2426, 53.4808), 4326)::geography,
          16093, true, false);

  v_yes := public.match_alert_zones('c1c1c1c1-0000-0000-0000-000000000010');  -- bounty 250000 pence
  v_no  := public.match_alert_zones('c1c1c1c1-0000-0000-0000-000000000011');  -- bounty 5000 pence

  if not (v_yes -> 'user_ids' ? '22222222-2222-2222-2222-222222222222') then
    raise exception 'CHECK 40 FAILED: an alert with min_bounty_pence = 100000 pence did NOT match the post that satisfies it (bounty 250000 pence): %', v_yes;
  end if;
  if v_no -> 'user_ids' ? '22222222-2222-2222-2222-222222222222' then
    raise exception 'CHECK 40 FAILED: an alert with min_bounty_pence = 100000 pence matched a post that does NOT satisfy it (bounty 5000 pence): %', v_no;
  end if;
  if not (v_yes -> 'user_ids' ? '33333333-3333-3333-3333-333333333333')
     or not (v_no -> 'user_ids' ? '33333333-3333-3333-3333-333333333333') then
    raise exception 'CHECK 40 FAILED: a NULL min_bounty_pence (= ANY) did not match BOTH posts -- NULL is supposed to be the neutral element: % / %', v_yes, v_no;
  end if;

  raise notice 'CHECK 40 passed: min_bounty_pence narrows the audience (bounty 250000 pence in, bounty 5000 pence out) and NULL min_bounty_pence matches either';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 41 -- CRITERION: recency_days. A stolen car is worth looking for in
-- the first hours; a month-old post is a different proposition. The window is
-- measured against posts.last_seen_at, and a post with a NULL last_seen_at can
-- never satisfy it -- unknown age is not "recent".
--
-- Beth's alert sets recency_days and NOTHING else, so the only thing that can differ
-- between the two posts is that column. Carl's CONTROL alert sets no criteria at
-- all -- NULL means ANY -- so he must match BOTH posts. Without that control a
-- non-match would prove nothing: it could be the geography, the cap or the
-- ledger rather than the criterion.
-- -----------------------------------------------------------------------------
do $$
declare
  v_yes jsonb;
  v_no  jsonb;
begin
  -- EXPLICIT SETUP (see the header): delete the fixture users' alerts AND their
  -- ledger rows, then insert exactly the rows this block asserts on.
  delete from public.push_sends where user_id in (
    '11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222',
    '33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444',
    '55555555-5555-5555-5555-555555555555');
  delete from public.alert_zones where user_id in (
    '11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222',
    '33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444',
    '55555555-5555-5555-5555-555555555555');

  insert into public.alert_zones (user_id, name, point, radius_m, enabled,
                                  approximate, recency_days)
  values ('22222222-2222-2222-2222-222222222222', 'CHECK 41 recency_days',
          ST_SetSRID(ST_MakePoint(-2.2426, 53.4808), 4326)::geography,
          16093, true, false, 3);
  insert into public.alert_zones (user_id, name, point, radius_m, enabled, approximate)
  values ('33333333-3333-3333-3333-333333333333', 'CHECK 41 any',
          ST_SetSRID(ST_MakePoint(-2.2426, 53.4808), 4326)::geography,
          16093, true, false);

  v_yes := public.match_alert_zones('c1c1c1c1-0000-0000-0000-000000000010');  -- last seen 1 hour ago
  v_no  := public.match_alert_zones('c1c1c1c1-0000-0000-0000-000000000011');  -- last seen 30 days ago

  if not (v_yes -> 'user_ids' ? '22222222-2222-2222-2222-222222222222') then
    raise exception 'CHECK 41 FAILED: an alert with recency_days = 3 days did NOT match the post that satisfies it (last seen 1 hour ago): %', v_yes;
  end if;
  if v_no -> 'user_ids' ? '22222222-2222-2222-2222-222222222222' then
    raise exception 'CHECK 41 FAILED: an alert with recency_days = 3 days matched a post that does NOT satisfy it (last seen 30 days ago): %', v_no;
  end if;
  if not (v_yes -> 'user_ids' ? '33333333-3333-3333-3333-333333333333')
     or not (v_no -> 'user_ids' ? '33333333-3333-3333-3333-333333333333') then
    raise exception 'CHECK 41 FAILED: a NULL recency_days (= ANY) did not match BOTH posts -- NULL is supposed to be the neutral element: % / %', v_yes, v_no;
  end if;

  raise notice 'CHECK 41 passed: recency_days narrows the audience (last seen 1 hour ago in, last seen 30 days ago out) and NULL recency_days matches either';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 42 -- MATCHING IS CASE-INSENSITIVE AND TRIMMED, ON BOTH SIDES. This is a
-- SAFETY property, not a nicety: posts.make carries no CHECK and no
-- normalisation (create_post stores exactly what the owner typed, and MakeField
-- allows free-typed entry), so "BMW", "bmw" and "  BMW " are all genuinely in
-- the table. Under an exact = the spotter who deliberately narrowed their alert
-- to that make is silently never told about the car two streets away -- they did
-- everything right, and nothing anywhere reports an error.
--
-- Both directions are asserted (alert lower / post upper AND alert upper / post
-- lower) because a one-sided lower() would pass a single-direction test, and the
-- Nimbus post is matched last so a lower() that collapsed everything into a
-- match could not hide behind three passing assertions.
-- -----------------------------------------------------------------------------
do $$
declare
  v_upper  jsonb;
  v_lower  jsonb;
  v_padded jsonb;
  v_other  jsonb;
begin
  -- EXPLICIT SETUP (see the header): delete the fixture users' alerts AND their
  -- ledger rows, then insert exactly the rows this block asserts on.
  delete from public.push_sends where user_id in (
    '11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222',
    '33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444',
    '55555555-5555-5555-5555-555555555555');
  delete from public.alert_zones where user_id in (
    '11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222',
    '33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444',
    '55555555-5555-5555-5555-555555555555');

  -- Beth asks for 'bmw', Carl for 'BMW'. Both must match all three spellings.
  insert into public.alert_zones (user_id, name, point, radius_m, enabled,
                                  approximate, make)
  values ('22222222-2222-2222-2222-222222222222', 'CHECK 42 lower-case alert',
          ST_SetSRID(ST_MakePoint(-2.2426, 53.4808), 4326)::geography,
          16093, true, false, 'bmw'),
         ('33333333-3333-3333-3333-333333333333', 'CHECK 42 upper-case alert',
          ST_SetSRID(ST_MakePoint(-2.2426, 53.4808), 4326)::geography,
          16093, true, false, 'BMW');

  -- The ledger is cleared before EACH call: this block matches four posts for
  -- the same two users and the rolling cap is 3. The cap is CHECK 12's property,
  -- not this one's, and it must not be what decides the outcome here.
  delete from public.push_sends where user_id in (
    '11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222',
    '33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444',
    '55555555-5555-5555-5555-555555555555');
  v_upper := public.match_alert_zones('c1c1c1c1-0000-0000-0000-000000000012');   -- 'BMW'
  delete from public.push_sends where user_id in (
    '11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222',
    '33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444',
    '55555555-5555-5555-5555-555555555555');
  v_lower := public.match_alert_zones('c1c1c1c1-0000-0000-0000-000000000013');   -- 'bmw'
  delete from public.push_sends where user_id in (
    '11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222',
    '33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444',
    '55555555-5555-5555-5555-555555555555');
  v_padded := public.match_alert_zones('c1c1c1c1-0000-0000-0000-000000000014');  -- '  BMW '
  delete from public.push_sends where user_id in (
    '11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222',
    '33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444',
    '55555555-5555-5555-5555-555555555555');
  v_other := public.match_alert_zones('c1c1c1c1-0000-0000-0000-000000000011');   -- 'Nimbus'

  if not (v_upper -> 'user_ids' ? '22222222-2222-2222-2222-222222222222') then
    raise exception 'CHECK 42 FAILED: an alert for make bmw did not match a post whose make is BMW: %', v_upper;
  end if;
  if not (v_lower -> 'user_ids' ? '33333333-3333-3333-3333-333333333333') then
    raise exception 'CHECK 42 FAILED: an alert for make BMW did not match a post whose make is bmw: %', v_lower;
  end if;
  if not (v_lower -> 'user_ids' ? '22222222-2222-2222-2222-222222222222')
     or not (v_upper -> 'user_ids' ? '33333333-3333-3333-3333-333333333333') then
    raise exception 'CHECK 42 FAILED: the comparison is not symmetric -- one side is being lowered and the other is not: % / %', v_upper, v_lower;
  end if;
  if not (v_padded -> 'user_ids' ? '22222222-2222-2222-2222-222222222222')
     or not (v_padded -> 'user_ids' ? '33333333-3333-3333-3333-333333333333') then
    raise exception 'CHECK 42 FAILED: an UNTRIMMED post make ("  BMW ") matched nobody -- btrim is missing on the post side: %', v_padded;
  end if;
  if (v_other -> 'user_ids' ? '22222222-2222-2222-2222-222222222222')
     or (v_other -> 'user_ids' ? '33333333-3333-3333-3333-333333333333') then
    raise exception 'CHECK 42 FAILED: a BMW alert matched a Nimbus -- the comparison collapsed into a match-all: %', v_other;
  end if;

  raise notice 'CHECK 42 passed: bmw/BMW match each other in both directions, an untrimmed post make still matches, and a different make still does not';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 43 -- THREE MATCHING ALERTS, ONE PUSH. THIS IS THE PROPERTY THE WHOLE
-- MULTI-ALERT MODEL RESTS ON. A real spotter's five alerts overlap by design
-- ("anything near home", "Zephyrs", "big bounties"), so one stolen car will
-- routinely satisfy several of them at once. Everything that collapses that to a
-- single notification is USER-keyed and none of it is alert-keyed: select
-- distinct z.user_id, the (user_id, kind, subject_id) dedup, and the rolling-24h
-- cap. The distinct in particular used to be belt-and-braces behind a unique
-- index that no longer exists -- it is now the only thing standing between a
-- well-configured spotter and three notifications for one car, which is the
-- fastest way to teach someone to turn alerts off for good (DOMAIN.md: alert
-- fatigue is the asymmetric risk).
--
-- Part (i) proves each alert matches ON ITS OWN -- on its own probe post, so the
-- same-subject dedup can never be mistaken for a matching failure. Without it
-- this check would still pass if two of the three alerts silently matched
-- nothing, which is the exact bug it exists to catch.
-- -----------------------------------------------------------------------------
do $$
declare
  v_probe jsonb;
  v_doc   jsonb;
  v_hits  int;
  v_rows  int;
  v_n     int;
begin
  -- EXPLICIT SETUP (see the header): delete the fixture users' alerts AND their
  -- ledger rows, then insert exactly the rows this block asserts on.
  delete from public.push_sends where user_id in (
    '11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222',
    '33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444',
    '55555555-5555-5555-5555-555555555555');
  delete from public.alert_zones where user_id in (
    '11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222',
    '33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444',
    '55555555-5555-5555-5555-555555555555');

  insert into public.alert_zones (user_id, name, point, radius_m, enabled, approximate,
                                  make, min_bounty_pence)
  values ('22222222-2222-2222-2222-222222222222', 'CHECK 43 anything near home',
          ST_SetSRID(ST_MakePoint(-2.2426, 53.4808), 4326)::geography,
          16093, true, false, null, null),
         ('22222222-2222-2222-2222-222222222222', 'CHECK 43 zephyrs only',
          ST_SetSRID(ST_MakePoint(-2.2426, 53.4808), 4326)::geography,
          16093, true, false, 'zephyr', null),
         ('22222222-2222-2222-2222-222222222222', 'CHECK 43 big bounties only',
          ST_SetSRID(ST_MakePoint(-2.2426, 53.4808), 4326)::geography,
          16093, true, false, null, 100000);

  select count(*) into v_n
  from public.alert_zones where user_id = '22222222-2222-2222-2222-222222222222';
  if v_n <> 3 then
    raise exception 'CHECK 43 SETUP FAILED: expected 3 alerts for one user, got % -- the multi-alert model is not in place', v_n;
  end if;

  -- (i) each alert on its own, against its own post.
  update public.alert_zones set enabled = (name = 'CHECK 43 anything near home')
   where user_id = '22222222-2222-2222-2222-222222222222';
  delete from public.push_sends where user_id in (
    '11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222',
    '33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444',
    '55555555-5555-5555-5555-555555555555');
  v_probe := public.match_alert_zones('c1c1c1c1-0000-0000-0000-000000000010');
  if not (v_probe -> 'user_ids' ? '22222222-2222-2222-2222-222222222222') then
    raise exception 'CHECK 43 SETUP FAILED: the un-filtered alert does not match on its own: %', v_probe;
  end if;

  update public.alert_zones set enabled = (name = 'CHECK 43 zephyrs only')
   where user_id = '22222222-2222-2222-2222-222222222222';
  delete from public.push_sends where user_id in (
    '11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222',
    '33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444',
    '55555555-5555-5555-5555-555555555555');
  v_probe := public.match_alert_zones('c1c1c1c1-0000-0000-0000-000000000017');
  if not (v_probe -> 'user_ids' ? '22222222-2222-2222-2222-222222222222') then
    raise exception 'CHECK 43 SETUP FAILED: the make-filtered alert does not match on its own: %', v_probe;
  end if;

  update public.alert_zones set enabled = (name = 'CHECK 43 big bounties only')
   where user_id = '22222222-2222-2222-2222-222222222222';
  delete from public.push_sends where user_id in (
    '11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222',
    '33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444',
    '55555555-5555-5555-5555-555555555555');
  v_probe := public.match_alert_zones('c1c1c1c1-0000-0000-0000-000000000018');
  if not (v_probe -> 'user_ids' ? '22222222-2222-2222-2222-222222222222') then
    raise exception 'CHECK 43 SETUP FAILED: the bounty-filtered alert does not match on its own: %', v_probe;
  end if;

  -- (ii) all three at once, one post. ONE entry, ONE ledger row.
  update public.alert_zones set enabled = true
   where user_id = '22222222-2222-2222-2222-222222222222';
  delete from public.push_sends where user_id in (
    '11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222',
    '33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444',
    '55555555-5555-5555-5555-555555555555');
  v_doc := public.match_alert_zones('c1c1c1c1-0000-0000-0000-000000000015');

  select count(*) into v_hits
  from jsonb_array_elements_text(v_doc -> 'user_ids') as t(uid)
  where t.uid = '22222222-2222-2222-2222-222222222222';

  if v_hits <> 1 then
    raise exception 'CHECK 43 FAILED: the user appears % time(s) in user_ids for ONE post -- three matching alerts became % pushes: %',
      v_hits, v_hits, v_doc;
  end if;
  if jsonb_array_length(v_doc -> 'user_ids') <> 1 then
    raise exception 'CHECK 43 FAILED: expected exactly one recipient, got %: %',
      jsonb_array_length(v_doc -> 'user_ids'), v_doc;
  end if;

  select count(*) into v_rows
  from public.push_sends
  where user_id = '22222222-2222-2222-2222-222222222222' and kind = 'alert'
    and subject_id = 'c1c1c1c1-0000-0000-0000-000000000015';
  if v_rows <> 1 then
    raise exception 'CHECK 43 FAILED: % push_sends row(s) for one user and one post -- the ledger is alert-keyed instead of user-keyed, so five alerts would burn five of the three daily cap slots', v_rows;
  end if;

  raise notice 'CHECK 43 passed: three alerts that all match one post produce ONE entry in user_ids and ONE push_sends row';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 44 -- DISABLED ALERTS ARE EXCLUDED PER ALERT. CHECK 4 proves a paused
-- alert never matches; this proves the switch is now per ROW rather than per
-- user, which is exactly what v1's set_my_alert_zone_enabled(boolean) could not
-- express -- its UPDATE was qualified on user_id alone, so one tap would have
-- muted every alert a person owned. Two halves:
--   * a user with one enabled and one paused matching alert is still notified,
--     exactly ONCE (pausing one alert must not mute the others, and must not
--     turn a single push into two),
--   * a user whose matching alerts are ALL paused is not notified at all, and
--     their rows survive -- paused is not deleted.
-- -----------------------------------------------------------------------------
do $$
declare
  v_doc  jsonb;
  v_hits int;
  v_rows int;
  v_n    int;
begin
  -- EXPLICIT SETUP (see the header): delete the fixture users' alerts AND their
  -- ledger rows, then insert exactly the rows this block asserts on.
  delete from public.push_sends where user_id in (
    '11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222',
    '33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444',
    '55555555-5555-5555-5555-555555555555');
  delete from public.alert_zones where user_id in (
    '11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222',
    '33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444',
    '55555555-5555-5555-5555-555555555555');

  insert into public.alert_zones (user_id, name, point, radius_m, enabled, approximate)
  values ('22222222-2222-2222-2222-222222222222', 'CHECK 44 beth live',
          ST_SetSRID(ST_MakePoint(-2.2426, 53.4808), 4326)::geography,
          16093, true, false),
         ('22222222-2222-2222-2222-222222222222', 'CHECK 44 beth paused',
          ST_SetSRID(ST_MakePoint(-2.2426, 53.4808), 4326)::geography,
          16093, false, false),
         ('33333333-3333-3333-3333-333333333333', 'CHECK 44 carl paused a',
          ST_SetSRID(ST_MakePoint(-2.2426, 53.4808), 4326)::geography,
          16093, false, false),
         ('33333333-3333-3333-3333-333333333333', 'CHECK 44 carl paused b',
          ST_SetSRID(ST_MakePoint(-2.2426, 53.4808), 4326)::geography,
          16093, false, false);

  v_doc := public.match_alert_zones('c1c1c1c1-0000-0000-0000-000000000016');

  select count(*) into v_hits
  from jsonb_array_elements_text(v_doc -> 'user_ids') as t(uid)
  where t.uid = '22222222-2222-2222-2222-222222222222';
  if v_hits <> 1 then
    raise exception 'CHECK 44 FAILED: the user with one live and one paused matching alert appears % time(s): %', v_hits, v_doc;
  end if;

  select count(*) into v_rows
  from public.push_sends
  where user_id = '22222222-2222-2222-2222-222222222222' and kind = 'alert'
    and subject_id = 'c1c1c1c1-0000-0000-0000-000000000016';
  if v_rows <> 1 then
    raise exception 'CHECK 44 FAILED: % ledger row(s) for the mixed user (expected exactly 1)', v_rows;
  end if;

  if v_doc -> 'user_ids' ? '33333333-3333-3333-3333-333333333333' then
    raise exception 'CHECK 44 FAILED: a user whose matching alerts are ALL paused was alerted: %', v_doc;
  end if;
  if exists (select 1 from public.push_sends
              where user_id = '33333333-3333-3333-3333-333333333333'
                and subject_id = 'c1c1c1c1-0000-0000-0000-000000000016') then
    raise exception 'CHECK 44 FAILED: a ledger row was written for a user with only paused alerts -- a cap slot burned for a push nobody gets';
  end if;

  -- Paused is not deleted: both of Carl's rows survive.
  select count(*) into v_n
  from public.alert_zones where user_id = '33333333-3333-3333-3333-333333333333';
  if v_n <> 2 then
    raise exception 'CHECK 44 FAILED: Carl holds % paused alert(s) after the match (expected 2) -- pausing must never lose the area', v_n;
  end if;

  raise notice 'CHECK 44 passed: pausing one alert does not mute the others (still exactly one push); all-paused is not notified and keeps its rows';
end $$;


-- -----------------------------------------------------------------------------
-- CHECK 45 -- get_alert_reach: the count the bounty slider shows an owner.
--
-- It answers "how many more spotters does a higher bounty reach", which is the
-- one honest argument for raising it. Four properties, and three of them are
-- SAFETY rather than product -- this counts rows describing other people's
-- home-ish points (SECURITY_AND_TRUST section 3):
--   (a) the count RISES with the bounty (the whole point);
--   (b) small counts report 0, because a small count is the identifying one --
--       and "2 spotters are watching" is also what we would least want to hand
--       a thief;
--   (c) the caller's OWN zone never counts;
--   (d) two points inside one ~1km grid cell give the SAME answer, so the
--       function cannot resolve zone density more finely than the zones are
--       stored.
-- (20260807120000_alert_reach_count.sql)
-- -----------------------------------------------------------------------------
do $$
declare
  -- Manchester, the seed's centre of gravity.
  c_lat constant double precision := 53.4808;
  c_lng constant double precision := -2.2426;
  v_low     integer;
  v_high    integer;
  v_self    integer;
  v_near    integer;
  v_dedup   integer;
  v_paused  uuid[];
begin
  -- The seed ships alert zones of its own, and the count is DISTINCT BY USER,
  -- so a seed zone belonging to one of the users below would keep them counted
  -- after their test zone is paused -- which is correct behaviour and would
  -- make this check assert nothing. Neutralise the pre-existing zones for the
  -- duration and restore them at the end. Safe: a do-block is one transaction,
  -- so a raised assertion rolls this back too.
  select array_agg(id) into v_paused from public.alert_zones where enabled;
  update public.alert_zones set enabled = false where id = any(coalesce(v_paused, '{}'));

  -- Five OTHER spotters, all covering the point, with rising thresholds. At
  -- 50,000 pence only two clear it; at 300,000 all five do.
  insert into public.alert_zones (user_id, name, point, radius_m, enabled, approximate, min_bounty_pence)
  values
    ('22222222-2222-2222-2222-222222222222', 'CHECK 45 a',
     ST_SetSRID(ST_MakePoint(c_lng, c_lat), 4326)::geography, 16093, true, false, 5000),
    ('33333333-3333-3333-3333-333333333333', 'CHECK 45 b',
     ST_SetSRID(ST_MakePoint(c_lng, c_lat), 4326)::geography, 16093, true, false, 50000),
    ('44444444-4444-4444-4444-444444444444', 'CHECK 45 c',
     ST_SetSRID(ST_MakePoint(c_lng, c_lat), 4326)::geography, 16093, true, false, 100000),
    ('55555555-5555-5555-5555-555555555555', 'CHECK 45 d',
     ST_SetSRID(ST_MakePoint(c_lng, c_lat), 4326)::geography, 16093, true, false, 200000),
    ('66666666-6666-6666-6666-666666666666', 'CHECK 45 e',
     ST_SetSRID(ST_MakePoint(c_lng, c_lat), 4326)::geography, 16093, true, false, 300000);

  -- Caller is Alex, who holds no zone here.
  perform set_config('request.jwt.claims',
                     json_build_object('sub', '11111111-1111-1111-1111-111111111111')::text, true);

  -- (b) THE FLOOR. Two zones clear 50,000 -- below the reportable minimum, so
  -- the honest answer to the caller is nothing at all, not "2".
  v_low := public.get_alert_reach(c_lat, c_lng, 50000);
  if v_low <> 0 then
    raise exception 'CHECK 45 FAILED: a reach of 2 reported as % -- small counts must floor to 0, they are the identifying ones', v_low;
  end if;

  -- (a) THE POINT OF THE FEATURE. All five clear 300,000.
  v_high := public.get_alert_reach(c_lat, c_lng, 300000);
  if v_high <> 5 then
    raise exception 'CHECK 45 FAILED: expected 5 spotters at a 300,000p bounty, got % -- the count must RISE with the bounty or the slider has nothing to say', v_high;
  end if;

  -- (d) GRID SNAP. ~0.003 degrees is a few hundred metres: inside one cell, so
  -- the answer must not move. If this ever differs, the function has become a
  -- finer-grained oracle over strangers' zones than the zones themselves are.
  v_near := public.get_alert_reach(c_lat + 0.003, c_lng + 0.003, 300000);
  if v_near <> v_high then
    raise exception 'CHECK 45 FAILED: two points in the same ~1km cell returned % and % -- the input snap is not containing probe precision', v_high, v_near;
  end if;

  -- (c) NEVER COUNT YOURSELF. Beth holds one of the five zones; as the caller
  -- she must see four, which is below the floor, so 0.
  perform set_config('request.jwt.claims',
                     json_build_object('sub', '22222222-2222-2222-2222-222222222222')::text, true);
  v_self := public.get_alert_reach(c_lat, c_lng, 300000);
  if v_self <> 0 then
    raise exception 'CHECK 45 FAILED: the caller''s own zone was counted (got %, expected 4 -> floored to 0)', v_self;
  end if;

  -- A paused zone reaches nobody, so it must not be counted either.
  update public.alert_zones set enabled = false
   where name = 'CHECK 45 a';
  perform set_config('request.jwt.claims',
                     json_build_object('sub', '11111111-1111-1111-1111-111111111111')::text, true);
  if public.get_alert_reach(c_lat, c_lng, 300000) <> 0 then
    raise exception 'CHECK 45 FAILED: a paused zone was counted -- it reaches nobody';
  end if;

  -- A spotter with TWO zones over the same point is one person, so they must
  -- count once. The number is shown to an owner as "reaches N spotters"; if it
  -- counted zones it would overstate the audience, which on a money screen is
  -- the direction that matters.
  update public.alert_zones set enabled = true where name = 'CHECK 45 a';
  insert into public.alert_zones (user_id, name, point, radius_m, enabled, approximate, min_bounty_pence)
  values ('22222222-2222-2222-2222-222222222222', 'CHECK 45 a2',
          ST_SetSRID(ST_MakePoint(c_lng, c_lat), 4326)::geography, 16093, true, false, 5000);
  v_dedup := public.get_alert_reach(c_lat, c_lng, 300000);
  if v_dedup <> 5 then
    raise exception 'CHECK 45 FAILED: a spotter holding two zones counted as % people, expected 5 -- "reaches N spotters" must count PEOPLE, not zones', v_dedup;
  end if;

  perform set_config('request.jwt.claims', '', true);
  delete from public.alert_zones where name like 'CHECK 45 %';
  update public.alert_zones set enabled = true where id = any(coalesce(v_paused, '{}'));
  raise notice 'CHECK 45 passed: reach rises with the bounty, floors small counts, counts people not zones, excludes self and paused, and cannot be probed below the grid';
end $$;

-- -----------------------------------------------------------------------------
-- Housekeeping: remove everything this file created so the seed state is
-- unchanged for the other suites and for a re-run. Posts go LAST -- the
-- sighting, the thread and the messages cascade from them.
-- -----------------------------------------------------------------------------
delete from public.push_sends
where user_id in ('11111111-1111-1111-1111-111111111111',
                  '22222222-2222-2222-2222-222222222222',
                  '33333333-3333-3333-3333-333333333333',
                  '44444444-4444-4444-4444-444444444444',
                  '55555555-5555-5555-5555-555555555555');
delete from public.alert_zones
where user_id in ('11111111-1111-1111-1111-111111111111',
                  '22222222-2222-2222-2222-222222222222',
                  '33333333-3333-3333-3333-333333333333',
                  '44444444-4444-4444-4444-444444444444',
                  '55555555-5555-5555-5555-555555555555');
delete from public.push_tokens where token like 'ExponentPushToken[tid-verif-%';
delete from public.posts where id::text like 'c1c1c1c1-%';

-- =============================================================================
-- WHAT:  Tier 1 verification for the notification center — the feed table's
--        RLS, the four read-marking RPCs, and the two new claims (`recovery`
--        to watchers, `payout_sent` to the credited spotter). NOT a migration.
-- WHY:   The feed is a per-user activity log (who was told what, when) — one
--        RLS slip reads like a surveillance feed of someone else's theft. The
--        claims are once-only announcement gates, and the payout title is a
--        MONEY string: it must carry the RECORDED transfer amount, never a
--        recomputation.
--
-- CHECKS: 1 RLS (own rows only; anon nothing) · 2 mark_notification_read
-- (once-only; foreign row is a no-op) · 3 mark_notifications_read_by_payload
-- (exact kind+payload, caller only, no near-misses) · 4 mark_all +
-- unread_notifications_count agree · 5 claim_recovery_notifications (once-
-- only; recovered states only; audience = watchers minus owner; copy carries
-- no plate; empty audience still consumes the claim) · 6 claim_payout_sent_
-- notification (once-only; title = the RECORDED transfer amount; refuses a
-- non-released payment) · 7 grants (deny-by-default held; no client write
-- path into the feed — which is also why kind='message', whitelisted for
-- symmetry only, can never be written by anyone but the service role) ·
-- 9 get_notification_feed (own rows only THROUGH THE FUNCTION — the feed read
-- is SECURITY DEFINER since 2026-08-28, so CHECK 1's table policy no longer
-- covers the path the app uses; the image_url gate opens for a spotter with a
-- sighting on a recovered post and stays shut for a mere watcher; a malformed
-- payload degrades to a pictureless row instead of blanking the whole feed).
-- LINKS: supabase/migrations/20260806100000_notification_center.sql;
--        supabase/migrations/20260828120000_notification_feed_photo.sql;
--        docs/DOMAIN.md (Notifications; Disputes); docs/TESTING.md;
--        scripts/test-db.sh.
--
-- SELF-ASSERTING: every check RAISES on failure (ON_ERROR_STOP=1).
--
-- Fixtures (from supabase/seed.sql):
--   ACTIVE post a1a1a1a1-...0003 owned by Beth 22222222 (Black BMW 3 Series,
--     plate 'BD21 WSE' — the plate the recovery copy must NOT contain)
--   ACTIVE post a1a1a1a1-...0005 owned by Carl 33333333 (Red Toyota Yaris)
--   Users: Alex 11111111 / Beth 22222222 / Carl 33333333 / Dana 44444444
-- Notification rows f0f0f0f0-...01..06, sightings e0e0e0e0-...01..02, payments
-- pi_test_payout_sent / pi_test_payout_held and the watchlist rows are created
-- BY THIS FILE and removed in housekeeping.
-- =============================================================================

-- --- housekeeping: leave no trace from a previous run ------------------------
delete from public.notifications
 where id in ('f0f0f0f0-0000-0000-0000-000000000001',
              'f0f0f0f0-0000-0000-0000-000000000002',
              'f0f0f0f0-0000-0000-0000-000000000003',
              'f0f0f0f0-0000-0000-0000-000000000004',
              'f0f0f0f0-0000-0000-0000-000000000005',
              'f0f0f0f0-0000-0000-0000-000000000006');
delete from public.watchlist_items
 where post_id in ('a1a1a1a1-0000-0000-0000-000000000003',
                   'a1a1a1a1-0000-0000-0000-000000000005');
delete from public.payments
 where stripe_payment_intent_id in ('pi_test_payout_sent', 'pi_test_payout_held');
delete from public.sightings
 where id in ('e0e0e0e0-0000-0000-0000-000000000001',
              'e0e0e0e0-0000-0000-0000-000000000002');
update public.posts
   set status = 'active', recovered_at = null, recovery_notified_at = null
 where id in ('a1a1a1a1-0000-0000-0000-000000000003',
              'a1a1a1a1-0000-0000-0000-000000000005');

-- --- fixtures: feed rows (inserted as superuser — the service-role posture) --
-- f03 is a deliberate near-miss: kind 'alert' carrying a 'recovery'-shaped
-- payload. Production rows always have kind = payload.type; the divergence
-- exists purely so CHECK 3 can prove matching requires kind AND payload.
insert into public.notifications (id, user_id, kind, title, body, payload, read_at)
values
  ('f0f0f0f0-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222',
   'recovery', 'Good news — a car you were watching was recovered',
   'The Black BMW you were watching is back with its owner. Thank you for keeping an eye out.',
   '{"type":"recovery","postId":"a1a1a1a1-0000-0000-0000-000000000003"}', null),
  ('f0f0f0f0-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'recovery', 'Good news — a car you were watching was recovered',
   'The Red Toyota you were watching is back with its owner. Thank you for keeping an eye out.',
   '{"type":"recovery","postId":"a1a1a1a1-0000-0000-0000-000000000005"}', null),
  ('f0f0f0f0-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222',
   'alert', 'Stolen car reported near you',
   'A Black BMW was reported stolen in Manchester — don''t approach.',
   '{"type":"recovery","postId":"a1a1a1a1-0000-0000-0000-000000000003"}', null),
  ('f0f0f0f0-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111',
   'recovery', 'Good news — a car you were watching was recovered',
   'The Black BMW you were watching is back with its owner. Thank you for keeping an eye out.',
   '{"type":"recovery","postId":"a1a1a1a1-0000-0000-0000-000000000003"}', null),
  ('f0f0f0f0-0000-0000-0000-000000000005', '22222222-2222-2222-2222-222222222222',
   'sighting', 'New sighting reported',
   'Someone reported seeing your Black BMW — don''t approach, let the police handle it.',
   '{"type":"sighting","postId":"a1a1a1a1-0000-0000-0000-000000000003"}', null),
  ('f0f0f0f0-0000-0000-0000-000000000006', '22222222-2222-2222-2222-222222222222',
   'credited', 'You''ve earned £190.00',
   'Your sighting led to a recovery. Tell us where to send it.',
   '{"type":"credited","postId":"a1a1a1a1-0000-0000-0000-000000000003"}', now());


-- -----------------------------------------------------------------------------
-- CHECK 1 — RLS: Beth reads exactly her rows, none of anyone else's; Alex
-- sees only his; anon reads NOTHING (no grant at all, or zero rows — either
-- denial mechanism passes, both mean no data flowed).
-- -----------------------------------------------------------------------------
do $$
declare v_count int; v_foreign int;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
  set local role authenticated;
  select count(*) into v_count from public.notifications
   where id in ('f0f0f0f0-0000-0000-0000-000000000001',
                'f0f0f0f0-0000-0000-0000-000000000002',
                'f0f0f0f0-0000-0000-0000-000000000003',
                'f0f0f0f0-0000-0000-0000-000000000004',
                'f0f0f0f0-0000-0000-0000-000000000005',
                'f0f0f0f0-0000-0000-0000-000000000006');
  select count(*) into v_foreign from public.notifications
   where user_id <> '22222222-2222-2222-2222-222222222222';
  reset role;
  if v_count <> 5 then
    raise exception 'CHECK 1 FAILED: Beth sees % fixture rows — must be her 5', v_count;
  end if;
  if v_foreign <> 0 then
    raise exception 'CHECK 1 FAILED: Beth read % rows belonging to someone else', v_foreign;
  end if;

  perform set_config('request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
  set local role authenticated;
  select count(*) into v_count from public.notifications
   where id in ('f0f0f0f0-0000-0000-0000-000000000001',
                'f0f0f0f0-0000-0000-0000-000000000002',
                'f0f0f0f0-0000-0000-0000-000000000003',
                'f0f0f0f0-0000-0000-0000-000000000004',
                'f0f0f0f0-0000-0000-0000-000000000005',
                'f0f0f0f0-0000-0000-0000-000000000006');
  reset role;
  if v_count <> 1 then
    raise exception 'CHECK 1 FAILED: Alex sees % fixture rows — must be exactly his 1', v_count;
  end if;

  begin
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    set local role anon;
    select count(*) into v_count from public.notifications;
    reset role;
    if v_count <> 0 then
      raise exception 'CHECK 1 FAILED: anon read % notification rows', v_count;
    end if;
  exception when insufficient_privilege then
    null;  -- no SELECT grant at all — an even stronger denial than zero rows
  end;
end $$;

-- -----------------------------------------------------------------------------
-- CHECK 2 — mark_notification_read: Beth's own row flips exactly once
-- ({marked:true} then {marked:false} on replay); Alex calling with Beth's id
-- gets {marked:false} and her row STAYS unread (own-row scoping, no oracle).
-- -----------------------------------------------------------------------------
do $$
declare v_doc jsonb; v_read timestamptz;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
  set local role authenticated;
  v_doc := public.mark_notification_read('f0f0f0f0-0000-0000-0000-000000000005');
  reset role;
  if (v_doc->>'marked')::boolean is distinct from true then
    raise exception 'CHECK 2 FAILED: Beth could not mark her own row read';
  end if;

  perform set_config('request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
  set local role authenticated;
  v_doc := public.mark_notification_read('f0f0f0f0-0000-0000-0000-000000000005');
  reset role;
  if (v_doc->>'marked')::boolean is distinct from false then
    raise exception 'CHECK 2 FAILED: a replayed mark returned true again';
  end if;

  -- Alex vs Beth's unread row f01: same call, marks nothing.
  perform set_config('request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
  set local role authenticated;
  v_doc := public.mark_notification_read('f0f0f0f0-0000-0000-0000-000000000001');
  reset role;
  if (v_doc->>'marked')::boolean is distinct from false then
    raise exception 'CHECK 2 FAILED: Alex marked Beth''s notification';
  end if;
  select read_at into v_read from public.notifications
   where id = 'f0f0f0f0-0000-0000-0000-000000000001';
  if v_read is not null then
    raise exception 'CHECK 2 FAILED: Beth''s row was marked read by a foreign caller';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- CHECK 3 — mark_notifications_read_by_payload: exactly the caller's rows
-- matching kind AND payload — not a different payload (f02), not a different
-- kind with the same payload (f03), and never another user's identical row
-- (f04, Alex's).
-- -----------------------------------------------------------------------------
do $$
declare v_doc jsonb; v_count int;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
  set local role authenticated;
  v_doc := public.mark_notifications_read_by_payload(
    'recovery',
    '{"type":"recovery","postId":"a1a1a1a1-0000-0000-0000-000000000003"}'::jsonb);
  reset role;
  if (v_doc->>'marked')::int <> 1 then
    raise exception 'CHECK 3 FAILED: marked % rows — exactly 1 (f01) must match', v_doc->>'marked';
  end if;

  select count(*) into v_count from public.notifications
   where id = 'f0f0f0f0-0000-0000-0000-000000000001' and read_at is not null;
  if v_count <> 1 then
    raise exception 'CHECK 3 FAILED: the matching row f01 was not marked read';
  end if;
  select count(*) into v_count from public.notifications
   where id in ('f0f0f0f0-0000-0000-0000-000000000002',   -- different payload
                'f0f0f0f0-0000-0000-0000-000000000003',   -- different kind
                'f0f0f0f0-0000-0000-0000-000000000004')   -- different user
     and read_at is not null;
  if v_count <> 0 then
    raise exception 'CHECK 3 FAILED: a near-miss row was marked read (% of 3)', v_count;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- CHECK 4 — mark_all_notifications_read and unread_notifications_count agree:
-- the count says what mark_all then marks, and zero afterwards. (Beth's
-- remaining unread: f02 and f03; f06 was born read and must never be counted.)
-- -----------------------------------------------------------------------------
do $$
declare v_count int; v_doc jsonb;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
  set local role authenticated;
  v_count := public.unread_notifications_count();
  v_doc   := public.mark_all_notifications_read();
  reset role;
  if v_count <> 2 then
    raise exception 'CHECK 4 FAILED: unread count was % — must be 2 (f02, f03)', v_count;
  end if;
  if (v_doc->>'marked')::int <> v_count then
    raise exception 'CHECK 4 FAILED: mark_all marked % but the count said %', v_doc->>'marked', v_count;
  end if;

  perform set_config('request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
  set local role authenticated;
  v_count := public.unread_notifications_count();
  reset role;
  if v_count <> 0 then
    raise exception 'CHECK 4 FAILED: % unread remain after mark_all', v_count;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- CHECK 5 — claim_recovery_notifications: refuses a post not in a recovered
-- state; claims once (replay {claimed:false}); the audience is the watchers
-- and ONLY the watchers minus the owner; the copy carries make/colour but
-- never the plate; an empty audience still consumes the claim.
-- -----------------------------------------------------------------------------
do $$
declare v_doc jsonb;
begin
  -- Watchers on Beth's post ...0003: Alex, Dana, and Beth HERSELF (the insert
  -- policy allows watching your own post — the claim must exclude her).
  insert into public.watchlist_items (user_id, post_id) values
    ('11111111-1111-1111-1111-111111111111', 'a1a1a1a1-0000-0000-0000-000000000003'),
    ('44444444-4444-4444-4444-444444444444', 'a1a1a1a1-0000-0000-0000-000000000003'),
    ('22222222-2222-2222-2222-222222222222', 'a1a1a1a1-0000-0000-0000-000000000003');

  -- Not recovered yet (still active): identical refusal.
  v_doc := public.claim_recovery_notifications('a1a1a1a1-0000-0000-0000-000000000003');
  if v_doc <> jsonb_build_object('claimed', false) then
    raise exception 'CHECK 5 FAILED: an active post was claimed: %', v_doc;
  end if;

  update public.posts set status = 'recovered', recovered_at = now()
   where id = 'a1a1a1a1-0000-0000-0000-000000000003';

  v_doc := public.claim_recovery_notifications('a1a1a1a1-0000-0000-0000-000000000003');
  if (v_doc->>'claimed')::boolean is distinct from true then
    raise exception 'CHECK 5 FAILED: a recovered post could not be claimed: %', v_doc;
  end if;
  if jsonb_array_length(v_doc->'user_ids') <> 2
     or not (v_doc->'user_ids' @> '"11111111-1111-1111-1111-111111111111"'::jsonb)
     or not (v_doc->'user_ids' @> '"44444444-4444-4444-4444-444444444444"'::jsonb) then
    raise exception 'CHECK 5 FAILED: audience must be exactly Alex + Dana, got %', v_doc->'user_ids';
  end if;
  if v_doc->'user_ids' @> '"22222222-2222-2222-2222-222222222222"'::jsonb then
    raise exception 'CHECK 5 FAILED: the owner is in her own recovery audience';
  end if;
  if v_doc->>'title' <> 'Good news — a car you were watching was recovered' then
    raise exception 'CHECK 5 FAILED: title drifted: %', v_doc->>'title';
  end if;
  -- Privacy: make/colour allowed (the alert-copy line); the plate NEVER.
  if position('BD21' in (v_doc->>'body')) > 0 or position('BD21' in (v_doc->>'title')) > 0 then
    raise exception 'CHECK 5 FAILED: the plate leaked into the recovery copy';
  end if;
  if position('BMW' in (v_doc->>'body')) = 0 then
    raise exception 'CHECK 5 FAILED: body lost the make: %', v_doc->>'body';
  end if;

  -- Once only.
  v_doc := public.claim_recovery_notifications('a1a1a1a1-0000-0000-0000-000000000003');
  if v_doc <> jsonb_build_object('claimed', false) then
    raise exception 'CHECK 5 FAILED: a replayed claim re-announced: %', v_doc;
  end if;

  -- Empty audience: Carl's post ...0005 recovered with NO watchers — the
  -- claim is still consumed (claimed:true, user_ids []), so a retry cannot
  -- announce later to watchers who since arrived.
  update public.posts set status = 'recovered', recovered_at = now()
   where id = 'a1a1a1a1-0000-0000-0000-000000000005';
  v_doc := public.claim_recovery_notifications('a1a1a1a1-0000-0000-0000-000000000005');
  if (v_doc->>'claimed')::boolean is distinct from true
     or jsonb_array_length(v_doc->'user_ids') <> 0 then
    raise exception 'CHECK 5 FAILED: empty audience must still consume the claim: %', v_doc;
  end if;
  v_doc := public.claim_recovery_notifications('a1a1a1a1-0000-0000-0000-000000000005');
  if v_doc <> jsonb_build_object('claimed', false) then
    raise exception 'CHECK 5 FAILED: the empty-audience claim was not consumed';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- CHECK 6 — claim_payout_sent_notification: once-only; the title carries the
-- EXACT RECORDED transfer amount (the fixture records 18500 — deliberately
-- NOT payout_split(20000) = 19000, so a recomputation would visibly print
-- £190.00 and fail); {claimed:false} when the payment is merely held.
-- -----------------------------------------------------------------------------
do $$
declare v_doc jsonb;
begin
  -- A released payment on Carl's post ...0005 with Alex's credited sighting.
  insert into public.payments
    (post_id, stripe_payment_intent_id, status, amount_pence,
     transfer_amount_pence, platform_fee_pence)
  values
    ('a1a1a1a1-0000-0000-0000-000000000005', 'pi_test_payout_sent', 'released',
     20000, 18500, 1500);
  insert into public.sightings (id, post_id, spotter_id, status, area_label, location_unavailable)
  values ('e0e0e0e0-0000-0000-0000-000000000001', 'a1a1a1a1-0000-0000-0000-000000000005',
          '11111111-1111-1111-1111-111111111111', 'credited', 'Manchester', true);

  v_doc := public.claim_payout_sent_notification('a1a1a1a1-0000-0000-0000-000000000005');
  if (v_doc->>'claimed')::boolean is distinct from true then
    raise exception 'CHECK 6 FAILED: a released payment could not be claimed: %', v_doc;
  end if;
  if v_doc->>'title' <> 'On its way — £185.00' then
    raise exception 'CHECK 6 FAILED: title is "%" — must carry the RECORDED 18500, never a recomputed split', v_doc->>'title';
  end if;
  if v_doc->>'user_id' <> '11111111-1111-1111-1111-111111111111'
     or v_doc->>'sighting_id' <> 'e0e0e0e0-0000-0000-0000-000000000001'
     or v_doc->>'post_id' <> 'a1a1a1a1-0000-0000-0000-000000000005' then
    raise exception 'CHECK 6 FAILED: wrong recipient/subject: %', v_doc;
  end if;

  -- Once only.
  v_doc := public.claim_payout_sent_notification('a1a1a1a1-0000-0000-0000-000000000005');
  if v_doc <> jsonb_build_object('claimed', false) then
    raise exception 'CHECK 6 FAILED: a replayed payout claim returned %', v_doc;
  end if;

  -- Payment merely HELD (money has not moved): identical refusal, even with a
  -- credited sighting present.
  insert into public.payments
    (post_id, stripe_payment_intent_id, status, amount_pence)
  values
    ('a1a1a1a1-0000-0000-0000-000000000003', 'pi_test_payout_held', 'held', 20000);
  insert into public.sightings (id, post_id, spotter_id, status, area_label, location_unavailable)
  values ('e0e0e0e0-0000-0000-0000-000000000002', 'a1a1a1a1-0000-0000-0000-000000000003',
          '44444444-4444-4444-4444-444444444444', 'credited', 'Manchester', true);
  v_doc := public.claim_payout_sent_notification('a1a1a1a1-0000-0000-0000-000000000003');
  if v_doc <> jsonb_build_object('claimed', false) then
    raise exception 'CHECK 6 FAILED: a held payment produced a payout push: %', v_doc;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- CHECK 7 — grants: deny-by-default held. anon executes NOTHING here;
-- authenticated may mark and count but never claim; and no client role holds
-- any write privilege on the feed — which is also the proof that kind=
-- 'message' (whitelisted for symmetry with push_sends, never written) has no
-- grantable path into the center: only the service role can insert any kind.
-- -----------------------------------------------------------------------------
do $$
begin
  if has_function_privilege('anon', 'public.mark_notification_read(uuid)', 'execute')
     or has_function_privilege('anon', 'public.mark_notifications_read_by_payload(text, jsonb)', 'execute')
     or has_function_privilege('anon', 'public.mark_all_notifications_read()', 'execute')
     or has_function_privilege('anon', 'public.unread_notifications_count()', 'execute')
     or has_function_privilege('anon', 'public.claim_recovery_notifications(uuid)', 'execute')
     or has_function_privilege('anon', 'public.claim_payout_sent_notification(uuid)', 'execute') then
    raise exception 'CHECK 7 FAILED: anon can execute a notification-center function';
  end if;
  if has_function_privilege('authenticated', 'public.claim_recovery_notifications(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.claim_payout_sent_notification(uuid)', 'execute') then
    raise exception 'CHECK 7 FAILED: authenticated can execute a service-role-only claim';
  end if;
  if not has_function_privilege('authenticated', 'public.mark_notification_read(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.mark_notifications_read_by_payload(text, jsonb)', 'execute')
     or not has_function_privilege('authenticated', 'public.mark_all_notifications_read()', 'execute')
     or not has_function_privilege('authenticated', 'public.unread_notifications_count()', 'execute') then
    raise exception 'CHECK 7 FAILED: authenticated lost a read-marking function it needs';
  end if;

  -- The feed has NO client write path (and anon cannot even read it).
  if has_table_privilege('authenticated', 'public.notifications', 'insert')
     or has_table_privilege('authenticated', 'public.notifications', 'update')
     or has_table_privilege('authenticated', 'public.notifications', 'delete')
     or has_table_privilege('authenticated', 'public.notifications', 'truncate') then
    raise exception 'CHECK 7 FAILED: authenticated holds a write privilege on notifications';
  end if;
  if has_table_privilege('anon', 'public.notifications', 'select')
     or has_table_privilege('anon', 'public.notifications', 'insert') then
    raise exception 'CHECK 7 FAILED: anon holds a privilege on notifications';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- CHECK 8 — retention (ADR-0012 §8): purge_old_notifications deletes strictly
-- by the 90-day line — an unread 91-day row goes, a fresh read row stays —
-- and no client role can run it.
-- -----------------------------------------------------------------------------
do $$
declare v_deleted integer; v_remaining integer;
begin
  insert into public.notifications (id, user_id, kind, title, body, payload, read_at, created_at)
  values
    ('f0f0f0f0-0000-0000-0000-000000000091', '22222222-2222-2222-2222-222222222222',
     'alert', 'Old news', 'From another season.', '{"type":"alert","postId":"a1a1a1a1-0000-0000-0000-000000000003"}',
     null, now() - interval '91 days'),
    ('f0f0f0f0-0000-0000-0000-000000000092', '22222222-2222-2222-2222-222222222222',
     'alert', 'Fresh news', 'Read, but recent.', '{"type":"alert","postId":"a1a1a1a1-0000-0000-0000-000000000003"}',
     now(), now() - interval '1 day');

  v_deleted := public.purge_old_notifications();
  if v_deleted < 1 then
    raise exception 'CHECK 8 FAILED: the 91-day-old row survived the purge';
  end if;
  select count(*) into v_remaining from public.notifications
   where id = 'f0f0f0f0-0000-0000-0000-000000000091';
  if v_remaining <> 0 then
    raise exception 'CHECK 8 FAILED: the old row is still present';
  end if;
  select count(*) into v_remaining from public.notifications
   where id = 'f0f0f0f0-0000-0000-0000-000000000092';
  if v_remaining <> 1 then
    raise exception 'CHECK 8 FAILED: a fresh row was purged — retention is age-only';
  end if;
  delete from public.notifications where id = 'f0f0f0f0-0000-0000-0000-000000000092';

  if has_function_privilege('anon', 'public.purge_old_notifications()', 'execute')
     or has_function_privilege('authenticated', 'public.purge_old_notifications()', 'execute') then
    raise exception 'CHECK 8 FAILED: a client role can run the retention purge';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- CHECK 9 — get_notification_feed(): the feed read is now a SECURITY DEFINER
-- function, so `where user_id = auth.uid()` INSIDE it — not the table policy —
-- is the only thing between a caller and everyone else's inbox. CHECK 1 no
-- longer covers the path the app actually uses.
--
-- Also proves the image_url gate, which is the one place this function is
-- wider than post_photos RLS: a spotter who reported on a post keeps its photo
-- after the post stops being 'active'; someone who merely watched it does not.
-- -----------------------------------------------------------------------------
do $$
declare
  v_feed    jsonb;
  v_count   int;
  v_foreign int;
  v_image   text;
begin
  -- A photo on Carl's post, a sighting on it by Alex, and a feed row for Alex
  -- about it. Then recover the post, so plain RLS would hide the photo from
  -- everyone but Carl.
  insert into public.post_photos (id, post_id, url, position)
  values ('d0d0d0d0-0000-0000-0000-000000000001',
          'a1a1a1a1-0000-0000-0000-000000000005',
          'https://example.test/post-photos/33333333/car-0.jpg', 0);
  insert into public.sightings (id, post_id, spotter_id, status, area_label, location_unavailable)
  values ('e0e0e0e0-0000-0000-0000-000000000003', 'a1a1a1a1-0000-0000-0000-000000000005',
          '11111111-1111-1111-1111-111111111111', 'credited', 'Manchester', true);
  insert into public.notifications (id, user_id, kind, title, body, payload, read_at)
  values ('f0f0f0f0-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111',
          'credited', 'You''ve earned £185.00', 'Your sighting led to a recovery.',
          '{"type":"credited","postId":"a1a1a1a1-0000-0000-0000-000000000005"}', null);
  update public.posts set status = 'recovered', recovered_at = now()
   where id = 'a1a1a1a1-0000-0000-0000-000000000005';

  -- (a) Own rows only, through the function.
  perform set_config('request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
  set local role authenticated;
  v_feed := public.get_notification_feed();
  reset role;

  select count(*) into v_count
    from jsonb_array_elements(v_feed) e
   where e->>'id' like 'f0f0f0f0-%';
  if v_count <> 5 then
    raise exception 'CHECK 9 FAILED: Beth''s feed returned % fixture rows — must be her 5', v_count;
  end if;
  select count(*) into v_foreign
    from jsonb_array_elements(v_feed) e
   where e->>'id' in ('f0f0f0f0-0000-0000-0000-000000000004',
                      'f0f0f0f0-0000-0000-0000-000000000007');
  if v_foreign <> 0 then
    raise exception 'CHECK 9 FAILED: Beth''s feed leaked % of Alex''s rows', v_foreign;
  end if;

  -- (b) The gate OPENS for the spotter: Alex reported on the post, so he keeps
  --     its photo even though the post is no longer active.
  perform set_config('request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
  set local role authenticated;
  v_feed := public.get_notification_feed();
  reset role;
  select e->>'image_url' into v_image
    from jsonb_array_elements(v_feed) e
   where e->>'id' = 'f0f0f0f0-0000-0000-0000-000000000007';
  if v_image is null then
    raise exception 'CHECK 9 FAILED: a spotter with a sighting lost the photo on a recovered post';
  end if;

  -- (c) The gate STAYS SHUT for a mere watcher: Beth's row 02 is about the same
  --     recovered post, and she neither owns it nor reported on it.
  perform set_config('request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
  set local role authenticated;
  v_feed := public.get_notification_feed();
  reset role;
  select e->>'image_url' into v_image
    from jsonb_array_elements(v_feed) e
   where e->>'id' = 'f0f0f0f0-0000-0000-0000-000000000002';
  if v_image is not null then
    raise exception 'CHECK 9 FAILED: a watcher with no sighting was shown a recovered post''s photo';
  end if;

  -- (d) A malformed payload must degrade to a pictureless row, NEVER raise:
  --     the function is all-or-nothing, so one bad row would blank the feed.
  update public.notifications
     set payload = '{"type":"credited","postId":"not-a-uuid"}'
   where id = 'f0f0f0f0-0000-0000-0000-000000000007';
  perform set_config('request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
  set local role authenticated;
  begin
    v_feed := public.get_notification_feed();
  exception when others then
    reset role;
    raise exception 'CHECK 9 FAILED: a malformed payload raised and took the whole feed with it';
  end;
  reset role;
  select e->>'image_url' into v_image
    from jsonb_array_elements(v_feed) e
   where e->>'id' = 'f0f0f0f0-0000-0000-0000-000000000007';
  if v_image is not null then
    raise exception 'CHECK 9 FAILED: a malformed postId still resolved to a photo';
  end if;

  -- (e) Grants: anon executes nothing; authenticated needs it.
  if has_function_privilege('anon', 'public.get_notification_feed()', 'execute') then
    raise exception 'CHECK 9 FAILED: anon can execute get_notification_feed';
  end if;
  if not has_function_privilege('authenticated', 'public.get_notification_feed()', 'execute') then
    raise exception 'CHECK 9 FAILED: authenticated cannot execute the feed read it depends on';
  end if;
end $$;

-- --- housekeeping: leave the database as we found it -------------------------
delete from public.post_photos
 where id = 'd0d0d0d0-0000-0000-0000-000000000001';
delete from public.notifications
 where id in ('f0f0f0f0-0000-0000-0000-000000000001',
              'f0f0f0f0-0000-0000-0000-000000000002',
              'f0f0f0f0-0000-0000-0000-000000000003',
              'f0f0f0f0-0000-0000-0000-000000000004',
              'f0f0f0f0-0000-0000-0000-000000000005',
              'f0f0f0f0-0000-0000-0000-000000000006');
delete from public.watchlist_items
 where post_id in ('a1a1a1a1-0000-0000-0000-000000000003',
                   'a1a1a1a1-0000-0000-0000-000000000005');
delete from public.payments
 where stripe_payment_intent_id in ('pi_test_payout_sent', 'pi_test_payout_held');
delete from public.sightings
 where id in ('e0e0e0e0-0000-0000-0000-000000000001',
              'e0e0e0e0-0000-0000-0000-000000000002',
              'e0e0e0e0-0000-0000-0000-000000000003');
update public.posts
   set status = 'active', recovered_at = null, recovery_notified_at = null
 where id in ('a1a1a1a1-0000-0000-0000-000000000003',
              'a1a1a1a1-0000-0000-0000-000000000005');

select 'notification_center_verification: ALL CHECKS PASSED' as result;

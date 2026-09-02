-- =============================================================================
-- WHAT:  The liveness check. Adds posts.activated_at (trigger-maintained) and
--        three still_missing_* columns, the service-role claim that asks an
--        owner "is your car still missing?", and the owner RPC that answers.
--        Widens both kind constraints for the `still_missing` push kind.
-- WHY:   ADR-0019. The 2026-08-05 loop trace found that nothing in the system
--        requires an owner to ever finish: a post sits `active` indefinitely
--        (nothing sets `expired`), escrow sits `held` indefinitely, and the
--        dispute machinery is unreachable because create_refund_hold is only
--        ever called by OWNER-INITIATED closures. An owner who recovers their
--        car off-platform and never opens the app again strands a spotter's
--        effort and real money, permanently and quietly.
--
-- ⚠️ THIS MOVES NO MONEY, AND THAT IS THE POINT. Passive expiry was cut
--        deliberately and stays cut — DOMAIN.md:654, "nothing refunds by
--        waiting. Every refund is a human act." What was ALSO cut, and should
--        not have been, is any mechanism that asks. So: a question, three times
--        at most, and every answer routes into a path a human already drives.
--        "I've found it" goes to the existing recovery flow untouched.
--
-- ⚠️ NO post_status CHANGE. Dormancy — closing a silent post to new sightings —
--        is the natural phase 2 and is DELIBERATELY not here. 95 sites in these
--        migrations select `status = 'active'`, which is an argument FOR a new
--        enum value (it would exclude a dormant post by construction, the way
--        ADR-0018 keeps a fee out of refund queries) and simultaneously the
--        reason it needs a real audit: `send_message` raises POST_CLOSED on any
--        non-active post, so dormancy would freeze the chat to the very owner
--        we are trying to reach, and plate_available would release the plate of
--        a car that is still missing. ADR-0019 records the analysis and defers
--        the build until the telemetry sink has counted how many owners
--        actually go silent through all three asks.
--
-- ⚠️ THE 14 / 7 / 3 NUMBERS ARE A JUDGEMENT, NOT A FINDING. First ask after 14
--        days, re-ask every 7, stop after 3. They live in ONE constants block
--        in claim_still_missing_checks so a beta can move them without a
--        schema change. Confirming resets all three: an owner who answers gets
--        a full fresh cycle, not a shrinking allowance.
--
-- SAFETY NOTE ON DESTRUCTIVE STATEMENTS: two `drop constraint … / add
--        constraint` pairs on notifications.kind and push_sends.kind, both
--        WIDENING (every existing row still satisfies the new check). Four new
--        columns, all nullable or defaulted, none in any client grant. One new
--        trigger. One backfill UPDATE that writes activated_at ONLY where it is
--        null. No row is deleted and no existing value is overwritten.
--
-- LINKS: docs/decisions/ADR-0019-the-abandoned-post.md (the decision, the
--          deferred dormancy analysis, and why expires_at is untouched);
--        docs/ROADMAP.md ("Loop integrity — two holes found by the 2026-08-05
--          loop trace"), the older of which this closes;
--        supabase/functions/release-held-refunds/index.ts (the only caller of
--          the claim — the sweep that already runs hourly);
--        supabase/migrations/20260722100000_watchlist.sql (posts.closed_at —
--          the trigger-maintained-timestamp pattern this copies);
--        supabase/tests/still_missing_verification.sql.
-- =============================================================================


-- =============================================================================
-- 1. POSTS: when it went live, and the state of the ask
-- =============================================================================

alter table public.posts
  -- When the post entered `active`. The liveness clock has to start SOMEWHERE
  -- and created_at is the wrong somewhere: it is stamped when the draft is
  -- made, so a draft that sat for a month before being paid for would be asked
  -- "is it still missing?" on its first day live. Trigger-maintained below and
  -- frozen once set, exactly like closed_at.
  --
  -- Deliberately NOT derived from expires_at (create_post stamps activation +
  -- 90 days, so the arithmetic would work): ADR-0019 refuses to entrench a
  -- column that review finding #18 exists to remove.
  add column activated_at timestamptz;

alter table public.posts
  -- When the last "still missing?" ask went out. NULL = none outstanding.
  -- Non-null is ALSO what the in-app banner keys on, including after the third
  -- ask when we stop pushing — the door stays open even though we stop
  -- knocking.
  add column still_missing_asked_at timestamptz,
  -- When the owner last answered "still missing". Resets the clock.
  add column still_missing_confirmed_at timestamptz,
  -- How many asks have gone out since the last confirmation. Capped at 3.
  add column still_missing_ask_count smallint not null default 0
    constraint posts_still_missing_ask_count_chk check (still_missing_ask_count >= 0);

comment on column public.posts.activated_at is
  'When status first entered ''active''. Trigger-maintained (posts_set_activated_at); FROZEN once set. Excluded from all client grants. Anchors the ADR-0019 liveness clock — created_at cannot, because it is stamped at draft time.';
comment on column public.posts.still_missing_asked_at is
  'When the last ADR-0019 "is your car still missing?" ask was sent, or NULL if none is outstanding. Non-null drives the in-app banner, which stays after the third ask even though pushing stops. Written only by claim_still_missing_checks / confirm_still_missing.';
comment on column public.posts.still_missing_confirmed_at is
  'When the owner last answered "still missing". Resets asked_at and ask_count. Internal only: this is NOT freshness or proof and must never be shown to spotters (ADR-0019).';
comment on column public.posts.still_missing_ask_count is
  'Asks sent since the last confirmation, capped at 3 by claim_still_missing_checks. Reset to 0 by confirm_still_missing so an owner who answers gets a full fresh cycle.';

-- Partial index: the sweep asks "which active posts are due?" hourly, and only
-- posts under the cap can ever be due.
create index posts_still_missing_due_idx
  on public.posts (still_missing_asked_at, activated_at)
  where status = 'active' and still_missing_ask_count < 3;


-- =============================================================================
-- 2. TRIGGER: activated_at, written once
-- =============================================================================
-- Mirrors posts_set_closed_at, including BEFORE INSERT (a service-role row born
-- active gets a value without a second write; clients can only insert
-- status='draft' and hold no grant on this column). Set on the FIRST transition
-- into 'active' and frozen thereafter — a post that is cancelled and somehow
-- re-activated keeps its original activation, because the liveness clock is
-- about how long THIS CASE has been open, and restarting it would hand an owner
-- a way to never be asked.
--
-- Empty search_path (Supabase hardening, matches set_post_closed_at). The
-- status comparison uses an untyped string literal, which needs no search_path.
create or replace function public.set_post_activated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    -- Born active (fixtures, imports, service-role fixes) or born anything
    -- else. A supplied value is honoured on INSERT only, exactly as closed_at
    -- honours one — this is the only path a backdated fixture has.
    new.activated_at := case
                          when new.status = 'active' then coalesce(new.activated_at, now())
                          else null
                        end;
  elsif old.activated_at is not null then
    -- FROZEN. SAFETY: without this, any later write to a live post could push
    -- the anchor forward and reset the liveness clock indefinitely.
    new.activated_at := old.activated_at;
  elsif new.status = 'active' then
    new.activated_at := now();
  else
    new.activated_at := null;
  end if;
  return new;
end;
$$;

comment on function public.set_post_activated_at() is
  'Trigger function: stamps posts.activated_at on the first transition into ''active'' (or on an INSERT born active, where a supplied value is honoured) and FREEZES it thereafter, so no later write can push the ADR-0019 liveness clock forward.';

create trigger posts_set_activated_at
  before insert or update on public.posts
  for each row execute function public.set_post_activated_at();

-- Backfill: every post that is ALREADY live needs an anchor, or the sweep would
-- see NULL and never ask about a single one of them. created_at is the honest
-- one-time approximation for rows that pre-date the column, and it is used ONLY
-- here — the whole reason the column exists is that created_at is the wrong
-- anchor going forward.
--
-- Restricted to `active` on purpose: no other status is ever read by this
-- feature, and stamping closed posts would invent history for no reader.
--
-- The trigger is DISABLED for this one statement, for the same reason the
-- closed_at backfill disables its own: this UPDATE leaves old.activated_at NULL
-- and status 'active', so the trigger's own branch would overwrite the
-- created_at being set here with now(). Re-enabled immediately after.
alter table public.posts disable trigger posts_set_activated_at;
update public.posts
   set activated_at = created_at
 where activated_at is null
   and status = 'active';
alter table public.posts enable trigger posts_set_activated_at;


-- =============================================================================
-- 3. The kind vocabulary widens
-- =============================================================================
-- Both constraints together: push_sends carries the same kind and a row is
-- written there before the send, so a kind valid in one and not the other fails
-- at delivery rather than at write.
alter table public.notifications drop constraint notifications_kind_chk;
alter table public.notifications add constraint notifications_kind_chk
  check (kind in ('alert','sighting','message','recovery','credited',
                  'credited_no_reward','closed_uncredited','dispute_upheld',
                  'dispute_rejected','payout_sent','not_credited',
                  'sighting_confirmed','still_missing'));

alter table public.push_sends drop constraint push_sends_kind_chk;
alter table public.push_sends add constraint push_sends_kind_chk
  check (kind in ('alert','sighting','message','recovery','credited',
                  'credited_no_reward','closed_uncredited','dispute_upheld',
                  'dispute_rejected','payout_sent','not_credited',
                  'sighting_confirmed','still_missing'));


-- =============================================================================
-- 4. notification_category — still_missing may NOT be muted
-- =============================================================================
-- Restated in full from 20260902110000; the only change is one `when` line.
--
-- ⚠️ NULL, not a category. NULL means "always deliver". The company it keeps is
-- `sighting` and `closed_uncredited`: kinds with a consequence attached, where
-- silence costs the recipient something they cannot get back. This one is the
-- owner's own case, it is capped at three in a lifetime, and every path out of
-- it is one tap. A mutable version would need a `my_posts` preference category
-- that does not exist, and the cap is the honest protection here — not a
-- toggle a distressed owner would never find.
create or replace function public.notification_category(p_kind text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_kind
    when 'alert'               then 'alerts'
    when 'message'             then 'messages'
    when 'sighting_confirmed'  then 'my_sightings'
    when 'not_credited'        then 'my_sightings'
    when 'credited_no_reward'  then 'my_sightings'
    when 'credited'            then 'money'
    when 'payout_sent'         then 'money'
    when 'dispute_upheld'      then 'money'
    when 'dispute_rejected'    then 'money'
    when 'recovery'            then 'watched'
    else null
  end;
$$;

comment on function public.notification_category(text) is
  'Maps a notification kind to its mutable preference category, or NULL when the kind may not be muted (sighting, closed_uncredited, still_missing) or is not yet classified. NULL always means "deliver". still_missing is capped at three sends per case, which is its protection instead of a toggle.';


-- =============================================================================
-- 5. claim_still_missing_checks — the sweep's one call
-- =============================================================================
-- SERVICE ROLE ONLY. Selects the due posts, claims them all in ONE conditional
-- update, and returns the copy. Two concurrent sweeps cannot both claim the
-- same post: the update's own WHERE re-checks the due predicate, so the loser
-- returns zero rows for it.
--
-- Copy is built HERE so its privacy is DB-testable. It carries the CAR — this
-- push goes to the owner, about their own car, and "is your car still missing?"
-- with no car in it is useless to someone with two posts. It carries no plate,
-- no location, no spotter, no amount.
create or replace function public.claim_still_missing_checks(p_limit integer default 200)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- ⚠️ THE ONE CONSTANTS BLOCK. ADR-0019 records these as a judgement, not a
  -- finding: nothing in the data supports them yet. Moving them is a
  -- create-or-replace, never a schema change.
  c_first_ask_after constant interval := interval '14 days';
  c_re_ask_every    constant interval := interval '7 days';
  c_max_asks        constant smallint := 3;
  v_rows jsonb;
begin
  with due as (
    select p.id
      from public.posts p
     where p.status = 'active'
       and p.still_missing_ask_count < c_max_asks
       and p.activated_at is not null
       and case
             -- Never asked since the last confirmation: the long fuse, measured
             -- from the confirmation if there is one, else from going live.
             when p.still_missing_asked_at is null
               then coalesce(p.still_missing_confirmed_at, p.activated_at)
                      < now() - c_first_ask_after
             -- Asked and unanswered: the short fuse.
             else p.still_missing_asked_at < now() - c_re_ask_every
           end
     order by p.activated_at
     limit greatest(p_limit, 0)
  ),
  claimed as (
    update public.posts p
       set still_missing_asked_at  = now(),
           still_missing_ask_count = p.still_missing_ask_count + 1
      from due
     where p.id = due.id
       -- Re-checked inside the update: this is what makes two concurrent
       -- sweeps safe, not the select above.
       and p.status = 'active'
       and p.still_missing_ask_count < c_max_asks
    returning p.id, p.owner_id, p.make, p.model, p.colour
  )
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'post_id', c.id,
               'user_id', c.owner_id,
               'title',   'Is your ' || left(
                            trim(coalesce(c.colour, '') || ' ' ||
                                 coalesce(c.make, '')   || ' ' ||
                                 coalesce(c.model, '')),
                            48
                          ) || ' still missing?',
               -- No cheerfulness. The subject is the worst thing in this
               -- person's life and the body's whole job is to make either
               -- answer one tap away.
               'body',    'Tap to tell us — or to close your listing if it''s back.'
             )
           ),
           '[]'::jsonb
         )
    into v_rows
    from claimed c;

  return v_rows;
end $$;

comment on function public.claim_still_missing_checks(integer) is
  'ADR-0019 liveness check. Claims every ACTIVE post whose owner has been silent past the fuse (14 days from activation/confirmation, then 7 days per re-ask, max 3) and returns [{post_id,user_id,title,body}] for the caller to send. Claim and select are one statement and the update re-checks the predicate, so concurrent sweeps cannot double-ask. Moves NO money and changes no status — every answer routes to a path a human drives. Returns [] when nothing is due. SERVICE ROLE ONLY.';

revoke execute on function public.claim_still_missing_checks(integer) from public, anon, authenticated;
grant execute on function public.claim_still_missing_checks(integer) to service_role;


-- =============================================================================
-- 6. confirm_still_missing — the owner's answer
-- =============================================================================
-- "Still missing" resets the clock and the counter: an owner who answers gets a
-- full fresh cycle rather than a shrinking allowance. There is no RPC for
-- "I've found it" because there does not need to be — that button routes to the
-- recovery flow, which is unchanged and still the only thing that moves escrow.
create or replace function public.confirm_still_missing(p_post_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  update public.posts
     set still_missing_confirmed_at = now(),
         still_missing_asked_at     = null,
         still_missing_ask_count    = 0
   where id = p_post_id
     and owner_id = auth.uid()
     and status = 'active'
  returning id into v_id;

  -- One opaque token for "no such post", "not yours" and "not active" — the
  -- house rule (see open_thread's NO_SIGHTING): a distinct message for each
  -- would make this an existence oracle for post ids.
  if v_id is null then
    raise exception 'POST_NOT_FOUND';
  end if;

  return jsonb_build_object('post_id', v_id, 'confirmed', true);
end $$;

comment on function public.confirm_still_missing(uuid) is
  'The owner''s answer to the ADR-0019 liveness check: stamps still_missing_confirmed_at, clears the outstanding ask and resets the counter to 0 (a full fresh cycle, not a shrinking allowance). Scoped to auth.uid() and status=''active''. Raises NOT_AUTHENTICATED, or POST_NOT_FOUND for missing / not-yours / not-active alike — one token, no existence oracle. Moves no money and changes no status.';

revoke execute on function public.confirm_still_missing(uuid) from public, anon;
grant execute on function public.confirm_still_missing(uuid) to authenticated;


-- =============================================================================
-- 7. list_my_open_still_missing_asks — the in-app door
-- =============================================================================
-- ⚠️ THE DOOR IS THE POINT, NOT THE PUSH. Review finding #15 was
-- /sighting-dispute being reachable only by push, so a spotter who declined
-- notifications could never contest a denial. Repeating that here would be
-- worse: the audience for this ask is BY DEFINITION the person who has stopped
-- opening the app, and push is the least reliable way to reach them.
--
-- One RPC serves both surfaces — the banner on post detail (which already knows
-- its post id and filters client-side) and the buttons on the My posts row.
create or replace function public.list_my_open_still_missing_asks()
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'post_id',   p.id,
               'asked_at',  p.still_missing_asked_at,
               'ask_count', p.still_missing_ask_count
             )
             order by p.still_missing_asked_at desc
           ),
           '[]'::jsonb
         )
    from public.posts p
   where p.owner_id = auth.uid()
     and p.status = 'active'
     and p.still_missing_asked_at is not null;
$$;

comment on function public.list_my_open_still_missing_asks() is
  'The caller''s posts with an outstanding ADR-0019 liveness ask: [{post_id,asked_at,ask_count}]. Drives the in-app banner and the My posts buttons — the door that does not depend on a push arriving, which finding #15 is the lesson for. Scoped to auth.uid(); returns [] for a guest. Reveals nothing about anyone else''s posts.';

revoke execute on function public.list_my_open_still_missing_asks() from public, anon;
grant execute on function public.list_my_open_still_missing_asks() to authenticated;


-- =============================================================================
-- END OF MIGRATION
-- =============================================================================

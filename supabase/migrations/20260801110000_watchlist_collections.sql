-- =============================================================================
-- WHAT:  WATCHLIST COLLECTIONS — user-named private lists for saved posts.
--        Adds public.watchlist_collections (one row per named list) and a
--        NULLABLE public.watchlist_items.collection_id pointing at it, plus
--        three SECURITY DEFINER RPCs (create / rename / delete) and an additive
--        collection_id key on get_my_watchlist()'s payload.
-- WHY:   The watchlist is one flat list. A spotter's cars are not one flat set —
--        they belong to routes ("my commute", "near work"), and a list that
--        can't be filed by where you actually travel stops being scanned.
--        Airbnb wishlist mechanics, translated: ONE collection per saved post
--        (a move, never a copy), saving is never blocked by a choice, and cars
--        not filed anywhere sit in an implicit "Saved" bucket.
-- LINKS: docs/DOMAIN.md (the collections clause — one per post, private
--          metadata, sharing permanently OUT),
--        supabase/migrations/20260722100000_watchlist.sql (the table, the
--          see-before-act insert policy copied below, get_my_watchlist),
--        supabase/migrations/20260801100000_garage_vehicles.sql (the RPC write
--          model + the per-user-not-global uniqueness argument reused here),
--        supabase/tests/watchlist_verification.sql (CHECK 8's absence proof —
--          8(a) is rewritten by this change; see the UPDATE grant note),
--        src/features/watchlist/ (the client).
--
-- SAFETY NOTE ON DESTRUCTIVE STATEMENTS: **this migration is NOT fully
--        additive** — unlike its siblings, which all say it is. It does two
--        things a reviewer must see:
--          1. ALTERs the Tier 1 policy watchlist_items_insert_own_visible_post
--             (the see-before-act gate). The existing EXISTS block is COPIED
--             BYTE-FOR-BYTE below and only ANDed with a collection-ownership
--             clause — the visibility rule itself is untouched.
--          2. GRANTS UPDATE (collection_id) on watchlist_items to authenticated,
--             reversing that file's explicit "no UPDATE policy (and no UPDATE
--             grant): a watch has no mutable state". Justified below.
--        No table, column, policy, function or row is dropped; no data changes.
--
-- WHY THE UPDATE GRANT (the load-bearing decision):
--        "Move this car to another list" could in principle be delete+insert,
--        which is how toggling works today. It CANNOT be, for two reasons:
--          * The insert policy is a see-before-act gate. A watch on a post that
--            has since expired or been cancelled can NEVER be re-inserted — so
--            delete+insert would SILENTLY DESTROY the save on exactly the closed
--            posts the 30-day tombstone exists to preserve.
--          * created_at is the list's sort key. Re-inserting would jump the card
--            to the top of the watchlist on a mere reorganise.
--        So a move is an UPDATE. See the column-list SAFETY note on the grant.
-- =============================================================================


-- =============================================================================
-- 1. TABLE: watchlist_collections
-- A user-named private list. Not shared, not shareable — see DOMAIN.md.
-- =============================================================================
create table public.watchlist_collections (
  id         uuid primary key default gen_random_uuid(),

  -- FK to profiles, the house convention for user-owned rows. CASCADE: a
  -- collection is worthless without its owner and holds no money state. The
  -- user's watches are NOT lost with it — watchlist_items.user_id cascades from
  -- profiles independently, and collection_id is SET NULL (see §2).
  user_id    uuid not null references public.profiles (id) on delete cascade,

  -- The user's own words. Bounded exactly like vehicles.nickname; stored
  -- trimmed by the RPCs. PRIVATE free text: never logged, never in any payload
  -- that leaves the owner's session (DOMAIN.md collections clause).
  name       text not null
    constraint watchlist_collections_name_len_chk
      check (char_length(btrim(name)) between 1 and 40),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Redundant against the PK, but it is what lets watchlist_items carry a
  -- COMPOSITE foreign key on (user_id, collection_id) — see §2.
  constraint watchlist_collections_user_id_uniq unique (user_id, id)
);

-- Case-insensitive uniqueness PER USER, never global. A global unique index
-- would answer "does anyone else have a list called X?" from the constraint
-- violation alone — a cross-user oracle over private free text. It would also
-- simply be wrong: two people may both keep a list called "Home".
-- (Same argument as vehicles_user_plate_canon_uidx in 20260801100000.)
create unique index watchlist_collections_user_name_uidx
  on public.watchlist_collections (user_id, lower(btrim(name)));

create index watchlist_collections_user_id_idx
  on public.watchlist_collections (user_id);

comment on table public.watchlist_collections is
  'A user''s named private list for filing watched posts. PRIVATE: readable only by its owner, never shared or shareable (DOMAIN.md forbids exposing a watch — or a collection — to anyone but the watcher). Names are user free text and must never be logged. Written ONLY via create/rename/delete_watchlist_collection; clients hold no write grant.';
comment on column public.watchlist_collections.name is
  'The user''s own label, 1-40 chars measured trimmed. Stored trimmed. Unique per user, case-insensitively — NEVER globally (that would be a cross-user oracle).';
comment on column public.watchlist_collections.user_id is
  'Owner. The ONLY ownership gate; every policy and RPC pins it to auth.uid().';

alter table public.watchlist_collections enable row level security;

-- Explicit grants — policies are dead without them. SELECT only: every write
-- goes through a SECURITY DEFINER RPC, because the per-user cap cannot be
-- expressed in RLS. anon gets NOTHING.
grant select on public.watchlist_collections to authenticated;
grant select, insert, update, delete on public.watchlist_collections to service_role;

-- SAFETY: a user may read ONLY their own collections. Wrapped (select auth.uid())
-- for planner caching, per the house pattern.
create policy watchlist_collections_select_own
  on public.watchlist_collections
  for select
  to authenticated
  using (user_id = (select auth.uid()));

-- No INSERT/UPDATE/DELETE policy and no write grant: deliberate. Writes are
-- RPC-only (§4), so the 20-collection cap can be enforced server-side.


-- =============================================================================
-- 2. COLUMN: watchlist_items.collection_id
-- =============================================================================
-- NULLABLE on purpose, and that nullability is the whole migration strategy:
-- every existing watch is already NULL, so on first launch every user sees one
-- implicit "Saved" bucket containing exactly what they had. ZERO backfill, zero
-- seeding, nothing to get wrong. "Saved" is synthesised client-side from NULL —
-- it is not a row, cannot be renamed, and cannot be deleted.
--
-- The FK is COMPOSITE (user_id, collection_id) -> (user_id, id). That makes
-- "a watch may only point at a collection owned by the SAME user" a declarative
-- guarantee rather than something a policy predicate has to remember. The
-- policies below ALSO check it, so a cross-user attempt fails as a clean 42501
-- rather than a raw FK violation.
--
-- ON DELETE SET NULL (collection_id) — the PG15+ column-list form, required
-- here: a plain composite SET NULL would try to null user_id too, which is NOT
-- NULL, and every collection delete would error. Deleting a list therefore
-- returns its cars to "Saved" and NEVER deletes a save.
alter table public.watchlist_items
  add column collection_id uuid,
  add constraint watchlist_items_collection_fk
    foreign key (user_id, collection_id)
    references public.watchlist_collections (user_id, id)
    on delete set null (collection_id);

create index watchlist_items_user_collection_idx
  on public.watchlist_items (user_id, collection_id);

comment on column public.watchlist_items.collection_id is
  'The user''s named list this watch is filed in, or NULL for the implicit "Saved" bucket. ONE collection per saved post — the (user_id, post_id) primary key enforces that for free, so a move is an UPDATE, never a second row. Composite FK to (user_id, id) makes same-owner a declarative guarantee; ON DELETE SET NULL means deleting a list returns its cars to Saved and never destroys a save.';


-- =============================================================================
-- 3. GRANTS + POLICIES on watchlist_items
-- =============================================================================
-- Widened from insert (user_id, post_id): without collection_id in this list the
-- column is silently dropped from every client insert and every save lands in
-- "Saved" regardless of the chosen list.
grant insert (user_id, post_id, collection_id) on public.watchlist_items to authenticated;

-- SAFETY — THE COLUMN LIST IS THE CONTROL, not a tidiness preference.
-- A bare `grant update on watchlist_items` would be a COMPLETE see-before-act
-- BYPASS: watch any visible post, then `update ... set post_id = <a draft you
-- cannot read>` and you are watching a hidden post, with the insert policy never
-- consulted. post_id, user_id and created_at must NEVER appear here.
-- Asserted by CHECK 11 in supabase/tests/watchlist_verification.sql.
grant update (collection_id) on public.watchlist_items to authenticated;

-- The insert gate, now also requiring that the target collection is the
-- caller's own. The EXISTS block below is COPIED BYTE-FOR-BYTE from
-- 20260722100000 — it is the Tier 1 anti-oracle rule and must never be
-- paraphrased. Only the collection clause is new.
alter policy watchlist_items_insert_own_visible_post
  on public.watchlist_items
  with check (
    user_id = (select auth.uid())
    and (
      collection_id is null
      or exists (
        select 1 from public.watchlist_collections c
        where c.id = watchlist_items.collection_id
          and c.user_id = (select auth.uid())
      )
    )
    and exists (
      select 1 from public.posts p
      where p.id = watchlist_items.post_id
        and (
          p.status = 'active'
          or (p.status in ('recovered', 'recovered_no_spotter')
              and p.closed_at is not null
              and p.closed_at >= now() - interval '30 days')
        )
    )
  );

-- SAFETY: a move. Both USING and WITH CHECK pin user_id, so a user can neither
-- reach another user's row nor hand their own row to someone else; the
-- collection clause stops them filing into a stranger's list. Paired with the
-- column-limited grant above, this is the ONLY mutation a client can perform on
-- a watch — post_id in particular is unreachable.
create policy watchlist_items_update_own_collection
  on public.watchlist_items
  for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and (
      collection_id is null
      or exists (
        select 1 from public.watchlist_collections c
        where c.id = watchlist_items.collection_id
          and c.user_id = (select auth.uid())
      )
    )
  );


-- =============================================================================
-- 4. RPCs: create / rename / delete a collection
-- SECURITY DEFINER, owner-pinned, one opaque not-found code (no existence
-- oracle) — the update_vehicle / delete_vehicle shape from 20260801100000.
-- =============================================================================

-- The cap. Bounds an abuse loop and keeps a 2-column grid navigable. Higher
-- than the garage's 5 because this is a filing system, not a fleet register.
-- Enforced by counting the CALLER'S OWN rows only, so the count can never be a
-- signal about anybody else.
create or replace function public.create_watchlist_collection(p_name text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_owner uuid := auth.uid();
  v_name  text := btrim(coalesce(p_name, ''));
  v_id    uuid;
  v_at    timestamptz;
  v_count int;
begin
  if v_owner is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  if char_length(v_name) < 1 or char_length(v_name) > 40 then
    raise exception 'INVALID_NAME';
  end if;

  select count(*) into v_count
  from public.watchlist_collections
  where user_id = v_owner;
  if v_count >= 20 then
    raise exception 'COLLECTION_LIMIT_REACHED';
  end if;

  -- Mapped code rather than a raw 23505, so the client can say something useful.
  if exists (
    select 1 from public.watchlist_collections
    where user_id = v_owner and lower(btrim(name)) = lower(v_name)
  ) then
    raise exception 'COLLECTION_NAME_TAKEN';
  end if;

  -- created_at comes back so the client never has to invent one. It orders the
  -- grid, and a device clock that is minutes off would otherwise drop a
  -- just-made list into the middle of it.
  insert into public.watchlist_collections (user_id, name)
  values (v_owner, v_name)
  returning id, created_at into v_id, v_at;

  return jsonb_build_object('collection_id', v_id, 'name', v_name, 'created_at', v_at);
end;
$$;

comment on function public.create_watchlist_collection(text) is
  'Creates one named list for the caller. SECURITY DEFINER: user_id is pinned to auth.uid() and is not a parameter. Raises NOT_AUTHENTICATED, INVALID_NAME (1-40 trimmed), COLLECTION_LIMIT_REACHED (cap 20, counting only the caller''s own rows so it can never signal anything about another user) and COLLECTION_NAME_TAKEN (case-insensitive, per-user). Returns {"collection_id","name","created_at"}.';

create or replace function public.rename_watchlist_collection(
  p_collection_id uuid,
  p_name          text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_owner uuid := auth.uid();
  v_name  text := btrim(coalesce(p_name, ''));
  v_found uuid;
begin
  if v_owner is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  if char_length(v_name) < 1 or char_length(v_name) > 40 then
    raise exception 'INVALID_NAME';
  end if;

  -- Own + locked, else ONE opaque code: absent and not-yours are
  -- indistinguishable, so this is not an existence oracle.
  select id into v_found
  from public.watchlist_collections
  where id = p_collection_id and user_id = v_owner
  for update;
  if not found then
    raise exception 'COLLECTION_NOT_FOUND';
  end if;

  if exists (
    select 1 from public.watchlist_collections
    where user_id = v_owner
      and id <> p_collection_id
      and lower(btrim(name)) = lower(v_name)
  ) then
    raise exception 'COLLECTION_NAME_TAKEN';
  end if;

  update public.watchlist_collections
     set name = v_name, updated_at = now()
   where id = p_collection_id;

  return jsonb_build_object('collection_id', p_collection_id, 'name', v_name);
end;
$$;

comment on function public.rename_watchlist_collection(uuid, text) is
  'Renames one OWN collection. SECURITY DEFINER, owner-pinned, FOR UPDATE locked; absent-or-not-yours is a single opaque COLLECTION_NOT_FOUND (no existence oracle). Writes name + updated_at only — never user_id or id. Also raises NOT_AUTHENTICATED, INVALID_NAME, COLLECTION_NAME_TAKEN (excluding itself).';

-- Deliberately does NOT touch the items table: the composite FK's
-- ON DELETE SET NULL (collection_id) returns the cars to "Saved". That keeps
-- get_my_watchlist the ONLY function referencing it, which is what lets CHECK
-- 8(c)'s absence proof stand unchanged.
--
-- NOTE FOR ANYONE EDITING THE BODY BELOW: CHECK 8(c) greps pg_proc.prosrc, and
-- prosrc INCLUDES COMMENTS. Naming the items table inside the $$ … $$ body —
-- even in a comment explaining why you didn't query it — fails that check. That
-- is why this explanation lives out here rather than in the body.
create or replace function public.delete_watchlist_collection(p_collection_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_owner uuid := auth.uid();
  v_found uuid;
begin
  if v_owner is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select id into v_found
  from public.watchlist_collections
  where id = p_collection_id and user_id = v_owner
  for update;
  if not found then
    raise exception 'COLLECTION_NOT_FOUND';
  end if;

  -- The FK unfiles the saved cars; see the note above this function.
  delete from public.watchlist_collections where id = p_collection_id;

  return jsonb_build_object('collection_id', p_collection_id);
end;
$$;

comment on function public.delete_watchlist_collection(uuid) is
  'Deletes one OWN collection. SECURITY DEFINER, owner-pinned, FOR UPDATE locked; absent-or-not-yours is a single opaque COLLECTION_NOT_FOUND. NEVER deletes watches: the composite FK''s ON DELETE SET NULL returns them to the implicit "Saved" bucket. Deliberately does not reference watchlist_items AT ALL — that is what keeps get_my_watchlist its only referencing function, which CHECK 8(c) asserts. Returns {"collection_id"}.';

revoke execute on function public.create_watchlist_collection(text) from public;
revoke execute on function public.create_watchlist_collection(text) from anon;
grant  execute on function public.create_watchlist_collection(text) to authenticated, service_role;

revoke execute on function public.rename_watchlist_collection(uuid, text) from public;
revoke execute on function public.rename_watchlist_collection(uuid, text) from anon;
grant  execute on function public.rename_watchlist_collection(uuid, text) to authenticated, service_role;

revoke execute on function public.delete_watchlist_collection(uuid) from public;
revoke execute on function public.delete_watchlist_collection(uuid) from anon;
grant  execute on function public.delete_watchlist_collection(uuid) to authenticated, service_role;


-- =============================================================================
-- 5. get_my_watchlist() — ADDITIVE ONLY
-- =============================================================================
-- Same zero-arg signature, so this is a CREATE OR REPLACE: no DROP, no function
-- identity change, and CHECK 6's visibility matrix keeps passing untouched. The
-- ONLY change is a 'collection_id' key added to BOTH payload shapes, so the
-- client can group the single response into the grid, into each list, and into
-- the most-recently-used target — with no second RPC and no second copy of the
-- visibility rules that could drift from this one.
create or replace function public.get_my_watchlist()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_viewer uuid := auth.uid();
  v_result jsonb;
begin
  -- SAFETY: no caller identity -> nothing. Never fall through to "all rows".
  if v_viewer is null then
    return '[]'::jsonb;
  end if;

  select coalesce(jsonb_agg(t.item order by t.watched_at desc), '[]'::jsonb)
    into v_result
  from (
    select
      w.created_at as watched_at,
      case
        -- ---------------------------------------------------------------
        -- FULL PAYLOAD: active, or recovered inside the 30-day window
        -- from closed_at (mirrors recovered_at — identical to the home
        -- feed's public window). Same core shape the home feed emits,
        -- plus the watch fields. resolved_at is null while active.
        -- ---------------------------------------------------------------
        when p.status = 'active'
          or (p.status in ('recovered', 'recovered_no_spotter')
              and p.closed_at is not null
              and p.closed_at >= now() - interval '30 days')
        then public.home_feed_post_json(p, null::numeric)
             || jsonb_build_object(
                  'watched_at',    w.created_at,
                  'thumbnail_url', ph.url,
                  -- ADDED 2026-07-27 (collections): NULL = the implicit
                  -- "Saved" bucket. Additive only — nothing else changed.
                  'collection_id', w.collection_id,
                  'resolved_at',   case when p.status = 'active'
                                        then null else p.closed_at end)
        -- ---------------------------------------------------------------
        -- TOMBSTONE: expired/cancelled within 30 days of closed_at (the
        -- FROZEN transition timestamp — later writes to the closed post
        -- cannot re-extend this window). EXPLICIT NULLs for plate,
        -- bounty, and every location/time field.
        -- SAFETY: exposes less than the active-era public payload, and
        -- only to this post's own watcher. Do not widen.
        -- ---------------------------------------------------------------
        when p.status in ('expired', 'cancelled')
          and p.closed_at is not null
          and p.closed_at >= now() - interval '30 days'
        then jsonb_build_object(
               'id',                  p.id,
               'watched_at',          w.created_at,
               'status',              p.status,
               'make',                p.make,
               'model',               p.model,
               'colour',              p.colour,
               'resolved_at',         p.closed_at,
               'thumbnail_url',       ph.url,
               -- ADDED 2026-07-27 (collections). A closed car keeps its
               -- filing, so it still appears in its own list's "No longer
               -- active" section rather than jumping to Saved.
               'collection_id',       w.collection_id,
               -- Explicit NULLs: sensitive fields are tombstoned, not omitted,
               -- so the client shape stays stable and the redaction is loud.
               'plate',               null,
               'bounty_amount_pence', null,
               'last_seen_at',        null,
               'last_seen_area',      null,
               'distance_miles',      null,
               'created_at',          null)
        -- Everything else (hidden states; resolved beyond +30d) -> excluded
        -- by the WHERE below; this NULL is unreachable belt-and-braces.
        else null
      end as item
    from public.watchlist_items w
    join public.posts p on p.id = w.post_id
    -- First photo (position order) as the thumbnail; null when none.
    left join lateral (
      select pp.url
      from public.post_photos pp
      where pp.post_id = p.id
      order by pp.position
      limit 1
    ) ph on true
    where w.user_id = v_viewer               -- SAFETY: caller's rows ONLY
      and (
        p.status = 'active'
        or (p.status in ('recovered', 'recovered_no_spotter',
                         'expired', 'cancelled')
            and p.closed_at is not null
            and p.closed_at >= now() - interval '30 days')
      )
  ) t;

  return v_result;
end;
$$;

comment on function public.get_my_watchlist() is
  'The caller''s watchlist, newest watch first. SECURITY DEFINER (bypasses RLS): user_id = auth.uid() is the ONLY ownership gate; anon -> []. Live and recently-recovered posts return the full public payload; expired/cancelled posts return a REDACTED tombstone (outcome only — no plate, bounty or location) for 30 days after closed_at, and nothing at all after that. Each item carries collection_id (NULL = the implicit "Saved" bucket) so one response powers the collections grid, each list, and the most-recently-used target.';

revoke execute on function public.get_my_watchlist() from public;
grant  execute on function public.get_my_watchlist() to authenticated, service_role;

-- =============================================================================
-- END OF MIGRATION
-- =============================================================================

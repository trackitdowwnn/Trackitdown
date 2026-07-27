-- =============================================================================
-- WHAT:  Widens the THREE money-neutral per-section edit RPCs —
--          public.update_post_theft_context(uuid, text, text, text)
--          public.update_post_distinctive_features(uuid, jsonb)
--          public.update_post_description(uuid, text)
--        — so their status gate accepts 'active' as well as 'draft' and
--        'pending_verification'. Nothing else changes: same signatures, same
--        validation, same raise codes, same columns written, same grants.
-- WHY:   Live-on-payment (20260730100000) retired pending_verification — a paid
--        post now goes 'draft' -> 'active' directly. That silently stranded these
--        three sections: they were reachable only on a DRAFT, so the moment an
--        owner paid, every pencil on their own listing disappeared and they could
--        no longer correct the prose that spotters actually read. On a stolen-car
--        app that is the WRONG way round — the details worth refining ("it has a
--        cracked nearside mirror", "keys were taken") are exactly what the owner
--        remembers once the listing is live and people start looking. This is the
--        follow-up banner in src/features/vehicles/post/README.md ("live-on-payment
--        gap"), now closed.
-- LINKS: supabase/migrations/20260727130000_edit_post_sections.sql (the original
--          seven per-section RPCs — two of the three widened here),
--        supabase/migrations/20260728100000_edit_post_description.sql (the third),
--        supabase/migrations/20260730100000_live_on_payment.sql (why the gap
--          appeared: draft -> active on payment),
--        supabase/tests/edit_post_sections_verification.sql (the gate assertions),
--        src/features/vehicles/screens/PostDetailScreen.tsx (canEditSafeSection —
--          the client mirror of this gate).
--
-- SAFETY (Tier 1 — these run on a PAID post whose escrow is HELD):
--   * The widening is money-neutral BY CONSTRUCTION. Each function's UPDATE names
--     its own descriptive columns explicitly and NONE of the three ever writes
--     bounty_amount_pence, status, owner_id, or expires_at. So an 'active' post's
--     frozen escrow amount and lifecycle remain untouchable through these paths,
--     exactly as they already were for 'pending_verification'.
--   * The DRAFT-ONLY sections are deliberately NOT widened. update_post_car_details,
--     _photos, _last_seen, _bounty and _verification keep their draft-only gate —
--     identity, imagery, where the car was taken from, and the bounty must not
--     change under a live listing (a spotter matched against them; the bounty is
--     escrowed). Editing those still means deactivate + refund + repost.
--   * Owner-pinning is unchanged: owner_id = auth.uid(), FOR UPDATE locked, and a
--     miss on ANY of (exists / yours / in-gate) is the same single opaque
--     POST_NOT_EDITABLE — no existence oracle.
--   * Grants unchanged (authenticated + service_role; revoked from public/anon).
--     Re-asserted below belt-and-braces.
--   * 'pending_verification' is KEPT in every array. The enum value still exists
--     and rows may predate live-on-payment; dropping it from the gate would strand
--     any such post. This widens, it never narrows.
--
-- SAFETY NOTE ON DESTRUCTIVE STATEMENTS: none. Three CREATE OR REPLACE function
--        bodies (+ re-asserted comments/grants). No table, column, policy, index,
--        enum value, or data is dropped or altered.
-- =============================================================================

-- The one shared gate, spelled out once here for review and repeated verbatim in
-- each function below (plpgsql bodies can't share a constant):
--     status = any(array['draft', 'pending_verification', 'active']::public.post_status[])


-- =============================================================================
-- 1. update_post_theft_context   (DRAFT + PENDING_VERIFICATION + ACTIVE — SAFE)
-- =============================================================================
-- Identical to 20260727130000 §6 except the status array. Writes stolen_from /
-- keys_taken / desc_drives and nothing else.
create or replace function public.update_post_theft_context(
  p_post_id     uuid,
  p_stolen_from text,
  p_keys_taken  text,
  p_desc_drives text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_owner uuid := auth.uid();
  v_post  public.posts%rowtype;
begin
  if v_owner is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  -- SAFETY: DRAFT + PENDING_VERIFICATION + ACTIVE gate. Safe on a LIVE post because
  -- the UPDATE below touches only descriptive columns — never bounty/status/owner/
  -- expires. Own + in-gate + locked, else POST_NOT_EDITABLE.
  select * into v_post
  from public.posts p
  where p.id = p_post_id
    and p.owner_id = v_owner
    and p.status = any(array['draft', 'pending_verification', 'active']::public.post_status[])
  for update;
  if not found then
    raise exception 'POST_NOT_EDITABLE';
  end if;

  -- Constrained enums (null allowed; posts CHECK also enforces) — create_post parity.
  if p_stolen_from is not null
     and p_stolen_from not in ('driveway', 'street', 'car_park', 'other') then
    raise exception 'INVALID_STOLEN_FROM';
  end if;
  if p_keys_taken is not null
     and p_keys_taken not in ('yes', 'no', 'unknown') then
    raise exception 'INVALID_KEYS_TAKEN';
  end if;

  update public.posts set
    stolen_from = p_stolen_from,
    keys_taken  = p_keys_taken,
    desc_drives = p_desc_drives
  where id = p_post_id;

  return jsonb_build_object('post_id', p_post_id);
end;
$$;

comment on function public.update_post_theft_context(uuid, text, text, text) is
  'SAFE per-section edit allowed on an own DRAFT, PENDING_VERIFICATION or ACTIVE (live) post (else POST_NOT_EDITABLE): writes stolen_from/keys_taken/desc_drives only. INVALID_STOLEN_FROM (driveway/street/car_park/other or null); INVALID_KEYS_TAKEN (yes/no/unknown or null); desc_drives free text. Money-neutral — NEVER writes bounty/status/owner_id/expires_at — which is why it is permitted on a paid, live post. Also raises NOT_AUTHENTICATED.';

revoke execute on function public.update_post_theft_context(uuid, text, text, text) from public;
revoke execute on function public.update_post_theft_context(uuid, text, text, text) from anon;
grant  execute on function public.update_post_theft_context(uuid, text, text, text) to authenticated, service_role;


-- =============================================================================
-- 2. update_post_distinctive_features   (DRAFT + PENDING + ACTIVE — SAFE)
-- =============================================================================
-- Identical to 20260727130000 §7 except the status array. Full-replaces the
-- post_distinctive_feature child rows for THIS post and nothing else.
create or replace function public.update_post_distinctive_features(
  p_post_id              uuid,
  p_distinctive_features jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_owner        uuid := auth.uid();
  v_post         public.posts%rowtype;
  v_features     jsonb := coalesce(p_distinctive_features, '[]'::jsonb);
  v_feature      jsonb;
  v_feat_desc    text;
  v_feat_url     text;
  v_photo_url_re text := '^https?://(127\.0\.0\.1(:[0-9]+)?|[a-z0-9-]+\.supabase\.co)'
                         || '/storage/v1/object/public/post-photos/'
                         || v_owner::text || '/[^/]+$';
begin
  if v_owner is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  -- SAFETY: DRAFT + PENDING_VERIFICATION + ACTIVE gate. Safe on a LIVE post because
  -- the delete/insert below is SCOPED to this post's evidence child rows and never
  -- touches bounty/status/owner/expires. Own + in-gate + locked, else
  -- POST_NOT_EDITABLE.
  select * into v_post
  from public.posts p
  where p.id = p_post_id
    and p.owner_id = v_owner
    and p.status = any(array['draft', 'pending_verification', 'active']::public.post_status[])
  for update;
  if not found then
    raise exception 'POST_NOT_EDITABLE';
  end if;

  -- Server re-check of the jsonb array of {"photo_url","description"} objects —
  -- IDENTICAL to create_post (same raise codes). A non-array payload is malformed.
  if jsonb_typeof(v_features) <> 'array' then
    raise exception 'INVALID_DISTINCTIVE_FEATURE';
  end if;
  if jsonb_array_length(v_features) > 8 then
    raise exception 'DISTINCTIVE_FEATURES_COUNT';
  end if;
  for v_feature in select value from jsonb_array_elements(v_features) loop
    v_feat_desc := v_feature ->> 'description';
    v_feat_url  := v_feature ->> 'photo_url';
    if v_feat_desc is null
       or char_length(btrim(v_feat_desc)) < 3
       or char_length(btrim(v_feat_desc)) > 80 then
      raise exception 'INVALID_DISTINCTIVE_FEATURE';
    end if;
    if v_feat_url is null or char_length(v_feat_url) > 500
       or v_feat_url !~ v_photo_url_re then
      raise exception 'INVALID_DISTINCTIVE_PHOTO_URL';
    end if;
  end loop;

  -- Full replace, SCOPED to this post. description stored trimmed; position =
  -- ordinality-1 (0-based) — mirrors create_post.
  delete from public.post_distinctive_feature where post_id = p_post_id;
  insert into public.post_distinctive_feature (post_id, photo_url, description, position)
  select p_post_id,
         elem.value ->> 'photo_url',
         btrim(elem.value ->> 'description'),
         (elem.ord - 1)::int
  from jsonb_array_elements(v_features) with ordinality as elem(value, ord);

  return jsonb_build_object('post_id', p_post_id);
end;
$$;

comment on function public.update_post_distinctive_features(uuid, jsonb) is
  'SAFE per-section edit allowed on an own DRAFT, PENDING_VERIFICATION or ACTIVE (live) post (else POST_NOT_EDITABLE): full-replaces the post_distinctive_feature child rows (delete SCOPED to p_post_id, then reinsert with position=ordinality-1). jsonb array, <=8 (DISTINCTIVE_FEATURES_COUNT); each description 3-80 trimmed (INVALID_DISTINCTIVE_FEATURE); each photo_url an own-folder object (INVALID_DISTINCTIVE_PHOTO_URL). Money-neutral — NEVER writes bounty/status/owner_id/expires_at — which is why it is permitted on a paid, live post. Also raises NOT_AUTHENTICATED.';

revoke execute on function public.update_post_distinctive_features(uuid, jsonb) from public;
revoke execute on function public.update_post_distinctive_features(uuid, jsonb) from anon;
grant  execute on function public.update_post_distinctive_features(uuid, jsonb) to authenticated, service_role;


-- =============================================================================
-- 3. update_post_description   (DRAFT + PENDING + ACTIVE — SAFE)
-- =============================================================================
-- Identical to 20260728100000 except the status array. Writes desc_recognise and
-- nothing else.
create or replace function public.update_post_description(
  p_post_id        uuid,
  p_desc_recognise text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_owner uuid := auth.uid();
  v_post  public.posts%rowtype;
begin
  if v_owner is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  -- SAFETY: DRAFT + PENDING_VERIFICATION + ACTIVE gate (a SAFE, money-neutral
  -- section). Own + in-gate + locked, else POST_NOT_EDITABLE.
  select * into v_post
  from public.posts p
  where p.id = p_post_id
    and p.owner_id = v_owner
    and p.status = any(array['draft', 'pending_verification', 'active']::public.post_status[])
  for update;
  if not found then
    raise exception 'POST_NOT_EDITABLE';
  end if;

  -- Free-text prose; null allowed (the client trims an empty box to null). The
  -- posts.desc_recognise column CHECK (if any) enforces length.
  update public.posts set
    desc_recognise = p_desc_recognise
  where id = p_post_id;

  return jsonb_build_object('post_id', p_post_id);
end;
$$;

comment on function public.update_post_description(uuid, text) is
  'Per-section edit of the About-this-car free-text description (posts.desc_recognise). SECURITY DEFINER, owner-pinned, gated to draft + pending_verification + active (POST_NOT_EDITABLE otherwise). Writes ONLY desc_recognise — never bounty/status/owner/expires — which is why it is permitted on a paid, live post. A SAFE, money-neutral section (sibling of update_post_theft_context).';

revoke execute on function public.update_post_description(uuid, text) from public;
revoke execute on function public.update_post_description(uuid, text) from anon;
grant  execute on function public.update_post_description(uuid, text) to authenticated, service_role;

-- =============================================================================
-- END OF MIGRATION
-- =============================================================================

-- =============================================================================
-- WHAT:  Widens public.update_post_car_details(uuid, text, text, text, text, int,
--        text) so its status gate accepts 'active' (and 'pending_verification')
--        as well as 'draft'. Same signature, same MISSING_REQUIRED validation,
--        same columns written, same grants — only the gate changes.
-- WHY:   Car details were frozen the moment a post went live, so an owner who
--        typed the wrong colour or picked the wrong model had exactly one
--        remedy: deactivate, take the refund, and repost — losing the hours that
--        matter most on a stolen car. That is backwards. A WRONG detail actively
--        harms the search: spotters scan for "silver Golf" and skip the right
--        car. Letting the owner correct it is strictly better for recovery than
--        making them burn the listing. Product decision 2026-07-27.
-- LINKS: supabase/migrations/20260727130000_edit_post_sections.sql (the original
--          draft-only update_post_car_details this replaces),
--        supabase/migrations/20260731100000_edit_safe_sections_when_live.sql (the
--          sibling widening for the three prose sections; same rationale),
--        supabase/tests/edit_post_sections_verification.sql (CHECK 2/2b gates),
--        src/features/vehicles/screens/PostDetailScreen.tsx (canEditSafeSection).
--
-- SAFETY (Tier 1 — this now runs on a PAID post whose escrow is HELD):
--   * MONEY-NEUTRAL BY CONSTRUCTION, unchanged: the UPDATE names make, model,
--     colour, owner_note, year and body_type explicitly and touches nothing else.
--     bounty_amount_pence, status, owner_id and expires_at remain unwritable
--     through this path, so a live post's frozen escrow and lifecycle are safe.
--   * NOT identity laundering. plate is NOT in this function and never has been —
--     the registration, the hardest identifier to fake and the one police and
--     ANPR match on, still cannot be changed after posting by any RPC.
--   * The remaining DRAFT-ONLY functions stay draft-only: update_post_photos,
--     _last_seen, _bounty and _verification. Imagery, where the car was taken
--     from, and the escrowed amount do not move under a live listing.
--   * Abuse posture: a bait-and-switch (post one car, swap it live) stays
--     traceable — every post is a paid, card-on-file, non-anonymous account, the
--     plate is immutable, and post_flags + the deactivate/refund takedown path
--     handle it after the fact. This is the same reactive model live-on-payment
--     already chose (20260730100000).
--   * Owner-pinning unchanged: owner_id = auth.uid(), FOR UPDATE locked, and any
--     miss (absent / not yours / wrong status) is the same opaque
--     POST_NOT_EDITABLE — no existence oracle.
--   * Grants unchanged (authenticated + service_role; revoked from public/anon).
--
-- SAFETY NOTE ON DESTRUCTIVE STATEMENTS: none. One CREATE OR REPLACE function
--        body (+ re-asserted comment/grants). Nothing dropped or altered.
-- =============================================================================

create or replace function public.update_post_car_details(
  p_post_id    uuid,
  p_make       text,
  p_model      text,
  p_colour     text,
  p_owner_note text,
  p_year       int,
  p_body_type  text
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

  -- SAFETY: DRAFT + PENDING_VERIFICATION + ACTIVE gate. Safe on a LIVE post
  -- because the UPDATE below names only descriptive identity columns — never
  -- bounty/status/owner/expires, and never plate. Own + in-gate + locked, else
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

  -- Required identity (mirrors create_post's MISSING_REQUIRED for make/model/colour).
  -- Enforced on a live post too: a listing must never be edited into having no
  -- make/model/colour at all.
  if p_make is null or p_model is null or p_colour is null then
    raise exception 'MISSING_REQUIRED';
  end if;

  -- year is enforced by the posts_year_range_chk column CHECK (1900-2100), exactly
  -- as create_post enforces it — no explicit raise; the UPDATE rolls back if bad.
  update public.posts set
    make       = p_make,
    model      = p_model,
    colour     = p_colour,
    owner_note = p_owner_note,
    year       = p_year,
    body_type  = p_body_type
  where id = p_post_id;

  return jsonb_build_object('post_id', p_post_id);
end;
$$;

comment on function public.update_post_car_details(uuid, text, text, text, text, int, text) is
  'Per-section edit of the car identity, allowed on an own DRAFT, PENDING_VERIFICATION or ACTIVE (live) post (else POST_NOT_EDITABLE): writes make/model/colour/owner_note/year/body_type ONLY. MISSING_REQUIRED if make/model/colour null; year bounded by the posts_year_range_chk column CHECK. Money-neutral — never writes status/owner_id/expires_at/bounty — and never writes PLATE, which stays immutable after posting. Also raises NOT_AUTHENTICATED.';

revoke execute on function public.update_post_car_details(uuid, text, text, text, text, int, text) from public;
revoke execute on function public.update_post_car_details(uuid, text, text, text, text, int, text) from anon;
grant  execute on function public.update_post_car_details(uuid, text, text, text, text, int, text) to authenticated, service_role;

-- =============================================================================
-- END OF MIGRATION
-- =============================================================================

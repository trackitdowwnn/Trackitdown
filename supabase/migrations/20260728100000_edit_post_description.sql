-- =============================================================================
-- WHAT:  Adds public.update_post_description(p_post_id, p_desc_recognise) — the
--        eighth per-section edit RPC, for the "About this car" free-text
--        description (the posts.desc_recognise column the detail's About section
--        renders). Mirrors update_post_theft_context (20260727130000): SECURITY
--        DEFINER, owner-pinned, FOR UPDATE locked, gated to draft +
--        pending_verification, writing ONLY its one column, never
--        status/owner_id/expires_at.
-- WHY:   Every editable section on the post detail has a pencil except the
--        description; this closes that gap. The description is owner-authored,
--        money-neutral prose (not identity/bounty), and a pending_verification
--        post isn't public and is moderator-reviewed before going active — so,
--        like theft context and distinctive marks, it is a SAFE section editable
--        on a draft OR a paid (pending) post.
-- LINKS: supabase/migrations/20260727130000_edit_post_sections.sql (the seven
--          sibling per-section RPCs — this mirrors update_post_theft_context),
--        supabase/migrations/20260713180000_post_detail_structured_data.sql
--          (posts.desc_recognise + get_post_detail returns it as descRecognise),
--        src/features/vehicles/post/api/editSectionApi.ts (saveDescription).
--
-- SAFETY (Tier 1): owner-pinned via auth.uid(); DRAFT + PENDING_VERIFICATION
--        gate (→ POST_NOT_EDITABLE otherwise); writes ONLY desc_recognise — never
--        bounty_amount_pence, status, owner_id, or expires_at, so a paid post's
--        escrow/lifecycle are untouchable. Grants: authenticated + service_role
--        only (revoked from public/anon).
--
-- SAFETY NOTE ON DESTRUCTIVE STATEMENTS: none. Additive — one new function +
--        its grants. No table/column/policy/data dropped.
-- =============================================================================

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

  -- SAFETY: DRAFT + PENDING_VERIFICATION gate (a SAFE, money-neutral section).
  -- Own + in-gate + locked, else POST_NOT_EDITABLE.
  select * into v_post
  from public.posts p
  where p.id = p_post_id
    and p.owner_id = v_owner
    and p.status = any(array['draft', 'pending_verification']::public.post_status[])
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
  'Per-section edit of the About-this-car free-text description (posts.desc_recognise). SECURITY DEFINER, owner-pinned, gated to draft + pending_verification (POST_NOT_EDITABLE otherwise). Writes ONLY desc_recognise — never bounty/status/owner/expires. A SAFE, money-neutral section (sibling of update_post_theft_context).';

revoke execute on function public.update_post_description(uuid, text) from public;
revoke execute on function public.update_post_description(uuid, text) from anon;
grant  execute on function public.update_post_description(uuid, text) to authenticated, service_role;

-- =============================================================================
-- WHAT:  Drops the superseded WHOLE-POST edit RPCs — public.update_post(...) and
--        public.get_post_for_edit(uuid) — added in 20260727110000. They backed
--        the "re-open the full wizard to edit a draft" flow, which has been
--        replaced by per-section editing on the post detail screen (the seven
--        update_post_* functions in 20260727130000, prefilled from get_post_detail).
-- WHY:   Nothing calls them anymore (the client edit layer that did — editPostApi,
--        usePostForEdit, EditPostScreen, postApi.updatePost — was removed). Leaving
--        two unused money-adjacent SECURITY DEFINER functions in the schema is
--        avoidable attack/audit surface, so they're dropped. Additive per-section
--        editing (draft + safe-on-pending) fully covers the capability.
-- LINKS: supabase/migrations/20260727110000_edit_draft_post.sql (what this drops),
--        supabase/migrations/20260727130000_edit_post_sections.sql (the replacement),
--        supabase/migrations/20260727120000_post_detail_distinctive_features.sql
--          (get_post_detail now returns the marks the editors prefill from).
--
-- SAFETY NOTE ON DESTRUCTIVE STATEMENTS: this migration DROPS two FUNCTIONS
--        (update_post, get_post_for_edit). No table, column, policy, or DATA is
--        dropped — only the two now-unused RPCs. `if exists` makes it idempotent.
-- =============================================================================

drop function if exists public.update_post(
  uuid, text, text, text, text, int, text, text, text, text, text, text, text,
  timestamptz, double precision, double precision, text, int, text[], text[], text, jsonb
);

drop function if exists public.get_post_for_edit(uuid);

-- =============================================================================
-- ⚠️ COMMENTS ONLY. Two `comment on` statements. No function body, no table, no
--    policy, no grant, no data. Running this changes nothing a user can
--    observe — it changes what the database says about itself.
--
-- WHAT:  Refreshes two object comments that 20260829120000 left describing
--        behaviour it had just removed.
--
-- WHY:   That migration used `create or replace function`, which replaces a
--        body but leaves every OTHER object's comment untouched. It correctly
--        refreshed `open_thread`'s own comment and missed two more that also
--        assert the automatic system safety message:
--          · `open_thread_for_sighting` — "DELEGATES to open_thread (… system
--            safety message)"
--          · `threads.last_message_preview` — "open_thread seeds it from the
--            system message"
--        Both are live in the deployed database, and both are now false.
--
--        ⚠️ A SEPARATE MIGRATION BECAUSE 20260829120000 IS ALREADY APPLIED.
--        Editing an applied migration to correct its prose is how a repo and a
--        database start disagreeing about what ran — the failure this project
--        has hit before. History is append-only; corrections are new files.
--
-- LINKS: 20260829120000_thread_without_system_message.sql (the change these
--        describe); 20260715120000_chat.sql (where both comments were written);
--        docs/DOMAIN.md (Chat); docs/SECURITY_AND_TRUST.md §1.
-- =============================================================================

comment on function public.open_thread_for_sighting(uuid) is
  'Owner-side thread opener keyed by SIGHTING id, so an owner''s client never holds a spotter uid (SECURITY_AND_TRUST §1). Resolves (post, spotter) from the sighting server-side, checks the caller owns that post, then DELEGATES to open_thread — the single creation path: sighting gate, owner pinning, active-post CREATE gate, idempotence. ⚠️ As of 2026-08-29 that path no longer writes an automatic system safety message; a new thread opens empty.';

comment on column public.threads.last_message_preview is
  'Denormalized left(content, 140) of the latest message, maintained by send_message. ⚠️ NULL until somebody actually sends something: as of 2026-08-29 open_thread no longer writes an opening system message, so it has nothing to seed a preview from. The client renders "No messages yet" for a NULL (chat/lib/inboxModel.previewText). Threads created before that date keep the preview their system message seeded.';

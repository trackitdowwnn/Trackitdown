-- =============================================================================
-- WHAT: The avatars bucket is no longer public. Every avatar is shown through
--       a signed URL (security audit run 2, lead 2).
--
-- WHY:  An avatar lives at avatars/<uid>/avatar.jpg (CHECK-pinned,
--       20260710120000), and post-photo URLs carry the owner's uid, so a
--       public bucket let anyone — signed out included — fetch a theft
--       victim's profile photo from a listing. The app only ever shows you
--       YOUR OWN avatar; every other-user surface already withholds it.
--
-- HOW:  #284 (OTA 442a0540) made the app and export-my-data sign the URL —
--       signed URLs work on a public bucket, so that shipped first. This flips
--       the bucket. The own-folder SELECT policy (avatars_select_own_folder,
--       20260720220000) is what lets the app sign its own avatar; the service
--       role signs for the export. Objects, paths and policies are unchanged.
-- =============================================================================

update storage.buckets
   set public = false
 where id = 'avatars';

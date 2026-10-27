/**
 * WHAT:  avatarUrlFromPath — a short-lived SIGNED URL for an avatar from its
 *        stored storage PATH. A new token per fetch, so a replaced photo is
 *        never served stale.
 * WHY:   The avatar path is pinned to `<uid>/avatar.jpg`, so a public bucket
 *        let anyone holding a uid — e.g. from a post-photo URL — fetch that
 *        person's photo (security audit run 2, lead 2). The app only ever
 *        shows you YOUR OWN avatar (every other-user surface withholds it), so
 *        the bucket goes private and the own-folder SELECT policy is all a
 *        signed URL needs. The DB pins the path to the user's own folder
 *        (avatars-bucket migration CHECK), so the path is trusted.
 * LINKS: src/shared/api (supabase client); src/features/profile/api/profileApi.ts
 *        (the consumer); supabase/migrations/20260720220000_storage_select_policies_for_upsert.sql
 *        (avatars_select_own_folder).
 *
 * NOTE: import this by its direct path (`@/shared/lib/avatarUrl`), NOT via the
 * `@/shared/lib` barrel — it pulls in the supabase client, and the barrel is
 * imported by pure components whose tests would then have to mock supabase.
 */

import { supabase } from '@/shared/api';

/** Long enough to outlive a profile cached for a whole app session. */
const AVATAR_URL_TTL_SECONDS = 7 * 24 * 60 * 60;

export async function avatarUrlFromPath(path: string | null): Promise<string | null> {
  if (!path) {
    return null;
  }
  const { data, error } = await supabase.storage
    .from('avatars')
    .createSignedUrl(path, AVATAR_URL_TTL_SECONDS);
  // A missing photo or a failed sign shows the person icon, never an error.
  return error ? null : data.signedUrl;
}

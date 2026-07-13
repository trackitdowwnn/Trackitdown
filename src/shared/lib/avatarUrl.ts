/**
 * WHAT:  avatarUrlFromPath — build a public avatar URL from the stored storage
 *        PATH, cache-busted by the profile's updated_at so a replaced photo is
 *        never served stale.
 * WHY:   Two features now render other users' avatars from a path — the
 *        profile feature (public spotter sheet) and vehicles (the post-detail
 *        owner block) — so the path→URL builder lives in shared/ rather than
 *        being duplicated or cross-imported (ARCHITECTURE.md: shared when a
 *        second feature needs it). The DB pins the path to the user's own
 *        folder (avatars-bucket migration CHECK), so the path is trusted.
 * LINKS: src/shared/api (supabase client); src/features/profile/api/profileApi.ts
 *        and src/features/vehicles/api/vehicleApi.ts (consumers).
 *
 * NOTE: import this by its direct path (`@/shared/lib/avatarUrl`), NOT via the
 * `@/shared/lib` barrel — it pulls in the supabase client, and the barrel is
 * imported by pure components whose tests would then have to mock supabase.
 */

import { supabase } from '@/shared/api';

export function avatarUrlFromPath(path: string | null, updatedAt: string): string | null {
  if (!path) {
    return null;
  }
  const { data } = supabase.storage.from('avatars').getPublicUrl(path);
  return `${data.publicUrl}?v=${Date.parse(updatedAt) || 0}`;
}

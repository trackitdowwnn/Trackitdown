/**
 * WHAT:  The feed-location preference — a versioned AsyncStorage key holding
 *        where the Explore feed looks ({lat, lng, addressLabel, radiusMiles}),
 *        with zod-validated read and fail-soft write.
 * WHY:   "Set my area" on the feed must NOT touch alert settings — this is a
 *        separate, client-only preference, and the two stay independent by
 *        design (search-map README). It lives in shared/ because the
 *        notifications feature READS it to prefill the alert map for someone
 *        setting a zone for the first time; a feature-to-feature import would
 *        close a cycle, since search-map already renders the alert nudge card.
 *        A prefill is all it is — setting an alert zone never writes here, and
 *        changing the feed area never moves anyone's alert zone.
 *        Versioned key + parse-or-null read is the house pattern
 *        (src/features/auth/lib/onboardingStorage.ts): corrupt or stale
 *        storage silently falls back to the device-location chain, never
 *        traps the user.
 * LINKS: src/features/search-map/hooks/useFeedLocation.ts (owner/consumer);
 *        src/features/notifications/screens/AlertSettingsScreen.tsx (prefill);
 *        src/shared/lib/distance.ts (the radius bounds);
 *        src/features/search-map/README.md (resolution chain).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { z } from 'zod';

import { RADIUS_MAX_MILES, RADIUS_MIN_MILES } from '../distance';

/** Bump when the stored shape changes — old keys simply stop matching. */
export const FEED_LOCATION_VERSION = 1;
export const FEED_LOCATION_STORAGE_KEY = `trackitdown.feed_location_v${FEED_LOCATION_VERSION}`;

export const feedLocationPrefSchema = z.object({
  latitude: z.number().gte(-90).lte(90),
  longitude: z.number().gte(-180).lte(180),
  /** May be '' — a settled point whose geocode failed still counts. */
  addressLabel: z.string(),
  radiusMiles: z.number().min(RADIUS_MIN_MILES).max(RADIUS_MAX_MILES),
});

export type FeedLocationPref = z.infer<typeof feedLocationPrefSchema>;

/** The stored preference, or null when absent/corrupt/unreadable. */
export async function loadFeedLocationPref(): Promise<FeedLocationPref | null> {
  try {
    const raw = await AsyncStorage.getItem(FEED_LOCATION_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    return feedLocationPrefSchema.parse(JSON.parse(raw));
  } catch {
    return null; // corrupt/unreadable → fall through to the device chain
  }
}

export async function saveFeedLocationPref(pref: FeedLocationPref): Promise<void> {
  try {
    await AsyncStorage.setItem(FEED_LOCATION_STORAGE_KEY, JSON.stringify(pref));
  } catch {
    // Worst case: the feed re-resolves from the device next launch.
  }
}

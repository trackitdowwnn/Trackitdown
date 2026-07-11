/**
 * WHAT:  The feed-location preference — a versioned AsyncStorage key holding
 *        where the Explore feed looks ({lat, lng, addressLabel, radiusMiles}),
 *        with zod-validated read and fail-soft write.
 * WHY:   "Set my area" on the feed must NOT touch the (future) alert
 *        settings — this is a separate, client-only preference. Versioned
 *        key + parse-or-null read is the house pattern
 *        (src/features/auth/lib/onboardingStorage.ts): corrupt or stale
 *        storage silently falls back to the device-location chain, never
 *        traps the user. When the notifications feature ships a saved alert
 *        location, it seeds this pref — it does not replace it.
 * LINKS: src/features/search-map/hooks/useFeedLocation.ts (consumer);
 *        src/features/search-map/README.md (resolution chain).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { z } from 'zod';

import {
  FEED_RADIUS_MAX_MILES,
  FEED_RADIUS_MIN_MILES,
} from './feedConfig';

/** Bump when the stored shape changes — old keys simply stop matching. */
export const FEED_LOCATION_VERSION = 1;
export const FEED_LOCATION_STORAGE_KEY = `trackitdown.feed_location_v${FEED_LOCATION_VERSION}`;

export const feedLocationPrefSchema = z.object({
  latitude: z.number().gte(-90).lte(90),
  longitude: z.number().gte(-180).lte(180),
  /** May be '' — a settled point whose geocode failed still counts. */
  addressLabel: z.string(),
  radiusMiles: z.number().min(FEED_RADIUS_MIN_MILES).max(FEED_RADIUS_MAX_MILES),
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

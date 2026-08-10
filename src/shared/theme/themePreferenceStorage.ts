/**
 * WHAT:  The remembered appearance preference — System, Light or Dark — read on
 *        launch and written when the user changes it.
 * WHY:   Appearance.setColorScheme() is an in-memory, app-level override: it
 *        does NOT survive a restart, so without this the app would forget an
 *        explicit Light/Dark choice every cold start and silently snap back to
 *        following the phone.
 *
 *        Versioned AsyncStorage key + parse-or-fallback read is the house
 *        pattern (inboxSegmentStorage.ts, feedLocationStorage.ts,
 *        onboardingStorage.ts): corrupt, missing or unreadable storage yields
 *        'system' rather than throwing. 'system' is the right failure mode as
 *        well as the right default — it is the only value that is never wrong,
 *        because it defers to a choice the user already made on their phone.
 * LINKS: src/shared/theme/ThemeProvider.tsx (the only consumer);
 *        src/features/notifications/lib/inboxSegmentStorage.ts (the pattern).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import type { ThemePreference } from './themePreferenceTypes';

export type { ThemePreference };

const VERSION = 1;
const KEY = `trackitdown.theme_pref_v${VERSION}`;

function isPreference(value: string | null): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}

/** The stored preference, or 'system' when absent/corrupt/unreadable. */
export async function loadThemePreference(): Promise<ThemePreference> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return isPreference(raw) ? raw : 'system';
  } catch {
    return 'system';
  }
}

/**
 * Persist the choice. Fire-and-forget by design — the caller has already
 * applied it to this session, so a storage failure costs the preference at
 * next launch and nothing at all right now.
 */
export async function saveThemePreference(preference: ThemePreference): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, preference);
  } catch {
    // Swallowed deliberately; see the note above.
  }
}

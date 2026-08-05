/**
 * WHAT:  The remembered Inbox segment — which face of the tab (Messages or
 *        Notifications) the user last looked at, restored on next visit.
 * WHY:   The Airbnb inbox pattern: the tab reopens where you left it, so a
 *        notification-heavy user isn't re-routed through Messages every
 *        time. Versioned AsyncStorage key + parse-or-fallback read is the
 *        house pattern (feedLocationStorage): corrupt or stale storage
 *        silently falls back to Messages, never traps anyone.
 * LINKS: src/app/(tabs)/inbox.tsx (the consumer);
 *        src/shared/lib/location/feedLocationStorage.ts (the pattern).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

export type InboxSegment = 'messages' | 'notifications';

const VERSION = 1;
const KEY = `trackitdown.inbox_segment_v${VERSION}`;

/** The remembered segment, or 'messages' when absent/corrupt/unreadable. */
export async function loadInboxSegment(): Promise<InboxSegment> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw === 'notifications' ? 'notifications' : 'messages';
  } catch {
    return 'messages';
  }
}

/** Fail-soft: a lost write costs one wrong default, never an error. */
export async function saveInboxSegment(segment: InboxSegment): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, segment);
  } catch {
    // Storage full/unavailable — the preference simply isn't remembered.
  }
}

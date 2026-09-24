/**
 * WHAT:  useInboxBadgeSync — keeps the Inbox TAB badge right while the Inbox
 *        has never been opened. Mounted once by the tab layout; for a signed-in
 *        user it reads both unread halves (chat threads + notification center)
 *        at sign-in, whenever the app returns to the foreground, and when a
 *        push arrives, and feeds them through the inboxBadge aggregator.
 * WHY:   Tabs mount lazily, so useInbox and useNotificationCenter — until now
 *        the badge's ONLY reporters — didn't run until the owner opened the
 *        Inbox. The badge read 0 until then, which is exactly when it matters
 *        (owner report, 2026-09-24). Once the Inbox is open its own hooks keep
 *        reporting on every focus; this hook and they write the same
 *        aggregator, so the freshest report wins and neither half overwrites
 *        the other.
 *
 *        Chat owns it because chat may import notifications (never the
 *        reverse — see inboxBadge.ts).
 * LINKS: src/features/notifications/lib/inboxBadge.ts (the aggregator);
 *        src/features/chat/hooks/useInbox.ts,
 *        src/features/notifications/hooks/useNotificationCenter.ts (the
 *        Inbox's own reporters); src/app/(tabs)/_layout.tsx (the mount).
 */

import * as Notifications from 'expo-notifications';
import { useCallback, useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';

import { useSession } from '@/features/auth';
import {
  fetchUnreadNotificationCount,
  reportInboxBadge,
  resetInboxBadge,
} from '@/features/notifications';
import { useTabBadges } from '@/shared/ui';

import { fetchInbox } from '../api/chatApi';
import { totalUnread } from '../lib/inboxModel';

export function useInboxBadgeSync(): void {
  const session = useSession();
  const userId = session.status === 'signedIn' ? session.userId : null;
  const { setBadge } = useTabBadges();

  // A result is only reported for the user it was fetched for — a sign-out
  // (or account switch) mid-request must not put the old count back.
  // Declared before the effects below, so it is current when they run.
  const currentUser = useRef(userId);
  useEffect(() => {
    currentUser.current = userId;
  }, [userId]);

  const sync = useCallback(async () => {
    const forUser = currentUser.current;
    if (!forUser) return;
    const [chat, center] = await Promise.allSettled([
      fetchInbox(),
      fetchUnreadNotificationCount(),
    ]);
    if (currentUser.current !== forUser) return;
    // A failed half keeps its last known value rather than dropping to 0.
    let total: number | null = null;
    if (chat.status === 'fulfilled') {
      total = reportInboxBadge('chat', totalUnread(chat.value));
    }
    if (center.status === 'fulfilled') {
      total = reportInboxBadge('center', center.value);
    }
    if (total !== null) setBadge('inbox', total);
  }, [setBadge]);

  // Sign-in (and account switch): count straight away. Sign-out: clear, so
  // the next account never inherits the last one's number.
  useEffect(() => {
    if (session.status === 'loading') return;
    if (!userId) {
      resetInboxBadge();
      setBadge('inbox', 0);
      return;
    }
    void sync();
  }, [session.status, userId, setBadge, sync]);

  // Back from the background: messages may have arrived meanwhile.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void sync();
    });
    return () => subscription.remove();
  }, [sync]);

  // A push while the app is open is the moment the count changed.
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const subscription = Notifications.addNotificationReceivedListener(() => {
      void sync();
    });
    return () => subscription.remove();
  }, [sync]);
}

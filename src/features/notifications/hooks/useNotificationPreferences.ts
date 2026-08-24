/**
 * WHAT:  The caller's push categories, with an optimistic setter that puts the
 *        switch back if the write fails.
 * WHY:   A settings switch must never end up showing something different from
 *        what the server will actually do. Optimistic is right — a toggle that
 *        waits a round trip feels broken — but only if the rollback is real.
 * LINKS: ../api/notificationPreferencesApi.ts;
 *        ../lib/notificationPreferences.ts;
 *        src/features/profile/screens/SettingsScreen.tsx (the consumer).
 */

import { useCallback, useEffect, useState } from 'react';

import {
  fetchNotificationPreferences,
  setNotificationPreference,
} from '../api/notificationPreferencesApi';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  type NotificationCategory,
  type NotificationPreferences,
} from '../lib/notificationPreferences';

export interface NotificationPreferencesState {
  preferences: NotificationPreferences;
  /** True until the first read resolves. The switches render either way — see
   *  the note in the hook — so this is for callers that want to say so. */
  loading: boolean;
  /** Flips one category. Resolves false if the write failed and was rolled back. */
  setEnabled: (category: NotificationCategory, enabled: boolean) => Promise<boolean>;
}

export function useNotificationPreferences(): NotificationPreferencesState {
  // ⚠️ Starts at the DEFAULTS rather than null, and the switches render
  // immediately from them. Every category defaults to on, both here and in SQL,
  // so the pre-read state is not a guess — it is what a user with no stored row
  // actually has. Rendering nothing until the read lands would flash an empty
  // group into a screen whose whole content is these switches.
  const [preferences, setPreferences] = useState<NotificationPreferences>(
    DEFAULT_NOTIFICATION_PREFERENCES,
  );
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void fetchNotificationPreferences().then((next) => {
      if (cancelled) return;
      setPreferences(next);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const setEnabled = useCallback(
    async (category: NotificationCategory, enabled: boolean): Promise<boolean> => {
      // Optimistic, then rolled back on failure. The rollback is the part that
      // matters: a switch left in the position the user tapped, after a write
      // that did not land, is the screen lying about what will reach their
      // phone — and they will not find out until a notification they muted
      // arrives, or one they wanted does not.
      setPreferences((current) => ({ ...current, [category]: enabled }));
      try {
        await setNotificationPreference(category, enabled);
        return true;
      } catch {
        setPreferences((current) => ({ ...current, [category]: !enabled }));
        return false;
      }
    },
    [],
  );

  return { preferences, loading, setEnabled };
}

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

import { useCallback, useEffect, useRef, useState } from 'react';

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

/** What was read, and WHOSE it is. */
interface Store {
  userId: string | null;
  preferences: NotificationPreferences;
  loaded: boolean;
}

export function useNotificationPreferences(
  /**
   * The signed-in user's id, or null for a guest.
   *
   * ⚠️ THE ID, NOT A BOOLEAN, and the difference is a cross-user leak. Keyed on
   * a bare `enabled` flag, this state survived an account change on the same
   * handset: sign out, sign in as someone else, and the `touched` merge below
   * would write the PREVIOUS person's choices over the new user's stored ones —
   * disclosing what the last person had muted, and leaving the switches lying
   * about what reaches this phone. SECURITY_AND_TRUST already treats the shared
   * and resold handset as a real case for push_tokens; this is the same handset.
   *
   * Null also skips the read: the categories are per-account rows behind an
   * auth-pinned RPC, so a guest's read can only raise NOT_AUTHENTICATED — a
   * logged warning, once per open, for a group the screen does not render.
   */
  userId: string | null,
): NotificationPreferencesState {
  // ⚠️ The stored value carries the user it belongs to, and staleness is
  // DERIVED from that rather than cleared in an effect — clearing it there is
  // what react-hooks/set-state-in-effect rejects, and the rule is right: whose
  // data this is is a prop, not an event.
  const [store, setStore] = useState<Store>({
    userId: null,
    preferences: DEFAULT_NOTIFICATION_PREFERENCES,
    loaded: false,
  });

  const mine = store.userId === userId;
  // ⚠️ Falls back to the DEFAULTS rather than to nothing, and the switches
  // render immediately from them. Every category defaults to on, both here and
  // in SQL, so the pre-read state is not a guess — it is what a user with no
  // stored row actually has. Rendering nothing until the read lands would flash
  // an empty group into a screen whose whole content is these switches.
  const preferences = mine ? store.preferences : DEFAULT_NOTIFICATION_PREFERENCES;
  const loading = userId !== null && !(mine && store.loaded);

  // ⚠️ CATEGORIES THE USER HAS ALREADY TOUCHED THIS SESSION. Without this the
  // first read can land AFTER an optimistic write and undo it: open Settings on
  // a slow network, tap Messages off, the write succeeds — and then the read
  // issued at mount arrives carrying the OLD value and flips the switch back
  // on while the server has it off. The screen would be lying about what
  // reaches the phone, which is the exact failure this hook exists to prevent,
  // so the read must not overwrite anything the user has since decided.
  const touched = useRef(new Set<NotificationCategory>());

  useEffect(() => {
    // A plain ref assignment, not state: whatever the last account touched is
    // not this one's business.
    touched.current = new Set();
    if (userId === null) return;

    let cancelled = false;
    void fetchNotificationPreferences().then((next) => {
      if (cancelled) return;
      setStore((current) => {
        const merged = { ...next };
        // Only preserve local choices if they belong to the SAME account —
        // otherwise the previous user's decisions would overwrite this one's.
        if (current.userId === userId) {
          for (const category of touched.current) merged[category] = current.preferences[category];
        }
        return { userId, preferences: merged, loaded: true };
      });
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const setEnabled = useCallback(
    async (category: NotificationCategory, enabled: boolean): Promise<boolean> => {
      // Optimistic, then rolled back on failure. The rollback is the part that
      // matters: a switch left in the position the user tapped, after a write
      // that did not land, is the screen lying about what will reach their
      // phone — and they will not find out until a notification they muted
      // arrives, or one they wanted does not.
      touched.current.add(category);

      // The value to go back to if the write fails — captured, not assumed to
      // be `!enabled`. Those coincide for a single toggle and stop coinciding
      // the moment two writes for one category overlap, which is one impatient
      // double-tap away.
      let previous = enabled;
      setStore((current) => {
        const base = current.userId === userId ? current.preferences : preferences;
        previous = base[category];
        return { userId, preferences: { ...base, [category]: enabled }, loaded: current.loaded };
      });

      try {
        await setNotificationPreference(category, enabled);
        return true;
      } catch {
        setStore((current) =>
          // Only roll back if the account has not changed underneath us —
          // otherwise this would write a departed user's value into the new
          // one's switches.
          current.userId === userId
            ? {
                ...current,
                preferences: { ...current.preferences, [category]: previous },
              }
            : current,
        );
        return false;
      }
    },
    [userId, preferences],
  );

  return { preferences, loading, setEnabled };
}

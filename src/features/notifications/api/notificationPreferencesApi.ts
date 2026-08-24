/**
 * WHAT:  Read and write the caller's push categories — two RPCs, nothing else.
 * WHY:   `notification_preferences` has RLS enabled with NO client policies, so
 *        these SECURITY DEFINER RPCs are the only doors. That is not ceremony:
 *        being able to write another user's row would mean being able to
 *        silence their stolen-car alerts, which is a real attack rather than a
 *        theoretical one.
 * LINKS: supabase/migrations/20260824170000_notification_preferences.sql;
 *        ../lib/notificationPreferences.ts (the categories);
 *        ../hooks/useNotificationPreferences.ts (the only consumer).
 */

import { supabase } from '@/shared/api';
import { createLogger } from '@/shared/lib/logger';

import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  type NotificationCategory,
  type NotificationPreferences,
} from '../lib/notificationPreferences';

const log = createLogger('notifications');

/**
 * The caller's five categories.
 *
 * ⚠️ FAILS TO "EVERYTHING ON", matching the server's own default for a user
 * with no row. The alternative — surfacing an error state — would leave the
 * screen unable to say anything true, and defaulting to OFF would show
 * switches claiming things are muted when the server is still sending them.
 * The write path is where a failure has to be visible, because that is where
 * the user is expecting something to change.
 */
export async function fetchNotificationPreferences(): Promise<NotificationPreferences> {
  const { data, error } = await supabase.rpc('get_my_notification_preferences');

  if (error) {
    log.warn('notification_prefs_unavailable');
    return { ...DEFAULT_NOTIFICATION_PREFERENCES };
  }

  // A TABLE-returning function arrives as an array of one row.
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return { ...DEFAULT_NOTIFICATION_PREFERENCES };

  return {
    alerts: row.alerts_enabled ?? true,
    messages: row.messages_enabled ?? true,
    my_sightings: row.my_sightings_enabled ?? true,
    money: row.money_enabled ?? true,
    watched: row.watched_enabled ?? true,
  };
}

/**
 * Flip one category for the caller.
 *
 * @throws the Supabase error if the write fails. The caller MUST surface it and
 *   put the switch back — a toggle that stays flipped after a failed write is
 *   a screen telling the user something that is not true about what will reach
 *   their phone.
 */
export async function setNotificationPreference(
  category: NotificationCategory,
  enabled: boolean,
): Promise<void> {
  const { error } = await supabase.rpc('set_my_notification_preference', {
    p_category: category,
    p_enabled: enabled,
  });

  if (error) {
    // The category and the direction, never anything about the user.
    log.error('notification_pref_write_failed', { category, enabled });
    throw error;
  }

  log.info('notification_pref_set', { category, enabled });
}

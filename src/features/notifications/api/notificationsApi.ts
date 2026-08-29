/**
 * WHAT:  The notification center's data boundary — read the caller's feed
 *        rows, mark them read (one, all, or by payload for the push-tap), and
 *        count unread for the badge.
 * WHY:   THE RULE (DOMAIN.md): every notification-worthy event persists a row
 *        first, then maybe pushes — this file is the read side of that. Rows
 *        arrive with title/body denormalised at write time (what was true
 *        THEN) and the EXACT typed push payload blob, so the center renders
 *        and routes with the same tested machinery pushes use
 *        (parsePushPayload → pushRouteFor) and can never disagree with them.
 *
 *        ⚠️ THE FEED READ IS NOW AN RPC TOO (2026-08-28), and only because of
 *        the photograph. Rows still come back scoped to the caller — the
 *        function selects `user_id = auth.uid()`, which is what
 *        notifications_select_own already allowed — but a plain table select
 *        cannot reach a cover photo: `post_photos` RLS permits a client to
 *        read one only while the parent post is 'active' or it owns the post,
 *        and by the time `credited` / `payout_sent` / `not_credited` /
 *        `recovery` arrive the post is recovered and the reader is the spotter.
 *        A client-side join would have left the money notifications — the ones
 *        that matter — as the only pictureless rows in the list.
 *
 *        Every WRITE is still an RPC — the client holds no update grant, so
 *        "mark read" is the only mutation it can ever express, and only about
 *        its own rows.
 * LINKS: supabase/migrations/20260806100000_notification_center.sql;
 *        supabase/migrations/20260828120000_notification_feed_photo.sql
 *          (get_notification_feed, and why the photo is gated separately);
 *        ../lib/pushPayload.ts (parsePushPayload — the payload fence);
 *        ../lib/notificationKinds.ts; ../hooks/useNotificationCenter.ts;
 *        docs/decisions/ADR-0012-notification-center.md.
 */

import { supabase } from '@/shared/api';
import { createLogger } from '@/shared/lib/logger';

import type { NotificationKind } from '../lib/notificationKinds';
import { parsePushPayload, type PushPayload } from '../lib/pushPayload';

const log = createLogger('notifications');

/** One feed row. `payload` is already parsed through the strict schema —
 *  null means "unroutable" (an old row after a schema change): render it,
 *  but the tap goes nowhere rather than somewhere wrong. */
export interface NotificationRow {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  payload: PushPayload | null;
  readAt: string | null;
  createdAt: string;
  /**
   * Cover photo of the car this row is about, or null.
   *
   * ⚠️ NULL IS A NORMAL STATE, not a failure — the server returns it whenever
   * the caller has no standing to see that post's photo, or the row references
   * no post at all. The row falls back to its icon tile; it never shows a
   * broken or empty frame.
   *
   * ⚠️ THE MONEY KINDS DO GET A PHOTO. `credited`, `payout_sent` and
   * `not_credited` all carry a postId and go to a spotter who has a sighting on
   * that post, so the RPC's gate opens for them — which is the entire reason
   * the RPC exists rather than a client-side join. Do not "tidy" this into
   * "money rows have no photo"; that was written here once and was wrong.
   */
  imageUrl: string | null;
}

/**
 * The feed is a window, not an archive: retention is 90 days server-side, and
 * one page of the newest rows is the whole v1 surface.
 *
 * ⚠️ THE 100 NOW LIVES IN THE RPC, not here. It used to be a client `.limit()`;
 * keeping a matching constant on this side would be two numbers that must agree
 * and no mechanism to make them, which is how a client quietly starts asking
 * for a page the server does not serve. Change it in the migration.
 */
export async function fetchNotifications(): Promise<NotificationRow[]> {
  const { data, error } = await supabase.rpc('get_notification_feed');

  if (error) {
    log.warn('notifications load failed', { code: error.code });
    throw new Error('Could not load notifications');
  }

  // jsonb array in, typed rows out. A shape that isn't an array is a server
  // contract break, not a user-facing state: treat it as an empty feed rather
  // than crashing the screen.
  const rows: unknown[] = Array.isArray(data) ? data : [];

  return rows.map((entry) => {
    const row = entry as Record<string, unknown>;
    return {
      id: row.id as string,
      kind: row.kind as NotificationKind,
      title: row.title as string,
      body: row.body as string,
      payload: parsePushPayload(row.payload),
      readAt: (row.read_at as string | null) ?? null,
      createdAt: row.created_at as string,
      imageUrl: (row.image_url as string | null) ?? null,
    };
  });
}

/** Mark one row read (tap). Idempotent server-side; failures are logged and
 *  swallowed — losing a read-mark must never break a navigation. */
export async function markNotificationRead(id: string): Promise<void> {
  const { error } = await supabase.rpc('mark_notification_read', { p_notification_id: id });
  if (error) {
    log.warn('mark_notification_read failed', { code: error.code });
  }
}

/** Mark every unread row read. Returns how many flipped (for the log line). */
export async function markAllNotificationsRead(): Promise<number> {
  const { data, error } = await supabase.rpc('mark_all_notifications_read');
  if (error) {
    log.warn('mark_all_notifications_read failed', { code: error.code });
    return 0;
  }
  return Number((data as { marked?: number } | null)?.marked ?? 0);
}

/**
 * The push-tap path: the push carries no row id (its data is shared across
 * recipients), so the row is found by kind + payload equality — the caller's
 * own rows only, server-side.
 */
export async function markNotificationsReadByPayload(
  kind: NotificationKind,
  payload: PushPayload,
): Promise<void> {
  const { error } = await supabase.rpc('mark_notifications_read_by_payload', {
    p_kind: kind,
    p_payload: payload,
  });
  if (error) {
    log.warn('mark_notifications_read_by_payload failed', { code: error.code });
  }
}

/** The badge's half of the world. Cheap: a partial-index count. */
export async function fetchUnreadNotificationsCount(): Promise<number> {
  const { data, error } = await supabase.rpc('unread_notifications_count');
  if (error) {
    log.warn('unread_notifications_count failed', { code: error.code });
    return 0;
  }
  return typeof data === 'number' ? data : 0;
}

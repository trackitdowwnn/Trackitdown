/**
 * WHAT:  useNotificationCenter — loads the caller's feed, refetches on every
 *        tab focus (chat's documented freshness choice, mirrored), exposes
 *        pull-to-refresh, mark-read/mark-all with optimistic state, and feeds
 *        the center's half of the Inbox badge through the aggregator.
 * WHY:   The center is the Inbox tab's second face, so it must behave like
 *        the first: refetch-on-focus, not realtime (chat README's spec'd
 *        trade-off — a global per-user channel is a leaked-subscription risk
 *        for marginal freshness). Mark-read is optimistic because the row's
 *        visual state must settle under the user's finger; the server RPC is
 *        idempotent and a lost call costs one stale dot until the next focus.
 * LINKS: ../api/notificationsApi.ts; ../lib/inboxBadge.ts;
 *        src/features/chat/hooks/useInbox.ts (the pattern this mirrors);
 *        src/shared/ui/AppTabBar.tsx (useTabBadges).
 */

import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import { createLogger } from '@/shared/lib/logger';
import { useTabBadges } from '@/shared/ui';

import {
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationRow,
} from '../api/notificationsApi';
import { reportInboxBadge } from '../lib/inboxBadge';

const log = createLogger('notifications');

type Status = 'loading' | 'ready' | 'error';

const unreadCount = (rows: NotificationRow[]): number =>
  rows.reduce((total, row) => total + (row.readAt === null ? 1 : 0), 0);

export function useNotificationCenter() {
  const [status, setStatus] = useState<Status>('loading');
  const [rows, setRows] = useState<NotificationRow[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const { setBadge } = useTabBadges();

  // The badge DERIVES from state rather than being set alongside it: the
  // optimistic marks below use functional updates (two fast taps must not
  // lose one another), and an effect over `rows` reports whatever actually
  // won — the badge cannot drift from what the list shows.
  useEffect(() => {
    setBadge('inbox', reportInboxBadge('center', unreadCount(rows)));
  }, [rows, setBadge]);

  const publish = useCallback((next: NotificationRow[]) => {
    setRows(next);
  }, []);

  // One in-flight load at a time; focus storms collapse to one.
  const loading = useRef(false);
  const load = useCallback(
    async (mode: 'focus' | 'pull') => {
      if (loading.current) return;
      loading.current = true;
      if (mode === 'pull') setRefreshing(true);
      try {
        const next = await fetchNotifications();
        publish(next);
        setStatus('ready');
      } catch {
        // A focus refetch failing must not blank an already-shown list.
        setStatus((previous) => (previous === 'ready' ? 'ready' : 'error'));
      } finally {
        loading.current = false;
        setRefreshing(false);
      }
    },
    [publish],
  );

  // Initial load (and retry via attempt) — the house IIFE pattern.
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const next = await fetchNotifications();
        if (cancelled) return;
        publish(next);
        setStatus('ready');
      } catch {
        if (!cancelled) setStatus((previous) => (previous === 'ready' ? 'ready' : 'error'));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attempt, publish]);

  // Refetch on every RE-focus (initial load covers the first).
  const firstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      void load('focus');
    }, [load]),
  );

  /** Tap: optimistic flip + fire-and-forget RPC (idempotent server-side).
   *  Functional update — a captured-snapshot map would let two quick taps
   *  drop one another's flip. */
  const markRead = useCallback((id: string) => {
    let wasUnread = false;
    setRows((current) =>
      current.map((row) => {
        if (row.id !== id || row.readAt !== null) return row;
        wasUnread = true;
        return { ...row, readAt: new Date().toISOString() };
      }),
    );
    if (wasUnread) {
      void markNotificationRead(id);
    }
  }, []);

  /** The header affordance. Optimistic for the same settle-under-finger reason. */
  const markAllRead = useCallback(() => {
    const now = new Date().toISOString();
    setRows((current) =>
      current.map((row) => (row.readAt === null ? { ...row, readAt: now } : row)),
    );
    void markAllNotificationsRead().then((marked) => {
      log.info('mark_all_read', { marked });
    });
  }, []);

  return {
    status,
    rows,
    refreshing,
    markRead,
    markAllRead,
    refresh: useCallback(() => void load('pull'), [load]),
    retry: useCallback(() => {
      setStatus('loading');
      setAttempt((n) => n + 1);
    }, []),
  };
}

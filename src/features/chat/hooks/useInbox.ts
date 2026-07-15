/**
 * WHAT:  useInbox — loads the caller's thread list, refetches on every tab
 *        focus (the v1 freshness mechanism — no inbox realtime), exposes
 *        pull-to-refresh, and drives the Inbox tab badge with the unread
 *        total via TabBadgeProvider.
 * WHY:   v1 scale is a handful of threads: refetch-on-focus keeps the list
 *        and badge honest at every glance without a global per-user
 *        realtime channel to leak (spec'd trade-off in the feature README).
 *        Returning from a thread refocuses the tab → refetch → the read
 *        thread's row and the badge both settle without extra wiring.
 * LINKS: src/features/chat/api/chatApi.ts; src/features/chat/lib/inboxModel.ts;
 *        src/shared/ui/AppTabBar.tsx (useTabBadges);
 *        src/features/chat/README.md (Realtime & sending).
 */

import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useTabBadges } from '@/shared/ui';

import { fetchInbox } from '../api/chatApi';
import { totalUnread } from '../lib/inboxModel';
import type { InboxThread } from '../types';

type Status = 'loading' | 'ready' | 'error';

export function useInbox() {
  const [status, setStatus] = useState<Status>('loading');
  const [threads, setThreads] = useState<InboxThread[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const { setBadge } = useTabBadges();

  // One in-flight load at a time; focus storms (tab spam) collapse to one.
  const loading = useRef(false);
  const load = useCallback(
    async (mode: 'focus' | 'pull') => {
      if (loading.current) return;
      loading.current = true;
      if (mode === 'pull') setRefreshing(true);
      try {
        const rows = await fetchInbox();
        setThreads(rows);
        setStatus('ready');
        setBadge('inbox', totalUnread(rows));
      } catch {
        // A focus refetch failing must not blank an already-shown list.
        setStatus((previous) => (previous === 'ready' ? 'ready' : 'error'));
      } finally {
        loading.current = false;
        setRefreshing(false);
      }
    },
    [setBadge],
  );

  // Initial load (and retry, via attempt): house IIFE pattern — no setState
  // reachable synchronously from the effect (react-compiler rule); status
  // starts 'loading' so nothing needs pre-setting on mount.
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await fetchInbox();
        if (cancelled) return;
        setThreads(rows);
        setStatus('ready');
        setBadge('inbox', totalUnread(rows));
      } catch {
        if (!cancelled) setStatus((previous) => (previous === 'ready' ? 'ready' : 'error'));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attempt, setBadge]);

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

  return {
    status,
    threads,
    refreshing,
    refresh: useCallback(() => void load('pull'), [load]),
    retry: useCallback(() => {
      // Event handler — a synchronous status flip back to the skeleton is fine.
      setStatus('loading');
      setAttempt((n) => n + 1);
    }, []),
  };
}

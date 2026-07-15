/**
 * WHAT:  useThreadMeta — one thread's header context (the other party, the
 *        post strip, my role, the post's open/closed status), read via
 *        get_inbox and picked by id.
 * WHY:   get_inbox is the ONE privacy-shaped read for thread context
 *        (SECURITY DEFINER; the posts table's own RLS would hide a CLOSED
 *        post from the spotter, breaking read-only history). At v1 scale —
 *        a handful of threads — reusing it beats a sixth RPC; revisit if
 *        inboxes grow teeth.
 * LINKS: src/features/chat/api/chatApi.ts (fetchInbox);
 *        src/features/chat/screens/ChatThreadScreen.tsx (consumer).
 */

import { useCallback, useEffect, useState } from 'react';

import { fetchInbox } from '../api/chatApi';
import type { InboxThread } from '../types';

type Status = 'loading' | 'ready' | 'missing' | 'error';

export function useThreadMeta(threadId: string) {
  const [status, setStatus] = useState<Status>('loading');
  const [thread, setThread] = useState<InboxThread | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setStatus('loading');
        const rows = await fetchInbox();
        if (cancelled) return;
        const match = rows.find((row) => row.threadId === threadId) ?? null;
        setThread(match);
        setStatus(match ? 'ready' : 'missing');
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [threadId, attempt]);

  return { status, thread, retry: useCallback(() => setAttempt((n) => n + 1), []) };
}

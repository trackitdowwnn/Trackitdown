/**
 * WHAT:  useThreadMessages — one open thread's live state: the initial page
 *        (+ load-older), a FOCUS-SCOPED realtime subscription (subscribe on
 *        focus, clean up on blur — channels never leak), optimistic sending
 *        with per-bubble failure/retry, and read-marking on focus and on
 *        arriving messages.
 * WHY:   The optimistic contract is the feature's trust moment: a failed
 *        send NEVER drops the text — the bubble flips to 'failed' with its
 *        content intact and a retry. Realtime and the send RPC can both
 *        deliver the same row (our own message echoes back over the wire),
 *        so every insert path dedupes by id before appending.
 * LINKS: src/features/chat/api/chatApi.ts (subscription factory);
 *        src/features/chat/lib/messageGroups.ts (list building);
 *        src/features/chat/README.md (Realtime & sending).
 */

import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  fetchMessages,
  markThreadRead,
  sendMessage,
  subscribeToThreadMessages,
} from '../api/chatApi';
import { MESSAGES_PAGE_SIZE, type ChatMessage, type OutgoingMessage } from '../types';

type Status = 'loading' | 'ready' | 'error';

/** Append a message unless a row with the same id is already present. */
function appendUnique(existing: ChatMessage[], incoming: ChatMessage): ChatMessage[] {
  return existing.some((message) => message.id === incoming.id)
    ? existing
    : [...existing, incoming];
}

let localCounter = 0;
function nextLocalId(): string {
  localCounter += 1;
  return `local-${Date.now()}-${localCounter}`;
}

export function useThreadMessages(threadId: string) {
  const [status, setStatus] = useState<Status>('loading');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [outgoing, setOutgoing] = useState<OutgoingMessage[]>([]);
  const [hasOlder, setHasOlder] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  // --- Initial page ---------------------------------------------------------
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setStatus('loading');
        const page = await fetchMessages(threadId);
        if (cancelled) return;
        setMessages(page);
        setHasOlder(page.length >= MESSAGES_PAGE_SIZE);
        setStatus('ready');
        // Opening the thread reads it (non-fatal; unread self-heals).
        void markThreadRead(threadId);
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [threadId, attempt]);

  const loadOlder = useCallback(async () => {
    const oldest = messages.reduce<string | null>(
      (min, message) => (min === null || message.createdAt < min ? message.createdAt : min),
      null,
    );
    if (!oldest) return;
    try {
      const page = await fetchMessages(threadId, oldest);
      setMessages((current) => page.reduce(appendUnique, current));
      setHasOlder(page.length >= MESSAGES_PAGE_SIZE);
    } catch {
      // Older history staying unloaded is quietly retryable on next scroll.
      setHasOlder(true);
    }
  }, [threadId, messages]);

  // --- Focus-scoped realtime + catch-up --------------------------------------
  // The channel is torn down on blur, so a reply that lands while the thread
  // is backgrounded is missed by realtime. On RE-focus, refetch the latest
  // page and merge before re-subscribing (first focus is covered by the
  // initial load above). Subscribe on EVERY focus; clean up on blur.
  const firstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false;
      } else {
        (async () => {
          try {
            const page = await fetchMessages(threadId);
            setMessages((current) => page.reduce(appendUnique, current));
            void markThreadRead(threadId);
          } catch {
            // Self-heals on the next focus; realtime still covers live inserts.
          }
        })();
      }
      const cleanup = subscribeToThreadMessages(threadId, (incoming) => {
        setMessages((current) => appendUnique(current, incoming));
        // A message arriving while I'M LOOKING at the thread is read.
        void markThreadRead(threadId);
      });
      return cleanup; // blur/unmount → channel removed, never leaked
    }, [threadId]),
  );

  // --- Optimistic send ---------------------------------------------------------
  // NO single-flight gate: each bubble owns a localId and concurrent
  // send_message calls are safe server-side. A gate here silently dropped a
  // second message typed while the first was in flight (review C1) — the one
  // thing this feature must never do.

  const deliver = useCallback(
    async (localId: string, content: string) => {
      try {
        const confirmed = await sendMessage(threadId, content);
        setMessages((current) => appendUnique(current, confirmed));
        setOutgoing((current) => current.filter((entry) => entry.localId !== localId));
      } catch (error) {
        // NEVER drop the text: the bubble keeps it, flagged failed + retryable.
        setOutgoing((current) =>
          current.map((entry) =>
            entry.localId === localId ? { ...entry, state: 'failed' as const } : entry,
          ),
        );
        setSendError(error instanceof Error ? error.message : 'Something went wrong.');
      }
    },
    [threadId],
  );

  /** Queue a message optimistically. Returns false (nothing queued) for empty
   *  input, so the caller knows NOT to clear its draft. */
  const send = useCallback(
    (content: string): boolean => {
      const trimmed = content.trim();
      if (trimmed.length === 0) return false;
      setSendError(null);
      const localId = nextLocalId();
      setOutgoing((current) => [
        ...current,
        { localId, content: trimmed, createdAt: new Date().toISOString(), state: 'pending' },
      ]);
      void deliver(localId, trimmed);
      return true;
    },
    [deliver],
  );

  const retrySend = useCallback(
    (localId: string) => {
      const entry = outgoing.find((candidate) => candidate.localId === localId);
      if (!entry || entry.state !== 'failed') return; // ignore double-taps
      setSendError(null);
      setOutgoing((current) =>
        current.map((candidate) =>
          candidate.localId === localId ? { ...candidate, state: 'pending' as const } : candidate,
        ),
      );
      void deliver(localId, entry.content);
    },
    [outgoing, deliver],
  );
  // NB: the send-error banner clears at the START of the next send()/
  // retrySend() (both setSendError(null)), so a resolved failure never
  // leaves a stale banner — no separate clearing effect needed.

  return {
    status,
    messages,
    outgoing,
    hasOlder,
    sendError,
    send,
    retrySend,
    loadOlder,
    retry: useCallback(() => setAttempt((n) => n + 1), []),
  };
}

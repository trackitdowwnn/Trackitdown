/**
 * WHAT:  useThreadPeer — the other side of one thread, via the
 *        get_thread_peer RPC: their read marker (both roles) and, for the
 *        owner only, the spotter's narrow passport. Refreshed on every
 *        screen focus. Feeds the "Seen" caption and the header's
 *        tap-to-profile.
 * WHY:   The marker moves when the peer opens the thread, which by
 *        definition happens while you're away — so refetching on focus is
 *        the honest cadence, and matches how the messages themselves
 *        revalidate. Point-in-time by design: the threads table is not in
 *        the realtime publication, and "Seen" is a thread-level stamp, not
 *        a live per-message receipt.
 *
 *        Fail-soft to null. This data decorates a conversation; a failure to
 *        load it must never degrade the conversation itself ("no Seen" is
 *        indistinguishable from "not seen yet", which is honest).
 *
 *        RACE GUARD (code review C1): loaded data is KEYED by thread id and
 *        gated on return, and responses are sequence-checked. Without
 *        either, a slow response for thread A could land after a switch to
 *        thread B — rendering B's "Seen" from A's marker and, worse,
 *        opening A's peer profile from B's header.
 * LINKS: src/features/chat/api/chatApi.ts (fetchThreadPeer — the privacy
 *        contract lives on it and its migration);
 *        src/features/chat/lib/messageGroups.ts (latestSeenOutboundId);
 *        src/features/chat/hooks/useThreadMeta.ts (the same guard shape).
 */

import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useSession } from '@/features/auth';

import { fetchThreadPeer, type ThreadPeer } from '../api/chatApi';

export function useThreadPeer(threadId: string): ThreadPeer | null {
  const session = useSession();
  const signedIn = session.status === 'signedIn';

  // Loaded data is KEYED by thread id and gated on return — the house
  // pattern (useWatchlist keys by user). A stale thread's value is
  // structurally unreturnable, so a switch needs no reset dance, and no
  // effect ever calls setState synchronously.
  const [loaded, setLoaded] = useState<{ threadId: string; peer: ThreadPeer } | null>(null);

  // Bumped on every load; a response only lands if its ticket is still
  // current — an out-of-order focus refresh can't regress the marker.
  const sequence = useRef(0);

  const load = useCallback(() => {
    if (!signedIn) {
      return;
    }
    const forThread = threadId;
    const ticket = ++sequence.current;
    fetchThreadPeer(forThread)
      .then((result) => {
        if (ticket === sequence.current) {
          setLoaded({ threadId: forThread, peer: result });
        }
      })
      .catch(() => {
        // Fail-soft: the thread renders fine without Seen/profile-tap.
      });
  }, [threadId, signedIn]);

  useEffect(() => {
    load();
  }, [load]);

  // Refetch on refocus — the peer reading the thread is precisely what
  // happens while this screen is blurred. First focus is the mount load.
  const firstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      load();
    }, [load]),
  );

  return loaded?.threadId === threadId ? loaded.peer : null;
}

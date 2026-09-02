/**
 * WHAT:  useStillMissingAsk — is there an outstanding "is your car still
 *        missing?" ask on THIS post, and the call that answers it.
 * WHY:   The in-app half of ADR-0019. The banner it feeds is the door; the push
 *        is only a reminder that the door exists, which matters because the
 *        audience for the ask is by definition someone who has stopped opening
 *        the app.
 *
 *        No loading state and no error state on purpose. This rides on a screen
 *        that has its own job: until the answer arrives there is simply no
 *        banner, and a failure looks the same as "nothing to ask". The ask is a
 *        database row until it is answered, so nothing is lost by showing it a
 *        second later or on the next open.
 *
 *        ⚠️ FIRST-FOCUS GUARD, unlike usePostStats and its two siblings. Those
 *        run a mount load AND a focus load with no guard, so every open costs
 *        two round trips — the whole-app review counted eight other hooks that
 *        do have the guard and four that were missed. This one does not join
 *        the four.
 * LINKS: src/features/vehicles/api/stillMissingApi.ts;
 *        src/features/vehicles/components/StillMissingBanner.tsx;
 *        docs/decisions/ADR-0019-the-abandoned-post.md.
 */

import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  confirmStillMissing,
  listOpenStillMissingAsks,
  type StillMissingAsk,
} from '../api/stillMissingApi';

/**
 * Every outstanding ask the caller has, for My posts.
 *
 * The SECOND door, and it exists because the first one is only reachable if you
 * already know to open that post. Someone who has drifted away opens My posts,
 * not a listing they have stopped thinking about.
 */
export function useStillMissingAsks() {
  const [asks, setAsks] = useState<StillMissingAsk[]>([]);
  const seenFirstFocus = useRef(false);

  const load = useCallback(async () => {
    setAsks(await listOpenStillMissingAsks());
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const next = await listOpenStillMissingAsks();
      if (!cancelled) {
        setAsks(next);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      // Same first-focus guard as below: the mount effect already covered it.
      if (!seenFirstFocus.current) {
        seenFirstFocus.current = true;
        return;
      }
      void load();
    }, [load]),
  );

  return asks;
}

export function useStillMissingAsk(postId: string | null) {
  const [open, setOpen] = useState(false);
  const seenFirstFocus = useRef(false);

  const load = useCallback(async () => {
    if (postId === null) {
      return;
    }
    const asks = await listOpenStillMissingAsks();
    setOpen(asks.some((ask) => ask.postId === postId));
  }, [postId]);

  useEffect(() => {
    let cancelled = false;
    // All setState inside the async body — never synchronously in the effect
    // (the repo's cascading-render rule).
    (async () => {
      const asks = postId === null ? [] : await listOpenStillMissingAsks();
      if (!cancelled) {
        setOpen(asks.some((ask) => ask.postId === postId));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [postId]);

  useFocusEffect(
    useCallback(() => {
      // The mount effect above already covers the first focus; refetching here
      // would double every open.
      if (!seenFirstFocus.current) {
        seenFirstFocus.current = true;
        return;
      }
      void load();
    }, [load]),
  );

  /** Answers "still missing". Throws StillMissingError with showable copy. */
  const confirm = useCallback(async () => {
    if (postId === null) {
      return;
    }
    await confirmStillMissing(postId);
    // Optimistic only AFTER the server agreed — the banner is the record of an
    // unanswered question, so clearing it before the write lands would tell the
    // owner they had answered when they had not.
    setOpen(false);
  }, [postId]);

  return { open, confirm };
}

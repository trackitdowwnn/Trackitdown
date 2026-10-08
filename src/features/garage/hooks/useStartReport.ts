/**
 * WHAT:  useStartReport — the + button's action: wait (briefly, bounded) for
 *        the garage answer and the saved draft, then open the report with ONE
 *        navigation to /post-a-car. Ignores repeat taps while it waits.
 * WHY:   The report form should slide up already built (2026-10-07: "janky,
 *        slow and not smooth"). Its host decides chooser-or-form from the
 *        garage cache, and the form starts from the primed draft — both are
 *        synchronous only if they're known before the screen mounts. So the
 *        wait happens here, BEFORE the slide, capped at motion.skeletonGrace:
 *        usually both are already known (the tab bar warms the garage, the
 *        draft is one disk read) and the push is immediate; a slow network
 *        simply opens the host on its quiet pending stage.
 *
 *        It reads the user id at TAP time (getCurrentUserId), not from a
 *        render: behind the auth gate this runs after a guest has just signed
 *        in, from a closure created while they were still signed out.
 * LINKS: src/app/(tabs)/_layout.tsx (the + button);
 *        src/features/garage/screens/StartReportScreen.tsx (where it lands);
 *        src/features/garage/lib/loadGarage.ts (awaitGarageAnswer);
 *        src/features/vehicles/post/lib/postDraftStorage.ts (primePostDraft).
 */

import { useRouter } from 'expo-router';
import { useCallback, useRef } from 'react';

import { getCurrentUserId } from '@/features/auth';
import { primePostDraft } from '@/features/vehicles';
import { motion } from '@/shared/theme';

import { awaitGarageAnswer } from '../lib/loadGarage';

export function useStartReport(): () => void {
  const router = useRouter();
  const waitingRef = useRef(false);

  return useCallback(() => {
    if (waitingRef.current) {
      return; // a second tap while the first is still on its way
    }
    waitingRef.current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ready = Promise.all([
      awaitGarageAnswer(getCurrentUserId(), motion.skeletonGrace),
      primePostDraft(),
    ]);
    // Both are capped together: the report opens within the grace, whatever
    // is still outstanding.
    const deadline = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, motion.skeletonGrace);
    });
    void Promise.race([ready, deadline]).finally(() => {
      clearTimeout(timer);
      waitingRef.current = false;
      router.push('/post-a-car');
    });
  }, [router]);
}

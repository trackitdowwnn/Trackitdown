/**
 * WHAT:  useAfterTransition — run a callback ONCE, after the screen's own
 *        navigation transition (its slide-in) has finished; or after a
 *        fallback delay if no transition event ever arrives.
 * WHY:   Work that isn't needed on the first frame must not compete with the
 *        animation that presents the screen — the report form's slide-up was
 *        sharing its frames with Stripe's native start-up (2026-10-07: "janky,
 *        slow and not smooth"). InteractionManager can't do this any more: on
 *        RN 0.86 runAfterInteractions is a deprecation stub that runs on the
 *        next tick and never waits for a transition. The native stack's own
 *        `transitionEnd` event is the real signal; the fallback covers a
 *        screen mounted without one (a test, a nested navigator, a screen
 *        whose transition already ended).
 * LINKS: src/features/payments/BountyPaymentProvider.tsx (first consumer);
 *        src/shared/theme/motion.ts.
 */

import { useNavigation } from 'expo-router';
import { useEffect, useRef } from 'react';

/** Longest a screen waits for its transitionEnd before running anyway —
 *  longer than any push animation (iOS's custom slide-up is 500ms). */
export const AFTER_TRANSITION_FALLBACK_MS = 700;

export function useAfterTransition(callback: () => void): void {
  const navigation = useNavigation();
  const callbackRef = useRef(callback);
  useEffect(() => {
    callbackRef.current = callback;
  });

  useEffect(() => {
    let done = false;
    const run = () => {
      if (done) {
        return;
      }
      done = true;
      callbackRef.current();
    };
    // Not every navigator emits it (the type is the generic event map), so
    // it is listened for loosely and the fallback covers its absence.
    const unsubscribe = (
      navigation as unknown as {
        addListener?: (event: string, cb: (e: { data?: { closing?: boolean } }) => void) => () => void;
      }
    ).addListener?.('transitionEnd', (e) => {
      if (!e?.data?.closing) {
        run();
      }
    });
    const fallback = setTimeout(run, AFTER_TRANSITION_FALLBACK_MS);
    return () => {
      done = true;
      clearTimeout(fallback);
      unsubscribe?.();
    };
  }, [navigation]);
}

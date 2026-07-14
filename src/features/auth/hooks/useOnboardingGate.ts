/**
 * WHAT:  useOnboardingGate — resolves whether first-launch onboarding should
 *        show: 'loading' while the flag reads, then 'unseen' | 'seen'.
 * WHY:   The gate now lives inside the always-mounted AuthGate, so the seen-flag
 *        must be a LIVE source of truth: reading it once on mount would leave a
 *        just-completed onboarding still showing 'unseen', and the gate would
 *        bounce the user back to /onboarding forever. markOnboardingSeenInGate()
 *        flips an in-memory "seen this session" override SYNCHRONOUSLY (no async
 *        re-read race), so completing onboarding routes on cleanly.
 * LINKS: src/features/auth/lib/onboardingStorage.ts;
 *        src/features/auth/screens/OnboardingScreen.tsx (calls the setter);
 *        src/features/auth/components/AuthGate.tsx (consumer via useAuthGate).
 */

import { useEffect, useState, useSyncExternalStore } from 'react';

import { hasSeenOnboarding } from '../lib/onboardingStorage';

export type OnboardingGateState = 'loading' | 'unseen' | 'seen';

// In-memory override set the instant onboarding completes, so the always-mounted
// gate reads 'seen' synchronously (the persisted flag is also written, for the
// next cold start).
let seenThisSession = false;
const subscribers = new Set<() => void>();
function subscribe(cb: () => void): () => void {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}
function getSnapshot(): boolean {
  return seenThisSession;
}
/** Call right after persisting the seen-flag so the gate flips to 'seen' now. */
export function markOnboardingSeenInGate(): void {
  seenThisSession = true;
  subscribers.forEach((cb) => cb());
}

/** Reads the seen-flag on mount; the in-memory override wins once set. */
export function useOnboardingGate(): OnboardingGateState {
  const seenOverride = useSyncExternalStore(subscribe, getSnapshot);
  const [persisted, setPersisted] = useState<OnboardingGateState>('loading');

  useEffect(() => {
    let cancelled = false;
    hasSeenOnboarding().then((seen) => {
      if (!cancelled) {
        setPersisted(seen ? 'seen' : 'unseen');
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (seenOverride) return 'seen';
  return persisted;
}

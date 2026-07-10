/**
 * WHAT:  useOnboardingGate — resolves whether first-launch onboarding should
 *        show: 'loading' while the flag reads, then 'unseen' | 'seen'.
 * WHY:   The root route must not flash the home screen before redirecting to
 *        the intro (or vice versa), so the gate exposes an explicit loading
 *        state the route renders as nothing. Kept as a hook so the route file
 *        stays thin (docs/ARCHITECTURE.md rule 3).
 * LINKS: src/features/auth/lib/onboardingStorage.ts; src/app/index.tsx.
 */

import { useEffect, useState } from 'react';

import { hasSeenOnboarding } from '../lib/onboardingStorage';

export type OnboardingGateState = 'loading' | 'unseen' | 'seen';

/** Reads the seen-flag once on mount; never re-checks mid-session. */
export function useOnboardingGate(): OnboardingGateState {
  const [state, setState] = useState<OnboardingGateState>('loading');

  useEffect(() => {
    let cancelled = false;
    hasSeenOnboarding().then((seen) => {
      if (!cancelled) {
        setState(seen ? 'seen' : 'unseen');
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

/**
 * WHAT:  useSession — the app's view of the Supabase auth session: 'loading'
 *        until the persisted session is read, then 'signedIn' (with userId)
 *        or 'signedOut', staying live via onAuthStateChange.
 * WHY:   Auth owns session state (docs/ARCHITECTURE.md feature map); every
 *        other feature asks THIS hook rather than touching supabase.auth, so
 *        when real sign-in lands nothing else changes. An explicit loading
 *        state lets screens render calmly instead of flashing signed-out.
 *        Later mounts start from the last resolved session (a module
 *        snapshot), so only a cold start ever shows 'loading'.
 * LINKS: src/shared/api/supabase.ts; src/features/profile (first consumer).
 */

import { useEffect, useState } from 'react';

import { supabase } from '@/shared/api';
import { markStartup } from '@/shared/lib/startupTrace';

export type SessionState =
  | { status: 'loading'; userId: null }
  | { status: 'signedOut'; userId: null }
  | { status: 'signedIn'; userId: string };

const LOADING: SessionState = { status: 'loading', userId: null };

/**
 * The last session ANY mount resolved, so a hook mounted later (a screen
 * pushed mid-session) starts on the answer instead of a second 'loading' beat
 * — which used to put a loader on screens the user had already been signed in
 * for, during their slide-in. The very first mount of a cold start still
 * starts on 'loading': the snapshot is empty until a getSession resolves.
 */
let lastKnown: SessionState | null = null;

/** The signed-in user per the last resolved session, else null (unknown or
 *  signed out). For code that runs outside React at the moment it acts — an
 *  auth-gated intent whose closure was created while the user was a guest. */
export function getCurrentUserId(): string | null {
  return lastKnown?.status === 'signedIn' ? lastKnown.userId : null;
}

/** Test-only: forget the snapshot, so each test's first mount starts cold. */
export function resetSessionSnapshot(): void {
  lastKnown = null;
}

export function useSession(): SessionState {
  const [state, setState] = useState<SessionState>(() => lastKnown ?? LOADING);

  useEffect(() => {
    let cancelled = false;
    const apply = (userId: string | undefined) => {
      const next: SessionState = userId
        ? { status: 'signedIn', userId }
        : { status: 'signedOut', userId: null };
      lastKnown = next;
      if (!cancelled) {
        // The moment the persisted session is known either way — the end of a
        // phase that blocks the whole boot and was previously untimed.
        markStartup('session_ready');
        setState((current) =>
          // Keep the same object when nothing changed: a mount seeded from the
          // snapshot must not re-render every consumer when getSession agrees.
          current.status === next.status && current.userId === next.userId ? current : next,
        );
      }
    };

    supabase.auth
      .getSession()
      .then(({ data }) => apply(data.session?.user.id))
      .catch(() => apply(undefined)); // unreadable session → treat as signed out

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => apply(session?.user.id));

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  return state;
}

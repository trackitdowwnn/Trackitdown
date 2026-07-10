/**
 * WHAT:  useSession — the app's view of the Supabase auth session: 'loading'
 *        until the persisted session is read, then 'signedIn' (with userId)
 *        or 'signedOut', staying live via onAuthStateChange.
 * WHY:   Auth owns session state (docs/ARCHITECTURE.md feature map); every
 *        other feature asks THIS hook rather than touching supabase.auth, so
 *        when real sign-in lands nothing else changes. An explicit loading
 *        state lets screens render calmly instead of flashing signed-out.
 * LINKS: src/shared/api/supabase.ts; src/features/profile (first consumer).
 */

import { useEffect, useState } from 'react';

import { supabase } from '@/shared/api';

export type SessionState =
  | { status: 'loading'; userId: null }
  | { status: 'signedOut'; userId: null }
  | { status: 'signedIn'; userId: string };

export function useSession(): SessionState {
  const [state, setState] = useState<SessionState>({ status: 'loading', userId: null });

  useEffect(() => {
    let cancelled = false;
    const apply = (userId: string | undefined) => {
      if (!cancelled) {
        setState(
          userId ? { status: 'signedIn', userId } : { status: 'signedOut', userId: null },
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

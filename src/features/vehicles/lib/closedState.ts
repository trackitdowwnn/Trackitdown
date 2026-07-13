/**
 * WHAT:  closedStateCopy — the warm message shown when a post can't be viewed:
 *        a recovered post says so kindly; anything else (removed, or a
 *        non-active post a viewer can't see) gets a neutral "no longer active".
 * WHY:   Pure and separate from the screen so the per-status copy is unit-
 *        tested without rendering the map SDK. SAFETY: the "unavailable" branch
 *        never distinguishes draft/pending/cancelled/etc. — it says nothing
 *        about a hidden post beyond "not active".
 * LINKS: src/features/vehicles/screens/PostDetailScreen.tsx (ClosedState);
 *        src/features/vehicles/lib/closedState.test.ts.
 */

import type { PostDetailResult } from '../types';

export interface ClosedCopy {
  title: string;
  body: string;
}

export function closedStateCopy(result: PostDetailResult | null): ClosedCopy {
  if (result?.kind === 'hidden' && result.closedReason === 'recovered') {
    return {
      title: 'This car has been recovered',
      body: 'Good news — this post has closed. Thanks for keeping an eye out.',
    };
  }
  return {
    title: 'This post is no longer active',
    body: 'It may have been recovered or removed.',
  };
}

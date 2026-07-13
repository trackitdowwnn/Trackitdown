/**
 * WHAT:  Tests for closedStateCopy — a recovered hidden post reads warmly; a
 *        non-active/removed/not-found post reads neutrally, never distinguishing
 *        which non-active status it is.
 * WHY:   SAFETY: a viewer who can't see a post must learn nothing about it
 *        beyond "not active" (and, kindly, "recovered"); the neutral branch must
 *        be identical for draft/pending/cancelled/etc.
 * LINKS: src/features/vehicles/lib/closedState.ts.
 */

import { closedStateCopy } from './closedState';

describe('closedStateCopy', () => {
  it('says recovered warmly for a recovered hidden post', () => {
    const copy = closedStateCopy({ kind: 'hidden', closedReason: 'recovered' });
    expect(copy.title).toMatch(/recovered/i);
  });

  it('is neutral (no status detail) for unavailable, not-found, or null', () => {
    const neutral = /no longer active/i;
    expect(closedStateCopy({ kind: 'hidden', closedReason: 'unavailable' }).title).toMatch(neutral);
    expect(closedStateCopy({ kind: 'notFound' }).title).toMatch(neutral);
    expect(closedStateCopy(null).title).toMatch(neutral);
  });
});

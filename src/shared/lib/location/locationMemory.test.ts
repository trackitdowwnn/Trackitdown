/**
 * WHAT:  Tests for forgetLocationMemory: every registered cache is cleared,
 *        and one that throws cannot stop the rest — or the sign-out.
 * WHY:   Security review of #142: a deliberate sign-out is the hand-over
 *        point for a shared phone, and the speed caches hold that session's
 *        points and place labels.
 * LINKS: ./locationMemory.ts; src/features/profile/api/profileApi.ts.
 */

import { forgetLocationMemory, registerLocationMemory } from './locationMemory';

describe('forgetLocationMemory', () => {
  it('clears every registered cache, even when one of them throws', () => {
    const first = jest.fn(() => {
      throw new Error('boom');
    });
    const second = jest.fn();
    registerLocationMemory(first);
    registerLocationMemory(second);

    expect(() => forgetLocationMemory()).not.toThrow();
    expect(first).toHaveBeenCalled();
    expect(second).toHaveBeenCalled();
  });
});

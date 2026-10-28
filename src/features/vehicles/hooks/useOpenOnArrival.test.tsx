/**
 * WHAT:  Tests for useOpenOnArrival — opens once, only when ready, after the
 *        transition, and never again on a later re-render or reload.
 * WHY:   It drives the Manage sheet rising after a long-press on My listings.
 *        Opening on every reload (the 30s poll, each section edit) would
 *        fight the owner; opening for a non-owner is impossible only because
 *        the caller passes `ready=false` — pinned here as "not ready, no open".
 * LINKS: src/features/vehicles/hooks/useOpenOnArrival.ts, docs/TESTING.md.
 */

import { renderHook } from '@testing-library/react-native';

import { useOpenOnArrival } from './useOpenOnArrival';

// Fake timers hold the next-tick defer until settle() lets it run.
beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});

/** Let the deferred open run: fire whatever was scheduled. */
const settle = () => {
  jest.runOnlyPendingTimers();
};

describe('useOpenOnArrival', () => {
  it('does nothing while not ready', async () => {
    const open = jest.fn();
    await renderHook(() => useOpenOnArrival(false, open));
    settle();

    expect(open).not.toHaveBeenCalled();
  });

  it('opens once ready — after the transition, not during it', async () => {
    const open = jest.fn();
    await renderHook(() => useOpenOnArrival(true, open));

    expect(open).not.toHaveBeenCalled();
    settle();
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('opens when `ready` turns true later (the listing finished loading)', async () => {
    const open = jest.fn();
    const hook = await renderHook(({ ready }: { ready: boolean }) => useOpenOnArrival(ready, open), {
      initialProps: { ready: false },
    });
    settle();
    expect(open).not.toHaveBeenCalled();

    await hook.rerender({ ready: true });
    settle();
    expect(open).toHaveBeenCalledTimes(1);
  });

  // The 30s poll and every section edit reload the post; the sheet must
  // not rise again each time.
  it('never opens a second time, even if `ready` drops and returns', async () => {
    const open = jest.fn();
    const hook = await renderHook(({ ready }: { ready: boolean }) => useOpenOnArrival(ready, open), {
      initialProps: { ready: true },
    });
    settle();

    await hook.rerender({ ready: false });
    await hook.rerender({ ready: true });
    settle();

    expect(open).toHaveBeenCalledTimes(1);
  });

  it('cancels a scheduled open if it unmounts first', async () => {
    const open = jest.fn();
    const hook = await renderHook(() => useOpenOnArrival(true, open));

    await hook.unmount();

    // Cancelled: once its tick comes, the open does not run.
    settle();
    expect(open).not.toHaveBeenCalled();
  });
});

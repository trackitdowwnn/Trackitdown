/**
 * WHAT:  Tests for useOpenOnArrival — opens once, only when ready, after the
 *        transition, and never again on a later re-render or reload.
 * WHY:   It drives the Manage sheet rising after a long-press on My listings.
 *        Opening on every reload (pull-to-refresh, each section edit) would
 *        fight the owner; opening for a non-owner is impossible only because
 *        the caller passes `ready=false` — pinned here as "not ready, no open".
 * LINKS: src/features/vehicles/hooks/useOpenOnArrival.ts, docs/TESTING.md.
 */

import { renderHook } from '@testing-library/react-native';
import { InteractionManager } from 'react-native';

import { useOpenOnArrival } from './useOpenOnArrival';

type Task = () => void;
let pending: Task[] = [];
const cancel = jest.fn();

beforeEach(() => {
  pending = [];
  cancel.mockClear();
  jest.spyOn(InteractionManager, 'runAfterInteractions').mockImplementation(((task: Task) => {
    pending.push(task);
    return { cancel, then: jest.fn(), done: jest.fn() };
  }) as never);
});
afterEach(() => {
  jest.restoreAllMocks();
});

/** Let the "transition" finish: run whatever was scheduled. */
const settle = () => {
  const tasks = pending;
  pending = [];
  tasks.forEach((task) => task());
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

  // Pull-to-refresh and every section edit reload the post; the sheet must
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

    expect(cancel).toHaveBeenCalled();
  });
});

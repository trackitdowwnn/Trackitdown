/**
 * WHAT:  Tests for the appReady signal — the one-way "the first screen has
 *        content on it" flag that lifts the brand splash.
 * WHY:   It is one-way on purpose: a later refresh must never re-raise the
 *        splash over an app the user is already using. And it must be settable
 *        from a non-React context, because the publisher is a promise callback
 *        inside the feed's load.
 * LINKS: src/shared/lib/appReady.ts;
 *        src/features/auth/components/AuthGate.tsx (the reader).
 */

import { act, renderHook } from '@testing-library/react-native';

import {
  isContentReady,
  markContentReady,
  resetContentReadyForTests,
  useContentReady,
} from './appReady';

beforeEach(() => {
  resetContentReadyForTests();
});

describe('appReady', () => {
  it('starts false — a cold start has nothing on screen yet', () => {
    expect(isContentReady()).toBe(false);
  });

  it('flips once marked', () => {
    markContentReady();

    expect(isContentReady()).toBe(true);
  });

  it('never goes back to false once marked', () => {
    // A refresh failure, a user switch, a re-mount — none of these may put the
    // splash back over an app that is already usable.
    markContentReady();
    markContentReady();

    expect(isContentReady()).toBe(true);
  });
});

describe('useContentReady', () => {
  it('re-renders the reader when the flag flips', async () => {
    const { result, unmount } = await renderHook(() => useContentReady());
    expect(result.current).toBe(false);

    await act(async () => {
      markContentReady();
    });

    expect(result.current).toBe(true);
    await unmount();
  });

  it('reads true immediately when content was ready before mount', async () => {
    // The feed can settle before the gate mounts its reader — a fast cache hit
    // or a remount. The splash must not reappear for that.
    markContentReady();

    const { result, unmount } = await renderHook(() => useContentReady());

    expect(result.current).toBe(true);
    await unmount();
  });
});

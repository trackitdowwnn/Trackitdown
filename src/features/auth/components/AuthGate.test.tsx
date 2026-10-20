/**
 * WHAT:  Tests for AuthGate's splash rules — how long the brand splash covers
 *        the app on a cold start, and the guarantees that it always lifts.
 * WHY:   This screen sits between the user and the entire app. Lifting it too
 *        early is the bug being fixed (the feed assembling itself in public);
 *        lifting it too late, or never, is far worse — an app that looks
 *        frozen. Both failure directions are asserted here, including the
 *        cases that would hang: onboarding (no feed ever loads) and a request
 *        that never settles.
 * LINKS: src/features/auth/components/AuthGate.tsx;
 *        src/shared/lib/appReady.ts; docs/TESTING.md.
 */

import { act, configure, render } from '@testing-library/react-native';
import { Text } from 'react-native';

import { markContentReady, resetContentReadyForTests } from '@/shared/lib/appReady';
import { motion } from '@/shared/theme';

import type { AuthRoute } from '../hooks/useAuthGate';
import { AuthGate } from './AuthGate';

let mockRoute: AuthRoute = 'loading';
jest.mock('../hooks/useAuthGate', () => ({
  get useAuthGate() {
    return () => mockRoute;
  },
}));

jest.mock('@/features/permissions', () => ({
  useStartupPermissionRequests: () => {},
}));

const mockReplace = jest.fn();
let mockSegments: string[] = ['(tabs)'];
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, push: jest.fn(), back: jest.fn() }),
  // Read at CALL time, so each test can position the gate on a route.
  useSegments: () => mockSegments,
  useGlobalSearchParams: () => mockParams,
}));

const child = <Text>the app</Text>;

/** AuthGate's backstop — mirrored, as the gate keeps it private. */
const MAX_CONTENT_WAIT_MS = 6000;

/** Lifting starts a fade; the splash is removed once it has run. */
async function finishFade() {
  await act(async () => {
    jest.advanceTimersByTime(motion.standard);
  });
}

// A leaving splash hides itself from screen readers, and RNTL's queries skip
// hidden elements by default — so "the splash is gone" would pass while it was
// still mounted. Counting hidden elements makes null mean unmounted.
configure({ defaultIncludeHiddenElements: true });

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  resetContentReadyForTests();
  mockRoute = 'loading';
  mockSegments = ['(tabs)'];
  mockParams = {};
});

afterEach(() => {
  jest.useRealTimers();
});

describe('while the session is restoring', () => {
  it('covers the app with the splash', async () => {
    const { getByTestId } = await act(async () => render(<AuthGate>{child}</AuthGate>));

    expect(getByTestId('brand-splash')).toBeTruthy();
  });

  it('shows the mark, and a progress line once the start is slow', async () => {
    const { getByTestId } = await act(async () => render(<AuthGate>{child}</AuthGate>));
    expect(getByTestId('brand-splash-mark')).toBeTruthy();

    await act(async () => {
      jest.advanceTimersByTime(motion.splashSlowAfter);
    });
    expect(getByTestId('brand-splash-progress')).toBeTruthy();
  });
});

describe('once routing has resolved to the app', () => {
  beforeEach(() => {
    mockRoute = 'app';
  });

  it('KEEPS the splash up until the first screen has content', async () => {
    // The whole point: without this the feed assembles itself in public.
    const { getByTestId } = await act(async () => render(<AuthGate>{child}</AuthGate>));

    expect(getByTestId('brand-splash')).toBeTruthy();
  });

  it('lifts as soon as content is ready — the app is live at once, the splash fades', async () => {
    const { getByTestId, queryByTestId } = await act(async () =>
      render(<AuthGate>{child}</AuthGate>),
    );

    await act(async () => {
      markContentReady();
    });
    // Still on screen for its fade, but no longer in the way of a tap.
    expect(getByTestId('brand-splash').props.pointerEvents).toBe('none');

    await finishFade();
    expect(queryByTestId('brand-splash')).toBeNull();
  });

  it('lifts anyway if content never arrives', async () => {
    // The backstop. appReady is marked even on error, so this only fires when a
    // request neither resolves nor rejects — but an app stuck on a splash is
    // the worst possible outcome, so the wait is always bounded.
    const { getByTestId, queryByTestId } = await act(async () =>
      render(<AuthGate>{child}</AuthGate>),
    );
    expect(getByTestId('brand-splash')).toBeTruthy();

    await act(async () => {
      jest.advanceTimersByTime(MAX_CONTENT_WAIT_MS - 1);
    });
    expect(getByTestId('brand-splash').props.pointerEvents).toBe('auto');

    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    await finishFade();

    expect(queryByTestId('brand-splash')).toBeNull();
  });

  it('does not hold when content has already landed', async () => {
    markContentReady();
    const { getByTestId, queryByTestId } = await act(async () =>
      render(<AuthGate>{child}</AuthGate>),
    );
    expect(getByTestId('brand-splash').props.pointerEvents).toBe('none');

    await finishFade();
    expect(queryByTestId('brand-splash')).toBeNull();
  });

  it('never raises the splash again once it has come down', async () => {
    markContentReady();
    const view = await act(async () => render(<AuthGate>{child}</AuthGate>));
    await finishFade();

    // Whatever the gate reports later in the session, the splash stays gone.
    mockRoute = 'loading';
    await view.rerender(<AuthGate>{child}</AuthGate>);
    expect(view.queryByTestId('brand-splash')).toBeNull();
  });

  it('stays down if the gate wavers mid-fade', async () => {
    markContentReady();
    const view = await act(async () => render(<AuthGate>{child}</AuthGate>));

    mockRoute = 'loading';
    await view.rerender(<AuthGate>{child}</AuthGate>);
    expect(view.getByTestId('brand-splash').props.pointerEvents).toBe('none');

    await finishFade();
    expect(view.queryByTestId('brand-splash')).toBeNull();
  });
});

describe('onboarding', () => {
  it('never waits for content — no feed will ever load there', async () => {
    // Waiting on appReady here would hang the splash over onboarding forever,
    // until the timeout rescued it. First launch must be instant.
    mockRoute = 'onboarding';

    const { getByTestId, queryByTestId } = await act(async () =>
      render(<AuthGate>{child}</AuthGate>),
    );
    expect(getByTestId('brand-splash').props.pointerEvents).toBe('none');

    await finishFade();
    expect(queryByTestId('brand-splash')).toBeNull();
  });

  it('brings the splash back over the feed once onboarding is done, until it has content', async () => {
    // A new user's first look at the feed gets the same courtesy as a
    // returning user's cold start: no feed assembling itself in public.
    mockRoute = 'onboarding';
    const view = await act(async () => render(<AuthGate>{child}</AuthGate>));
    await finishFade();
    expect(view.queryByTestId('brand-splash')).toBeNull();

    mockRoute = 'app';
    await view.rerender(<AuthGate>{child}</AuthGate>);
    expect(view.getByTestId('brand-splash').props.pointerEvents).toBe('auto');

    await act(async () => {
      markContentReady();
    });
    await finishFade();
    expect(view.queryByTestId('brand-splash')).toBeNull();
  });

  it('a raise mid-fade is a fresh, whole splash — never a half-faded one', async () => {
    mockRoute = 'onboarding';
    const view = await act(async () => render(<AuthGate>{child}</AuthGate>));
    const leaving = view.getByTestId('brand-splash');
    expect(leaving.props.pointerEvents).toBe('none');

    mockRoute = 'app';
    await view.rerender(<AuthGate>{child}</AuthGate>);
    const raised = view.getByTestId('brand-splash');
    expect(raised).not.toBe(leaving);
    expect(raised.props.pointerEvents).toBe('auto');

    // The old one's exit timer died with it: the new one stays up.
    await finishFade();
    expect(view.getByTestId('brand-splash').props.pointerEvents).toBe('auto');
  });
});

describe('re-viewing onboarding from settings', () => {
  // The bug: Profile's "How Trackitdown works" pushes /onboarding?revisit=1,
  // and the gate — seeing the seen-flag set — replaced it with the feed before
  // the first slide could paint. The row looked like it navigated to Explore.
  it('LEAVES a deliberate re-view alone', async () => {
    mockRoute = 'app'; // onboarding already seen, as it is for every returning user
    mockSegments = ['onboarding'];
    mockParams = { revisit: '1' };

    await act(async () => render(<AuthGate>{child}</AuthGate>));

    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('still evicts a seen user who lands on onboarding WITHOUT the revisit flag', async () => {
    // The original rule, which must survive the fix: onboarding is not a place
    // a returning user gets to by accident or by stale deep link.
    mockRoute = 'app';
    mockSegments = ['onboarding'];
    mockParams = {};

    await act(async () => render(<AuthGate>{child}</AuthGate>));

    expect(mockReplace).toHaveBeenCalledWith('/(tabs)/explore');
  });

  it('still sends a FIRST launch to onboarding', async () => {
    mockRoute = 'onboarding';
    mockSegments = ['(tabs)'];

    await act(async () => render(<AuthGate>{child}</AuthGate>));

    expect(mockReplace).toHaveBeenCalledWith('/onboarding');
  });
});

describe('the app underneath', () => {
  it('is always mounted, even while covered', async () => {
    // Expo Router requires the navigator mounted; it is also what lets the feed
    // start loading while the splash is still up.
    mockRoute = 'loading';
    const { getByText } = await act(async () => render(<AuthGate>{child}</AuthGate>));

    expect(getByText('the app')).toBeTruthy();
  });
});

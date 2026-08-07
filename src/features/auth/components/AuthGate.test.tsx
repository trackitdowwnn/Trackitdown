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

import { act, render } from '@testing-library/react-native';
import { Text } from 'react-native';

import { markContentReady, resetContentReadyForTests } from '@/shared/lib/appReady';

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

  it('shows a loader, so a slow start does not look frozen', async () => {
    const { getByTestId } = await act(async () => render(<AuthGate>{child}</AuthGate>));

    expect(getByTestId('brand-splash-loader')).toBeTruthy();
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

  it('lifts as soon as content is ready', async () => {
    const { queryByTestId } = await act(async () => render(<AuthGate>{child}</AuthGate>));

    await act(async () => {
      markContentReady();
    });

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
      jest.advanceTimersByTime(10_000);
    });

    expect(queryByTestId('brand-splash')).toBeNull();
  });

  it('never re-raises the splash after content has landed', async () => {
    markContentReady();
    const { queryByTestId } = await act(async () => render(<AuthGate>{child}</AuthGate>));

    expect(queryByTestId('brand-splash')).toBeNull();
  });
});

describe('onboarding', () => {
  it('never waits for content — no feed will ever load there', async () => {
    // Waiting on appReady here would hang the splash over onboarding forever,
    // until the timeout rescued it. First launch must be instant.
    mockRoute = 'onboarding';

    const { queryByTestId } = await act(async () => render(<AuthGate>{child}</AuthGate>));

    expect(queryByTestId('brand-splash')).toBeNull();
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

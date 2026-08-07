/**
 * WHAT:  Tests for the alert-area sheet's decision logic — when it offers, when
 *        it stays silent, and that it only ever asks once.
 * WHY:   This is an interruption, so every suppression rule is a promise: a
 *        guest is never offered alerts they can't hold, someone who already has
 *        one is never asked again, an unresolved answer WAITS rather than
 *        flashing a sheet, and it yields to the garage sheet rather than
 *        stacking two modals. It also marks the flag on PRESENT, not on the
 *        user's reply — which is what makes "once per install" true however
 *        they respond.
 * LINKS: src/features/notifications/components/AlertNudgeSheet.tsx,
 *        src/features/garage/components/SaveYourCarSheet.test.tsx (the harness
 *        this mirrors), docs/TESTING.md.
 */

import { act, fireEvent, render } from '@testing-library/react-native';
import { InteractionManager } from 'react-native';

import { clearAlertNudge, requestAlertNudge } from '../lib/alertNudgeIntent';
import { AlertNudgeSheet } from './AlertNudgeSheet';

const mockOpen = jest.fn();
const mockClose = jest.fn();
jest.mock('@/shared/ui', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factory
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factory
  const { View, Text, Pressable } = require('react-native');
  return {
    BottomSheet: ({ ref, children }: { ref?: React.Ref<unknown>; children: React.ReactNode }) => {
      React.useImperativeHandle(ref, () => ({ open: mockOpen, close: mockClose }));
      return React.createElement(View, null, children);
    },
    Button: ({ label, onPress }: { label: string; onPress: () => void }) =>
      React.createElement(
        Pressable,
        { testID: `btn-${label}`, onPress },
        React.createElement(Text, null, label),
      ),
  };
});

type AlertsState =
  | { status: 'signedOut' }
  | { status: 'loading' }
  | { status: 'ready'; alerts: unknown[] };

let mockAlerts: AlertsState = { status: 'ready', alerts: [] };
// A FRESH OBJECT per call, exactly like the real useMyAlerts (which returns an
// object literal every render). Returning a stable reference here would hide
// the class of bug that shipped once already: an object in the effect's deps
// re-runs it every render, and the cleanup cancels the deferred open().
jest.mock('../hooks/useMyAlerts', () => ({ useMyAlerts: () => ({ ...mockAlerts }) }));

let mockGarageIntent: unknown = null;
jest.mock('@/features/garage', () => ({ useSaveCarNudgeIntent: () => mockGarageIntent }));

const mockHasOffered = jest.fn<Promise<boolean>, []>();
const mockMarkOffered = jest.fn(async () => {});
jest.mock('../lib/alertNudgeStorage', () => ({
  hasOfferedAlertNudge: () => mockHasOffered(),
  markAlertNudgeOffered: () => mockMarkOffered(),
}));

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));

jest.mock('@/shared/lib/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() }),
}));

// The real open() is DEFERRED past the back-navigation animation, so the tests
// must defer it too. Running it inline (the previous harness) made every test
// pass while the real sheet never opened: inline, open() happens before any
// cleanup can cancel it.
let pendingTask: (() => void) | null = null;
const flushInteractions = async () => {
  await act(async () => {
    pendingTask?.();
    pendingTask = null;
  });
};

const mountWithIntent = async () => {
  const utils = await act(async () => render(<AlertNudgeSheet />));
  await act(async () => {
    requestAlertNudge();
  });
  await flushInteractions();
  return utils;
};

beforeEach(() => {
  jest.clearAllMocks();
  clearAlertNudge();
  mockAlerts = { status: 'ready', alerts: [] };
  mockGarageIntent = null;
  mockHasOffered.mockResolvedValue(false);
  pendingTask = null;
  // Capture rather than run: a cancelled task must be observably cancelled.
  jest.spyOn(InteractionManager, 'runAfterInteractions').mockImplementation((task) => {
    if (typeof task === 'function') {
      pendingTask = task;
    }
    return {
      cancel: () => {
        pendingTask = null;
      },
      then: jest.fn(),
      done: jest.fn(),
    } as never;
  });
});

describe('when it offers an alert area', () => {
  it('opens for a member with no alerts who has never been asked', async () => {
    await mountWithIntent();

    expect(mockOpen).toHaveBeenCalledTimes(1);
  });

  it('stays shut until the third listing actually asks for it', async () => {
    await act(async () => render(<AlertNudgeSheet />));

    expect(mockOpen).not.toHaveBeenCalled();
  });

  // The flag means "we asked", not "they declined".
  it('records the offer the moment it appears, before any answer', async () => {
    await mountWithIntent();

    expect(mockMarkOffered).toHaveBeenCalledTimes(1);
  });

  // REGRESSION (2026-08-06): this shipped broken. `alerts` sat in the effect's
  // dependency array, useMyAlerts returns a fresh object every render, so the
  // effect re-ran and its cleanup cancelled the deferred open(). On the device
  // that logged alert_nudge_shown and burned the once-only flag while nothing
  // ever appeared — the worst possible failure for a one-shot offer.
  it('still opens after re-renders that change nothing but object identity', async () => {
    const { rerender } = await act(async () => render(<AlertNudgeSheet />));
    await act(async () => {
      requestAlertNudge();
    });
    // Three renders' worth of new useMyAlerts objects before the deferred open
    // gets its chance — the real app does this constantly.
    await act(async () => rerender(<AlertNudgeSheet />));
    await act(async () => rerender(<AlertNudgeSheet />));
    await act(async () => rerender(<AlertNudgeSheet />));
    await flushInteractions();

    expect(mockOpen).toHaveBeenCalledTimes(1);
  });
});

describe('when it stays silent', () => {
  it('never offers a guest alerts they cannot hold', async () => {
    mockAlerts = { status: 'signedOut' };

    await mountWithIntent();

    expect(mockOpen).not.toHaveBeenCalled();
  });

  it('never asks someone who already has an alert', async () => {
    mockAlerts = { status: 'ready', alerts: [{ id: 'a1' }] };

    await mountWithIntent();

    expect(mockOpen).not.toHaveBeenCalled();
  });

  it('never asks twice across installs', async () => {
    mockHasOffered.mockResolvedValue(true);

    await mountWithIntent();

    expect(mockOpen).not.toHaveBeenCalled();
  });

  // Two root sheets would stack; the garage offer wins because its moment
  // (abandoning the report wizard) is the more specific one.
  it('yields while the garage sheet is pending rather than stacking', async () => {
    mockGarageIntent = { source: 'post_a_car_abandoned' };

    await mountWithIntent();

    expect(mockOpen).not.toHaveBeenCalled();
    expect(mockMarkOffered).not.toHaveBeenCalled();
  });

  // Holding beats flashing: opening and closing a frame later is worse than
  // appearing a beat late.
  it('waits while the alert list is still loading, without burning the offer', async () => {
    mockAlerts = { status: 'loading' };

    await mountWithIntent();

    expect(mockOpen).not.toHaveBeenCalled();
    expect(mockMarkOffered).not.toHaveBeenCalled();
  });
});

describe('answering it', () => {
  it('routes to the alert wizard when accepted', async () => {
    const { getByTestId } = await mountWithIntent();

    await act(async () => {
      fireEvent.press(getByTestId('btn-Set my alert area'));
    });

    expect(mockPush).toHaveBeenCalledWith('/alerts/new');
    expect(mockClose).toHaveBeenCalled();
  });

  it('closes without routing when declined', async () => {
    const { getByTestId } = await mountWithIntent();

    await act(async () => {
      fireEvent.press(getByTestId('btn-Not now'));
    });

    expect(mockPush).not.toHaveBeenCalled();
    expect(mockClose).toHaveBeenCalled();
  });

  it('does not reopen after being answered', async () => {
    const { getByTestId } = await mountWithIntent();

    await act(async () => {
      fireEvent.press(getByTestId('btn-Not now'));
    });

    expect(mockOpen).toHaveBeenCalledTimes(1);
  });
});

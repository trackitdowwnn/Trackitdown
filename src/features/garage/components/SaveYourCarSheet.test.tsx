/**
 * WHAT:  Tests for the exit nudge's decision logic — when it offers the garage,
 *        when it stays silent, and that it only ever asks once.
 * WHY:   This is the app's only interruptive nudge, so every suppression rule is
 *        a promise: a guest is never offered a garage they can't write to,
 *        someone who already has a car is never asked again, and an unresolved
 *        answer waits rather than flashing a sheet. It also marks the shared
 *        flag on PRESENT, not on the user's reply — which is what stops the
 *        Explore card asking the same thing later.
 * LINKS: src/features/garage/components/SaveYourCarSheet.tsx, docs/TESTING.md.
 */

import { act, fireEvent, render } from '@testing-library/react-native';
import { InteractionManager } from 'react-native';

import { SaveYourCarSheet } from './SaveYourCarSheet';
import { clearSaveCarNudge, requestSaveCarNudge } from '../lib/exitNudgeIntent';

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

let mockSession: { status: string; userId: string | null } = {
  status: 'signedIn',
  userId: 'u1',
};
jest.mock('@/features/auth', () => ({ useSession: () => mockSession }));

let mockSavedCar: 'unknown' | 'none' | 'some' = 'none';
jest.mock('../hooks/useHasSavedCar', () => ({ useHasSavedCar: () => mockSavedCar }));

const mockHasOffered = jest.fn<Promise<boolean>, []>();
const mockMarkOffered = jest.fn(async () => {});
jest.mock('../lib/garageNudgeStorage', () => ({
  hasOfferedGarageNudge: () => mockHasOffered(),
  markGarageNudgeOffered: () => mockMarkOffered(),
}));

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));

jest.mock('@/shared/lib/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() }),
}));


const mountWithIntent = async () => {
  const utils = await act(async () => render(<SaveYourCarSheet />));
  await act(async () => {
    requestSaveCarNudge();
  });
  return utils;
};

beforeEach(() => {
  jest.clearAllMocks();
  clearSaveCarNudge();
  mockSession = { status: 'signedIn', userId: 'u1' };
  mockSavedCar = 'none';
  mockHasOffered.mockResolvedValue(false);
  // The real one defers the present past the wizard's slide-down dismissal;
  // run it inline so the tests can observe the outcome.
  jest
    .spyOn(InteractionManager, 'runAfterInteractions')
    .mockImplementation((task) => {
      if (typeof task === 'function') {
        task();
      }
      return { cancel: jest.fn(), then: jest.fn(), done: jest.fn() } as never;
    });
});

describe('when it offers the garage', () => {
  it('opens for a signed-in user with no saved car who has never been asked', async () => {
    await mountWithIntent();

    expect(mockOpen).toHaveBeenCalledTimes(1);
  });

  // The flag means "we asked", not "they declined" — written on PRESENT so the
  // Explore card won't later make the same offer again.
  it('records the offer the moment it appears, before any answer', async () => {
    await mountWithIntent();

    expect(mockMarkOffered).toHaveBeenCalledTimes(1);
  });

  it('stays shut until something actually asks for it', async () => {
    await act(async () => render(<SaveYourCarSheet />));

    expect(mockOpen).not.toHaveBeenCalled();
  });
});

describe('when it stays silent', () => {
  // The __DEV__ tab-bar branch lets a guest reach the wizard. Offering them a
  // garage they cannot write to would be a dead end.
  it('never opens for a guest', async () => {
    mockSession = { status: 'signedOut', userId: null };

    await mountWithIntent();

    expect(mockOpen).not.toHaveBeenCalled();
    expect(mockMarkOffered).not.toHaveBeenCalled();
  });

  it('never opens for someone who already has a saved car', async () => {
    mockSavedCar = 'some';

    await mountWithIntent();

    expect(mockOpen).not.toHaveBeenCalled();
  });

  it('never opens twice — one offer per install', async () => {
    mockHasOffered.mockResolvedValue(true);

    await mountWithIntent();

    expect(mockOpen).not.toHaveBeenCalled();
    expect(mockMarkOffered).not.toHaveBeenCalled();
  });

  // 'unknown' means a fetch is in flight or failed. Opening on it would flash a
  // sheet at someone who may well already have a car.
  it('waits rather than flashing while the answer is unknown', async () => {
    mockSavedCar = 'unknown';

    await mountWithIntent();

    expect(mockOpen).not.toHaveBeenCalled();
    expect(mockMarkOffered).not.toHaveBeenCalled();
  });
});

describe('the two ways out', () => {
  it('"Save my car" opens the add flow and closes', async () => {
    const { getByTestId } = await mountWithIntent();

    await act(async () => {
      fireEvent.press(getByTestId('btn-Save my car'));
    });

    expect(mockPush).toHaveBeenCalledWith('/add-vehicle');
    expect(mockClose).toHaveBeenCalled();
  });

  it('"Not now" just closes — no nag, no navigation', async () => {
    const { getByTestId } = await mountWithIntent();

    await act(async () => {
      fireEvent.press(getByTestId('btn-Not now'));
    });

    expect(mockPush).not.toHaveBeenCalled();
    expect(mockClose).toHaveBeenCalled();
  });
});

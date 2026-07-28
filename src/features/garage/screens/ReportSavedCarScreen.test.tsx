/**
 * WHAT:  Tests for ReportSavedCarScreen's two failure exits — a garage that
 *        won't load, and a car that is genuinely gone.
 * WHY:   Both must land on the BLANK wizard, never back on the "which car?"
 *        chooser: whatever just went wrong would go wrong again, and a chooser
 *        that bounces someone straight back here is a loop at the worst
 *        possible moment.
 *
 *        Also pins the distinction the error branch exists for: a failed load
 *        is NOT a missing car, and must never be reported as one.
 * LINKS: src/features/garage/screens/ReportSavedCarScreen.tsx;
 *        src/features/garage/screens/ChooseCarToReportScreen.tsx;
 *        docs/TESTING.md.
 */

import { act, fireEvent, render } from '@testing-library/react-native';

import type { SavedVehicle } from '../types';
import { ReportSavedCarScreen } from './ReportSavedCarScreen';

// Reached transitively through the auth barrel (onboardingStorage).
jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, push: jest.fn(), back: jest.fn() }),
  useFocusEffect: () => {},
}));

jest.mock('@/shared/lib/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() }),
}));

const mockRetry = jest.fn();
let mockVehicles: { status: string; vehicles: SavedVehicle[]; retry: () => void };
jest.mock('../hooks/useMyVehicles', () => ({
  get useMyVehicles() {
    return () => mockVehicles;
  },
}));

// The happy path renders the whole posting wizard (and Stripe, and the
// supabase client, underneath it); these tests only exercise the two
// early-return failure branches, so both the wizard and the flow builder are
// stubbed to keep this suite about the fallbacks.
jest.mock('@/features/vehicles', () => ({
  PostACarScreen: () => null,
  postACarFlow: { id: 'post-a-car', phases: [] },
  POST_A_CAR_INITIAL_ANSWERS: {},
}));
jest.mock('../lib/prefilledPostFlow', () => ({
  buildPrefilledPostFlow: () => ({ flow: { id: 'post-a-car', phases: [] }, initialAnswers: {} }),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockVehicles = { status: 'ready', vehicles: [], retry: mockRetry };
});

describe('when the garage will not load', () => {
  it('offers a blank report that will not re-offer the cars', async () => {
    mockVehicles = { status: 'error', vehicles: [], retry: mockRetry };
    const { getByText } = await act(async () =>
      render(<ReportSavedCarScreen vehicleId="v1" />),
    );

    await act(async () => {
      fireEvent.press(getByText('Report a stolen car from scratch'));
    });

    expect(mockReplace).toHaveBeenCalledWith('/post-a-car');
  });

  it('does not claim the car was deleted', async () => {
    // A network blip telling someone their saved car is gone would be untrue,
    // and the worst possible sentence at the worst possible moment.
    mockVehicles = { status: 'error', vehicles: [], retry: mockRetry };
    const { getByText, queryByText } = await act(async () =>
      render(<ReportSavedCarScreen vehicleId="v1" />),
    );

    expect(getByText("We couldn't load your cars.")).toBeTruthy();
    expect(queryByText("We couldn't find that car")).toBeNull();
  });
});

describe('when the car is genuinely gone', () => {
  it('offers a blank report that will not re-offer the cars', async () => {
    mockVehicles = { status: 'ready', vehicles: [], retry: mockRetry };
    const { getByText } = await act(async () =>
      render(<ReportSavedCarScreen vehicleId="missing" />),
    );

    await act(async () => {
      fireEvent.press(getByText('Report a stolen car'));
    });

    expect(mockReplace).toHaveBeenCalledWith('/post-a-car');
  });
});

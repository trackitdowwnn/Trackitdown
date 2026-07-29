/**
 * WHAT:  Tests for ChooseCarToReportScreen — the "Which car?" fork: which cars
 *        it offers, where each choice goes, and the escapes that must always
 *        exist.
 * WHY:   This screen stands between someone whose car has just been stolen and
 *        the report form, so every path off it has to work: a car that can't be
 *        offered must not appear, a garage that won't load must not trap them,
 *        and "it's a different car" must always be reachable. A chooser you can
 *        get stuck on is worse than no chooser.
 * LINKS: src/features/garage/screens/ChooseCarToReportScreen.tsx;
 *        src/app/(tabs)/_layout.tsx (routes here only when cars are known);
 *        docs/TESTING.md.
 */

import { act, fireEvent, render } from '@testing-library/react-native';

import type { SavedVehicle } from '../types';
import { ChooseCarToReportScreen } from './ChooseCarToReportScreen';

// Reached transitively through the auth barrel (onboardingStorage).
jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const mockReplace = jest.fn();
const mockPush = jest.fn();
const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, push: mockPush, back: mockBack }),
  useFocusEffect: () => {},
}));

const mockLogInfo = jest.fn();
jest.mock('@/shared/lib/logger', () => ({
  createLogger: () => ({
    info: (...args: unknown[]) => mockLogInfo(...args),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  }),
}));

const mockRetry = jest.fn();
let mockVehicles: { status: string; vehicles: SavedVehicle[]; retry: () => void };
jest.mock('../hooks/useMyVehicles', () => ({
  get useMyVehicles() {
    return () => mockVehicles;
  },
}));

function vehicle(overrides: Partial<SavedVehicle> = {}): SavedVehicle {
  return {
    id: 'v1',
    plate: 'AB12 CDE',
    make: 'BMW',
    model: '320d',
    colour: 'Blue',
    colourNote: null,
    year: 2019,
    bodyType: 'Saloon',
    nickname: null,
    verificationState: 'unverified',
    photos: [{ url: 'https://x/1.jpg', position: 0 }],
    distinctiveFeatures: [],
    isCurrentlyPosted: false,
    activePostId: null,
    createdAt: '2026-07-01T10:00:00Z',
    ...overrides,
  };
}

const renderScreen = () => act(async () => render(<ChooseCarToReportScreen />));

beforeEach(() => {
  jest.clearAllMocks();
  mockVehicles = { status: 'ready', vehicles: [vehicle()], retry: mockRetry };
});

describe('the cars on offer', () => {
  it('shows a row per saved car', async () => {
    mockVehicles = {
      status: 'ready',
      vehicles: [vehicle(), vehicle({ id: 'v2', make: 'Ford', model: 'Focus' })],
      retry: mockRetry,
    };
    const { getByTestId } = await renderScreen();

    expect(getByTestId('choose-car-v1')).toBeTruthy();
    expect(getByTestId('choose-car-v2')).toBeTruthy();
  });

  it('a row speaks its whole action, with the plate spelled out', async () => {
    // The row IS the choice, so its label must say what tapping does — and
    // spellPlate keeps a reader from attempting "AB12 CDE" as a word.
    const { getByTestId } = await renderScreen();

    expect(getByTestId('choose-car-v1').props.accessibilityLabel).toBe(
      'Report BMW 320d, plate A B 1 2, C D E, stolen',
    );
  });

  it('never offers a car that is already reported stolen', async () => {
    // A second listing for the same plate would be refused as PLATE_IN_USE.
    mockVehicles = {
      status: 'ready',
      vehicles: [
        vehicle({ isCurrentlyPosted: true, activePostId: 'p1' }),
        vehicle({ id: 'v2' }),
      ],
      retry: mockRetry,
    };
    const { queryByTestId, getByTestId } = await renderScreen();

    expect(queryByTestId('choose-car-v1')).toBeNull();
    expect(getByTestId('choose-car-v2')).toBeTruthy();
  });

  it('logs a count, never a plate or a nickname', async () => {
    mockVehicles = {
      status: 'ready',
      vehicles: [vehicle({ nickname: "Mum's Golf" })],
      retry: mockRetry,
    };
    await renderScreen();

    expect(mockLogInfo).toHaveBeenCalledWith('garage_choose_car_shown', { vehicleCount: 1 });
    const logged = JSON.stringify(mockLogInfo.mock.calls);
    expect(logged).not.toContain('AB12');
    expect(logged).not.toContain("Mum's Golf");
  });
});

describe('choosing a car', () => {
  it('goes to the prefilled report for that car', async () => {
    const { getByTestId } = await renderScreen();

    await act(async () => {
      fireEvent.press(getByTestId('choose-car-v1'));
    });

    // replace, not push: this screen is a fork, not somewhere to come back to.
    expect(mockReplace).toHaveBeenCalledWith({
      pathname: '/report-stolen/[vehicleId]',
      params: { vehicleId: 'v1' },
    });
  });

  it('reuses the same funnel event as the My cars entry point', async () => {
    const { getByTestId } = await renderScreen();

    await act(async () => {
      fireEvent.press(getByTestId('choose-car-v1'));
    });

    expect(mockLogInfo).toHaveBeenCalledWith('garage_prefilled_post_launched', {
      vehicleId: 'v1',
    });
  });
});

describe('the escapes', () => {
  it('offers a blank report for a car that is not saved', async () => {
    const { getByText } = await renderScreen();

    await act(async () => {
      fireEvent.press(getByText("It's a different car"));
    });

    expect(mockReplace).toHaveBeenCalledWith('/post-a-car');
  });

  it('skips itself entirely when there is nothing to choose', async () => {
    // The tab bar normally routes straight past this screen; arriving with no
    // cars means the garage emptied since. Never strand anyone on an empty
    // chooser — go where they were heading.
    mockVehicles = { status: 'ready', vehicles: [], retry: mockRetry };
    await renderScreen();

    expect(mockReplace).toHaveBeenCalledWith('/post-a-car');
  });

  it('skips itself when every saved car is already reported', async () => {
    mockVehicles = {
      status: 'ready',
      vehicles: [vehicle({ isCurrentlyPosted: true, activePostId: 'p1' })],
      retry: mockRetry,
    };
    await renderScreen();

    expect(mockReplace).toHaveBeenCalledWith('/post-a-car');
  });

  it('a failed garage load offers both retry and carrying on', async () => {
    // A network blip must never block a theft report.
    mockVehicles = { status: 'error', vehicles: [], retry: mockRetry, };
    const { getByText } = await renderScreen();

    expect(getByText("We couldn't load your cars.")).toBeTruthy();

    await act(async () => {
      fireEvent.press(getByText('Report a car from scratch'));
    });
    expect(mockReplace).toHaveBeenCalledWith('/post-a-car');
  });

  it('does not bounce to the blank wizard while still loading', async () => {
    // 'loading' is not 'no cars' — redirecting here would flash past the
    // chooser for everyone on a slow connection.
    mockVehicles = { status: 'loading', vehicles: [], retry: mockRetry };
    await renderScreen();

    expect(mockReplace).not.toHaveBeenCalled();
  });
});

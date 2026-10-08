/**
 * WHAT:  Tests for StartReportScreen — the + button's one report screen: which
 *        stage it shows (blank form, "Which car?", pending, error), what each
 *        choice leads to, the escapes that must always exist, and the rules
 *        that make it smooth — no navigation between stages, no chooser for
 *        someone who may have no cars, no stage swapped out from under someone.
 * WHY:   This screen stands between someone whose car has just been stolen and
 *        the report form, so every path through it has to work: a car that
 *        can't be offered must not appear, a garage that won't load must not
 *        trap them, and "it's a different car" must always be reachable. And
 *        it replaced a chooser route that navigated again (2026-10-07: "janky,
 *        slow and not smooth"), so "it never navigates" is pinned too.
 * LINKS: src/features/garage/screens/StartReportScreen.tsx;
 *        src/features/garage/components/ChooseCarStage.tsx;
 *        src/features/garage/components/ReportPending.tsx; docs/TESTING.md.
 */

import { act, fireEvent, render } from '@testing-library/react-native';

import { motion } from '@/shared/theme';

import type { SavedVehicle } from '../types';
import { StartReportScreen } from './StartReportScreen';

// Reached transitively through the auth barrel (onboardingStorage).
jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const mockReplace = jest.fn();
const mockPush = jest.fn();
const mockBack = jest.fn();
let mockParams: { start?: string } = {};
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, push: mockPush, back: mockBack }),
  useLocalSearchParams: () => mockParams,
  useFocusEffect: () => {},
}));

const mockLogInfo = jest.fn();
const mockLogDebug = jest.fn();
jest.mock('@/shared/lib/logger', () => ({
  createLogger: () => ({
    info: (...args: unknown[]) => mockLogInfo(...args),
    warn: jest.fn(),
    debug: (...args: unknown[]) => mockLogDebug(...args),
    error: jest.fn(),
  }),
}));

// Signed in unless a test says otherwise; the gate is only for guests.
let mockSession: { status: string; userId: string | null } = { status: 'signedIn', userId: 'u1' };
const mockRequireAuth = jest.fn();
jest.mock('@/features/auth', () => ({
  useSession: () => mockSession,
  useRequireAuth: () => mockRequireAuth,
}));

const mockRetry = jest.fn();
let mockVehicles: { status: string; vehicles: SavedVehicle[]; retry: () => void };
jest.mock('../hooks/useMyVehicles', () => ({
  get useMyVehicles() {
    return () => mockVehicles;
  },
}));

// The two forms are stood in for: what matters here is WHICH one shows, and
// whether the blank one carries the garage's exit nudge.
jest.mock('@/features/vehicles', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factory
  const { Text: MockText } = require('react-native');
  return {
    PostACarScreen: ({ onAbandon }: { onAbandon?: () => void }) => (
      <MockText testID="blank-report">{onAbandon ? 'with-nudge' : 'no-nudge'}</MockText>
    ),
  };
});
jest.mock('../components/PrefilledReport', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factory
  const { Text: MockText } = require('react-native');
  return {
    PrefilledReport: ({ vehicle }: { vehicle: SavedVehicle }) => (
      <MockText testID="prefilled-report">{vehicle.id}</MockText>
    ),
  };
});
jest.mock('../lib/exitNudgeIntent', () => ({ requestSaveCarNudge: jest.fn() }));

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

const renderScreen = () => act(async () => render(<StartReportScreen />));

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  mockSession = { status: 'signedIn', userId: 'u1' };
  mockVehicles = { status: 'ready', vehicles: [vehicle()], retry: mockRetry };
});

describe('the cars on offer', () => {
  it('shows "Which car?" at once, with a row per saved car', async () => {
    mockVehicles = {
      status: 'ready',
      vehicles: [vehicle(), vehicle({ id: 'v2', make: 'Ford', model: 'Focus' })],
      retry: mockRetry,
    };
    const { getByTestId, getByText, queryByTestId } = await renderScreen();

    expect(getByText('Which car?')).toBeTruthy();
    expect(getByTestId('choose-car-v1')).toBeTruthy();
    expect(getByTestId('choose-car-v2')).toBeTruthy();
    expect(queryByTestId('report-pending')).toBeNull();
  });

  it('a row speaks its whole action, with the plate spelled out', async () => {
    const { getByTestId } = await renderScreen();

    expect(getByTestId('choose-car-v1').props.accessibilityLabel).toBe(
      'Report BMW 320d, plate A B 1 2, C D E, stolen',
    );
  });

  it('never offers a car that is already reported stolen', async () => {
    // A second listing for the same plate would be refused as PLATE_IN_USE.
    mockVehicles = {
      status: 'ready',
      vehicles: [vehicle({ isCurrentlyPosted: true, activePostId: 'p1' }), vehicle({ id: 'v2' })],
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

describe('choosing — in place, never another navigation', () => {
  it('a car dissolves into its prefilled report', async () => {
    const { getByTestId, queryByText } = await renderScreen();

    await act(async () => {
      fireEvent.press(getByTestId('choose-car-v1'));
    });

    expect(getByTestId('prefilled-report')).toHaveTextContent('v1');
    expect(queryByText('Which car?')).toBeNull();
    // The old chooser replaced itself with another route — a second
    // full-screen transition. Nothing navigates now.
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('reuses the same funnel event as the My cars entry point', async () => {
    const { getByTestId } = await renderScreen();

    await act(async () => {
      fireEvent.press(getByTestId('choose-car-v1'));
    });

    expect(mockLogInfo).toHaveBeenCalledWith('garage_prefilled_post_launched', { vehicleId: 'v1' });
  });

  it('"a different car" opens the blank report, with the garage nudge', async () => {
    const { getByText, getByTestId } = await renderScreen();

    await act(async () => {
      fireEvent.press(getByText("It's a different car"));
    });

    expect(getByTestId('blank-report')).toHaveTextContent('with-nudge');
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('hands the row’s press down to the plate chip', async () => {
    // PlateChip is a Pressable (long-press copies), so a chip given no handler
    // silently turns the plate into a dead spot on the panic-moment path. The
    // role is what the same ternary drives: a chip handed the row's press
    // declares none (see the git history of this test for the long version).
    const { getByLabelText } = await renderScreen();

    expect(getByLabelText('Plate A B 1 2, C D E').props.accessibilityRole).toBeUndefined();
  });
});

describe('no chooser without cars', () => {
  it('a confirmed empty garage opens the blank report on the first frame', async () => {
    mockVehicles = { status: 'ready', vehicles: [], retry: mockRetry };
    const { getByTestId, queryByText } = await renderScreen();

    expect(getByTestId('blank-report')).toHaveTextContent('with-nudge');
    expect(queryByText('Which car?')).toBeNull();
    expect(mockLogDebug).toHaveBeenCalledWith('garage_choose_car_skipped', {
      reason: 'no_offerable_cars',
    });
  });

  it('so does a garage where every car is already reported', async () => {
    mockVehicles = {
      status: 'ready',
      vehicles: [vehicle({ isCurrentlyPosted: true, activePostId: 'p1' })],
      retry: mockRetry,
    };
    const { getByTestId } = await renderScreen();

    expect(getByTestId('blank-report')).toBeTruthy();
  });

  describe('while the garage is still loading', () => {
    afterEach(() => {
      jest.useRealTimers();
    });

    it('shows only the way back — no title, no car-shaped rows', async () => {
      jest.useFakeTimers();
      mockVehicles = { status: 'loading', vehicles: [], retry: mockRetry };
      const { getByTestId, queryByText, queryByTestId } = await renderScreen();

      expect(getByTestId('choose-car-back')).toBeTruthy();
      expect(queryByText('Which car?')).toBeNull();
      expect(queryByTestId('report-pending-line')).toBeNull();
      expect(getByTestId('report-pending').props.accessibilityLabel).toBe('Checking your garage');
    });

    it('a slow load adds one neutral line — still never "Which car?"', async () => {
      jest.useFakeTimers();
      mockVehicles = { status: 'loading', vehicles: [], retry: mockRetry };
      const { getByTestId, queryByText } = await renderScreen();

      await act(async () => {
        jest.advanceTimersByTime(motion.skeletonGrace);
      });
      expect(getByTestId('report-pending-line')).toHaveTextContent('Checking your garage…');
      expect(queryByText('Which car?')).toBeNull();
    });

    it('then lands on whichever stage the answer says', async () => {
      mockVehicles = { status: 'loading', vehicles: [], retry: mockRetry };
      const view = await renderScreen();

      mockVehicles = { status: 'ready', vehicles: [], retry: mockRetry };
      await act(async () => {
        view.rerender(<StartReportScreen />);
      });
      expect(view.getByTestId('blank-report')).toBeTruthy();
      expect(view.queryByText('Which car?')).toBeNull();
    });
  });
});

describe('the escapes', () => {
  it('a failed garage load offers both retry and carrying on from scratch', async () => {
    // A network blip must never block a theft report.
    mockVehicles = { status: 'error', vehicles: [], retry: mockRetry };
    const { getByText, getByTestId } = await renderScreen();

    expect(getByText("We couldn't load your cars.")).toBeTruthy();
    await act(async () => {
      fireEvent.press(getByText('Report a car from scratch'));
    });
    expect(getByTestId('blank-report')).toBeTruthy();
  });

  it('a retry never blanks the page it has already shown', async () => {
    // Review of #140: after a quick failure, Retry used to drop the whole page
    // (back control included) for the grace period.
    mockVehicles = { status: 'error', vehicles: [], retry: mockRetry };
    const view = await renderScreen();

    mockVehicles = { status: 'loading', vehicles: [], retry: mockRetry };
    await act(async () => {
      view.rerender(<StartReportScreen />);
    });
    expect(view.getByTestId('choose-car-back')).toBeTruthy();
    expect(view.getByTestId('report-pending-line')).toBeTruthy();
  });

  it('?start=blank opens the blank report even with cars — no chooser loop', async () => {
    // A saved-car report that failed sends people here; offering the chooser
    // again would bounce them between the two.
    mockParams = { start: 'blank' };
    const { getByTestId, queryByText } = await renderScreen();
    expect(getByTestId('blank-report')).toBeTruthy();
    expect(queryByText('Which car?')).toBeNull();
  });

  it('the back control leaves', async () => {
    const { getByTestId } = await renderScreen();
    await act(async () => {
      fireEvent.press(getByTestId('choose-car-back'));
    });
    expect(mockBack).toHaveBeenCalled();
  });
});

describe('a guest who arrives without the + button (a deep link)', () => {
  it('is shown the sign-in sheet, never the form', async () => {
    mockSession = { status: 'signedOut', userId: null };
    mockVehicles = { status: 'ready', vehicles: [], retry: mockRetry };
    const { queryByTestId, getByTestId } = await renderScreen();

    expect(mockRequireAuth).toHaveBeenCalledWith({ context: 'post_car' });
    expect(queryByTestId('blank-report')).toBeNull();
    expect(getByTestId('report-pending')).toBeTruthy();
  });
});

describe('a stage once shown stays for the visit', () => {
  it('a chooser left with nothing to offer gives way to the blank report', async () => {
    const view = await renderScreen();
    expect(view.getByText('Which car?')).toBeTruthy();

    mockVehicles = {
      status: 'ready',
      vehicles: [vehicle({ isCurrentlyPosted: true, activePostId: 'p1' })],
      retry: mockRetry,
    };
    await act(async () => {
      view.rerender(<StartReportScreen />);
    });
    expect(view.getByTestId('blank-report')).toBeTruthy();
    expect(view.queryByText('Which car?')).toBeNull();
  });


  it('a revalidation that finds cars never yanks away the blank form', async () => {
    mockVehicles = { status: 'ready', vehicles: [], retry: mockRetry };
    const view = await renderScreen();
    expect(view.getByTestId('blank-report')).toBeTruthy();

    mockVehicles = { status: 'ready', vehicles: [vehicle()], retry: mockRetry };
    await act(async () => {
      view.rerender(<StartReportScreen />);
    });
    expect(view.getByTestId('blank-report')).toBeTruthy();
    expect(view.queryByText('Which car?')).toBeNull();
  });
});


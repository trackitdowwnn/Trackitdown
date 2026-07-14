/**
 * WHAT:  Tests for ReportSightingScreen's orchestration — the quota gate
 *        (spent → the kind rate-limited state BEFORE any wizard), the wizard
 *        rendering (safety gate first, with the Call 999 path), and the
 *        fail-open quota check (a network error never blocks reporting —
 *        the RPC is the real enforcement).
 * WHY:   The rate-limit gate is product kindness AND the client half of a
 *        server rule; showing the wizard to a spent spotter (or a wall to a
 *        legitimate one because a CHECK failed) would each break the flow's
 *        contract. Submission-failure retention is the wizard framework's
 *        own tested guarantee (useWizardController keeps answers on a
 *        rejected onComplete).
 * LINKS: src/features/sightings/screens/ReportSightingScreen.tsx,
 *        docs/TESTING.md.
 */

import { act, render } from '@testing-library/react-native';

import { ReportSightingScreen } from './ReportSightingScreen';

const mockFetchQuota = jest.fn();
jest.mock('../api/sightingApi', () => ({
  ...jest.requireActual('../api/sightingApi'),
  fetchSightingQuota: (...args: unknown[]) => mockFetchQuota(...args),
  submitSighting: jest.fn(),
}));

jest.mock('@/shared/api', () => ({ supabase: {} }));

// Native leaves the wizard steps touch — none render in these tests beyond
// the first screen, but the imports must not explode under jest.
jest.mock('expo-camera', () => ({
  CameraView: () => null,
  useCameraPermissions: () => [{ granted: true, canAskAgain: true }, jest.fn()],
}));
jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 3 },
  getForegroundPermissionsAsync: jest.fn().mockResolvedValue({ granted: true, canAskAgain: true }),
  reverseGeocodeAsync: jest.fn().mockResolvedValue([]),
}));
jest.mock('@/shared/ui/AppMap', () => ({ AppMap: 'AppMap', AppMapMarker: 'AppMapMarker' }));

jest.mock('react-native-reanimated', () => {
  const actual = jest.requireActual('react-native-reanimated/mock');
  return {
    __esModule: true,
    ...actual,
    default: actual.default,
    Extrapolation: actual.Extrapolation ?? { CLAMP: 'clamp' },
    useReducedMotion: () => true,
    ReduceMotion: { System: 'system' },
  };
});
jest.mock('react-native-safe-area-context', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  require('react-native-safe-area-context/jest/mock').default,
);

const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack, push: jest.fn() }),
}));

const renderScreen = async () => {
  let result!: Awaited<ReturnType<typeof render>>;
  await act(async () => {
    result = await render(
      <ReportSightingScreen postId="p1" source="detail" bountyPence={50000} />,
    );
  });
  return result;
};

describe('ReportSightingScreen', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows the kind rate-limited state INSTEAD of the wizard when the quota is spent', async () => {
    mockFetchQuota.mockResolvedValue({ used: 3, maxPerDay: 3 });
    const { getByText, queryByText } = await renderScreen();
    expect(getByText('You’ve sent 3 reports for this car today')).toBeTruthy();
    expect(queryByText('Before you report')).toBeNull();
  });

  it('runs the wizard when quota remains — the safety gate is screen one', async () => {
    mockFetchQuota.mockResolvedValue({ used: 0, maxPerDay: 3 });
    const { getByText, getByLabelText } = await renderScreen();
    expect(getByText('Before you report')).toBeTruthy();
    expect(getByLabelText('Call 999')).toBeTruthy();
    expect(getByText('Continue')).toBeTruthy();
  });

  it('fails open: a quota-check error still shows the wizard (RPC enforces for real)', async () => {
    mockFetchQuota.mockRejectedValue(new Error('offline'));
    const { getByText } = await renderScreen();
    expect(getByText('Before you report')).toBeTruthy();
  });
});

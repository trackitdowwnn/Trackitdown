/**
 * WHAT:  Tests for ReportSightingScreen's orchestration — the quota gate
 *        (spent → the kind rate-limited state BEFORE any wizard), the safety
 *        sheet for an entry that didn't show it (a deep link: sheet first,
 *        camera only after its "Continue", closing it leaves), the
 *        camera as screen one otherwise, and the fail-open quota check (a network error never blocks reporting —
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

import { act, fireEvent, render } from '@testing-library/react-native';

import { SAFETY_NOTICE_TITLE } from '@/shared/ui';

import { SAFETY_CONTINUE_LABEL } from '../components/ReportSafetySheet';
import { markSafetyAck, resetSafetyAck } from '../lib/safetyAck';
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
const mockReplace = jest.fn();
let mockCanGoBack = true;
jest.mock('expo-router', () => ({
  useRouter: () => ({
    back: mockBack,
    push: jest.fn(),
    replace: mockReplace,
    canGoBack: () => mockCanGoBack,
  }),
}));

// The visibility-aware gorhom boundary, so the safety sheet's open() and
// close() really gate its children. The mock draws no scrim, so the open
// modal is kept here: its dismiss() is what a swipe or Back ends in.
const mockOpenModal: { current: { dismiss: () => void } | null } = { current: null };
jest.mock('@gorhom/bottom-sheet', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  const mock = require('@gorhom/bottom-sheet/mock');

  class VisibilityAwareBottomSheetModal extends React.Component {
    state = { visible: false };
    present = () => {
      mockOpenModal.current = this;
      this.setState({ visible: true });
    };
    dismiss = () => {
      if (!this.state.visible) return;
      this.setState({ visible: false });
      this.props.onDismiss?.();
    };
    render() {
      return this.state.visible ? this.props.children : null;
    }
  }
  return { ...mock, BottomSheetModal: VisibilityAwareBottomSheetModal };
});

const PHOTOS_QUESTION = 'Photograph the car';

/** `acknowledged`: the entry point's sheet was just confirmed for p1. */
const renderScreen = async (acknowledged = false) => {
  if (acknowledged) markSafetyAck('p1');
  let result!: Awaited<ReturnType<typeof render>>;
  await act(async () => {
    result = await render(
      <ReportSightingScreen postId="p1" source="detail" bountyPence={50000} />,
    );
  });
  await act(async () => {});
  return result;
};

describe('ReportSightingScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetSafetyAck();
    mockCanGoBack = true;
    mockOpenModal.current = null;
  });

  it('shows the kind rate-limited state INSTEAD of the wizard when the quota is spent', async () => {
    mockFetchQuota.mockResolvedValue({ used: 3, maxPerDay: 3 });
    const { getByText, queryByText, queryByTestId } = await renderScreen();
    expect(getByText('You’ve sent 3 reports for this car today')).toBeTruthy();
    expect(queryByText(PHOTOS_QUESTION)).toBeNull();
    // A spent quota needs no safety moment: nothing is about to be reported.
    expect(queryByTestId('report-safety-sheet')).toBeNull();
  });

  it('opens on the camera when the entry point already showed the safety sheet', async () => {
    mockFetchQuota.mockResolvedValue({ used: 0, maxPerDay: 3 });
    const { getByText, queryByTestId } = await renderScreen(true);
    expect(getByText(PHOTOS_QUESTION)).toBeTruthy();
    expect(queryByTestId('report-safety-sheet')).toBeNull();
  });

  it('the X on the photos step leaves the report', async () => {
    mockFetchQuota.mockResolvedValue({ used: 0, maxPerDay: 3 });
    const view = await renderScreen(true);
    expect(view.getByText(PHOTOS_QUESTION)).toBeTruthy();
    await fireEvent.press(view.getByRole('button', { name: 'Exit' }));
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('⚠️ a confirm for ANOTHER car does not skip the sheet', async () => {
    mockFetchQuota.mockResolvedValue({ used: 0, maxPerDay: 3 });
    markSafetyAck('p2');
    const view = await renderScreen();
    expect(view.getByTestId('report-safety-sheet')).toBeTruthy();
    expect(view.queryByText(PHOTOS_QUESTION)).toBeNull();
  });

  it('⚠️ shows the safety sheet BEFORE the camera for an entry that did not (a deep link)', async () => {
    mockFetchQuota.mockResolvedValue({ used: 0, maxPerDay: 3 });
    const view = await renderScreen();
    expect(view.getByRole('header', { name: SAFETY_NOTICE_TITLE })).toBeTruthy();
    expect(view.queryByText(PHOTOS_QUESTION)).toBeNull();

    await fireEvent.press(view.getByRole('button', { name: SAFETY_CONTINUE_LABEL }));
    expect(view.getByText(PHOTOS_QUESTION)).toBeTruthy();
    expect(mockBack).not.toHaveBeenCalled();
  });

  it('leaves the report when that sheet is closed without confirming', async () => {
    mockFetchQuota.mockResolvedValue({ used: 0, maxPerDay: 3 });
    const view = await renderScreen();
    await act(async () => {
      mockOpenModal.current?.dismiss();
    });
    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(view.queryByText(PHOTOS_QUESTION)).toBeNull();
  });

  it('leaves a cold-start deep link for home, since there is nothing to go back to', async () => {
    mockFetchQuota.mockResolvedValue({ used: 0, maxPerDay: 3 });
    mockCanGoBack = false;
    await renderScreen();
    await act(async () => {
      mockOpenModal.current?.dismiss();
    });
    expect(mockBack).not.toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledWith('/');
  });

  it('⚠️ a failed quota check still needs the safety sheet first', async () => {
    mockFetchQuota.mockRejectedValue(new Error('offline'));
    const view = await renderScreen();
    expect(view.getByTestId('report-safety-sheet')).toBeTruthy();
    expect(view.queryByText(PHOTOS_QUESTION)).toBeNull();
  });

  it('⚠️ an expired confirm (over 30s old) does not skip the sheet', async () => {
    mockFetchQuota.mockResolvedValue({ used: 0, maxPerDay: 3 });
    markSafetyAck('p1', Date.now() - 31_000);
    const view = await renderScreen();
    expect(view.getByTestId('report-safety-sheet')).toBeTruthy();
    expect(view.queryByText(PHOTOS_QUESTION)).toBeNull();
  });

  it('keeps a way on and a way out behind the sheet, in case it never shows', async () => {
    mockFetchQuota.mockResolvedValue({ used: 0, maxPerDay: 3 });
    const view = await renderScreen();
    expect(view.getByText('Show the safety check')).toBeTruthy();
    await fireEvent.press(view.getByText('Not now'));
    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(view.queryByText(PHOTOS_QUESTION)).toBeNull();
  });

  it('fails open: a quota-check error still shows the wizard (RPC enforces for real)', async () => {
    mockFetchQuota.mockRejectedValue(new Error('offline'));
    const { getByText } = await renderScreen(true);
    expect(getByText(PHOTOS_QUESTION)).toBeTruthy();
  });
});

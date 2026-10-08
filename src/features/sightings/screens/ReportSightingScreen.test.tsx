/**
 * WHAT:  Tests for ReportSightingScreen's orchestration — the quota gate
 *        (spent → the kind rate-limited state BEFORE any wizard), the safety
 *        sheet for an entry that didn't show it (a deep link: sheet first,
 *        camera only after its "Continue", closing it leaves), the
 *        camera as screen one otherwise, and the fail-open quota check (a network error never blocks reporting —
 *        the RPC is the real enforcement). The success screen's reward line
 *        reads the LIVE reward from the seed over the route param (a reward
 *        that ended since the tap, ADR-0020), falling back to the param.
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

import { SAFETY_NOTICE_TITLE, ToastProvider } from '@/shared/ui';

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

// ⚠️ The screen loads its seed through a dynamic `import('@/features/vehicles')`,
// and this jest config runs without --experimental-vm-modules, so that import
// THROWS here (ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING_FLAG) and the screen
// always lands on its catch: EMPTY_REPORT_SEED. A jest.mock of the vehicles
// feature is never reached. So the seed is steered at the one value the
// screen does read in tests — EMPTY_REPORT_SEED, read at use time — and a
// test that needs a live reward overrides it. reportSeedFromDetail's own
// mapping (detail → reward) is pinned in lib/reportSeed.test.ts.
let mockSeedOverride: { confirmableFeatures: never[]; reward?: unknown } | null = null;
jest.mock('../lib/reportSeed', () => {
  const actual = jest.requireActual('../lib/reportSeed');
  // defineProperty, not a getter in an object literal: babel compiles
  // `{ ...actual, get X() {} }` through _objectSpread, which reads the getter
  // ONCE at factory time and freezes the value.
  return Object.defineProperty({ ...actual }, 'EMPTY_REPORT_SEED', {
    enumerable: true,
    get: () => mockSeedOverride ?? actual.EMPTY_REPORT_SEED,
  });
});

// The real wizard, plus a test-only "finish" that calls its onComplete — so
// the success screen is reachable without driving the camera and every step
// (the wizard's own completion is covered in useWizardController's tests).
jest.mock('@/shared/wizard', () => {
  const actual = jest.requireActual('@/shared/wizard');
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factory
  const { Pressable } = require('react-native');
  return {
    ...actual,
    WizardScreen: (props: { onComplete: (answers: object) => Promise<void> | void }) => (
      <>
        <actual.WizardScreen {...props} />
        <Pressable testID="test-finish-report" onPress={() => props.onComplete({})} />
      </>
    ),
  };
});

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
    // Omitted by the official mock; WizardScreen wraps each step in it.
    LayoutAnimationConfig: ({ children }: { children: unknown }) => children,
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

/** The seed the screen will read, carrying the listing's reward as it is now
 *  (see mockSeedOverride for why the seed is steered this way). */
const seedWithReward = (bountyPence: number | null, rewardEnded: boolean) => {
  mockSeedOverride = { confirmableFeatures: [], reward: { bountyPence, rewardEnded } };
};

/** Mount past the safety sheet, finish the report, land on the success
 *  screen. The route param always says £500 — the seed may disagree. */
const renderSent = async () => {
  markSafetyAck('p1');
  let result!: Awaited<ReturnType<typeof render>>;
  await act(async () => {
    result = await render(
      <ToastProvider>
        <ReportSightingScreen postId="p1" source="detail" bountyPence={50000} />
      </ToastProvider>,
    );
  });
  await act(async () => {});
  await act(async () => {
    await fireEvent.press(result.getByTestId('test-finish-report'));
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
    mockSeedOverride = null;
  });

  // ADR-0020: the route's `bounty` param was written when the spotter tapped
  // "I've seen this car"; the reward may have ENDED since. The success
  // screen must promise the reward as it is now.
  describe('the success screen’s reward line', () => {
    beforeEach(() => {
      mockFetchQuota.mockResolvedValue({ used: 0, maxPerDay: 3 });
    });

    it('uses the live reward from the seed: a lapsed reward says it has ended, never "£500"', async () => {
      seedWithReward(null, true);
      const view = await renderSent();

      expect(view.getByText('Report sent — thank you')).toBeTruthy();
      expect(view.getByText(/^The reward on this listing has ended/)).toBeTruthy();
      expect(view.queryByText(/£500/)).toBeNull();
      expect(view.queryByText(/There’s no cash reward/)).toBeNull();
    });

    it('uses the live amount when the reward has changed since the tap', async () => {
      seedWithReward(20000, false);
      const view = await renderSent();

      expect(view.getByText('If your sighting leads to the recovery, you’ll receive the £200 reward.')).toBeTruthy();
      expect(view.queryByText(/£500/)).toBeNull();
    });

    it('a fee listing (null, not ended) gets the no-cash-reward line', async () => {
      seedWithReward(null, false);
      const view = await renderSent();

      expect(view.getByText(/^There’s no cash reward on this listing/)).toBeTruthy();
      expect(view.queryByText(/has ended/)).toBeNull();
    });

    // The seed read failed (here: always, see mockSeedOverride) → no reward in
    // the seed → the route's snapshot is all there is.
    it('without a live read, never names the route’s (possibly stale) amount', async () => {
      const view = await renderSent();

      // The param said £500, but that reward may have ended or changed since
      // the tap: the line names nothing it can't vouch for.
      expect(
        view.getByText(
          'If your sighting leads to the car being found, the owner can credit you, and any reward on the listing goes to you.',
        ),
      ).toBeTruthy();
      expect(view.queryByText(/£500/)).toBeNull();
      expect(view.queryByText(/has ended/)).toBeNull();
    });
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

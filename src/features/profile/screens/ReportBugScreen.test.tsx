/**
 * WHAT:  Tests for the report-a-bug wizard host — the fast path, what reaches
 *        the RPC, and the two refusals that must never send a half-report.
 * WHY:   This screen is now only a host: the flow's shape is covered by
 *        ../lib/bugReportFlow.test and the disclosure promise by
 *        ../components/BugDisclosurePanel.test. What is left here is the part
 *        no config test can reach — the submit.
 *
 *        ⚠️ THREE DEFECTS SHIPPED INVISIBLY IN THIS FEATURE and two of them are
 *        submit-side, so they stay pinned here: a missing session sent the
 *        report with NO screenshots while the panel listed them, and the quota
 *        was checked after uploading so a rate-limited reporter waited for three
 *        images first. Neither is a type error.
 *
 *        ⚠️ AND THE ONE THE WIZARD INTRODUCED: a failed submit must leave the
 *        typed message intact. "Losing what someone just wrote about a bug is
 *        its own bug" was arranged by hand on the old single screen; here it is
 *        the framework's behaviour, which is exactly why it needs asserting
 *        rather than assuming.
 * LINKS: ./ReportBugScreen.tsx; ../lib/bugReportFlow.tsx; ../api/bugReportApi.ts.
 */

import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import { ReportBugScreen } from './ReportBugScreen';

jest.mock('react-native-safe-area-context', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  require('react-native-safe-area-context/jest/mock').default,
);

const mockBack = jest.fn();
const mockReplace = jest.fn();
const mockCanGoBack = jest.fn(() => true);
jest.mock('expo-router', () => ({
  useRouter: () => ({
    back: mockBack,
    replace: mockReplace,
    push: jest.fn(),
    canGoBack: () => mockCanGoBack(),
  }),
}));

const mockShowToast = jest.fn();
jest.mock('@/shared/ui', () => {
  const actual = jest.requireActual('@/shared/ui');
  return {
    ...actual,
    get useToast() {
      return () => ({ show: mockShowToast });
    },
  };
});

const mockSession = jest.fn();
jest.mock('@/features/auth', () => ({
  useSession: () => mockSession(),
}));

jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: jest.fn(),
}));

const mockUpload = jest.fn();
jest.mock('../api/bugScreenshotUpload', () => ({
  MAX_BUG_SCREENSHOTS: 3,
  uploadBugScreenshots: (...args: unknown[]) => mockUpload(...args),
}));

const mockBreadcrumbs = jest.fn();
jest.mock('../lib/bugBreadcrumbs', () => ({
  readBreadcrumbs: () => mockBreadcrumbs(),
}));

const mockLastArea = jest.fn();
jest.mock('../lib/lastArea', () => ({
  readLastArea: () => mockLastArea(),
}));

const mockQuota = jest.fn();
const mockSubmit = jest.fn();
// A REAL class: the real module imports the supabase client, which throws at
// import without env vars, and the submit branches on `instanceof`.
jest.mock('../api/bugReportApi', () => ({
  BUG_REPORT_MAX_LENGTH: 2000,
  readBugReportQuota: () => mockQuota(),
  BugReportError: class BugReportError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.name = 'BugReportError';
      this.code = code;
    }
  },
  submitBugReport: (...args: unknown[]) => mockSubmit(...args),
}));

const mockRead = jest.fn();
jest.mock('../lib/bugDiagnostics', () => {
  const actual = jest.requireActual('../lib/bugDiagnostics');
  return {
    ...actual,
    // describeDiagnostics stays REAL, so what the panel renders is what the
    // shared function produces rather than a fixture agreeing with itself.
    readBugDiagnostics: () => mockRead(),
  };
});

const FULL = {
  appVersion: '1.0.0',
  platform: 'ios' as const,
  osVersion: '18.2',
  deviceModel: 'iPhone 14',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockCanGoBack.mockReturnValue(true);
  mockRead.mockReturnValue(FULL);
  mockSubmit.mockResolvedValue(undefined);
  mockQuota.mockResolvedValue(5);
  mockUpload.mockResolvedValue([]);
  mockBreadcrumbs.mockReturnValue([]);
  mockLastArea.mockReturnValue(null);
  mockSession.mockReturnValue({ status: 'signedIn', userId: 'user-1' });
});

/**
 * The fast path: type one sentence, then Next past both optional steps to the
 * review screen. This helper IS the product claim — if it ever needs more
 * presses, the three-tap report is gone.
 */
async function walkToReview(view: Awaited<ReturnType<typeof render>>, message: string) {
  await act(async () => {
    fireEvent.changeText(view.getByTestId('report-bug-message'), message);
  });
  for (let step = 0; step < 3; step++) {
    await act(async () => {
      fireEvent.press(view.getByText('Next'));
    });
  }
}

describe('the fast path', () => {
  it('⚠️ reaches the review screen in three Nexts, answering nothing optional', async () => {
    const view = await render(<ReportBugScreen />);

    await walkToReview(view, 'The map went blank');

    expect(view.getByText('Send report')).toBeTruthy();
  });

  it('sends what was typed and nothing invented', async () => {
    const view = await render(<ReportBugScreen />);
    await walkToReview(view, 'The map went blank');

    await act(async () => {
      fireEvent.press(view.getByText('Send report'));
    });

    await waitFor(() => expect(mockSubmit).toHaveBeenCalled());
    expect(mockSubmit).toHaveBeenCalledWith('The map went blank', FULL, {
      area: null,
      severity: null,
      frequency: null,
      // `expected` is null rather than '' — an untouched optional field must
      // reach the column as absent, not as an empty answer.
      expected: null,
      breadcrumbs: [],
      screenshotPaths: [],
    });
  });

  it('pre-fills the area from the last tab visited', async () => {
    // A tab NAME, never a route. Read in the initial answers rather than an
    // effect so the picker is never briefly empty and then filled.
    mockLastArea.mockReturnValue('payments');
    const view = await render(<ReportBugScreen />);
    await walkToReview(view, 'Card declined');

    await act(async () => {
      fireEvent.press(view.getByText('Send report'));
    });

    await waitFor(() => expect(mockSubmit).toHaveBeenCalled());
    expect(mockSubmit.mock.calls[0][2]).toMatchObject({ area: 'payments' });
  });
});

describe('⚠️ the two refusals', () => {
  it('says so BEFORE uploading when the hourly limit is already spent', async () => {
    // Asked before the upload so a rate-limited reporter is not made to wait
    // for three images first.
    mockQuota.mockResolvedValue(0);
    const view = await render(<ReportBugScreen />);
    await walkToReview(view, 'Still broken');

    await act(async () => {
      fireEvent.press(view.getByText('Send report'));
    });

    await waitFor(() => expect(mockQuota).toHaveBeenCalled());
    expect(mockUpload).not.toHaveBeenCalled();
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it('⚠️ refuses rather than sending a report without the attached screenshots', async () => {
    // Written first as `shots.length > 0 && userId ? upload(...) : []`, which on
    // a missing session sent the report with NO screenshots while the panel
    // still listed them — the screen claiming MORE than the payload carried,
    // which is the same failure as claiming less and just as bad.
    mockSession.mockReturnValue({ status: 'signedOut', userId: null });
    const view = await render(<ReportBugScreen />);
    await walkToReview(view, 'Cannot sign in');

    await act(async () => {
      fireEvent.press(view.getByText('Send report'));
    });

    await waitFor(() => expect(mockQuota).toHaveBeenCalled());
    expect(mockUpload).not.toHaveBeenCalled();
    expect(mockSubmit).not.toHaveBeenCalled();
  });
});

describe('⚠️ when the send fails', () => {
  it('keeps the typed message, because losing it is its own bug', async () => {
    // The old single screen arranged this by hand (`setSending(false)` and
    // never clearing state). Here the framework stays put on a thrown submit —
    // which is why it is asserted rather than assumed.
    mockSubmit.mockRejectedValue(new Error('network'));
    const view = await render(<ReportBugScreen />);
    await walkToReview(view, 'The map went blank');

    await act(async () => {
      fireEvent.press(view.getByText('Send report'));
    });

    await waitFor(() => expect(mockSubmit).toHaveBeenCalled());
    // Still on review, still able to send again — and the answer survives,
    // which pressing Back to the first step would show.
    expect(view.getByText('Send report')).toBeTruthy();
    expect(mockBack).not.toHaveBeenCalled();
  });
});

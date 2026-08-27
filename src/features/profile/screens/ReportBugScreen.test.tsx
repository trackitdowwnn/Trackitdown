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
import * as ImagePicker from 'expo-image-picker';
import { Alert, StyleSheet } from 'react-native';

import { paletteFor } from '@/shared/theme/colors';

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

// Mocked for the same reason bugReportApi is: the real barrel constructs the
// supabase client at import, which throws without env vars.
const mockNotifyBugReport = jest.fn();
jest.mock('@/features/notifications', () => ({
  notifyBugReport: () => mockNotifyBugReport(),
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
  // The REAL sentence, not a stand-in: the test below asserts the user is
  // shown this instead of raw storage text, so a fixture would let the two
  // drift and still pass.
  BUG_REPORT_FALLBACK_MESSAGE: 'We couldn’t send this. Please try again.',
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

    await walkToReview(view, 'The map went blank when I opened it');

    expect(view.getByText('Send report')).toBeTruthy();
  });

  it('sends what was typed and nothing invented', async () => {
    const view = await render(<ReportBugScreen />);
    await walkToReview(view, 'The map went blank when I opened it');

    await act(async () => {
      fireEvent.press(view.getByText('Send report'));
    });

    await waitFor(() => expect(mockSubmit).toHaveBeenCalled());
    expect(mockSubmit).toHaveBeenCalledWith('The map went blank when I opened it', FULL, {
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

  it('confirms the report was submitted, and only after the RPC returned', async () => {
    // States what HAPPENED rather than promising what someone will do next.
    // Ordering matters more than the wording: a toast fired before the await
    // would tell someone their report landed when it may still fail.
    const view = await render(<ReportBugScreen />);
    await walkToReview(view, 'The map went blank when I opened it');

    expect(mockShowToast).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.press(view.getByText('Send report'));
    });

    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith('Report submitted'));
    expect(mockSubmit).toHaveBeenCalled();
  });

  it('says nothing about success when the send failed', async () => {
    mockSubmit.mockRejectedValue(new Error('network'));
    const view = await render(<ReportBugScreen />);
    await walkToReview(view, 'The map went blank when I opened it');

    await act(async () => {
      fireEvent.press(view.getByText('Send report'));
    });

    await waitFor(() => expect(mockSubmit).toHaveBeenCalled());
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it('asks for the report to be emailed, but only once it is saved', async () => {
    const view = await render(<ReportBugScreen />);
    await walkToReview(view, 'The map went blank when I opened it');

    await act(async () => {
      fireEvent.press(view.getByText('Send report'));
    });

    await waitFor(() => expect(mockNotifyBugReport).toHaveBeenCalled());
    // ⚠️ Carries NOTHING. The Edge Function reads no body and the claim RPC
    // serves only this caller's own oldest unsent report, so there is no id for
    // a patched client to forge and the report text makes no second trip.
    expect(mockNotifyBugReport).toHaveBeenCalledWith();
  });

  it('⚠️ does not ask for an email when the report was never saved', async () => {
    // The email is a side effect of a saved report. Dispatching it on a failed
    // submit would mean the claim drains some OTHER unsent report of theirs on
    // the back of a send that did not happen.
    mockSubmit.mockRejectedValue(new Error('network'));
    const view = await render(<ReportBugScreen />);
    await walkToReview(view, 'The map went blank when I opened it');

    await act(async () => {
      fireEvent.press(view.getByText('Send report'));
    });

    await waitFor(() => expect(mockSubmit).toHaveBeenCalled());
    expect(mockNotifyBugReport).not.toHaveBeenCalled();
  });

  it('pre-fills the area from the last tab visited', async () => {
    // A tab NAME, never a route. Read in the initial answers rather than an
    // effect so the picker is never briefly empty and then filled.
    mockLastArea.mockReturnValue('payments');
    const view = await render(<ReportBugScreen />);
    await walkToReview(view, 'My card was declined at checkout');

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
    await walkToReview(view, 'This is still broken again today');

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
    await walkToReview(view, 'I cannot sign in on my phone');

    await act(async () => {
      fireEvent.press(view.getByText('Send report'));
    });

    await waitFor(() => expect(mockQuota).toHaveBeenCalled());
    expect(mockUpload).not.toHaveBeenCalled();
    expect(mockSubmit).not.toHaveBeenCalled();
  });
});

describe('the message minimum', () => {
  it('⚠️ will not advance on a message shorter than the minimum', async () => {
    // The gate the counter explains. A two-word report cannot be triaged, and
    // it costs the one round-trip we get with someone annoyed enough to write.
    const view = await render(<ReportBugScreen />);

    await act(async () => {
      fireEvent.changeText(view.getByTestId('report-bug-message'), 'map broken');
    });
    await act(async () => {
      fireEvent.press(view.getByText('Next'));
    });

    // Still on step 1: the screenshots step's warning is nowhere in sight.
    expect(view.getByTestId('report-bug-message')).toBeTruthy();
    expect(view.queryByTestId('report-bug-shot-add')).toBeNull();
  });

  it('shows the ask before anything is typed, then counts words once it is', async () => {
    const view = await render(<ReportBugScreen />);
    // ⚠️ includeHiddenElements, because the counter is deliberately hidden from
    // the a11y tree — a bare "12 words" announced between a field and the next
    // question is noise, and a live region there would fire on every keystroke.
    // The input carries the same string as accessibilityHint instead, which is
    // what the last assertion here pins.
    const counter = (text: string) => view.getByText(text, { includeHiddenElements: true });

    expect(counter('At least 20 characters')).toBeTruthy();

    await act(async () => {
      fireEvent.changeText(view.getByTestId('report-bug-message'), 'map broken');
    });
    // Short: the count AND the shortfall, so a refusing Next is explained.
    expect(counter('2 words · 10 more characters')).toBeTruthy();

    await act(async () => {
      fireEvent.changeText(
        view.getByTestId('report-bug-message'),
        'The map went blank when I opened it',
      );
    });
    expect(counter('8 words')).toBeTruthy();
    // The same information reaches a screen reader, announced once on focus.
    expect(view.getByTestId('report-bug-message').props.accessibilityHint).toBe('8 words');
  });
});

describe('⚠️ screenshots', () => {
  /** Type a message, Next twice — the screenshots step. */
  async function walkToScreenshots(view: Awaited<ReturnType<typeof render>>) {
    await act(async () => {
      fireEvent.changeText(view.getByTestId('report-bug-message'), 'Look at this screenshot please');
    });
    for (let step = 0; step < 2; step++) {
      await act(async () => {
        fireEvent.press(view.getByText('Next'));
      });
    }
  }

  it('⚠️ warns what a screenshot can contain, in primary ink', async () => {
    // This sentence is the ENTIRE control over what an image contains —
    // nothing in this codebase can redact the inside of a PNG — so it is
    // asserted both for presence and for weight. It was greyed to
    // textSecondary for one commit, which is the same "most important thing
    // dressed as the least important" mistake the disclosure panel was
    // rescued from.
    const view = await render(<ReportBugScreen />);
    await walkToScreenshots(view);

    const warning = view.getByText(
      'A screenshot can show an address or a number plate. Tap one to check it before you send.',
    );
    const { textPrimary, textSecondary } = paletteFor('light');
    expect(StyleSheet.flatten(warning.props.style).color).toBe(textPrimary);
    expect(StyleSheet.flatten(warning.props.style).color).not.toBe(textSecondary);
  });

  it('⚠️ a removed screenshot does not travel', async () => {
    // The one destructive control in a privacy-sensitive flow: someone looks at
    // the thumbnail, sees their address in it, and takes it out. If removal
    // failed to reach the payload the image would be sent anyway, having been
    // explicitly withdrawn.
    (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({
      canceled: false,
      assets: [
        { uri: 'file://one.png', width: 100, height: 200 },
        { uri: 'file://two.png', width: 100, height: 200 },
      ],
    });
    mockUpload.mockResolvedValue(['user-1/two.jpg']);
    const view = await render(<ReportBugScreen />);
    await walkToScreenshots(view);

    await act(async () => {
      fireEvent.press(view.getByTestId('report-bug-shot-add'));
    });
    // Indexed testIDs — unindexed, this query threw on the second thumbnail.
    await act(async () => {
      fireEvent.press(view.getByTestId('report-bug-shot-remove-0'));
    });
    await act(async () => {
      fireEvent.press(view.getByText('Next'));
    });
    await act(async () => {
      fireEvent.press(view.getByText('Send report'));
    });

    await waitFor(() => expect(mockUpload).toHaveBeenCalled());
    expect(mockUpload).toHaveBeenCalledWith('user-1', [
      { uri: 'file://two.png', width: 100, height: 200 },
    ]);
  });
});

describe('what the triage answers carry', () => {
  it('⚠️ sends the severity and frequency the reporter picked', async () => {
    // Nothing else asserts these reach the RPC. They are the two answers that
    // decide whether a report is looked at today or in a fortnight, and they
    // are set on a step the user can skip entirely — so a wiring mistake looks
    // exactly like a skipped step from the outside.
    const view = await render(<ReportBugScreen />);

    await act(async () => {
      fireEvent.changeText(view.getByTestId('report-bug-message'), 'Payments hang on the spinner');
    });
    await act(async () => {
      fireEvent.press(view.getByText('Next'));
    });
    await act(async () => {
      fireEvent.press(view.getByText('I couldn’t finish something'));
    });
    await act(async () => {
      fireEvent.press(view.getByText('Every time'));
    });
    await act(async () => {
      fireEvent.press(view.getByText('Next'));
    });
    await act(async () => {
      fireEvent.press(view.getByText('Next'));
    });
    await act(async () => {
      fireEvent.press(view.getByText('Send report'));
    });

    await waitFor(() => expect(mockSubmit).toHaveBeenCalled());
    expect(mockSubmit.mock.calls[0][2]).toMatchObject({
      severity: 'blocked',
      frequency: 'always',
    });
  });

  it('sends anyway when the quota probe itself fails', async () => {
    // The probe is ADVISORY — the RPC still enforces. `null` means "could not
    // ask", and refusing on it would let a flaky read block a report the server
    // would have accepted. Only a hard 0 refuses.
    mockQuota.mockResolvedValue(null);
    const view = await render(<ReportBugScreen />);
    await walkToReview(view, 'I cannot tell what went wrong');

    await act(async () => {
      fireEvent.press(view.getByText('Send report'));
    });

    await waitFor(() => expect(mockSubmit).toHaveBeenCalled());
  });

  it('replaces rather than popping when there is nothing to pop to', async () => {
    // Deep-linked straight to the report screen: `router.back()` from an empty
    // stack leaves the user on a dead screen after a successful send.
    mockCanGoBack.mockReturnValue(false);
    const view = await render(<ReportBugScreen />);
    await walkToReview(view, 'I arrived here from a deep link');

    await act(async () => {
      fireEvent.press(view.getByText('Send report'));
    });

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/(tabs)/profile'));
    expect(mockBack).not.toHaveBeenCalled();
  });
});

describe('⚠️ when the send fails', () => {
  it('keeps the typed message, because losing it is its own bug', async () => {
    // The old single screen arranged this by hand (`setSending(false)` and
    // never clearing state). Here the framework stays put on a thrown submit —
    // which is why it is asserted rather than assumed.
    mockSubmit.mockRejectedValue(new Error('network'));
    const view = await render(<ReportBugScreen />);
    await walkToReview(view, 'The map went blank when I opened it');

    await act(async () => {
      fireEvent.press(view.getByText('Send report'));
    });

    await waitFor(() => expect(mockSubmit).toHaveBeenCalled());
    // Still on review, still able to send again — and the answer survives,
    // which pressing Back to the first step would show.
    expect(view.getByText('Send report')).toBeTruthy();
    expect(mockBack).not.toHaveBeenCalled();
  });

  it('⚠️ shows a generic message rather than the storage error text', async () => {
    // THE TEST THAT WOULD HAVE CAUGHT IT. The old single screen owned the catch
    // and rendered `err instanceof BugReportError ? err.message : <generic>`;
    // the wizard controller renders `err.message` for ANY Error, and
    // `uploadBugScreenshots` is documented to throw the RAW Supabase
    // StorageError. So for one commit an RLS refusal reached the user verbatim
    // — server error text on screen, which bugReportApi's own doctrine forbids
    // because it can quote the offending input back.
    const raw = 'new row violates row-level security policy for table "objects"';
    mockUpload.mockRejectedValue(new Error(raw));
    const view = await render(<ReportBugScreen />);
    await walkToReview(view, 'The map went blank when I opened it');

    await act(async () => {
      fireEvent.press(view.getByText('Send report'));
    });

    await waitFor(() => expect(mockUpload).toHaveBeenCalled());
    expect(view.queryByText(raw)).toBeNull();
    expect(view.getByText('We couldn’t send this. Please try again.')).toBeTruthy();
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it('still shows a BugReportError in the words it was written in', async () => {
    // The other half: genericising EVERYTHING would replace "Please sign in to
    // send a report" — which tells someone exactly what to do — with a shrug.
    mockSession.mockReturnValue({ status: 'signedOut', userId: null });
    const view = await render(<ReportBugScreen />);
    await walkToReview(view, 'I cannot sign in on my phone');

    await act(async () => {
      fireEvent.press(view.getByText('Send report'));
    });

    await waitFor(() => expect(mockQuota).toHaveBeenCalled());
    expect(view.getByText('Please sign in to send a report.')).toBeTruthy();
  });

  it('⚠️ freezes the exit while sending, so success cannot pop twice', async () => {
    // Press Send → spinner → X → Discard → onExit() pops, then the submit
    // resolves and handleComplete pops a SECOND screen out from under whoever
    // is now on top. The old form guarded this by hand on its back chevron; the
    // controller now refuses requestExit while busy.
    // ⚠️ THE ALERT MUST BE DRIVEN, or this test passes for the wrong reason.
    // The flow is dirty by now, so an unguarded requestExit reaches
    // `Alert.alert` — which no-ops under Jest, so nothing would pop and the
    // assertion below would hold even with the guard removed. Pressing Discard
    // for the user is what makes the guard the only thing standing between the
    // X and a second router.back().
    const discard = jest
      .spyOn(Alert, 'alert')
      .mockImplementation((_title, _message, buttons) => {
        buttons?.find((button) => button.style === 'destructive')?.onPress?.();
      });

    let release: (() => void) | undefined;
    mockSubmit.mockReturnValue(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    const view = await render(<ReportBugScreen />);
    await walkToReview(view, 'The map went blank when I opened it');

    await act(async () => {
      fireEvent.press(view.getByText('Send report'));
    });
    await waitFor(() => expect(mockSubmit).toHaveBeenCalled());

    // Mid-flight: the X must do nothing at all — the prompt must not even open.
    await act(async () => {
      fireEvent.press(view.getByLabelText('Exit'));
    });
    expect(discard).not.toHaveBeenCalled();
    expect(mockBack).not.toHaveBeenCalled();

    await act(async () => {
      release?.();
    });
    // Exactly one pop, from the success path.
    await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
    discard.mockRestore();
  });
});

/**
 * WHAT:  Tests for the bug-report screen — what the disclosure panel promises,
 *        when the send button is available, and what survives a failure.
 * WHY:   The panel is the feature. It is the only thing that makes the privacy
 *        policy's new bullet true rather than boilerplate, and every way it can
 *        go wrong is a way of collecting something the user was not told about.
 *
 *        ⚠️ THIS FILE EXISTS BECAUSE THREE DEFECTS SHIPPED INVISIBLY. The panel
 *        was conditioned on `lines.length > 0`, so a handset where no field
 *        read showed no promise at all; the platform was folded into the OS
 *        string, so the list said less than the payload; and the button was
 *        `disabled` and `loading` at once. None of them are type errors and all
 *        three are pinned below.
 * LINKS: ./ReportBugScreen.tsx; ../api/bugReportApi.ts; ../lib/bugDiagnostics.ts.
 */

import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

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

// useSession reaches the supabase client, which reaches AsyncStorage's native
// module and fails at import under jest.
const mockSession = jest.fn();
jest.mock('@/features/auth', () => ({
  useSession: () => mockSession(),
}));

const mockPickImages = jest.fn();
jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: (...args: unknown[]) => mockPickImages(...args),
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
// import without env vars, and the screen branches on `instanceof`.
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

/** Nothing chosen and nothing attached — what most cases send. */
const BARE_DETAILS = {
  area: null,
  severity: null,
  frequency: null,
  expected: null,
  breadcrumbs: [],
  screenshotPaths: [],
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
  mockPickImages.mockResolvedValue({ canceled: true });
  mockSession.mockReturnValue({ status: 'signedIn', userId: 'user-1' });
});

describe('the disclosure panel', () => {
  it('lists what will be sent', async () => {
    const { getByText } = await render(<ReportBugScreen />);

    expect(getByText('Sent with your report')).toBeTruthy();
    expect(getByText('1.0.0')).toBeTruthy();
    expect(getByText('iPhone 14 · iOS 18.2')).toBeTruthy();
  });

  it('⚠️ still promises what it always sends when no device field reads', async () => {
    // The panel used to hang on `lines.length > 0`. On a handset where all four
    // came back null the user was told NOTHING — while their account link
    // travelled anyway. The one sentence that is unconditionally true was the
    // one that could disappear.
    mockRead.mockReturnValue({
      appVersion: null,
      platform: null,
      osVersion: null,
      deviceModel: null,
    });

    const { getByText, getByTestId } = await render(<ReportBugScreen />);

    expect(getByTestId('report-bug-diagnostics')).toBeTruthy();
    expect(getByText('Sent with your report')).toBeTruthy();
    expect(getByText(/Your account, so we can reply/)).toBeTruthy();
  });

  it('⚠️ never claims less than the payload carries', async () => {
    // The platform is sent unconditionally, so it must always be shown when it
    // is known. Folded into the OS string, a handset with no readable
    // osVersion displayed "iPhone 14" while `p_platform: 'ios'` was sent.
    mockRead.mockReturnValue({ ...FULL, osVersion: null });

    const { getByText } = await render(<ReportBugScreen />);

    expect(getByText('iPhone 14 · iOS')).toBeTruthy();
  });

  it('⚠️ never claims less than the payload carries, the other way round', async () => {
    // The mirror of the case above, and the one my first fix reintroduced:
    // an unknown platform with a readable OS version. `p_os_version` is sent
    // either way, so the panel has to show it either way.
    mockRead.mockReturnValue({ ...FULL, platform: null });

    const { getByText } = await render(<ReportBugScreen />);

    expect(getByText('iPhone 14 · 18.2')).toBeTruthy();
  });

  it('names the breadcrumb trail, which is the part they did not choose', async () => {
    // Everything else on this screen is something the reporter typed or picked.
    // The trail is not, so it is the one item that has to be disclosed rather
    // than merely visible.
    const { getByText } = await render(<ReportBugScreen />);

    expect(getByText('Recent activity')).toBeTruthy();
    expect(getByText('Step names only')).toBeTruthy();
    expect(getByText(/never what they were about/)).toBeTruthy();
  });

  it('⚠️ counts attached screenshots in the panel', async () => {
    // An image is the attachment whose weight is easiest to forget between
    // picking it and pressing send.
    mockPickImages.mockResolvedValue({
      canceled: false,
      assets: [
        { uri: 'file://a.jpg', width: 100, height: 200 },
        { uri: 'file://b.jpg', width: 100, height: 200 },
      ],
    });

    const { getByText, getByTestId, queryByText } = await render(<ReportBugScreen />);
    expect(queryByText('2 images')).toBeNull();

    await act(async () => {
      fireEvent.press(getByTestId('report-bug-shot-add'));
    });

    expect(getByText('2 images')).toBeTruthy();
  });

  it('⚠️ warns what a screenshot can contain, and lets them check', async () => {
    // The ONLY control over what is inside an image. No redaction helper in
    // this codebase can reach inside a PNG, so the warning plus a tappable
    // thumbnail IS the mitigation — if either goes, the feature stops being
    // defensible.
    mockPickImages.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file://a.jpg', width: 100, height: 200 }],
    });

    const { getByText, getByTestId } = await render(<ReportBugScreen />);

    expect(getByText(/can show an address or a number plate/)).toBeTruthy();

    await act(async () => {
      fireEvent.press(getByTestId('report-bug-shot-add'));
    });
    expect(getByTestId('report-bug-shot-0')).toBeTruthy();
  });

  it('shows the chosen area, so the panel matches what travels', async () => {
    mockLastArea.mockReturnValue('explore');

    const { getByText, getAllByText } = await render(<ReportBugScreen />);

    expect(getByText('Area')).toBeTruthy();
    // TWICE on purpose, and worth pinning: once in the picker as the current
    // answer, once in the disclosure as a thing that will travel. They are
    // different claims — a pre-filled picker says "this is what I assumed",
    // the panel says "this is what I am sending" — and the second is the one
    // that has to be true.
    expect(getAllByText('Explore & map')).toHaveLength(2);
  });
});

describe('the details', () => {
  it('pre-fills the area from the last tab visited', async () => {
    mockLastArea.mockReturnValue('messages');

    const { getByRole, getByTestId } = await render(<ReportBugScreen />);
    await act(async () => {
      fireEvent.changeText(getByTestId('report-bug-message'), 'x');
    });
    await act(async () => {
      fireEvent.press(getByRole('button', { name: 'Send report' }));
    });

    expect(mockSubmit).toHaveBeenCalledWith(
      'x',
      FULL,
      expect.objectContaining({ area: 'messages' }),
    );
  });

  it('sends the breadcrumb trail and the uploaded screenshot paths', async () => {
    mockBreadcrumbs.mockReturnValue(['10:00:00 info map:feed_mounted']);
    mockUpload.mockResolvedValue(['user-1/abc-0.jpg']);
    mockPickImages.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file://a.jpg', width: 100, height: 200 }],
    });

    const { getByRole, getByTestId } = await render(<ReportBugScreen />);
    await act(async () => {
      fireEvent.changeText(getByTestId('report-bug-message'), 'x');
    });
    await act(async () => {
      fireEvent.press(getByTestId('report-bug-shot-add'));
    });
    await act(async () => {
      fireEvent.press(getByRole('button', { name: 'Send report' }));
    });

    expect(mockUpload).toHaveBeenCalledWith('user-1', [
      { uri: 'file://a.jpg', width: 100, height: 200 },
    ]);
    expect(mockSubmit).toHaveBeenCalledWith(
      'x',
      FULL,
      expect.objectContaining({
        breadcrumbs: ['10:00:00 info map:feed_mounted'],
        screenshotPaths: ['user-1/abc-0.jpg'],
      }),
    );
  });

  it('a removed screenshot does not travel', async () => {
    mockPickImages.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file://a.jpg', width: 100, height: 200 }],
    });

    const { getByRole, getByTestId } = await render(<ReportBugScreen />);
    await act(async () => {
      fireEvent.changeText(getByTestId('report-bug-message'), 'x');
    });
    await act(async () => {
      fireEvent.press(getByTestId('report-bug-shot-add'));
    });
    await act(async () => {
      fireEvent.press(getByTestId('report-bug-shot-remove-0'));
    });
    await act(async () => {
      fireEvent.press(getByRole('button', { name: 'Send report' }));
    });

    expect(mockUpload).toHaveBeenCalledWith('user-1', []);
  });

  it('⚠️ says so before uploading when the hourly limit is already spent', async () => {
    // Asked BEFORE the uploads, so a rate-limited reporter is not made to wait
    // for three images and then told it was pointless.
    mockQuota.mockResolvedValue(0);
    mockPickImages.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file://a.jpg', width: 100, height: 200 }],
    });

    const { getByRole, getByTestId } = await render(<ReportBugScreen />);
    await act(async () => {
      fireEvent.changeText(getByTestId('report-bug-message'), 'x');
    });
    await act(async () => {
      fireEvent.press(getByTestId('report-bug-shot-add'));
    });
    await act(async () => {
      fireEvent.press(getByRole('button', { name: 'Send report' }));
    });

    expect(mockUpload).not.toHaveBeenCalled();
    expect(mockSubmit).not.toHaveBeenCalled();
    await waitFor(() => expect(mockShowToast).toHaveBeenCalled());
  });

  it('⚠️ refuses rather than sending a report without the attached screenshots', async () => {
    // Written first as `shots.length > 0 && userId ? upload(...) : []`, which
    // on a missing session sent the report with NO screenshots while the panel
    // still listed them — the screen claiming MORE than the payload carried.
    // That is the same class of failure as claiming less, and just as bad.
    mockSession.mockReturnValue({ status: 'signedOut', userId: null });
    mockPickImages.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file://a.jpg', width: 100, height: 200 }],
    });

    const { getByRole, getByTestId } = await render(<ReportBugScreen />);
    await act(async () => {
      fireEvent.changeText(getByTestId('report-bug-message'), 'x');
    });
    await act(async () => {
      fireEvent.press(getByTestId('report-bug-shot-add'));
    });
    await act(async () => {
      fireEvent.press(getByRole('button', { name: 'Send report' }));
    });

    expect(mockSubmit).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith('Please sign in to send a report.', 'error'),
    );
  });

  it('⚠️ sends the severity and frequency the reporter picked', async () => {
    // These two had NO test at all before the redesign — they appeared in the
    // fixtures only as `null`, so nothing checked that picking one did
    // anything. Swapping the control from chips to CardSelect is exactly the
    // change that would have shipped them broken.
    const { getByRole, getByTestId } = await render(<ReportBugScreen />);
    await act(async () => {
      fireEvent.changeText(getByTestId('report-bug-message'), 'x');
    });
    await act(async () => {
      fireEvent.press(getByRole('radio', { name: /I lost money or data/ }));
    });
    await act(async () => {
      fireEvent.press(getByRole('radio', { name: /Every time/ }));
    });
    await act(async () => {
      fireEvent.press(getByRole('button', { name: 'Send report' }));
    });

    expect(mockSubmit).toHaveBeenCalledWith(
      'x',
      FULL,
      expect.objectContaining({ severity: 'lost', frequency: 'always' }),
    );
  });

  it('marks the picked option as checked, not just visually selected', async () => {
    // CardSelect indicates selection with border colour, which a screen reader
    // cannot see. The radio semantics are what carry it.
    const { getByRole } = await render(<ReportBugScreen />);

    const row = getByRole('radio', { name: /Annoying/ });
    expect(row.props.accessibilityState?.checked).toBe(false);

    await act(async () => {
      fireEvent.press(row);
    });

    expect(
      getByRole('radio', { name: /Annoying/ }).props.accessibilityState?.checked,
    ).toBe(true);
  });

  it('explains the severities rather than leaving three bare labels', async () => {
    // The reason for CardSelect over ChoiceChips: "Annoying" and "I lost money
    // or data" are not comparable until each says what it means.
    const { getByText } = await render(<ReportBugScreen />);

    expect(getByText('It worked, but it was wrong or awkward.')).toBeTruthy();
    expect(getByText('A payment, a post or a sighting went missing or wrong.')).toBeTruthy();
  });

  it('⚠️ keeps Send in the pinned footer, not at the end of the scroll', async () => {
    // The form is six questions long; as the last item in the scroll the
    // primary action sat below the fold and the screen looked unfinished.
    const { getByRole, getByTestId } = await render(<ReportBugScreen />);

    const footer = getByTestId('report-bug-footer');
    const button = getByRole('button', { name: 'Send report' });

    // The button is INSIDE the footer subtree — pinning it is the point, and a
    // second Send elsewhere would mean the old one was never removed.
    expect(within(footer).getByRole('button', { name: 'Send report' })).toBe(button);
  });

  it('⚠️ gives the one required question a heading of its own', async () => {
    // It had none — it lived as a TextField floating label, which rests at body
    // size and shrinks to caption once you type, so the single answer we
    // actually need was quieter than the five optional ones beneath it. A
    // hierarchy defect is invisible to every other test in this file.
    const { getByRole, getByText } = await render(<ReportBugScreen />);

    expect(getByRole('header', { name: 'What went wrong?' })).toBeTruthy();
    // And the band that tells the reader the rest can be skipped.
    expect(getByText('A few details, if you have them')).toBeTruthy();
  });

  it('sends anyway when the quota probe itself fails', async () => {
    // ⚠️ The probe is a courtesy. A broken probe must never be the thing that
    // stops someone reporting a bug — least of all when the bug they are
    // reporting might BE the broken probe.
    mockQuota.mockResolvedValue(null);

    const { getByRole, getByTestId } = await render(<ReportBugScreen />);
    await act(async () => {
      fireEvent.changeText(getByTestId('report-bug-message'), 'x');
    });
    await act(async () => {
      fireEvent.press(getByRole('button', { name: 'Send report' }));
    });

    expect(mockSubmit).toHaveBeenCalled();
  });
});

describe('sending', () => {
  it('will not send an empty or whitespace-only report', async () => {
    const { getByRole, getByTestId } = await render(<ReportBugScreen />);

    fireEvent.press(getByRole('button', { name: 'Send report' }));
    expect(mockSubmit).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.changeText(getByTestId('report-bug-message'), '   ');
    });
    fireEvent.press(getByRole('button', { name: 'Send report' }));
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it('sends the text with the diagnostics, then leaves', async () => {
    const { getByRole, getByTestId } = await render(<ReportBugScreen />);

    await act(async () => {
      fireEvent.changeText(getByTestId('report-bug-message'), 'the map went blank');
    });
    await act(async () => {
      fireEvent.press(getByRole('button', { name: 'Send report' }));
    });

    expect(mockSubmit).toHaveBeenCalledWith('the map went blank', FULL, BARE_DETAILS);
    await waitFor(() => expect(mockBack).toHaveBeenCalled());
    expect(mockShowToast).toHaveBeenCalledWith('Thanks — we’ll take a look.');
  });

  it('replaces rather than popping when there is nothing to pop to', async () => {
    mockCanGoBack.mockReturnValue(false);
    const { getByRole, getByTestId } = await render(<ReportBugScreen />);

    await act(async () => {
      fireEvent.changeText(getByTestId('report-bug-message'), 'deep link, no stack');
    });
    await act(async () => {
      fireEvent.press(getByRole('button', { name: 'Send report' }));
    });

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/(tabs)/profile'));
    expect(mockBack).not.toHaveBeenCalled();
  });

  it('⚠️ keeps the text on the screen when sending fails', async () => {
    // Losing what someone just wrote about a bug is its own bug, and they are
    // by definition already having a bad time with the app.
    const { BugReportError } = jest.requireMock('../api/bugReportApi');
    mockSubmit.mockRejectedValue(new BugReportError('Please try again in an hour.', 'RATE_LIMITED'));

    const { getByRole, getByTestId, getByDisplayValue } = await render(<ReportBugScreen />);
    await act(async () => {
      fireEvent.changeText(getByTestId('report-bug-message'), 'the map went blank');
    });
    await act(async () => {
      fireEvent.press(getByRole('button', { name: 'Send report' }));
    });

    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith('Please try again in an hour.', 'error'),
    );
    expect(getByDisplayValue('the map went blank')).toBeTruthy();
    expect(mockBack).not.toHaveBeenCalled();
  });

  it('shows a generic message rather than an unknown error object', async () => {
    mockSubmit.mockRejectedValue(new Error('TypeError: Network request failed'));

    const { getByRole, getByTestId } = await render(<ReportBugScreen />);
    await act(async () => {
      fireEvent.changeText(getByTestId('report-bug-message'), 'offline');
    });
    await act(async () => {
      fireEvent.press(getByRole('button', { name: 'Send report' }));
    });

    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith(
        'We couldn’t send this. Please try again.',
        'error',
      ),
    );
  });

  it('⚠️ the send button is dimmed for emptiness only, never while sending', async () => {
    // Button's own contract: loading "blocks presses like disabled, but reads
    // as busy not unavailable, and KEEPS THE FULL-OPACITY FILL (a spinner, not
    // a mute)". Passing `disabled={!canSend}` broke exactly that — while
    // sending, the button was disabled AND loading, so it wore the muted
    // opacity underneath its own spinner.
    //
    // ⚠️ ASSERTED ON THE STYLE, NOT accessibilityState. Pressable folds its
    // `disabled` prop (which Button sets to `disabled || loading`) into the
    // host node's accessibilityState, so at that level "busy" and "dimmed and
    // busy" are identical and an a11y assertion here would pass either way.
    // The opacity is what actually differs.
    let resolve: () => void = () => {};
    mockSubmit.mockReturnValue(
      new Promise<void>((r) => {
        resolve = r;
      }),
    );

    const { getByRole, getByTestId } = await render(<ReportBugScreen />);
    // Button expresses full opacity by NOT setting the key, so this asks
    // "is it muted" rather than comparing against 1.
    const isDimmed = () => {
      const flat = StyleSheet.flatten(
        getByRole('button', { name: 'Send report' }).props.style,
      ) as { opacity?: number };
      return flat.opacity !== undefined && flat.opacity < 1;
    };

    // Empty: muted, because there is genuinely nothing to send.
    expect(isDimmed()).toBe(true);

    await act(async () => {
      fireEvent.changeText(getByTestId('report-bug-message'), 'the map went blank');
    });
    expect(isDimmed()).toBe(false);

    fireEvent.press(getByRole('button', { name: 'Send report' }));
    await waitFor(() => expect(mockSubmit).toHaveBeenCalled());

    // Sending: still full opacity. The spinner carries the state on its own.
    expect(isDimmed()).toBe(false);

    await act(async () => {
      resolve();
    });
  });

  it('⚠️ freezes back while sending, so success cannot pop twice', async () => {
    // The success path pops. A back tap mid-flight would pop a SECOND screen
    // out from under whoever is there when the promise resolves.
    let resolve: () => void = () => {};
    mockSubmit.mockReturnValue(
      new Promise<void>((r) => {
        resolve = r;
      }),
    );

    const { getByRole, getByTestId } = await render(<ReportBugScreen />);
    await act(async () => {
      fireEvent.changeText(getByTestId('report-bug-message'), 'the map went blank');
    });
    fireEvent.press(getByRole('button', { name: 'Send report' }));
    await waitFor(() => expect(mockSubmit).toHaveBeenCalled());

    fireEvent.press(getByTestId('report-bug-back'));
    expect(mockBack).not.toHaveBeenCalled();

    await act(async () => {
      resolve();
    });
    await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
  });
});

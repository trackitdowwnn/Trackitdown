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

import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
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

const mockSubmit = jest.fn();
// A REAL class: the real module imports the supabase client, which throws at
// import without env vars, and the screen branches on `instanceof`.
jest.mock('../api/bugReportApi', () => ({
  BUG_REPORT_MAX_LENGTH: 2000,
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

  it('promises no screenshots and nothing from elsewhere in the app', async () => {
    const { getByText } = await render(<ReportBugScreen />);

    expect(getByText(/no screenshots/)).toBeTruthy();
    expect(getByText(/nothing from the rest of the app/)).toBeTruthy();
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

    expect(mockSubmit).toHaveBeenCalledWith('the map went blank', FULL);
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

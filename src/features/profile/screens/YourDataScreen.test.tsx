/**
 * WHAT:  Tests for YourDataScreen — the export is fetched and handed to the
 *        in-app PDF viewer; Save and the PDF's links open outside the app;
 *        the WebView navigates nowhere; failures show a retry.
 * WHY:   The in-app browser showed a blank page for the PDF on Android (owner,
 *        2026-10-26). These pin the replacement's contract with the viewer
 *        page (../lib/pdfViewerHtml.ts), which only a device can draw.
 * LINKS: ./YourDataScreen.tsx.
 */

import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';

import { YourDataScreen } from './YourDataScreen';

const mockRequestExport = jest.fn();
jest.mock('../api/profileApi', () => ({
  requestDataExport: (...a: unknown[]) => mockRequestExport(...a),
}));

jest.mock('expo-router', () => ({ useRouter: () => ({ back: jest.fn(), push: jest.fn() }) }));

const mockToast = jest.fn();
jest.mock('@/shared/ui', () => {
  const actual = jest.requireActual('@/shared/ui');
  return { ...actual, useToast: () => ({ show: mockToast }) };
});

jest.mock('react-native-safe-area-context', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  require('react-native-safe-area-context/jest/mock').default,
);

// The WebView can't run here: keep its props, and its ref's injectJavaScript.
const mockInject = jest.fn();
let mockWebView: Record<string, (...a: never[]) => unknown> = {};
jest.mock('react-native-webview', () => {
  /* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports */
  const React = require('react');
  const { View } = require('react-native');
  /* eslint-enable @typescript-eslint/no-require-imports */
  const WebView = React.forwardRef(function MockWebView(
    props: Record<string, (...a: never[]) => unknown> & { testID?: string },
    ref: unknown,
  ) {
    mockWebView = props;
    React.useImperativeHandle(ref, () => ({ injectJavaScript: mockInject }));
    return React.createElement(View, { testID: props.testID });
  });
  return { WebView };
});

const LINK = { url: 'https://files.example/export.pdf', expiresAt: '2099-01-01T00:00:00Z' };
// "%PDF" — base64 "JVBERg==".
const PDF_BYTES = new Uint8Array([37, 80, 68, 70]);

const message = async (data: object) => {
  await act(async () => {
    (mockWebView.onMessage as (e: { nativeEvent: { data: string } }) => void)({
      nativeEvent: { data: JSON.stringify(data) },
    });
  });
};

let openURL: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  mockWebView = {};
  mockRequestExport.mockResolvedValue(LINK);
  globalThis.fetch = jest.fn().mockResolvedValue({
    ok: true,
    arrayBuffer: async () => PDF_BYTES.buffer,
  }) as unknown as typeof fetch;
  openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
});

/** Renders, waits for the viewer, and has it draw the PDF. */
async function shown() {
  const screen = await render(<YourDataScreen />);
  await screen.findByTestId('your-data-pdf');
  await message({ type: 'ready' });
  await message({ type: 'rendered' });
  return screen;
}

describe('YourDataScreen', () => {
  it('builds the file and hands its bytes to the viewer', async () => {
    const { findByTestId } = await render(<YourDataScreen />);
    await findByTestId('your-data-pdf');
    expect(mockRequestExport).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).toHaveBeenCalledWith(LINK.url);
    await message({ type: 'ready' });
    expect(mockInject).toHaveBeenCalledWith('window.showPdf("JVBERg==");true;');
  });

  it('Save opens the PDF link in the phone’s browser', async () => {
    const { getByText } = await shown();
    await act(async () => {
      fireEvent.press(getByText('Save'));
    });
    expect(openURL).toHaveBeenCalledWith(LINK.url);
    expect(mockRequestExport).toHaveBeenCalledTimes(1);
  });

  it('Save re-signs a link that is about to run out', async () => {
    mockRequestExport
      .mockResolvedValueOnce({ ...LINK, expiresAt: new Date(Date.now() + 5_000).toISOString() })
      .mockResolvedValueOnce({ ...LINK, url: 'https://files.example/fresh.pdf' });
    const { getByText } = await shown();
    await act(async () => {
      fireEvent.press(getByText('Save'));
    });
    await waitFor(() => expect(openURL).toHaveBeenCalledWith('https://files.example/fresh.pdf'));
  });

  it('opens the PDF’s https links outside the app, and nothing else', async () => {
    await shown();
    await message({ type: 'open', url: 'https://www.google.com/maps?q=53.48,-2.24' });
    expect(openURL).toHaveBeenCalledWith('https://www.google.com/maps?q=53.48,-2.24');
    openURL.mockClear();
    await message({ type: 'open', url: 'javascript:alert(1)' });
    await message({ type: 'open', url: 'tel:999' });
    expect(openURL).not.toHaveBeenCalled();
  });

  it('⚠️ the WebView refuses every navigation but its own page', async () => {
    await shown();
    const allow = mockWebView.onShouldStartLoadWithRequest as (r: { url: string }) => boolean;
    expect(allow({ url: 'about:blank' })).toBe(true);
    expect(allow({ url: 'https://evil.example/' })).toBe(false);
    expect(allow({ url: 'file:///data/data/app' })).toBe(false);
  });

  it('a failed export shows a retry that asks again', async () => {
    mockRequestExport.mockRejectedValueOnce(new Error('nope'));
    const { findByText } = await render(<YourDataScreen />);
    const retry = await findByText('Try again');
    expect(await findByText('We couldn’t open your data')).toBeTruthy();
    await act(async () => {
      fireEvent.press(retry);
    });
    await waitFor(() => expect(mockRequestExport).toHaveBeenCalledTimes(2));
  });

  it('a viewer that can’t draw the PDF shows the error', async () => {
    const { findByTestId, findByText } = await render(<YourDataScreen />);
    await findByTestId('your-data-pdf');
    await message({ type: 'error' });
    expect(await findByText('We couldn’t open your data')).toBeTruthy();
  });

  it('Save waits for the PDF to be drawn', async () => {
    const { findByTestId, getByText } = await render(<YourDataScreen />);
    await findByTestId('your-data-pdf');
    await act(async () => {
      fireEvent.press(getByText('Save'));
    });
    expect(openURL).not.toHaveBeenCalled();
  });
});

/**
 * WHAT:  Tests for useCaptcha — no widget while off; one fresh token per ask,
 *        asked only once the page has loaded; failures reject; a challenge
 *        makes room on screen.
 * WHY:   A token that never arrives would leave "Continue" spinning, and a
 *        token asked for before the page loads would be lost.
 * LINKS: src/features/auth/hooks/useCaptcha.tsx.
 */

import { act, render } from '@testing-library/react-native';
import { useEffect } from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { useCaptcha, type Captcha } from './useCaptcha';

type WebViewProps = Record<string, (...a: never[]) => unknown> & { style?: unknown };
/** Records every render of the mocked WebView; the latest props are the live ones. */
const mockRender = jest.fn<void, [WebViewProps]>();
const webView = (): WebViewProps => mockRender.mock.calls[mockRender.mock.calls.length - 1][0];
const mockInject = jest.fn();
jest.mock('react-native-webview', () => {
  /* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports */
  const React = require('react');
  const { View } = require('react-native');
  /* eslint-enable @typescript-eslint/no-require-imports */
  const WebView = React.forwardRef(function MockWebView(
    props: Record<string, (...a: never[]) => unknown> & { testID?: string },
    ref: unknown,
  ) {
    mockRender(props);
    React.useImperativeHandle(ref, () => ({ injectJavaScript: mockInject }));
    return React.createElement(View, { testID: props.testID });
  });
  return { WebView };
});

let captcha: Captcha;
/** Hands the hook's result out after each render (never assigned during it). */
function Harness({ onCaptcha }: { onCaptcha: (c: Captcha) => void }) {
  const value = useCaptcha();
  useEffect(() => onCaptcha(value));
  return <>{value.widget}</>;
}
const harness = () => (
  <Harness
    onCaptcha={(c) => {
      captcha = c;
    }}
  />
);

const post = (data: object) =>
  act(() => {
    (webView().onMessage as (e: unknown) => void)({
      nativeEvent: { data: JSON.stringify(data) },
    });
  });

beforeEach(() => {
  mockInject.mockReset();
  mockRender.mockClear();
  process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY = '0x4AAA';
  process.env.EXPO_PUBLIC_TURNSTILE_ORIGIN = 'https://example.com';
});

afterEach(() => {
  delete process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY;
  delete process.env.EXPO_PUBLIC_TURNSTILE_ORIGIN;
});

it('renders nothing and returns no token while captcha is off', async () => {
  process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY = '';
  const screen = await render(harness());
  expect(screen.queryByTestId('captcha-widget')).toBeNull();
  await expect(captcha.getToken()).resolves.toBeUndefined();
});

it('asks once the page has loaded, and resolves with the token', async () => {
  await render(harness());
  expect(webView().source).toEqual(expect.objectContaining({ baseUrl: 'https://example.com' }));

  let token: Promise<string | undefined> = Promise.resolve(undefined);
  await act(async () => {
    token = captcha.getToken();
  });
  expect(mockInject).not.toHaveBeenCalled(); // not loaded yet

  await act(async () => {
    (webView().onLoadEnd as () => void)();
  });
  expect(mockInject).toHaveBeenCalledWith('window.getToken();true;');

  await post({ type: 'token', token: 'tok-1' });
  await expect(token).resolves.toBe('tok-1');
});

it('rejects when Turnstile reports an error', async () => {
  await render(harness());
  await act(async () => {
    (webView().onLoadEnd as () => void)();
  });
  let token: Promise<string | undefined> = Promise.resolve(undefined);
  await act(async () => {
    token = captcha.getToken();
  });
  // Caught before the error is posted: the rejection lands inside act().
  const outcome = token.then(
    () => null,
    (error: unknown) => error,
  );
  await post({ type: 'error' });
  expect(await outcome).toMatchObject({ name: 'CaptchaError' });
});

it('makes room for a challenge, then shrinks back', async () => {
  await render(harness());
  const height = () => StyleSheet.flatten(webView().style as StyleProp<ViewStyle>)?.height;
  expect(height()).toBe(1);
  await post({ type: 'interactive' });
  expect(height()).toBe(70);
  await post({ type: 'done' });
  expect(height()).toBe(1);
});

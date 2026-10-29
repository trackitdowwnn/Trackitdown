/**
 * WHAT:  useCaptcha — a hidden Turnstile WebView plus `getToken()`, which asks
 *        it for one fresh token for one email-code request.
 * WHY:   Security audit lead 5 (see lib/turnstile.ts). The widget is invisible
 *        unless Cloudflare wants a tap; then it grows to show the challenge
 *        where the person already is. Not configured → no widget, and
 *        getToken resolves undefined, so requestEmailOtp sends no token.
 * LINKS: lib/turnstile.ts; components/AuthSheet.tsx (EmailStep, OtpStep).
 */

import { useCallback, useRef, useState, type ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { captchaConfig, parseTurnstileMessage, turnstileHtml } from '../lib/turnstile';

/** Longest a code request waits for a token (an unanswered tap, no network). */
const TOKEN_TIMEOUT_MS = 30_000;
/** Turnstile's interactive widget is 65pt tall. */
const CHALLENGE_HEIGHT = 70;

export class CaptchaError extends Error {
  constructor(reason: 'failed' | 'timeout' | 'superseded') {
    super(`captcha_${reason}`);
    this.name = 'CaptchaError';
  }
}

interface Pending {
  resolve: (token: string) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface Captcha {
  /** Render this inside the step, where a challenge should appear. */
  widget: ReactNode;
  /** A fresh, single-use token — or undefined when captcha is off. */
  getToken: () => Promise<string | undefined>;
}

export function useCaptcha(): Captcha {
  const [config] = useState(captchaConfig);
  // shortcut: react-native-webview 14.0.1 types its class as WebView<P = undefined>, so a
  // bare <WebView> has never props; <object> restores them. Drop it once fixed upstream.
  const ref = useRef<WebView<object>>(null);
  const pending = useRef<Pending | null>(null);
  const loaded = useRef(false);
  const [challenge, setChallenge] = useState(false);

  const settle = (finish: (p: Pending) => void) => {
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    clearTimeout(p.timer);
    finish(p);
  };

  const ask = () => ref.current?.injectJavaScript('window.getToken();true;');

  const getToken = useCallback((): Promise<string | undefined> => {
    if (!config) return Promise.resolve(undefined);
    settle((p) => p.reject(new CaptchaError('superseded')));
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(
        () => settle((p) => p.reject(new CaptchaError('timeout'))),
        TOKEN_TIMEOUT_MS,
      );
      pending.current = { resolve, reject, timer };
      // Before the page has loaded, the ask is made from onLoadEnd instead.
      if (loaded.current) ask();
    });
  }, [config]);

  if (!config) return { widget: null, getToken };

  const onMessage = (event: WebViewMessageEvent) => {
    const message = parseTurnstileMessage(event.nativeEvent.data);
    if (!message) return;
    if (message.type === 'interactive') return setChallenge(true);
    if (message.type === 'done') return setChallenge(false);
    setChallenge(false);
    if (message.type === 'token') settle((p) => p.resolve(message.token));
    else settle((p) => p.reject(new CaptchaError('failed')));
  };

  const widget = (
    <WebView<object>
      ref={ref}
      testID="captcha-widget"
      accessibilityLabel="Security check"
      source={{ html: turnstileHtml(config.siteKey), baseUrl: config.origin }}
      originWhitelist={['https://*']}
      onMessage={onMessage}
      onLoadEnd={() => {
        loaded.current = true;
        if (pending.current) ask();
      }}
      // The page stays put: only Turnstile's own frames may load.
      onShouldStartLoadWithRequest={(request) =>
        request.isTopFrame === false || request.url.startsWith(config.origin)
      }
      scrollEnabled={false}
      // 1pt, not 0: some Android WebViews stop running a zero-height page.
      style={[styles.widget, { height: challenge ? CHALLENGE_HEIGHT : 1 }]}
    />
  );
  return { widget, getToken };
}

const styles = StyleSheet.create({
  widget: { width: '100%', backgroundColor: 'transparent' },
});

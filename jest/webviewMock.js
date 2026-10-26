/**
 * WHAT:  Default Jest stand-in for react-native-webview — a plain View.
 * WHY:   Jest has no native RNCWebView module, so merely IMPORTING the package
 *        throws. The auth sheet (hooks/useCaptcha) is reachable from many
 *        suites through '@/features/auth'. Suites that drive a WebView
 *        (YourDataScreen, useCaptcha) still jest.mock it themselves, which
 *        overrides this.
 * LINKS: package.json "jest.setupFiles"; src/features/auth/hooks/useCaptcha.tsx.
 */

/* global jest */

jest.mock('react-native-webview', () => {
  const React = require('react');
  const { View } = require('react-native');
  const WebView = React.forwardRef(function MockWebView(props, _ref) {
    return React.createElement(View, { testID: props.testID });
  });
  return { WebView, default: WebView };
});

/**
 * WHAT:  Tests for SocialSignInButtons — which providers show where.
 * WHY:   2026-10-15: "Continue with Google" showed on every Android build and
 *        could only fail until Google was set up. A button that can only fail
 *        is worse than none — and so is an "or" with nothing after it.
 * LINKS: ./SocialSignInButtons.tsx; ../api/authApi.ts (isGoogleSignInConfigured).
 */

import { render } from '@testing-library/react-native';
import { Platform } from 'react-native';

import { SocialSignInButtons } from './SocialSignInButtons';

jest.mock('expo-apple-authentication', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  const { Text } = require('react-native');
  return {
    AppleAuthenticationButton: () => <Text>Continue with Apple</Text>,
    AppleAuthenticationButtonType: { CONTINUE: 1 },
    AppleAuthenticationButtonStyle: { BLACK: 2 },
  };
});

const props = { onApple: jest.fn(), onGoogle: jest.fn() };

afterEach(() => {
  jest.restoreAllMocks();
});

it('Android, Google set up: "Continue with Google", no Apple', async () => {
  jest.replaceProperty(Platform, 'OS', 'android');
  const view = await render(<SocialSignInButtons {...props} showGoogle />);
  expect(view.getByText('Continue with Google')).toBeTruthy();
  expect(view.queryByText('Continue with Apple')).toBeNull();
});

it('⚠️ Android, Google not set up: nothing at all — not even a lonely "or"', async () => {
  jest.replaceProperty(Platform, 'OS', 'android');
  const view = await render(<SocialSignInButtons {...props} showGoogle={false} />);
  expect(view.queryByText('Continue with Google')).toBeNull();
  expect(view.queryByText('or')).toBeNull();
});

it('iOS, Google not set up: Apple alone', async () => {
  jest.replaceProperty(Platform, 'OS', 'ios');
  const view = await render(<SocialSignInButtons {...props} showGoogle={false} />);
  expect(view.getByText('Continue with Apple')).toBeTruthy();
  expect(view.queryByText('Continue with Google')).toBeNull();
});

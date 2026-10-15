/**
 * WHAT:  Tests for SocialSignInButtons — which providers show where, and that
 *        each wears its own brand: Google's button and four-colour logo, Apple's
 *        native button, both following the theme as their guidelines say.
 * WHY:   2026-10-15. "Continue with Google" showed on every Android build and
 *        could only fail until Google was set up; and the owner asked for the
 *        logos "with the correct colours" — brand colours that must NOT drift
 *        with our palette, which no screenshot review would catch.
 * LINKS: ./SocialSignInButtons.tsx; ../api/authApi.ts (isGoogleSignInConfigured).
 */

import { render } from '@testing-library/react-native';
import { Platform, StyleSheet } from 'react-native';

import { ThemeControlsContext } from '@/shared/theme/paletteContext';

import { SocialSignInButtons } from './SocialSignInButtons';

const mockAppleButton = jest.fn();
jest.mock('expo-apple-authentication', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories cannot use ESM imports
  const { Text } = require('react-native');
  return {
    AppleAuthenticationButton: (props: { buttonStyle: number }) => {
      mockAppleButton(props);
      return <Text>Continue with Apple</Text>;
    },
    AppleAuthenticationButtonType: { CONTINUE: 1 },
    AppleAuthenticationButtonStyle: { WHITE: 0, WHITE_OUTLINE: 1, BLACK: 2 },
  };
});

const props = { onApple: jest.fn(), onGoogle: jest.fn() };

/** Every node of a given type in the rendered tree (BrandMark.test's idiom). */
function nodesOfType(node: unknown, type: string, found: Record<string, unknown>[] = []) {
  if (!node || typeof node !== 'object') return found;
  const n = node as { type?: string; props?: Record<string, unknown>; children?: unknown[] };
  if (n.type === type && n.props) found.push(n.props);
  for (const child of n.children ?? []) nodesOfType(child, type, found);
  return found;
}

/** react-native-svg packs colours into an ARGB int. #4285F4 -> 0xFF4285F4. */
const argb = (hex: string) => (0xff000000 + parseInt(hex.slice(1), 16)) >>> 0;

const renderIn = (scheme: 'light' | 'dark', showGoogle = true) =>
  render(
    <ThemeControlsContext.Provider value={{ preference: scheme, scheme, setPreference: jest.fn() }}>
      <SocialSignInButtons {...props} showGoogle={showGoogle} />
    </ThemeControlsContext.Provider>,
  );

afterEach(() => {
  jest.restoreAllMocks();
  mockAppleButton.mockClear();
});

describe('which providers show', () => {
  it('Android, Google set up: "Continue with Google", no Apple', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    const view = await renderIn('light');
    expect(view.getByText('Continue with Google')).toBeTruthy();
    expect(view.queryByText('Continue with Apple')).toBeNull();
  });

  it('⚠️ Android, Google not set up: nothing at all — not even a lonely "or"', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    const view = await renderIn('light', false);
    expect(view.queryByText('Continue with Google')).toBeNull();
    expect(view.queryByText('or')).toBeNull();
  });

  it('iOS, Google not set up: Apple alone', async () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    const view = await renderIn('light', false);
    expect(view.getByText('Continue with Apple')).toBeTruthy();
    expect(view.queryByText('Continue with Google')).toBeNull();
  });
});

describe('⚠️ the brands’ own colours (owner: "with the correct colours")', () => {
  const googleStyle = (view: Awaited<ReturnType<typeof renderIn>>) =>
    StyleSheet.flatten(view.getByTestId('google-sign-in').props.style);
  const labelColour = (view: Awaited<ReturnType<typeof renderIn>>) =>
    StyleSheet.flatten(view.getByText('Continue with Google').props.style).color;

  it('Google, light: white, #747775 border, #1F1F1F text, the four-colour G', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    const view = await renderIn('light');
    expect(googleStyle(view)).toMatchObject({
      backgroundColor: '#FFFFFF',
      borderColor: '#747775',
      borderWidth: 1,
    });
    expect(labelColour(view)).toBe('#1F1F1F');
    // The logo is drawn, in Google's four colours — never recoloured.
    const fills = nodesOfType(view.toJSON(), 'RNSVGPath').map(
      // Signed in the tree, unsigned in argb(): compare them as unsigned.
      (path) => (path.fill as { payload: number }).payload >>> 0,
    );
    expect(new Set(fills)).toEqual(
      new Set(['#EA4335', '#4285F4', '#FBBC05', '#34A853'].map(argb)),
    );
  });

  it('Google, dark: Google’s own dark variant — #131314, #8E918F border, #E3E3E3 text', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    const view = await renderIn('dark');
    expect(googleStyle(view)).toMatchObject({
      backgroundColor: '#131314',
      borderColor: '#8E918F',
    });
    expect(labelColour(view)).toBe('#E3E3E3');
  });

  it('Google reads as one button to a screen reader, logo hidden', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    const view = await renderIn('light');
    expect(view.getByRole('button', { name: 'Continue with Google' })).toBeTruthy();
    // Hidden from assistive tech — so only a hidden-inclusive query finds it.
    expect(view.queryByTestId('google-logo')).toBeNull();
    expect(view.getByTestId('google-logo', { includeHiddenElements: true })).toBeTruthy();
  });

  it.each([
    ['light', 2],
    ['dark', 0],
  ] as const)('Apple, %s mode: Apple’s native style %i (BLACK on light, WHITE on dark)', async (scheme, style) => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    await renderIn(scheme);
    expect(mockAppleButton).toHaveBeenCalledWith(expect.objectContaining({ buttonStyle: style }));
  });
});

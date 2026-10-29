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

const renderIn = (scheme: 'light' | 'dark', showGoogle = true, showAppleWeb = false) =>
  render(
    <ThemeControlsContext.Provider value={{ preference: scheme, scheme, setPreference: jest.fn() }}>
      <SocialSignInButtons {...props} showGoogle={showGoogle} showAppleWeb={showAppleWeb} />
    </ThemeControlsContext.Provider>,
  );

afterEach(() => {
  jest.restoreAllMocks();
  mockAppleButton.mockClear();
});

describe('the spinner sits on the button that was tapped (device check, 2026-10-29)', () => {
  it('Google in flight: a spinner on Google, none on Apple, both disabled', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    const view = await render(
      <ThemeControlsContext.Provider
        value={{ preference: 'light', scheme: 'light', setPreference: jest.fn() }}
      >
        <SocialSignInButtons {...props} showAppleWeb disabled loading="google" />
      </ThemeControlsContext.Provider>,
    );
    expect(view.getByTestId('google-sign-in-spinner')).toBeTruthy();
    expect(view.queryByTestId('apple-sign-in-spinner')).toBeNull();
    expect(view.getByTestId('google-sign-in').props.accessibilityState).toMatchObject({
      disabled: true,
      busy: true,
    });
    // The spinner alone, like Continue's (owner, same day): Google's logo and
    // label hidden underneath, Apple's untouched.
    const opacityAround = (label: string) =>
      StyleSheet.flatten(view.getByText(label).parent?.props.style)?.opacity;
    expect(opacityAround('Continue with Google')).toBe(0);
    expect(opacityAround('Continue with Apple')).not.toBe(0);
  });

  it('nothing in flight: no spinner anywhere', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    const view = await renderIn('light', true, true);
    expect(view.queryByTestId('google-sign-in-spinner')).toBeNull();
    expect(view.queryByTestId('apple-sign-in-spinner')).toBeNull();
  });
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

describe('Apple on Android — our button, Apple’s rules (2026-10-15)', () => {
  const appleStyle = (view: Awaited<ReturnType<typeof renderIn>>) =>
    StyleSheet.flatten(view.getByTestId('apple-sign-in').props.style);
  const appleInk = (view: Awaited<ReturnType<typeof renderIn>>) =>
    StyleSheet.flatten(view.getByText('Continue with Apple').props.style).color;
  const logoFill = (view: Awaited<ReturnType<typeof renderIn>>) =>
    (nodesOfType(view.toJSON(), 'RNSVGPath')
      .map((path) => (path.fill as { payload: number }).payload >>> 0)
      .find((fill) => fill === argb('#FFFFFF') || fill === argb('#000000')));

  beforeEach(() => {
    jest.replaceProperty(Platform, 'OS', 'android');
  });

  it('⚠️ switched off until the setup is done: no Apple button at all', async () => {
    const view = await renderIn('light', true, false);
    expect(view.queryByText('Continue with Apple')).toBeNull();
  });

  it('light: black, with the Apple logo and title in white', async () => {
    const view = await renderIn('light', false, true);
    expect(appleStyle(view)).toMatchObject({ backgroundColor: '#000000' });
    expect(appleInk(view)).toBe('#FFFFFF');
    expect(logoFill(view)).toBe(argb('#FFFFFF'));
  });

  it('dark: white, with the logo and title in black', async () => {
    const view = await renderIn('dark', false, true);
    expect(appleStyle(view)).toMatchObject({ backgroundColor: '#FFFFFF' });
    expect(appleInk(view)).toBe('#000000');
    expect(logoFill(view)).toBe(argb('#000000'));
  });

  it('Apple first, then Google — at least as prominent as any other', async () => {
    const view = await renderIn('light', true, true);
    const order = view
      .getAllByRole('button')
      .map((button) => button.props.accessibilityLabel as string);
    expect(order).toEqual(['Continue with Apple', 'Continue with Google']);
  });

  it('one accessible button; the logo is hidden from screen readers', async () => {
    const view = await renderIn('light', false, true);
    expect(view.getByRole('button', { name: 'Continue with Apple' })).toBeTruthy();
    expect(view.queryByTestId('apple-logo')).toBeNull();
    expect(view.getByTestId('apple-logo', { includeHiddenElements: true })).toBeTruthy();
  });

  it('iOS never draws it — the native button is Apple’s own', async () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    const view = await renderIn('light', false, true);
    expect(view.queryByTestId('apple-sign-in')).toBeNull();
    expect(view.getByText('Continue with Apple')).toBeTruthy(); // the native one
  });
});

describe('sign-in best-practice pass (2026-10-15)', () => {
  beforeEach(() => {
    jest.replaceProperty(Platform, 'OS', 'android');
  });

  it('with the social buttons first, the "or" comes AFTER them', async () => {
    const view = await render(
      <ThemeControlsContext.Provider value={{ preference: 'light', scheme: 'light', setPreference: jest.fn() }}>
        <SocialSignInButtons {...props} showGoogle dividerPosition="after" />
      </ThemeControlsContext.Provider>,
    );
    const tree = JSON.stringify(view.toJSON());
    expect(tree.indexOf('Continue with Google')).toBeLessThan(tree.indexOf('"or"'));
  });

  it('⚠️ brand buttons have a MINIMUM height — large text grows them, never clips the label', async () => {
    const view = await renderIn('light', true, true);
    for (const id of ['google-sign-in', 'apple-sign-in']) {
      const style = StyleSheet.flatten(view.getByTestId(id).props.style);
      expect(style.minHeight).toBeGreaterThan(0);
      expect(style.height).toBeUndefined();
    }
  });
});

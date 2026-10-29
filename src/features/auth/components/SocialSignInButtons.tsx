/**
 * WHAT:  SocialSignInButtons — the "or" divider plus the native Sign in with
 *        Apple button (iOS only) and Google's own "Continue with Google"
 *        button, logo and all.
 * WHY:   Both providers return an idToken the auth layer exchanges via
 *        signInWithIdToken (no deep link). The screen owns the flow (calls
 *        authApi, branches on the result); this component is presentational
 *        and calls back on press.
 *
 *        ⚠️ BRAND RULES, NOT OUR THEME (owner, 2026-10-15: "the google and
 *        apple logo … with the correct colours"; chose the official styles).
 *        These two buttons are the one place the app's monochrome palette
 *        steps aside, because both companies require their own look:
 *          • Google (Identity branding guidelines): the official four-colour
 *            "G", unmodified, on a white button with a #747775 border and
 *            #1F1F1F text — or the dark variant (#131314 / #8E918F / #E3E3E3)
 *            in dark mode — in Roboto Medium (Android's system font).
 *          • Apple (HIG): Apple's own native button on iOS, black in light
 *            mode and white in dark mode. On Android — which has no native
 *            Apple button, since Apple has no Android kit — our own button
 *            drawn to Apple's custom-button rules (logo + title in one ink,
 *            on black or white), switched off until the Apple Developer setup
 *            is done (owner asked for it, 2026-10-15).
 * LINKS: src/features/auth/components/AuthSheet.tsx (owner);
 *        src/features/auth/api/authApi.ts (signInWithApple/Google);
 *        src/features/auth/README.md (provider setup);
 *        https://developers.google.com/identity/branding-guidelines.
 */

import * as AppleAuthentication from 'expo-apple-authentication';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import {
  opacity,
  radii,
  sizes,
  spacing,
  typography,
  useThemeControls,
  useThemedStyles,
  type Palette,
} from '@/shared/theme';

export interface SocialSignInButtonsProps {
  onApple: () => void;
  onGoogle: () => void;
  /** Disabled while another sign-in action is in flight. */
  disabled?: boolean;
  /** The provider whose sign-in is in flight: its button shows a spinner. */
  loading?: 'google' | 'apple' | null;
  /** False until Google is set up in this bundle — a button that can only
   *  fail is worse than none (2026-10-15). */
  showGoogle?: boolean;
  /** Android's Apple button (Apple's web flow) — false until the Apple
   *  Developer + Supabase setup is done. iOS always has the native one. */
  showAppleWeb?: boolean;
  /** Where the "or" sits: before the buttons (email first) or after them
   *  (social first — the sign-in sheet since 2026-10-15). */
  dividerPosition?: 'before' | 'after';
}

export function SocialSignInButtons({
  onApple,
  onGoogle,
  disabled,
  loading = null,
  showGoogle = true,
  showAppleWeb = false,
  dividerPosition = 'before',
}: SocialSignInButtonsProps) {
  const styles = useThemedStyles(makeStyles);
  const { scheme } = useThemeControls();
  const showApple = Platform.OS === 'ios';
  const showAppleOnAndroid = Platform.OS === 'android' && showAppleWeb;
  // Nothing to offer: no lonely "or" either.
  if (!showApple && !showAppleOnAndroid && !showGoogle) return null;

  const divider = (
    <View style={styles.dividerRow}>
      <View style={styles.line} />
      <Text style={styles.or}>or</Text>
      <View style={styles.line} />
    </View>
  );

  return (
    <View style={styles.root}>
      {dividerPosition === 'before' ? divider : null}

      {showApple ? (
        // pointerEvents gates the native Apple button on `disabled` too — it
        // has no disabled prop — so a busy state blocks BOTH providers.
        <View
          style={disabled ? styles.disabled : undefined}
          pointerEvents={disabled ? 'none' : 'auto'}
        >
          <AppleAuthentication.AppleAuthenticationButton
            buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
            // Apple's HIG: black on a light background, white on a dark one.
            buttonStyle={
              scheme === 'dark'
                ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
                : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
            }
            cornerRadius={radii.md}
            style={styles.nativeAppleButton}
            onPress={onApple}
          />
        </View>
      ) : null}

      {/* Apple first, as on iOS — its guidelines want it at least as
          prominent as any other sign-in. */}
      {showAppleOnAndroid ? (
        <AppleSignInButton
          onPress={onApple}
          disabled={disabled}
          loading={loading === 'apple'}
          dark={scheme === 'dark'}
        />
      ) : null}

      {showGoogle ? (
        <GoogleSignInButton
          onPress={onGoogle}
          disabled={disabled}
          loading={loading === 'google'}
          dark={scheme === 'dark'}
        />
      ) : null}

      {dividerPosition === 'after' ? divider : null}
    </View>
  );
}

/**
 * Google's colours, as its branding guidelines give them — deliberately NOT
 * palette tokens: they must not change when our theme does.
 */
const GOOGLE = {
  light: { fill: '#FFFFFF', border: '#747775', text: '#1F1F1F' },
  dark: { fill: '#131314', border: '#8E918F', text: '#E3E3E3' },
} as const;

/** Google's "Continue with Google" button, to its branding guidelines. */
function GoogleSignInButton({
  onPress,
  disabled,
  loading,
  dark,
}: {
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  dark: boolean;
}) {
  const styles = useThemedStyles(makeStyles);
  const colours = dark ? GOOGLE.dark : GOOGLE.light;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel="Continue with Google"
      accessibilityState={{ disabled: Boolean(disabled), busy: Boolean(loading) }}
      testID="google-sign-in"
      style={({ pressed }) => [
        styles.brandButton,
        styles.googleButton,
        { backgroundColor: colours.fill, borderColor: colours.border },
        pressed && !disabled ? styles.pressed : null,
        disabled ? styles.disabled : null,
      ]}
    >
      {/* While busy, the spinner alone, centred — like Button's: the content
          stays mounted (hidden) so the button keeps its size. */}
      <View style={[styles.brandContent, loading && styles.hidden]}>
        <GoogleLogo />
        <Text style={[styles.googleLabel, { color: colours.text }]}>Continue with Google</Text>
      </View>
      {loading ? (
        <ActivityIndicator
          size="small"
          color={colours.text}
          style={StyleSheet.absoluteFill}
          testID="google-sign-in-spinner"
        />
      ) : null}
    </Pressable>
  );
}

/** The official four-colour "G" — unmodified, as Google requires. */
function GoogleLogo() {
  return (
    <Svg
      width={GOOGLE_LOGO}
      height={GOOGLE_LOGO}
      viewBox="0 0 48 48"
      testID="google-logo"
      accessibilityElementsHidden
      importantForAccessibility="no"
    >
      <Path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <Path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <Path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <Path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </Svg>
  );
}

/** Google's guidelines: an 18–20dp mark. */
const GOOGLE_LOGO = 20;

/**
 * Apple's colours for a custom "Continue with Apple" button (HIG): black with
 * a white logo on a light background, white with a black logo on a dark one.
 * Brand values, deliberately not palette tokens.
 */
const APPLE = {
  light: { fill: '#000000', ink: '#FFFFFF' },
  dark: { fill: '#FFFFFF', ink: '#000000' },
} as const;

/**
 * "Continue with Apple" on ANDROID — Apple's web sign-in, which has no native
 * button there, drawn to Apple's HIG for custom buttons: the Apple logo and
 * the title in one colour, on black or white, at the same size as Google's.
 */
function AppleSignInButton({
  onPress,
  disabled,
  loading,
  dark,
}: {
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  dark: boolean;
}) {
  const styles = useThemedStyles(makeStyles);
  const colours = dark ? APPLE.dark : APPLE.light;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel="Continue with Apple"
      accessibilityState={{ disabled: Boolean(disabled), busy: Boolean(loading) }}
      testID="apple-sign-in"
      style={({ pressed }) => [
        styles.brandButton,
        styles.appleButton,
        { backgroundColor: colours.fill },
        pressed && !disabled ? styles.pressed : null,
        disabled ? styles.disabled : null,
      ]}
    >
      <View style={[styles.brandContent, loading && styles.hidden]}>
        <AppleLogo colour={colours.ink} />
        <Text style={[styles.appleLabel, { color: colours.ink }]}>Continue with Apple</Text>
      </View>
      {loading ? (
        <ActivityIndicator
          size="small"
          color={colours.ink}
          style={StyleSheet.absoluteFill}
          testID="apple-sign-in-spinner"
        />
      ) : null}
    </Pressable>
  );
}

/** The Apple logo, in the button's ink. */
function AppleLogo({ colour }: { colour: string }) {
  return (
    <Svg
      width={APPLE_LOGO * (814 / 1000)}
      height={APPLE_LOGO}
      viewBox="0 0 814 1000"
      testID="apple-logo"
      accessibilityElementsHidden
      importantForAccessibility="no"
    >
      <Path
        fill={colour}
        d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76.5 0-103.7 40.8-165.9 40.8s-105.6-57-155.5-127C46.7 790.7 0 663 0 541.8c0-194.4 126.4-297.5 250.8-297.5 66.1 0 121.2 43.4 162.7 43.4 39.5 0 101.1-46 176.3-46 28.5 0 130.9 2.6 198.3 99.2zm-234-181.5c31.1-36.9 53.1-88.1 53.1-139.3 0-7.1-.6-14.3-1.9-20.1-50.6 1.9-110.8 33.7-147.1 75.8-28.5 32.4-55.1 83.6-55.1 135.5 0 7.8 1.3 15.6 1.9 18.1 3.2.6 8.4 1.3 13.6 1.3 45.4 0 102.5-30.4 135.5-71.3z"
      />
    </Svg>
  );
}

/** The Apple mark's height — level with Google's G. */
const APPLE_LOGO = 20;

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    root: {
      gap: spacing.md,
    },
    dividerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
    },
    line: {
      flex: 1,
      height: StyleSheet.hairlineWidth,
      backgroundColor: c.border,
    },
    or: {
      ...typography.caption,
      color: c.textSecondary,
    },
    // Our brand buttons share the app's control height and corner, so they
    // sit level with "Continue". A MINIMUM, not a fixed height (2026-10-15):
    // at large text sizes the label grows instead of being clipped.
    brandButton: {
      minHeight: sizes.control,
      paddingVertical: spacing.sm,
    },
    // Apple's native button draws itself, so it needs a fixed height.
    nativeAppleButton: {
      height: sizes.control,
    },
    // Logo + label in a row; hidden (not removed) under the busy spinner.
    brandContent: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    },
    hidden: {
      opacity: 0,
    },
    googleButton: {
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radii.md,
      borderWidth: 1,
      paddingHorizontal: spacing.md,
    },
    // Google asks for Roboto Medium: Android's system sans at medium weight.
    googleLabel: {
      fontSize: typography.body.fontSize,
      fontFamily: Platform.OS === 'android' ? 'sans-serif-medium' : undefined,
      fontWeight: Platform.OS === 'android' ? undefined : '500',
    },
    appleButton: {
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radii.md,
      paddingHorizontal: spacing.md,
    },
    appleLabel: {
      fontSize: typography.body.fontSize,
      fontFamily: Platform.OS === 'android' ? 'sans-serif-medium' : undefined,
      fontWeight: Platform.OS === 'android' ? undefined : '500',
    },
    pressed: {
      opacity: opacity.pressed,
    },
    disabled: {
      opacity: opacity.disabled,
    },
  });

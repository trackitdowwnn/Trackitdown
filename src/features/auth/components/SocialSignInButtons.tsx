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
 *          • Apple (HIG): Apple's own native button, black in light mode and
 *            white in dark mode. iOS only: Apple has no Android sign-in kit,
 *            and Apple on Android waits for the iOS build (owner, 2026-10-15).
 * LINKS: src/features/auth/components/AuthSheet.tsx (owner);
 *        src/features/auth/api/authApi.ts (signInWithApple/Google);
 *        src/features/auth/README.md (provider setup);
 *        https://developers.google.com/identity/branding-guidelines.
 */

import * as AppleAuthentication from 'expo-apple-authentication';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
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
  /** False until Google is set up in this bundle — a button that can only
   *  fail is worse than none (2026-10-15). */
  showGoogle?: boolean;
}

export function SocialSignInButtons({
  onApple,
  onGoogle,
  disabled,
  showGoogle = true,
}: SocialSignInButtonsProps) {
  const styles = useThemedStyles(makeStyles);
  const { scheme } = useThemeControls();
  const showApple = Platform.OS === 'ios';
  // Nothing to offer (Android, Google not set up): no lonely "or" either.
  if (!showApple && !showGoogle) return null;

  return (
    <View style={styles.root}>
      <View style={styles.dividerRow}>
        <View style={styles.line} />
        <Text style={styles.or}>or</Text>
        <View style={styles.line} />
      </View>

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
            style={styles.brandButton}
            onPress={onApple}
          />
        </View>
      ) : null}

      {showGoogle ? (
        <GoogleSignInButton onPress={onGoogle} disabled={disabled} dark={scheme === 'dark'} />
      ) : null}
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
  dark,
}: {
  onPress: () => void;
  disabled?: boolean;
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
      accessibilityState={{ disabled: Boolean(disabled) }}
      testID="google-sign-in"
      style={({ pressed }) => [
        styles.brandButton,
        styles.googleButton,
        { backgroundColor: colours.fill, borderColor: colours.border },
        pressed && !disabled ? styles.pressed : null,
        disabled ? styles.disabled : null,
      ]}
    >
      <GoogleLogo />
      <Text style={[styles.googleLabel, { color: colours.text }]}>Continue with Google</Text>
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
    // Both brand buttons share the app's control height and corner, so they
    // sit level with "Continue" above them.
    brandButton: {
      height: sizes.control,
    },
    googleButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
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
    pressed: {
      opacity: opacity.pressed,
    },
    disabled: {
      opacity: opacity.disabled,
    },
  });

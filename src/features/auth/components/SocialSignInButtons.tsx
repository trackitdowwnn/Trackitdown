/**
 * WHAT:  SocialSignInButtons — the "or" divider plus the native Sign in with
 *        Apple button (iOS only) and a Continue-with-Google button.
 * WHY:   Both providers return an idToken the auth layer exchanges via
 *        signInWithIdToken (no deep link). Apple uses its OWN required button
 *        design (App Store rule); Google reuses the design-system Button. The
 *        screen owns the flow (calls authApi, branches on the result); this
 *        component is presentational and calls back on press.
 * LINKS: src/features/auth/components/AuthSheet.tsx (owner);
 *        src/features/auth/api/authApi.ts (signInWithApple/Google);
 *        src/features/auth/README.md (provider setup — inert until credentials).
 */

import * as AppleAuthentication from 'expo-apple-authentication';
import { Platform, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/shared/ui';
import { colors, opacity, radii, sizes, spacing, typography } from '@/shared/theme';

export interface SocialSignInButtonsProps {
  onApple: () => void;
  onGoogle: () => void;
  /** Disabled while another sign-in action is in flight. */
  disabled?: boolean;
}

export function SocialSignInButtons({ onApple, onGoogle, disabled }: SocialSignInButtonsProps) {
  return (
    <View style={styles.root}>
      <View style={styles.dividerRow}>
        <View style={styles.line} />
        <Text style={styles.or}>or</Text>
        <View style={styles.line} />
      </View>

      {Platform.OS === 'ios' ? (
        // pointerEvents gates the native Apple button on `disabled` too — it
        // has no disabled prop — so a busy state blocks BOTH providers.
        <View
          style={disabled ? styles.appleDisabled : undefined}
          pointerEvents={disabled ? 'none' : 'auto'}
        >
          <AppleAuthentication.AppleAuthenticationButton
            buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
            buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
            cornerRadius={radii.md}
            style={styles.appleButton}
            onPress={onApple}
          />
        </View>
      ) : null}

      <Button
        label="Continue with Google"
        variant="secondary"
        onPress={onGoogle}
        disabled={disabled}
      />
    </View>
  );
}

const styles = StyleSheet.create({
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
    backgroundColor: colors.border,
  },
  or: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  appleButton: {
    height: sizes.control,
  },
  appleDisabled: {
    opacity: opacity.disabled,
  },
});

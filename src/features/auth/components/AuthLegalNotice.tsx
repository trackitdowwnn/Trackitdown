/**
 * WHAT:  AuthLegalNotice — the "By continuing you agree to our Terms and Privacy
 *        Policy" line under the auth actions, with the two phrases tappable.
 * WHY:   Legal consent must be visible at the point of sign-in, and the links
 *        open in the system browser (expo-web-browser) rather than an in-app
 *        webview — the same pattern the profile screen uses. Copy is calm and
 *        fixed (no exclamation), matching the flow's tone.
 * LINKS: src/features/auth/components/AuthSheet.tsx (consumer);
 *        src/shared/lib/legal.ts (LEGAL_URLS).
 */

import * as WebBrowser from 'expo-web-browser';
import { StyleSheet, Text } from 'react-native';

import { LEGAL_URLS } from '@/shared/lib';
import { colors, spacing, typography } from '@/shared/theme';

export function AuthLegalNotice() {
  return (
    <Text style={styles.text}>
      By continuing you agree to our{' '}
      <Text
        style={styles.link}
        onPress={() => void WebBrowser.openBrowserAsync(LEGAL_URLS.terms)}
        accessibilityRole="link"
      >
        Terms
      </Text>{' '}
      and{' '}
      <Text
        style={styles.link}
        onPress={() => void WebBrowser.openBrowserAsync(LEGAL_URLS.privacyPolicy)}
        accessibilityRole="link"
      >
        Privacy Policy
      </Text>
      .
    </Text>
  );
}

const styles = StyleSheet.create({
  text: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: 'center',
    paddingHorizontal: spacing.md,
  },
  link: {
    color: colors.primary,
  },
});

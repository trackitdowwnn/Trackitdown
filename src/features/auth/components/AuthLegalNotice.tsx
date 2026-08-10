/**
 * WHAT:  AuthLegalNotice — the "By continuing you agree to our Terms and Privacy
 *        Policy" line under the auth actions, with the two phrases tappable.
 * WHY:   Legal consent must be visible at the point of sign-in. The links open
 *        the documents IN-APP (2026-08-02): they previously opened
 *        `trackitdown.example` in the system browser, a reserved TLD that
 *        resolves to nothing — so the one link a user is most likely to tap
 *        before agreeing to anything led to a browser error. In-app also means
 *        the text can never drift from the version they actually agreed to.
 *        Copy is calm and fixed (no exclamation), matching the flow's tone.
 * LINKS: src/features/auth/components/AuthSheet.tsx (consumer);
 *        src/shared/lib/legal.ts (LEGAL_ROUTES); src/features/legal/.
 */

import { useRouter } from 'expo-router';
import { StyleSheet, Text } from 'react-native';

import { legalHref } from '@/shared/lib';
import { spacing, typography, useThemedStyles, type Palette } from '@/shared/theme';

export function AuthLegalNotice() {
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  return (
    <Text style={styles.text}>
      By continuing you agree to our{' '}
      <Text
        style={styles.link}
        onPress={() => router.push(legalHref('terms'))}
        accessibilityRole="link"
      >
        Terms
      </Text>{' '}
      and{' '}
      <Text
        style={styles.link}
        onPress={() => router.push(legalHref('privacy'))}
        accessibilityRole="link"
      >
        Privacy Policy
      </Text>
      .
    </Text>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  text: {
    ...typography.caption,
    color: c.textSecondary,
    textAlign: 'center',
    paddingHorizontal: spacing.md,
  },
  // Underlined so these inline links read as tappable in the monochrome scheme
  // (near-black link text no longer stands out by colour alone).
  link: {
    color: c.primary,
    textDecorationLine: 'underline',
  },
});

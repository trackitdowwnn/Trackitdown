/**
 * WHAT:  ClosedThreadBanner — the quiet read-only notice that takes the
 *        composer's place once the post has left 'active'.
 * WHY:   The closure is stated calmly: recovered is GOOD NEWS and never gets
 *        alarm styling, and the input's removal (the screen's job) makes
 *        read-only self-evident without a disabled box to poke at.
 *
 *        Split out of PostContextStrip on 2026-08-29, when that file's other
 *        half — the car strip — was folded into ThreadHeader and the file
 *        retired. The banner has nothing to do with the header; it only ever
 *        shared a file because both were "chat chrome about the post".
 * LINKS: ../screens/ChatThreadScreen.tsx (the only consumer);
 *        ./ThreadHeader.tsx (the other half of the old file);
 *        docs/DOMAIN.md (Chat: read-only after close).
 */

import { StyleSheet, Text, View } from 'react-native';

import { radii, spacing, typography, useThemedStyles, type Palette } from '@/shared/theme';

export function ClosedThreadBanner({ status }: { status: string }) {
  const styles = useThemedStyles(makeStyles);
  const recovered = status === 'recovered' || status === 'recovered_no_spotter';

  return (
    <View style={styles.banner} accessibilityLiveRegion="polite" testID="closed-thread-banner">
      <Text style={styles.bannerText}>
        {recovered
          ? 'This car was recovered — the conversation is closed, but you can still read it.'
          : 'This post has closed — the conversation is read-only now.'}
      </Text>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    banner: {
      backgroundColor: c.surfaceSubtle,
      borderRadius: radii.md,
      marginHorizontal: spacing.xl,
      marginVertical: spacing.sm,
      padding: spacing.lg,
    },
    bannerText: {
      ...typography.caption,
      color: c.textSecondary,
      textAlign: 'center',
    },
  });

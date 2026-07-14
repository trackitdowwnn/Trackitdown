/**
 * WHAT:  BrandSplash — the calm cold-start / session-restore screen: the brand
 *        wordmark centred on the app background, no spinner.
 * WHY:   While the session + onboarding flag restore, the app must show
 *        something steady rather than flashing a wrong screen or a jittery
 *        spinner (the spec's "no spinner-jank"). Rendered by AuthGate whenever
 *        the route is still 'loading'.
 * LINKS: src/features/auth/components/AuthGate.tsx (consumer).
 *        TODO(art): replace the wordmark Text with the final logo asset.
 */

import { StyleSheet, Text, View } from 'react-native';

import { colors, typography } from '@/shared/theme';

export function BrandSplash() {
  return (
    <View style={styles.root} testID="brand-splash">
      {/* TODO(art): swap for the logo image slot. */}
      <Text style={styles.wordmark}>Trackitdown</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wordmark: {
    ...typography.display,
    color: colors.primary,
  },
});

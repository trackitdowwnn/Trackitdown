/**
 * WHAT:  BrandSplash — the calm cold-start / session-restore screen: the brand
 *        wordmark centred on the app background, with a quiet spinner beneath
 *        it while the first screen's content loads.
 * WHY:   While the session, the onboarding flag and the first feed load
 *        resolve, the app must show something steady rather than flashing a
 *        wrong screen. It is deliberately painted in the SAME background the
 *        native splash uses (app.json splash.backgroundColor), so the handover
 *        from the OS splash to this is invisible — one screen, not two.
 *
 *        The spinner reverses this file's original "no spinner" note, and the
 *        reason it was there still stands: a spinner on a screen the user can
 *        already read is jank (DESIGN_SYSTEM Loading — feeds use skeletons).
 *        This is the other case. It is a blocking wait on a cold start with
 *        nothing else on screen, where the honest signal is "something is
 *        happening"; without it, a slow network is indistinguishable from a
 *        frozen app.
 *
 *        AuthGate owns when this lifts, and caps how long it can ever hold.
 * LINKS: src/features/auth/components/AuthGate.tsx (consumer + the hold rules);
 *        src/shared/lib/appReady.ts (what it waits on);
 *        app.json (splash.backgroundColor must match colors.background).
 *        TODO(art): replace the wordmark Text with the final logo asset.
 */

import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { colors, spacing, typography } from '@/shared/theme';

export function BrandSplash() {
  return (
    <View
      style={styles.root}
      testID="brand-splash"
      // One announcement for the whole screen: a screen reader should hear
      // "loading", not read a wordmark and then meet an unlabelled spinner.
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel="Trackitdown, loading"
    >
      {/* TODO(art): swap for the logo image slot. */}
      <Text style={styles.wordmark}>Trackitdown</Text>
      <ActivityIndicator
        size="small"
        color={colors.textSecondary}
        style={styles.loader}
        testID="brand-splash-loader"
      />
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
  loader: {
    // Far enough below the wordmark to read as a separate, quieter element
    // rather than punctuation attached to it.
    marginTop: spacing.xl,
  },
});

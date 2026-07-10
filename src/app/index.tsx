/**
 * WHAT:  App root route — gates first launch through the onboarding intro,
 *        then shows the placeholder home (with the dev sandbox link).
 * WHY:   Route files stay thin (docs/ARCHITECTURE.md rule 3): the gate logic
 *        lives in the auth feature's useOnboardingGate; this file only maps
 *        its three states to render-nothing / redirect / home. Rendering
 *        nothing while the flag loads prevents a home-screen flash before
 *        the redirect. The home content is still a placeholder, replaced
 *        once the first real feature screen lands.
 * LINKS: src/features/auth (useOnboardingGate, OnboardingScreen);
 *        src/app/onboarding.tsx; src/app/sandbox.tsx.
 */

import { Link, Redirect } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { useOnboardingGate } from '@/features/auth';
import { colors, spacing, typography } from '@/shared/theme';

export default function HomeScreen() {
  const gate = useOnboardingGate();

  if (gate === 'loading') {
    return null; // a blank frame beats a home flash before the redirect
  }
  if (gate === 'unseen') {
    return <Redirect href="/onboarding" />;
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Trackitdown</Text>
      <Link href="/sandbox" style={styles.link}>
        Open component sandbox →
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
    gap: spacing.lg,
  },
  title: {
    ...typography.title,
    color: colors.textPrimary,
  },
  link: {
    ...typography.label,
    color: colors.primary,
  },
});

/**
 * WHAT:  AuthPlaceholderScreen — the stub landing target after onboarding,
 *        replaced in place by the real sign-in screen.
 * WHY:   Onboarding needs somewhere to exit TO before auth exists; routing
 *        to a named /auth destination now means the intro's navigation never
 *        changes when sign-in lands (BUILD_PLAN: sign up / sign in is next).
 *        Includes a dev link back to the home placeholder so the app stays
 *        navigable meanwhile.
 * LINKS: src/features/auth/screens/OnboardingScreen.tsx (routes here);
 *        src/app/auth.tsx (thin route); docs/BUILD_PLAN.md.
 */

import { Link } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, spacing, typography } from '@/shared/theme';

export function AuthPlaceholderScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>Sign in</Text>
        <Text style={styles.body}>
          Sign up and sign in land here next — this screen is a placeholder.
        </Text>
        <Link href="/" style={styles.link}>
          Continue to home (dev) →
        </Link>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
  },
  title: {
    ...typography.title,
    color: colors.textPrimary,
  },
  body: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  // Padded to clear the 44pt touch target (16 + 18 line height + 16).
  link: {
    ...typography.label,
    color: colors.primary,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.md,
  },
});

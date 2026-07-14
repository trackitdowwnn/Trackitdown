/**
 * WHAT:  My Cars tab — guest-aware placeholder: guests get a friendly
 *        invitation through the auth gate; signed-in users get the stub that
 *        will become the owner's post list (features/vehicles).
 * WHY:   Guests browse freely (deferred auth), so tabs never wall or auto-fire
 *        the auth sheet — they explain what lives here and offer "Log in"
 *        through the same gate as every action (tab_my_cars context).
 * LINKS: src/app/(tabs)/_layout.tsx; src/features/auth (useRequireAuth,
 *        useSession); docs/BUILD_PLAN.md (Post a car).
 */

import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useRequireAuth, useSession } from '@/features/auth';
import { colors, spacing, typography } from '@/shared/theme';
import { EmptyState } from '@/shared/ui';

export default function MyCarsScreen() {
  const session = useSession();
  const requireAuth = useRequireAuth();

  if (session.status === 'signedOut') {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <EmptyState
          title="Your cars live here"
          body="Post a stolen car and track its sightings, status, and bounty — all in one place."
          actionLabel="Log in"
          // No continuation: the tab re-renders signed-in reactively.
          onAction={() => requireAuth({ context: 'tab_my_cars' })}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.content}>
        <Text style={styles.title}>My cars</Text>
        <Text style={styles.body}>Your posts and their status land here.</Text>
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
});

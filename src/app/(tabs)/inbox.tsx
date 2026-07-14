/**
 * WHAT:  Inbox tab — guest-aware placeholder: guests get a friendly invitation
 *        through the auth gate; signed-in users get the stub that will become
 *        owner ↔ spotter chat (features/chat). Includes a dev toggle that
 *        hides the tab bar via the standard tabBarStyle mechanism.
 * WHY:   Guests browse freely (deferred auth), so tabs never wall or auto-fire
 *        the auth sheet — they explain what lives here and offer "Log in"
 *        through the same gate as every action (tab_inbox context).
 * LINKS: src/app/(tabs)/_layout.tsx; src/features/auth (useRequireAuth,
 *        useSession); src/shared/ui/AppTabBar.tsx (hide behaviour);
 *        docs/BUILD_PLAN.md (Chat).
 */

import { useNavigation } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useRequireAuth, useSession } from '@/features/auth';
import { colors, spacing, typography } from '@/shared/theme';
import { Button, EmptyState } from '@/shared/ui';

export default function InboxScreen() {
  const navigation = useNavigation();
  const session = useSession();
  const requireAuth = useRequireAuth();
  const [barHidden, setBarHidden] = useState(false);

  // The standard per-screen mechanism AppTabBar animates on. Cleanup restores
  // the bar so a flow leaving mid-hide never strands it — real full-screen
  // flows (wizard, camera) must copy this shape.
  useEffect(() => {
    navigation.setOptions({
      tabBarStyle: barHidden ? { display: 'none' as const } : undefined,
    });
    return () => {
      navigation.setOptions({ tabBarStyle: undefined });
    };
  }, [barHidden, navigation]);

  if (session.status === 'signedOut') {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <EmptyState
          title="Your messages live here"
          body="When you report a sighting, you and the owner can chat about it — safely, in the app."
          actionLabel="Log in"
          // No continuation: the tab re-renders signed-in reactively.
          onAction={() => requireAuth({ context: 'tab_inbox' })}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.content}>
        <Text style={styles.title}>Inbox</Text>
        <Text style={styles.body}>Owner ↔ spotter chat lands here.</Text>
        <Button
          label={barHidden ? 'Show tab bar' : 'Hide tab bar'}
          variant="secondary"
          fullWidth={false}
          onPress={() => setBarHidden((hidden) => !hidden)}
        />
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

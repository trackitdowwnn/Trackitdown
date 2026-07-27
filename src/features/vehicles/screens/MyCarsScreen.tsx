/**
 * WHAT:  MyCarsScreen — a placeholder for a future "garage" of the user's own
 *        vehicles (make/model/plate profiles you own), reached from Profile.
 *        Guests get the auth invitation; signed-in users see a "coming soon"
 *        placeholder. NOT the stolen-car listings — those moved to "My Posts".
 * WHY:   The listings that briefly lived here belong under "My Posts" (a post is
 *        a listing, not a car you own). "My cars" is kept as the entry point for
 *        the eventual garage concept; until that's built it's an honest stub, not
 *        a dead screen.
 * LINKS: src/app/my-cars.tsx (route); src/features/profile/screens/
 *        ProfileScreen.tsx (the push); src/features/vehicles/screens/
 *        MyPostsScreen.tsx (where the listings now live).
 */

import { useRouter } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useRequireAuth, useSession } from '@/features/auth';
import { colors, sizes, spacing, typography } from '@/shared/theme';
import { EmptyState, Screen } from '@/shared/ui';

export function MyCarsScreen() {
  const session = useSession();
  const requireAuth = useRequireAuth();

  return (
    <Screen scroll contentContainerStyle={styles.scroll}>
      <View style={styles.headerRow}>
        <BackButton />
        <Text style={styles.title} accessibilityRole="header">
          My cars
        </Text>
      </View>

      {session.status === 'signedOut' ? (
        <EmptyState
          title="Your cars live here"
          body="Save your vehicles so reporting one stolen is a couple of taps."
          actionLabel="Log in"
          onAction={() => requireAuth({ context: 'tab_my_cars' })}
        />
      ) : (
        <View style={styles.content}>
          <Text style={styles.body}>A garage for your vehicles is coming soon.</Text>
        </View>
      )}
    </Screen>
  );
}

function BackButton() {
  const router = useRouter();
  return (
    <Pressable
      onPress={() => router.back()}
      accessibilityRole="button"
      accessibilityLabel="Back"
      style={styles.back}
      testID="my-cars-back"
    >
      <ChevronLeft size={sizes.icon} color={colors.textPrimary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scroll: {
    padding: spacing.xl,
    gap: spacing.xl,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  back: {
    width: sizes.touchTarget,
    height: sizes.touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -(sizes.touchTarget - sizes.icon) / 2,
  },
  title: {
    ...typography.title,
    color: colors.textPrimary,
    flexShrink: 1,
  },
  content: {
    alignItems: 'center',
    paddingVertical: spacing.xxl,
  },
  body: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});

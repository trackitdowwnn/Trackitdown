/**
 * WHAT:  MyCarsScreen — the pushed "My cars" page (reached from Profile):
 *        guest-aware placeholder with an on-screen back affordance (headers
 *        are hidden app-wide). Guests get a friendly invitation through the
 *        auth gate; signed-in users get the stub that will become the owner's
 *        post list.
 * WHY:   Moved off the tab bar (product call 2026-07-23): your own posts are
 *        an occasional destination, so they live one push from Profile — the
 *        navbar keeps Explore · Watchlist · Inbox · Profile around the centre
 *        action. Guests browse freely (deferred auth), so the page never
 *        walls or auto-fires the auth sheet — it explains what lives here and
 *        offers "Log in" through the same gate as every action.
 * LINKS: src/app/my-cars.tsx (route); src/features/profile/screens/
 *        ProfileScreen.tsx (the push); src/features/auth (useRequireAuth,
 *        useSession); docs/BUILD_PLAN.md (Post a car).
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
      {/* Pushed page, headers hidden app-wide → an on-screen back control
          (system back/swipe still work; this one is for eyes and rotors). */}
      <View style={styles.headerRow}>
        <BackButton />
        <Text style={styles.title} accessibilityRole="header">
          My cars
        </Text>
      </View>

      {session.status === 'signedOut' ? (
        <EmptyState
          title="Your cars live here"
          body="Post a stolen car and track its sightings, status, and bounty — all in one place."
          actionLabel="Log in"
          // No continuation: the page re-renders signed-in reactively.
          onAction={() => requireAuth({ context: 'tab_my_cars' })}
        />
      ) : (
        <View style={styles.content}>
          <Text style={styles.body}>Your posts and their status land here.</Text>
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
  // Full 44pt+ target around the 24pt chevron; the negative margin keeps the
  // glyph optically on the content gutter despite the padding.
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
